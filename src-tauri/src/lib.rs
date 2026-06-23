mod commands;
mod persistence;
mod scanner;
mod telegram;
mod tray;
mod types;

use std::sync::Mutex;
use tauri::Manager;
use types::AppState;
use types::BotStatus;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppState {
            bot_status: Mutex::new(BotStatus::Idle),
            telegram_bot_token: option_env!("TELEGRAM_BOT_TOKEN").unwrap_or_default().into(),
        })
        .setup(|app| {
            // Initialize persistence directory
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).ok();
            log::info!("data dir: {:?}", app_dir);
            persistence::set_data_dir(app_dir);

            // Setup system tray
            tray::setup_tray(app)?;

            // Start background scheduler
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                scanner::run_scheduler(handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_alert,
            commands::update_alert,
            commands::delete_alert,
            commands::list_alerts,
            commands::toggle_alert,
            commands::get_settings,
            commands::update_settings,
            commands::scan_now,
            commands::get_bot_status,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
