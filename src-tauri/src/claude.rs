//! The embedded Claude webview.
//!
//! The Grok window's twin (see `grok.rs`), on its own keybind and with its own
//! saved location. Everything structural lives in `embedded_web.rs`; this
//! module is the site definition — where it opens, which hosts it will resume
//! into, and which links it takes from the clipboard.

use crate::embedded_web::{EmbeddedSite, ZOOM_DEFAULT_MILLI};
use std::sync::atomic::{AtomicBool, AtomicU32};
use tauri::{AppHandle, Url};

static VISIBLE: AtomicBool = AtomicBool::new(false);
static ZOOM: AtomicU32 = AtomicU32::new(ZOOM_DEFAULT_MILLI);

static CLAUDE: EmbeddedSite = EmbeddedSite {
    label: "claude",
    display_name: "Claude",
    home_url: "https://claude.ai/",
    close_url: "https://local-gallery.invalid/close-claude",
    is_restorable: is_restorable_url,
    parse_clipboard_link: parse_claude_link,
    visible: &VISIBLE,
    zoom: &ZOOM,
};

/// Exposed so the shared module can assert the two sites stay distinct.
#[cfg(test)]
pub fn site() -> &'static EmbeddedSite {
    &CLAUDE
}

fn is_claude_host(url: &Url) -> bool {
    match url.host_str() {
        // The leading-dot checks are what stop a lookalike like
        // claude.ai.evil.com matching on a bare suffix test.
        Some(host) => {
            let host = host.trim_start_matches("www.");
            host == "claude.ai" || host.ends_with(".claude.ai")
        }
        None => false,
    }
}

fn is_anthropic_host(url: &Url) -> bool {
    match url.host_str() {
        Some(host) => {
            let host = host.trim_start_matches("www.");
            host == "anthropic.com" || host.ends_with(".anthropic.com")
        }
        None => false,
    }
}

/// anthropic.com is included for the same reason Grok allows x.com: the account
/// and sign-in flow can land there, and a session left mid-login should resume
/// rather than be thrown back to the home page. Third-party identity providers
/// (Google and the like) are deliberately *not* restorable — a session is
/// resumed into Claude, never into someone else's login screen.
fn is_restorable_url(url: &Url) -> bool {
    url.scheme() == "https" && (is_claude_host(url) || is_anthropic_host(url))
}

/// A Claude link sitting in the clipboard, if there is one.
///
/// The escape hatch, same as Grok's: copy a Claude conversation or share URL
/// anywhere, hit the toggle, and the window opens there instead of the saved
/// location. Nothing to configure and nothing to clear afterwards.
///
/// Deliberately narrower than `is_restorable_url`, which also allows
/// anthropic.com so a half-finished sign-in can resume. Here anthropic.com
/// would mean any copied docs or blog link hijacks the window, so this is
/// claude.ai only. https only, too: a `javascript:`, `data:` or `file:` URL
/// would otherwise be a script-injection or local-file-read primitive aimed at
/// a webview that runs our init script — and the clipboard is not a trusted
/// source, it is whatever was copied last.
fn parse_claude_link(text: &str) -> Option<Url> {
    let url = Url::parse(text.trim()).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    if !is_claude_host(&url) {
        return None;
    }
    Some(url)
}

pub fn save_claude_url(app: &AppHandle) {
    CLAUDE.save_url(app);
}

pub fn sync_claude_bounds(app: &AppHandle) {
    CLAUDE.sync_bounds(app);
}

/// Toggles the Claude child webview. Returns true when it ends up visible.
#[tauri::command]
pub fn toggle_claude_window(app: AppHandle, close_key: Option<String>) -> Result<bool, String> {
    CLAUDE.toggle(&app, close_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn restorable(raw: &str) -> bool {
        is_restorable_url(&Url::parse(raw).expect("test url parses"))
    }

    #[test]
    fn restores_claude_https_urls() {
        assert!(restorable("https://claude.ai/"));
        assert!(restorable("https://claude.ai/new"));
        assert!(restorable("https://claude.ai/chat/abc-123"));
        assert!(restorable("https://www.claude.ai/"));
        // The account flow can land on anthropic.com, so it resumes too.
        assert!(restorable("https://console.anthropic.com/login"));
    }

    #[test]
    fn rejects_urls_we_should_not_resume_into() {
        // The close sentinel must never be persisted as a location.
        assert!(!restorable(CLAUDE.close_url));
        assert!(
            !restorable("http://claude.ai/"),
            "plain http is not restorable"
        );
        assert!(!restorable("https://evil.com/"));
        // A third-party sign-in screen is not a place to resume into.
        assert!(!restorable("https://accounts.google.com/o/oauth2/auth"));
        // Suffix matching must not be fooled by a lookalike host.
        assert!(!restorable("https://notclaude.ai/"));
        assert!(!restorable("https://claude.ai.evil.com/"));
        assert!(!restorable("file:///etc/passwd"));
    }

    #[test]
    fn clipboard_takes_claude_links() {
        assert!(parse_claude_link("https://claude.ai/chat/abc-123").is_some());
        assert!(parse_claude_link("https://claude.ai/share/abc-123").is_some());
        assert!(parse_claude_link("https://claude.ai/").is_some());
        assert!(parse_claude_link("https://www.claude.ai/new").is_some());
        // Copied text picks up stray whitespace and newlines constantly.
        assert!(parse_claude_link("  https://claude.ai/chat/x\n").is_some());
    }

    #[test]
    fn clipboard_ignores_everything_else() {
        // The overwhelmingly common case: the clipboard holds something that is
        // not a link at all, and the toggle must just open normally.
        assert!(parse_claude_link("").is_none());
        assert!(parse_claude_link("some copied prose").is_none());
        assert!(parse_claude_link("/Users/jo/Pictures/cat.png").is_none());
        assert!(parse_claude_link("https://example.com/").is_none());
        // anthropic.com is restorable (the account flow lives there) but must
        // NOT be taken from the clipboard, or every copied docs link hijacks
        // the window.
        assert!(parse_claude_link("https://www.anthropic.com/news").is_none());
        // The other embedded site must not be able to hijack this window.
        assert!(parse_claude_link("https://grok.com/chat/abc-123").is_none());
        // Lookalike hosts a bare suffix test would wrongly accept.
        assert!(parse_claude_link("https://claude.ai.evil.com/").is_none());
        assert!(parse_claude_link("https://notclaude.ai/").is_none());
        // The clipboard is untrusted input; these schemes would be a script
        // injection or local-file read aimed at the Claude webview.
        assert!(parse_claude_link("javascript:alert(1)").is_none());
        assert!(parse_claude_link("data:text/html,<script>alert(1)</script>").is_none());
        assert!(parse_claude_link("file:///etc/passwd").is_none());
        assert!(parse_claude_link("http://claude.ai/").is_none(), "plain http");
    }
}
