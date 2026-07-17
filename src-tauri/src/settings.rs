//! Native Settings window lifecycle.
//!
//! The settings UI is rendered by the existing app document in a dedicated
//! mode. It remains a real, decorated top-level window; the initialization
//! flag lets the web layer hide the gallery chrome and expose only Settings.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const SETTINGS_LABEL: &str = "settings";

fn settings_prelude(initial_tab: Option<&str>) -> String {
    let tab = serde_json::to_string(initial_tab.unwrap_or("general"))
        .unwrap_or_else(|_| "\"general\"".into());
    format!(
        "window.__LG_SETTINGS_WINDOW__=true;window.__LG_SETTINGS_INITIAL_TAB__={tab};\
document.documentElement.classList.add('settings-window');"
    )
}

/// Opens the Settings window, or focuses the existing instance.
///
/// The optional tab is used by legacy in-app entry points (for example the
/// former Controls pane shortcut). The native macOS Settings item opens the
/// normal General tab.
pub fn show_settings_window(app: &AppHandle, initial_tab: Option<&str>) -> Result<(), String> {
    let requested_tab = initial_tab.filter(|value| !value.is_empty());
    let tab = requested_tab.unwrap_or("general");

    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        if let Some(requested_tab) = requested_tab {
            let tab_json = serde_json::to_string(requested_tab)
                .unwrap_or_else(|_| "\"general\"".into());
            let _ = window.eval(format!(
                "if(window.__lgOpenSettingsTab)window.__lgOpenSettingsTab({tab_json});"
            ));
        }
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let bridge = include_str!("../../tauri-bridge.js");
    let fs_shim = include_str!("../../tauri-fs-shim.js");
    let window = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Settings")
    .inner_size(720.0, 760.0)
    .min_inner_size(460.0, 520.0)
    .resizable(true)
    .maximizable(false)
    .disable_drag_drop_handler()
    .initialization_script(settings_prelude(Some(tab)))
    .initialization_script(bridge)
    .initialization_script(fs_shim)
    .build()
    .map_err(|e| format!("building settings window failed: {e}"))?;

    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle, tab: Option<String>) -> Result<(), String> {
    show_settings_window(&app, tab.as_deref())
}
