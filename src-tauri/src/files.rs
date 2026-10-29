//! App state file and rendered video files.

use std::path::PathBuf;

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("autopilot.json"))
}

#[tauri::command]
pub fn state_read(app: AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Atomic write (temp file + rename) so a crash never leaves a half-written state file.
#[tauri::command]
pub fn state_write(app: AppHandle, json: String) -> Result<(), String> {
    let path = state_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn default_output_dir(app: AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .video_dir()
        .or_else(|_| app.path().document_dir())
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    Ok(base.join("Flag Clash").to_string_lossy().into_owned())
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing header {name}"))?
        .to_str()
        .map_err(|e| e.to_string())?;
    Ok(percent_decode_str(raw).decode_utf8_lossy().into_owned())
}

/// Receives the video as a raw IPC body (no JSON/base64 overhead) and writes it to disk.
#[tauri::command]
pub async fn save_video(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw video bytes".into());
    };
    let dir = PathBuf::from(header(&request, "x-dir")?);
    let name = header(&request, "x-name")?;
    if name.contains(['/', '\\']) || name.contains("..") || name.is_empty() {
        return Err("invalid file name".into());
    }
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let path = dir.join(name);
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Deletes a rendered video or its thumbnail. Only those file types can be removed this way.
#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "mp4" | "webm" | "jpg") {
        return Err("only rendered videos and thumbnails can be deleted".into());
    }
    match tokio::fs::remove_file(&p).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
