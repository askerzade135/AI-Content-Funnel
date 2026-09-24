import { createHash } from 'node:crypto';
import { fetchArticleMetadata } from './article-fetcher.js';
import { searchWebWithOpenAI } from './web-search.js';
import { addWebSearchUsageLog, RadarDiscoveryCandidateRecord } from './storage.js';

export type WebSearchProviderId = 'tavily' | 'brave' | 'google' | 'openai';

interface SearchHit {
  url: string;
  title: string;
  snippet?: string;
  publishedAt?: string;
}

interface ProviderResult {
  provider: WebSearchProviderId;
  configured: boolean;
  hits: SearchHit[];
  error?: string;
  reasonCode?: string;
}

const providerCooldownUntil = new Map<WebSearchProviderId, number>();
const DEFAULT_ORDER: WebSearchProviderId[] = ['google', 'tavily', 'brave', 'openai'];

export function resetWebSearchRouterForTests() {
  providerCooldownUntil.clear();
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function stableId(url: string): string {
  return 'web-' + createHash('sha256').update(url).digest('hex').slice(0, 24);
}

function sanitizeReason(error: any): string {
  const status = Number(error?.status || error?.response?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  if (status === 429 || message.includes('quota') || message.includes('resource_exhausted')) return 'quota_exhausted';
  if (status === 401 || status === 403 || message.includes('invalid api key')) return 'invalid_api_key';
  if (status === 404) return 'not_found';
  if (status >= 500 || message.includes('unavailable')) return 'provider_unavailable';
  return 'provider_error';
}

function providerOrder(): WebSearchProviderId[] {
  const configured = (process.env.WEB_SEARCH_PROVIDER_ORDER || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter((value): value is WebSearchProviderId => DEFAULT_ORDER.includes(value as WebSearchProviderId));
  return configured.length ? [...new Set(configured)] : DEFAULT_ORDER;
}

function inCooldown(provider: WebSearchProviderId): boolean {
  return (providerCooldownUntil.get(provider) || 0) > Date.now();
}

function markFailure(provider: WebSearchProviderId, reason?: string) {
  if (reason === 'quota_exhausted' || reason === 'invalid_api_key') {
    providerCooldownUntil.set(provider, Date.now() + 15 * 60_000);
  }
}

async function tavilySearch(query: string, limit: number): Promise<ProviderResult> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return { provider: 'tavily', configured: false, hits: [] };
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: Math.max(3, Math.min(limit, 10)),
        include_answer: false,
        include_images: false,
      }),
    });
    if (!response.ok) {
      const error: any = new Error('Tavily HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    const data: any = await response.json();
    const hits = (Array.isArray(data?.results) ? data.results : []).map((item: any) => ({
      url: String(item?.url || ''),
      title: String(item?.title || item?.url || ''),
      snippet: String(item?.content || ''),
      publishedAt: item?.published_date ? String(item.published_date) : undefined,
    })).filter((item: SearchHit) => Boolean(normalizeUrl(item.url)));
    return { provider: 'tavily', configured: true, hits };
  } catch (error: any) {
    const reasonCode = sanitizeReason(error);
    return { provider: 'tavily', configured: true, hits: [], error: 'Tavily: ' + reasonCode, reasonCode };
  }
}

async function braveSearch(query: string, limit: number): Promise<ProviderResult> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return { provider: 'brave', configured: false, hits: [] };
  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.max(3, Math.min(limit, 10))));
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': key,
      },
    });
    if (!response.ok) {
      const error: any = new Error('Brave HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    const data: any = await response.json();
    const hits = (Array.isArray(data?.web?.results) ? data.web.results : []).map((item: any) => ({
      url: String(item?.url || ''),
      title: String(item?.title || item?.url || ''),
      snippet: String(item?.description || ''),
      publishedAt: item?.page_age ? String(item.page_age) : undefined,
    })).filter((item: SearchHit) => Boolean(normalizeUrl(item.url)));
    return { provider: 'brave', configured: true, hits };
  } catch (error: any) {
    const reasonCode = sanitizeReason(error);
    return { provider: 'brave', configured: true, hits: [], error: 'Brave: ' + reasonCode, reasonCode };
  }
}

async function googleSearch(query: string, limit: number): Promise<ProviderResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || process.env.GOOGLE_WEB_SEARCH_ENABLED === 'false') {
    return { provider: 'google', configured: false, hits: [] };
  }
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: key });
    const response: any = await ai.models.generateContent({
      model: process.env.GEMINI_WEB_SEARCH_MODEL?.trim() || 'gemini-3.8-flash',
      contents: 'Find up to ' + Math.max(3, Math.min(limit, 10)) + ' strong public-web sources for: ' + query + '. Prefer original reporting, research, expert analysis and primary sources.',
      config: { tools: [{ googleSearch: {} }] },
    });
    const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const hits: SearchHit[] = chunks
      .map((chunk: any) => chunk?.web)
      .filter(Boolean)
      .map((web: any) => ({
        url: String(web?.uri || ''),
        title: String(web?.title || web?.uri || ''),
        snippet: '',
      }))
      .filter((item: SearchHit) => Boolean(normalizeUrl(item.url)))
      .slice(0, limit);
    return { provider: 'google', configured: true, hits };
  } catch (error: any) {
    const reasonCode = sanitizeReason(error);
    return { provider: 'google', configured: true, hits: [], error: 'Google: ' + reasonCode, reasonCode };
  }
}

async function openAISearch(ownerId: string, query: string, limit: number): Promise<ProviderResult> {
  const result = await searchWebWithOpenAI({ ownerId, query, limit });
  return {
    provider: 'openai',
    configured: result.configured,
    hits: result.candidates.map(candidate => ({
      url: candidate.url,
      title: candidate.title,
      snippet: candidate.summary || candidate.description,
      publishedAt: candidate.publishedAt,
    })),
    error: result.error,
    reasonCode: result.reasonCode,
  };
}

async function callProvider(provider: WebSearchProviderId, ownerId: string, query: string, limit: number): Promise<ProviderResult> {
  if (inCooldown(provider)) {
    return { provider, configured: true, hits: [], error: provider + ': cooldown', reasonCode: 'cooldown' };
  }
  const result = provider === 'tavily'
    ? await tavilySearch(query, limit)
    : provider === 'brave'
      ? await braveSearch(query, limit)
      : provider === 'google'
        ? await googleSearch(query, limit)
        : await openAISearch(ownerId, query, limit);

  if (result.configured) {
    const status = result.reasonCode === 'quota_exhausted'
      ? 'quota_exhausted'
      : result.error
        ? 'error'
        : 'success';
    await addWebSearchUsageLog({
      ownerId,
      timestamp: new Date().toISOString(),
      provider,
      status,
      units: 1,
      unitType: provider === 'tavily' ? 'credit' : 'request',
      query: query.slice(0, 500),
    }, ownerId);
  }

  if (result.error) markFailure(provider, result.reasonCode);
  return result;
}

export function isAnyWebSearchConfigured(): boolean {
  return Boolean(
    process.env.TAVILY_API_KEY?.trim()
    || process.env.BRAVE_SEARCH_API_KEY?.trim()
    || (process.env.GOOGLE_WEB_SEARCH_ENABLED !== 'false' && process.env.GEMINI_API_KEY?.trim())
    || (process.env.OPENAI_WEB_SEARCH_ENABLED === 'true' && process.env.OPENAI_API_KEY?.trim())
  );
}

export async function searchWebCostAware(input: { ownerId: string; query: string; limit: number }) {
  const target = Math.max(1, Math.min(input.limit, 10));
  const sufficient = Math.min(target, Math.max(3, Math.ceil(target * 0.6)));
  const merged = new Map<string, SearchHit>();
  const attempts: Array<{ provider: WebSearchProviderId; configured: boolean; found: number; error?: string; reasonCode?: string }> = [];
  let firstUsed: WebSearchProviderId | undefined;
  let lastUsed: WebSearchProviderId | undefined;

  for (const provider of providerOrder()) {
    const result = await callProvider(provider, input.ownerId, input.query, target);
    attempts.push({ provider, configured: result.configured, found: result.hits.length, error: result.error, reasonCode: result.reasonCode });
    if (!result.configured) continue;
    if (!firstUsed) firstUsed = provider;
    lastUsed = provider;

    for (const hit of result.hits) {
      const url = normalizeUrl(hit.url);
      if (!url || merged.has(url)) continue;
      merged.set(url, { ...hit, url });
      if (merged.size >= target) break;
    }
    if (merged.size >= sufficient) break;
  }

  const selected = [...merged.values()].slice(0, target);
  const enriched = await Promise.all(selected.map(async hit => {
    const article = await fetchArticleMetadata(hit.url);
    const canonical = normalizeUrl(article?.canonicalUrl || article?.url || hit.url) || hit.url;
    return { hit, article, canonical };
  }));

  const deduped = new Map<string, RadarDiscoveryCandidateRecord>();
  const now = new Date().toISOString();
  for (const { hit, article, canonical } of enriched) {
    if (deduped.has(canonical)) continue;
    const sourceContentId = stableId(canonical);
    const domain = article?.domain || new URL(canonical).hostname.replace(/^www\./, '');
    const summary = (article?.description || hit.snippet || article?.text || '').slice(0, 1800);
    deduped.set(canonical, {
      id: 'rdc-' + sourceContentId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ownerId: input.ownerId,
      sourceType: 'web',
      sourceContentId,
      sourceLabel: domain,
      author: article?.author || domain,
      imageUrl: article?.imageUrl,
      summary,
      videoId: sourceContentId,
      title: article?.title || hit.title || domain,
      channelTitle: domain,
      channelId: domain,
      url: canonical,
      thumbnail: article?.imageUrl,
      publishedAt: article?.publishedAt || hit.publishedAt,
      description: article?.text || summary,
      query: input.query,
      createdAt: now,
    });
  }

  const candidates = [...deduped.values()].slice(0, target);
  const fallbackProvider = firstUsed && lastUsed && firstUsed !== lastUsed ? lastUsed : undefined;
  const lastAttempt = [...attempts].reverse().find(attempt => attempt.configured);

  return {
    provider: lastUsed || 'not_configured',
    configured: attempts.some(attempt => attempt.configured),
    candidates,
    error: candidates.length ? undefined : lastAttempt?.error,
    reasonCode: candidates.length ? undefined : lastAttempt?.reasonCode,
    primaryProvider: firstUsed,
    fallbackProvider,
    recovered: Boolean(fallbackProvider && candidates.length),
    attempts,
  };
}
