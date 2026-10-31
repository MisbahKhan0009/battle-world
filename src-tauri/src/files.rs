//! App state file, rendered video files, and the music folder.

use std::path::PathBuf;

use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
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

fn is_video(path: &std::path::Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("mp4" | "webm")
    )
}

/// Creates (or empties) a video file that a render streams into, and returns its path.
#[tauri::command]
pub async fn video_create(dir: String, name: String) -> Result<String, String> {
    if name.contains(['/', '\\']) || name.contains("..") || name.is_empty() {
        return Err("invalid file name".into());
    }
    let dir = PathBuf::from(dir);
    let path = dir.join(&name);
    if !is_video(&path) {
        return Err("only video files can be created".into());
    }
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::File::create(&path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Writes a piece of a streamed video at a byte position (raw IPC body, no JSON/base64 overhead).
#[tauri::command]
pub async fn video_write_at(request: Request<'_>) -> Result<(), String> {
    use tokio::io::{AsyncSeekExt, AsyncWriteExt};
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw video bytes".into());
    };
    let path = PathBuf::from(header(&request, "x-path")?);
    let offset: u64 = header(&request, "x-offset")?
        .parse()
        .map_err(|_| "invalid offset".to_string())?;
    if !is_video(&path) {
        return Err("only video files can be written".into());
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .await
        .map_err(|e| e.to_string())?;
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).await.map_err(|e| e.to_string())?;
    file.flush().await.map_err(|e| e.to_string())
}

/// Audio files the music folder may hold (what YouTube's Audio Library and most stores download).
const MUSIC_EXTENSIONS: [&str; 6] = ["mp3", "m4a", "aac", "wav", "ogg", "flac"];

fn is_music(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MUSIC_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
pub fn default_music_dir(app: AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .audio_dir()
        .or_else(|_| app.path().document_dir())
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    Ok(base.join("Flag Clash Music").to_string_lossy().into_owned())
}

#[derive(Serialize)]
pub struct MusicFile {
    name: String,
    path: String,
    /// Credit text from a .txt file with the same name, for tracks that ask for attribution.
    attribution: Option<String>,
}

/// Lists the tracks in the music folder (creating the folder the first time), sorted by name.
#[tauri::command]
pub async fn music_list(dir: String) -> Result<Vec<MusicFile>, String> {
    let dir = PathBuf::from(dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let mut entries = tokio::fs::read_dir(&dir).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if !path.is_file() || !is_music(&path) {
            continue;
        }
        let attribution = tokio::fs::read_to_string(path.with_extension("txt"))
            .await
            .ok()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        out.push(MusicFile {
            name: path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.to_string_lossy().into_owned(),
            attribution,
        });
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    Ok(out)
}

/// Reads one track as raw bytes (only audio files can be read this way).
#[tauri::command]
pub async fn music_read(path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    if !is_music(&p) {
        return Err("only audio files can be read as music".into());
    }
    let bytes = tokio::fs::read(&p).await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}
