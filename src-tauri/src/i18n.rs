use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicUsize, Ordering};

pub const SYSTEM: &str = "system";
pub const PORTUGUESE: &str = "pt-BR";
pub const ENGLISH: &str = "en";
pub const SPANISH: &str = "es";
pub const FRENCH: &str = "fr";
pub const ITALIAN: &str = "it";
pub const LANGUAGES: [&str; 5] = [PORTUGUESE, ENGLISH, SPANISH, FRENCH, ITALIAN];

// Shared with the frontend: Portuguese text -> [Spanish, French, Italian].
static CATALOG: LazyLock<HashMap<&'static str, [&'static str; 3]>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../src/lib/translations.json"))
        .expect("translations.json is checked by the frontend tests")
});

// Only selects message text. Folder names always come from the saved preference.
static CURRENT: AtomicUsize = AtomicUsize::new(0);

pub fn index_of(language: &str) -> usize {
    let resolved = resolve(language);
    LANGUAGES
        .iter()
        .position(|item| *item == resolved)
        .unwrap_or(0)
}

pub fn current_index() -> usize {
    CURRENT.load(Ordering::Relaxed)
}

pub fn set_language(language: &str) {
    CURRENT.store(index_of(language), Ordering::Relaxed);
}

pub fn resolve(language: &str) -> &'static str {
    LANGUAGES
        .into_iter()
        .find(|item| *item == language)
        .unwrap_or_else(system_language)
}

pub fn t(portuguese: &'static str, english: &'static str) -> &'static str {
    match CURRENT.load(Ordering::Relaxed) {
        0 => portuguese,
        1 => english,
        // A missing entry falls back to English; the frontend tests fail on it first.
        index => CATALOG
            .get(portuguese)
            .map_or(english, |row| row[index - 2]),
    }
}

#[cfg(any(windows, test))]
fn language_for_ui(language_id: u16) -> &'static str {
    // The low 10 bits are the primary language, shared by every regional variant.
    match language_id & 0x3ff {
        0x16 => PORTUGUESE,
        0x0a => SPANISH,
        0x0c => FRENCH,
        0x10 => ITALIAN,
        _ => ENGLISH,
    }
}

// Tests assert the Portuguese text, whatever language the machine uses.
#[cfg(test)]
fn system_language() -> &'static str {
    PORTUGUESE
}

#[cfg(all(not(test), windows))]
fn system_language() -> &'static str {
    // The Windows display language, which only changes after signing in again.
    language_for_ui(unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() })
}

#[cfg(all(not(test), not(windows)))]
fn system_language() -> &'static str {
    let locale = std::env::var("LANG").unwrap_or_default().to_lowercase();
    [
        ("pt", PORTUGUESE),
        ("es", SPANISH),
        ("fr", FRENCH),
        ("it", ITALIAN),
    ]
    .into_iter()
    .find(|(prefix, _)| locale.starts_with(prefix))
    .map_or(ENGLISH, |(_, language)| language)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_windows_display_languages() {
        assert_eq!(language_for_ui(0x0416), PORTUGUESE); // pt-BR
        assert_eq!(language_for_ui(0x0816), PORTUGUESE); // pt-PT
        assert_eq!(language_for_ui(0x0c0a), SPANISH); // es-ES
        assert_eq!(language_for_ui(0x080a), SPANISH); // es-MX
        assert_eq!(language_for_ui(0x040c), FRENCH); // fr-FR
        assert_eq!(language_for_ui(0x0410), ITALIAN); // it-IT
        assert_eq!(language_for_ui(0x0409), ENGLISH); // en-US
        assert_eq!(language_for_ui(0x0407), ENGLISH); // de-DE
    }

    #[test]
    fn catalog_parses() {
        assert_eq!(
            CATALOG["Pasta inválida ou link"][0],
            "Carpeta no válida o enlace"
        );
    }
}
