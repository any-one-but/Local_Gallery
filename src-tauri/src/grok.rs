//! The embedded Grok window — a proof of concept.
//!
//! A second, undecorated WebviewWindow loading grok.com, parented to the main
//! window so it sits above it and moves with it. It is a real top-level
//! document, not an iframe: x.com/grok.com send `frame-ancestors`, and
//! WKWebView gives us no way to strip response headers, so framing is out.
//!
//! The window is deliberately *not* on the IPC bridge. See grok-inject.js for
//! why, and for how the close sentinel works.

use std::path::PathBuf;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const GROK_LABEL: &str = "grok";
const GROK_URL: &str = "https://grok.com/";
const MAIN_LABEL: &str = "main";

/// Navigating here is the injected script's way of asking to be closed. The
/// navigation is always cancelled; `.invalid` is reserved by RFC 2606 and can
/// never resolve, so this cannot leak to a real host if the handler regresses.
const GROK_CLOSE_URL: &str = "https://local-gallery.invalid/close";

/// Hosts we are willing to restore into on the next launch. Anything else —
/// an OAuth callback, an error page, some redirector — is dropped in favour of
/// the last good URL, so a session can't be resumed into a dead end.
/// x.com is included because the sign-in flow lives there.
fn is_restorable_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(host) => {
            let host = host.trim_start_matches("www.");
            host == "grok.com"
                || host.ends_with(".grok.com")
                || host == "x.com"
                || host.ends_with(".x.com")
        }
        None => false,
    }
}

fn grok_url_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir config: {e}"))?;
    Ok(dir.join("grok-last-url.txt"))
}

/// The URL the window was last left on, if it still looks sane.
fn saved_grok_url(app: &AppHandle) -> Option<Url> {
    let file = grok_url_file(app).ok()?;
    let raw = std::fs::read_to_string(&file).ok()?;
    let url = Url::parse(raw.trim()).ok()?;
    if is_restorable_url(&url) {
        Some(url)
    } else {
        None
    }
}

/// Records where the window currently is, so the next session reopens there.
///
/// Reads the live webview URL rather than tracking navigations: Grok is an SPA
/// and moves between conversations with pushState, which `on_navigation` never
/// sees, but WKWebView's `url` does reflect.
pub fn save_grok_url(app: &AppHandle) {
    let Some(grok) = app.get_webview_window(GROK_LABEL) else {
        return;
    };
    let Ok(url) = grok.url() else {
        return;
    };
    if !is_restorable_url(&url) {
        return;
    }
    let Ok(file) = grok_url_file(app) else {
        return;
    };
    let _ = std::fs::write(&file, url.as_str());
}

/// The Grok window covers the main window's *content area* only — inner bounds,
/// not outer — so the title bar and its traffic lights stay visible and usable.
fn main_content_bounds(app: &AppHandle) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let main = app.get_webview_window(MAIN_LABEL)?;
    Some((main.inner_position().ok()?, main.inner_size().ok()?))
}

fn place_over_main(app: &AppHandle, grok: &WebviewWindow) {
    if let Some((pos, size)) = main_content_bounds(app) {
        let _ = grok.set_position(pos);
        let _ = grok.set_size(size);
    }
}

/// macOS keeps a child window pinned to its parent when the parent *moves*, but
/// not when it resizes, so lib.rs drives this from the main window's events.
pub fn sync_grok_bounds(app: &AppHandle) {
    let Some(grok) = app.get_webview_window(GROK_LABEL) else {
        return;
    };
    if !grok.is_visible().unwrap_or(false) {
        return;
    }
    place_over_main(app, &grok);
}

/// The close-key spec handed to the injected script, as a JS assignment.
///
/// The Grok window swallows every key while focused, so the app's own binding
/// can never reach the main window to toggle it off — the page has to know the
/// combo itself. Injected as a global rather than invoked over IPC.
fn close_key_prelude(close_key: Option<&str>) -> String {
    let key = close_key.unwrap_or("");
    let json = serde_json::to_string(key).unwrap_or_else(|_| "\"\"".into());
    format!("window.__lgGrokCloseKey={json};")
}

fn hide_grok(app: &AppHandle) {
    save_grok_url(app);
    if let Some(grok) = app.get_webview_window(GROK_LABEL) {
        let _ = grok.hide();
    }
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.set_focus();
    }
}

fn build_grok_window(app: &AppHandle, close_key: Option<&str>) -> Result<(), String> {
    let main = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "main window missing".to_string())?;

    let url = saved_grok_url(app).unwrap_or_else(|| {
        Url::parse(GROK_URL).expect("GROK_URL is a compile-time constant and parses")
    });

    let nav_handle = app.clone();
    let builder = WebviewWindowBuilder::new(app, GROK_LABEL, WebviewUrl::External(url))
        .title("Grok")
        // No decorations means no title bar, which means no drag handle — that
        // is what makes the window unmovable, as there is no `movable(false)`.
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        // Built hidden, then positioned, then shown: otherwise it flashes at
        // the default position before the first set_position lands.
        .visible(false)
        .initialization_script(close_key_prelude(close_key))
        .initialization_script(include_str!("../../grok-inject.js"))
        .on_navigation(move |url| {
            if !url.as_str().starts_with(GROK_CLOSE_URL) {
                return true;
            }
            hide_grok(&nav_handle);
            false
        })
        .parent(&main)
        .map_err(|e| format!("parenting grok window failed: {e}"))?;

    let grok = builder
        .build()
        .map_err(|e| format!("building grok window failed: {e}"))?;

    place_over_main(app, &grok);

    // Cmd+W would otherwise destroy the webview and drop the page's state. Hide
    // instead, so toggling back returns to the same conversation and scroll.
    let close_handle = app.clone();
    grok.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            hide_grok(&close_handle);
        }
    });

    grok.show().map_err(|e| e.to_string())?;
    grok.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggles the Grok window. Returns true when it ends up visible.
///
/// `close_key` is the app's current binding for this action, forwarded so the
/// page can close itself with the same combo. The window is built lazily and
/// then kept alive and merely hidden, so the logged-in session and the open
/// conversation survive toggling.
#[tauri::command]
pub fn toggle_grok_window(app: AppHandle, close_key: Option<String>) -> Result<bool, String> {
    let key = close_key.as_deref().filter(|k| !k.is_empty());

    if let Some(grok) = app.get_webview_window(GROK_LABEL) {
        if grok.is_visible().unwrap_or(false) {
            hide_grok(&app);
            return Ok(false);
        }
        // The binding may have been rebound since the window was built, and the
        // baked-in prelude only reruns on a page load. eval is one-directional
        // (Rust -> page) and needs no IPC capability, so it is safe here.
        let _ = grok.eval(close_key_prelude(key));
        place_over_main(&app, &grok);
        grok.show().map_err(|e| e.to_string())?;
        grok.set_focus().map_err(|e| e.to_string())?;
        return Ok(true);
    }

    build_grok_window(&app, key)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn restorable(raw: &str) -> bool {
        is_restorable_url(&Url::parse(raw).expect("test url parses"))
    }

    #[test]
    fn restores_grok_and_x_https_urls() {
        assert!(restorable("https://grok.com/"));
        assert!(restorable("https://grok.com/chat/abc-123"));
        assert!(restorable("https://www.grok.com/"));
        // The sign-in flow lives on x.com, so a session left mid-login resumes.
        assert!(restorable("https://x.com/i/grok"));
    }

    #[test]
    fn rejects_urls_we_should_not_resume_into() {
        // The close sentinel must never be persisted as a location.
        assert!(!restorable("https://local-gallery.invalid/close"));
        assert!(!restorable("http://grok.com/"), "plain http is not restorable");
        assert!(!restorable("https://evil.com/"));
        // Suffix matching must not be fooled by a lookalike host.
        assert!(!restorable("https://notgrok.com/"));
        assert!(!restorable("https://grok.com.evil.com/"));
        assert!(!restorable("file:///etc/passwd"));
    }

    #[test]
    fn close_key_prelude_escapes_its_input() {
        assert_eq!(close_key_prelude(Some("Cmd+g")), "window.__lgGrokCloseKey=\"Cmd+g\";");
        assert_eq!(close_key_prelude(None), "window.__lgGrokCloseKey=\"\";");
        // The binding is user-controlled and lands in a script, so it has to be
        // JSON-encoded rather than pasted in raw.
        assert_eq!(
            close_key_prelude(Some("\"});alert(1);//")),
            "window.__lgGrokCloseKey=\"\\\"});alert(1);//\";"
        );
    }
}
