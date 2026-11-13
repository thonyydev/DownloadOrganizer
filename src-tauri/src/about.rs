//! The About tab's links. The page names a link; the addresses live here, so it can't open others.
const REPOSITORY: &str = "https://github.com/thonyydev/DownloadOrganizer";

pub fn url(which: &str, version: &str, windows: &str) -> Option<String> {
    Some(match which {
        "site" => "https://downloadorganizer.thonyy.dev".into(),
        "repository" => REPOSITORY.into(),
        "feedback" => format!("{REPOSITORY}/issues/new?template=feature_request.yml"),
        // GitHub fills issue form fields from parameters named after their ids.
        "bug" => format!(
            "{REPOSITORY}/issues/new?template=bug_report.yml&version={}&platform={}",
            encode(version),
            encode(windows)
        ),
        // The notices shipped with this version, from its release tag.
        "notices" => format!("{REPOSITORY}/tree/v{version}/public"),
        _ => return None,
    })
}

fn encode(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// Like "Windows 11 25H2 (build 26300)", read from the registry.
pub fn windows_version() -> String {
    use windows_sys::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW};
    let read = |name: &str| {
        let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let mut buffer = [0u16; 64];
        let mut size = std::mem::size_of_val(&buffer) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                wide(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion").as_ptr(),
                wide(name).as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        (status == 0).then(|| {
            String::from_utf16_lossy(&buffer[..size as usize / 2])
                .trim_end_matches('\0')
                .to_owned()
        })
    };
    let Some(build) = read("CurrentBuildNumber") else {
        return "Windows".into();
    };
    // ProductName still says Windows 10 on Windows 11; the build number tells them apart.
    let name = if build.parse::<u32>().is_ok_and(|build| build >= 22000) {
        "Windows 11"
    } else {
        "Windows 10"
    };
    match read("DisplayVersion") {
        Some(release) => format!("{name} {release} (build {build})"),
        None => format!("{name} (build {build})"),
    }
}
