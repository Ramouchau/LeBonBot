use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Emitter, Manager,
};

#[cfg(not(target_os = "linux"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

#[cfg(target_os = "linux")]
use tauri::tray::TrayIconBuilder;

use crate::types::BotStatus;

pub fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_hide = MenuItem::with_id(app, "show_hide", "Show/Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_hide, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu);

    #[cfg(target_os = "linux")]
    {
        builder = builder.show_menu_on_left_click(true);
    }

    #[cfg(not(target_os = "linux"))]
    {
        builder = builder
            .tooltip("LeBonBot — idle")
            .show_menu_on_left_click(false)
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            });
    }

    builder = builder.on_menu_event(|app, event| match event.id.as_ref() {
        "show_hide" => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) {
                    window.hide().unwrap();
                } else {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            }
        }
        "quit" => app.exit(0),
        _ => {}
    });

    builder.build(app)?;
    Ok(())
}

/// Update the tray tooltip and emit status to frontend.
pub fn update_status(app: &AppHandle, status: BotStatus) {
    let tooltip = match status {
        BotStatus::Idle => "LeBonBot — idle",
        BotStatus::Active => "LeBonBot — running",
        BotStatus::Error => "LeBonBot — error",
    };

    #[cfg(not(target_os = "linux"))]
    {
        if let Some(tray) = app.tray_by_id("main-tray") {
            let _ = tray.set_tooltip(Some(tooltip));
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Linux: tray tooltip unsupported. Status is emitted to frontend instead.
        let _ = tooltip;
    }

    let _ = app.emit("bot-status", &status);
}
