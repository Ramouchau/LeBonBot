use crate::types::{Alert, SeenListing, Settings};
use std::path::PathBuf;
use std::sync::Mutex;

static DATA_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn set_data_dir(dir: PathBuf) {
    *DATA_DIR.lock().unwrap() = Some(dir);
}

fn data_dir() -> PathBuf {
    DATA_DIR.lock().unwrap().clone().expect("data dir not set")
}

fn atomic_write(path: &PathBuf, data: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}

fn alerts_path() -> PathBuf {
    data_dir().join("alerts.json")
}

fn seen_path() -> PathBuf {
    data_dir().join("seen_listings.json")
}

fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

// --- Alerts ---

pub fn load_alerts() -> Vec<Alert> {
    let path = alerts_path();
    if !path.exists() {
        return vec![];
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_alerts(alerts: &[Alert]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(alerts).map_err(|e| e.to_string())?;
    atomic_write(&alerts_path(), &json)
}

// --- Seen Listings ---

// Phase 1 stub — will be used in Phase 3.
pub fn load_seen_listings() -> Vec<SeenListing> {
    let path = seen_path();
    if !path.exists() {
        return vec![];
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

// Phase 1 stub — will be used in Phase 3.
pub fn save_seen_listings(seen: &[SeenListing]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(seen).map_err(|e| e.to_string())?;
    atomic_write(&seen_path(), &json)
}

// --- Settings ---

pub fn load_settings() -> Settings {
    let path = settings_path();
    log::info!("loading settings from {:?}", path);
    if !path.exists() {
        log::info!("settings file not found, returning defaults");
        return Settings::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(settings) => {
                log::info!("settings loaded successfully");
                settings
            }
            Err(e) => {
                log::error!("failed to parse settings.json: {}", e);
                Settings::default()
            }
        },
        Err(e) => {
            log::error!("failed to read settings file: {}", e);
            Settings::default()
        }
    }
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    log::info!(
        "saving settings: provider={}, chat_id={}",
        settings.llm_provider,
        settings.telegram_chat_id
    );
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    atomic_write(&settings_path(), &json)
}
