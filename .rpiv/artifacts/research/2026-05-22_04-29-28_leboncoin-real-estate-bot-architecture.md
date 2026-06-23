---
date: 2026-05-22T04:29:28+0200
author: Ramouchau
commit: c9b370b
branch: main
repository: LeBonBot
topic: "Leboncoin Real Estate Alert Bot — Tauri v2 architecture research"
tags: [research, tauri, nextjs, playwright, leboncoin, datadome, llm, telegram, sqlite]
status: complete
last_updated: 2026-05-22T04:29:28+0200
last_updated_by: Ramouchau
---

# Research: Leboncoin Real Estate Alert Bot — Architecture

## Research Question

Architecture research for a Tauri v2 desktop app that scrapes leboncoin.fr real estate listings via AI-guided Playwright, matches against user-configured alerts, and notifies via Telegram. Greenfield project — no existing codebase.

## Summary

The original FRD specified an AI-guided Playwright scraper sending full page DOM snapshots to an LLM for extraction + keyword matching in a single call. Research revealed three critical issues with this approach:

1. **DataDome anti-bot (existential risk)**: leboncoin.fr uses DataDome exclusively. The `playwright-extra` + stealth plugin patches JavaScript-level fingerprints but does not fix TLS/JA3 fingerprinting — Playwright's bundled Chromium has a known signature that DataDome blocks. The architecture is only viable if the user's **real Chrome installation** is used instead of Playwright's bundled Chromium, since a real Chrome binary has a unique, unlisted TLS fingerprint.

2. **Cost overestimate**: The FRD estimated $4-13/month for DOM extraction. With GPT-4o-mini pricing, actual cost at 10-min intervals is ~$20.74/month.

3. **Anthropic structured outputs**: The FRD assumed Anthropic requires a `tool_use` workaround. Anthropic shipped native JSON Schema structured outputs as GA in early 2026 — all three providers (OpenAI, Anthropic, Ollama) now converge on the same pattern.

**Architecture pivot**: Research discovered that leboncoin.fr is a Next.js site embedding all listing data in a `<script id="__NEXT_DATA__">` JSON blob. By extracting this structured data from the page HTML (no LLM needed), the LLM's role shrinks to **keyword matching only** — listing text + user keywords → relevance scores. This reduces LLM cost from ~$20.74/month to **~$2.59/month** at 10-min intervals, eliminates the output-token-overflow risk, and simplifies the sidecar entirely.

**Developer checkpoint decisions**:
- Anti-bot: User's real Chrome, headless — solves TLS fingerprinting at zero cost
- Extraction: `__NEXT_DATA__` JSON from page HTML — no LLM for DOM parsing
- LLM role: Keyword matching only — semantic relevance scoring
- DataDome detection: Sidecar checks for challenge page before extraction; skips tick + tray warning on block

## Detailed Findings

### 1. Tauri v2 Integration (Sidecar, Next.js, System Tray)

**Sidecar bundling** — `tauri-plugin-shell` v2 with `externalBin` in `tauri.conf.json` under `bundle` (not `build`). Binaries must follow `name-{target_triple}` naming (e.g., `scraper-x86_64-unknown-linux-gnu`). The biggest architectural risk is bundling Playwright + Chromium (~300MB). Using the user's real Chrome via `executablePath` eliminates this entirely — the sidecar only needs `playwright-core` + HTTP SDKs (~5MB of node_modules).

**`drop(child)` is the single most critical line** — after writing the JSON payload to the sidecar's stdin, Rust must drop the `CommandChild` handle to send EOF on stdin. Without this, the sidecar blocks forever on `process.stdin.read()` because it never receives EOF. This is documented in [GitHub Discussion #4440](https://github.com/tauri-apps/tauri/discussions/4440).

**Spawn pattern**:

```rust
let (mut rx, mut child) = app.shell().sidecar("scraper").spawn()?;
child.write(serde_json::to_string(&payload)?.as_bytes())?;
drop(child);  // CRITICAL — sends EOF on stdin

while let Some(event) = rx.recv().await {
    match event {
        CommandEvent::Stdout(bytes) => { /* parse JSON line */ }
        CommandEvent::Stderr(bytes) => { /* log warning */ }
        CommandEvent::Terminated(status) => { /* respawn if crashed */ }
    }
}
```

**Permissions** — must declare in `src-tauri/capabilities/default.json`:
```json
{ "identifier": "shell:allow-spawn", "allow": [{"name": "binaries/scraper", "sidecar": true}] }
```

**Next.js frontend** — Tauri v2 only supports static export (`output: 'export'` in `next.config.mjs`). No SSR, no API routes. All persistence goes through `invoke('command_name', {args})` → Rust `#[tauri::command]` functions. Real-time bot status via `app.emit("bot-status", payload)` → Next.js `listen<BotStatus>('bot-status', callback)`.

**System tray** — `TrayIconBuilder::new()` with left-click toggle window, right-click menu (Show/Quit). Window close intercepted via `WindowEvent::CloseRequested { api }` → `window.hide()` + `api.prevent_close()`. Background scheduler: `tokio::time::interval` spawned in `setup()` closure. Linux caveat: tray icon `Click`/`DoubleClick` events unsupported — use tray menu for show/hide.

### 2. Anti-Bot Strategy: DataDome on leboncoin.fr

**Confirmed**: leboncoin.fr uses DataDome exclusively (not Cloudflare Turnstile). Source: [AIM Group](https://aimgroup.com/2026/01/07/leboncoin-works-with-datadome-on-scraping-protection/), [Scrapfly leboncoin guide](https://scrapfly.io/blog/posts/how-to-scrape-leboncoin-marketplace-real-estate).

**DataDome's four-layer detection pipeline**:
1. **TLS/JA3 fingerprint** — scored before any payload is read. Playwright's bundled Chromium has a known signature.
2. **Collector JS** — injected `<script>` from `c.datadome.co` reads navigator, WebGL, Canvas, AudioContext, screen metrics, behavioral timing.
3. **ML inference** — 85,000+ per-customer models, <2ms inference. leboncoin has its own model trained on French consumer behavior.
4. **`datadome` cookie** — server-signed, IP-bound, ~1 hour TTL. Cannot be forged client-side.

**`playwright-extra` + `puppeteer-extra-plugin-stealth`** patches 16 JavaScript-level evasions (`navigator.webdriver`, `chrome.runtime`, WebGL vendor, plugins, etc.) but does NOT fix TLS fingerprinting or HTTP/2 frame ordering. The plugin is unmaintained since 2023. DataDome has retrained against its known patterns.

**Solution — User's real Chrome**: `chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })`. A real Chrome install has a unique, unlisted TLS fingerprint. Combined with the user's French residential IP (they're a leboncoin user — almost certainly in France), this is the zero-cost path to viable scraping.

**DataDome challenge detection** — the sidecar checks before `__NEXT_DATA__` extraction:
- Positive challenge signals: `<iframe>` with `src` containing `c.datadome.co/captcha/`, script tags with `dd` prefix, absence of `__NEXT_DATA__` script tag
- On detection: sidecar writes `{"page_type":"challenge", "listings":[]}` to stdout → Rust aborts tick, sets tray warning, retries next interval
- Challenge page reference (from WebRankInfo forum): leboncoin embeds `<iframe src="https://c.datadome.co/captcha/?initialCid=...">` on block

### 3. LLM Multi-Provider Abstraction (Keyword Matching Only)

**Architecture change**: The LLM no longer parses DOM — it only scores keyword relevance against pre-extracted listing text. Input: ~25 listings × ~80 chars each = ~2K tokens. Output: keyword → relevance_score map = ~500 tokens. Total per scan: ~2.5K tokens vs ~14K for DOM extraction.

**All three providers now have native structured outputs**:
- **OpenAI**: `response_format: { type: "json_schema", json_schema: {...} }` — `gpt-4o-mini` and later. 16K output tokens.
- **Anthropic**: `output_config: { format: { type: "json_schema", schema: {...} } }` — GA early 2026, Claude Haiku 4.5+. 8K output tokens.
- **Ollama**: `format: { type: "object", properties: {...} }` — soft enforcement, requires `num_ctx: 65536+` (default is only 4096!). Small models (3B) unreliable for structured JSON.

**Unified interface** — clean across all three:
```typescript
interface LLMProvider {
  matchKeywords(listings: ListingData[], keywords: string[]): Promise<KeywordMatch[]>;
}
```

Implementation: `OpenAIProvider`, `AnthropicProvider`, `OllamaProvider` — all wrap the same JSON Schema into their respective API calls. Factory: `createLLMProvider(config)` reads provider choice from SQLite `settings` table.

**Cost at 10-min intervals (matching-only)**:
- GPT-4o-mini: **~$2.59/month** (input $0.15/1M, output $0.60/1M)
- Claude Haiku 4.5: **~$20.52/month** (input $1.00/1M, output $5.00/1M) — 7.9× more expensive
- Ollama: $0 (local, requires `llama3.1:8b` minimum)

**Recommendation**: Default to GPT-4o-mini — best price/quality ratio. Show cost estimate in settings UI.

### 4. Data Pipeline: Sidecar ↔ Rust ↔ SQLite

**`__NEXT_DATA__` extraction** — leboncoin.fr embeds all listing data in `<script id="__NEXT_DATA__" type="application/json">`. The sidecar extracts this with a simple `page.evaluate()`:
```javascript
const data = await page.evaluate(() => {
  const el = document.getElementById('__NEXT_DATA__');
  return el ? JSON.parse(el.textContent) : null;
});
```

This yields structured listing objects with `id`, `title`, `price`, `location`, `surface`, `rooms`, `url`, `images` — no LLM parsing needed. The sidecar normalizes this into a `ListingData[]` array and sends only listing text + IDs to the LLM for keyword matching.

**SQLite schema** — `tauri-plugin-sql` v2 (2.4.0) uses programmatic `Migration` structs in Rust (not SQL files in a `migrations/` directory). Migrations are tracked via SQLite's `user_version` PRAGMA. Three core tables:

- `alerts` — id (UUID TEXT PK), name, enabled, price_min/max, location, radius_km, property_type, surface_min, rooms_min, furnished, new_construction, keywords (JSON TEXT), relaxed_mode, scan_interval_minutes, last_scan_at
- `seen_listings` — id (leboncoin listing ID), alert_id (FK), notified_at. Composite PK on (id, alert_id) — same listing can match multiple alerts.
- `settings` — key (TEXT PK), value. Stores: `llm_provider`, `llm_api_key`, `llm_model`, `ollama_endpoint`, `telegram_chat_id`.

**Serde boundary** — the most fragile point. Two-phase deserialization:
1. Parse stdout to `serde_json::Value` (always succeeds for valid JSON)
2. Validate `page_type` field is present ("results" | "challenge" | "error")
3. Deserialize listings with `#[serde(default)]` on all optional fields — missing `price` becomes `None` rather than failing the batch

**End-to-end flow**:
```
tokio interval → SELECT due alerts → spawn sidecar → write payload stdin → drop(child)
  → collect stdout JSON → two-phase serde parse → check page_type
  → for each listing: dedup (seen_listings lookup) → strict/relaxed match
  → INSERT seen_listings → Telegram notify → UPDATE last_scan_at
```

### 5. Telegram Notification Pipeline

**Implementation location**: Rust-side via `tauri-plugin-http` (re-exports `reqwest`) — simpler than adding notification logic to the Node.js sidecar.

**Primary path**: `POST /bot{token}/sendPhoto` with `photo` as HTTP URL (Telegram downloads it, max 5MB) + `caption` (HTML parse mode, 1024 char limit). Listing details fit in ~250 chars.

**Fallback**: `POST /bot{token}/sendMessage` when `photo_url` is unavailable. Text-only summary with listing URL.

**Rate limiting**: 350ms inter-message delay (`tokio::time::sleep(Duration::from_millis(350))`) prevents burst rate limits. Even worst case (50 new listings) = ~17.5s to notify all.

**Error handling**:
| Error | HTTP | Action |
|---|---|---|
| Rate limit | 429 | Parse `retry_after`, retry once after wait |
| Transient server error | 5xx | Retry once immediately |
| Invalid chat_id / bot blocked | 400/403 | Permanently disable Telegram for that user, tray warning |
| Photo download failed | 400 | Fallback to `sendMessage` (text-only) |
| Network error | N/A | Retry once after 3s delay |

**Token embedding**: Rust `const TELEGRAM_BOT_TOKEN: &str` for v1 — shared developer bot token. User only configures their `telegram_chat_id`. Token is extractable from binary (acceptable for a shared bot — not a user secret).

## Code References

_No codebase exists (greenfield). Key external references:_

- [Tauri v2 Sidecar docs](https://v2.tauri.app/develop/sidecar/) — `externalBin` declaration, target-triple naming, `CommandEvent` API
- [Tauri v2 Next.js guide](https://v2.tauri.app/start/frontend/nextjs/) — static export requirement, `output: 'export'`, IPC bridge
- [Tauri v2 System Tray](https://v2.tauri.app/learn/system-tray/) — `TrayIconBuilder`, menu events, Linux limitations
- [tauri-plugin-sql docs.rs](https://docs.rs/tauri-plugin-sql/latest/tauri_plugin_sql/) — `Migration` struct, `MigrationKind`, `DbInstances`
- [GitHub Discussion #4440](https://github.com/tauri-apps/tauri/discussions/4440) — `drop(child)` requirement for sidecar stdin EOF
- [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions) — 16 evasion modules
- [Scrapfly leboncoin guide](https://scrapfly.io/blog/posts/how-to-scrape-leboncoin-marketplace-real-estate) — DataDome confirmation, `__NEXT_DATA__` pattern
- [Telegram Bot API: sendPhoto](https://core.telegram.org/bots/api#sendphoto) — photo by URL, caption limits, parse modes
- [Telegram Bot API: sendMessage](https://core.telegram.org/bots/api#sendmessage) — text limits, `disable_web_page_preview`
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs) — `response_format: json_schema`, Zod helper
- [Anthropic Structured Outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs) — `output_config.format`, GA 2026
- [Ollama JSON mode](https://github.com/ollama/ollama/blob/main/docs/api.md) — `format: json`, `num_ctx` for context window

## Integration Points

### Inbound References
_None — greenfield project._

### Outbound Dependencies

- **leboconcoin.fr** — scraped via user's real Chrome + Playwright, no proxy required
- **LLM provider** (OpenAI/Anthropic/Ollama) — user-configured, API key user-provided, keyword matching only
- **Telegram Bot API** — shared bot token (developer's), user provides chat ID, `sendPhoto` + `sendMessage`
- **tauri-plugin-sql** — SQLite persistence for alerts, seen listings, settings
- **tauri-plugin-shell** — sidecar process management (Node.js scraper)
- **tauri-plugin-http** — Telegram API calls from Rust via reqwest

### Infrastructure Wiring

- **Sidecar**: `src-tauri/binaries/scraper-{target_triple}` — Node.js binary (compiled with `pkg` or similar), launched via `app.shell().sidecar("scraper").spawn()`
- **Permissions**: `src-tauri/capabilities/default.json` — shell:allow-spawn (sidecar), http:default (Telegram API)
- **Migrations**: Programmatic in `src-tauri/src/lib.rs` via `tauri_plugin_sql::Builder::add_migrations()`
- **Background scheduler**: `tokio::time::interval` in `setup()` closure, per-alert `scan_interval_minutes` enforcement
- **Tray status**: `TrayIcon` handle in managed state, updated by scheduler and error handlers

## Architecture Insights

1. **`__NEXT_DATA__` extraction is the key simplification** — leboncoin's Next.js architecture inadvertently provides structured data for free. This eliminates the most fragile part of the original design (LLM parsing DOM snapshots) and reduces LLM cost by ~8×.

2. **User's real Chrome solves TLS fingerprinting at zero cost** — the original architecture assumed Playwright's bundled Chromium was sufficient. DataDome's TLS fingerprinting makes it a liability. Using the user's real Chrome binary solves this with no additional dependencies or costs.

3. **Sidecar stdin EOF is the most critical single line** — `drop(child)` after writing the payload is mandatory. Without it, the sidecar blocks forever. This is a well-known Tauri v2 pattern documented in GitHub Discussion #4440.

4. **Two-phase serde deserialization prevents silent data corruption** — parsing stdout to `serde_json::Value` first, validating `page_type`, then converting to typed structs prevents cryptic "missing field" errors when the real problem is a DataDome challenge page returned as HTML instead of JSON.

5. **`tauri-plugin-sql` v2 migrations are Rust structs, not SQL files** — this differs from most ORMs. Migrations are defined as `Migration { version, description, sql, kind }` in Rust code, tracked via `user_version` PRAGMA.

6. **Anthropic now has native structured outputs** — the FRD's assumption of `tool_use` workaround is outdated. All three providers converge on `json_schema` → validated JSON, making the unified `LLMProvider` interface straightforward.

## Precedents & Lessons

**No prior code history exists** — the repository has exactly one commit (`c9b370b`, 2026-05-21) containing only `.gitignore`, `LICENSE`, and `README.md`. Zero code precedents.

### Lessons from FRD Evolution

Two FRD artifacts exist in `.rpiv/artifacts/discover/`, created hours apart on 2026-05-22. Differences between them reveal design tensions:

**Earlier FRD** (`2026-05-22_03-08-00`):
- Mandated static CSS selector fallback when LLM fails — later removed entirely
- Assumed 1-3 LLM calls per scan (DOM extraction + separate keyword matching) — consolidated to single call
- Required explicit CAPTCHA detection — dropped in refined version
- Cost estimate: $0.01-0.05/scan, $4-22/month

**Refined FRD** (`2026-05-22_01-51-10`):
- Removed static CSS fallback in favor of "skip tick, retry next interval"
- Consolidated to single call per page with inline keyword matching
- Added multi-provider LLM support (OpenAI, Anthropic, Ollama)
- Minimum scan interval set to 10 minutes
- Cost refined to $0.01-0.03/scan, $4-13/month
- Explicitly flagged: single-call-per-page needs empirical validation for token limits

### Composite Lessons

1. **Fallback strategies are the #1 design tension** — the two FRDs disagree on whether to maintain a static CSS fallback. The answer changed within hours. This research recommends no static fallback: with `__NEXT_DATA__` extraction + real Chrome + matching-only LLM, the fallback is simply "retry next interval."

2. **The single-call-per-page LLM pattern was unvalidated** — both FRDs converged on this but flagged it as needing empirical validation. The pivot to `__NEXT_DATA__` extraction + matching-only LLM side-steps this entirely: the LLM no longer handles 35+ listings of DOM text in one call.

3. **Leboncoin anti-bot is the existential risk** — both FRDs acknowledged this but had no concrete mitigation beyond "stealth + delays." Research confirmed DataDome makes this a real threat. The pivot to user's real Chrome + headless is a concrete, zero-cost mitigation.

4. **Cost estimates were optimistic** — the FRD's $4-13/month was for DOM extraction. Actual at 10-min intervals: ~$20.74 (DOM) vs ~$2.59 (matching-only with `__NEXT_DATA__`). The pivot makes the app affordable even at aggressive scan intervals.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-05-22_01-51-10_leboncoin-real-estate-bot.md` — Authoritative FRD with full decisions, acceptance criteria, and architectural constraints
- `.rpiv/artifacts/discover/2026-05-22_03-08-00_leboncoin-real-estate-bot.md` — Earlier FRD with static CSS fallback and separate LLM calls (superseded)

## Developer Context

**Q (discover: Audience & Scope): Who is hitting this problem, and what does success look like for them?**
A: Public/multi-user service — anyone who installs the Tauri app can configure their own bot searches and notifications

**Q (discover: Listing Category): What exactly should the bot scan for on Leboncoin?**
A: Real estate (apartments, houses, rentals, purchases)

**Q (discover: Non-Goals for v1): What should be explicitly out of scope for the first version?**
A: No built-in payment/transaction, no historical analytics, no mobile app

**Q (discover: Scan Frequency): What frequency and pattern makes sense for scanning?**
A: User-configurable per search alert

**Q (discover: Execution Location): Where should the bot execute?**
A: On the user's desktop via Tauri

**Q (discover: AI Intent): What problem does adding AI to the scraper solve?**
A: Both DOM resilience and smarter matching equally

**Q (discover: Scraping Method): How should the bot fetch listings?**
A: AI-guided Playwright headless browser with LLM-powered semantic DOM extraction

**Q (discover: LLM Provider): Which LLM provider(s) should v1 support?**
A: Multi-provider — OpenAI-compatible API, Anthropic, and local Ollama

**Q (discover: LLM Call Pattern): How many LLM calls per scan tick?**
A: Single call per page — one LLM call processes the entire page

**Q (discover: Model Tier): Which tier of LLM model should the scraper default to?**
A: Lightweight — GPT-4o-mini or Claude Haiku as default

**Q (discover: LLM Fallback): When the LLM API call fails, what should the scraper do?**
A: Skip the tick, warn the user (tray icon → Error), retry on next interval

**Q (discover: Keyword Flow): With single call per page, how do per-alert keywords reach the LLM?**
A: Batch all active alert keywords into the extraction prompt

**Q (discover: Notification Channels): Which notification channels should v1 support?**
A: Telegram first; WhatsApp and Signal deferred

**Q (discover: Search Parameters): What search parameters should users configure per alert?**
A: Price range, location, property type, surface, rooms, furnished, construction, keywords

**Q (discover: Matching Strictness): How strict/loose should filter matching be?**
A: Relaxed matching with strict-mode toggle

**Q (discover: Persistence): Where should user alert configs and seen-listing history be stored?**
A: SQLite via Tauri plugin-sql

**Q (discover: Notification Content): What should the Telegram notification contain?**
A: Listing URL + price + location + surface + rooms + photo if available

**Q (discover: Anti-Detection Strategy): How should the bot avoid being blocked by Leboncoin?**
A: Playwright stealth plugin + randomized delays between requests

**Q (discover: Telegram Setup): Shared bot or per-user bot tokens?**
A: Shared bot (single token shipped with app), users configure only their chat ID

**Q (discover: App UI Scope): Minimal config panel or full dashboard?**
A: Alert config panel + system tray status indicator + LLM provider settings

**Q (Anti-bot approach — research checkpoint): The user's own French residential IP helps, but Playwright's bundled Chromium still leaks a known TLS fingerprint. Which zero-cost approach?**
A: Use user's real Chrome, headless — solves TLS fingerprinting at zero cost

**Q (Extraction architecture — research checkpoint): What role should the LLM play?**
A: Real Chrome + `__NEXT_DATA__` + LLM matching — Chrome navigates, `__NEXT_DATA__` provides structured data, LLM only does keyword matching

**Q (Challenge detection — research checkpoint): How should the app respond when leboncoin blocks a request?**
A: Sidecar detects DataDome challenge (iframe/cookie check), skips tick, tray warning, retries next interval

## Related Research

_None — this is the first research artifact for this project._

## Open Questions

1. **Chrome detection fallback**: If no Chromium-based browser is found (rare — Edge covers Windows, Chrome covers macOS), what should the app do? Prompt to install Chrome, or accept that the app can't function?
2. **`__NEXT_DATA__` stability**: Does leboncoin's Next.js configuration always embed listing data in `__NEXT_DATA__`, or do some page variants (no-JS fallback, pagination beyond page 1) omit it? Needs empirical validation against live leboncoin.fr search pages.
3. **Ollama small-model reliability**: Can `llama3.1:8b` (or smaller) reliably produce structured JSON keyword matches from listing text? Smaller models risk hallucinated relevance scores or malformed JSON. Needs testing before offering as a supported provider.
4. **Photo URL expiry**: Leboncoin listing photo URLs may be short-lived CDN links. If Telegram's `sendPhoto` call fails because the photo URL expired between scrape and notification, the fallback to `sendMessage` (text-only) should be acceptable but may degrade UX.
5. **`__NEXT_DATA__` extraction across listing types**: The research targeted real estate listings, but the FRD also mentions rentals. Does leboncoin use the same `__NEXT_DATA__` structure for both purchase and rental listings? Structure may differ.
