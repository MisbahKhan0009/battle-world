//! Flag Clash desktop shell. The web app (rendering, scheduling, UI) runs in the webview; this
//! side provides what a browser cannot: Google sign-in with a loopback redirect, secure token
//! storage, resumable YouTube uploads, files on disk, a tray icon, launch at login, and a
//! heartbeat that keeps the autopilot ticking while the window is hidden.

mod files;
mod oauth;
mod tokens;
mod tray;
mod youtube;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub close_to_tray: AtomicBool,
    pub http: reqwest::Client,
    pub tokens: tokens::AccessCache,
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())
}

#[tauri::command]
fn close_to_tray_set(state: tauri::State<'_, AppState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https links can be opened".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Errors from the web side end up in the app's stderr log, for diagnosing problems.
#[tauri::command]
fn client_log(level: String, message: String) {
    eprintln!(
        "[web:{level}] {}",
        message.chars().take(2000).collect::<String>()
    );
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .user_agent(concat!("FlagClash/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .expect("HTTP client");

    tauri::Builder::default()
        // Must be first: a second launch focuses the running app instead.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            close_to_tray: AtomicBool::new(true),
            http,
            tokens: tokens::AccessCache::default(),
        })
        .setup(|app| {
            tray::create(app.handle())?;
            // Launched at login with --hidden: stay in the tray.
            let hidden = std::env::args().any(|a| a == "--hidden");
            if !hidden {
                show_main(app.handle());
            }
            // Heartbeat for the autopilot scheduler, independent of webview timer throttling.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    let _ = handle.emit("autopilot-tick", ());
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.close_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            files::state_read,
            files::state_write,
            files::default_output_dir,
            files::save_video,
            files::delete_file,
            oauth::oauth_connect,
            oauth::oauth_disconnect,
            youtube::youtube_upload,
            youtube::youtube_set_thumbnail,
            tray::tray_update,
            autostart_get,
            autostart_set,
            close_to_tray_set,
            open_url,
            open_path,
            client_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flag Clash");
}
