//! The embedded Grok webview.
//!
//! Everything structural lives in `embedded_web.rs`; this module is the site
//! definition — where it opens, which hosts it will resume into, and which
//! links it takes from the clipboard.

use crate::embedded_web::{EmbeddedSite, ZOOM_DEFAULT_MILLI};
use std::sync::atomic::{AtomicBool, AtomicU32};
use tauri::{AppHandle, Url};

static VISIBLE: AtomicBool = AtomicBool::new(false);
static ZOOM: AtomicU32 = AtomicU32::new(ZOOM_DEFAULT_MILLI);

static GROK: EmbeddedSite = EmbeddedSite {
    label: "grok",
    display_name: "Grok",
    home_url: "https://grok.com/",
    close_url: "https://local-gallery.invalid/close-grok",
    is_restorable: is_restorable_url,
    parse_clipboard_link: parse_grok_link,
    visible: &VISIBLE,
    zoom: &ZOOM,
};

/// Exposed so the shared module can assert the two sites stay distinct.
#[cfg(test)]
pub fn site() -> &'static EmbeddedSite {
    &GROK
}

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

/// x.com is included because the sign-in flow lives there.
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

pub fn save_grok_url(app: &AppHandle) {
    GROK.save_url(app);
}

pub fn sync_grok_bounds(app: &AppHandle) {
    GROK.sync_bounds(app);
}

/// Toggles the Grok child webview. Returns true when it ends up visible.
#[tauri::command]
pub fn toggle_grok_window(app: AppHandle, close_key: Option<String>) -> Result<bool, String> {
    GROK.toggle(&app, close_key)
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
        assert!(!restorable(GROK.close_url));
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
        // The other embedded site must not be able to hijack this window.
        assert!(parse_grok_link("https://claude.ai/chat/abc-123").is_none());
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
}
