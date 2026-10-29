//! System tray: open the window, see autopilot status, start/pause it, quit.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::show_main;

pub struct TrayItems {
    status: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Flag Clash", true, None::<&str>)?;
    let status = MenuItem::with_id(app, "status", "Autopilot: paused", false, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Start autopilot", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Flag Clash", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &status, &sep, &toggle, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Flag Clash")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "toggle" => {
                let _ = app.emit("tray-toggle-autopilot", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(TrayItems { status, toggle });
    Ok(())
}

#[tauri::command]
pub fn tray_update(app: AppHandle, running: bool, status: String) -> Result<(), String> {
    let items = app.state::<TrayItems>();
    items
        .status
        .set_text(format!("Autopilot: {status}"))
        .map_err(|e| e.to_string())?;
    items
        .toggle
        .set_text(if running {
            "Pause autopilot"
        } else {
            "Start autopilot"
        })
        .map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("Flag Clash: {status}")));
    }
    Ok(())
}
