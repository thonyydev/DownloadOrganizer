use super::*;

fn english(prefs: &Preferences) -> Preferences {
    Preferences {
        language: i18n::ENGLISH.into(),
        ..prefs.clone()
    }
}

#[test]
fn preferences_saved_before_languages_stay_in_portuguese() {
    let legacy = r#"{"source":"a","destination":"b","automatic":false,"enabled_categories":[],"theme":"dark"}"#;
    let prefs: Preferences = serde_json::from_str(legacy).unwrap();
    assert_eq!(prefs.language, i18n::PORTUGUESE);
    let (_temp, _runtime, new_install) = fixture();
    assert_eq!(new_install.language, i18n::SYSTEM);
}

#[test]
fn manual_choice_overrides_the_system_language() {
    for language in i18n::LANGUAGES {
        assert_eq!(i18n::resolve(language), language);
    }
    // Tests run with Portuguese as the system language.
    assert_eq!(i18n::resolve(i18n::SYSTEM), i18n::PORTUGUESE);
}

#[test]
fn folders_follow_the_chosen_language() {
    let (_temp, _runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("a.txt"), b"a");
    let system = plan(&prefs).files.remove(0).destination;
    let en = plan(&english(&prefs)).files.remove(0).destination;
    assert!(Path::new(&system).ends_with("Documentos/a.txt"));
    assert!(Path::new(&en).ends_with("Documents/a.txt"));
    let italian = Preferences {
        language: i18n::ITALIAN.into(),
        ..prefs.clone()
    };
    assert!(Path::new(&plan(&italian).files.remove(0).destination).ends_with("Documenti/a.txt"));
}

#[test]
fn unknown_language_is_rejected_and_nothing_is_saved() {
    let (_temp, mut runtime, prefs) = fixture();
    let invalid = Preferences {
        language: "../es".into(),
        ..prefs.clone()
    };
    assert!(runtime.store.save(&invalid).is_err());
    assert_eq!(
        runtime.store.preferences().unwrap().language,
        prefs.language
    );
}

#[test]
fn switching_language_leaves_organized_files_and_undo_intact() {
    let (_temp, mut runtime, prefs) = fixture();
    let source = Path::new(&prefs.source);
    old_file(&source.join("first.txt"), b"first");
    let first = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();

    let en = english(&prefs);
    runtime.store.save(&en).unwrap();
    old_file(&source.join("second.txt"), b"second");
    execute(&mut runtime, plan(&en), "manual", None).unwrap();
    assert_eq!(
        fs::read(source.join("Documentos/first.txt")).unwrap(),
        b"first"
    );
    assert_eq!(
        fs::read(source.join("Documents/second.txt")).unwrap(),
        b"second"
    );

    // Undo follows the recorded paths, not the language now in use.
    undo(&mut runtime, first, None).unwrap();
    assert_eq!(fs::read(source.join("first.txt")).unwrap(), b"first");
}

#[test]
fn a_plan_from_the_previous_language_cannot_move_files() {
    let (_temp, mut runtime, prefs) = fixture();
    let source = Path::new(&prefs.source);
    old_file(&source.join("a.txt"), b"a");
    let stale = plan(&prefs);
    runtime.store.save(&english(&prefs)).unwrap();

    let _ = execute(&mut runtime, stale, "manual", None);
    assert_eq!(fs::read(source.join("a.txt")).unwrap(), b"a");
    assert!(!source.join("Documentos/a.txt").exists());
    assert!(!source.join("Documents/a.txt").exists());
}

#[test]
fn every_category_has_a_distinct_name_in_each_language() {
    for language in i18n::LANGUAGES {
        let names: Vec<_> = engine::categories_for(language)
            .iter()
            .map(|category| category.name.to_lowercase())
            .collect();
        let unique: std::collections::HashSet<_> = names.iter().collect();
        assert_eq!(unique.len(), engine::categories().len());
    }
    let ids = |language| {
        engine::categories_for(language)
            .iter()
            .map(|category| category.id.clone())
            .collect::<Vec<_>>()
    };
    for language in i18n::LANGUAGES {
        assert_eq!(ids(i18n::PORTUGUESE), ids(language));
    }
}

#[test]
fn busy_files_are_recognized_in_both_languages() {
    assert!(engine::is_busy("Arquivo ocupado"));
    for message in [
        "File is busy",
        "Archivo ocupado",
        "Fichier occupé",
        "File occupato",
    ] {
        assert!(engine::is_busy(message));
    }
    assert!(!engine::is_busy("Arquivo inválido ou link"));
    assert!(!engine::is_busy("Invalid file or link"));
}
