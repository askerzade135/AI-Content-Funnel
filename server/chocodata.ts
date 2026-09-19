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

    // Check if transcript_available is false or reason is provided
    if (data.transcript_available === false) {
      console.log(`[ChocoData API] Субтитры недоступны для видео ${cleanVideoId} (причина: ${data.reason || 'transcripts_disabled'})`);
      await addChocodataUsageLog({
        timestamp: new Date().toISOString(),
        videoId: cleanVideoId,
        status: 'not_found',
        message: `Transcript unavailable: ${data.reason || 'none_found'}`,
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
      }).catch(() => {});
      return null;
    }

    // Successful transcript retrieved
    await addChocodataUsageLog({
      timestamp: new Date().toISOString(),
      videoId: cleanVideoId,
      status: 'success',
      message: `Transcript fetched (${segments.length} segments, ${fullText.length} chars)`,
    }).catch(() => {});

    const language = data.language || data.language_name || data.lang || 'ru';

    return {
      text: fullText,
      segments,
      language,
      source: 'chocodata',
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
