import { getDb, addSupadataUsageLog, getSupadataUsageStats, SupadataUsageSummary, getSettingsForOwner } from './storage.js';
import { TranscriptSegment } from './youtube.js';

export class SupadataLimitExceededError extends Error {
  isLimitExceeded = true;
  statusCode = 429;
  errorCode: string;

  constructor(message: string, errorCode: string = 'limit-exceeded') {
    super(message);
    this.name = 'SupadataLimitExceededError';
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

function formatSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export interface SupadataTranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  lang: string;
  source: 'supadata';
}

/**
 * Resolves the active Supadata API key in order of priority:
 * 1. Explicitly passed key
 * 2. Environment variable SUPADATA_API_KEY
 * 3. Database settings
 */
export async function getSupadataApiKey(customKey?: string, ownerId?: string): Promise<string | null> {
  if (customKey && customKey.trim()) {
    return customKey.trim();
  }

  try {
    const db = await getDb();
    const settings = getSettingsForOwner(db, ownerId);
    if (settings.supadataApiKey && settings.supadataApiKey.trim()) {
      return settings.supadataApiKey.trim();
    }
  } catch {}

  const envKey = process.env.SUPADATA_API_KEY;
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }

  return null;
}

/**
 * Fetches video transcript via Supadata API
 */
export async function fetchTranscriptFromSupadata(
  videoId: string,
  customApiKey?: string,
  isRetry: boolean = false,
  ownerId?: string
): Promise<SupadataTranscriptResult | null> {
  const apiKey = await getSupadataApiKey(customApiKey, ownerId);
  if (!apiKey) {
    return null;
  }

  const cleanVideoId = videoId.trim();
  const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(cleanVideoId)}`;

  try {
    console.log(`[Supadata API] Запрос субтитров для видео ${cleanVideoId}...`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      let parsedErr: any = null;
      try {
        parsedErr = JSON.parse(errBody);
      } catch {}

      const errorCode = parsedErr?.error || parsedErr?.code || '';
      const is429 = response.status === 429;
      const isLimitExceeded = is429 || errorCode === 'limit-exceeded' || errorCode === 'quota_exceeded';

      if (isLimitExceeded) {
        // If this is the first attempt, wait 1.5s and retry once before throwing
        if (!isRetry) {
          console.log(`[Supadata API] Rate limit hit for ${cleanVideoId}, retrying after 1500ms...`);
          await new Promise((r) => setTimeout(r, 1500));
          return await fetchTranscriptFromSupadata(videoId, customApiKey, true, ownerId);
        }

        console.warn(`[Supadata API] ⚠️ Превышен лимит запросов к Supadata (${response.status}, code: ${errorCode}): ${errBody}`);
        await addSupadataUsageLog({
          timestamp: new Date().toISOString(),
          videoId: cleanVideoId,
          status: 'limit_exceeded',
          message: errBody || 'Supadata rate limit exceeded',
        }, ownerId).catch(() => {});
        throw new SupadataLimitExceededError(
          `Лимит запросов к Supadata API исчерпан (429 / limit-exceeded): ${parsedErr?.message || errBody}`,
          errorCode || 'limit-exceeded'
        );
      } else if (response.status === 401 || response.status === 403) {
        console.warn(`[Supadata API] Неверный API ключ или доступ запрещен (${response.status}): ${errBody}`);
        await addSupadataUsageLog({
          timestamp: new Date().toISOString(),
          videoId: cleanVideoId,
          status: 'error',
          message: `Auth error: ${response.status}`,
        }, ownerId).catch(() => {});
      } else if (response.status === 404 || response.status === 400) {
        console.log(`[Supadata API] Субтитры не найдены для видео ${cleanVideoId} (${response.status})`);
        await addSupadataUsageLog({
          timestamp: new Date().toISOString(),
          videoId: cleanVideoId,
          status: 'not_found',
          message: `Not found: ${response.status}`,
        }, ownerId).catch(() => {});
      } else {
        console.warn(`[Supadata API] Ошибка запроса (${response.status}): ${errBody}`);
        await addSupadataUsageLog({
          timestamp: new Date().toISOString(),
          videoId: cleanVideoId,
          status: 'error',
          message: `HTTP ${response.status}: ${errBody.slice(0, 100)}`,
        }, ownerId).catch(() => {});
      }
      return null;
    }

    const data: any = await response.json();
    if (!data || !Array.isArray(data.content) || data.content.length === 0) {
      console.log(`[Supadata API] Ответ получен, но массив субтитров пуст для ${cleanVideoId}`);
      await addSupadataUsageLog({
        timestamp: new Date().toISOString(),
        videoId: cleanVideoId,
        status: 'not_found',
        message: 'Empty transcript array in response',
      }, ownerId).catch(() => {});
      return null;
    }

    const segments: TranscriptSegment[] = data.content.map((item: any) => {
      const offsetSec = (item.offset || 0) / 1000;
      const durSec = (item.duration || 0) / 1000;
      return {
        text: cleanXmlCaptionText(item.text || ''),
        offset: Math.round(offsetSec),
        duration: Math.round(durSec),
        formattedTime: formatSeconds(offsetSec),
      };
    });

    const fullText = segments
      .filter((s) => s.text.length > 0)
      .map((s) => `[${s.formattedTime}] ${s.text}`)
      .join('\n');

    if (!fullText || fullText.trim().length < 20) {
      console.log(`[Supadata API] Полученный текст слишком короткий для ${cleanVideoId}`);
      return null;
    }

    // Record successful Supadata usage
    await addSupadataUsageLog({
      timestamp: new Date().toISOString(),
      videoId: cleanVideoId,
      status: 'success',
      message: `Transcript fetched (${segments.length} segments)`,
    }, ownerId).catch(() => {});

    console.log(`[Supadata API] Успешно получено ${segments.length} сегментов субтитров для ${cleanVideoId}`);
    return {
      text: fullText,
      segments,
      lang: data.lang || 'ru',
      source: 'supadata',
    };
  } catch (error: any) {
    if (error instanceof SupadataLimitExceededError || error?.isLimitExceeded || error?.name === 'SupadataLimitExceededError') {
      throw error;
    }
    console.error(`[Supadata API] Исключение при запросе субтитров для ${cleanVideoId}:`, error?.message || error);
    return null;
  }
}

const cachedLiveAccounts = new Map<string, {
  timestamp: number;
  data: { plan: string; maxCredits: number; usedCredits: number; organizationId?: string };
}>();

/**
 * Fetches account information from Supadata directly via /v1/me without consuming any transcript credits.
 * Results are cached for 15 seconds.
 */
export async function fetchSupadataLiveAccount(customKey?: string, ownerId?: string): Promise<{ plan: string; maxCredits: number; usedCredits: number; organizationId?: string } | null> {
  const apiKey = await getSupadataApiKey(customKey, ownerId);
  if (!apiKey) return null;

  const now = Date.now();
  const cacheKey = apiKey;
  const cachedLiveAccount = cachedLiveAccounts.get(cacheKey);
  if (cachedLiveAccount && (now - cachedLiveAccount.timestamp < 15000)) {
    return cachedLiveAccount.data;
  }

  try {
    const res = await fetch('https://api.supadata.ai/v1/me', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (res.ok) {
      const json: any = await res.json();
      if (json && typeof json.usedCredits === 'number') {
        const result = {
          plan: json.plan || 'Free (100/mo)',
          maxCredits: json.maxCredits ?? 100,
          usedCredits: json.usedCredits,
          organizationId: json.organizationId,
        };
        cachedLiveAccounts.set(cacheKey, {
          timestamp: now,
          data: result,
        });
        return result;
      }
    }
  } catch (err: any) {
    console.warn('[Supadata API] Не удалось запросить /v1/me:', err?.message || err);
  }
  return null;
}

/**
 * Returns merged Supadata stats: combines local request logs with real-time live account quota from /v1/me.
 */
export async function getSupadataCombinedUsage(ownerId?: string, customKey?: string): Promise<SupadataUsageSummary> {
  const localStats = await getSupadataUsageStats(ownerId);
  const liveAccount = await fetchSupadataLiveAccount(customKey, ownerId);

  if (liveAccount) {
    const usedThisMonth = Math.max(localStats.usedThisMonth, liveAccount.usedCredits);
    const monthlyLimit = liveAccount.maxCredits || 100;
    const remainingThisMonth = Math.max(0, monthlyLimit - usedThisMonth);
    const isLimitExceeded = localStats.isLimitExceeded || usedThisMonth >= monthlyLimit;

    return {
      usedThisMonth,
      monthlyLimit,
      remainingThisMonth: isLimitExceeded ? 0 : remainingThisMonth,
      isLimitExceeded,
      usedLast24h: localStats.usedLast24h,
      planName: liveAccount.plan,
      isLiveAccount: true,
    };
  }

  return {
    ...localStats,
    planName: 'Free (100/mo)',
    isLiveAccount: false,
  };
}

/**
 * Tests connection to Supadata API using /v1/me (does NOT consume any credits!)
 */
export async function testSupadataConnection(apiKey: string): Promise<{
  success: boolean;
  message: string;
  plan?: string;
  maxCredits?: number;
  usedCredits?: number;
}> {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, message: 'API ключ Supadata не указан.' };
  }

  try {
    const url = 'https://api.supadata.ai/v1/me';
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey.trim(),
        'Accept': 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      return { success: false, message: 'Неверный API ключ Supadata (ошибка авторизации 401/403).' };
    }

    if (response.status === 429) {
      return { success: false, message: 'Исчерпан лимит запросов на тарифе Supadata (ошибка 429).' };
    }

    if (response.ok) {
      const data: any = await response.json();
      const plan = data?.plan || 'Free';
      const used = data?.usedCredits ?? 0;
      const max = data?.maxCredits ?? 100;
      return {
        success: true,
        message: `Подключение успешно! Тариф: ${plan}. Использовано: ${used} из ${max} кредитов.`,
        plan,
        maxCredits: max,
        usedCredits: used,
      };
    }

    return {
      success: true,
      message: `Подключение проверено (код ответа ${response.status}).`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Не удалось связаться с сервером Supadata: ${err.message || String(err)}`,
    };
  }
}
