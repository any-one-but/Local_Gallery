//! The embedded Grok webview.
//!
//! A child webview loading grok.com inside the main app window. It is a real
//! top-level document, not an iframe: x.com/grok.com send `frame-ancestors`, and
//! WKWebView gives us no way to strip response headers, so framing is out.
//!
//! The webview is deliberately *not* on the IPC bridge. See grok-inject.js for
//! why, and for how the close sentinel works.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    webview::WebviewBuilder, AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, Webview,
    WebviewUrl,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

const GROK_LABEL: &str = "grok";
const GROK_URL: &str = "https://grok.com/";
const MAIN_LABEL: &str = "main";
static GROK_VISIBLE: AtomicBool = AtomicBool::new(false);

/// Navigating here is the injected script's way of asking to be closed. The
/// navigation is always cancelled; `.invalid` is reserved by RFC 2606 and can
/// never resolve, so this cannot leak to a real host if the handler regresses.
const GROK_CLOSE_URL: &str = "https://local-gallery.invalid/close";

/// Hosts we are willing to restore into on the next launch. Anything else —
/// an OAuth callback, an error page, some redirector — is dropped in favour of
/// the last good URL, so a session can't be resumed into a dead end.
/// x.com is included because the sign-in flow lives there.
fn is_grok_host(url: &Url) -> bool {
    match url.host_str() {
        // The leading-dot checks are what stop a lookalike like
        // grok.com.evil.com matching on a bare suffix test.
        Some(host) => {
            let host = host.trim_start_matches("www.");
            host == "grok.com" || host.ends_with(".grok.com")
        }
        None => false,
    }
}

fn is_x_host(url: &Url) -> bool {
    match url.host_str() {
        Some(host) => {
            let host = host.trim_start_matches("www.");
            host == "x.com" || host.ends_with(".x.com")
        }
        None => false,
    }
}

fn is_restorable_url(url: &Url) -> bool {
    url.scheme() == "https" && (is_grok_host(url) || is_x_host(url))
}

/// A Grok link sitting in the clipboard, if there is one.
///
/// This is the escape hatch, and the whole feature: copy a Grok URL anywhere,
/// hit the toggle, and the window opens there instead of the saved location.
/// Nothing to configure and nothing to clear afterwards.
///
/// Deliberately narrower than `is_restorable_url`, which also allows x.com so a
/// half-finished sign-in can resume. Here x.com would mean any copied tweet
/// link hijacks the window, so this is grok.com only. https only, too: a
/// `javascript:`, `data:` or `file:` URL would otherwise be a script-injection
/// or local-file-read primitive aimed at a webview that runs our init script —
/// and the clipboard is not a trusted source, it is whatever was copied last.
fn parse_grok_link(text: &str) -> Option<Url> {
    let url = Url::parse(text.trim()).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    if !is_grok_host(&url) {
        return None;
    }
    Some(url)
}

fn clipboard_grok_link(app: &AppHandle) -> Option<Url> {
    let text = app.clipboard().read_text().ok()?;
    parse_grok_link(&text)
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

/// Records where the webview currently is, so the next session reopens there.
///
/// Reads the live webview URL rather than tracking navigations: Grok is an SPA
/// and moves between conversations with pushState, which `on_navigation` never
/// sees, but WKWebView's `url` does reflect.
pub fn save_grok_url(app: &AppHandle) {
    let Some(grok) = app.get_webview(GROK_LABEL) else {
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

/// Child webview bounds are relative to the main window's content area.
fn main_content_bounds(app: &AppHandle) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let main = app.get_window(MAIN_LABEL)?;
    Some((PhysicalPosition::new(0, 0), main.inner_size().ok()?))
}

fn place_inside_main(app: &AppHandle, grok: &Webview) {
    if let Some((pos, size)) = main_content_bounds(app) {
        let _ = grok.set_position(pos);
        let _ = grok.set_size(size);
    }
}

/// Keep the Grok child webview covering the app content after main-window size
/// changes. Moves do not matter for a child webview, but the caller may send
/// them and this remains harmless.
pub fn sync_grok_bounds(app: &AppHandle) {
    if !GROK_VISIBLE.load(Ordering::Relaxed) {
        return;
    };
    let Some(grok) = app.get_webview(GROK_LABEL) else {
        return;
    };
    place_inside_main(app, &grok);
}

/// The close-key spec handed to the injected script, as a JS assignment.
///
/// The Grok webview swallows every key while focused, so the app's own binding
/// can never reach the main webview to toggle it off — the page has to know the
/// combo itself. Injected as a global rather than invoked over IPC.
fn close_key_prelude(close_key: Option<&str>) -> String {
    let key = close_key.unwrap_or("");
    let json = serde_json::to_string(key).unwrap_or_else(|_| "\"\"".into());
    format!("window.__lgGrokCloseKey={json};")
}

fn hide_grok(app: &AppHandle) {
    save_grok_url(app);
    if let Some(grok) = app.get_webview(GROK_LABEL) {
        let _ = grok.hide();
    }
    GROK_VISIBLE.store(false, Ordering::Relaxed);
    if let Some(main) = app.get_window(MAIN_LABEL) {
        let _ = main.set_focus();
    }
    if let Some(main_webview) = app.get_webview(MAIN_LABEL) {
        let _ = main_webview.set_focus();
    }
}

fn build_grok_webview(
    app: &AppHandle,
    close_key: Option<&str>,
    override_url: Option<Url>,
) -> Result<(), String> {
    let main = app
        .get_window(MAIN_LABEL)
        .ok_or_else(|| "main window missing".to_string())?;

    // Clipboard link beats the saved location beats the default.
    let url = override_url.or_else(|| saved_grok_url(app)).unwrap_or_else(|| {
        Url::parse(GROK_URL).expect("GROK_URL is a compile-time constant and parses")
    });

    let nav_handle = app.clone();
    let builder = WebviewBuilder::new(GROK_LABEL, WebviewUrl::External(url))
        .initialization_script(close_key_prelude(close_key))
        .initialization_script(include_str!("../../grok-inject.js"))
        .on_navigation(move |url| {
            if !url.as_str().starts_with(GROK_CLOSE_URL) {
                return true;
            }
            hide_grok(&nav_handle);
            false
        });

    let (_, size) =
        main_content_bounds(app).ok_or_else(|| "main window bounds missing".to_string())?;
    let grok = main
        .add_child(builder, PhysicalPosition::new(0, 0), size)
        .map_err(|e| format!("building grok webview failed: {e}"))?;

    place_inside_main(app, &grok);
    let _ = grok.set_auto_resize(true);

    GROK_VISIBLE.store(true, Ordering::Relaxed);
    grok.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggles the Grok child webview. Returns true when it ends up visible.
///
/// `close_key` is the app's current binding for this action, forwarded so the
/// page can close itself with the same combo. The webview is built lazily and
/// then kept alive and merely hidden, so the logged-in session and the open
/// conversation survive toggling.
///
/// A Grok link in the clipboard wins over the saved location, so copying a URL
/// and hitting the toggle takes you straight there.
#[tauri::command]
pub fn toggle_grok_window(app: AppHandle, close_key: Option<String>) -> Result<bool, String> {
    let key = close_key.as_deref().filter(|k| !k.is_empty());

    if let Some(grok) = app.get_webview(GROK_LABEL) {
        if GROK_VISIBLE.load(Ordering::Relaxed) {
            hide_grok(&app);
            return Ok(false);
        }
        // The binding may have been rebound since the window was built, and the
        // baked-in prelude only reruns on a page load. eval is one-directional
        // (Rust -> page) and needs no IPC capability, so it is safe here.
        let _ = grok.eval(close_key_prelude(key));

        // Only navigate if the clipboard points somewhere else: a link tends to
        // sit in the clipboard for a while, and re-navigating on every toggle
        // would reload the same page and throw away its scroll each time.
        if let Some(url) = clipboard_grok_link(&app) {
            let already_there = grok.url().map(|current| current == url).unwrap_or(false);
            if !already_there {
                // Save first — navigating drops the current location, which is
                // still where the user was, so it stays the fallback.
                save_grok_url(&app);
                grok.navigate(url)
                    .map_err(|e| format!("grok navigate: {e}"))?;
            }
        }
        place_inside_main(&app, &grok);
        grok.show().map_err(|e| e.to_string())?;
        GROK_VISIBLE.store(true, Ordering::Relaxed);
        grok.set_focus().map_err(|e| e.to_string())?;
        return Ok(true);
    }

    let target = clipboard_grok_link(&app);
    build_grok_webview(&app, key, target)?;
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
    fn clipboard_takes_grok_links() {
        assert!(parse_grok_link("https://grok.com/chat/abc-123").is_some());
        assert!(parse_grok_link("https://grok.com/").is_some());
        assert!(parse_grok_link("https://www.grok.com/chat/x").is_some());
        // Copied text picks up stray whitespace and newlines constantly.
        assert!(parse_grok_link("  https://grok.com/chat/x\n").is_some());
    }

    #[test]
    fn clipboard_ignores_everything_else() {
        // The overwhelmingly common case: the clipboard holds something that is
        // not a link at all, and the toggle must just open normally.
        assert!(parse_grok_link("").is_none());
        assert!(parse_grok_link("some copied prose").is_none());
        assert!(parse_grok_link("/Users/jo/Pictures/cat.png").is_none());
        assert!(parse_grok_link("https://example.com/").is_none());
        // x.com is restorable (sign-in lives there) but must NOT be taken from
        // the clipboard, or every copied tweet link hijacks the window.
        assert!(parse_grok_link("https://x.com/i/grok").is_none());
        // Lookalike hosts a bare suffix test would wrongly accept.
        assert!(parse_grok_link("https://grok.com.evil.com/").is_none());
        assert!(parse_grok_link("https://notgrok.com/").is_none());
        // The clipboard is untrusted input; these schemes would be a script
        // injection or local-file read aimed at the Grok webview.
        assert!(parse_grok_link("javascript:alert(1)").is_none());
        assert!(parse_grok_link("data:text/html,<script>alert(1)</script>").is_none());
        assert!(parse_grok_link("file:///etc/passwd").is_none());
        assert!(parse_grok_link("http://grok.com/").is_none(), "plain http");
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
