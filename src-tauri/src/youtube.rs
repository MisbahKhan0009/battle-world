//! YouTube Data API v3 uploads: resumable sessions, 8 MiB chunks, resume after network errors.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::oauth::{google_error, TokenResponse, TOKEN_URL};
use crate::{tokens, AppState};

const UPLOAD_URL: &str =
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const CHUNK: u64 = 8 * 1024 * 1024; // must be a multiple of 256 KiB
const MAX_RETRIES: u32 = 6;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMeta {
    title: String,
    description: String,
    tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    channel_id: String,
    client_id: String,
    client_secret: String,
    path: String,
    meta: VideoMeta,
    privacy: String,
    publish_at: Option<String>,
    made_for_kids: bool,
    category_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    video_id: String,
}

#[derive(Serialize, Clone)]
struct Progress {
    path: String,
    sent: u64,
    total: u64,
}

async fn access_token(
    app: &AppHandle,
    state: &AppState,
    req: &UploadRequest,
    force: bool,
) -> Result<String, String> {
    if !force {
        if let Some(t) = state.tokens.get(&req.channel_id) {
            return Ok(t);
        }
    }
    let refresh = tokens::load_refresh(app, &req.channel_id)?;
    let resp = state
        .http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", req.client_id.trim()),
            ("client_secret", req.client_secret.trim()),
            ("refresh_token", refresh.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let err = google_error(resp).await;
        if err.contains("invalid_grant") {
            return Err("youtube:authExpired: Access to this channel expired or was revoked. Reconnect it in Channels.".into());
        }
        return Err(err);
    }
    let tok: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;
    state
        .tokens
        .put(&req.channel_id, tok.access_token.clone(), tok.expires_in);
    Ok(tok.access_token)
}

/// Parses a `Range: bytes=0-12345` header into the next byte offset to send.
fn next_offset(resp: &reqwest::Response) -> u64 {
    resp.headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit('-').next())
        .and_then(|n| n.parse::<u64>().ok())
        .map(|last| last + 1)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn youtube_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    req: UploadRequest,
) -> Result<UploadResult, String> {
    let mut file = tokio::fs::File::open(&req.path)
        .await
        .map_err(|e| format!("Cannot open video: {e}"))?;
    let total = file.metadata().await.map_err(|e| e.to_string())?.len();
    let mime = if req.path.to_ascii_lowercase().ends_with(".webm") {
        "video/webm"
    } else {
        "video/mp4"
    };

    let mut status = serde_json::json!({
        "privacyStatus": req.privacy,
        "selfDeclaredMadeForKids": req.made_for_kids,
        "containsSyntheticMedia": false,
    });
    if let Some(at) = &req.publish_at {
        status["publishAt"] = serde_json::Value::String(at.clone());
    }
    let body = serde_json::json!({
        "snippet": {
            "title": req.meta.title,
            "description": req.meta.description,
            "tags": req.meta.tags,
            "categoryId": req.category_id,
            "defaultLanguage": "en",
            "defaultAudioLanguage": "en",
        },
        "status": status,
    });

    // 1. Start a resumable session.
    let mut token = access_token(&app, &state, &req, false).await?;
    let mut session = None;
    for attempt in 0..2 {
        let resp = state
            .http
            .post(UPLOAD_URL)
            .bearer_auth(&token)
            .header("X-Upload-Content-Type", mime)
            .header("X-Upload-Content-Length", total)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if resp.status().as_u16() == 401 && attempt == 0 {
            token = access_token(&app, &state, &req, true).await?;
            continue;
        }
        if !resp.status().is_success() {
            return Err(google_error(resp).await);
        }
        session = resp
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        break;
    }
    let session = session.ok_or("YouTube did not return an upload session")?;

    // 2. Send chunks; on transient errors ask YouTube where to resume.
    let mut offset = 0u64;
    let mut retries = 0u32;
    loop {
        let end = (offset + CHUNK).min(total);
        let mut buf = vec![0u8; (end - offset) as usize];
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| e.to_string())?;
        file.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
        let sent = state
            .http
            .put(&session)
            .bearer_auth(&token)
            .header("Content-Length", buf.len())
            .header(
                "Content-Range",
                format!("bytes {}-{}/{}", offset, end.saturating_sub(1), total),
            )
            .body(buf)
            .timeout(Duration::from_secs(300))
            .send()
            .await;

        let resp = match sent {
            Ok(r) => r,
            Err(e) => {
                retries += 1;
                if retries > MAX_RETRIES {
                    return Err(format!("Upload failed after retries: {e}"));
                }
                tokio::time::sleep(Duration::from_secs(1 << retries.min(5))).await;
                // Ask where to resume.
                if let Ok(r) = state
                    .http
                    .put(&session)
                    .bearer_auth(&token)
                    .header("Content-Length", 0)
                    .header("Content-Range", format!("bytes */{total}"))
                    .send()
                    .await
                {
                    if r.status().as_u16() == 308 {
                        offset = next_offset(&r);
                    } else if r.status().is_success() {
                        let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
                        return Ok(UploadResult {
                            video_id: v["id"].as_str().unwrap_or_default().to_string(),
                        });
                    }
                }
                continue;
            }
        };

        match resp.status().as_u16() {
            200 | 201 => {
                let _ = app.emit(
                    "upload-progress",
                    Progress {
                        path: req.path.clone(),
                        sent: total,
                        total,
                    },
                );
                let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
                let id = v["id"].as_str().unwrap_or_default().to_string();
                if id.is_empty() {
                    return Err("YouTube accepted the upload but returned no video id".into());
                }
                return Ok(UploadResult { video_id: id });
            }
            308 => {
                offset = next_offset(&resp);
                retries = 0;
                let _ = app.emit(
                    "upload-progress",
                    Progress {
                        path: req.path.clone(),
                        sent: offset,
                        total,
                    },
                );
            }
            401 => {
                token = access_token(&app, &state, &req, true).await?;
            }
            500 | 502 | 503 | 504 => {
                retries += 1;
                if retries > MAX_RETRIES {
                    return Err(google_error(resp).await);
                }
                tokio::time::sleep(Duration::from_secs(1 << retries.min(5))).await;
            }
            _ => return Err(google_error(resp).await),
        }
    }
}
