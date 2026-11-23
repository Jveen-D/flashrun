use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

const TRAY_ID: &str = "flashrun-tray";
const MENU_TOGGLE: &str = "tray-toggle";
const MENU_STOP_ALL: &str = "tray-stop-all";
const MENU_QUIT: &str = "tray-quit";
const MENU_STOP_PREFIX: &str = "tray-stop:";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayRunningItem {
    pub project_id: String,
    pub command_id: String,
    pub project_name: String,
    pub command_label: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayStopCommandPayload {
    project_id: String,
    command_id: String,
}

pub fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(true);
    let minimized = window.is_minimized().unwrap_or(false);

    if visible && !minimized {
        let _ = window.hide();
    } else {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray_menu(app: &AppHandle, items: &[TrayRunningItem]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let toggle = MenuItem::with_id(app, MENU_TOGGLE, "Show / Hide FlashRun", true, None::<&str>)?;
    menu.append(&toggle)?;

    if !items.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        for item in items.iter().take(12) {
            let id = format!("{MENU_STOP_PREFIX}{}::{}", item.project_id, item.command_id);
            let label = format!("Stop: {} / {}", item.project_name, item.command_label);
            let entry = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            menu.append(&entry)?;
        }
        let stop_all = MenuItem::with_id(
            app,
            MENU_STOP_ALL,
            format!("Stop All ({})", items.len()),
            true,
            None::<&str>,
        )?;
        menu.append(&stop_all)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit FlashRun", true, None::<&str>)?;
    menu.append(&quit)?;
    Ok(menu)
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app, &[])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("FlashRun")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == MENU_TOGGLE {
                toggle_main_window(app);
            } else if id == MENU_STOP_ALL {
                let _ = app.emit("tray-stop-all", ());
            } else if id == MENU_QUIT {
                if app.get_webview_window("main").is_some() {
                    let _ = app.emit("tray-quit-requested", ());
                } else {
                    app.exit(0);
                }
            } else if let Some(rest) = id.strip_prefix(MENU_STOP_PREFIX) {
                if let Some((project_id, command_id)) = rest.split_once("::") {
                    let _ = app.emit(
                        "tray-stop-command",
                        TrayStopCommandPayload {
                            project_id: project_id.to_string(),
                            command_id: command_id.to_string(),
                        },
                    );
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[tauri::command]
pub fn sync_tray_menu(app: AppHandle, items: Vec<TrayRunningItem>) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let menu = build_tray_menu(&app, &items).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    let tooltip = if items.is_empty() {
        "FlashRun".to_string()
    } else {
        format!("FlashRun ({} running)", items.len())
    };
    let _ = tray.set_tooltip(Some(tooltip));
    Ok(())
}
