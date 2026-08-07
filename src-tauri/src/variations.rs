//! The embedded Variations webview.
//!
//! Behaves like the Grok and Claude windows — a child webview covering the main
//! window's content area, on its own bindable toggle, built lazily and then kept
//! alive and merely hidden so its state survives toggling.
//!
//! It deliberately does **not** go through `embedded_web::EmbeddedSite`. That
//! type exists to make a *remote* site safe to embed: saved locations, host
//! allowlists for what may be resumed into, clipboard link capture, OAuth popup
//! windows, a Safari user agent. Variations is a first-party page we ship inside
//! the bundle (`variations.html`, loaded through `WebviewUrl::App`), so none of
//! that applies — there is one URL, it never navigates, and there is nothing to
//! restore.
//!
//! The other difference follows from the same fact, and is the important one:
//! this webview **is** on the IPC bridge (see `capabilities/default.json`).
//! Grok and Claude must never be, because they are remote origins running
//! partly model-authored content, and the bridge would hand them
//! `fs::remove_path`. Variations is our own code, at the same trust level as
//! index.html, and it needs IPC to read and write its document in the library's
//! metadata folder. That is also why it needs no close sentinel: it can invoke
//! `close_variations_window` directly.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    webview::WebviewBuilder, AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
};

const MAIN_LABEL: &str = "main";
const LABEL: &str = "variations";

static VISIBLE: AtomicBool = AtomicBool::new(false);

/// The globals handed to the page, as JS assignments.
///
/// An embedded webview swallows every key while it has focus, so the app's own
/// binding can never reach the main webview to toggle it back off — the page has
/// to know the combo itself. JSON-encoded because the binding is user-controlled
/// and lands inside a script.
fn page_prelude(close_key: Option<&str>) -> String {
    let key = close_key.unwrap_or("");
    let key_json = serde_json::to_string(key).unwrap_or_else(|_| "\"\"".into());
    format!("window.__lgVariationsCloseKey={key_json};window.__lgVariationsEmbedded=true;")
}

/// Child webview bounds are relative to the main window's content area.
fn main_content_bounds(app: &AppHandle) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let main = app.get_window(MAIN_LABEL)?;
    Some((PhysicalPosition::new(0, 0), main.inner_size().ok()?))
}

/// Keep the child webview covering the app content after main-window resizes.
pub fn sync_variations_bounds(app: &AppHandle) {
    if !VISIBLE.load(Ordering::Relaxed) {
        return;
    }
    let Some(webview) = app.get_webview(LABEL) else {
        return;
    };
    if let Some((pos, size)) = main_content_bounds(app) {
        let _ = webview.set_position(pos);
        let _ = webview.set_size(size);
    }
}

fn hide(app: &AppHandle) {
    if let Some(webview) = app.get_webview(LABEL) {
        let _ = webview.hide();
    }
    VISIBLE.store(false, Ordering::Relaxed);
    // Hand the keyboard back, or the gallery is up with nothing listening to it.
    if let Some(main) = app.get_window(MAIN_LABEL) {
        let _ = main.set_focus();
    }
    if let Some(main_webview) = app.get_webview(MAIN_LABEL) {
        let _ = main_webview.set_focus();
    }
}

fn build(app: &AppHandle, close_key: Option<&str>) -> Result<(), String> {
    let main = app
        .get_window(MAIN_LABEL)
        .ok_or_else(|| "main window missing".to_string())?;

    let builder = WebviewBuilder::new(LABEL, WebviewUrl::App("variations.html".into()))
        .initialization_script(page_prelude(close_key));

    let (pos, size) =
        main_content_bounds(app).ok_or_else(|| "main window bounds missing".to_string())?;
    let webview = main
        .add_child(builder, pos, size)
        .map_err(|e| format!("building Variations webview failed: {e}"))?;

    let _ = webview.set_auto_resize(true);
    VISIBLE.store(true, Ordering::Relaxed);
    webview.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggles the Variations child webview. Returns true when it ends up visible.
///
/// `close_key` is the app's current binding for this action, forwarded so the
/// page can close itself with the same combo.
#[tauri::command]
pub fn toggle_variations_window(app: AppHandle, close_key: Option<String>) -> Result<bool, String> {
    let key = close_key.as_deref().filter(|k| !k.is_empty());

    if let Some(webview) = app.get_webview(LABEL) {
        if VISIBLE.load(Ordering::Relaxed) {
            hide(&app);
            return Ok(false);
        }
        // The binding may have been rebound since the webview was built, and the
        // baked-in prelude only reruns on a page load. eval is one-directional
        // (Rust -> page), so it needs no extra permission.
        let _ = webview.eval(page_prelude(key));
        if let Some((pos, size)) = main_content_bounds(&app) {
            let _ = webview.set_position(pos);
            let _ = webview.set_size(size);
        }
        webview.show().map_err(|e| e.to_string())?;
        VISIBLE.store(true, Ordering::Relaxed);
        webview.set_focus().map_err(|e| e.to_string())?;
        return Ok(true);
    }

    build(&app, key)?;
    Ok(true)
}

/// Lets the page close itself — its Esc handler and its own copy of the toggle
/// binding both land here, since a focused child webview sees the keys and the
/// main window does not.
#[tauri::command]
pub fn close_variations_window(app: AppHandle) {
    hide(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_prelude_escapes_its_input() {
        assert_eq!(
            page_prelude(Some("Cmd+u")),
            "window.__lgVariationsCloseKey=\"Cmd+u\";window.__lgVariationsEmbedded=true;"
        );
        assert_eq!(
            page_prelude(None),
            "window.__lgVariationsCloseKey=\"\";window.__lgVariationsEmbedded=true;"
        );
        // The binding is user-controlled and lands in a script, so it has to be
        // JSON-encoded rather than pasted in raw.
        assert_eq!(
            page_prelude(Some("\";alert(1);//")),
            "window.__lgVariationsCloseKey=\"\\\";alert(1);//\";window.__lgVariationsEmbedded=true;"
        );
    }

    #[test]
    fn does_not_collide_with_the_remote_embedded_sites() {
        // A shared label would make one window resolve to the other.
        assert_ne!(LABEL, crate::grok::site().label);
        assert_ne!(LABEL, crate::claude::site().label);
    }
}
