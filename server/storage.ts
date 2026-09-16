import fs from 'fs/promises';
import path from 'path';
import { PromptTemplateDef, DEFAULT_PROMPT_DEFINITIONS } from './gemini.js';

export interface TrackedChannel {
  id: string; // YouTube Channel ID (e.g. UC...)
  title: string;
  handle?: string;
  avatarUrl?: string;
  url: string;
  autoSync: boolean;
  lastCheckedAt?: string;
  createdAt: string;
  videoCount?: number;
}

export interface DeletedVideoInfo {
  id: string;
  title: string;
  channelId: string;
  channelTitle?: string;
  thumbnail?: string;
  publishedAt?: string;
  deletedAt: string;
  permanentlyIgnored?: boolean;
}

export interface StoredVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  url: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  status: 'new' | 'transcribe_queued' | 'transcribing' | 'transcribed' | 'processing_gemini' | 'completed' | 'error' | 'quota_exceeded' | 'requires_payment';
  pendingPaidAction?: 'transcription' | 'stage1' | 'filter' | 'stage2' | 'script' | 'pipeline' | string;
  paidActionReason?: string;
  lastPassedStatus?: 'new' | 'transcribed' | 'approved' | 'rejected' | 'has_script';
  errorStage?: 'transcription' | 'filter' | 'script' | string;
  transcript?: string;
  transcriptSource?: 'subtitles' | 'gemini_multimodal' | 'supadata';
  transcriptSegments?: Array<{
    text: string;
    offset: number;
    duration: number;
    formattedTime: string;
  }>;
  geminiResult?: string;
  geminiPromptTemplate?: string;
  customPromptUsed?: string;
  matchedFilter?: boolean;
  filterReason?: string;
  rejectionCategory?: 'filter' | 'transcription' | string;
  scriptCount?: number;
  isReviewed?: boolean;
  reviewedAt?: string;
  isArchived?: boolean;
  queueTimestamp?: string;
  processedAt?: string;
  error?: string;
  retryCount?: number;
  lastErrorAt?: string;
  forcePaidModel?: boolean;
  updatedAt: string;
}

export interface SyncLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
  videoTitle?: string;
  videoId?: string;
}

export interface AppSettings {
  dailySyncEnabled: boolean;
  intervalHours: number; // default 24
  autoProcessNewVideos: boolean; // if true, auto transcribes & sends to gemini
  autoProcessMode?: 'filter_screener' | 'transcription_only' | 'two_stage_pipeline'; // default 'filter_screener' (Stage 1 only, no scenario writing)
  defaultPromptTemplate: string;
  defaultFilterPromptTemplate?: string;
  defaultScriptwriterPromptTemplate?: string;
  customFilterPrompt?: string;
  customScriptwriterPrompt?: string;
  customPrompt: string;
  supadataApiKey?: string;
  telegramAutoSend?: boolean;
  telegramChatId?: string;
  skipTelegramIfFilteredOut?: boolean;
  lastSyncRun: string | null;
  nextSyncRun: string | null;
}

export interface GeneratedScript {
  id: string;
  createdAt: string;
  title: string;
  promptTemplate: string;
  customPrompt?: string;
  customPromptUsed?: string;
  ideaTitle?: string;
  videoIds: string[];
  videoTitles: string[];
  content: string;
  matchedFilter?: boolean;
  telegramSent?: boolean;
  telegramSentAt?: string;
  telegramMessageIds?: number[];
}

export interface GeminiUsageLog {
  id: string;
  timestamp: string;
  model: string;
  isPaid: boolean;
  operation?: string;
  videoId?: string;
  videoTitle?: string;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens?: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface GeminiUsageSummary {
  freeTier: {
    requestsCount: number;
    promptTokens: number;
    candidatesTokens: number;
    thoughtsTokens: number;
    totalTokens: number;
    dailyLimitRequests: number;
    remainingRequests: number;
    limitType: string;
  };
  paidTier: {
    requestsCount: number;
    promptTokens: number;
    candidatesTokens: number;
    thoughtsTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
}

export interface SupadataUsageLog {
  id: string;
  timestamp: string;
  videoId?: string;
  status: 'success' | 'limit_exceeded' | 'error' | 'not_found';
  message?: string;
}

export interface SupadataUsageSummary {
  usedThisMonth: number;
  monthlyLimit: number;
  remainingThisMonth: number;
  isLimitExceeded: boolean;
  usedLast24h: number;
  planName?: string;
  isLiveAccount?: boolean;
}

export function calculateTokenCost(
  model: string,
  isPaid: boolean,
  promptTokens: number,
  candidatesTokens: number,
  thoughtsTokens = 0
): number {
  if (!isPaid) return 0;
  const isPro = model.includes('pro');
  if (isPro) {
    // Pro pricing: $1.25 per 1M input, $5.00 per 1M output (candidates + thoughts)
    const inputCost = (promptTokens / 1_000_000) * 1.25;
    const outputCost = ((candidatesTokens + thoughtsTokens) / 1_000_000) * 5.00;
    return Number((inputCost + outputCost).toFixed(6));
  } else {
    // Flash pricing: $0.075 per 1M input, $0.30 per 1M output (candidates + thoughts)
    const inputCost = (promptTokens / 1_000_000) * 0.075;
    const outputCost = ((candidatesTokens + thoughtsTokens) / 1_000_000) * 0.30;
    return Number((inputCost + outputCost).toFixed(6));
  }
}

export interface AppDatabase {
  channels: TrackedChannel[];
  videos: StoredVideo[];
  deletedVideos?: DeletedVideoInfo[];
  settings: AppSettings;
  scripts: GeneratedScript[];
  promptTemplates: PromptTemplateDef[];
  logs: SyncLog[];
  geminiUsageLogs?: GeminiUsageLog[];
  supadataUsageLogs?: SupadataUsageLog[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_DB: AppDatabase = {
  channels: [],
  videos: [],
  deletedVideos: [],
  settings: {
    dailySyncEnabled: true,
    intervalHours: 24,
    autoProcessNewVideos: false,
    autoProcessMode: 'filter_screener',
    defaultPromptTemplate: 'two_stage_pipeline',
    defaultFilterPromptTemplate: 'filter_screener',
    defaultScriptwriterPromptTemplate: 'scriptwriter_deep',
    customPrompt: '',
    customFilterPrompt: '',
    customScriptwriterPrompt: '',
    supadataApiKey: process.env.SUPADATA_API_KEY || 'sd_30bffc47dab3bc4a577e7eebff8c61fd',
    telegramAutoSend: false,
    telegramChatId: '',
    lastSyncRun: null,
    nextSyncRun: null,
  },
  scripts: [],
  promptTemplates: [...DEFAULT_PROMPT_DEFINITIONS],
  logs: [
    {
      id: 'init-1',
      timestamp: new Date().toISOString(),
      type: 'info',
      message: 'Система мониторинга каналов и конвертации в Gemini инициализирована.',
    },
  ],
};

let memoryDb: AppDatabase | null = null;
let writeQueue = Promise.resolve();

export async function getDb(): Promise<AppDatabase> {
  if (memoryDb) return memoryDb;

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const content = await fs.readFile(DB_FILE, 'utf-8');
    memoryDb = JSON.parse(content);
    if (!memoryDb!.scripts) {
      memoryDb!.scripts = [];
    }
    if (!memoryDb!.deletedVideos) {
      memoryDb!.deletedVideos = [];
    }
    if (!memoryDb!.promptTemplates || memoryDb!.promptTemplates.length === 0) {
      memoryDb!.promptTemplates = [...DEFAULT_PROMPT_DEFINITIONS];
    }
    if (!memoryDb!.settings) {
      memoryDb!.settings = DEFAULT_DB.settings;
    }
    // Sanitize any stuck processing statuses and reset videos stuck on old subtitle/transcription errors
    if (memoryDb && memoryDb.videos) {
      let resetCount = 0;
      for (const v of memoryDb.videos) {
        // Clean up any stale errorStage on 'new' videos without transcripts
        if (v.status === 'new' && v.errorStage === 'transcription' && !v.transcript) {
          v.errorStage = undefined;
          v.error = undefined;
          v.rejectionCategory = undefined;
          v.filterReason = undefined;
        }

        // Reset videos stuck with old Level B errors back to 'new' for re-processing via Supadata/Gemini pipeline (max 3 retries)
        if (
          v.status === 'error' &&
          (v.retryCount || 0) < 3 &&
          (v.error?.includes('LOGIN_REQUIRED') ||
           v.error?.includes('Субтитры отсутствуют или заблокированы YouTube'))
        ) {
          v.status = 'new';
          v.error = undefined;
          v.errorStage = undefined;
          v.rejectionCategory = undefined;
          v.filterReason = undefined;
          v.lastPassedStatus = undefined;
          resetCount++;
        }

        if (v.status === 'transcribing' || v.status === 'processing_gemini' || v.status === 'transcribe_queued') {
          if (v.transcript && v.transcript.trim().length > 0) {
            v.status = 'transcribed';
          } else {
            v.status = 'completed';
            v.matchedFilter = false;
            v.rejectionCategory = 'transcription';
            v.filterReason = 'Нет текста — транскрипция не дала результата';
            v.lastPassedStatus = 'rejected';
          }
          v.queueTimestamp = undefined;
        } else if (v.status === 'transcribed' && (!v.transcript || v.transcript.trim().length === 0)) {
          v.status = 'completed';
          v.matchedFilter = false;
          v.rejectionCategory = 'transcription';
          v.filterReason = 'Нет текста — транскрипция не дала результата';
          v.lastPassedStatus = 'rejected';
          v.queueTimestamp = undefined;
        } else {
          // On server boot, clear stale queue timestamp if no worker was actively assigned
          v.queueTimestamp = undefined;
        }
      }
      if (resetCount > 0) {
        console.log(`[DB Migration] Reset ${resetCount} videos previously failed with transcription errors to 'new' status.`);
      }
    }
    return memoryDb!;
  } catch {
    memoryDb = JSON.parse(JSON.stringify(DEFAULT_DB));
    await saveDb();
    return memoryDb!;
  }
}

export async function saveDb(): Promise<void> {
  if (!memoryDb) return;
  writeQueue = writeQueue.then(async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tempFile = `${DB_FILE}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(memoryDb, null, 2), 'utf-8');
      await fs.rename(tempFile, DB_FILE);
    } catch (err) {
      console.error('Failed to save DB to disk:', err);
    }
  });
  return writeQueue;
}

export async function addLog(type: SyncLog['type'], message: string, extra?: { videoTitle?: string; videoId?: string }) {
  const db = await getDb();
  const log: SyncLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    type,
    message,
    ...extra,
  };
  db.logs.unshift(log);
  if (db.logs.length > 200) {
    db.logs = db.logs.slice(0, 200);
  }
  await saveDb();
  return log;
}

export async function addGeminiUsageLog(entry: Omit<GeminiUsageLog, 'id'>): Promise<GeminiUsageLog> {
  const db = await getDb();
  if (!db.geminiUsageLogs) {
    db.geminiUsageLogs = [];
  }
  const log: GeminiUsageLog = {
    id: `usage-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    ...entry,
  };
  db.geminiUsageLogs.push(log);
  // Keep last 10,000 logs
  if (db.geminiUsageLogs.length > 10000) {
    db.geminiUsageLogs = db.geminiUsageLogs.slice(-10000);
  }
  await saveDb();
  return log;
}

export async function getGeminiUsageStats24h(): Promise<GeminiUsageSummary> {
  const db = await getDb();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentLogs = (db.geminiUsageLogs || []).filter((l) => {
    const t = new Date(l.timestamp).getTime();
    return !isNaN(t) && t >= oneDayAgo;
  });

  const freeLogs = recentLogs.filter((l) => !l.isPaid);
  const paidLogs = recentLogs.filter((l) => l.isPaid);

  const freeRequestsCount = freeLogs.length;
  const freePromptTokens = freeLogs.reduce((acc, l) => acc + (l.promptTokens || 0), 0);
  const freeCandidatesTokens = freeLogs.reduce((acc, l) => acc + (l.candidatesTokens || 0), 0);
  const freeThoughtsTokens = freeLogs.reduce((acc, l) => acc + (l.thoughtsTokens || 0), 0);
  const freeTotalTokens = freeLogs.reduce((acc, l) => acc + (l.totalTokens || (l.promptTokens + l.candidatesTokens + (l.thoughtsTokens || 0))), 0);

  // Gemini Free Tier daily limit standard: 1,500 Requests Per Day (RPD)
  const DAILY_FREE_RPD_LIMIT = 1500;
  const freeRemainingRequests = Math.max(0, DAILY_FREE_RPD_LIMIT - freeRequestsCount);

  const paidRequestsCount = paidLogs.length;
  const paidPromptTokens = paidLogs.reduce((acc, l) => acc + (l.promptTokens || 0), 0);
  const paidCandidatesTokens = paidLogs.reduce((acc, l) => acc + (l.candidatesTokens || 0), 0);
  const paidThoughtsTokens = paidLogs.reduce((acc, l) => acc + (l.thoughtsTokens || 0), 0);
  const paidTotalTokens = paidLogs.reduce((acc, l) => acc + (l.totalTokens || (l.promptTokens + l.candidatesTokens + (l.thoughtsTokens || 0))), 0);
  const paidEstimatedCostUsd = Number(
    paidLogs.reduce((acc, l) => acc + (l.estimatedCostUsd || 0), 0).toFixed(6)
  );

  return {
    freeTier: {
      requestsCount: freeRequestsCount,
      promptTokens: freePromptTokens,
      candidatesTokens: freeCandidatesTokens,
      thoughtsTokens: freeThoughtsTokens,
      totalTokens: freeTotalTokens,
      dailyLimitRequests: DAILY_FREE_RPD_LIMIT,
      remainingRequests: freeRemainingRequests,
      limitType: 'RPD (1,500 зап./день)',
    },
    paidTier: {
      requestsCount: paidRequestsCount,
      promptTokens: paidPromptTokens,
      candidatesTokens: paidCandidatesTokens,
      thoughtsTokens: paidThoughtsTokens,
      totalTokens: paidTotalTokens,
      estimatedCostUsd: paidEstimatedCostUsd,
    },
  };
}

export async function addSupadataUsageLog(entry: Omit<SupadataUsageLog, 'id'>): Promise<SupadataUsageLog> {
  const db = await getDb();
  if (!db.supadataUsageLogs) {
    db.supadataUsageLogs = [];
  }
  const log: SupadataUsageLog = {
    id: `sd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    ...entry,
  };
  db.supadataUsageLogs.push(log);
  // Keep last 5,000 logs
  if (db.supadataUsageLogs.length > 5000) {
    db.supadataUsageLogs = db.supadataUsageLogs.slice(-5000);
  }
  await saveDb();
  return log;
}

export async function getSupadataUsageStats(): Promise<SupadataUsageSummary> {
  const db = await getDb();
  const now = new Date();
  // Supadata free tier monthly standard limit: 100 requests / month
  const SUPADATA_MONTHLY_LIMIT = 100;

  // Calculate start of current calendar month
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const oneDayAgo = now.getTime() - 24 * 60 * 60 * 1000;

  const logs = db.supadataUsageLogs || [];

  // Used this month (only requests that consume quota: success or limit_exceeded attempts)
  const monthLogs = logs.filter((l) => {
    const t = new Date(l.timestamp).getTime();
    return !isNaN(t) && t >= currentMonthStart && (l.status === 'success' || l.status === 'limit_exceeded');
  });

  const last24hLogs = logs.filter((l) => {
    const t = new Date(l.timestamp).getTime();
    return !isNaN(t) && t >= oneDayAgo && (l.status === 'success' || l.status === 'limit_exceeded');
  });

  // Check if latest recent log was limit_exceeded
  const latestLog = logs[logs.length - 1];
  const isLatestExceeded = latestLog ? latestLog.status === 'limit_exceeded' : false;

  const usedThisMonth = monthLogs.length;
  const remainingThisMonth = Math.max(0, SUPADATA_MONTHLY_LIMIT - usedThisMonth);
  const isLimitExceeded = isLatestExceeded || usedThisMonth >= SUPADATA_MONTHLY_LIMIT;

  return {
    usedThisMonth,
    monthlyLimit: SUPADATA_MONTHLY_LIMIT,
    remainingThisMonth: isLimitExceeded ? 0 : remainingThisMonth,
    isLimitExceeded,
    usedLast24h: last24hLogs.length,
  };
}

