import fs from 'fs/promises';
import path from 'path';
import { getFirestore } from 'firebase-admin/firestore';
import { PromptTemplateDef, DEFAULT_PROMPT_DEFINITIONS } from './gemini.js';
import { getFirebaseAdmin } from './auth.js';

export interface TrackedChannel {
  id: string; // YouTube Channel ID (e.g. UC...)
  ownerId?: string;
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
  ownerId?: string;
  title: string;
  channelId: string;
  channelTitle?: string;
  thumbnail?: string;
  publishedAt?: string;
  deletedAt: string;
  permanentlyIgnored?: boolean;
}

export interface PromptRunRecord {
  id: string;
  ownerId?: string;
  stage: 'stage1' | 'stage2' | 1 | 2;
  promptId?: string;
  promptName: string;
  promptTemplate?: string;
  customPrompt?: string;
  timestamp: string;
  status: 'approved' | 'rejected' | 'has_script' | 'error' | 'completed';
  result?: string;
  matchedFilter?: boolean;
  filterReason?: string;
  rejectionReason?: string;
  ideas?: any[];
  scripts?: any[];
  scriptCount?: number;
  error?: string;
  isCurrent: boolean;
}

export interface StoredVideo {
  id: string;
  ownerId?: string;
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
  transcriptSource?: 'subtitles' | 'gemini_multimodal' | 'supadata' | 'chocodata';
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
  promptRuns?: PromptRunRecord[];
  isReviewed?: boolean;
  reviewedAt?: string;
  isArchived?: boolean;
  queueTimestamp?: string;
  processedAt?: string;
  error?: string;
  retryCount?: number;
  lastErrorAt?: string;
  forcePaidModel?: boolean;
  radarScannedAt?: string;
  updatedAt: string;
}

export interface SyncLog {
  id: string;
  ownerId?: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
  videoTitle?: string;
  videoId?: string;
}

export interface AppSettings {
  ownerId?: string;
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
  chocodataApiKey?: string;
  llmProvider?: 'gemini' | 'groq' | 'openrouter';
  llmModel?: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
  telegramAutoSend?: boolean;
  telegramChatId?: string;
  skipTelegramIfFilteredOut?: boolean;
  lastSyncRun: string | null;
  nextSyncRun: string | null;
}

export interface GeneratedScript {
  id: string;
  ownerId?: string;
  radarOpportunityId?: string;
  parentScriptId?: string;
  version?: number;
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
  isReviewed?: boolean;
  telegramSent?: boolean;
  telegramSentAt?: string;
  telegramMessageIds?: number[];
  exportedAt?: string;
  exportMethod?: 'copy' | 'download' | 'telegram' | 'google_docs';
  isPublished?: boolean;
  publishedAt?: string;
  archivedAt?: string;
  editedManually?: boolean;
}

export interface GeminiUsageLog {
  id: string;
  ownerId?: string;
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

export interface TranscriptUsageLog {
  id: string;
  ownerId?: string;
  timestamp: string;
  videoId?: string;
  provider: string;
  keySource: 'platform' | 'byok' | 'none';
  operation: 'transcript';
  units?: number;
  unitType?: 'request' | 'credit' | 'minute';
  status: 'success' | 'quota_exceeded' | 'not_found' | 'error' | 'skipped';
  message?: string;
}

export interface TranscriptUsageSummary {
  totalAttempts: number;
  successes: number;
  cacheHits: number;
  byProvider: Record<string, { attempts: number; successes: number; errors: number; skipped: number }>;
  byKeySource: Record<'platform' | 'byok' | 'none', number>;
}

export interface SupadataUsageLog {
  id: string;
  ownerId?: string;
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

export interface ChocodataUsageLog {
  id: string;
  ownerId?: string;
  timestamp: string;
  videoId?: string;
  status: 'success' | 'limit_exceeded' | 'error' | 'not_found';
  message?: string;
}

export interface ChocodataUsageSummary {
  usedTotal: number;
  totalLimit: number; // 200 transcriptions (from 1000 credits package, 5 credits/request)
  remainingTotal: number;
  isLimitExceeded: boolean;
  usedLast24h: number;
  quotaPolicy: 'never';
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

export const LEGACY_OWNER_ID = 'legacy-account-1';
export const PRIMARY_OWNER_EMAIL = 'askerzade135@gmail.com';

/**
 * Resolves the effective ownerId in the database:
 * Priority order:
 * 1. Exact match by User ID (Firebase UID or registered internal ID)
 * 2. If legacy ID requested ('legacy-account-1'), maps to primary owner
 * 3. Fallback: Lookup by user email (links new Firebase UID session to existing migrated legacy data on first login)
 * 4. Fallback: If no match and no ID provided, defaults to primary owner
 */
export function resolveOwnerId(db: AppDatabase, requestedUidOrEmail?: string, emailFallback?: string): string {
  if (!requestedUidOrEmail || !requestedUidOrEmail.trim()) {
    return LEGACY_OWNER_ID;
  }
  const cleanId = requestedUidOrEmail.trim();

  // If requested ID is legacy marker, return legacy account
  if (cleanId === LEGACY_OWNER_ID) {
    return LEGACY_OWNER_ID;
  }

  // Priority 1: Exact match by User ID (Firebase UID)
  const userById = db.users?.find((u) => u.id === cleanId);
  if (userById) {
    if ((userById.email || '').toLowerCase() === PRIMARY_OWNER_EMAIL.toLowerCase()) {
      return LEGACY_OWNER_ID;
    }
    return userById.id;
  }

  // Priority 2: Lookup by email (or emailFallback)
  const targetEmail = (emailFallback || (cleanId.includes('@') ? cleanId : '')).trim().toLowerCase();
  if (targetEmail) {
    if (targetEmail === PRIMARY_OWNER_EMAIL.toLowerCase()) {
      return LEGACY_OWNER_ID;
    }
    const userByEmail = db.users?.find((u) => (u.email || '').toLowerCase() === targetEmail);
    if (userByEmail) {
      return userByEmail.id;
    }
  }

  // If the authenticated user's email matches primary owner email, map to legacy account
  if (cleanId.toLowerCase() === PRIMARY_OWNER_EMAIL.toLowerCase()) {
    return LEGACY_OWNER_ID;
  }

  return cleanId;
}

export function getDefaultOwnerId(ownerId?: string): string {
  if (!ownerId || !ownerId.trim() || ownerId === PRIMARY_OWNER_EMAIL || ownerId.includes('@')) {
    return LEGACY_OWNER_ID;
  }
  return ownerId.trim();
}

export function getDefaultSettings(ownerId?: string): AppSettings {
  return {
    ...DEFAULT_DB.settings,
    ownerId: getDefaultOwnerId(ownerId),
  };
}

export function getSettingsForOwner(db: AppDatabase, ownerId?: string): AppSettings {
  const targetOwnerId = getDefaultOwnerId(ownerId);
  if (db.userSettings && db.userSettings[targetOwnerId]) {
    return db.userSettings[targetOwnerId];
  }
  if (db.settings) {
    if (!db.settings.ownerId || db.settings.ownerId === targetOwnerId) {
      return db.settings;
    }
  }
  return getDefaultSettings(targetOwnerId);
}

export function saveSettingsForOwner(db: AppDatabase, settings: AppSettings, ownerId?: string): AppSettings {
  const targetOwnerId = getDefaultOwnerId(ownerId || settings.ownerId);
  if (!db.userSettings) {
    db.userSettings = {};
  }
  const updatedSettings = {
    ...settings,
    ownerId: targetOwnerId,
  };
  db.userSettings[targetOwnerId] = updatedSettings;
  if (targetOwnerId === LEGACY_OWNER_ID || !db.settings?.ownerId || db.settings.ownerId === targetOwnerId) {
    db.settings = updatedSettings;
  }
  return updatedSettings;
}

export function getPromptTemplatesForOwner(db: AppDatabase, ownerId?: string): PromptTemplateDef[] {
  const targetOwnerId = getDefaultOwnerId(ownerId);
  const allTemplates = db.promptTemplates || DEFAULT_PROMPT_DEFINITIONS;
  // Return global templates (no ownerId) plus user's custom or overridden templates (ownerId === targetOwnerId)
  return allTemplates.filter((t) => !t.ownerId || t.ownerId === targetOwnerId || t.ownerId === LEGACY_OWNER_ID);
}

export function getChannelsForOwner(db: AppDatabase, ownerId?: string): TrackedChannel[] {
  const targetOwnerId = getDefaultOwnerId(ownerId);
  return (db.channels || []).filter((c) => c.ownerId === targetOwnerId || (!c.ownerId && targetOwnerId === LEGACY_OWNER_ID));
}

export function getVideosForOwner(db: AppDatabase, ownerId?: string): StoredVideo[] {
  const targetOwnerId = getDefaultOwnerId(ownerId);
  return (db.videos || []).filter((v) => v.ownerId === targetOwnerId || (!v.ownerId && targetOwnerId === LEGACY_OWNER_ID));
}

export function getScriptsForOwner(db: AppDatabase, ownerId?: string): GeneratedScript[] {
  const targetOwnerId = getDefaultOwnerId(ownerId);
  return (db.scripts || []).filter((s) => s.ownerId === targetOwnerId || (!s.ownerId && targetOwnerId === LEGACY_OWNER_ID));
}

export function getDeletedVideosForOwner(db: AppDatabase, ownerId?: string): DeletedVideoInfo[] {
  const targetOwnerId = getDefaultOwnerId(ownerId);
  return (db.deletedVideos || []).filter((d) => d.ownerId === targetOwnerId || (!d.ownerId && targetOwnerId === LEGACY_OWNER_ID));
}

export function getLogsForOwner(db: AppDatabase, ownerId?: string): SyncLog[] {
  const targetOwnerId = getDefaultOwnerId(ownerId);
  return (db.logs || []).filter((l) => l.ownerId === targetOwnerId || (!l.ownerId && targetOwnerId === LEGACY_OWNER_ID));
}

export interface UserAccount {
  id: string; // Firebase uid or internal ownerId
  email: string;
  name?: string;
  avatarUrl?: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
  lastLoginAt?: string;
  legacyOwnerIdMapped?: string;
}

export interface AppDatabase {
  users?: UserAccount[];
  channels: TrackedChannel[];
  videos: StoredVideo[];
  deletedVideos?: DeletedVideoInfo[];
  settings: AppSettings;
  userSettings?: Record<string, AppSettings>;
  scripts: GeneratedScript[];
  promptTemplates: PromptTemplateDef[];
  logs: SyncLog[];
  geminiUsageLogs?: GeminiUsageLog[];
  supadataUsageLogs?: SupadataUsageLog[];
  chocodataUsageLogs?: ChocodataUsageLog[];
  transcriptUsageLogs?: TranscriptUsageLog[];
  transcriptCache?: TranscriptCacheEntry[];
  userQuotas?: Record<string, UserQuota>;
  radarProfiles?: Record<string, RadarProfile>;
  radarOpportunities?: RadarOpportunity[];
  radarScanRuns?: RadarScanRun[];
  radarDiscoveryFeedback?: RadarDiscoveryFeedback[];
  radarDiscoveryCandidates?: RadarDiscoveryCandidateRecord[];
  radarReferences?: RadarReferenceSignal[];
  radarYouTubeSubscriptions?: RadarYouTubeSubscription[];
  radarScriptFeedback?: RadarScriptFeedback[];
}

export interface RadarScriptFeedback {
  id: string;
  ownerId: string;
  scriptId: string;
  opportunityId: string;
  decision: 'approved' | 'rewrite' | 'rejected';
  reason?: 'too_generic' | 'wrong_tone' | 'too_long' | 'weak_hook' | 'wrong_angle';
  createdAt: string;
}

export interface RadarYouTubeSubscription {
  ownerId: string;
  channelId: string;
  title: string;
  description?: string;
  thumbnail?: string;
  importedAt: string;
  enabled: boolean;
}

export interface RadarReferenceSignal {
  id: string;
  ownerId: string;
  kind: 'youtube_video' | 'youtube_channel' | 'social_url' | 'text';
  value: string;
  intent: 'interesting' | 'more_like_this' | 'style' | 'topic';
  platform?: string;
  title?: string;
  summary?: string;
  topics?: string[];
  angles?: string[];
  sourceContentId?: string;
  channelId?: string;
  createdAt: string;
}

export interface RadarDiscoveryCandidateRecord {
  id: string;
  ownerId: string;
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  url: string;
  thumbnail?: string;
  publishedAt?: string;
  description?: string;
  query?: string;
  rankingScore?: number;
  rankingReason?: string;
  rankedAt?: string;
  createdAt: string;
}

export interface RadarDiscoveryFeedback {
  id: string;
  ownerId: string;
  sourceContentId: string;
  decision: 'interesting' | 'skip';
  reason?: 'too_generic' | 'not_my_topic' | 'wrong_style' | 'too_shallow' | 'seen_before';
  createdAt: string;
}

export interface RadarProfile {
  ownerId: string;
  description: string;
  topics?: string[];
  preferredAngles?: string[];
  avoid?: string[];
  customInstructions?: string;
  onboardingCompletedAt?: string;
  updatedAt: string;
}

export interface RadarOpportunity {
  id: string;
  ownerId: string;
  sourceType: 'youtube';
  sourceContentId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceChannel?: string;
  sourceThumbnail?: string;
  title: string;
  topic?: string;
  hook: string;
  coreIdea: string;
  whyInteresting: string;
  angle: string;
  evidence?: string[];
  relevance: number;
  status: 'new' | 'saved' | 'dismissed' | 'scripted';
  createdAt: string;
  updatedAt: string;
}

export interface RadarScanRun {
  id: string;
  ownerId: string;
  startedAt: string;
  completedAt?: string;
  scanned: number;
  opportunitiesCreated: number;
  errors: number;
  status: 'running' | 'completed' | 'failed';
}

export interface TranscriptCacheEntry {
  videoId: string;
  source: 'youtube';
  text: string;
  segments?: StoredVideo['transcriptSegments'];
  language?: string;
  provider: StoredVideo['transcriptSource'];
  createdAt: string;
}

export interface UserQuota {
  periodStart: string;
  transcripts: number;
  transcriptMinutes: number;
  radarAnalyses: number;
  scriptGenerations: number;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

const FIRESTORE_STATE_COLLECTION = '_ai_content_funnel_state';
const FIRESTORE_STATE_DOC = 'current';
const FIRESTORE_CHUNKS_COLLECTION = 'chunks';
// Keep comfortably below Firestore's 1 MiB per-document limit.
const FIRESTORE_CHUNK_SIZE = 200_000;

function getFirestoreDb() {
  const app = getFirebaseAdmin();
  const databaseId = getFirestoreDatabaseId();
  return databaseId === '(default)'
    ? getFirestore(app)
    : getFirestore(app, databaseId);
}

async function readFirestoreSnapshot(): Promise<AppDatabase | null> {
  const firestore = getFirestoreDb();
  const metaRef = firestore.collection(FIRESTORE_STATE_COLLECTION).doc(FIRESTORE_STATE_DOC);
  const metaSnap = await metaRef.get();
  if (!metaSnap.exists) return null;

  const meta = metaSnap.data() || {};
  const chunkCount = Number(meta.chunkCount || 0);
  if (!chunkCount) return null;

  const chunkSnaps = await metaRef.collection(FIRESTORE_CHUNKS_COLLECTION).orderBy('index', 'asc').get();
  if (chunkSnaps.empty) return null;

  const payload = chunkSnaps.docs.map((doc) => String(doc.data()?.payload || '')).join('');
  if (!payload) return null;

  const parsed = JSON.parse(payload) as AppDatabase;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.videos) || !Array.isArray(parsed.channels)) {
    throw new Error('Invalid Firestore app snapshot');
  }
  return parsed;
}

async function writeFirestoreSnapshot(db: AppDatabase): Promise<void> {
  const firestore = getFirestoreDb();
  const metaRef = firestore.collection(FIRESTORE_STATE_COLLECTION).doc(FIRESTORE_STATE_DOC);
  const payload = JSON.stringify(db);
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += FIRESTORE_CHUNK_SIZE) {
    chunks.push(payload.slice(i, i + FIRESTORE_CHUNK_SIZE));
  }

  const previousMeta = await metaRef.get();
  const previousCount = Number(previousMeta.data()?.chunkCount || 0);

  const writer = firestore.bulkWriter();
  chunks.forEach((chunk, index) => {
    const id = String(index).padStart(6, '0');
    writer.set(metaRef.collection(FIRESTORE_CHUNKS_COLLECTION).doc(id), {
      index,
      payload: chunk,
      updatedAt: new Date().toISOString(),
    });
  });
  for (let index = chunks.length; index < previousCount; index++) {
    const id = String(index).padStart(6, '0');
    writer.delete(metaRef.collection(FIRESTORE_CHUNKS_COLLECTION).doc(id));
  }
  writer.set(metaRef, {
    format: 'app-database-json-chunks-v1',
    chunkCount: chunks.length,
    byteLength: Buffer.byteLength(payload, 'utf8'),
    updatedAt: new Date().toISOString(),
  });
  await writer.close();
}

async function writeLocalSnapshot(db: AppDatabase): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${DB_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(db, null, 2), 'utf-8');
  await fs.rename(tempFile, DB_FILE);
}

export function getStorageMode(): 'local-json' | 'firestore' | 'dual' {
  const mode = (process.env.APP_STORAGE || 'local-json').toLowerCase();
  if (mode === 'firestore') return 'firestore';
  if (mode === 'dual') return 'dual';
  return 'local-json';
}

export function getFirestoreDatabaseId(): string {
  return process.env.FIRESTORE_DATABASE_ID || '(default)';
}

export async function getFirestoreSnapshotStatus(): Promise<{
  databaseId: string;
  exists: boolean;
  readable: boolean;
  chunkCount: number;
  byteLength: number;
  updatedAt?: string;
  error?: string;
}> {
  const databaseId = getFirestoreDatabaseId();
  try {
    const firestore = getFirestoreDb();
    const metaRef = firestore.collection(FIRESTORE_STATE_COLLECTION).doc(FIRESTORE_STATE_DOC);
    const metaSnap = await metaRef.get();
    if (!metaSnap.exists) {
      return { databaseId, exists: false, readable: false, chunkCount: 0, byteLength: 0 };
    }

    const meta = metaSnap.data() || {};
    const chunkCount = Number(meta.chunkCount || 0);
    const byteLength = Number(meta.byteLength || 0);
    const updatedAt = typeof meta.updatedAt === 'string' ? meta.updatedAt : undefined;
    const snapshot = await readFirestoreSnapshot();

    return {
      databaseId,
      exists: true,
      readable: Boolean(snapshot),
      chunkCount,
      byteLength,
      updatedAt,
    };
  } catch (err: any) {
    return {
      databaseId,
      exists: false,
      readable: false,
      chunkCount: 0,
      byteLength: 0,
      error: err?.message || String(err),
    };
  }
}

export async function migrateCurrentDbToFirestore(): Promise<{ chunkCount: number; byteLength: number; databaseId: string; verified: boolean }> {
  const db = await getDb();
  const payload = JSON.stringify(db);
  await writeFirestoreSnapshot(db);

  const verifiedDb = await readFirestoreSnapshot();
  if (!verifiedDb || JSON.stringify(verifiedDb) !== payload) {
    throw new Error('Firestore migration verification failed: read-back snapshot does not match source data');
  }

  return {
    chunkCount: Math.max(1, Math.ceil(payload.length / FIRESTORE_CHUNK_SIZE)),
    byteLength: Buffer.byteLength(payload, 'utf8'),
    databaseId: getFirestoreDatabaseId(),
    verified: true,
  };
}


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
    // User BYOK keys are separate from infrastructure keys in process.env.
    supadataApiKey: '',
    chocodataApiKey: '',
    llmProvider: 'gemini',
    llmModel: '',
    geminiApiKey: '',
    groqApiKey: '',
    openrouterApiKey: '',
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

  const storageMode = getStorageMode();
  let firestoreReadFailed = false;

  if (storageMode === 'firestore' || storageMode === 'dual') {
    try {
      const remote = await readFirestoreSnapshot();
      if (remote) {
        memoryDb = remote;
      } else if (storageMode === 'firestore') {
        throw new Error(`Firestore snapshot not found in database '${getFirestoreDatabaseId()}'`);
      }
    } catch (err) {
      console.error('[Storage] Failed to read Firestore snapshot:', err);
      firestoreReadFailed = true;
      if (storageMode === 'firestore') throw err;
    }
  }

  try {
    if (!memoryDb) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const content = await fs.readFile(DB_FILE, 'utf-8');
      memoryDb = JSON.parse(content);
    }
    if (!memoryDb!.scripts) {
      memoryDb!.scripts = [];
    }
    if (!memoryDb!.deletedVideos) {
      memoryDb!.deletedVideos = [];
    }
    if (!memoryDb!.transcriptCache) memoryDb!.transcriptCache = [];
    if (!memoryDb!.transcriptUsageLogs) memoryDb!.transcriptUsageLogs = [];
    if (!memoryDb!.userQuotas) memoryDb!.userQuotas = {};
    if (!memoryDb!.radarProfiles) memoryDb!.radarProfiles = {};
    if (!memoryDb!.radarOpportunities) memoryDb!.radarOpportunities = [];
    if (!memoryDb!.radarScanRuns) memoryDb!.radarScanRuns = [];
    if (!memoryDb!.radarDiscoveryFeedback) memoryDb!.radarDiscoveryFeedback = [];
    if (!memoryDb!.radarDiscoveryCandidates) memoryDb!.radarDiscoveryCandidates = [];
    if (!memoryDb!.radarReferences) memoryDb!.radarReferences = [];
    if (!memoryDb!.radarYouTubeSubscriptions) memoryDb!.radarYouTubeSubscriptions = [];
    if (!memoryDb!.radarScriptFeedback) memoryDb!.radarScriptFeedback = [];
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

        // Migration: Ensure promptRuns history exists on every video
        if (!v.promptRuns) {
          v.promptRuns = [];
          if (v.geminiResult || v.matchedFilter !== undefined) {
            const templateKey = v.geminiPromptTemplate || 'filter_screener';
            const promptDef = (memoryDb.promptTemplates || []).find((t) => t.id === templateKey);
            const promptName = promptDef
              ? promptDef.name
              : templateKey === 'filter_screener'
              ? '🔍 Промпт 1: Фильтр тем и Банк идей'
              : templateKey === 'scriptwriter_deep'
              ? '🎬 Промпт 2: Покадровый сценарист Reels/Shorts'
              : templateKey === 'two_stage_pipeline'
              ? '⚡ 2-этапный конвейер: Фильтр → Покадровый сценарий'
              : templateKey;

            const isStage2 =
              templateKey === 'scriptwriter_deep' ||
              templateKey === 'reels_scenario' ||
              v.lastPassedStatus === 'has_script' ||
              Boolean(v.scriptCount && v.scriptCount > 0);

            const runStatus: 'approved' | 'rejected' | 'has_script' | 'error' | 'completed' =
              v.status === 'error'
                ? 'error'
                : v.matchedFilter === false
                ? 'rejected'
                : v.lastPassedStatus === 'has_script' || (v.scriptCount && v.scriptCount > 0)
                ? 'has_script'
                : v.matchedFilter === true
                ? 'approved'
                : 'completed';

            v.promptRuns.push({
              id: `run-${v.id}-initial`,
              stage: isStage2 ? 'stage2' : 'stage1',
              promptId: templateKey,
              promptName,
              promptTemplate: templateKey,
              customPrompt: v.customPromptUsed,
              timestamp: v.processedAt || v.updatedAt || new Date().toISOString(),
              status: runStatus,
              result: v.geminiResult,
              matchedFilter: v.matchedFilter,
              filterReason: v.filterReason,
              scriptCount: v.scriptCount,
              error: v.error,
              isCurrent: true,
            });
          }
        } else if (v.promptRuns.length > 0 && !v.promptRuns.some((r) => r.isCurrent)) {
          v.promptRuns[0].isCurrent = true;
        }
      }
      if (resetCount > 0) {
        console.log(`[DB Migration] Reset ${resetCount} videos previously failed with transcription errors to 'new' status.`);
      }
    }

    // Migration Stage 0: Stamp all existing legacy entities with LEGACY_OWNER_ID if ownerId is missing
    let ownerIdMigrationApplied = false;

    if (memoryDb.channels) {
      for (const ch of memoryDb.channels) {
        if (!ch.ownerId) {
          ch.ownerId = LEGACY_OWNER_ID;
          ownerIdMigrationApplied = true;
        }
      }
    }

    if (memoryDb.videos) {
      for (const v of memoryDb.videos) {
        if (!v.ownerId) {
          v.ownerId = LEGACY_OWNER_ID;
          ownerIdMigrationApplied = true;
        }
      }
    }

    if (memoryDb.scripts) {
      for (const s of memoryDb.scripts) {
        if (!s.ownerId) {
          s.ownerId = LEGACY_OWNER_ID;
          ownerIdMigrationApplied = true;
        }
      }
    }

    if (memoryDb.deletedVideos) {
      for (const dv of memoryDb.deletedVideos) {
        if (!dv.ownerId) {
          dv.ownerId = LEGACY_OWNER_ID;
          ownerIdMigrationApplied = true;
        }
      }
    }

    if (memoryDb.logs) {
      for (const l of memoryDb.logs) {
        if (!l.ownerId) {
          l.ownerId = LEGACY_OWNER_ID;
          ownerIdMigrationApplied = true;
        }
      }
    }

    if (memoryDb.geminiUsageLogs) {
      for (const gl of memoryDb.geminiUsageLogs) {
        if (!gl.ownerId) {
          gl.ownerId = LEGACY_OWNER_ID;
          ownerIdMigrationApplied = true;
        }
      }
    }

    if (memoryDb.supadataUsageLogs) {
      for (const sl of memoryDb.supadataUsageLogs) {
        if (!sl.ownerId) {
          sl.ownerId = LEGACY_OWNER_ID;
          ownerIdMigrationApplied = true;
        }
      }
    }

    if (memoryDb.chocodataUsageLogs) {
      for (const cl of memoryDb.chocodataUsageLogs) {
        if (!cl.ownerId) {
          cl.ownerId = LEGACY_OWNER_ID;
          ownerIdMigrationApplied = true;
        }
      }
    }

    if (memoryDb.settings) {
      if (!memoryDb.settings.ownerId) {
        memoryDb.settings.ownerId = LEGACY_OWNER_ID;
        ownerIdMigrationApplied = true;
      }
      if (!memoryDb.userSettings) {
        memoryDb.userSettings = {};
      }
      if (!memoryDb.userSettings[LEGACY_OWNER_ID]) {
        memoryDb.userSettings[LEGACY_OWNER_ID] = { ...memoryDb.settings };
      }
    }

    if (ownerIdMigrationApplied) {
      await saveDb();
      console.log(`[DB Migration] Applied ownerId='${LEGACY_OWNER_ID}' to legacy entities in store.json`);
    }

    return memoryDb!;
  } catch (err) {
    console.error('[Storage] Failed to load or migrate database:', err);

    if (memoryDb) {
      throw err;
    }

    if (storageMode === 'firestore' || (storageMode === 'dual' && firestoreReadFailed)) {
      throw err;
    }

    memoryDb = JSON.parse(JSON.stringify(DEFAULT_DB));
    await saveDb();
    return memoryDb!;
  }
}

/**
 * Sync top-level fields of StoredVideo with its current active PromptRunRecord
 */
export function syncVideoWithCurrentRun(video: StoredVideo): void {
  if (!video.promptRuns || video.promptRuns.length === 0) return;
  const currentRun = video.promptRuns.find((r) => r.isCurrent) || video.promptRuns[0];
  if (!currentRun) return;

  // Ensure only this record has isCurrent = true
  for (const r of video.promptRuns) {
    r.isCurrent = r.id === currentRun.id;
  }

  video.geminiResult = currentRun.result || video.geminiResult;
  video.geminiPromptTemplate = currentRun.promptTemplate || currentRun.promptId || video.geminiPromptTemplate;
  video.customPromptUsed = currentRun.customPrompt;
  video.matchedFilter = currentRun.matchedFilter;
  video.filterReason = currentRun.filterReason;
  if (currentRun.scriptCount !== undefined) {
    video.scriptCount = currentRun.scriptCount;
  }

  if (currentRun.status === 'error') {
    video.status = 'error';
    video.error = currentRun.error || 'Ошибка генерации';
  } else {
    video.status = 'completed';
    video.error = undefined;
    video.errorStage = undefined;
    if (currentRun.status === 'has_script') {
      video.lastPassedStatus = 'has_script';
    } else if (currentRun.status === 'approved') {
      video.lastPassedStatus = 'approved';
    } else if (currentRun.status === 'rejected') {
      video.lastPassedStatus = 'rejected';
    }
  }
}

export async function saveDb(): Promise<void> {
  if (!memoryDb) return;
  writeQueue = writeQueue.then(async () => {
    try {
      const mode = getStorageMode();
      if (mode === 'local-json' || mode === 'dual') {
        await writeLocalSnapshot(memoryDb!);
      }
      if (mode === 'firestore' || mode === 'dual') {
        await writeFirestoreSnapshot(memoryDb!);
      }
    } catch (err) {
      console.error('Failed to save DB:', err);
      throw err;
    }
  });
  return writeQueue;
}

export async function addLog(type: SyncLog['type'], message: string, extra?: { videoTitle?: string; videoId?: string; ownerId?: string }) {
  const db = await getDb();
  const log: SyncLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    ownerId: extra?.ownerId || getDefaultOwnerId(),
    timestamp: new Date().toISOString(),
    type,
    message,
    ...extra,
  };
  db.logs.unshift(log);
  if (db.logs.length > 2000) {
    db.logs = db.logs.slice(0, 2000);
  }
  await saveDb();
  return log;
}

export async function addGeminiUsageLog(entry: Omit<GeminiUsageLog, 'id'>, ownerId?: string): Promise<GeminiUsageLog> {
  const db = await getDb();
  if (!db.geminiUsageLogs) {
    db.geminiUsageLogs = [];
  }
  const log: GeminiUsageLog = {
    id: `usage-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    ownerId: ownerId || entry.ownerId || getDefaultOwnerId(),
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

export async function getGeminiUsageStats24h(ownerId?: string): Promise<GeminiUsageSummary> {
  const db = await getDb();
  const targetOwnerId = ownerId ? getDefaultOwnerId(ownerId) : null;
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentLogs = (db.geminiUsageLogs || []).filter((l) => {
    const t = new Date(l.timestamp).getTime();
    const isOwnerMatch = !targetOwnerId || l.ownerId === targetOwnerId || (!l.ownerId && targetOwnerId === LEGACY_OWNER_ID);
    return !isNaN(t) && t >= oneDayAgo && isOwnerMatch;
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

export async function addSupadataUsageLog(entry: Omit<SupadataUsageLog, 'id'>, ownerId?: string): Promise<SupadataUsageLog> {
  const db = await getDb();
  if (!db.supadataUsageLogs) {
    db.supadataUsageLogs = [];
  }
  const log: SupadataUsageLog = {
    id: `sd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    ownerId: ownerId || entry.ownerId || getDefaultOwnerId(),
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

export async function getSupadataUsageStats(ownerId?: string): Promise<SupadataUsageSummary> {
  const db = await getDb();
  const targetOwnerId = ownerId ? getDefaultOwnerId(ownerId) : null;
  const now = new Date();
  // Supadata free tier monthly standard limit: 100 requests / month
  const SUPADATA_MONTHLY_LIMIT = 100;

  // Calculate start of current calendar month
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const oneDayAgo = now.getTime() - 24 * 60 * 60 * 1000;

  const logs = (db.supadataUsageLogs || []).filter((l) => {
    return !targetOwnerId || l.ownerId === targetOwnerId || (!l.ownerId && targetOwnerId === LEGACY_OWNER_ID);
  });

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

export async function addChocodataUsageLog(entry: Omit<ChocodataUsageLog, 'id'>, ownerId?: string): Promise<ChocodataUsageLog> {
  const db = await getDb();
  if (!db.chocodataUsageLogs) {
    db.chocodataUsageLogs = [];
  }
  const log: ChocodataUsageLog = {
    id: `cd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    ownerId: ownerId || entry.ownerId || getDefaultOwnerId(),
    ...entry,
  };
  db.chocodataUsageLogs.push(log);
  // Keep last 5,000 logs
  if (db.chocodataUsageLogs.length > 5000) {
    db.chocodataUsageLogs = db.chocodataUsageLogs.slice(-5000);
  }
  await saveDb();
  return log;
}

/**
 * Returns ChocoData usage statistics:
 * ChocoData provides a one-time pack of 1000 credits (YouTube Transcript API costs 5 credits/request = ~200 transcriptions).
 * Quota reset policy: 'never' (lifetime pack, does not reset per month).
 */
export async function getChocodataUsageStats(ownerId?: string): Promise<ChocodataUsageSummary> {
  const db = await getDb();
  const targetOwnerId = ownerId ? getDefaultOwnerId(ownerId) : null;
  const now = new Date();
  const CHOCODATA_TOTAL_LIMIT = 1000; // provider credits are infrastructure metrics, not product quotas

  const oneDayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const logs = (db.chocodataUsageLogs || []).filter((l) => {
    return !targetOwnerId || l.ownerId === targetOwnerId || (!l.ownerId && targetOwnerId === LEGACY_OWNER_ID);
  });

  // Used total across entire lifetime of the key (only requests consuming credits)
  const consumedLogs = logs.filter((l) => l.status === 'success' || l.status === 'limit_exceeded');
  const usedTotal = consumedLogs.length;

  const last24hLogs = logs.filter((l) => {
    const t = new Date(l.timestamp).getTime();
    return !isNaN(t) && t >= oneDayAgo && (l.status === 'success' || l.status === 'limit_exceeded');
  });

  const latestLog = logs[logs.length - 1];
  const isLatestExceeded = latestLog ? latestLog.status === 'limit_exceeded' : false;

  const remainingTotal = Math.max(0, CHOCODATA_TOTAL_LIMIT - usedTotal);
  const isLimitExceeded = isLatestExceeded || usedTotal >= CHOCODATA_TOTAL_LIMIT;

  return {
    usedTotal,
    totalLimit: CHOCODATA_TOTAL_LIMIT,
    remainingTotal: isLimitExceeded ? 0 : remainingTotal,
    isLimitExceeded,
    usedLast24h: last24hLogs.length,
    quotaPolicy: 'never',
  };
}




export async function addTranscriptUsageLog(entry: Omit<TranscriptUsageLog, 'id'>): Promise<TranscriptUsageLog> {
  const db = await getDb();
  if (!db.transcriptUsageLogs) db.transcriptUsageLogs = [];
  const log: TranscriptUsageLog = {
    id: `tu-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    ...entry,
    ownerId: getDefaultOwnerId(entry.ownerId),
  };
  db.transcriptUsageLogs.push(log);
  if (db.transcriptUsageLogs.length > 10000) db.transcriptUsageLogs = db.transcriptUsageLogs.slice(-10000);
  await saveDb();
  return log;
}

export async function getTranscriptUsageStats(ownerId?: string): Promise<TranscriptUsageSummary> {
  const db = await getDb();
  const targetOwnerId = getDefaultOwnerId(ownerId);
  const logs = (db.transcriptUsageLogs || []).filter(
    (l) => l.ownerId === targetOwnerId || (!l.ownerId && targetOwnerId === LEGACY_OWNER_ID)
  );
  const byProvider: TranscriptUsageSummary['byProvider'] = {};
  const byKeySource: TranscriptUsageSummary['byKeySource'] = { platform: 0, byok: 0, none: 0 };
  for (const log of logs) {
    const bucket = byProvider[log.provider] || { attempts: 0, successes: 0, errors: 0, skipped: 0 };
    bucket.attempts++;
    if (log.status === 'success') bucket.successes++;
    else if (log.status === 'skipped') bucket.skipped++;
    else if (log.status === 'error' || log.status === 'quota_exceeded') bucket.errors++;
    byProvider[log.provider] = bucket;
    byKeySource[log.keySource]++;
  }
  return {
    totalAttempts: logs.length,
    successes: logs.filter((l) => l.status === 'success').length,
    cacheHits: logs.filter((l) => l.provider === 'cache' && l.status === 'success').length,
    byProvider,
    byKeySource,
  };
}
