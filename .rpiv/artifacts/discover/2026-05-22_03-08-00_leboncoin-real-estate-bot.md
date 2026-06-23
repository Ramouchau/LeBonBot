---
date: 2026-05-22T03:08:00+0200
author: Ramouchau
commit: c9b370b
branch: main
repository: LeBonBot
topic: "Leboncoin Real Estate Alert Bot"
tags: [intent, frd, leboncoin, tauri, nextjs, playwright, telegram, real-estate, ai, llm]
status: complete
last_updated: 2026-05-22T03:33:00+0200
last_updated_by: Ramouchau
last_updated_note: "Added AI-assisted scraping and AI-enhanced matching decisions"
---

# FRD: Leboncoin Real Estate Alert Bot

## Summary
A desktop application (Tauri + Next.js) that lets users configure real estate search alerts for Leboncoin. The bot scrapes listings via an AI-guided Playwright headless browser — an LLM-powered agent semantically identifies listing cards and extracts structured data, making the scraper resilient to DOM changes without manual selector maintenance. Listings are matched against user-defined criteria (price, location, type, surface, rooms, furnished status, construction age, keywords), with AI-enhanced semantic keyword matching. Matching supports an optional relaxed mode that surfaces near-miss listings. Telegram notifications deliver key details when matching offers appear.

## Problem & Intent
The user wants a public/multi-user service — a desktop app (Tauri) that anyone can install, configure their own Leboncoin search alerts, and receive Telegram notifications when matching real estate offers appear. The core pain point: manually refreshing Leboncoin multiple times a day to catch good deals before they're gone.

## Goals
- Automated, scheduled Leboncoin real estate scraping from the user's desktop
- AI-guided Playwright scraping — LLM-powered semantic DOM extraction, resilient to Leboncoin HTML changes
- AI-enhanced keyword matching — semantic understanding of listing titles/descriptions beyond substring matching
- Multi-parameter alert configuration (price, location, property type, surface, rooms, furnished, construction, keywords)
- Telegram notifications with listing URL and key details on match
- Relaxed matching mode that optionally surfaces near-miss listings
- System tray integration — bot runs in background, app stays out of the way

## Non-Goals
- No built-in payment or transaction handling — the bot finds and notifies, it doesn't message sellers or process payments
- No historical analytics or price trend dashboards
- No mobile app — desktop-only via Tauri (Windows, macOS, Linux)
- No WhatsApp or Signal in v1 — Telegram only initially, WhatsApp/Signal are deferred to future versions

## Functional Requirements
1. The system SHALL allow users to create, edit, delete, and enable/disable search alerts, each with the following configurable parameters: price range (min-max), location (city/zip + radius), property type (apartment/house/studio/loft/land/parking/etc.), minimum surface area (m²), number of rooms, furnished/unfurnished, new/old construction, and free-text keywords.
2. The system SHALL periodically scrape listings from https://www.leboncoin.fr using an AI-guided Playwright headless browser: the scraper SHALL send the page DOM snapshot (or accessibility tree) to an LLM, which SHALL identify listing cards semantically and extract structured data (id, title, price, location, surface, rooms, url, photo_url). The system SHALL fall back to a static CSS-selector extraction path if the LLM call fails or times out.
2a. The scraper SHALL use the Playwright stealth plugin and randomized delays between requests (as per the Anti-Detection Strategy decision).
2b. The LLM SHALL be instructed to detect whether the page is a listing results page or a DataDome CAPTCHA/challenge page. If a challenge is detected, the scraper SHALL abort and log the event.
3. The system SHALL match scraped listings against each active alert's criteria. Keyword matching SHALL use AI-enhanced semantic comparison: the listing title and description SHALL be compared against the user's keywords using an LLM embedding or semantic similarity call, producing a relevance score. A configurable threshold SHALL gate strict-mode keyword matching. The system SHALL support a user-togglable relaxed mode that optionally surfaces listings slightly outside strict parameter bounds (price ±12.5%, surface −20%, rooms ±1, location radius ×1.5, keywords ≥50% match).
4. The system SHALL send a Telegram notification for each new matching listing, containing the listing URL, price, location, surface area, room count, and a photo if available.
5. The system SHALL track previously notified listing IDs in a local SQLite database and SHALL NOT re-notify for the same listing.
6. The system SHALL respect a per-alert, user-configurable scan interval (e.g., every 15 minutes, hourly, twice daily).
7. The system SHALL allow users to configure their Telegram chat ID in app settings (the bot token is shared, shipped with the app).
8. The system SHALL run in the system tray with a status indicator; the bot continues scanning in the background while the main window is closed.
9. The system SHALL store all user data (alert configs, seen listing IDs, settings) locally in SQLite via Tauri's SQL plugin — no data leaves the user's machine except Telegram notifications and Leboncoin HTTP requests.

## Non-Functional Requirements
- **Performance**: Playwright browser instance consumes ~200–300MB RAM. Each scan tick involves 1-3 LLM API calls (DOM extraction + optional semantic keyword matching) adding ~2-5 seconds latency per scan. Scans run sequentially per user to avoid resource spikes. Scan frequency is user-configurable; recommended minimum interval is 10 minutes.
- **AI Cost**: Each scan tick costs ~$0.01-0.05 in LLM API credits (depending on page size and model choice). At 6 scans/hour (10-min interval), monthly cost per active user is ~$4-22. The system SHALL track API usage and warn users approaching configurable monthly limits. The LLM API key SHALL be user-provided and stored locally — not shipped with the app.
- **AI Quality**: The LLM extraction prompt SHALL include few-shot examples of Leboncoin listing cards to maximize extraction accuracy. The system SHALL validate extracted fields against expected types (price is numeric, URL matches leboncoin.fr pattern) and discard malformed listings.
- **Security**: All alert data and seen-listing history is stored locally. The shared Telegram bot token is embedded in the app binary. Users only configure their chat ID — no authentication layer needed. No data is sent to any third-party server.
- **UX / Accessibility**: The Next.js config panel provides alert CRUD and settings. The Tauri system tray icon shows active/inactive bot status. French-only UI (Leboncoin target audience).
- **Reliability**: The bot SHALL handle network failures gracefully — failed scrapes retry on the next scheduled interval. Playwright crashes SHALL trigger an automatic browser restart. Telegram API failures SHALL be logged and retried once.

## Constraints & Assumptions
- **Platform**: Tauri v2 for the desktop shell, Next.js for the UI layer, AI-guided Playwright for scraping (LLM-powered semantic DOM extraction), SQLite via `tauri-plugin-sql` for persistence.
- **LLM Provider**: The scraper SHALL support configurable LLM backends (OpenAI-compatible API, Anthropic, or local Ollama). The user SHALL provide their own API key in app settings. The system SHALL default to a lightweight model (e.g., GPT-4o-mini, Claude Haiku) for DOM extraction and keyword matching to minimize cost and latency.
- **Assumption**: Leboncoin's HTML structure is scrapable via Playwright with stealth plugin. If Leboncoin deploys aggressive anti-bot measures (CAPTCHAs, WebDriver detection), the scraper may need ongoing maintenance.
- **Assumption**: The shared Telegram bot token approach works — Telegram Bot API rate limits (~30 messages/second) are sufficient for a multi-user but not massive audience.
- **Assumption**: Users are on a French-speaking, desktop-capable platform (Windows, macOS, or Linux) and comfortable creating a Telegram account.

## Acceptance Criteria
- [ ] Running `npm run tauri dev` launches the Next.js config panel inside a Tauri window
- [ ] Creating a new alert with price range 200000-300000€, location "Paris 75001" radius 5km, type "Appartement", surface ≥40m², 2 rooms, furnished, and keyword "balcon" persists and displays in the alert list
- [ ] The bot executes an AI-guided Playwright scan of leboncoin.fr/recherche with the alert's parameters: the LLM extracts a list of listings with title, price, location, surface, and URL
- [ ] When the LLM API is unavailable, the scraper falls back to static CSS selectors and still returns listing data
- [ ] AI keyword matching correctly matches "vue dégagée" against a listing titled "Appartement avec belle vue panoramique" while a substring-only matcher would miss it
- [ ] A matching listing triggers a Telegram message containing the listing URL, price, location, and surface
- [ ] Running the same scan twice notifies only for new listings (seen IDs are deduplicated in SQLite)
- [ ] Changing the scan interval to "10 minutes" causes the next scan to fire ~10 minutes after the previous one
- [ ] Closing the main window minimizes the app to the system tray; the bot continues scanning on schedule
- [ ] The system tray icon reflects bot status (active/idle/error)

## Recommended Approach
Tauri v2 desktop app with a Next.js frontend for the alert configuration UI. A Rust-side (or Tauri command-invoked Node.js sidecar) Playwright scraper runs on a per-alert schedule. SQLite stores alert configs and seen listing IDs. Telegram Bot API integration sends structured notifications. The app minimizes to system tray with the bot running in the background.

## Decisions

### Audience & Scope
**Question**: Who is hitting this problem, and what does success look like for them?
**Recommended**: n/a — `intent` question
**Chosen**: Public/multi-user service — anyone who installs the Tauri app can configure their own bot searches and notifications
**Rationale**: Broader reach; the app is self-contained per user with no central server

### Listing Category
**Question**: What exactly should the bot scan for on Leboncoin?
**Recommended**: Real estate — the README hints at "properties" and it's the most common Leboncoin scraping use case
**Chosen**: Real estate (apartments, houses, rentals, purchases)
**Rationale**: Matches README intent; highest-value category where timely alerts matter most

### Non-Goals for v1
**Question**: What should be explicitly out of scope for the first version?
**Recommended**: No payments, no analytics, no mobile app (all selected by developer)
**Chosen**: No built-in payment/transaction, no historical analytics, no mobile app
**Rationale**: Keeps v1 focused on the core loop: scrape → match → notify

### Scan Frequency
**Question**: What frequency and pattern makes sense for scanning?
**Recommended**: Every 15-30 minutes as a good balance
**Chosen**: User-configurable per search alert
**Rationale**: Different users have different urgency levels; hot-market users want 10-min scans, casual users want daily

### Execution Location
**Question**: Where should the bot execute — user's desktop or a shared server?
**Recommended**: Desktop-side via Tauri — optimizes for privacy and zero infra cost
**Chosen**: On the user's desktop via Tauri
**Rationale**: No server to maintain, all data stays local, leverages Tauri's background process capability

### Scraping Method
**Question**: How should the bot fetch listings — headless browser, HTTP parsing, or API reverse-engineering?
**Recommended**: Playwright headless browser — optimizes for reliability against JS-rendered content
**Chosen**: AI-guided Playwright headless browser with LLM-powered semantic DOM extraction
**Rationale**: Static CSS selectors break every time Leboncoin changes their HTML. An LLM can semantically identify "the listing card with a price, title, and location" regardless of DOM structure. The Playwright browser navigates and renders JS; the LLM agent (invoked via the user's own API key) extracts structured data from the page snapshot. Fallback static selectors provide resilience if the LLM call fails.

### Notification Channels
**Question**: Which notification channels should v1 support?
**Recommended**: Both WhatsApp + Telegram for maximum reach
**Chosen**: Telegram first; WhatsApp and Signal deferred to future versions
**Rationale**: Telegram Bot API is the simplest and best-documented notification channel; WhatsApp Business API adds complexity

### Search Parameters
**Question**: What search parameters should users configure per alert?
**Recommended**: All selected — price range, location, property type, surface area
**Chosen**: Price range, location (city/zip + radius), property type, surface area, number of rooms, furnished/unfurnished, new/old construction, keywords (free text)
**Rationale**: Covers all standard Leboncoin real estate filters; keywords allow for niche preferences

### Matching Strictness
**Question**: How strict/loose should filter matching be?
**Recommended**: Exact filter match only — cleanest and simplest
**Chosen**: Relaxed matching with strict-mode toggle (near-miss alerts optional)
**Rationale**: Users want to catch borderline deals; the toggle lets them choose between precision and discovery

### Persistence
**Question**: Where should user alert configs and seen-listing history be stored?
**Recommended**: SQLite via Tauri — zero extra installation steps, handles scale
**Chosen**: SQLite via Tauri plugin-sql
**Rationale**: No user-facing setup; compiled into the Tauri binary; efficient for tracking thousands of seen listing IDs

### Notification Content
**Question**: What should the Telegram notification contain when a match is found?
**Recommended**: Link + key details — actionable and scannable
**Chosen**: Listing URL + price + location + surface + rooms + photo if available
**Rationale**: Enough detail to decide whether to click without being verbose

### Anti-Detection Strategy
**Question**: How should the bot avoid being blocked by Leboncoin?
**Recommended**: Stealth browser + random delays — mimics a real human without proxy costs
**Chosen**: Playwright stealth plugin + randomized delays between requests
**Rationale**: Balances reliability and simplicity; proxy rotation adds cost and complexity for a desktop app

### Telegram Setup
**Question**: Shared bot or per-user bot tokens?
**Recommended**: Shared bot — users paste their chat ID, no bot creation needed
**Chosen**: Shared bot (single token shipped with app), users configure only their chat ID
**Rationale**: Simplest UX — one @BotFather setup by the developer, users just need a Telegram account

### AI Integration
**Question**: Should the bot use AI to assist scraping and matching, and how?
**Recommended**: AI-assisted scraping + AI-enhanced keyword matching — LLM-powered semantic extraction and comparison
**Chosen**: AI-guided DOM extraction (LLM identifies listing cards and extracts structured fields) + AI-enhanced semantic keyword matching (LLM embedding or similarity call, not substring matching)
**Rationale**: Makes the scraper resilient to Leboncoin HTML changes without ongoing selector maintenance. Semantic keyword matching catches relevant listings that substring matching misses (e.g., "vue dégagée" matches "belle vue", "panoramique"). The user provides their own LLM API key — no AI cost is shipped with the app.
**Provider flexibility**: The system SHALL support OpenAI-compatible, Anthropic, and Ollama (local) backends so the user controls cost and privacy.
**Fallback**: If the LLM call fails or times out, the scraper SHALL fall back to a bundled set of static CSS selectors, and keyword matching SHALL degrade to case-insensitive substring matching.
**Model recommendation**: Lightweight models (GPT-4o-mini, Claude Haiku, or local 7B model via Ollama) for cost efficiency — DOM extraction on a listings page is a structured extraction task that small models handle well.
**Latency budget**: LLM extraction ~1-3s per page. Semantic keyword matching ~0.5-1s per listing. Total AI overhead per scan: ~3-8s for a typical 10-listing page.

### App UI Scope
**Question**: Minimal config panel or full dashboard?
**Recommended**: Config panel + system tray — minimal UI, bot runs in background
**Chosen**: Alert config panel + system tray status indicator
**Rationale**: The app is a utility, not a browsing tool; users interact via Telegram notifications, not the app window

## Open Questions
_None — all branches received a Decision or a Deferral during the interview._

## Suggested Follow-ups
- WhatsApp and Signal notification channels were deferred by the developer — revisit after Telegram integration is stable
- The app currently has no codebase — Tauri + Next.js scaffold needs to be initialized as the first implementation step
- AI fallback static selectors need to be authored and maintained as a safety net — create a test suite that validates selectors against a Leboncoin search page snapshot weekly
- Evaluate whether the AI matching LLM call per-listing is cost-effective vs. batching all listings into a single LLM classification call

## References
- `/home/ramx/work/LeBonBot/README.md` — project mission statement
- `/home/ramx/work/LeBonBot/.gitignore` — confirms planned Next.js stack
