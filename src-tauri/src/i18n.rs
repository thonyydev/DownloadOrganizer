use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicUsize, Ordering};

pub const SYSTEM: &str = "system";
pub const PORTUGUESE: &str = "pt-BR";
pub const ENGLISH: &str = "en";
pub const SPANISH: &str = "es";
pub const FRENCH: &str = "fr";
pub const ITALIAN: &str = "it";

// Shared with the frontend: English key -> text in that language.
// Each code sits next to its file, so a language can't get another one's text or folder names.
const FILES: [(&str, &str); 5] = [
    (PORTUGUESE, include_str!("../../i18n/pt-BR.json")),
    (ENGLISH, include_str!("../../i18n/en.json")),
    (SPANISH, include_str!("../../i18n/es.json")),
    (FRENCH, include_str!("../../i18n/fr.json")),
    (ITALIAN, include_str!("../../i18n/it.json")),
];

pub const LANGUAGES: [&str; FILES.len()] = {
    let mut codes = [""; FILES.len()];
    let mut index = 0;
    while index < FILES.len() {
        codes[index] = FILES[index].0;
        index += 1;
    }
    codes
};

// shortcut: borrowed strings can't hold JSON escapes such as \", use String if a translation needs one.
static CATALOGS: LazyLock<[HashMap<&'static str, &'static str>; FILES.len()]> =
    LazyLock::new(|| {
        FILES.map(|(_, json)| {
            serde_json::from_str(json).expect("checked by the catalogs_parse test")
        })
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

pub fn set_language(language: &str) {
    CURRENT.store(index_of(language), Ordering::Relaxed);
}

pub fn resolve(language: &str) -> &'static str {
    LANGUAGES
        .into_iter()
        .find(|item| *item == language)
        .unwrap_or_else(system_language)
}

pub fn t(key: &'static str) -> &'static str {
    text_in(CURRENT.load(Ordering::Relaxed), key)
}

// A missing entry shows the key itself; the frontend tests fail on it first.
pub fn text_in(language: usize, key: &'static str) -> &'static str {
    CATALOGS[language].get(key).copied().unwrap_or(key)
}

pub fn translations_of(key: &'static str) -> impl Iterator<Item = &'static str> {
    (0..LANGUAGES.len()).map(move |language| text_in(language, key))
}

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

#[cfg(not(test))]
fn system_language() -> &'static str {
    // The Windows display language, which only changes after signing in again.
    language_for_ui(unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() })
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
    fn catalogs_parse() {
        assert_eq!(
            text_in(index_of(SPANISH), "Invalid folder or link"),
            "Carpeta no válida o enlace"
        );
    }

    // These names are real destination folders, so changing one splits a user's files in two.
    #[test]
    fn folder_names_stay_the_same() {
        for (key, names) in [
            (
                "folder.images",
                ["Imagens", "Images", "Imágenes", "Images", "Immagini"],
            ),
            (
                "folder.videos",
                ["Vídeos", "Videos", "Vídeos", "Vidéos", "Video"],
            ),
            (
                "folder.audio",
                ["Áudios", "Audio", "Audio", "Audio", "Audio"],
            ),
            (
                "folder.documents",
                [
                    "Documentos",
                    "Documents",
                    "Documentos",
                    "Documents",
                    "Documenti",
                ],
            ),
            (
                "folder.archives",
                [
                    "Compactados",
                    "Archives",
                    "Comprimidos",
                    "Archives",
                    "Archivi",
                ],
            ),
            (
                "folder.installers",
                [
                    "Instaladores",
                    "Installers",
                    "Instaladores",
                    "Installateurs",
                    "Installer",
                ],
            ),
            (
                "folder.code",
                ["Código", "Code", "Código", "Code", "Codice"],
            ),
            (
                "folder.other",
                ["Outros", "Other", "Otros", "Autres", "Altro"],
            ),
        ] {
            assert_eq!(translations_of(key).collect::<Vec<_>>(), names);
        }
    }

    // A key with no text would otherwise become a folder literally named "folder.something".
    #[test]
    fn every_category_has_a_folder_name_in_every_language() {
        for language in LANGUAGES {
            for category in crate::engine::categories_for(language) {
                assert!(!category.name.starts_with("folder."), "{}", category.name);
            }
        }
    }

    #[test]
    fn busy_message_is_recognized_in_every_language() {
        let busy = translations_of("File is busy").collect::<Vec<_>>();
        assert_eq!(
            busy,
            [
                "Arquivo ocupado",
                "File is busy",
                "Archivo ocupado",
                "Fichier occupé",
                "File occupato"
            ]
        );
        assert!(busy.iter().all(|text| crate::engine::is_busy(text)));
    }
}
