fn main() {
    // tauri-build selects this ICO but does not track changes to its Windows resource.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
