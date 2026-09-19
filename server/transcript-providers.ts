import { YoutubeTranscript } from 'youtube-transcript';
import { fetchTranscriptFromSupadata, SupadataLimitExceededError, getSupadataApiKey } from './supadata.js';
import { fetchTranscriptFromChocodata, ChocodataLimitExceededError, getChocodataApiKey } from './chocodata.js';
import { transcribeVideoAudioWithGemini, YouTubeBotBlockError } from './audio.js';
import { getSupadataUsageStats, getChocodataUsageStats } from './storage.js';
import { TranscriptSegment, formatSeconds } from './youtube.js';
import { getCachedTranscript, saveCachedTranscript } from './transcript-cache.js';
import { getUserQuota, recordTranscriptUsage } from './quotas.js';

export interface TranscriptProviderResult {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  sourceKey?: 'subtitles' | 'supadata' | 'chocodata' | 'gemini_multimodal';
}

export interface TranscriptProvider {
  name: string; // "youtube-direct", "supadata", "chocodata"
  displayName: string;
  sourceKey: 'subtitles' | 'supadata' | 'chocodata';
  authMethod: 'none' | 'header' | 'query'; // способ передачи ключа
  quotaResetPolicy: 'monthly' | 'never'; // Supadata — monthly, ChocoData — never (разовый пакет)
  quotaLimit: number; // Supadata: 100, ChocoData: 200, youtube-direct: Infinity
  getApiKey?(ownerId?: string): Promise<string | null>;
  isQuotaExhausted?(ownerId?: string): Promise<boolean>;
  fetchTranscript(videoId: string, ownerId?: string): Promise<TranscriptProviderResult | null>;
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

/**
 * 1. Level A: Public direct YouTube Captions (Scraper)
 * Free, direct, fastest
 */
export const youtubeDirectProvider: TranscriptProvider = {
  name: 'youtube-direct',
  displayName: 'Субтитры YouTube (А)',
  sourceKey: 'subtitles',
  authMethod: 'none',
  quotaResetPolicy: 'monthly',
  quotaLimit: Infinity,
  getApiKey: async () => null,
  isQuotaExhausted: async () => false,
  fetchTranscript: async (videoId: string, _ownerId?: string): Promise<TranscriptProviderResult | null> => {
    try {
      const rawSegments = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: 'ru',
      }).catch(async () => {
        return await YoutubeTranscript.fetchTranscript(videoId);
      });

      if (rawSegments && rawSegments.length > 0) {
        const segments: TranscriptSegment[] = rawSegments.map((item: any) => {
          const offsetSec = (item.offset || 0) / 1000;
          const durSec = (item.duration || 0) / 1000;
          return {
            text: cleanXmlCaptionText(item.text),
            offset: Math.round(offsetSec),
            duration: Math.round(durSec),
            formattedTime: formatSeconds(offsetSec),
          };
        }).filter((s) => s.text.length > 0);

        if (segments.length > 0) {
          const fullText = segments.map((s) => `[${s.formattedTime}] ${s.text}`).join('\n');
          return {
            text: fullText,
            segments,
            language: 'ru',
          };
        }
      }
    } catch {
      // Direct subtitles not available or blocked
    }
    return null;
  },
};

/**
 * 2. Level B1: Supadata API Gateway
 * Monthly 100 free requests (resets on 1st day of each month)
 * Auth: Header `x-api-key`
 */
export const supadataProvider: TranscriptProvider = {
  name: 'supadata',
  displayName: 'Supadata API (Б)',
  sourceKey: 'supadata',
  authMethod: 'header',
  quotaResetPolicy: 'monthly',
  quotaLimit: 100,
  getApiKey: async (ownerId?: string) => await getSupadataApiKey(undefined, ownerId),
  isQuotaExhausted: async (ownerId?: string) => {
    try {
      const stats = await getSupadataUsageStats(ownerId);
      return stats.isLimitExceeded || stats.usedThisMonth >= (stats.monthlyLimit || 100);
    } catch {
      return false;
    }
  },
  fetchTranscript: async (videoId: string, ownerId?: string): Promise<TranscriptProviderResult | null> => {
    const result = await fetchTranscriptFromSupadata(videoId, undefined, false, ownerId);
    if (result && result.text && result.text.trim().length >= 50) {
      return {
        text: result.text,
        segments: result.segments,
        language: result.lang,
      };
    }
    return null;
  },
};

/**
 * 3. Level B2: ChocoData YouTube Transcript API
 * One-time pack of 1000 credits (5 credits/call = ~200 calls), never resets
 * Auth: Query parameter `?api_key=...`
 */
export const chocodataProvider: TranscriptProvider = {
  name: 'chocodata',
  displayName: 'ChocoData API (Б2)',
  sourceKey: 'chocodata',
  authMethod: 'query',
  quotaResetPolicy: 'never',
  quotaLimit: 200,
  getApiKey: async (ownerId?: string) => await getChocodataApiKey(undefined, ownerId),
  isQuotaExhausted: async (ownerId?: string) => {
    try {
      const stats = await getChocodataUsageStats(ownerId);
      return stats.isLimitExceeded || stats.usedTotal >= (stats.totalLimit || 200);
    } catch {
      return false;
    }
  },
  fetchTranscript: async (videoId: string, ownerId?: string): Promise<TranscriptProviderResult | null> => {
    const result = await fetchTranscriptFromChocodata(videoId, undefined, false, ownerId);
    if (result && result.text && result.text.trim().length >= 50) {
      return {
        text: result.text,
        segments: result.segments,
        language: result.language,
      };
    }
    return null;
  },
};

/**
 * Configurable ordered list of transcript providers.
 * 
 * Order:
 * 1. youtube-direct (Открытые субтитры YouTube)
 * 2. supadata (Supadata API Gateway, 100/мес)
 * 3. chocodata (ChocoData API, ~200 разово)
 * 
 * To add a new provider in the future:
 * Define a new TranscriptProvider object and append/insert it into this array.
 */
export const TRANSCRIPT_PROVIDERS: TranscriptProvider[] = [
  youtubeDirectProvider,
  supadataProvider,
  chocodataProvider,
];

export interface ExtractTranscriptOptions {
  allowGeminiAudioFallback?: boolean;
  forcePaidModel?: boolean;
  ownerId?: string;
}

export interface ExtractTranscriptResponse {
  text: string;
  segments: TranscriptSegment[];
  source: 'subtitles' | 'supadata' | 'chocodata' | 'gemini_multimodal';
  language?: string;
}

/**
 * Executes the configured chain of transcript providers in sequence.
 * If all fast subtitle providers fail / are exhausted, seamlessly falls back to Gemini Audio (multimodal AI).
 */
export async function executeTranscriptChain(
  videoId: string,
  videoTitle?: string,
  options?: ExtractTranscriptOptions
): Promise<ExtractTranscriptResponse> {
  const allowGeminiFallback = options?.allowGeminiAudioFallback ?? true;

  const cached = await getCachedTranscript(videoId);
  if (cached) {
    console.log(`[Transcript Cache] ♻️ Используем общий транскрипт для ${videoId} (provider: ${cached.provider})`);
    return {
      text: cached.text,
      segments: cached.segments || [],
      source: cached.provider || 'subtitles',
      language: cached.language,
    };
  }

  const quota = await getUserQuota(options?.ownerId);
  if (quota.transcripts >= quota.limits.transcripts) {
    const error: any = new Error('Лимит транскрипций пользователя исчерпан');
    error.code = 'PRODUCT_QUOTA_EXCEEDED';
    error.metric = 'transcripts';
    throw error;
  }

  for (const provider of TRANSCRIPT_PROVIDERS) {
    // 1. Check if auth is required and API key exists
    if (provider.authMethod !== 'none') {
      const key = provider.getApiKey ? await provider.getApiKey(options?.ownerId) : null;
      if (!key) {
        // Provider is not configured (no key), skip quietly
        continue;
      }
    }

    // 2. Check if local quota tracker shows provider is already exhausted
    if (provider.isQuotaExhausted) {
      const isExhausted = await provider.isQuotaExhausted(options?.ownerId).catch(() => false);
      if (isExhausted) {
        console.log(`[Transcript Chain] ⚠️ Провайдер ${provider.displayName} пропущен (квота исчерпана).`);
        continue;
      }
    }

    // 3. Attempt transcript retrieval
    try {
      console.log(`[Transcript Chain] Пробуем провайдер: ${provider.displayName} для ${videoId}...`);
      const result = await provider.fetchTranscript(videoId, options?.ownerId);

      if (result && result.text && result.text.trim().length >= 50) {
        console.log(`[Transcript Chain] ✅ Успешно получен транскрипт от ${provider.displayName} для ${videoId} (${result.segments.length} сегментов)`);
        await saveCachedTranscript({
          videoId,
          text: result.text,
          segments: result.segments,
          language: result.language,
          provider: result.sourceKey || provider.sourceKey,
        });
        const durationMinutes = result.segments.reduce((max, s) => Math.max(max, (s.offset + s.duration) / 60), 0);
        await recordTranscriptUsage(options?.ownerId, durationMinutes).catch((quotaErr) => {
          throw quotaErr;
        });
        return {
          text: result.text,
          segments: result.segments,
          source: provider.sourceKey,
          language: result.language,
        };
      } else {
        console.log(`[Transcript Chain] Субтитры не найдены у провайдера ${provider.displayName} для ${videoId}`);
      }
    } catch (err: any) {
      if (err instanceof SupadataLimitExceededError || err?.isLimitExceeded || err instanceof ChocodataLimitExceededError) {
        console.warn(`[Transcript Chain] ⚠️ Провайдер ${provider.displayName} исчерпал лимит для ${videoId}. Переход к следующему звёну цепи...`);
      } else {
        console.warn(`[Transcript Chain] Ошибка провайдера ${provider.displayName} для ${videoId}:`, err?.message || err);
      }
    }
  }

  // Final Stage: Level C (Gemini Audio multimodal AI transcription)
  if (allowGeminiFallback) {
    console.log(`[Transcript Chain] Все провайдеры субтитров завершены. Переход на Уровень В (Gemini Audio File API) для ${videoId}...`);
    try {
      const audioResult = await transcribeVideoAudioWithGemini(videoId, videoTitle, {
        forcePaidModel: options?.forcePaidModel,
      });
      const durationMinutes = audioResult.segments.reduce(
        (max, s) => Math.max(max, (s.offset + s.duration) / 60),
        0
      );
      await saveCachedTranscript({
        videoId,
        text: audioResult.text,
        segments: audioResult.segments,
        provider: 'gemini_multimodal',
      });
      await recordTranscriptUsage(options?.ownerId, durationMinutes);
      return {
        text: audioResult.text,
        segments: audioResult.segments,
        source: 'gemini_multimodal',
      };
    } catch (audioErr: any) {
      console.warn('[Transcript Chain] Ошибка распознавания через Gemini Audio:', audioErr.message || audioErr);
      if (audioErr?.isBotBlock || audioErr?.name === 'YouTubeBotBlockError') {
        throw audioErr;
      }
      const errMsg = audioErr?.message || String(audioErr);
      if (errMsg.includes('429') || errMsg.includes('Quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        const error: any = new Error(`Лимит запросов Gemini AI исчерпан (429): ${errMsg}`);
        error.isQuotaExceeded = true;
        throw error;
      }
      throw audioErr;
    }
  }

  throw new Error('Субтитры отсутствуют на YouTube (открытые субтитры не найдены ни у одного провайдера).');
}
