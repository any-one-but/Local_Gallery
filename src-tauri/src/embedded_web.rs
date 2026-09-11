//! The embedded site webviews.
//!
//! Grok (`grok.rs`) and Claude (`claude.rs`) are the same window with different
//! hosts, so the machinery lives here and each module contributes only its
//! `EmbeddedSite`: label, home URL, which hosts it will resume into, and which
//! links it will take from the clipboard.
//!
//! Each is a child webview loading the site inside the main app window. It is a
//! real top-level document, not an iframe: these hosts send `frame-ancestors`,
//! and WKWebView gives us no way to strip response headers, so framing is out.
//!
//! The webviews are deliberately *not* on the IPC bridge. See
//! embedded-inject.js for why, and for how the close sentinel works.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    webview::{NewWindowFeatures, NewWindowResponse, WebviewBuilder},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, Webview, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Wry,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

const MAIN_LABEL: &str = "main";

/// Sign-in popups get their own OS window, and it has to be able to close
/// itself: WebKit's `webViewDidClose:` is not wired up, so `window.close()` —
/// which is how every OAuth flow ends — does nothing on its own. Same cancelled
/// navigation trick as the embedded windows use.
const POPUP_CLOSE_URL: &str = "https://local-gallery.invalid/close-signin-popup";

/// Labels have to be unique for the lifetime of the app, and a sign-in popup
/// can be opened any number of times.
static POPUP_SEQ: AtomicUsize = AtomicUsize::new(0);

/// Where the injected script asks for a zoom change. Same cancelled-navigation
/// channel as the close sentinel, for the same reason: the page must be able to
/// reach us without an IPC bridge.
///
/// The page sends only *what happened* — `?d=up|down|reset` for the keyboard,
/// `?s=<ratio>` for a pinch — never a zoom level. Rust owns the current value,
/// so a page reload (which re-runs the init script from scratch) cannot leave
/// the page's idea of the zoom out of step with the webview's.
const ZOOM_URL: &str = "https://local-gallery.invalid/zoom";

/// Where the injected script asks for a *different* embedded window. Same
/// cancelled-navigation channel as close and zoom, for the same reason: a
/// focused child webview swallows every key, so the main window never sees the
/// other two toggles and the page has to ask on the user's behalf.
const SWITCH_URL: &str = "https://local-gallery.invalid/open";

/// A heartbeat on the sentinel channel was tried here and **must not come
/// back**. One cancelled navigation every 5s destroyed the page: claude.ai came
/// back with `readyState` "complete" and no body element at all, and none of
/// its subframes ever loaded — a window that stayed white forever. Cancelling
/// at the policy stage does not undo the teardown WebKit has already begun, and
/// a page doing its own navigations cannot survive one arriving on a timer. The
/// channel is safe for the close, zoom and switch sentinels because those are
/// user gestures: occasional, and landing between the page's own work.
///
/// So Grok and Claude do not report liveness, and the watchdog below never
/// touches them — a window that has never beaten is never reloaded. Their way
/// out of a wedged page is the native menu item (Shift+Cmd+W). Only Variations
/// beats, through the IPC bridge it already has, which involves no navigation.

/// The three embedded windows, by webview label. The order is the order they
/// are offered in and has no other meaning.
pub const EMBEDDED_LABELS: [&str; 3] = ["grok", "claude", "variations"];

/// Last time each embedded page checked in, and last time we reloaded it.
/// Indexed by position in `EMBEDDED_LABELS` — a fixed array rather than a map
/// so both can be `const`-constructed statics.
static EMBEDDED_BEATS: Mutex<[Option<Instant>; 3]> = Mutex::new([None; 3]);
static EMBEDDED_RELOADS: Mutex<[Option<Instant>; 3]> = Mutex::new([None; 3]);

/// How often an embedded page is expected to check in.
const BEAT_INTERVAL: Duration = Duration::from_secs(5);
/// Silence longer than this, on the window actually in front of the user, means
/// the page is gone. Deliberately far longer than the main window's 30s: these
/// are third-party pages doing heavy work, and a reload that lands on a reply
/// still being written would cost more than the wait. A page that has not run a
/// timer in a full minute is not busy, it is dead.
const BEAT_DEADLINE: Duration = Duration::from_secs(60);
/// If a reload does not bring the page back, hammering it makes things worse.
const RELOAD_COOLDOWN: Duration = Duration::from_secs(180);

fn label_index(label: &str) -> Option<usize> {
    EMBEDDED_LABELS.iter().position(|l| *l == label)
}

/// "Still alive", from one of the embedded pages.
pub fn record_embedded_beat(label: &str) {
    let Some(i) = label_index(label) else { return };
    if let Ok(mut beats) = EMBEDDED_BEATS.lock() {
        beats[i] = Some(Instant::now());
    }
}

/// Forget a page's beat, so a window that was just shown or reloaded gets a
/// full deadline to come up rather than inheriting the silence that preceded it.
pub fn reset_embedded_beat(label: &str) {
    let Some(i) = label_index(label) else { return };
    if let Ok(mut beats) = EMBEDDED_BEATS.lock() {
        beats[i] = None;
    }
}

/// True when this page has checked in at least once and then gone quiet past
/// the deadline. Records the reload as it answers, so the caller just acts.
fn embedded_page_is_gone(label: &str) -> bool {
    let Some(i) = label_index(label) else {
        return false;
    };
    let Ok(beats) = EMBEDDED_BEATS.lock() else {
        return false;
    };
    // Never seen a beat: the page may simply not run our script (an error page,
    // a PDF, a download). Reloading those forever would be worse than leaving
    // them, and the menu item is still the way out.
    let Some(beat) = beats[i] else {
        return false;
    };
    if beat.elapsed() < BEAT_DEADLINE {
        return false;
    }
    drop(beats);
    let Ok(mut reloads) = EMBEDDED_RELOADS.lock() else {
        return false;
    };
    if let Some(last) = reloads[i] {
        if last.elapsed() < RELOAD_COOLDOWN {
            return false;
        }
    }
    reloads[i] = Some(Instant::now());
    true
}

/// A heartbeat from Variations, which is on the IPC bridge and so does not need
/// the sentinel channel Grok and Claude use.
#[tauri::command]
pub fn embedded_heartbeat(label: String) {
    record_embedded_beat(&label);
}

/// Brings back an embedded page that has stopped answering.
///
/// Only ever acts on the window actually in front of the user, and only while
/// the app is focused: WebKit throttles a background page's timers hard, and a
/// missed beat there means nothing. Reloading is the documented recovery for a
/// WKWebView whose web content process has died, and it is also the only thing
/// that helps a page that has wedged its own main thread.
pub fn spawn_embedded_watchdog(handle: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(BEAT_INTERVAL);
        // `get_window`, never `get_webview_window`: the latter answers None for
        // a window holding more than one webview, which is every window that
        // has ever opened one of these. See session.rs for the same trap.
        let Some(window) = handle.get_window(MAIN_LABEL) else {
            continue;
        };
        let Some(label) = crate::visible_embedded_label() else {
            continue;
        };
        let focused = window.is_focused().unwrap_or(false);
        if !focused {
            // Not being looked at: keep the clock honest rather than banking
            // silence that would fire the moment the user comes back.
            record_embedded_beat(label);
            continue;
        }
        if !embedded_page_is_gone(label) {
            continue;
        }
        reset_embedded_beat(label);
        if let Some(webview) = handle.get_webview(label) {
            let _ = webview.reload();
        }
    });
}

/// The app's current bindings for the three embedded-window toggles.
///
/// Held centrally rather than threaded through each call because *any* of the
/// three pages may ask to open *any* other: whichever window is up has to be
/// handed all three combos, and the window it hands over to needs its own combo
/// baked in even though the request did not come from the main page. The main
/// page re-sends the whole set on every toggle, so this cannot go stale after a
/// rebind.
static SITE_KEYS: Mutex<Option<SiteKeys>> = Mutex::new(None);

/// Sent by the main page with every toggle. Missing fields mean "unbound".
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteKeys {
    #[serde(default)]
    pub grok: String,
    #[serde(default)]
    pub claude: String,
    #[serde(default)]
    pub variations: String,
}

impl SiteKeys {
    fn get(&self, label: &str) -> &str {
        match label {
            "grok" => &self.grok,
            "claude" => &self.claude,
            "variations" => &self.variations,
            _ => "",
        }
    }
}

/// Record the bindings the main page just sent. Ignores `None` so a caller that
/// has nothing to say cannot blank a set we already have.
pub fn remember_site_keys(keys: Option<SiteKeys>) {
    let Some(keys) = keys else { return };
    if let Ok(mut slot) = SITE_KEYS.lock() {
        *slot = Some(keys);
    }
}

fn site_keys() -> SiteKeys {
    SITE_KEYS
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .unwrap_or_default()
}

/// This window's own toggle binding, for when a *different* window asked us to
/// open and there is no `close_key` argument to take it from.
pub fn remembered_key_for(label: &str) -> Option<String> {
    let keys = site_keys();
    let key = keys.get(label).to_string();
    if key.is_empty() {
        None
    } else {
        Some(key)
    }
}

/// The other windows' bindings, as a JS object literal keyed by label. Empty
/// bindings are dropped, so an unbound toggle simply is not offered.
pub fn switch_keys_json(own_label: &str) -> String {
    let keys = site_keys();
    let pairs: Vec<(&str, &str)> = EMBEDDED_LABELS
        .iter()
        .copied()
        .filter(|label| *label != own_label)
        .map(|label| (label, keys.get(label)))
        .filter(|(_, key)| !key.is_empty())
        .collect();
    let map: std::collections::BTreeMap<&str, &str> = pairs.into_iter().collect();
    serde_json::to_string(&map).unwrap_or_else(|_| "{}".into())
}

/// The window a switch sentinel is asking for, if it names a real one. Anything
/// else is dropped rather than guessed at.
fn switch_target_from_sentinel(url: &Url) -> Option<&'static str> {
    let wanted = url
        .query_pairs()
        .find(|(k, _)| k == "to")
        .map(|(_, v)| v.into_owned())?;
    EMBEDDED_LABELS
        .iter()
        .copied()
        .find(|label| *label == wanted.as_str())
}

/// Zoom stops, matching what a browser's Cmd +/- walks through.
const ZOOM_STEPS: &[f64] = &[
    0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
];
const ZOOM_MIN: f64 = 0.5;
const ZOOM_MAX: f64 = 3.0;
/// Zoom is stored as thousandths so it fits an atomic and a short file.
const ZOOM_SCALE: f64 = 1000.0;
pub const ZOOM_DEFAULT_MILLI: u32 = 1000;

/// One embedded site. Instances are `static`, one per module.
pub struct EmbeddedSite {
    /// Webview label, and the stem of its saved-URL file.
    pub label: &'static str,
    /// Human name, used only in error messages.
    pub display_name: &'static str,
    /// Where the window opens when there is nothing saved.
    pub home_url: &'static str,
    /// Navigating here is the injected script's way of asking to be closed. The
    /// navigation is always cancelled; `.invalid` is reserved by RFC 2606 and
    /// can never resolve, so this cannot leak to a real host if the handler
    /// regresses. Each site needs its own so the sentinel identifies the window.
    pub close_url: &'static str,
    /// Hosts we are willing to restore into on the next launch. Anything else —
    /// an OAuth callback, an error page, some redirector — is dropped in favour
    /// of the last good URL, so a session can't be resumed into a dead end.
    pub is_restorable: fn(&Url) -> bool,
    /// A link to this site sitting in the clipboard, if there is one. Always
    /// narrower than `is_restorable`: see the per-site implementations.
    pub parse_clipboard_link: fn(&str) -> Option<Url>,
    /// Whether the webview is currently shown. Hidden is not the same as gone —
    /// the webview is kept alive so the session survives toggling.
    pub visible: &'static AtomicBool,
    /// Current page zoom in thousandths (1000 = 100%). The authoritative copy:
    /// the page holds no zoom state of its own.
    pub zoom: &'static AtomicU32,
}

/// The globals handed to the injected script, as JS assignments.
///
/// An embedded webview swallows every key while focused, so the app's own
/// binding can never reach the main webview to toggle it off — the page has to
/// know the combo itself, and likewise has to know where to send a zoom
/// request. Injected as globals rather than invoked over IPC.
fn page_prelude(close_url: &str, close_key: Option<&str>, own_label: &str) -> String {
    let key = close_key.unwrap_or("");
    let key_json = serde_json::to_string(key).unwrap_or_else(|_| "\"\"".into());
    let url_json = serde_json::to_string(close_url).unwrap_or_else(|_| "\"\"".into());
    let zoom_json = serde_json::to_string(ZOOM_URL).unwrap_or_else(|_| "\"\"".into());
    let switch_json = serde_json::to_string(SWITCH_URL).unwrap_or_else(|_| "\"\"".into());
    let switch_keys = switch_keys_json(own_label);
    format!(
        "window.__lgEmbedCloseKey={key_json};window.__lgEmbedCloseUrl={url_json};\
         window.__lgEmbedZoomUrl={zoom_json};window.__lgEmbedSwitchUrl={switch_json};\
         window.__lgEmbedSwitchKeys={switch_keys};"
    )
}

fn clamp_zoom(zoom: f64) -> f64 {
    if !zoom.is_finite() {
        return 1.0;
    }
    // Rounded to thousandths so it round-trips through the stored integer.
    (zoom.clamp(ZOOM_MIN, ZOOM_MAX) * ZOOM_SCALE).round() / ZOOM_SCALE
}

fn zoom_step_up(current: f64) -> f64 {
    ZOOM_STEPS
        .iter()
        .copied()
        .find(|step| *step > current + 0.001)
        .unwrap_or(ZOOM_MAX)
}

fn zoom_step_down(current: f64) -> f64 {
    ZOOM_STEPS
        .iter()
        .copied()
        .rev()
        .find(|step| *step < current - 0.001)
        .unwrap_or(ZOOM_MIN)
}

/// The zoom a sentinel navigation is asking for, given where we are now.
///
/// `d=up|down|reset` is the keyboard walking the stops; `s=<ratio>` is a pinch,
/// which multiplies rather than steps so the gesture stays continuous. The
/// ratio is untrusted page input, so a nonsensical one yields no change.
fn zoom_from_sentinel(url: &Url, current: f64) -> Option<f64> {
    let mut next = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "d" => {
                next = match value.as_ref() {
                    "up" => Some(zoom_step_up(current)),
                    "down" => Some(zoom_step_down(current)),
                    "reset" => Some(1.0),
                    _ => None,
                }
            }
            "s" => {
                let ratio: f64 = value.parse().ok()?;
                if !ratio.is_finite() || ratio <= 0.0 || ratio > 10.0 {
                    return None;
                }
                next = Some(current * ratio);
            }
            _ => {}
        }
    }
    let next = clamp_zoom(next?);
    if (next - current).abs() < 0.0005 {
        return None;
    }
    Some(next)
}

/// Child webview bounds are relative to the main window's content area.
fn main_content_bounds(app: &AppHandle) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let main = app.get_window(MAIN_LABEL)?;
    Some((PhysicalPosition::new(0, 0), main.inner_size().ok()?))
}

fn place_inside_main(app: &AppHandle, webview: &Webview) {
    if let Some((pos, size)) = main_content_bounds(app) {
        let _ = webview.set_position(pos);
        let _ = webview.set_size(size);
    }
}

fn host_matches(url: &Url, domain: &str) -> bool {
    match url.host_str() {
        // The leading dot is what stops a lookalike like accounts.google.com.evil.com
        // matching on a bare suffix test.
        Some(host) => host == domain || host.ends_with(&format!(".{domain}")),
        None => false,
    }
}

/// The URL that may *open* a sign-in popup.
///
/// Deliberately just the two providers' entry points. Both sites sign in with
/// Google or Apple, and "Continue with Google" is not a link — it is Google
/// Identity Services calling `window.open(...&display=popup...)`. WKWebView
/// creates no window for that unless something answers the request, which is
/// why the button did nothing at all before this existed.
fn is_sign_in_entry_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    matches!(
        url.host_str(),
        Some("accounts.google.com") | Some("appleid.apple.com")
    )
}

/// Where an already-open sign-in popup may navigate.
///
/// Wider than the entry point, because a real sign-in walks through several
/// hosts (consent, 2FA, passkeys) before it lands, but still a fixed
/// allowlist — see `build_sign_in_popup` for why this window in particular
/// must not wander onto an arbitrary origin.
fn is_sign_in_provider_url(url: &Url) -> bool {
    url.scheme() == "https" && (host_matches(url, "google.com") || host_matches(url, "apple.com"))
}

/// Safari's version, from the copy installed on this Mac.
///
/// Read at runtime rather than hardcoded because this string is exactly what
/// Google inspects when it decides whether a sign-in is happening in a real
/// browser or an embedded webview, and a frozen version number rots.
#[cfg(target_os = "macos")]
fn installed_safari_version() -> Option<String> {
    let out = std::process::Command::new("/usr/bin/defaults")
        .args([
            "read",
            "/Applications/Safari.app/Contents/Info",
            "CFBundleShortVersionString",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    sanitize_safari_version(&String::from_utf8_lossy(&out.stdout))
}

/// Only a dotted version number survives — the value ends up in a request
/// header, so anything else is dropped in favour of the fallback.
fn sanitize_safari_version(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 12 {
        return None;
    }
    if !trimmed.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    if !trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(trimmed.to_string())
}

/// The platform token is frozen at 10_15_7 in every modern Safari UA, and the
/// AppleWebKit/605.1.15 build number is what WKWebView already reports; the
/// only thing missing from WKWebView's default is the Version/… Safari/… tail,
/// which is precisely the "this is an embedded webview" tell.
fn format_safari_user_agent(version: &str) -> String {
    format!(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
         (KHTML, like Gecko) Version/{version} Safari/605.1.15"
    )
}

/// Used if Safari.app cannot be read. Kept plausible rather than current: it
/// only has to look like a browser, and it is superseded by the real value on
/// any normal machine.
#[cfg(target_os = "macos")]
const SAFARI_VERSION_FALLBACK: &str = "18.6";

#[cfg(target_os = "macos")]
fn safari_user_agent() -> String {
    format_safari_user_agent(
        &installed_safari_version().unwrap_or_else(|| SAFARI_VERSION_FALLBACK.to_string()),
    )
}

/// Injected into sign-in popups only.
///
/// `window.close()` is how every OAuth popup ends, and WebKit's close request
/// is not wired through to the window here, so the popup would sit there
/// blank after a successful sign-in. Redirect it through the sentinel the Rust
/// side cancels and turns into a real close. Esc does the same, matching the
/// embedded windows.
const POPUP_INJECT: &str = r#"(function(){
  "use strict";
  var CLOSE_URL = "https://local-gallery.invalid/close-signin-popup";
  function requestClose() {
    try { window.location.href = CLOSE_URL; } catch (e) { /* cancelled by Rust */ }
  }
  try { window.close = requestClose; } catch (e) { /* not writable; Esc still works */ }
  window.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    requestClose();
  }, true);
})();"#;

impl EmbeddedSite {
    fn config_file(&self, app: &AppHandle, suffix: &str) -> Result<PathBuf, String> {
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|e| format!("no config dir: {e}"))?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir config: {e}"))?;
        Ok(dir.join(format!("{}-{suffix}.txt", self.label)))
    }

    fn url_file(&self, app: &AppHandle) -> Result<PathBuf, String> {
        self.config_file(app, "last-url")
    }

    fn current_zoom(&self) -> f64 {
        f64::from(self.zoom.load(Ordering::Relaxed)) / ZOOM_SCALE
    }

    /// The zoom the window was last left at, remembered like its location.
    fn saved_zoom(&self, app: &AppHandle) -> f64 {
        let Ok(file) = self.config_file(app, "zoom") else {
            return 1.0;
        };
        let Ok(raw) = std::fs::read_to_string(&file) else {
            return 1.0;
        };
        raw.trim().parse::<f64>().map(clamp_zoom).unwrap_or(1.0)
    }

    /// Applies a new zoom to the live webview and remembers it.
    fn set_zoom(&self, app: &AppHandle, zoom: f64) {
        let zoom = clamp_zoom(zoom);
        self.zoom
            .store((zoom * ZOOM_SCALE).round() as u32, Ordering::Relaxed);
        if let Some(webview) = app.get_webview(self.label) {
            let _ = webview.set_zoom(zoom);
        }
        if let Ok(file) = self.config_file(app, "zoom") {
            let _ = std::fs::write(&file, format!("{zoom}"));
        }
    }

    /// Handles a zoom sentinel navigation. Returns false when it was one, which
    /// is also the answer the navigation handler needs: never actually go there.
    fn handle_zoom_navigation(&self, app: &AppHandle, url: &Url) -> bool {
        if let Some(next) = zoom_from_sentinel(url, self.current_zoom()) {
            self.set_zoom(app, next);
        }
        false
    }

    /// The URL the window was last left on, if it still looks sane.
    fn saved_url(&self, app: &AppHandle) -> Option<Url> {
        let file = self.url_file(app).ok()?;
        let raw = std::fs::read_to_string(&file).ok()?;
        let url = Url::parse(raw.trim()).ok()?;
        if (self.is_restorable)(&url) {
            Some(url)
        } else {
            None
        }
    }

    fn clipboard_link(&self, app: &AppHandle) -> Option<Url> {
        let text = app.clipboard().read_text().ok()?;
        (self.parse_clipboard_link)(&text)
    }

    /// Records where the webview currently is, so the next session reopens there.
    ///
    /// Reads the live webview URL rather than tracking navigations: these are
    /// SPAs and move between conversations with pushState, which
    /// `on_navigation` never sees, but WKWebView's `url` does reflect.
    pub fn save_url(&self, app: &AppHandle) {
        let Some(webview) = app.get_webview(self.label) else {
            return;
        };
        let Ok(url) = webview.url() else {
            return;
        };
        if !(self.is_restorable)(&url) {
            return;
        }
        let Ok(file) = self.url_file(app) else {
            return;
        };
        let _ = std::fs::write(&file, url.as_str());
    }

    /// Keep the child webview covering the app content after main-window size
    /// changes. Moves do not matter for a child webview, but the caller may
    /// send them and this remains harmless.
    pub fn sync_bounds(&self, app: &AppHandle) {
        if !self.visible.load(Ordering::Relaxed) {
            return;
        }
        let Some(webview) = app.get_webview(self.label) else {
            return;
        };
        place_inside_main(app, &webview);
    }

    fn hide(&self, app: &AppHandle) {
        self.hide_inner(app, true);
    }

    /// Close this window and hand the keyboard back to the gallery. The native
    /// menu item's route out, which is the one that still works when the page
    /// itself has stopped answering.
    pub fn hide_now(&self, app: &AppHandle) {
        if !self.visible.load(Ordering::Relaxed) {
            return;
        }
        self.hide(app);
    }

    /// Step aside for another embedded window. Same as `hide`, minus handing the
    /// keyboard back to the gallery: the window taking over is about to take
    /// focus, and a main-window focus in between reads as a flicker.
    pub fn hide_for_handover(&self, app: &AppHandle) {
        if !self.visible.load(Ordering::Relaxed) {
            return;
        }
        self.hide_inner(app, false);
    }

    fn hide_inner(&self, app: &AppHandle, refocus_main: bool) {
        self.save_url(app);
        if let Some(webview) = app.get_webview(self.label) {
            let _ = webview.hide();
        }
        self.visible.store(false, Ordering::Relaxed);
        if !refocus_main {
            return;
        }
        if let Some(main) = app.get_window(MAIN_LABEL) {
            let _ = main.set_focus();
        }
        if let Some(main_webview) = app.get_webview(MAIN_LABEL) {
            let _ = main_webview.set_focus();
        }
    }

    /// Answers `window.open`.
    ///
    /// Two very different callers end up here, and they get two very different
    /// windows:
    ///
    /// * A **sign-in popup**, which is the only reason this handler exists.
    ///   Those get a Tauri-built window (`build_sign_in_popup`) because we need
    ///   control over it: the Safari user agent, and a way to honour
    ///   `window.close()`.
    /// * **Anything else** — a link the page opened with `target="_blank"`,
    ///   which on these sites can be a URL the model wrote — gets `Allow`,
    ///   wry's own plain window. That is a raw WKWebView living outside Tauri
    ///   entirely: no label, no capability, no IPC bridge to leak. A page we do
    ///   not control must never be handed a Tauri webview.
    fn on_new_window(
        &'static self,
        app: &AppHandle,
        url: Url,
        features: NewWindowFeatures,
    ) -> NewWindowResponse<Wry> {
        if !is_sign_in_entry_url(&url) {
            return NewWindowResponse::Allow;
        }
        match self.build_sign_in_popup(app, features) {
            Ok(window) => NewWindowResponse::Create { window },
            // A popup we could not build is worse than a plain one: without a
            // window the sign-in button silently does nothing again.
            Err(_) => NewWindowResponse::Allow,
        }
    }

    /// The window an OAuth popup runs in.
    ///
    /// `window_features` carries the size and position the page asked for and,
    /// on macOS, the opener's `WKWebViewConfiguration` — which is mandatory:
    /// without it the popup is not related to the page that opened it, and the
    /// `postMessage` back to the opener that finishes the sign-in never
    /// arrives.
    ///
    /// This window *is* a Tauri webview, so its navigation is kept inside a
    /// provider allowlist plus the site's own hosts (the callback lands there).
    /// The capability is scoped by webview label and this label is not in it,
    /// so the ACL should already refuse every command — the allowlist is the
    /// second lock, and the reason the wide-open case above goes to `Allow`.
    fn build_sign_in_popup(
        &'static self,
        app: &AppHandle,
        features: NewWindowFeatures,
    ) -> Result<WebviewWindow, String> {
        let label = format!(
            "{}-signin-{}",
            self.label,
            POPUP_SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let nav_handle = app.clone();
        let nav_label = label.clone();
        let blank = Url::parse("about:blank").expect("about:blank parses");

        #[allow(unused_mut)]
        let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
            .window_features(features)
            .title(format!("{} sign-in", self.display_name))
            .initialization_script(POPUP_INJECT)
            .on_navigation(move |url| {
                if url.as_str().starts_with(POPUP_CLOSE_URL) {
                    if let Some(window) = nav_handle.get_webview_window(&nav_label) {
                        let _ = window.close();
                    }
                    // Hand the keyboard back, or the embedded window is up with
                    // nothing listening to it.
                    if let Some(webview) = nav_handle.get_webview(self.label) {
                        let _ = webview.set_focus();
                    }
                    return false;
                }
                match url.scheme() {
                    // about:blank is the window's own starting point, and a
                    // custom scheme (storagerelay: and friends) never loads a
                    // document that could reach the bridge.
                    "http" | "https" => {
                        is_sign_in_provider_url(url) || (self.is_restorable)(url)
                    }
                    _ => true,
                }
            });

        #[cfg(target_os = "macos")]
        {
            builder = builder.user_agent(&safari_user_agent());
        }

        builder
            .build()
            .map_err(|e| format!("building {} sign-in popup failed: {e}", self.display_name))
    }

    fn build(
        &'static self,
        app: &AppHandle,
        close_key: Option<&str>,
        override_url: Option<Url>,
    ) -> Result<(), String> {
        let main = app
            .get_window(MAIN_LABEL)
            .ok_or_else(|| "main window missing".to_string())?;

        // Clipboard link beats the saved location beats the default.
        let url = override_url
            .or_else(|| self.saved_url(app))
            .unwrap_or_else(|| {
                Url::parse(self.home_url).expect("home_url is a compile-time constant and parses")
            });

        let nav_handle = app.clone();
        let popup_handle = app.clone();
        let close_url = self.close_url;
        #[allow(unused_mut)]
        let mut builder = WebviewBuilder::new(self.label, WebviewUrl::External(url))
            .initialization_script(page_prelude(self.close_url, close_key, self.label))
            .initialization_script(include_str!("../../embedded-inject.js"))
            .on_navigation(move |url| {
                if url.as_str().starts_with(ZOOM_URL) {
                    return self.handle_zoom_navigation(&nav_handle, url);
                }
                if url.as_str().starts_with(SWITCH_URL) {
                    // Hand over to another embedded window. Always cancelled,
                    // whether or not the target parses: a sentinel must never
                    // become a real navigation.
                    if let Some(target) = switch_target_from_sentinel(url) {
                        let _ = crate::show_embedded_window(&nav_handle, target);
                    }
                    return false;
                }
                if !url.as_str().starts_with(close_url) {
                    return true;
                }
                self.hide(&nav_handle);
                false
            })
            .on_new_window(move |url, features| self.on_new_window(&popup_handle, url, features));

        // WKWebView's default user agent has no Version/… Safari/… tail, which
        // is how Google recognises an embedded webview and refuses to sign the
        // user in. This is the same engine Safari runs, so saying so is honest.
        #[cfg(target_os = "macos")]
        {
            builder = builder.user_agent(&safari_user_agent());
        }

        let (_, size) =
            main_content_bounds(app).ok_or_else(|| "main window bounds missing".to_string())?;
        let webview = main
            .add_child(builder, PhysicalPosition::new(0, 0), size)
            .map_err(|e| format!("building {} webview failed: {e}", self.display_name))?;

        place_inside_main(app, &webview);
        let _ = webview.set_auto_resize(true);

        // Zoom is remembered like the location is. WKWebView keeps `pageZoom`
        // across navigations, so this is the only place it needs applying.
        let zoom = self.saved_zoom(app);
        self.zoom
            .store((zoom * ZOOM_SCALE).round() as u32, Ordering::Relaxed);
        if (zoom - 1.0).abs() > 0.0005 {
            let _ = webview.set_zoom(zoom);
        }

        self.visible.store(true, Ordering::Relaxed);
        webview.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Toggles the child webview. Returns true when it ends up visible.
    ///
    /// `close_key` is the app's current binding for this action, forwarded so
    /// the page can close itself with the same combo. The webview is built
    /// lazily and then kept alive and merely hidden, so the logged-in session
    /// and the open conversation survive toggling.
    ///
    /// A link to this site in the clipboard wins over the saved location, so
    /// copying a URL and hitting the toggle takes you straight there.
    pub fn toggle(&'static self, app: &AppHandle, close_key: Option<String>) -> Result<bool, String> {
        if self.visible.load(Ordering::Relaxed) && app.get_webview(self.label).is_some() {
            self.hide(app);
            return Ok(false);
        }
        self.show(app, close_key)?;
        Ok(true)
    }

    /// Opens the child webview, replacing whichever other embedded window was
    /// up. Never closes this one — that is `toggle`'s job — so it is safe to
    /// call from another window's handover.
    pub fn show(&'static self, app: &AppHandle, close_key: Option<String>) -> Result<bool, String> {
        let owned = close_key
            .filter(|k| !k.is_empty())
            .or_else(|| remembered_key_for(self.label));
        let key = owned.as_deref();

        // Only one embedded window is ever up: they cover the same rectangle,
        // so a second one behind the first is just an invisible page holding
        // the machine's attention.
        crate::hide_other_embedded_windows(app, self.label);
        // A window coming to the front gets a full deadline rather than
        // inheriting the silence of however long it sat hidden.
        reset_embedded_beat(self.label);

        if let Some(webview) = app.get_webview(self.label) {
            // The binding may have been rebound since the window was built, and
            // the baked-in prelude only reruns on a page load. eval is
            // one-directional (Rust -> page) and needs no IPC capability, so it
            // is safe here.
            let _ = webview.eval(page_prelude(self.close_url, key, self.label));

            // Only navigate if the clipboard points somewhere else: a link tends
            // to sit in the clipboard for a while, and re-navigating on every
            // toggle would reload the same page and throw away its scroll each
            // time.
            if let Some(url) = self.clipboard_link(app) {
                let already_there = webview.url().map(|current| current == url).unwrap_or(false);
                if !already_there {
                    // Save first — navigating drops the current location, which
                    // is still where the user was, so it stays the fallback.
                    self.save_url(app);
                    webview
                        .navigate(url)
                        .map_err(|e| format!("{} navigate: {e}", self.display_name))?;
                }
            }
            place_inside_main(app, &webview);
            webview.show().map_err(|e| e.to_string())?;
            self.visible.store(true, Ordering::Relaxed);
            webview.set_focus().map_err(|e| e.to_string())?;
            return Ok(true);
        }

        let target = self.clipboard_link(app);
        self.build(app, key, target)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_prelude_escapes_its_input() {
        // Only the head of the prelude is asserted: the tail carries the
        // hand-over globals, which are a shared static and belong to the test
        // below. What matters here is that a user-controlled binding lands in
        // the script JSON-encoded rather than pasted in raw.
        let head = |key: Option<&str>| {
            let full = page_prelude("https://local-gallery.invalid/close", key, "grok");
            let cut = full
                .find("window.__lgEmbedZoomUrl=")
                .expect("the zoom global always follows the close globals");
            full[..cut].to_string()
        };
        assert_eq!(
            head(Some("Cmd+g")),
            "window.__lgEmbedCloseKey=\"Cmd+g\";\
             window.__lgEmbedCloseUrl=\"https://local-gallery.invalid/close\";"
        );
        assert_eq!(
            head(None),
            "window.__lgEmbedCloseKey=\"\";\
             window.__lgEmbedCloseUrl=\"https://local-gallery.invalid/close\";"
        );
        assert_eq!(
            head(Some("\"});alert(1);//")),
            "window.__lgEmbedCloseKey=\"\\\"});alert(1);//\";\
             window.__lgEmbedCloseUrl=\"https://local-gallery.invalid/close\";"
        );
    }

    #[test]
    fn a_window_that_never_beat_is_never_reloaded() {
        // The page may simply not run our script — an error page, a PDF, a
        // download. Reloading one of those on a timer would be a loop the user
        // could not get out of, which is the thing this whole mechanism exists
        // to prevent.
        reset_embedded_beat("claude");
        assert!(!embedded_page_is_gone("claude"));
        // A fresh beat is not silence either.
        record_embedded_beat("claude");
        assert!(!embedded_page_is_gone("claude"));
        // And a label that is not one of ours is simply not our business.
        assert!(!embedded_page_is_gone("main"));
    }

    #[test]
    fn switch_sentinel_names_only_real_windows() {
        let target = |q: &str| switch_target_from_sentinel(&url(&format!("{SWITCH_URL}?{q}")));
        assert_eq!(target("to=grok"), Some("grok"));
        assert_eq!(target("to=claude"), Some("claude"));
        assert_eq!(target("to=variations"), Some("variations"));
        // The page is trusted less than the label list is: anything unknown is
        // dropped rather than guessed at, and the navigation is cancelled either
        // way so a bad target can never become a real page load.
        assert_eq!(target("to=main"), None);
        assert_eq!(target("to=grok-signin-0"), None);
        assert_eq!(target("to="), None);
        assert_eq!(target("to=%2Fetc%2Fpasswd"), None);
        assert_eq!(switch_target_from_sentinel(&url(SWITCH_URL)), None);
    }

    /// SITE_KEYS is a process-wide static and the test harness runs tests in
    /// parallel threads, so everything that writes it lives in this one test.
    #[test]
    fn hand_over_bindings_reach_the_other_windows_only() {
        remember_site_keys(Some(SiteKeys {
            grok: "Cmd+g".into(),
            claude: "Cmd+j".into(),
            variations: "Cmd+u".into(),
        }));
        assert_eq!(
            switch_keys_json("grok"),
            r#"{"claude":"Cmd+j","variations":"Cmd+u"}"#
        );
        assert_eq!(
            switch_keys_json("variations"),
            r#"{"claude":"Cmd+j","grok":"Cmd+g"}"#
        );
        assert_eq!(remembered_key_for("claude").as_deref(), Some("Cmd+j"));

        // The prelude carries them, and a window is never offered its own
        // binding as a hand-over target — that is its close key.
        let prelude = page_prelude("https://local-gallery.invalid/close", Some("Cmd+g"), "grok");
        assert!(prelude.contains(&format!("window.__lgEmbedSwitchUrl=\"{SWITCH_URL}\"")));
        assert!(prelude
            .contains(r#"window.__lgEmbedSwitchKeys={"claude":"Cmd+j","variations":"Cmd+u"}"#));
        assert!(!prelude.contains(r#""grok":"#));

        // An unbound toggle is simply not offered, rather than offered as a
        // combo that matches every bare keypress.
        remember_site_keys(Some(SiteKeys {
            grok: "Cmd+g".into(),
            claude: String::new(),
            variations: "Cmd+u".into(),
        }));
        assert_eq!(switch_keys_json("grok"), r#"{"variations":"Cmd+u"}"#);
        assert_eq!(remembered_key_for("claude"), None);

        // A caller with nothing to say must not blank the set.
        remember_site_keys(None);
        assert_eq!(remembered_key_for("grok").as_deref(), Some("Cmd+g"));
    }

    fn zoom_request(query: &str, current: f64) -> Option<f64> {
        zoom_from_sentinel(&url(&format!("{ZOOM_URL}?{query}")), current)
    }

    #[test]
    fn keyboard_zoom_walks_the_stops() {
        assert_eq!(zoom_request("d=up", 1.0), Some(1.1));
        assert_eq!(zoom_request("d=up", 1.1), Some(1.25));
        assert_eq!(zoom_request("d=down", 1.0), Some(0.9));
        assert_eq!(zoom_request("d=reset", 1.5), Some(1.0));
        // From a pinch's arbitrary level, a step lands on the next stop rather
        // than nudging by a fixed amount.
        assert_eq!(zoom_request("d=up", 1.13), Some(1.25));
        assert_eq!(zoom_request("d=down", 1.13), Some(1.1));
    }

    #[test]
    fn zoom_stops_at_the_ends() {
        assert_eq!(zoom_request("d=up", ZOOM_MAX), None, "already at the top");
        assert_eq!(zoom_request("d=down", ZOOM_MIN), None, "already at the bottom");
        assert_eq!(zoom_request("d=reset", 1.0), None, "already at 100%");
        // A pinch past the end clamps instead of running away.
        assert_eq!(zoom_request("s=4", 1.0), Some(ZOOM_MAX));
        assert_eq!(zoom_request("s=0.05", 1.0), Some(ZOOM_MIN));
    }

    #[test]
    fn pinch_ratios_multiply_the_current_zoom() {
        assert_eq!(zoom_request("s=1.5", 1.0), Some(1.5));
        assert_eq!(zoom_request("s=1.1", 2.0), Some(2.2));
        // Ratios compose, which is what lets the page throttle its messages.
        let once = zoom_request("s=1.2", 1.0).unwrap();
        assert_eq!(zoom_request("s=1.2", once), Some(1.44));
    }

    #[test]
    fn nonsense_zoom_requests_change_nothing() {
        // The query is page input: untrusted, and reachable by anything running
        // in that webview.
        assert_eq!(zoom_request("s=0", 1.0), None);
        assert_eq!(zoom_request("s=-2", 1.0), None);
        assert_eq!(zoom_request("s=1e9", 1.0), None);
        assert_eq!(zoom_request("s=NaN", 1.0), None);
        assert_eq!(zoom_request("s=abc", 1.0), None);
        assert_eq!(zoom_request("d=sideways", 1.0), None);
        assert_eq!(zoom_request("", 1.0), None);
        assert_eq!(zoom_from_sentinel(&url(ZOOM_URL), 1.0), None);
    }

    #[test]
    fn zoom_survives_the_round_trip_through_storage() {
        // Stored as thousandths, so every reachable value must be exact after a
        // save/load cycle or the stops drift.
        for step in ZOOM_STEPS {
            let milli = (step * ZOOM_SCALE).round() as u32;
            assert_eq!(clamp_zoom(f64::from(milli) / ZOOM_SCALE), *step);
        }
    }

    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("test url parses")
    }

    #[test]
    fn only_provider_sign_in_pages_may_open_a_popup() {
        // The URL Google Identity Services opens for "Continue with Google".
        assert!(is_sign_in_entry_url(&url(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&display=popup"
        )));
        assert!(is_sign_in_entry_url(&url("https://appleid.apple.com/auth/authorize")));
        // Everything else gets wry's plain window instead, with no bridge to
        // leak — including a link the page (or the model) opened.
        assert!(!is_sign_in_entry_url(&url("https://claude.ai/chat/abc")));
        assert!(!is_sign_in_entry_url(&url("https://example.com/")));
        assert!(!is_sign_in_entry_url(&url("http://accounts.google.com/")));
        // An exact-host test, so a lookalike cannot claim the privileged path.
        assert!(!is_sign_in_entry_url(&url("https://accounts.google.com.evil.com/")));
        assert!(!is_sign_in_entry_url(&url("https://evil.accounts.google.com.co/")));
    }

    #[test]
    fn an_open_popup_may_walk_the_provider_domains() {
        // A real sign-in crosses several hosts before it lands: consent, 2FA,
        // passkeys.
        assert!(is_sign_in_provider_url(&url("https://accounts.google.com/signin/v2/challenge")));
        assert!(is_sign_in_provider_url(&url("https://myaccount.google.com/")));
        assert!(is_sign_in_provider_url(&url("https://idmsa.apple.com/")));
        assert!(!is_sign_in_provider_url(&url("https://evil.com/")));
        assert!(!is_sign_in_provider_url(&url("http://accounts.google.com/")));
        // The suffix test must not be fooled by a lookalike.
        assert!(!is_sign_in_provider_url(&url("https://google.com.evil.com/")));
        assert!(!is_sign_in_provider_url(&url("https://notgoogle.com/")));
    }

    #[test]
    fn safari_user_agent_carries_the_version_and_safari_tokens() {
        // The tail is the whole point: WKWebView's default UA omits it, and its
        // absence is how Google spots an embedded webview.
        let ua = format_safari_user_agent("27.0");
        assert!(ua.ends_with("Version/27.0 Safari/605.1.15"), "{ua}");
        assert!(ua.starts_with("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "{ua}");
        assert!(!ua.contains('\n'), "a header value cannot span lines");
    }

    #[test]
    fn safari_version_is_sanitized_before_it_reaches_a_header() {
        assert_eq!(sanitize_safari_version("27.0\n"), Some("27.0".into()));
        assert_eq!(sanitize_safari_version(" 18.6 "), Some("18.6".into()));
        // Read from a file on disk, so it is not trusted blindly.
        assert_eq!(sanitize_safari_version(""), None);
        assert_eq!(sanitize_safari_version("27.0\r\nX-Evil: 1"), None);
        assert_eq!(sanitize_safari_version("Version 27"), None);
        assert_eq!(sanitize_safari_version(".27"), None);
        assert_eq!(sanitize_safari_version("1.2.3.4.5.6.7.8"), None);
    }

    #[test]
    fn each_site_keeps_its_own_sentinel_and_storage() {
        // Two windows sharing a close URL would let one close the other, and a
        // shared file would make them fight over the saved location.
        let grok = crate::grok::site();
        let claude = crate::claude::site();
        assert_ne!(grok.label, claude.label);
        assert_ne!(grok.close_url, claude.close_url);
    }
}
