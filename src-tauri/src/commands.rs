use crate::persistence;
use crate::types::{Alert, Settings};
use tauri::State;
use uuid::Uuid;

use crate::types::AppState;

// --- Alert CRUD ---

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_alert(
    name: String,
    price_min: Option<f64>,
    price_max: Option<f64>,
    location: String,
    radius_km: f64,
    property_type: String,
    surface_min: Option<f64>,
    rooms_min: Option<i32>,
    furnished: Option<bool>,
    new_construction: Option<bool>,
    keywords: Vec<String>,
    relaxed_mode: bool,
    scan_interval_minutes: i32,
) -> Result<Alert, String> {
    let alert = Alert {
        id: Uuid::new_v4().to_string(),
        name,
        enabled: true,
        price_min,
        price_max,
        location,
        radius_km,
        property_type,
        surface_min,
        rooms_min,
        furnished,
        new_construction,
        keywords,
        relaxed_mode,
        scan_interval_minutes: scan_interval_minutes.max(10),
        last_scan_at: None,
    };

    let mut alerts = persistence::load_alerts();
    alerts.push(alert.clone());
    persistence::save_alerts(&alerts)?;

    Ok(alert)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_alert(
    id: String,
    name: String,
    price_min: Option<f64>,
    price_max: Option<f64>,
    location: String,
    radius_km: f64,
    property_type: String,
    surface_min: Option<f64>,
    rooms_min: Option<i32>,
    furnished: Option<bool>,
    new_construction: Option<bool>,
    keywords: Vec<String>,
    relaxed_mode: bool,
    scan_interval_minutes: i32,
) -> Result<Alert, String> {
    let mut alerts = persistence::load_alerts();
    let idx = alerts
        .iter()
        .position(|a| a.id == id)
        .ok_or("alert not found")?;

    let updated = Alert {
        id: id.clone(),
        name,
        enabled: alerts[idx].enabled,
        price_min,
        price_max,
        location,
        radius_km,
        property_type,
        surface_min,
        rooms_min,
        furnished,
        new_construction,
        keywords,
        relaxed_mode,
        scan_interval_minutes: scan_interval_minutes.max(10),
        last_scan_at: alerts[idx].last_scan_at,
    };

    alerts[idx] = updated.clone();
    persistence::save_alerts(&alerts)?;

    Ok(updated)
}

#[tauri::command]
pub fn delete_alert(id: String) -> Result<(), String> {
    let mut alerts = persistence::load_alerts();
    alerts.retain(|a| a.id != id);
    persistence::save_alerts(&alerts)
}

#[tauri::command]
pub fn list_alerts() -> Result<Vec<Alert>, String> {
    Ok(persistence::load_alerts())
}

#[tauri::command]
pub fn toggle_alert(id: String, enabled: bool) -> Result<Alert, String> {
    let mut alerts = persistence::load_alerts();
    let idx = alerts
        .iter()
        .position(|a| a.id == id)
        .ok_or("alert not found")?;

    alerts[idx].enabled = enabled;
    let alert = alerts[idx].clone();
    persistence::save_alerts(&alerts)?;

    Ok(alert)
}

// --- Settings ---

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    Ok(persistence::load_settings())
}

#[tauri::command]
pub fn update_settings(
    llm_provider: String,
    llm_api_key: String,
    llm_model: String,
    ollama_endpoint: String,
    telegram_chat_id: String,
    chrome_path: Option<String>,
) -> Result<Settings, String> {
    log::info!(
        "update_settings: provider={}, model={}, chat_id={}, chrome={:?}",
        llm_provider,
        llm_model,
        telegram_chat_id,
        chrome_path
    );
    let settings = Settings {
        llm_provider,
        llm_api_key,
        llm_model,
        ollama_endpoint,
        telegram_chat_id,
        chrome_path,
        relevance_threshold: persistence::load_settings().relevance_threshold,
    };
    persistence::save_settings(&settings)?;
    Ok(settings)
}

// --- Scan trigger ---

#[tauri::command]
pub async fn scan_now(app: tauri::AppHandle) -> Result<String, String> {
    crate::scanner::scan_due_alerts(app).await
}

// --- Bot status ---

#[tauri::command]
pub fn get_bot_status(state: State<'_, AppState>) -> Result<String, String> {
    let status = *state.bot_status.lock().map_err(|e| e.to_string())?;
    serde_json::to_string(&status).map_err(|e| e.to_string())
}
