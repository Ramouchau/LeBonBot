use crate::persistence;
use crate::telegram;
use crate::types::{
    AppState, BotStatus, KeywordMatch, ListingData, SeenListing, SidecarOutput, SidecarPayload,
};
use chrono::Utc;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const SCHEDULER_TICK_SECS: u64 = 60;

fn bot_token(app: &tauri::AppHandle) -> String {
    app.try_state::<AppState>()
        .map(|s| s.telegram_bot_token.clone())
        .unwrap_or_default()
}

/// Background scheduler: runs every 60s, checks for due alerts, spawns sidecar.
pub async fn run_scheduler(app: tauri::AppHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(SCHEDULER_TICK_SECS));

    loop {
        interval.tick().await;
        if let Err(e) = tick(&app).await {
            log::error!("scheduler tick failed: {}", e);
            set_status(&app, BotStatus::Error);
        }
    }
}

/// Manual scan trigger — same logic as scheduler tick, but immediate.
pub async fn scan_due_alerts(app: tauri::AppHandle) -> Result<String, String> {
    let settings = persistence::load_settings();
    if settings.telegram_chat_id.is_empty() {
        return Err("Telegram Chat ID not set — configure in Settings first".into());
    }
    let token = app
        .try_state::<AppState>()
        .map(|s| s.telegram_bot_token.clone())
        .unwrap_or_default();
    if token.is_empty() {
        return Err("TELEGRAM_BOT_TOKEN not set at build time — rebuild with: TELEGRAM_BOT_TOKEN=... cargo build".into());
    }
    let alerts = persistence::load_alerts();
    let enabled = alerts.iter().filter(|a| a.enabled).count();
    if enabled == 0 {
        return Err(format!(
            "No enabled alerts — create one first ({} total, 0 enabled)",
            alerts.len()
        ));
    }
    tick(&app).await
}

async fn tick(app: &tauri::AppHandle) -> Result<String, String> {
    let settings = persistence::load_settings();
    let alerts = persistence::load_alerts();
    let now = Utc::now();

    let due: Vec<_> = alerts
        .iter()
        .filter(|a| {
            a.enabled
                && a.last_scan_at
                    .map(|t| (now - t).num_minutes() >= a.scan_interval_minutes as i64)
                    .unwrap_or(true)
        })
        .cloned()
        .collect();

    if due.is_empty() {
        set_status(app, BotStatus::Idle);
        return Ok("No alerts due".into());
    }

    set_status(app, BotStatus::Active);
    let total = due.len();
    let mut notified = 0usize;

    for alert in &due {
        // Build search URL from alert parameters
        let url = build_search_url(alert);

        let payload = SidecarPayload {
            action: "scrape".into(),
            url,
            keywords: alert.keywords.clone(),
            llm_provider: settings.llm_provider.clone(),
            llm_api_key: settings.llm_api_key.clone(),
            llm_model: settings.llm_model.clone(),
            ollama_endpoint: settings.ollama_endpoint.clone(),
            chrome_path: settings.chrome_path.clone(),
            relevance_threshold: settings.relevance_threshold,
        };

        match spawn_sidecar(app, &payload).await {
            Ok(output) => {
                if output.page_type == crate::types::PageType::Challenge {
                    set_status(app, BotStatus::Error);
                    log::warn!("DataDome challenge detected for alert {}", alert.id);
                    continue;
                }

                if output.page_type == crate::types::PageType::Error {
                    log::error!("sidecar error for alert {}: {:?}", alert.id, output.error);
                    set_status(app, BotStatus::Error);
                    continue;
                }

                // Process matches for this alert
                let seen = persistence::load_seen_listings();
                let chat_id = &settings.telegram_chat_id;

                for listing in &output.listings {
                    // Dedup: skip if already notified for this alert
                    if seen
                        .iter()
                        .any(|s| s.listing_id == listing.id && s.alert_id == alert.id)
                    {
                        continue;
                    }

                    // Strict/relaxed matching
                    let matches = filter_matches(
                        &output.keyword_matches,
                        listing,
                        alert,
                        settings.relevance_threshold,
                    );
                    let is_match = if alert.relaxed_mode {
                        relaxed_match(listing, alert) || !matches.is_empty()
                    } else {
                        !matches.is_empty()
                    };
                    if !is_match {
                        continue;
                    }

                    // Send telegram notification
                    if let Err(e) =
                        telegram::send_notification(chat_id, listing, &matches, &bot_token(app))
                            .await
                    {
                        log::error!("telegram notification failed: {}", e);
                    }

                    // Persist seen listing
                    let mut seen = persistence::load_seen_listings();
                    seen.push(SeenListing {
                        listing_id: listing.id.clone(),
                        alert_id: alert.id.clone(),
                        notified_at: Utc::now(),
                    });
                    persistence::save_seen_listings(&seen).ok();

                    notified += 1;

                    // Rate limit: 350ms between messages
                    tokio::time::sleep(Duration::from_millis(350)).await;
                }

                // Update last_scan_at
                let mut alerts = persistence::load_alerts();
                if let Some(a) = alerts.iter_mut().find(|a| a.id == alert.id) {
                    a.last_scan_at = Some(Utc::now());
                }
                persistence::save_alerts(&alerts).ok();
            }
            Err(e) => {
                log::error!("sidecar failed for alert {}: {}", alert.id, e);
                set_status(app, BotStatus::Error);
            }
        }
    }

    set_status(app, BotStatus::Idle);
    Ok(format!(
        "Scanned {} alert(s), found {} new listing(s)",
        total, notified
    ))
}

async fn spawn_sidecar(
    app: &tauri::AppHandle,
    payload: &SidecarPayload,
) -> Result<SidecarOutput, String> {
    let sidecar = app
        .shell()
        .sidecar("scraper")
        .map_err(|e| format!("sidecar not found: {e}"))?;

    let (mut rx, mut child) = sidecar.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    // Write payload to sidecar's stdin
    let json = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    child
        .write(json.as_bytes())
        .map_err(|e| format!("stdin write failed: {e}"))?;

    // CRITICAL: drop child to send EOF on stdin
    drop(child);

    // Collect all stdout lines (with 120s timeout to prevent scheduler freeze)
    let collect_future = async {
        let mut stdout = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    stdout.push_str(&String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Stderr(bytes) => {
                    log::warn!("sidecar stderr: {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(status) => {
                    if status.code != Some(0) {
                        return Err(format!("sidecar exited with code {:?}", status.code));
                    }
                }
                CommandEvent::Error(msg) => {
                    log::error!("sidecar IO error: {}", msg);
                    return Err(format!("sidecar IO error: {}", msg));
                }
                _ => {}
            }
        }
        Ok(stdout)
    };

    let stdout = tokio::time::timeout(std::time::Duration::from_secs(120), collect_future)
        .await
        .map_err(|_| "sidecar timed out after 120s".to_string())??;

    // Two-phase serde: parse to Value first, validate page_type, then deserialize
    let value: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("invalid JSON from sidecar: {e}"))?;

    let page_type = value["page_type"].as_str().unwrap_or("error");

    if page_type != "results"
        && page_type != "challenge"
        && page_type != "empty"
        && page_type != "error"
    {
        return Err(format!("unknown page_type: {page_type}"));
    }

    let output: SidecarOutput =
        serde_json::from_value(value).map_err(|e| format!("deserialization failed: {e}"))?;

    Ok(output)
}

fn build_search_url(alert: &crate::types::Alert) -> String {
    let prop_type = match alert.property_type.as_str() {
        "appartement" => "1",
        "maison" => "2",
        "studio" => "1",
        "loft" => "1",
        "terrain" => "4",
        "parking" => "3",
        _ => "1",
    };

    let mut url = format!(
        "https://www.leboncoin.fr/recherche?category=9&locations={}&real_estate_type={}",
        alert.location, prop_type
    );

    if let Some(min) = alert.price_min {
        url.push_str(&format!("&price={}-", min as i64));
    }
    if let Some(max) = alert.price_max {
        if alert.price_min.is_some() {
            url.push_str(&format!("{}", max as i64));
        } else {
            url.push_str(&format!("&price=0-{}", max as i64));
        }
    }
    if let Some(surface) = alert.surface_min {
        url.push_str(&format!("&square={}-", surface as i64));
    }
    if let Some(rooms) = alert.rooms_min {
        url.push_str(&format!("&rooms={}-", rooms));
    }
    if let Some(true) = alert.furnished {
        url.push_str("&furnished=1");
    }
    if let Some(true) = alert.new_construction {
        url.push_str("&new_construction=1");
    }

    // Radius in meters (leboncoin expects meters, km * 1000)
    url.push_str(&format!("&radius={}", (alert.radius_km * 1000.0) as i64));

    url
}

fn relaxed_match(listing: &ListingData, alert: &crate::types::Alert) -> bool {
    // Relaxed: price ±12.5%, surface ≥80%, rooms ±1
    if let (Some(listing_price), Some(alert_min), Some(alert_max)) =
        (listing.price, alert.price_min, alert.price_max)
    {
        let min_relaxed = alert_min * 0.875;
        let max_relaxed = alert_max * 1.125;
        if listing_price < min_relaxed || listing_price > max_relaxed {
            return false;
        }
    }
    if let (Some(listing_surface), Some(alert_surface)) = (listing.surface, alert.surface_min) {
        if listing_surface < alert_surface * 0.8 {
            return false;
        }
    }
    if let (Some(listing_rooms), Some(alert_rooms)) = (listing.rooms, alert.rooms_min) {
        if listing_rooms < alert_rooms - 1 || listing_rooms > alert_rooms + 1 {
            return false;
        }
    }
    true
}

fn filter_matches(
    matches: &[KeywordMatch],
    listing: &ListingData,
    _alert: &crate::types::Alert,
    threshold: f64,
) -> Vec<KeywordMatch> {
    matches
        .iter()
        .filter(|m| m.listing_id == listing.id && m.relevance >= threshold)
        .cloned()
        .collect()
}

fn set_status(app: &tauri::AppHandle, status: BotStatus) {
    if let Some(state) = app.try_state::<AppState>() {
        *state.bot_status.lock().unwrap() = status;
    }
    crate::tray::update_status(app, status);
}
