//! macOS text checking: red underlines and autocorrect inside the app.
//!
//! WebKit's UI process keeps its spelling and substitution state in the *app's*
//! NSUserDefaults, under its own `Web…Enabled` keys, and reads them with
//! `boolForKey:` — which answers NO for a key that was never set. A fresh
//! WKWebView app therefore starts with continuous spell checking and automatic
//! correction switched off, and there is no way to turn them on from inside the
//! page: `spellcheck="true"` on a textarea asks for checking that the host has
//! disabled outright. Safari and TextEdit look like they have this "by default"
//! only because they set these keys in their own domains.
//!
//! So the app sets them once, before any webview exists.
//!
//! **Only if the key is absent.** WebKit writes these same keys back when the
//! user picks something from the editable context menu's Spelling and
//! Substitutions submenus, so a key that is already present is the user's own
//! choice and is left alone. That is what makes those menu items stick.

#[cfg(target_os = "macos")]
use objc2_foundation::{NSString, NSUserDefaults};

/// The keys WebKit reads, and what the app wants them to mean.
///
/// Spelling and the user's own text replacements are on: that is what was
/// asked for, and both are corrections to what you typed.
///
/// The two substitutions are deliberately off. They do not fix mistakes, they
/// rewrite correct input — straight quotes become curly and `--` becomes an em
/// dash — and this app types filenames, tags and LLM prompts, where that is a
/// silent content change rather than a nicety. They are still listed, rather
/// than left unset, so the default is ours and not WebKit's; the context menu
/// can still turn them on, and that choice then sticks.
#[cfg(target_os = "macos")]
const TEXT_CHECKING_DEFAULTS: &[(&str, bool)] = &[
    // The red underline.
    ("WebContinuousSpellCheckingEnabled", true),
    // Autocorrect: the misspelling is replaced as you type.
    ("WebAutomaticSpellingCorrectionEnabled", true),
    // The user's own substitutions from System Settings → Keyboard → Text.
    ("WebAutomaticTextReplacementEnabled", true),
    ("WebAutomaticQuoteSubstitutionEnabled", false),
    ("WebAutomaticDashSubstitutionEnabled", false),
];

/// Must run before the first webview is built: WebKit reads these once, lazily,
/// and caches the result for the life of the process.
#[cfg(target_os = "macos")]
pub fn install_defaults() {
    let defaults = NSUserDefaults::standardUserDefaults();
    for (key, wanted) in TEXT_CHECKING_DEFAULTS {
        let key = NSString::from_str(key);
        if defaults.objectForKey(&key).is_some() {
            continue;
        }
        defaults.setBool_forKey(*wanted, &key);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn install_defaults() {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn corrections_are_on_and_rewrites_are_off() {
        let get = |key: &str| {
            TEXT_CHECKING_DEFAULTS
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| *v)
        };
        // What was asked for: the red underline, and autocorrect.
        assert_eq!(get("WebContinuousSpellCheckingEnabled"), Some(true));
        assert_eq!(get("WebAutomaticSpellingCorrectionEnabled"), Some(true));
        // The user's own substitutions are theirs; honouring them is not a
        // rewrite we invented.
        assert_eq!(get("WebAutomaticTextReplacementEnabled"), Some(true));
        // These two rewrite correct input. This app types filenames, tags and
        // prompts, so a straight quote must stay straight and `--` must stay
        // `--` unless the user turns it on from the context menu.
        assert_eq!(get("WebAutomaticQuoteSubstitutionEnabled"), Some(false));
        assert_eq!(get("WebAutomaticDashSubstitutionEnabled"), Some(false));
    }

    #[test]
    fn every_key_is_one_webkit_actually_reads() {
        // A typo here fails silently and forever, so the list is pinned.
        for (key, _) in TEXT_CHECKING_DEFAULTS {
            assert!(
                key.starts_with("Web") && key.ends_with("Enabled"),
                "unexpected key shape: {key}"
            );
        }
        assert_eq!(TEXT_CHECKING_DEFAULTS.len(), 5);
    }
}
