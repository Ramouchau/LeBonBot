---
date: 2026-05-22T01:51:10.361Z
author: Ramouchau
commit: c9b370b
branch: main
repository: LeBonBot
topic: "Leboncoin Real Estate Alert Bot"
tags: [intent, frd, leboncoin, tauri, nextjs, playwright, telegram, real-estate, ai, llm]
status: complete
last_updated: 2026-05-22T01:51:10.361Z
last_updated_by: Ramouchau
---

# FRD: Leboncoin Real Estate Alert Bot

## Summary
A desktop application (Tauri + Next.js) that lets users configure real estate search alerts for Leboncoin. The bot scrapes listings via an AI-guided Playwright headless browser — an LLM semantically identifies listing cards and extracts structured data in a single call per page, making the scraper resilient to DOM changes without manual selector maintenance. Listings are matched against user-defined criteria (price, location, type, surface, rooms, furnished status, construction age, keywords), with AI-enhanced semantic keyword matching embedded in the same LLM call. Matching supports an optional relaxed mode that surfaces near-miss listings. Telegram notifications deliver key details when matching offers appear. The bot minimizes to system tray and runs in the background.

## Problem & Intent
The user wants a public/multi-user service — a desktop app (Tauri) that anyone can install, configure their own Leboncoin search alerts, and receive Telegram notifications when matching real estate offers appear. The core pain point: manually refreshing Leboncoin multiple times a day to catch good deals before they're gone. A traditional static-scraper approach breaks every time Leboncoin changes their HTML — AI-guided extraction solves this by understanding listings semantically rather than depending on fragile CSS selectors.

## Goals
- Automated, scheduled Leboncoin real estate scraping from the user's desktop
- AI-guided Playwright scraping — LLM-powered semantic DOM extraction in a single call per page, resilient to HTML changes
- AI-enhanced keyword matching — semantic understanding of listing titles/descriptions, not just substring matching
- Multi-parameter alert configuration (price, location, property type, surface, rooms, furnished, construction, keywords)
- Telegram notifications with listing URL and key details on match
- Relaxed matching mode that optionally surfaces near-miss listings
- System tray integration — bot runs in background, app stays out of the way

## Non-Goals
- No built-in payment or transaction handling — the bot finds and notifies, it doesn't message sellers or process payments
- No historical analytics or price trend dashboards
- No mobile app — desktop-only via Tauri (Windows, macOS, Linux)
- No WhatsApp or Signal in v1 — Telegram only initially, WhatsApp/Signal are deferred to future versions
- No shipped AI costs — the user provides their own LLM API key; no API key is embedded in the app

## Functional Requirements
1. The system SHALL allow users to create, edit, delete, and enable/disable search alerts, each with the following configurable parameters: price range (min-max), location (city/zip + radius), property type (apartment/house/studio/loft/land/parking/etc.), minimum surface area (m²), number of rooms, furnished/unfurnished, new/old construction, and free-text keywords.
2. The system SHALL periodically scrape listings from https://www.leboncoin.fr using an AI-guided Playwright headless browser. The scraper SHALL send the page DOM snapshot to an LLM in a single call per page; the LLM SHALL semantically identify listing cards and extract structured data (id, title, price, location, surface, rooms, url, photo_url). The scraper SHALL use the Playwright stealth plugin and randomized delays between requests.
3. The system SHALL include all active alert keywords in the LLM extraction prompt so semantic keyword matching happens inline within the same single call per page. The LLM SHALL return per-listing keyword relevance alongside extracted data. Local code SHALL route matched listings to the correct alert(s).
4. The system SHALL support strict-mode and relaxed-mode matching. Relaxed mode SHALL surface listings within: price ±12.5%, surface −20%, rooms ±1, location radius ×1.5, and keywords ≥50% match.
5. The system SHALL fall back gracefully when the LLM API call fails: log the failure, warn the user via tray icon status (set to Error) and optionally via Telegram, skip the current tick, and retry on the next scheduled interval.
6. The system SHALL send a Telegram notification for each new matching listing, containing the listing URL, price, location, surface area, room count, and a photo if available.
7. The system SHALL track previously notified listing IDs in a local SQLite database and SHALL NOT re-notify for the same listing.
8. The system SHALL respect a per-alert, user-configurable scan interval (e.g., every 15 minutes, hourly, twice daily), with a minimum of 10 minutes.
9. The system SHALL allow users to configure their Telegram chat ID and LLM API key in app settings. Both values are stored locally. The Telegram bot token is shared (embedded in the app binary); the LLM API key is user-provided.
10. The system SHALL run in the system tray with a status indicator; the bot continues scanning in the background while the main window is closed.
11. The system SHALL store all user data (alert configs, seen listing IDs, settings, API keys) locally in SQLite via Tauri's SQL plugin — no data leaves the user's machine except Telegram notifications, Leboncoin HTTP requests, and LLM API calls to the user's chosen provider.

## Non-Functional Requirements
- **Performance**: Playwright browser instance consumes ~200–300MB RAM. Each scan tick involves one LLM API call (DOM extraction + keyword matching combined), adding ~2-5 seconds latency. Scans run sequentially per user to avoid resource and API cost spikes. Scan frequency is user-configurable; minimum interval is 10 minutes.
- **AI Cost**: Each scan tick costs ~$0.01-0.03 in LLM API credits with lightweight models (GPT-4o-mini, Claude Haiku). At 6 scans/hour (10-min interval), monthly cost per active user is ~$4-13. The LLM API key SHALL be user-provided and stored locally — no AI cost is incurred by the developer.
- **AI Quality**: The LLM extraction prompt SHALL include few-shot examples of Leboncoin listing cards. The system SHALL validate extracted fields against expected types (price is numeric, URL matches leboncoin.fr pattern) and discard malformed listings.
- **Security**: All alert data, seen-listing history, and API keys are stored locally. The shared Telegram bot token is embedded in the app binary. The user's LLM API key is stored in local SQLite — never transmitted anywhere except to the user's chosen LLM provider. No data is sent to any third-party server beyond what the user explicitly configures.
- **UX / Accessibility**: The Next.js config panel provides alert CRUD, settings (Telegram chat ID, LLM API key, provider selection), and bot status display. The Tauri system tray icon shows active/idle/error bot status. French-only UI (Leboncoin target audience).
- **Reliability**: The bot SHALL handle network failures gracefully — failed scrapes retry on the next scheduled interval. Playwright crashes SHALL trigger an automatic browser restart. Telegram API failures SHALL be logged and retried once. LLM API failures SHALL warn the user and skip the tick (retry next interval).

## Constraints & Assumptions
- **Platform**: Tauri v2 for the desktop shell, Next.js for the UI layer, AI-guided Playwright for scraping (LLM-powered semantic DOM extraction), SQLite via `tauri-plugin-sql` for persistence.
- **LLM Provider**: The scraper SHALL support configurable LLM backends: OpenAI-compatible API, Anthropic, and local Ollama. The user SHALL provide their own API key (or configure a local Ollama endpoint) in app settings. The system SHALL default to lightweight models (GPT-4o-mini or Claude Haiku).
- **Assumption**: Leboncoin's HTML structure is scrapable via Playwright with stealth plugin. AI semantic extraction handles DOM changes, but extreme anti-bot measures (CAPTCHAs, DataDome challenges) may still block the scraper.
- **Assumption**: Lightweight LLM models (GPT-4o-mini, Claude Haiku) can reliably extract structured listings from a full page DOM snapshot in a single call. If page complexity exceeds model capability, the capable fallback option may need to be revisited.
- **Assumption**: The shared Telegram bot token approach works — Telegram Bot API rate limits (~30 messages/second) are sufficient for the expected user base.
- **Assumption**: Users are on a French-speaking, desktop-capable platform (Windows, macOS, or Linux), comfortable creating a Telegram account, and willing to provide an LLM API key (OpenAI, Anthropic, or a local Ollama instance).

## Acceptance Criteria
- [ ] Running `npm run tauri dev` launches the Next.js config panel inside a Tauri window
- [ ] Creating a new alert with price range 200000-300000€, location "Paris 75001" radius 5km, type "Appartement", surface ≥40m², 2 rooms, furnished, and keyword "balcon" persists and displays in the alert list
- [ ] The bot executes an AI-guided Playwright scan: the LLM extracts listings with title, price, location, surface, and URL from a leboncoin.fr/recherche results page
- [ ] AI keyword matching correctly identifies that "vue dégagée" matches a listing titled "Appartement avec belle vue panoramique" (which substring matching would miss)
- [ ] When the LLM API is unavailable (wrong key, timeout, provider down), the scan tick is skipped, the tray icon shows Error status, and the next scheduled tick proceeds normally
- [ ] A matching listing triggers a Telegram message containing the listing URL, price, location, and surface
- [ ] Running the same scan twice notifies only for new listings (seen IDs are deduplicated in SQLite)
- [ ] Changing the scan interval to "10 minutes" causes the next scan to fire ~10 minutes after the previous one
- [ ] Closing the main window minimizes the app to the system tray; the bot continues scanning on schedule
- [ ] The system tray icon reflects bot status (active/idle/error)

## Recommended Approach
Tauri v2 desktop app with a Next.js frontend for alert configuration and settings (LLM provider, API key, Telegram chat ID). A Node.js Playwright sidecar scrapes leboncoin.fr using stealth plugin + randomized delays. The scraper sends the page DOM snapshot to the user's configured LLM in a single call per page; the LLM extracts structured listings and performs semantic keyword matching inline. SQLite stores alert configs, seen listing IDs, and user settings. Telegram Bot API integration sends structured notifications. The app minimizes to system tray with status indicators and background bot execution.

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

### AI Intent
**Question**: What problem does adding AI to the scraper solve that a pure Playwright script can't?
**Recommended**: n/a — `intent` question
**Chosen**: Both DOM resilience and smarter matching equally — AI semantically identifies listings regardless of HTML changes, and understands that "belle vue" means the same thing as "vue dégagée"
**Rationale**: The two AI use cases (extraction + matching) are complementary stages of the pipeline; both are broken by the static approach

### Scraping Method
**Question**: How should the bot fetch listings — headless browser, HTTP parsing, or API reverse-engineering?
**Recommended**: Playwright headless browser — optimizes for reliability against JS-rendered content
**Chosen**: AI-guided Playwright headless browser with LLM-powered semantic DOM extraction
**Rationale**: Static CSS selectors break on DOM changes; the LLM semantically identifies listing cards regardless of markup. Playwright handles JS rendering and anti-bot navigation; the LLM (invoked via user's own API key) extracts structured data from the page snapshot

### LLM Provider
**Question**: Which LLM provider(s) should v1 support?
**Recommended**: OpenAI-only — optimizes for simplicity (one API client, one prompt engineering effort)
**Chosen**: Multi-provider — OpenAI-compatible API, Anthropic, and local Ollama
**Rationale**: Users control cost and privacy by choosing their provider. Ollama enables zero-cost, fully-local AI scraping for privacy-conscious users

### LLM Call Pattern
**Question**: How many LLM calls per scan tick?
**Recommended**: Single call per page — optimizes for latency (~2-3s) and cost (~$0.01/scan)
**Chosen**: Single call per page — one LLM call processes the entire page, extracting all listings and performing semantic keyword matching inline
**Rationale**: Minimizes latency and cost. All active alert keywords are batched into the prompt; the LLM returns per-listing keyword relevance alongside extracted data

### Model Tier
**Question**: Which tier of LLM model should the scraper default to?
**Recommended**: Lightweight (GPT-4o-mini, Claude Haiku) — optimizes for cost (~$4-13/month at 10-min intervals)
**Chosen**: Lightweight — GPT-4o-mini or Claude Haiku as default
**Rationale**: Structured extraction from a listing page is a task lightweight models handle well; monthly cost at ~$0.01-0.03/scan is acceptable for a consumer tool

### LLM Fallback
**Question**: When the LLM API call fails, what should the scraper do?
**Recommended**: Static CSS fallback — optimizes for uptime
**Chosen**: Skip the tick, warn the user (tray icon → Error, optional Telegram notification), and retry on the next scheduled interval
**Rationale**: Simpler than maintaining static CSS selectors as a fallback. A single missed tick (10-min interval) is acceptable. Users are notified so they know the bot isn't silently failing

### Keyword Flow
**Question**: With single call per page, how do per-alert keywords reach the LLM?
**Recommended**: Batch all keywords from all active alerts into the extraction prompt
**Chosen**: Batch all active alert keywords into the single extraction prompt; the LLM returns per-listing keyword relevance; local code routes matches to the correct alert(s)
**Rationale**: Satisfies both "single call per page" and "semantic keyword matching" without additional LLM calls. Cost scales with keyword count, not alert count

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

### App UI Scope
**Question**: Minimal config panel or full dashboard?
**Recommended**: Config panel + system tray — minimal UI, bot runs in background
**Chosen**: Alert config panel + system tray status indicator + LLM provider settings (API key, provider selection)
**Rationale**: The app is a utility, not a browsing tool; users interact via Telegram notifications, not the app window. LLM settings are a necessary addition for the AI-guided scraper

## Open Questions
_None — all branches received a Decision or a Deferral during the interview._

## Suggested Follow-ups
- WhatsApp and Signal notification channels were deferred by the developer — revisit after Telegram integration is stable
- The app currently has no codebase — Tauri + Next.js scaffold needs to be initialized as the first implementation step
- Ollama (local model) support is included in the multi-provider decision but may need dedicated testing — local models may struggle with structured JSON extraction from dense listing pages
- The "single call per page" pattern needs empirical validation: can lightweight models reliably extract 35 listings + keyword relevance in one call without hitting output token limits?

## References
- `/home/ramx/work/LeBonBot/README.md` — project mission statement
- `/home/ramx/work/LeBonBot/.gitignore` — confirms planned Next.js stack
- `.rpiv/artifacts/discover/2026-05-22_03-08-00_leboncoin-real-estate-bot.md` — prior FRD (pre-AI decisions), baseline for this refinement
