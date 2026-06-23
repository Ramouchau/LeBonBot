use crate::types::{KeywordMatch, ListingData};
use std::time::Duration;
use tauri_plugin_http::reqwest;

/// Send a Telegram notification for a matching listing.
/// Primary: sendPhoto with photo URL as caption.
/// Fallback: sendMessage (text-only) if photo_url is None or download fails.
pub async fn send_notification(
    chat_id: &str,
    listing: &ListingData,
    matches: &[KeywordMatch],
    bot_token: &str,
) -> Result<(), String> {
    let caption = build_caption(listing, matches);

    if let Some(photo_url) = &listing.photo_url {
        match send_photo(chat_id, photo_url, &caption, bot_token).await {
            Ok(_) => return Ok(()),
            Err(e) => {
                log::warn!("sendPhoto failed (falling back to sendMessage): {}", e);
            }
        }
    }

    send_message(chat_id, &caption, bot_token).await
}

fn build_caption(listing: &ListingData, matches: &[KeywordMatch]) -> String {
    let price = listing
        .price
        .map(|p| format!("{:.0}€", p))
        .unwrap_or_else(|| "Prix non précisé".into());

    let mut caption = format!(
        "<b>{}</b>\n📍 {} | {} | {} m² | {} pièces\n\n",
        listing.title,
        listing.location,
        price,
        listing.surface.map_or("?".into(), |s| format!("{:.0}", s)),
        listing.rooms.map_or("?".into(), |r| format!("{}", r)),
    );

    if !matches.is_empty() {
        caption.push_str("🔑 <b>Mots-clés:</b> ");
        let kw: Vec<_> = matches
            .iter()
            .map(|m| format!("{} ({:.0}%)", m.keyword, m.relevance * 100.0))
            .collect();
        caption.push_str(&kw.join(", "));
        caption.push('\n');
    }

    caption.push_str(&format!("\n🔗 {}", listing.url));

    caption
}

async fn send_photo(
    chat_id: &str,
    photo_url: &str,
    caption: &str,
    bot_token: &str,
) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{}/sendPhoto", bot_token);

    let body = serde_json::to_string(&serde_json::json!({
        "chat_id": chat_id,
        "photo": photo_url,
        "caption": caption,
        "parse_mode": "HTML",
        "disable_web_page_preview": false,
    }))
    .map_err(|e| format!("json error: {e}"))?;

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    match resp.status().as_u16() {
        200 => Ok(()),
        429 => {
            // Rate limited — parse retry_after and wait
            let body_text = resp.text().await.unwrap_or_default();
            let body: serde_json::Value = serde_json::from_str(&body_text).unwrap_or_default();
            let retry_after = body["parameters"]["retry_after"].as_u64().unwrap_or(5);
            tokio::time::sleep(Duration::from_secs(retry_after)).await;
            Err(format!("rate limited, retry after {}s", retry_after))
        }
        400 | 403 => Err(format!(
            "Telegram API error ({}): chat_id invalid or bot blocked",
            resp.status()
        )),
        code => Err(format!("Telegram API error: HTTP {}", code)),
    }
}

async fn send_message(chat_id: &str, text: &str, bot_token: &str) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);

    let body = serde_json::to_string(&serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": true,
    }))
    .map_err(|e| format!("json error: {e}"))?;

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Telegram sendMessage failed: HTTP {}",
            resp.status()
        ))
    }
}
