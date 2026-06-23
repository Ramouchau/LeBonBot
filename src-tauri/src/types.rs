// Phase 1-2 stub types — now used in Phase 3.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// User-configured search alert.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub price_min: Option<f64>,
    pub price_max: Option<f64>,
    pub location: String,
    pub radius_km: f64,
    pub property_type: String,
    pub surface_min: Option<f64>,
    pub rooms_min: Option<i32>,
    pub furnished: Option<bool>,
    pub new_construction: Option<bool>,
    pub keywords: Vec<String>,
    pub relaxed_mode: bool,
    pub scan_interval_minutes: i32,
    #[serde(default)]
    pub last_scan_at: Option<DateTime<Utc>>,
}

/// A listing that has been notified to prevent re-notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeenListing {
    pub listing_id: String,
    pub alert_id: String,
    pub notified_at: DateTime<Utc>,
}

/// Key-value settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub llm_provider: String, // "openai" | "anthropic" | "ollama" | "deepseek"
    pub llm_api_key: String,
    pub llm_model: String, // e.g. "gpt-4o-mini", "claude-haiku-4-5-20250514"
    pub ollama_endpoint: String, // e.g. "http://localhost:11434/v1"
    pub telegram_chat_id: String,
    #[serde(default = "default_relevance_threshold")]
    pub relevance_threshold: f64, // 0.0-1.0, default 0.5
    #[serde(default)]
    pub chrome_path: Option<String>, // auto-detected, user can override
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            llm_provider: "openai".into(),
            llm_api_key: String::new(),
            llm_model: "gpt-4o-mini".into(),
            ollama_endpoint: "http://localhost:11434/v1".into(),
            telegram_chat_id: String::new(),
            chrome_path: None,
            relevance_threshold: 0.5,
        }
    }
}

fn default_relevance_threshold() -> f64 {
    0.5
}

/// Bot operational status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BotStatus {
    Idle,
    Active,
    Error,
}

/// Payload written to sidecar's stdin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarPayload {
    pub action: String, // "scrape"
    pub url: String,
    pub keywords: Vec<String>,
    pub llm_provider: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub ollama_endpoint: String,
    pub chrome_path: Option<String>, // propagated from settings
    pub relevance_threshold: f64,    // LLM match threshold, 0.0-1.0
}

/// Listing data extracted from __NEXT_DATA__.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListingData {
    pub id: String,
    pub title: String,
    pub price: Option<f64>,
    pub location: String,
    pub surface: Option<f64>,
    pub rooms: Option<i32>,
    pub url: String,
    pub photo_url: Option<String>,
}

/// A keyword match from the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeywordMatch {
    pub listing_id: String,
    pub keyword: String,
    pub relevance: f64, // 0.0–1.0
}

/// The page type returned by the sidecar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageType {
    Results,
    Challenge,
    Error,
    Empty,
}

/// Output from the sidecar (one line of stdout JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarOutput {
    pub page_type: PageType,
    #[serde(default)]
    pub listings: Vec<ListingData>,
    #[serde(default)]
    pub keyword_matches: Vec<KeywordMatch>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Application managed state.
pub struct AppState {
    pub bot_status: Mutex<BotStatus>,
    pub telegram_bot_token: String,
}
