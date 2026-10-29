//! OAuth tokens. Refresh tokens live in the OS credential store (Windows Credential Manager,
//! macOS Keychain, Secret Service on Linux), with a private file fallback where no store exists.
//! Short-lived access tokens are cached in memory only.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.flagclash.desktop";

#[derive(Default)]
pub struct AccessCache(Mutex<HashMap<String, (String, Instant)>>);

impl AccessCache {
    pub fn get(&self, channel: &str) -> Option<String> {
        let map = self.0.lock().ok()?;
        map.get(channel)
            .filter(|(_, exp)| *exp > Instant::now() + Duration::from_secs(90))
            .map(|(t, _)| t.clone())
    }

    pub fn put(&self, channel: &str, token: String, expires_in: u64) {
        if let Ok(mut map) = self.0.lock() {
            map.insert(
                channel.to_string(),
                (token, Instant::now() + Duration::from_secs(expires_in)),
            );
        }
    }

    pub fn forget(&self, channel: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.remove(channel);
        }
    }
}

fn fallback_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("tokens.json"))
}

fn read_fallback(app: &AppHandle) -> HashMap<String, String> {
    fallback_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_fallback(app: &AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let path = fallback_path(app).ok_or("no app data directory")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        &path,
        serde_json::to_string(map).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn store_refresh(app: &AppHandle, channel: &str, token: &str) -> Result<(), String> {
    let keyring_ok = keyring::Entry::new(SERVICE, channel)
        .and_then(|e| e.set_password(token))
        .is_ok();
    let mut map = read_fallback(app);
    if keyring_ok {
        if map.remove(channel).is_some() {
            write_fallback(app, &map)?;
        }
        Ok(())
    } else {
        map.insert(channel.to_string(), token.to_string());
        write_fallback(app, &map)
    }
}

pub fn load_refresh(app: &AppHandle, channel: &str) -> Result<String, String> {
    if let Ok(t) = keyring::Entry::new(SERVICE, channel).and_then(|e| e.get_password()) {
        return Ok(t);
    }
    read_fallback(app).remove(channel).ok_or_else(|| {
        "youtube:authMissing: This channel is not connected. Connect it again in Channels."
            .to_string()
    })
}

pub fn delete_refresh(app: &AppHandle, channel: &str) {
    if let Ok(e) = keyring::Entry::new(SERVICE, channel) {
        let _ = e.delete_credential();
    }
    let mut map = read_fallback(app);
    if map.remove(channel).is_some() {
        let _ = write_fallback(app, &map);
    }
}
