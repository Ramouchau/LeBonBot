import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { matchKeywords } from './llm.js';

const CHROME_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function detectChromePath(override?: string | null): string | null {
  if (override) return override;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
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
  headless?: boolean;
  chrome_profile?: string;
}

interface KeywordMatch {
  listing_id: string;
  keyword: string;
  relevance: number;
}

interface ScrapeOutput {
  page_type: 'results' | 'challenge' | 'error' | 'empty';
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

      const surfaceRaw = getAttr('surface');
      const roomsRaw = getAttr('rooms');
      const priceRaw = l.price?.[0];

      return {
        id: String(l.list_id),
        title: l.subject || '',
        price: typeof priceRaw === 'number' ? priceRaw : null,
        location: l.location?.city || l.location?.label || '',
        surface: surfaceRaw ? parseFloat(surfaceRaw) : null,
        rooms: roomsRaw ? parseInt(roomsRaw) : null,
        url: l.url || `https://www.leboncoin.fr/ad/ventes_immobilieres/${l.list_id}`,
        photo_url: l.images?.thumb_url || l.images?.urls?.[0] || null,
      };
    });
}

function detectChallenge(html: string): boolean {
  return html.includes('c.datadome.co/captcha/') || html.includes('datadome');
}

function waitForEnter(label: string): Promise<void> {
  console.error(label);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question('Press Enter to continue...', () => {
      rl.close();
      resolve();
    });
  });
}

export async function scrape(payload: Payload): Promise<ScrapeOutput> {
  const chromePath = detectChromePath(payload.chrome_path);
  if (!chromePath) {
    return {
      page_type: 'error',
      listings: [],
      keyword_matches: [],
      error: 'Chrome not found. Set CHROME_PATH or install Google Chrome.',
    };
  }

  const interactive = payload.headless === false;
  console.error('[sidecar] mode:', interactive ? 'visible' : 'headless');
  console.error('[sidecar] url:', payload.url);
  console.error('[sidecar] profile:', payload.chrome_profile || 'none (fresh session)');
  console.error('[sidecar] chrome:', chromePath);

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
  let page;

  if (payload.chrome_profile) {
    context = await chromium.launchPersistentContext(payload.chrome_profile, {
      executablePath: chromePath,
      headless: payload.headless ?? true,
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'fr-FR',
    });
    page = await context.newPage();
  } else {
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: payload.headless ?? true,
    });
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'fr-FR',
    });
    page = await context.newPage();
  }

  try {
    await page.goto(payload.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const waitMs = interactive ? 10000 : 2000;
    console.error('[sidecar] waiting', waitMs, 'ms...');
    await new Promise((r) => setTimeout(r, waitMs));

    const html = await page.content();
    console.error('[sidecar] html:', html.length, 'bytes');

    if (detectChallenge(html)) {
      console.error('[sidecar] DATADOME DETECTED');
      if (interactive) {
        console.error('\n⚠️  DATADOME CHALLENGE — solve captcha, then press Enter\n');
        await waitForEnter('Solve captcha →');
        const newHtml = await page.content();
        if (detectChallenge(newHtml)) {
          console.error('Still challenged — giving up.');
          return { page_type: 'challenge', listings: [], keyword_matches: [] };
        }
        return await extractListings(page, payload);
      }
      return { page_type: 'challenge', listings: [], keyword_matches: [] };
    }

    return await extractListings(page, payload);
  } catch (e) {
    console.error('[sidecar] ERROR:', e instanceof Error ? e.message : String(e));
    return {
      page_type: 'error',
      listings: [],
      keyword_matches: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    if (!interactive) {
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  if (interactive) {
    console.error('\nPress Enter to close browser...');
    await waitForEnter('Done →');
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  // unreachable — kept for type safety
  return { page_type: 'error', listings: [], keyword_matches: [] };
}

async function extractListings(
  page: { evaluate: <T>(fn: () => T) => Promise<T> },
  payload: Payload,
): Promise<ScrapeOutput> {
  const nextData = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el) return null;
    try { return JSON.parse(el.textContent || '{}'); } catch { return null; }
  });

  if (!nextData) {
    console.error('[sidecar] __NEXT_DATA__ not found');
    return { page_type: 'empty', listings: [], keyword_matches: [] };
  }

  const props = nextData.props?.pageProps;
  const searchData = props?.searchData || props?.listingContainer?.searchData;
  const rawListings: NextDataListing[] = searchData?.ads || searchData?.listings || [];
  const listings = normalizeListings(rawListings);

  if (listings.length === 0) {
    return { page_type: 'empty', listings: [], keyword_matches: [] };
  }

  let keywordMatches: KeywordMatch[] = [];
  if (payload.keywords.length > 0) {
    try {
      keywordMatches = await matchKeywords(
        listings, payload.keywords, payload.llm_provider, payload.llm_api_key,
        payload.llm_model, payload.ollama_endpoint, payload.relevance_threshold,
      );
    } catch (e) {
      console.error('LLM keyword matching failed:', e);
    }
  }

  return { page_type: 'results', listings, keyword_matches: keywordMatches };
}
