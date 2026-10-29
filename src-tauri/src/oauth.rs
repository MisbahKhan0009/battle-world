//! Google OAuth for installed apps: system browser + loopback redirect + PKCE (RFC 8252).
//! Credentials are the user's own "Desktop app" OAuth client from Google Cloud.

use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::{tokens, AppState};

pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const SCOPES: &str = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

#[derive(Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub refresh_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInfo {
    id: String,
    title: String,
    thumbnail: String,
    subscribers: Option<u64>,
}

fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Flag Clash</title><body style=\"font-family:system-ui;background:#0b0d12;color:#f2f4f8;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"color:#c6ff3d\">Channel connected</h1><p>You can close this tab and return to Flag Clash.</p></div>";

/// Waits for Google's redirect to the loopback listener and returns the authorization code.
async fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        let req = String::from_utf8_lossy(&buf[..n]);
        let target = req
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .unwrap_or("/");
        let url =
            url::Url::parse(&format!("http://localhost{target}")).map_err(|e| e.to_string())?;
        let mut code = None;
        let mut state = None;
        let mut error = None;
        for (k, v) in url.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.into_owned()),
                "state" => state = Some(v.into_owned()),
                "error" => error = Some(v.into_owned()),
                _ => {}
            }
        }
        if code.is_none() && error.is_none() {
            // e.g. /favicon.ico
            let _ = stream
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            continue;
        }
        let body = if error.is_some() {
            DONE_PAGE.replace("Channel connected", "Connection cancelled")
        } else {
            DONE_PAGE.to_string()
        };
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(resp.as_bytes()).await;
        if let Some(e) = error {
            return Err(format!("Google sign-in was cancelled ({e})."));
        }
        if state.as_deref() != Some(expected_state) {
            return Err("Sign-in response did not match this request. Try again.".into());
        }
        return code.ok_or_else(|| "No authorization code returned".to_string());
    }
}

pub async fn google_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    #[derive(Deserialize)]
    struct Detail {
        reason: Option<String>,
    }
    #[derive(Deserialize)]
    struct Inner {
        message: Option<String>,
        errors: Option<Vec<Detail>>,
    }
    #[derive(Deserialize)]
    struct Outer {
        error: serde_json::Value,
        error_description: Option<String>,
    }
    if let Ok(o) = serde_json::from_str::<Outer>(&text) {
        if let Ok(inner) = serde_json::from_value::<Inner>(o.error.clone()) {
            let reason = inner
                .errors
                .and_then(|e| e.into_iter().next())
                .and_then(|d| d.reason)
                .unwrap_or_else(|| status.as_u16().to_string());
            return format!("youtube:{reason}: {}", inner.message.unwrap_or_default());
        }
        if let Some(code) = o.error.as_str() {
            return format!(
                "youtube:{code}: {}",
                o.error_description.unwrap_or_default()
            );
        }
    }
    format!(
        "youtube:{}: {}",
        status.as_u16(),
        text.chars().take(300).collect::<String>()
    )
}

#[tauri::command]
pub async fn oauth_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    client_id: String,
    client_secret: String,
) -> Result<ChannelInfo, String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("Add your Google OAuth client ID and secret in Settings first.".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let redirect = format!(
        "http://127.0.0.1:{}",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let verifier = random_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let csrf = random_string(24);

    let auth = url::Url::parse_with_params(
        AUTH_URL,
        &[
            ("client_id", client_id.trim()),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", SCOPES),
            ("access_type", "offline"),
            ("prompt", "consent select_account"),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", csrf.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;
    app.opener()
        .open_url(auth.as_str(), None::<&str>)
        .map_err(|e| e.to_string())?;

    let code = tokio::time::timeout(Duration::from_secs(300), wait_for_code(listener, &csrf))
        .await
        .map_err(|_| "Sign-in timed out after 5 minutes. Try again.".to_string())??;

    let resp = state
        .http
        .post(TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id.trim()),
            ("client_secret", client_secret.trim()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(google_error(resp).await);
    }
    let tok: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;
    let refresh = tok
        .refresh_token
        .ok_or("Google did not return a refresh token. Remove Flag Clash from your Google account permissions and connect again.")?;

    let resp = state
        .http
        .get("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true")
        .bearer_auth(&tok.access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(google_error(resp).await);
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let item = body["items"]
        .get(0)
        .ok_or("This Google account has no YouTube channel. Create one on YouTube first.")?;
    let id = item["id"].as_str().unwrap_or_default().to_string();
    let info = ChannelInfo {
        id: id.clone(),
        title: item["snippet"]["title"]
            .as_str()
            .unwrap_or("YouTube channel")
            .to_string(),
        thumbnail: item["snippet"]["thumbnails"]["default"]["url"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        subscribers: item["statistics"]["subscriberCount"]
            .as_str()
            .and_then(|s| s.parse().ok()),
    };
    tokens::store_refresh(&app, &id, &refresh)?;
    state.tokens.put(&id, tok.access_token, tok.expires_in);
    Ok(info)
}

#[tauri::command]
pub async fn oauth_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<(), String> {
    if let Ok(refresh) = tokens::load_refresh(&app, &channel_id) {
        // Best effort: revoke access at Google too.
        let _ = state
            .http
            .post(REVOKE_URL)
            .form(&[("token", refresh.as_str())])
            .send()
            .await;
    }
    tokens::delete_refresh(&app, &channel_id);
    state.tokens.forget(&channel_id);
    Ok(())
}
