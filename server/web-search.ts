import { createHash } from 'node:crypto';
import { callOpenAIResponses, DEFAULT_OPENAI_MODEL, extractOpenAIOutputText } from './openai.js';
import { RadarDiscoveryCandidateRecord } from './storage.js';

export const DEFAULT_OPENAI_WEB_SEARCH_MODEL =
  process.env.OPENAI_WEB_SEARCH_MODEL?.trim() ||
  process.env.OPENAI_MODEL?.trim() ||
  DEFAULT_OPENAI_MODEL;

export function isOpenAIWebSearchConfigured(): boolean {
  return process.env.OPENAI_WEB_SEARCH_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY?.trim());
}

function reasonCode(error: any): string {
  const status = Number(error?.status || 0);
  if (status === 429) return 'quota_exhausted';
  if (status === 401 || status === 403) return 'invalid_api_key';
  if (status === 404) return 'model_unavailable';
  if (status === 503) return 'provider_unavailable';
  return 'provider_error';
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function stableContentId(url: string): string {
  return `web-${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
}

function collectSources(payload: any): Array<{ url: string; title?: string }> {
  const collected: Array<{ url: string; title?: string }> = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type === 'web_search_call') {
      for (const source of Array.isArray(item?.action?.sources) ? item.action.sources : []) {
        if (typeof source?.url === 'string') collected.push({ url: source.url, title: source.title });
      }
    }
    if (item?.type === 'message') {
      for (const part of Array.isArray(item?.content) ? item.content : []) {
        for (const annotation of Array.isArray(part?.annotations) ? part.annotations : []) {
          if (annotation?.type === 'url_citation' && typeof annotation?.url === 'string') {
            collected.push({ url: annotation.url, title: annotation.title });
          }
        }
      }
    }
  }
  const seen = new Set<string>();
  return collected.filter(source => {
    const normalized = normalizeUrl(source.url);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    source.url = normalized;
    return true;
  });
}

export async function searchWebWithOpenAI(input: { ownerId: string; query: string; limit: number }) {
  const model = DEFAULT_OPENAI_WEB_SEARCH_MODEL;
  if (!isOpenAIWebSearchConfigured()) {
    return { provider: 'openai_web_search' as const, model, configured: false, candidates: [] as RadarDiscoveryCandidateRecord[] };
  }

  const startedAt = Date.now();
  try {
    const payload = await callOpenAIResponses({
      model,
      input: `Search the public web for strong source material relevant to this Discovery query: "${input.query}". Prefer substantive original reporting, research, expert analysis, primary sources, and useful essays. Avoid duplicate URLs, thin SEO pages, and obvious spam. Return concise findings with citations.`,
      tools: [{ type: 'web_search' }],
      toolChoice: 'required',
      include: ['web_search_call.action.sources'],
      maxOutputTokens: 1200,
    });
    const summary = extractOpenAIOutputText(payload);
    const sources = collectSources(payload).slice(0, Math.max(1, Math.min(input.limit, 10)));
    const now = new Date().toISOString();
    const candidates: RadarDiscoveryCandidateRecord[] = sources.map(source => {
      const sourceContentId = stableContentId(source.url);
      const hostname = new URL(source.url).hostname.replace(/^www\./, '');
      return {
        id: `rdc-${sourceContentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ownerId: input.ownerId,
        sourceType: 'web',
        sourceContentId,
        sourceLabel: hostname,
        author: hostname,
        summary: summary.slice(0, 1600),
        videoId: sourceContentId,
        title: source.title?.trim() || hostname,
        channelTitle: hostname,
        channelId: hostname,
        url: source.url,
        description: summary.slice(0, 1600),
        query: input.query,
        createdAt: now,
      };
    });
    return { provider: 'openai_web_search' as const, model, configured: true, candidates };
  } catch (error: any) {
    const code = reasonCode(error);
    console.warn(JSON.stringify({
      event: 'radar_web_search_failed',
      ownerId: input.ownerId,
      provider: 'openai_web_search',
      model,
      reasonCode: code,
      latencyMs: Date.now() - startedAt,
    }));
    return {
      provider: 'openai_web_search' as const,
      model,
      configured: true,
      candidates: [] as RadarDiscoveryCandidateRecord[],
      error: `Web Search: ${code}`,
      reasonCode: code,
    };
  }
}
