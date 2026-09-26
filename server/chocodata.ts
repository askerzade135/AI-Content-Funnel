import { getDb, addChocodataUsageLog, getChocodataUsageStats, ChocodataUsageSummary, getSettingsForOwner } from './storage.js';
import { TranscriptSegment, formatSeconds } from './youtube.js';

export class ChocodataLimitExceededError extends Error {
  isLimitExceeded = true;
  statusCode = 429;
  errorCode: string;

  constructor(message: string, errorCode: string = 'quota_exceeded') {
    super(message);
    this.name = 'ChocodataLimitExceededError';
    this.errorCode = errorCode;
  }
}

function cleanXmlCaptionText(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export interface ChocodataTranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  source: 'chocodata';
  providerQuota?: {
    used?: number | null;
    limit?: number | null;
    remaining?: number | null;
    resetAt?: string | null;
    unit?: 'request' | 'credit';
    source: 'provider_response';
  };
}

function finiteNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function firstFinite(...values: any[]): number | null {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function extractChocodataQuota(data: any, headers: Headers): ChocodataTranscriptResult['providerQuota'] | undefined {
  const quota = data?.quota || data?.usage || data?.meta?.quota || data?.meta?.usage || data?.credits || {};
  const requestRemaining = firstFinite(
    data?.requests_remaining,
    data?.remaining_requests,
    quota?.requests_remaining,
    quota?.remaining_requests,
    quota?.remaining,
    headers.get('x-ratelimit-remaining'),
    headers.get('x-rate-limit-remaining'),
    headers.get('x-requests-remaining')
  );
  const requestLimit = firstFinite(
    data?.requests_limit,
    data?.request_limit,
    quota?.requests_limit,
    quota?.request_limit,
    quota?.limit,
    headers.get('x-ratelimit-limit'),
    headers.get('x-rate-limit-limit'),
    headers.get('x-requests-limit')
  );
  const requestUsed = firstFinite(
    data?.requests_used,
    data?.used_requests,
    quota?.requests_used,
    quota?.used_requests,
    quota?.used
  );

  const creditRemaining = firstFinite(
    data?.credits_remaining,
    data?.remaining_credits,
    quota?.credits_remaining,
    quota?.remaining_credits,
    headers.get('x-credits-remaining')
  );
  const creditLimit = firstFinite(
    data?.credits_limit,
    data?.credit_limit,
    quota?.credits_limit,
    quota?.credit_limit,
    headers.get('x-credits-limit')
  );
  const creditUsed = firstFinite(
    data?.credits_used,
    data?.used_credits,
    quota?.credits_used,
    quota?.used_credits
  );

  const hasRequestQuota = requestRemaining !== null || requestLimit !== null || requestUsed !== null;
  const hasCreditQuota = creditRemaining !== null || creditLimit !== null || creditUsed !== null;
  if (!hasRequestQuota && !hasCreditQuota) return undefined;

  const unit: 'request' | 'credit' = hasRequestQuota ? 'request' : 'credit';
  let remaining = hasRequestQuota ? requestRemaining : creditRemaining;
  let limit = hasRequestQuota ? requestLimit : creditLimit;
  let used = hasRequestQuota ? requestUsed : creditUsed;

  if (used === null && limit !== null && remaining !== null) used = Math.max(0, limit - remaining);
  if (remaining === null && limit !== null && used !== null) remaining = Math.max(0, limit - used);
  if (limit === null && used !== null && remaining !== null) limit = used + remaining;

  const resetAt = String(
    data?.quota_reset_at ||
    data?.reset_at ||
    quota?.reset_at ||
    headers.get('x-ratelimit-reset') ||
    ''
  ).trim() || null;

  return { used, limit, remaining, resetAt, unit, source: 'provider_response' };
}

/**
 * Resolves the active ChocoData API key in order of priority:
 * 1. Explicitly passed key
 * 2. Environment variable CHOCODATA_API_KEY
 * 3. Database settings (db.settings.chocodataApiKey)
 */
export async function getChocodataApiKey(customKey?: string, ownerId?: string): Promise<string | null> {
  if (customKey && customKey.trim()) {
    return customKey.trim();
  }

  try {
    const db = await getDb();
    const settings = getSettingsForOwner(db, ownerId);
    if (settings.chocodataApiKey && settings.chocodataApiKey.trim()) {
      return settings.chocodataApiKey.trim();
    }
  } catch {}

  const envKey = process.env.CHOCODATA_API_KEY;
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }

  return null;
}

/**
 * Fetches video transcript via ChocoData YouTube Transcript Scraper API.
 * 
 * Note on Authentication:
 * ChocoData requires API key passed as query parameter `?api_key=<key>` (or `?key=<key>`).
 * Header authentication (Authorization / x-api-key) returns 401 with 'Missing api_key query parameter'.
 */
export async function fetchTranscriptFromChocodata(
  videoId: string,
  customApiKey?: string,
  isRetry: boolean = false,
  ownerId?: string
): Promise<ChocodataTranscriptResult | null> {
  const apiKey = await getChocodataApiKey(customApiKey, ownerId);
  if (!apiKey) {
    return null;
  }

  const cleanVideoId = videoId.trim();
  // ChocoData YouTube Transcript API endpoint: pass key via query parameter with explicit format and units
  const url = `https://api.chocodata.com/api/v1/youtube/transcript?video_id=${encodeURIComponent(cleanVideoId)}&format=segments&units=seconds&api_key=${encodeURIComponent(apiKey)}`;

  try {
    console.log(`[ChocoData API] Запрос субтитров для видео ${cleanVideoId}...`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      let parsedErr: any = null;
      try {
        parsedErr = JSON.parse(errBody);
      } catch {}

      const errObj = parsedErr?.error || parsedErr;
      const errorCode = errObj?.code || errObj?.error || '';
      const is429 = response.status === 429;
      const isLimitExceeded = is429 || 
        errorCode === 'INSUFFICIENT_CREDITS' || 
        errorCode === 'quota_exceeded' || 
        errorCode === 'limit-exceeded' ||
        (typeof errObj?.message === 'string' && errObj.message.toLowerCase().includes('credit'));

      if (isLimitExceeded) {
        if (!isRetry) {
          console.log(`[ChocoData API] Rate limit hit for ${cleanVideoId}, retrying after 1500ms...`);
          await new Promise((r) => setTimeout(r, 1500));
          return await fetchTranscriptFromChocodata(videoId, customApiKey, true, ownerId);
        }

        console.warn(`[ChocoData API] ⚠️ Превышен лимит запросов/кредитов к ChocoData (${response.status}, code: ${errorCode}): ${errBody}`);
        await addChocodataUsageLog({
          timestamp: new Date().toISOString(),
          videoId: cleanVideoId,
          status: 'limit_exceeded',
          message: errBody || 'ChocoData credits exhausted',
        }).catch(() => {});

        throw new ChocodataLimitExceededError(
          `Лимит кредитов к ChocoData API исчерпан (429 / INSUFFICIENT_CREDITS): ${errObj?.message || errBody}`,
          errorCode || 'quota_exceeded'
        );
      } else if (response.status === 401 || response.status === 403) {
        console.warn(`[ChocoData API] Неверный API ключ или доступ запрещен (${response.status}): ${errBody}`);
        await addChocodataUsageLog({
          timestamp: new Date().toISOString(),
          videoId: cleanVideoId,
          status: 'error',
          message: `Auth error: ${response.status} (${errObj?.message || 'Invalid key'})`,
        }).catch(() => {});
      } else if (response.status === 404 || response.status === 400) {
        console.log(`[ChocoData API] Субтитры не найдены для видео ${cleanVideoId} (${response.status})`);
        await addChocodataUsageLog({
          timestamp: new Date().toISOString(),
          videoId: cleanVideoId,
          status: 'not_found',
          message: `Not found: ${response.status}`,
        }).catch(() => {});
      } else {
        console.warn(`[ChocoData API] Ошибка запроса (${response.status}): ${errBody}`);
        await addChocodataUsageLog({
          timestamp: new Date().toISOString(),
          videoId: cleanVideoId,
          status: 'error',
          message: `HTTP ${response.status}: ${errBody.slice(0, 100)}`,
        }).catch(() => {});
      }
      return null;
    }

    const data: any = await response.json();
    const providerQuota = extractChocodataQuota(data, response.headers);

    // Check if transcript_available is false or reason is provided
    if (data.transcript_available === false) {
      console.log(`[ChocoData API] Субтитры недоступны для видео ${cleanVideoId} (причина: ${data.reason || 'transcripts_disabled'})`);
      await addChocodataUsageLog({
        timestamp: new Date().toISOString(),
        videoId: cleanVideoId,
        status: 'not_found',
        message: `Transcript unavailable: ${data.reason || 'none_found'}`,
        providerQuota,
      }).catch(() => {});
      return null;
    }

    // Parse segments
    let segments: TranscriptSegment[] = [];
    if (Array.isArray(data.segments) && data.segments.length > 0) {
      segments = data.segments.map((item: any) => {
        const rawStart = typeof item.start === 'number' ? item.start : (typeof item.offset === 'number' ? item.offset : 0);
        // Normalize milliseconds to seconds if > 10000
        const startSec = rawStart > 10000 ? rawStart / 1000 : rawStart;
        const rawDur = typeof item.duration === 'number' ? item.duration : 0;
        const durSec = rawDur > 10000 ? rawDur / 1000 : rawDur;

        return {
          text: cleanXmlCaptionText(item.text || item.content || ''),
          offset: Math.round(startSec),
          duration: Math.round(durSec),
          formattedTime: formatSeconds(startSec),
        };
      }).filter((s: TranscriptSegment) => s.text.length > 0);
    }

    // Build text: prefer formatted timestamped text from segments, fallback to data.text
    let fullText = '';
    if (segments.length > 0) {
      fullText = segments.map((s) => `[${s.formattedTime}] ${s.text}`).join('\n');
    } else if (typeof data.text === 'string' && data.text.trim().length > 0) {
      fullText = data.text.trim();
    }

    if (!fullText || fullText.trim().length < 50) {
      console.log(`[ChocoData API] Получен слишком короткий или пустой транскрипт для ${cleanVideoId}`);
      await addChocodataUsageLog({
        timestamp: new Date().toISOString(),
        videoId: cleanVideoId,
        status: 'not_found',
        message: 'Transcript too short or empty',
        providerQuota,
      }).catch(() => {});
      return null;
    }

    // Successful transcript retrieved
    await addChocodataUsageLog({
      timestamp: new Date().toISOString(),
      videoId: cleanVideoId,
      status: 'success',
      message: `Transcript fetched (${segments.length} segments, ${fullText.length} chars)`,
      providerQuota,
    }).catch(() => {});

    const language = data.language || data.language_name || data.lang || 'ru';

    return {
      text: fullText,
      segments,
      language,
      source: 'chocodata',
      providerQuota,
    };
  } catch (err: any) {
    if (err instanceof ChocodataLimitExceededError || err?.isLimitExceeded) {
      throw err;
    }
    console.warn(`[ChocoData API] Необработанная ошибка для ${cleanVideoId}:`, err?.message || err);
    await addChocodataUsageLog({
      timestamp: new Date().toISOString(),
      videoId: cleanVideoId,
      status: 'error',
      message: err?.message || String(err),
    }).catch(() => {});
    return null;
  }
}

/**
 * Tests connection to ChocoData API using a sample lightweight request.
 * Note: Key is sent as query parameter ?api_key=<key>.
 */
export async function testChocodataConnection(apiKey: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, message: 'API ключ ChocoData не указан.' };
  }

  const cleanKey = apiKey.trim();
  try {
    // We send request to test if API key is recognized by ChocoData (using sample video ID dQw4w9WgXcQ)
    const url = `https://api.chocodata.com/api/v1/youtube/transcript?video_id=dQw4w9WgXcQ&format=segments&units=seconds&api_key=${encodeURIComponent(cleanKey)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      const errBody = await response.text().catch(() => '');
      return { success: false, message: `Неверный API ключ ChocoData (${response.status}): ${errBody || 'Api key not recognised'}` };
    }

    if (response.status === 429) {
      return { success: false, message: 'Исчерпан лимит кредитов пакета ChocoData (ошибка 429 / INSUFFICIENT_CREDITS).' };
    }

    if (response.ok) {
      return {
        success: true,
        message: 'Подключение к ChocoData API успешно проверено! Ключ валиден.',
      };
    }

    return {
      success: true,
      message: `Подключение проверено (код ответа ${response.status}).`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Не удалось связаться с сервером ChocoData: ${err.message || String(err)}`,
    };
  }
}
