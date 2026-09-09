//! Process-scoped session state, and the watchdog that keeps a wedged or
//! killed page from costing the user their passcode and their place.
//!
//! Background: the web layer is a single long-lived page. When macOS killed its
//! WebContent process (a jetsam report showed it at 15.5GB before the memory
//! leaks this module ships alongside were fixed), the window either went blank
//! and unresponsive — nothing to do but quit — or reloaded straight back to the
//! lock screen at the library root. Two symptoms, one cause, and the same cost
//! to the user either way.
//!
//! The leak fixes are the real repair. This is the belt: a page that dies or
//! wedges comes back on its own, already unlocked and already where it was.
//!
//! The unlock flag lives in *process* memory and nowhere else. Quitting the app
//! clears it, which is exactly what the passcode is for: it gates opening the
//! app, not reloading its page. Nothing here is written to disk.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// How often the page is expected to check in.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
/// Silence longer than this, while the window is focused, means the page is
/// gone or wedged. Generous next to the interval so an ordinary long frame — a
/// big folder scan, a heavy render — can never trip it.
const HEARTBEAT_DEADLINE: Duration = Duration::from_secs(30);
/// Never reload twice in quick succession: if a reload does not bring the page
/// back, hammering it makes things worse, not better.
const RELOAD_COOLDOWN: Duration = Duration::from_secs(90);

struct SessionState {
    /// The passcode has been satisfied at least once in this app run.
    unlocked: bool,
    /// Last browsing location the page reported, as opaque JSON.
    view: Option<String>,
    /// When the page last checked in. `None` until the first heartbeat, so a
    /// slow first paint is never mistaken for a hang.
    last_beat: Option<Instant>,
    last_reload: Option<Instant>,
    reloads: u32,
}

impl SessionState {
    const fn new() -> Self {
        Self {
            unlocked: false,
            view: None,
            last_beat: None,
            last_reload: None,
            reloads: 0,
        }
    }
}

static SESSION: Mutex<SessionState> = Mutex::new(SessionState::new());

#[derive(serde::Serialize)]
pub struct SessionStatus {
    /// Skip the launch gate: this app run has already been unlocked.
    unlocked: bool,
    /// The page has run before in this process, so this load is a reload.
    resuming: bool,
    /// How many times the watchdog has stepped in (diagnostics only).
    reloads: u32,
    /// The last reported browsing location, if any.
    view: Option<String>,
}

/// Read at page boot, before the library is opened.
#[tauri::command]
pub fn session_status() -> SessionStatus {
    let s = SESSION.lock().unwrap();
    SessionStatus {
        unlocked: s.unlocked,
        resuming: s.last_beat.is_some(),
        reloads: s.reloads,
        view: s.view.clone(),
    }
}

/// Set when the passcode is satisfied (or none is set); cleared by "Lock now".
#[tauri::command]
pub fn session_set_unlocked(unlocked: bool) {
    let mut s = SESSION.lock().unwrap();
    s.unlocked = unlocked;
    if !unlocked {
        s.view = None;
    }
}

/// The page's current browsing location, so a reload can land back on it.
#[tauri::command]
pub fn session_save_view(view: String) {
    let mut s = SESSION.lock().unwrap();
    s.view = if view.is_empty() { None } else { Some(view) };
}

/// "Still alive." Also the signal that the page has booted at least once.
#[tauri::command]
pub fn session_heartbeat() {
    let mut s = SESSION.lock().unwrap();
    s.last_beat = Some(Instant::now());
}

/// True when the page has gone quiet past the deadline and a reload is not on
/// cooldown. Records the reload as it answers, so the caller just acts on it.
fn should_reload_now() -> bool {
    let mut s = SESSION.lock().unwrap();
    let Some(beat) = s.last_beat else {
        return false;
    };
    if beat.elapsed() < HEARTBEAT_DEADLINE {
        return false;
    }
    if let Some(last) = s.last_reload {
        if last.elapsed() < RELOAD_COOLDOWN {
            return false;
        }
    }
    let now = Instant::now();
    s.last_reload = Some(now);
    // Treat the reload as a check-in so the fresh page gets a full deadline to
    // come up before it could ever be reloaded again.
    s.last_beat = Some(now);
    s.reloads += 1;
    true
}

/// Start the watchdog. It only ever acts while the main window is focused: a
/// window the user is not looking at gets its timers throttled hard by WebKit,
/// and a missed heartbeat there means nothing.
pub fn spawn_watchdog(handle: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(HEARTBEAT_INTERVAL);
        let Some(window) = handle.get_webview_window("main") else {
            continue;
        };
        let focused = window.is_focused().unwrap_or(false);
        if !focused {
            // Not being looked at: keep the clock honest rather than banking
            // silence that would fire the moment the user comes back.
            let mut s = SESSION.lock().unwrap();
            if s.last_beat.is_some() {
                s.last_beat = Some(Instant::now());
            }
            continue;
        }
        if should_reload_now() {
            let _ = window.reload();
        }
    });
}
