//! Facebook Pages and Instagram professional accounts through Meta's Graph API. You paste a Page
//! access token (from your own Meta app); the app finds the Page and the Instagram account linked
//! to it, keeps the token in Windows Credential Manager, and publishes there: Facebook Reels
//! (Shorts), Facebook videos (long videos, which Facebook can schedule) and Instagram Reels.

use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio_util::io::ReaderStream;

use crate::youtube::{take_cancel, Progress};
use crate::{tokens, AppState};

const VERSION: &str = "v26.0";
const GRAPH: &str = "https://graph.facebook.com";
const GRAPH_VIDEO: &str = "https://graph-video.facebook.com";
const RUPLOAD: &str = "https://rupload.facebook.com";

fn token_key(page_id: &str) -> String {
    format!("meta:{page_id}")
}

/// What a Page access token can post to.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaAccount {
    page_id: String,
    page_name: String,
    page_picture: Option<String>,
    ig_id: Option<String>,
    ig_username: Option<String>,
    ig_picture: Option<String>,
}

/// Meta's error text (`error.message`), or the HTTP status when there is none.
async fn meta_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(|m| format!("meta: {m}")))
        .unwrap_or_else(|| format!("meta: HTTP {status}"))
}

async fn json_or_error(resp: reqwest::Response) -> Result<serde_json::Value, String> {
    if !resp.status().is_success() {
        return Err(meta_error(resp).await);
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// Checks a Page access token, stores it, and returns the Page and its Instagram account.
#[tauri::command]
pub async fn meta_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    token: String,
) -> Result<MetaAccount, String> {
    let token = token.trim().to_string();
    let resp = state
        .http
        .get(format!("{GRAPH}/{VERSION}/me"))
        .query(&[
            (
                "fields",
                "id,name,picture{url},instagram_business_account{id,username,profile_picture_url}",
            ),
            ("access_token", token.as_str()),
        ])
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let err = meta_error(resp).await;
        // A user token reaches the person, not the Page: say which token is needed.
        return Err(if err.contains("instagram_business_account") {
            "meta: This is a user token. Use the Page access token: in Graph API Explorer, open \
             \"User or Page\" and pick your Page, then copy the token."
                .into()
        } else {
            err
        });
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let page_id = v["id"].as_str().unwrap_or_default().to_string();
    if page_id.is_empty() {
        return Err("meta: The token did not return a Page.".into());
    }
    tokens::store_refresh(&app, &token_key(&page_id), &token)?;
    let ig = &v["instagram_business_account"];
    Ok(MetaAccount {
        page_id,
        page_name: v["name"].as_str().unwrap_or_default().to_string(),
        page_picture: v["picture"]["data"]["url"].as_str().map(str::to_string),
        ig_id: ig["id"].as_str().map(str::to_string),
        ig_username: ig["username"].as_str().map(str::to_string),
        ig_picture: ig["profile_picture_url"].as_str().map(str::to_string),
    })
}

/// Forgets a Page's token.
#[tauri::command]
pub fn meta_disconnect(app: AppHandle, page_id: String) {
    tokens::delete_refresh(&app, &token_key(&page_id));
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaPublish {
    page_id: String,
    /// "facebook" or "instagram".
    target: String,
    ig_id: Option<String>,
    path: String,
    /// "short" (a Reel) or "video".
    format: String,
    title: String,
    description: String,
    /// Facebook videos only: when Facebook should publish it (unix seconds).
    publish_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaResult {
    video_id: String,
}

/// The file as a request body that reports upload progress (and stops when asked to).
async fn file_body(app: &AppHandle, path: &str) -> Result<(reqwest::Body, u64), String> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("Cannot open video: {e}"))?;
    let total = file.metadata().await.map_err(|e| e.to_string())?.len();
    let app = app.clone();
    let p = path.to_string();
    let mut sent = 0u64;
    let stream = ReaderStream::with_capacity(file, 1 << 20).map(move |chunk| {
        if let Ok(c) = &chunk {
            sent += c.len() as u64;
            let _ = app.emit(
                "upload-progress",
                Progress {
                    path: p.clone(),
                    sent,
                    total,
                },
            );
        }
        chunk
    });
    Ok((reqwest::Body::wrap_stream(stream), total))
}

/// Sends a file to rupload.facebook.com (Reels for Facebook, and Instagram).
async fn rupload(
    app: &AppHandle,
    state: &AppState,
    url: String,
    token: &str,
    path: &str,
) -> Result<(), String> {
    let (body, total) = file_body(app, path).await?;
    let resp = state
        .http
        .post(url)
        .header("Authorization", format!("OAuth {token}"))
        .header("offset", "0")
        .header("file_size", total)
        .header("Content-Length", total)
        .body(body)
        .timeout(Duration::from_secs(1800))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    json_or_error(resp).await.map(|_| ())
}

/// Publishes a rendered video on the Page (a Reel, or a video Facebook can schedule) or on its
/// Instagram account (a Reel).
#[tauri::command]
pub async fn meta_publish(
    app: AppHandle,
    state: State<'_, AppState>,
    req: MetaPublish,
) -> Result<MetaResult, String> {
    let token = tokens::load_refresh(&app, &token_key(&req.page_id)).map_err(|_| {
        "meta: This Page is not connected. Connect it again in Platforms.".to_string()
    })?;
    take_cancel(&state, &req.path);
    let http = &state.http;
    let text = if req.title.is_empty() {
        req.description.clone()
    } else {
        format!("{}\n\n{}", req.title, req.description)
    };

    if req.target == "instagram" {
        let ig = req
            .ig_id
            .as_deref()
            .ok_or("meta: No Instagram account is linked to this Page.")?;
        // 1. A Reels container for a resumable upload.
        let v = json_or_error(
            http.post(format!("{GRAPH}/{VERSION}/{ig}/media"))
                .form(&[
                    ("media_type", "REELS"),
                    ("upload_type", "resumable"),
                    ("caption", text.as_str()),
                    ("share_to_feed", "true"),
                    ("access_token", token.as_str()),
                ])
                .timeout(Duration::from_secs(60))
                .send()
                .await
                .map_err(|e| e.to_string())?,
        )
        .await?;
        let container = v["id"]
            .as_str()
            .ok_or("meta: Instagram returned no container")?
            .to_string();
        // 2. The video itself.
        rupload(
            &app,
            &state,
            format!("{RUPLOAD}/ig-api-upload/{VERSION}/{container}"),
            &token,
            &req.path,
        )
        .await?;
        // 3. Wait until Instagram has processed it, then publish.
        for _ in 0..120 {
            if take_cancel(&state, &req.path) {
                return Err("Upload cancelled".into());
            }
            let s = json_or_error(
                http.get(format!("{GRAPH}/{VERSION}/{container}"))
                    .query(&[
                        ("fields", "status_code,status"),
                        ("access_token", token.as_str()),
                    ])
                    .timeout(Duration::from_secs(30))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?,
            )
            .await?;
            match s["status_code"].as_str().unwrap_or("") {
                "FINISHED" => break,
                "ERROR" | "EXPIRED" => {
                    return Err(format!(
                        "meta: Instagram could not process the video: {}",
                        s["status"].as_str().unwrap_or("unknown error")
                    ))
                }
                _ => tokio::time::sleep(Duration::from_secs(5)).await,
            }
        }
        let p = json_or_error(
            http.post(format!("{GRAPH}/{VERSION}/{ig}/media_publish"))
                .form(&[
                    ("creation_id", container.as_str()),
                    ("access_token", token.as_str()),
                ])
                .timeout(Duration::from_secs(60))
                .send()
                .await
                .map_err(|e| e.to_string())?,
        )
        .await?;
        return Ok(MetaResult {
            video_id: p["id"].as_str().unwrap_or(&container).to_string(),
        });
    }

    let page = req.page_id.as_str();
    if req.format == "short" {
        // A Facebook Reel: start, upload, finish (published right away).
        let v = json_or_error(
            http.post(format!("{GRAPH}/{VERSION}/{page}/video_reels"))
                .form(&[("upload_phase", "start"), ("access_token", token.as_str())])
                .timeout(Duration::from_secs(60))
                .send()
                .await
                .map_err(|e| e.to_string())?,
        )
        .await?;
        let video_id = v["video_id"]
            .as_str()
            .ok_or("meta: Facebook returned no video id")?
            .to_string();
        rupload(
            &app,
            &state,
            format!("{RUPLOAD}/video-upload/{VERSION}/{video_id}"),
            &token,
            &req.path,
        )
        .await?;
        json_or_error(
            http.post(format!("{GRAPH}/{VERSION}/{page}/video_reels"))
                .form(&[
                    ("upload_phase", "finish"),
                    ("video_id", video_id.as_str()),
                    ("video_state", "PUBLISHED"),
                    ("title", req.title.as_str()),
                    ("description", req.description.as_str()),
                    ("access_token", token.as_str()),
                ])
                .timeout(Duration::from_secs(60))
                .send()
                .await
                .map_err(|e| e.to_string())?,
        )
        .await?;
        return Ok(MetaResult { video_id });
    }

    // A long video on the Page, scheduled when a publish time is given.
    let (body, total) = file_body(&app, &req.path).await?;
    let name = std::path::Path::new(&req.path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("video.mp4")
        .to_string();
    let part = reqwest::multipart::Part::stream_with_length(body, total)
        .file_name(name)
        .mime_str("video/mp4")
        .map_err(|e| e.to_string())?;
    let mut form = reqwest::multipart::Form::new()
        .text("title", req.title.clone())
        .text("description", req.description.clone())
        .text("access_token", token.clone())
        .part("source", part);
    if let Some(at) = req.publish_at {
        form = form
            .text("published", "false")
            .text("scheduled_publish_time", at.to_string());
    }
    let v = json_or_error(
        http.post(format!("{GRAPH_VIDEO}/{VERSION}/{page}/videos"))
            .multipart(form)
            .timeout(Duration::from_secs(3600))
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await?;
    Ok(MetaResult {
        video_id: v["id"].as_str().unwrap_or_default().to_string(),
    })
}
