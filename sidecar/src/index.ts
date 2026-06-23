import { scrape } from './scraper.js';

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
  headless?: boolean;
  chrome_profile?: string;
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

interface Output {
  page_type: 'results' | 'challenge' | 'error' | 'empty';
  listings: ListingData[];
  keyword_matches: KeywordMatch[];
  error?: string;
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8');

  if (!raw.trim()) {
    console.error('no stdin payload received');
    process.exit(1);
  }

  let payload: Payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.error('invalid JSON payload:', e);
    process.exit(1);
  }

  if (payload.action !== 'scrape') {
    console.error('unknown action:', payload.action);
    process.exit(1);
  }

  const output: Output = await scrape(payload);

  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch((e) => {
  const errorOutput: Output = {
    page_type: 'error',
    listings: [],
    keyword_matches: [],
    error: e instanceof Error ? e.message : String(e),
  };
  process.stdout.write(`${JSON.stringify(errorOutput)}\n`);
  process.exit(0);
});
