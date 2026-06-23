---
date: 2026-05-24T20:10:14+0200
author: Ramouchau
commit: c9b370b
branch: main
repository: LeBonBot
topic: "Leboncoin Real Estate Alert Bot — Implementation Plan"
tags: [plan, tauri, nextjs, playwright, leboncoin, datadome, llm, telegram]
status: ready
parent: ".rpiv/artifacts/designs/2026-05-22_04-36-13_leboncoin-real-estate-bot.md"
last_updated: 2026-05-24T20:10:14+0200
last_updated_by: Ramouchau
---

# Leboncoin Real Estate Alert Bot — Implementation Plan

## Overview

Implement a Tauri v2 desktop app that scrapes leboncoin.fr real estate listings via a Node.js Playwright sidecar using the user's real Chrome (headless) to bypass DataDome TLS fingerprinting. Listings are extracted from the `__NEXT_DATA__` JSON blob. The LLM (OpenAI/Anthropic/Ollama via Vercel AI SDK) only scores keyword relevance against pre-extracted listing text. Matching listings trigger Telegram notifications. Persistence uses simple JSON files. The app runs in the system tray.

Design artifact: `.rpiv/artifacts/designs/2026-05-22_04-36-13_leboncoin-real-estate-bot.md`

## Desired End State

1. User creates/edit/deletes search alerts with: price range, location + radius, property type, surface, rooms, furnished, construction, keywords
2. Node.js sidecar scrapes leboncoin.fr via Playwright + real Chrome (headless), extracts structured data from `<script id="__NEXT_DATA__">`
3. LLM performs keyword matching on pre-extracted listing text (not DOM parsing)
4. Multi-provider LLM: OpenAI (GPT-4o-mini), Anthropic (Claude Haiku), Ollama (llama3.1:8b) via Vercel AI SDK `Output.object()`
5. Relaxed matching mode toggle
6. DataDome challenge detection — sidecar checks for challenge page; on block: skip tick, tray warning, retry next interval
7. Telegram `sendPhoto` with listing photo URL + details; fallback to `sendMessage`
8. JSON file persistence: `alerts.json`, `seen_listings.json`, `settings.json`
9. System tray with status indicator, Show/Hide/Quit menu, close-to-tray behavior
10. Background scheduler: `tokio::time::interval` → SELECT due alerts → spawn sidecar sequentially
11. Chrome auto-detection on first launch; persist path to settings; tray warning if not found

## What We're NOT Doing

- SQLite — replaced by JSON files
- WhatsApp, Signal notifications — deferred
- Historical analytics, price trend dashboards
- Mobile app
- Built-in payment/transaction handling
- Per-user bot tokens — shared bot token embedded in binary
- Static CSS selector fallback
- LLM DOM parsing
- Playwright-extra stealth plugin

## Phase 1: Foundation

### Overview

Sets up the entire project skeleton: Tauri v2 shell with Next.js 15 static export frontend, all Rust types, JSON persistence, Tauri commands for alert CRUD and settings, system tray, and the Next.js config panel UI. The scanner and telegram modules are stubs at this stage — real implementations come in Phase 3.

### Changes Required

#### 1. Project Root Configs
**File**: `package.json`
**Changes**: NEW — Root package.json with Next.js, React, and Tauri CLI.

```json
{
  "name": "lebonbot",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "tauri": "tauri"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@tauri-apps/cli": "^2.0.0"
  }
}
```

#### 2. TypeScript Config
**File**: `tsconfig.json`
**Changes**: NEW — TypeScript configuration for the Next.js frontend.

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

#### 3. Next.js Config
**File**: `next.config.mjs`
**Changes**: NEW — Static export configuration for Tauri embedding.

```js
const isProd = process.env.NODE_ENV === 'production';
const internalHost = process.env.TAURI_DEV_HOST || 'localhost';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,
  experimental: {
    reactCompiler: true,
  },
};

export default nextConfig;
```

#### 4. Tauri Config
**File**: `src-tauri/tauri.conf.json`
**Changes**: NEW — Tauri v2 build, window, bundle, and sidecar external binary config.

```json
{
  "productName": "LeBonBot",
  "version": "0.1.0",
  "identifier": "com.lebonbot.app",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devUrl": "http://localhost:3000",
    "frontendDist": "../out"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "title": "LeBonBot",
        "width": 1024,
        "height": 768,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "externalBin": ["binaries/scraper"]
  }
}
```

#### 5. Rust Dependencies
**File**: `src-tauri/Cargo.toml`
**Changes**: NEW — Tauri v2 with tray-icon, tokio scheduler, serde JSON, plugins for shell and HTTP.

```toml
[package]
name = "lebonbot"
version = "0.1.0"
edition = "2021"

[lib]
name = "lebonbot_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-http = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["time", "rt", "macros"] }
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4"] }
log = "0.4"
env_logger = "0.11"
```

#### 6. Tauri Build Script
**File**: `src-tauri/build.rs`
**Changes**: NEW — Required Tauri v2 build script.

```rust
fn main() {
    tauri_build::build()
}
```

#### 7. Tauri Capabilities (Permissions)
**File**: `src-tauri/capabilities/default.json`
**Changes**: NEW — Shell (sidecar spawn), HTTP (Telegram API), core window management permissions.

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-close",
    "core:window:allow-set-focus",
    "shell:allow-spawn",
    "shell:allow-stdin-write",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/scraper",
          "sidecar": true,
          "args": true
        }
      ]
    },
    "http:default",
    {
      "identifier": "http:default",
      "allow": [
        { "url": "https://api.telegram.org/**" },
        { "url": "https://www.leboncoin.fr/**" }
      ]
    }
  ]
}
```

#### 8. Rust Entry Point
**File**: `src-tauri/src/main.rs`
**Changes**: NEW — Desktop entry point, delegates to `lib::run()`.

```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lebonbot_lib::run()
}
```

#### 9. Shared Types
**File**: `src-tauri/src/types.rs`
**Changes**: NEW — Alert, SeenListing, Settings, BotStatus, SidecarPayload, ListingData, KeywordMatch, PageType, SidecarOutput, AppState.

```rust
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
    pub llm_provider: String,        // "openai" | "anthropic" | "ollama"
    pub llm_api_key: String,
    pub llm_model: String,           // e.g. "gpt-4o-mini", "claude-haiku-4-5-20250514"
    pub ollama_endpoint: String,     // e.g. "http://localhost:11434/v1"
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
    pub action: String,             // "scrape"
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
}
```

#### 10. JSON File Persistence
**File**: `src-tauri/src/persistence.rs`
**Changes**: NEW — Atomic JSON read/write for alerts, seen listings, settings.

```rust
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

pub fn save_seen_listings(seen: &[SeenListing]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(seen).map_err(|e| e.to_string())?;
    atomic_write(&seen_path(), &json)
}

// --- Settings ---

pub fn load_settings() -> Settings {
    let path = settings_path();
    if !path.exists() {
        return Settings::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    atomic_write(&settings_path(), &json)
}
```

#### 11. Tauri Commands
**File**: `src-tauri/src/commands.rs`
**Changes**: NEW — Alert CRUD, settings get/update, scan trigger, bot status query.

```rust
use crate::persistence;
use crate::types::{Alert, BotStatus, Settings};
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::types::AppState;

// --- Alert CRUD ---

#[tauri::command]
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
    let settings = Settings {
        llm_provider,
        llm_api_key,
        llm_model,
        ollama_endpoint,
        telegram_chat_id,
        chrome_path,
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
    Ok(serde_json::to_string(&status).map_err(|e| e.to_string())?)
}
```

#### 12. System Tray
**File**: `src-tauri/src/tray.rs`
**Changes**: NEW — System tray with Show/Hide/Quit menu, platform-specific click behavior, status updates via tooltip + events.

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

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
```

#### 13. Scanner Module (Stub)
**File**: `src-tauri/src/scanner.rs`
**Changes**: NEW (stub) — Module skeleton that compiles against lib.rs expectations. Full implementation in Phase 3.

```rust
use crate::types::BotStatus;
use tauri::Emitter;
use tauri::Manager;

/// Background scheduler: loops on interval, calls tick.
/// STUB: compiles but does nothing meaningful until Phase 3.
pub async fn run_scheduler(app: tauri::AppHandle) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        interval.tick().await;
        // Phase 3: real tick logic
        set_status(&app, BotStatus::Idle);
    }
}

/// Manual scan trigger — same as scheduler tick, but immediate.
/// STUB: returns placeholder until Phase 3.
pub async fn scan_due_alerts(_app: tauri::AppHandle) -> Result<String, String> {
    Ok("Scanner not yet integrated (Phase 3)".into())
}

fn set_status(app: &tauri::AppHandle, status: BotStatus) {
    if let Some(state) = app.try_state::<crate::types::AppState>() {
        *state.bot_status.lock().unwrap() = status;
    }
    crate::tray::update_status(app, status);
}
```

#### 14. Telegram Module (Stub)
**File**: `src-tauri/src/telegram.rs`
**Changes**: NEW (stub) — Module skeleton. Full implementation in Phase 3.

```rust
use crate::types::{KeywordMatch, ListingData};

/// STUB: send_notification — no-op. Full implementation in Phase 3.
pub async fn send_notification(
    _chat_id: &str,
    _listing: &ListingData,
    _matches: &[KeywordMatch],
    _bot_token: &str,
) -> Result<(), String> {
    Ok(())
}
```

#### 15. Core Lib
**File**: `src-tauri/src/lib.rs`
**Changes**: NEW — Plugin registration, managed state, command handler, tray + scheduler setup, close-to-tray behavior.

```rust
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
        })
        .setup(|app| {
            // Initialize persistence directory
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).ok();
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
```

#### 16. Root Layout
**File**: `src/app/layout.tsx`
**Changes**: NEW — Root layout with metadata for the Next.js app.

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LeBonBot",
  description: "Leboncoin Real Estate Alert Bot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
```

#### 17. Home Page
**File**: `src/app/page.tsx`
**Changes**: NEW — Alert list, status panel, navigation, scan trigger.

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { invoke } from "@tauri-apps/api/core";
import StatusPanel from "../components/StatusPanel";

interface Alert {
  id: string;
  name: string;
  enabled: boolean;
  location: string;
  property_type: string;
  price_min: number | null;
  price_max: number | null;
  scan_interval_minutes: number;
  last_scan_at: string | null;
}

export default function Home() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    invoke<Alert[]>("list_alerts").then(setAlerts).catch(console.error);
  }, []);

  const handleToggle = async (id: string, enabled: boolean) => {
    await invoke("toggle_alert", { id, enabled });
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, enabled } : a))
    );
  };

  const handleDelete = async (id: string) => {
    await invoke("delete_alert", { id });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleScanNow = async () => {
    try {
      const result = await invoke<string>("scan_now");
      alert(result);
    } catch (e) {
      alert(`Scan failed: ${e}`);
    }
    // Refresh list
    invoke<Alert[]>("list_alerts").then(setAlerts).catch(console.error);
  };

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>LeBonBot</h1>

      <StatusPanel />

      <div style={{ margin: "16px 0", display: "flex", gap: 8 }}>
        <Link href="/alerts/new">
          <button>+ New Alert</button>
        </Link>
        <Link href="/settings">
          <button>Settings</button>
        </Link>
        <button onClick={handleScanNow}>Scan Now</button>
      </div>

      {alerts.length === 0 && <p>No alerts configured. Create one to start scanning.</p>}

      {alerts.map((alert) => (
        <div
          key={alert.id}
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
            opacity: alert.enabled ? 1 : 0.5,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{alert.name}</strong>
            <span>{alert.enabled ? "🟢 Active" : "⏸ Paused"}</span>
          </div>
          <p>
            {alert.location} · {alert.property_type}
            {alert.price_min && ` · ≥${alert.price_min}€`}
            {alert.price_max && ` · ≤${alert.price_max}€`}
          </p>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            Every {alert.scan_interval_minutes} min
            {alert.last_scan_at &&
              ` · Last: ${new Date(alert.last_scan_at).toLocaleString()}`}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/alerts/${alert.id}`}>
              <button>Edit</button>
            </Link>
            <button onClick={() => handleToggle(alert.id, !alert.enabled)}>
              {alert.enabled ? "Pause" : "Resume"}
            </button>
            <button
              onClick={() => handleDelete(alert.id)}
              style={{ color: "red" }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
```

#### 18. Create Alert Page
**File**: `src/app/alerts/new/page.tsx`
**Changes**: NEW — Create alert form page using shared AlertForm.

```tsx
"use client";

import { useRouter } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";
import AlertForm from "../../../components/AlertForm";

export default function NewAlert() {
  const router = useRouter();

  const handleSubmit = async (data: Record<string, unknown>) => {
    await invoke("create_alert", data);
    router.push("/");
  };

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>New Alert</h1>
      <AlertForm onSubmit={handleSubmit} />
    </main>
  );
}
```

#### 19. Edit Alert Page
**File**: `src/app/alerts/[id]/page.tsx`
**Changes**: NEW — Edit alert form page loading existing data into shared AlertForm.

```tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import AlertForm from "../../../components/AlertForm";

interface Alert {
  id: string;
  name: string;
  price_min: number | null;
  price_max: number | null;
  location: string;
  radius_km: number;
  property_type: string;
  surface_min: number | null;
  rooms_min: number | null;
  furnished: boolean | null;
  new_construction: boolean | null;
  keywords: string[];
  relaxed_mode: boolean;
  scan_interval_minutes: number;
}

// Required by Next.js static export for dynamic routes.
// At build time, Tauri IPC is unavailable — returns a placeholder.
export function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function EditAlert() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [alert, setAlert] = useState<Alert | null>(null);

  useEffect(() => {
    invoke<Alert[]>("list_alerts").then((alerts) => {
      const found = alerts.find((a) => a.id === id);
      if (found) setAlert(found);
    });
  }, [id]);

  const handleSubmit = async (data: Record<string, unknown>) => {
    await invoke("update_alert", { id, ...data });
    router.push("/");
  };

  if (!alert) return <p>Loading...</p>;

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>Edit Alert</h1>
      <AlertForm initial={alert} onSubmit={handleSubmit} />
    </main>
  );
}
```

#### 20. Settings Page
**File**: `src/app/settings/page.tsx`
**Changes**: NEW — LLM provider, API key, model, Ollama endpoint, Telegram chat ID, Chrome path.

```tsx
"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRouter } from "next/navigation";

interface Settings {
  llm_provider: string;
  llm_api_key: string;
  llm_model: string;
  ollama_endpoint: string;
  telegram_chat_id: string;
  chrome_path: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({
    llm_provider: "openai",
    llm_api_key: "",
    llm_model: "gpt-4o-mini",
    ollama_endpoint: "http://localhost:11434/v1",
    telegram_chat_id: "",
    chrome_path: null,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then(setSettings)
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    await invoke("update_settings", settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>Settings</h1>

      <label>
        LLM Provider
        <select
          value={settings.llm_provider}
          onChange={(e) =>
            setSettings({ ...settings, llm_provider: e.target.value })
          }
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </label>

      {settings.llm_provider !== "ollama" && (
        <label>
          API Key
          <input
            type="password"
            value={settings.llm_api_key}
            onChange={(e) =>
              setSettings({ ...settings, llm_api_key: e.target.value })
            }
            placeholder="sk-..."
          />
        </label>
      )}

      <label>
        Model
        <input
          value={settings.llm_model}
          onChange={(e) =>
            setSettings({ ...settings, llm_model: e.target.value })
          }
          placeholder="gpt-4o-mini"
        />
      </label>

      {settings.llm_provider === "ollama" && (
        <label>
          Ollama Endpoint
          <input
            value={settings.ollama_endpoint}
            onChange={(e) =>
              setSettings({ ...settings, ollama_endpoint: e.target.value })
            }
            placeholder="http://localhost:11434/v1"
          />
        </label>
      )}

      <label>
        Telegram Chat ID
        <input
          value={settings.telegram_chat_id}
          onChange={(e) =>
            setSettings({ ...settings, telegram_chat_id: e.target.value })
          }
          placeholder="123456789"
        />
      </label>

      <label>
        Chrome Path{" "}
        <small style={{ color: "#666" }}>
          {settings.chrome_path
            ? "(auto-detected)"
            : "(not found — set manually)"}
        </small>
        <input
          value={settings.chrome_path || ""}
          onChange={(e) =>
            setSettings({
              ...settings,
              chrome_path: e.target.value || null,
            })
          }
          placeholder="/usr/bin/google-chrome"
        />
      </label>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button onClick={handleSave}>Save</button>
        <button onClick={() => router.push("/")}>Back</button>
        {saved && <span style={{ color: "green" }}>✓ Saved</span>}
      </div>
    </main>
  );
}
```

#### 21. Shared Alert Form Component
**File**: `src/components/AlertForm.tsx`
**Changes**: NEW — Shared form for creating and editing alerts.

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PROPERTY_TYPES = [
  "appartement",
  "maison",
  "studio",
  "loft",
  "terrain",
  "parking",
];

interface AlertFormProps {
  initial?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}

export default function AlertForm({ initial, onSubmit }: AlertFormProps) {
  const router = useRouter();
  const [name, setName] = useState((initial?.name as string) || "");
  const [priceMin, setPriceMin] = useState(
    initial?.price_min != null ? String(initial.price_min) : ""
  );
  const [priceMax, setPriceMax] = useState(
    initial?.price_max != null ? String(initial.price_max) : ""
  );
  const [location, setLocation] = useState(
    (initial?.location as string) || ""
  );
  const [radiusKm, setRadiusKm] = useState(
    initial?.radius_km != null ? String(initial.radius_km) : "10"
  );
  const [propertyType, setPropertyType] = useState(
    (initial?.property_type as string) || "appartement"
  );
  const [surfaceMin, setSurfaceMin] = useState(
    initial?.surface_min != null ? String(initial.surface_min) : ""
  );
  const [roomsMin, setRoomsMin] = useState(
    initial?.rooms_min != null ? String(initial.rooms_min) : ""
  );
  const [furnished, setFurnished] = useState(
    initial?.furnished != null ? String(initial.furnished) : ""
  );
  const [newConstruction, setNewConstruction] = useState(
    initial?.new_construction != null
      ? String(initial.new_construction)
      : ""
  );
  const [keywords, setKeywords] = useState(
    initial?.keywords
      ? (initial.keywords as string[]).join(", ")
      : ""
  );
  const [relaxedMode, setRelaxedMode] = useState(
    (initial?.relaxed_mode as boolean) || false
  );
  const [interval, setInterval_] = useState(
    initial?.scan_interval_minutes != null
      ? String(initial.scan_interval_minutes)
      : "15"
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        name,
        priceMin: priceMin ? parseFloat(priceMin) : null,
        priceMax: priceMax ? parseFloat(priceMax) : null,
        location,
        radiusKm: parseFloat(radiusKm) || 10,
        propertyType,
        surfaceMin: surfaceMin ? parseFloat(surfaceMin) : null,
        roomsMin: roomsMin ? parseInt(roomsMin) : null,
        furnished: furnished === "" ? null : furnished === "true",
        newConstruction:
          newConstruction === "" ? null : newConstruction === "true",
        keywords: keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        relaxedMode,
        scanIntervalMinutes: parseInt(interval) || 15,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Name *
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <div style={{ display: "flex", gap: 16 }}>
        <label style={{ flex: 1 }}>
          Min Price (€)
          <input
            type="number"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            placeholder="0"
          />
        </label>
        <label style={{ flex: 1 }}>
          Max Price (€)
          <input
            type="number"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            placeholder="500000"
          />
        </label>
      </div>

      <label>
        Location *
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Paris 75001"
          required
        />
      </label>

      <label>
        Radius (km)
        <input
          type="number"
          value={radiusKm}
          onChange={(e) => setRadiusKm(e.target.value)}
          min="1"
          max="100"
        />
      </label>

      <label>
        Property Type
        <select
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value)}
        >
          {PROPERTY_TYPES.map((pt) => (
            <option key={pt} value={pt}>
              {pt}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: "flex", gap: 16 }}>
        <label style={{ flex: 1 }}>
          Min Surface (m²)
          <input
            type="number"
            value={surfaceMin}
            onChange={(e) => setSurfaceMin(e.target.value)}
          />
        </label>
        <label style={{ flex: 1 }}>
          Min Rooms
          <input
            type="number"
            value={roomsMin}
            onChange={(e) => setRoomsMin(e.target.value)}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <label style={{ flex: 1 }}>
          Furnished
          <select
            value={furnished}
            onChange={(e) => setFurnished(e.target.value)}
          >
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label style={{ flex: 1 }}>
          New Construction
          <select
            value={newConstruction}
            onChange={(e) => setNewConstruction(e.target.value)}
          >
            <option value="">Any</option>
            <option value="true">New only</option>
            <option value="false">Old only</option>
          </select>
        </label>
      </div>

      <label>
        Keywords (comma-separated)
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="balcon, vue dégagée, calme"
        />
      </label>

      <label>
        Scan Interval (minutes, min 10)
        <input
          type="number"
          value={interval}
          onChange={(e) => setInterval_(e.target.value)}
          min="10"
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={relaxedMode}
          onChange={(e) => setRelaxedMode(e.target.checked)}
        />{" "}
        Relaxed matching (±12.5% price, −20% surface, ±1 room, ×1.5 radius)
      </label>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Alert"}
        </button>
        <button type="button" onClick={() => router.push("/")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
```

#### 22. Status Panel Component
**File**: `src/components/StatusPanel.tsx`
**Changes**: NEW — Bot status display with icon, text, and manual scan trigger.

```tsx
"use client";

import useBotStatus from "../hooks/useBotStatus";

export default function StatusPanel() {
  const status = useBotStatus();

  const config = {
    idle: { icon: "⏳", text: "Idle — waiting for next scan", color: "#666" },
    active: { icon: "🔍", text: "Scanning leboncoin...", color: "#0070f3" },
    error: { icon: "⚠️", text: "Error — check settings or tray", color: "#e00" },
  }[status] || { icon: "❓", text: "Unknown", color: "#666" };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 6,
        background: "#f5f5f5",
        color: config.color,
      }}
    >
      <span style={{ fontSize: "1.2rem" }}>{config.icon}</span>
      <span>{config.text}</span>
    </div>
  );
}
```

#### 23. Bot Status Hook
**File**: `src/hooks/useBotStatus.ts`
**Changes**: NEW — React hook listening to `bot-status` events from Rust.

```ts
"use client";

import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export type BotStatus = "idle" | "active" | "error";

export default function useBotStatus(): BotStatus {
  const [status, setStatus] = useState<BotStatus>("idle");

  useEffect(() => {
    const unlistenPromise = listen<BotStatus>("bot-status", (event) => {
      setStatus(event.payload);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return status;
}
```

### Success Criteria

#### Automated Verification
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Next.js builds: `npx next build`
- [ ] Rust compiles: `cd src-tauri && cargo check`
- [ ] Rust types serialize/deserialize: `cargo test` (if tests added)

#### Manual Verification
- [ ] `npm run tauri dev` launches the Next.js config panel inside a Tauri window
- [ ] Creating a new alert with price range, location, property type, surface, rooms, furnished, and keywords persists and displays in the alert list
- [ ] Editing an alert via `/alerts/[id]` loads existing data and saves updates
- [ ] Deleting an alert removes it from the list
- [ ] Toggling an alert enables/disables it visually (opacity + Active/Paused label)
- [ ] Settings page loads saved values and persists new values
- [ ] System tray icon appears with Show/Hide and Quit menu items
- [ ] Closing the main window hides it to the tray (CloseRequested → hide + prevent_close)
- [ ] `useBotStatus()` hook receives "idle" status on startup (event emitted by tray setup)
- [ ] Alert form enforces minimum scan interval of 10 minutes
- [ ] Alert roundtrip: create alert → edit alert → delete alert all persist correctly across restarts

---

## Phase 2: Scraper (Sidecar Binary)

### Overview

Build the Node.js Playwright sidecar as a standalone binary. It reads a scrape payload from stdin, launches the user's real Chrome headless, navigates to leboncoin.fr search pages, extracts `__NEXT_DATA__` JSON, detects DataDome challenges, normalizes listings, and runs LLM keyword matching via Vercel AI SDK.

### Changes Required

#### 1. Sidecar Package Config
**File**: `sidecar/package.json`
**Changes**: NEW — Node.js deps: playwright-core, ai SDK, zod. Bundle target via @yao-pkg/pkg.

```json
{
  "name": "lebonbot-sidecar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "bundle": "pkg dist/index.js --targets node20-linux-x64,node20-macos-arm64,node20-win-x64 --output binaries/scraper"
  },
  "dependencies": {
    "playwright-core": "^1.45.0",
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@yao-pkg/pkg": "^5.15.0",
    "@types/node": "^20.0.0"
  }
}
```

#### 2. Sidecar TypeScript Config
**File**: `sidecar/tsconfig.json`
**Changes**: NEW — TypeScript config for sidecar, with `nodenext` module resolution for `.js` extension imports.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"]
}
```

#### 3. Sidecar Entry Point
**File**: `sidecar/src/index.ts`
**Changes**: NEW — Stdin JSON parser, action router, stdout JSON writer.

```typescript
import { scrape } from "./scraper.js";

interface Payload {
  action: string;
  url: string;
  keywords: string[];
  llm_provider: string;
  llm_api_key: string;
  llm_model: string;
  ollama_endpoint: string;
  chrome_path?: string;
  relevance_threshold?: number;
}

interface Output {
  page_type: "results" | "challenge" | "error" | "empty";
  listings: ListingData[];
  keyword_matches: KeywordMatch[];
  error?: string;
}

interface ListingData {
  id: string;
  title: string;
  price: number | null;
  location: string;
  surface: number | null;
  rooms: number | null;
  url: string;
  photo_url: string | null;
}

interface KeywordMatch {
  listing_id: string;
  keyword: string;
  relevance: number;
}

async function main(): Promise<void> {
  // Read entire stdin (Rust drops child to send EOF)
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");

  if (!raw.trim()) {
    console.error("no stdin payload received");
    process.exit(1);
  }

  let payload: Payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.error("invalid JSON payload:", e);
    process.exit(1);
  }

  if (payload.action !== "scrape") {
    console.error("unknown action:", payload.action);
    process.exit(1);
  }

  const output: Output = await scrape(payload);

  // Write result as single JSON line to stdout
  process.stdout.write(JSON.stringify(output) + "\n");
}

main().catch((e) => {
  const errorOutput: Output = {
    page_type: "error",
    listings: [],
    keyword_matches: [],
    error: e instanceof Error ? e.message : String(e),
  };
  process.stdout.write(JSON.stringify(errorOutput) + "\n");
  process.exit(0);
});
```

#### 4. Playwright Scraper
**File**: `sidecar/src/scraper.ts`
**Changes**: NEW — Chrome launch, leboncoin navigation, `__NEXT_DATA__` extraction, DataDome detection, listing normalization.

```typescript
import { chromium } from "playwright-core";
import { existsSync } from "fs";
import { matchKeywords } from "./llm.js";

const CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function detectChromePath(override?: string | null): string | null {
  // Return explicit override from settings first
  if (override) return override;

  // Return explicit path from env if set
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  // Check common paths
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

interface NextDataListing {
  list_id?: number;
  subject?: string;
  price?: number[];
  location?: { city?: string; zipcode?: string; label?: string };
  attributes?: Array<{ key: string; value: string; value_label?: string }>;
  images?: { urls?: string[]; thumb_url?: string };
  url?: string;
}

interface ListingData {
  id: string;
  title: string;
  price: number | null;
  location: string;
  surface: number | null;
  rooms: number | null;
  url: string;
  photo_url: string | null;
}

interface Payload {
  url: string;
  keywords: string[];
  llm_provider: string;
  llm_api_key: string;
  llm_model: string;
  ollama_endpoint: string;
  chrome_path?: string;
  relevance_threshold?: number;
}

interface KeywordMatch {
  listing_id: string;
  keyword: string;
  relevance: number;
}

interface ScrapeOutput {
  page_type: "results" | "challenge" | "error" | "empty";
  listings: ListingData[];
  keyword_matches: KeywordMatch[];
  error?: string;
}

function normalizeListings(raw: NextDataListing[]): ListingData[] {
  return raw
    .filter((l) => l.list_id)
    .map((l) => {
      const attr = l.attributes || [];
      const getAttr = (key: string) =>
        attr.find((a) => a.key === key)?.value_label ||
        attr.find((a) => a.key === key)?.value ||
        null;

      const surfaceRaw = getAttr("surface");
      const roomsRaw = getAttr("rooms");
      const priceRaw = l.price?.[0];

      return {
        id: String(l.list_id),
        title: l.subject || "",
        price: typeof priceRaw === "number" ? priceRaw : null,
        location: l.location?.city || l.location?.label || "",
        surface: surfaceRaw ? parseFloat(surfaceRaw) : null,
        rooms: roomsRaw ? parseInt(roomsRaw) : null,
        url: l.url || `https://www.leboncoin.fr/ad/ventes_immobilieres/${l.list_id}`,
        photo_url: l.images?.thumb_url || l.images?.urls?.[0] || null,
      };
    });
}

function detectChallenge(html: string): boolean {
  // Only consider it a challenge when DataDome-specific tokens are present.
  // Missing __NEXT_DATA__ without DataDome markers is handled as page_type: "empty" in scrape().
  return (
    html.includes("c.datadome.co/captcha/") ||
    html.includes("datadome")
  );
}

export async function scrape(payload: Payload): Promise<ScrapeOutput> {
  const chromePath = detectChromePath(payload.chrome_path);
  if (!chromePath) {
    return {
      page_type: "error",
      listings: [],
      keyword_matches: [],
      error: "Chrome not found. Set CHROME_PATH or install Google Chrome.",
    };
  }

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "fr-FR",
    });

    const page = await context.newPage();

    // Navigate to leboncoin search page
    await page.goto(payload.url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Small delay to let JS render (DataDome collector, Next.js hydration)
    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();

    // DataDome challenge detection
    if (detectChallenge(html)) {
      await context.close();
      return {
        page_type: "challenge",
        listings: [],
        keyword_matches: [],
      };
    }

    // Extract __NEXT_DATA__ JSON
    const nextData = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return null;
      try {
        return JSON.parse(el.textContent || "{}");
      } catch {
        return null;
      }
    });

    await context.close();

    if (!nextData) {
      return {
        page_type: "empty",
        listings: [],
        keyword_matches: [],
      };
    }

    // Navigate __NEXT_DATA__ structure to find listings
    // Structure: props.pageProps.searchData.ads or similar
    const props = nextData.props?.pageProps;
    const searchData = props?.searchData || props?.listingContainer?.searchData;
    const rawListings: NextDataListing[] = searchData?.ads || searchData?.listings || [];

    const listings = normalizeListings(rawListings);

    if (listings.length === 0) {
      return { page_type: "empty", listings: [], keyword_matches: [] };
    }

    // LLM keyword matching
    let keywordMatches: KeywordMatch[] = [];
    if (payload.keywords.length > 0) {
      try {
        keywordMatches = await matchKeywords(
          listings,
          payload.keywords,
          payload.llm_provider,
          payload.llm_api_key,
          payload.llm_model,
          payload.ollama_endpoint
        );
      } catch (e) {
        console.error("LLM keyword matching failed:", e);
        // Return listings without matches — caller can decide
      }
    }

    return {
      page_type: "results",
      listings,
      keyword_matches: keywordMatches,
    };
  } catch (e) {
    return {
      page_type: "error",
      listings: [],
      keyword_matches: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
```

#### 5. LLM Keyword Matching
**File**: `sidecar/src/llm.ts`
**Changes**: NEW — Vercel AI SDK multi-provider structured output for keyword relevance scoring.

```typescript
import { generateText, Output } from "ai";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

interface ListingData {
  id: string;
  title: string;
  location: string;
  surface: number | null;
  rooms: number | null;
  price: number | null;
}

interface KeywordMatch {
  listing_id: string;
  keyword: string;
  relevance: number;
}

const matchSchema = z.object({
  matches: z.array(
    z.object({
      listing_id: z.string().describe("The listing ID from the input"),
      keyword: z.string().describe("The matched keyword"),
      relevance: z
        .number()
        .min(0)
        .max(1)
        .describe("Relevance score: 0 = not relevant, 1 = highly relevant"),
    })
  ),
});

function buildPrompt(
  listings: ListingData[],
  keywords: string[],
  threshold: number
): string {
  const listingTexts = listings
    .map(
      (l) =>
        `[${l.id}] ${l.title} | ${l.location} | ${l.surface || "?"}m² | ${
          l.rooms || "?"
        } rooms | ${l.price != null ? l.price + "€" : "?"}`
    )
    .join("\n");

  return `Analyze these real estate listings for keyword relevance.

Keywords: ${keywords.join(", ")}

For each listing below, determine which keywords match and how relevant they are (0-1 scale).
Consider semantic similarity: "belle vue" matches "vue panoramique", "calme" matches "quartier tranquille", etc.
Only include matches with relevance >= ${threshold}.

Listings:
${listingTexts}`;
}

function getModel(
  provider: string,
  apiKey: string,
  model: string,
  ollamaEndpoint: string
) {
  switch (provider) {
    case "openai":
      return openai(model || "gpt-4o-mini", { apiKey });
    case "anthropic":
      return anthropic(model || "claude-haiku-4-5-20250514", { apiKey });
    case "ollama": {
      const ollama = createOpenAI({
        baseURL: ollamaEndpoint || "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      return ollama(model || "llama3.1:8b");
    }
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export async function matchKeywords(
  listings: ListingData[],
  keywords: string[],
  provider: string,
  apiKey: string,
  model: string,
  ollamaEndpoint: string,
  relevanceThreshold?: number
): Promise<KeywordMatch[]> {
  const threshold = relevanceThreshold ?? 0.5;
  const prompt = buildPrompt(listings, keywords, threshold);

  const modelInstance = getModel(provider, apiKey, model, ollamaEndpoint);

  const { output } = await generateText({
    model: modelInstance,
    output: Output.object({ schema: matchSchema }),
    prompt,
    temperature: 0,
    maxTokens: 4096,
  });

  return output.matches || [];
}
```

### Success Criteria

#### Automated Verification
- [ ] TypeScript compiles: `cd sidecar && npx tsc --noEmit`
- [ ] Sidecar builds: `cd sidecar && npm run build`
- [ ] **Sidecar bundle rename**: `@yao-pkg/pkg` outputs platform-specific names (e.g., `scraper-linux-x64`); must be renamed to Tauri target-triple convention:
  - Linux: `mv binaries/scraper-linux-x64 src-tauri/binaries/scraper-x86_64-unknown-linux-gnu`
  - macOS ARM: `mv binaries/scraper-macos-arm64 src-tauri/binaries/scraper-aarch64-apple-darwin`
  - Windows: `mv binaries/scraper-win-x64.exe src-tauri/binaries/scraper-x86_64-pc-windows-msvc.exe`
- [ ] Sidecar accepts stdin JSON: `echo '{"action":"scrape","url":"https://example.com","keywords":[],"llm_provider":"","llm_api_key":"","llm_model":"","ollama_endpoint":""}' | node dist/index.js` prints valid JSON to stdout
- [ ] Chrome detection returns non-null when Chrome installed: `CHROME_PATH` env var or common paths resolve

#### Manual Verification
- [ ] Sidecar launched standalone with a real leboncoin.fr search URL returns valid listings JSON
- [ ] DataDome challenge page is detected and returns `page_type: "challenge"`
- [ ] `__NEXT_DATA__` extraction works for various property types (appartement, maison, terrain)
- [ ] LLM keyword matching returns `KeywordMatch[]` with relevance scores for at least one configured provider

---

## Phase 3: Integration

### Overview

Wire the sidecar into the Rust backend. Replace the scanner.rs and telegram.rs stubs with full implementations: background scheduler with sidecar spawn (drop(child) pattern), two-phase serde deserialization, listing dedup against seen_listings.json, Telegram sendPhoto/sendMessage with rate limiting, search URL builder, and relaxed matching logic.

### Changes Required

#### 1. Scanner — Full Implementation
**File**: `src-tauri/src/scanner.rs`
**Changes**: MODIFY — Replace stub with full background scheduler, sidecar spawn, two-phase serde, alert routing, dedup, relaxed matching.

```rust
use crate::persistence;
use crate::telegram;
use crate::types::{
    AppState, BotStatus, KeywordMatch, ListingData, SeenListing, Settings, SidecarOutput, SidecarPayload,
};
use chrono::Utc;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const SCHEDULER_TICK_SECS: u64 = 60;
const TELEGRAM_BOT_TOKEN: &str = "YOUR_BOT_TOKEN_HERE";

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
                    .map(|t| {
                        (now - t).num_minutes() >= a.scan_interval_minutes as i64
                    })
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
                    let matches = filter_matches(&output.keyword_matches, listing, alert, settings.relevance_threshold);
                    let is_match = if alert.relaxed_mode {
                        relaxed_match(listing, alert) || !matches.is_empty()
                    } else {
                        !matches.is_empty()
                    };
                    if !is_match {
                        continue;
                    }

                    // Send telegram notification
                    if let Err(e) = telegram::send_notification(
                        chat_id,
                        listing,
                        &matches,
                        TELEGRAM_BOT_TOKEN,
                    )
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

    let (mut rx, mut child) = sidecar
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

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

    let page_type = value["page_type"]
        .as_str()
        .unwrap_or("error");

    if page_type != "results" && page_type != "challenge" && page_type != "empty" && page_type != "error" {
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
        alert.location,
        prop_type
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
    alert: &crate::types::Alert,
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
```

#### 2. Telegram — Full Implementation
**File**: `src-tauri/src/telegram.rs`
**Changes**: MODIFY — Replace stub with sendPhoto (primary), sendMessage (fallback), rate limit handling, HTML caption builder.

```rust
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

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "photo": photo_url,
            "caption": caption,
            "parse_mode": "HTML",
            "disable_web_page_preview": false,
        }))
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    match resp.status().as_u16() {
        200 => Ok(()),
        429 => {
            // Rate limited — parse retry_after and wait
            let body: serde_json::Value = resp
                .json()
                .await
                .unwrap_or_default();
            let retry_after = body["parameters"]["retry_after"]
                .as_u64()
                .unwrap_or(5);
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

async fn send_message(
    chat_id: &str,
    text: &str,
    bot_token: &str,
) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": true,
        }))
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("Telegram sendMessage failed: HTTP {}", resp.status()))
    }
}
```

#### 3. Commands — No changes needed
**File**: `src-tauri/src/commands.rs`
**Changes**: None. The `scan_now` command from Phase 1 already delegates to `crate::scanner::scan_due_alerts(app)`, which is now the full implementation. No frontmatter or handler changes required — the Phase 3 scanner.rs replacement wires it transparently.

### Success Criteria

#### Automated Verification
- [ ] Rust compiles: `cd src-tauri && cargo check`
- [ ] `drop(child)` pattern correct: sidecar spawn → write → drop → stdout collected → terminated
- [ ] Two-phase serde: DataDome HTML does NOT cause deserialization error — `page_type: "challenge"` returned
- [ ] Telegram URL encoding: `build_search_url` produces valid leboncoin.fr URLs for all property types

#### Manual Verification
- [ ] Background scheduler fires every 60s and checks for due alerts
- [ ] Manual "Scan Now" button triggers immediate scan
- [ ] Alert `last_scan_at` is updated after each successful scan
- [ ] DataDome challenge is detected and tray shows Error status
- [ ] Telegram notification contains listing title, price, location, surface, rooms, keywords, URL
- [ ] Telegram `sendPhoto` uses listing photo URL; fallback to `sendMessage` if photo unavailable
- [ ] Listing dedup: same listing is NOT re-notified for the same alert
- [ ] Rate limiting: 350ms delay between Telegram messages when notifying multiple listings
- [ ] Tray icon updates: Idle (⏳) → Active (🔍 during scan) → back to Idle

---

## Testing Strategy

### Automated
- `npx tsc --noEmit` — TypeScript compilation (phases 1, 2)
- `npx next build` — Next.js static export (phase 1)
- `cd src-tauri && cargo check` — Rust compilation (phases 1, 3)
- `cd sidecar && npx tsc --noEmit` — Sidecar TypeScript compilation (phase 2)
- `cd sidecar && npm run build` — Sidecar build (phase 2)
- Sidecar stdin smoke test: echo JSON → node dist/index.js prints valid JSON to stdout (phase 2)
- `drop(child)` correctness: sidecar receives EOF after stdin write (phase 3)
- Two-phase serde: DataDome HTML → `page_type: "challenge"` not deserialization error (phase 3)

### Manual Testing Steps
1. `npm run tauri dev` — verify app launches in Tauri window with config panel
2. Create/edit/delete/toggle alerts — verify persistence across restarts
3. Settings page — verify all fields persist
4. System tray — verify Show/Hide/Quit, close-to-tray, Linux left-click menu
5. Sidecar standalone test with real leboncoin search URL
6. DataDome challenge detection against actual block pages
7. End-to-end: alert created → scheduler fires → sidecar runs → Telegram notification received
8. Listing dedup: same listing not re-notified
9. Rate limiting: 350ms gap between notifications

## Performance Considerations

- **Sidecar binary size**: ~35-50MB (playwright-core + Node.js runtime via @yao-pkg/pkg, no Chromium)
- **Memory**: Playwright + real Chrome headless ~200-300MB during scan ticks; idle ~0MB (sidecar not running)
- **LLM cost at 10-min intervals**: GPT-4o-mini ~$2.59/month, Claude Haiku ~$20.52/month, Ollama $0
- **Scan latency**: ~5-10s per tick (browser launch + page load + extraction + LLM call)
- **Telegram**: 350ms inter-message delay; worst case 50 new listings = ~17.5s

## Migration Notes

_No existing data to migrate — greenfield project._

## Developer Context

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 2 §1 (sidecar/package.json) | <n/a> | blocker | actionability | Phase 2 `package.json` has `"build": "tsc"` but no `tsconfig.json` is provided for the sidecar directory; `tsc` without a tsconfig cannot resolve `.js` extension imports (`"./scraper.js"`) when `"type": "module"` is set, so Phase 2's "TypeScript compiles" success criterion will fail | Add a `sidecar/tsconfig.json` with `"module": "nodenext"` (or `"bundler"`), `"moduleResolution": "nodenext"`, `"target": "ES2022"`, and `"outDir": "dist"` | applied: added sidecar/tsconfig.json as Phase 2 §2 |
| code     | Phase 2 §4 (llm.ts) | <n/a> | blocker | code-quality | `let modelInstance;` at `llm.ts` line ~65 has no type annotation or initializer; TypeScript strict mode infers `any` and emits `TS18046: Variable 'modelInstance' implicitly has type 'any'`, failing `npx tsc --noEmit` | Add explicit type: `let modelInstance: ReturnType<typeof openai>;` or restructure as `const modelInstance = …` per provider branch | applied: extracted getModel() helper, replaced let with const through return-type inference |
| code     | Phase 3 §1 (scanner.rs) / Phase 1 §10 (types.rs) | <n/a> | blocker | actionability | Phase 3's `tick` builds a `SidecarPayload` but never includes `chrome_path` from `Settings`; the sidecar uses only `process.env.CHROME_PATH` and hardcoded paths, so the user's Chrome path override in the Settings UI is a dead setting with no effect on behavior | Add `chrome_path: settings.chrome_path.clone()` to `SidecarPayload`, add `chrome_path?: string` to the sidecar's `Payload` interface, and make `detectChromePath` accept the override as a parameter | applied: chrome_path propagated through SidecarPayload → sidecar Payload → detectChromePath parameter |
| code     | Phase 2 §1 (sidecar/package.json) / Phase 1 §4 (tauri.conf.json) | <n/a> | blocker | actionability | `@yao-pkg/pkg` with `--targets node20-linux-x64` outputs `binaries/scraper-linux-x64`, but Tauri v2 sidecar naming expects `scraper-x86_64-unknown-linux-gnu` (Rust target triple); the binary will not be found at `spawn_sidecar` time, failing Phase 3's "sidecar not found" path | Document the required rename: `mv binaries/scraper-linux-x64 src-tauri/binaries/scraper-x86_64-unknown-linux-gnu`, and repeat per target platform | applied: added bundled binary rename step to Phase 2 automated verification criteria |
| code     | Phase 3 §1 (scanner.rs) / Phase 2 §4 (llm.ts) | <n/a> | concern | codebase-fit | Phase 2's LLM prompt says "Only include matches with relevance >= 0.3" but Phase 3's `filter_matches` discards anything below `relevance >= 0.5` — the LLM returns matches the Rust layer immediately throws away, wasting tokens and causing inconsistent behavior between the prompt's stated threshold and the actual gate | Align the thresholds: either raise the LLM prompt minimum to 0.5, or lower `filter_matches` to 0.3 and remove the double-filter | applied: made relevance_threshold configurable in Settings (default 0.5), propagated through SidecarPayload → LLM prompt + filter_matches |
| code     | Phase 3 §1 (scanner.rs) — `build_search_url` | <n/a> | concern | codebase-fit | `build_search_url` never appends a `radius` parameter to the leboncoin URL; the `Alert.radius_km` field is only used in `relaxed_match` (client-side ×1.5 multiplier) but has zero effect on the server-side search radius, so users always get leboncoin's default radius regardless of configuration | Append `&radius={radius_km}` (or leboncoin's equivalent `&locations={location}__{radius_km}km` format) to the search URL | applied: radius appended as meters to search URL (km*1000) |
| code     | Phase 3 §1 (scanner.rs) — `spawn_sidecar` | <n/a> | concern | code-quality | `spawn_sidecar` has no timeout on the sidecar process — if the Playwright process hangs (e.g., navigation timeout exceeded but not caught, zombie Chrome), the `while let Some(event) = rx.recv().await` loop blocks forever, freezing the entire scheduler | Wrap the event collection in `tokio::time::timeout(Duration::from_secs(120), ...)` to guarantee forward progress | applied: wrapped event collection in tokio::time::timeout(120s) |
| code     | Phase 3 §1 (scanner.rs) — `tick` inner loop | <n/a> | concern | code-quality | When the sidecar returns `page_type: "error"` (e.g., Chrome not found), the `SidecarOutput.error` field is never checked or logged; the listing loop silently processes zero items and the user gets no indication that a specific alert's scan failed | After `Ok(output)` but before the listing loop, add `if output.page_type == crate::types::PageType::Error { log::error!("sidecar error: {:?}", output.error); continue; }` | applied: added PageType::Error check with log::error and status update |
| code     | Phase 3 §1 (scanner.rs) — `spawn_sidecar` event loop | <n/a> | concern | code-quality | The `_ => {}` catch-all in the `CommandEvent` match silently swallows `CommandEvent::Error(String)` — if the sidecar process experiences an IO error, no log is emitted and the loop may wait indefinitely for a `Terminated` event that arrives on a now-stale channel | Add a `CommandEvent::Error(msg) => { log::error!("sidecar IO error: {}", msg); }` arm | applied: added CommandEvent::Error arm with log::error (bundled with timeout edit) |
| code     | Phase 1 §13 (scanner.rs stub) / Phase 1 §5 (Cargo.toml) | <n/a> | concern | code-quality | The `log` crate (`log = "0.4"`) is added to `Cargo.toml` and used via `log::error!` / `log::warn!` in Phase 3, but no logger implementation (e.g., `env_logger`, `simple_logger`) is initialized; all log calls are silently discarded at runtime | Add `env_logger = "0.11"` to `Cargo.toml` and call `env_logger::init()` at the top of `lib::run()` | applied: added env_logger to Cargo.toml + env_logger::init() in lib::run() |
| code     | Phase 2 §3 (scraper.ts) — `detectChallenge` | <n/a> | concern | code-quality | `detectChallenge` returns `true` when `!html.includes('"__NEXT_DATA__"')` — this classifies any non-Next.js page (404, maintenance page, network error HTML) as a DataDome challenge, causing false-positive "challenge detected" tray warnings and skipped ticks | Narrow the check to require one of the DataDome-specific tokens (`datadome`, `c.datadome.co/captcha/`) before falling through to `__NEXT_DATA__` absence; classify missing-`__NEXT_DATA__`-without-DataDome as `page_type: "empty"` instead | applied: narrowed detectChallenge to DataDome tokens only; __NEXT_DATA__-absence without DataDome → page_type: "empty" |
| code     | Phase 2 §3 (scraper.ts) — `page.waitForTimeout(2000)` | <n/a> | suggestion | code-quality | `page.waitForTimeout` is deprecated in Playwright; the recommended alternative is `await page.waitForSelector(...)` or a manual `new Promise(r => setTimeout(r, 2000))` | Replace with `await new Promise(r => setTimeout(r, 2000))` or use `page.waitForFunction` to detect `__NEXT_DATA__` readiness | applied: replaced with new Promise(r => setTimeout(r, 2000)) |
| code     | Phase 1 §17 (page.tsx) — navigation | <n/a> | suggestion | codebase-fit | The Home page uses raw `<a href>` tags for navigation (`<a href="/alerts/new">`, `<a href="/settings">`), which cause full-page reloads; Next.js convention in the Tauri ecosystem is `<Link>` from `next/link` for client-side transitions | Replace `<a href="...">` with `<Link href="...">` from `next/link` | applied: replaced all <a href> with <Link href> + added import |
| code     | Phase 1 §15 (lib.rs) — `on_window_event` | <n/a> | suggestion | code-quality | `window.hide().unwrap()` in the `CloseRequested` handler will panic if the window handle is already invalid (e.g., rapid double-close on some window managers), crashing the app instead of silently ignoring the error | Replace `.unwrap()` with `let _ = window.hide();` | deferred: low-risk, Tauri handles most cases; follow-up if crashes observed |

_Step 4 coverage review: no findings — no `## Verification Notes` or `## Precedents & Lessons` sections exist in the plan._

## References

- Design: `.rpiv/artifacts/designs/2026-05-22_04-36-13_leboncoin-real-estate-bot.md`
- Research: `.rpiv/artifacts/research/2026-05-22_04-29-28_leboncoin-real-estate-bot-architecture.md`
- FRD: `.rpiv/artifacts/discover/2026-05-22_01-51-10_leboncoin-real-estate-bot.md`
- Tauri v2 sidecar docs: https://v2.tauri.app/develop/sidecar/
- Tauri v2 Next.js guide: https://v2.tauri.app/start/frontend/nextjs/
- Tauri v2 system tray: https://v2.tauri.app/learn/system-tray/
- Vercel AI SDK Output.object(): https://sdk.vercel.ai/docs/reference/ai-sdk-core/output
- drop(child) pattern: https://github.com/tauri-apps/tauri/discussions/4440
