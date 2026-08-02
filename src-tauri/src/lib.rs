// keyverse Tauri shell — thin native host around the existing web UI.
// Desktop browser UX is unchanged; this binary only wraps the same HTML/CSS/JS.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Expose a small identity flag for the web layer (optional).
            // Platform detection in JS also checks __TAURI_INTERNALS__ / userAgent.
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                let _ = app;
                // Mobile-specific setup hooks go here (status bar, deep links, …).
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running keyverse");
}
