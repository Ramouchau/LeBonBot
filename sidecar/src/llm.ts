import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

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
      listing_id: z.string().describe('The listing ID from the input'),
      keyword: z.string().describe('The matched keyword'),
      relevance: z
        .number()
        .min(0)
        .max(1)
        .describe('Relevance score: 0 = not relevant, 1 = highly relevant'),
    }),
  ),
});

function buildPrompt(listings: ListingData[], keywords: string[], threshold: number): string {
  const listingTexts = listings
    .map(
      (l) =>
        `[${l.id}] ${l.title} | ${l.location} | ${l.surface || '?'}m² | ${l.rooms || '?'} rooms | ${l.price != null ? `${l.price}€` : '?'}`,
    )
    .join('\n');

  return `Analyze these real estate listings for keyword relevance.

Keywords: ${keywords.join(', ')}

For each listing below, determine which keywords match and how relevant they are (0-1 scale).
Consider semantic similarity: "belle vue" matches "vue panoramique", "calme" matches "quartier tranquille", etc.
Only include matches with relevance >= ${threshold}.

Listings:
${listingTexts}`;
}

function getModel(provider: string, apiKey: string, model: string, ollamaEndpoint: string) {
  switch (provider) {
    case 'openai': {
      const openaiProvider = createOpenAI({ apiKey });
      return openaiProvider(model || 'gpt-4o-mini');
    }
    case 'anthropic': {
      const anthropicProvider = createAnthropic({ apiKey });
      return anthropicProvider(model || 'claude-haiku-4-5-20250514');
    }
    case 'deepseek': {
      const deepseek = createOpenAI({
        baseURL: 'https://api.deepseek.com/v1',
        apiKey,
      });
      return deepseek(model || 'deepseek-chat');
    }
    case 'ollama': {
      const ollama = createOpenAI({
        baseURL: ollamaEndpoint || 'http://localhost:11434/v1',
        apiKey: 'ollama',
      });
      return ollama(model || 'llama3.1:8b');
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
  relevanceThreshold?: number,
): Promise<KeywordMatch[]> {
  const threshold = relevanceThreshold ?? 0.5;
  const prompt = buildPrompt(listings, keywords, threshold);

  const modelInstance = getModel(provider, apiKey, model, ollamaEndpoint);

  const { object } = await generateObject({
    model: modelInstance,
    schema: matchSchema,
    prompt,
    temperature: 0,
    maxTokens: 4096,
  });

  return object.matches || [];
}
