export interface TrackedChannel {
  id: string;
  title: string;
  handle?: string;
  avatarUrl?: string;
  url: string;
  autoSync: boolean;
  lastCheckedAt?: string;
  createdAt?: string;
  videoCount?: number;
}

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
  formattedTime: string;
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

export type VideoStatus = 'new' | 'transcribe_queued' | 'transcribing' | 'transcribed' | 'processing_gemini' | 'completed' | 'error' | 'quota_exceeded' | 'requires_payment';

export interface StoredVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  url: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  status: VideoStatus;
  pendingPaidAction?: 'transcription' | 'stage1' | 'filter' | 'stage2' | 'script' | 'pipeline' | string;
  paidActionReason?: string;
  lastPassedStatus?: 'new' | 'transcribed' | 'approved' | 'rejected' | 'has_script';
  errorStage?: 'transcription' | 'filter' | 'script' | string;
  transcript?: string;
  transcriptSource?: 'subtitles' | 'gemini_multimodal' | 'supadata';
  transcriptSegments?: TranscriptSegment[];
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
  updatedAt: string;
  durationSeconds?: number;
  forcePaidModel?: boolean;
}

export interface AppSettings {
  dailySyncEnabled: boolean;
  intervalHours: number;
  autoProcessNewVideos: boolean;
  autoProcessMode?: 'filter_screener' | 'transcription_only' | 'two_stage_pipeline';
  defaultPromptTemplate: string;
  defaultFilterPromptTemplate?: string;
  defaultScriptwriterPromptTemplate?: string;
  defaultSummaryPromptTemplate?: string;
  defaultKnowledgeBasePromptTemplate?: string;
  customFilterPrompt?: string;
  customScriptwriterPrompt?: string;
  customPrompt: string;
  supadataApiKey?: string;
  telegramAutoSend: boolean;
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
  ideaTitle?: string;
  videoIds: string[];
  videoTitles: string[];
  content: string;
  matchedFilter?: boolean;
  isReviewed?: boolean;
  telegramSent?: boolean;
  telegramSentAt?: string;
  telegramMessageIds?: number[];
}

export interface TelegramStatus {
  isConfigured: boolean;
  hasToken: boolean;
  hasChatId: boolean;
  botUsername?: string;
  botFirstName?: string;
  chatTitle?: string;
  chatType?: string;
  defaultChatId?: string;
}

export interface SyncLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
  videoTitle?: string;
  videoId?: string;
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

export interface SupadataUsageSummary {
  usedThisMonth: number;
  monthlyLimit: number;
  remainingThisMonth: number;
  isLimitExceeded: boolean;
  usedLast24h: number;
  planName?: string;
  isLiveAccount?: boolean;
}

export interface DailyActivityStats {
  processedVideos24h: number;
  generatedScripts24h: number;
  approvedVideos24h: number;
  rejectedVideos24h: number;
  telegramSentScripts24h: number;
  geminiUsage24h?: GeminiUsageSummary;
  supadataUsage?: SupadataUsageSummary;
}

export interface AppStats {
  channelCount: number;
  totalVideos: number;
  completedCount: number;
  pendingCount: number;
  dailyActivity?: DailyActivityStats;
  geminiUsage24h?: GeminiUsageSummary;
  dailySyncEnabled: boolean;
  lastSyncRun: string | null;
  nextSyncRun: string | null;
}

export interface PromptTemplateDef {
  id: string;
  name: string;
  badge: string;
  description: string;
  text: string;
  category?: 'filter' | 'scriptwriter' | 'general';
  isCustom?: boolean;
  isModified?: boolean;
}

export interface ParsedIdea {
  id: string;
  index: number;
  title: string;
  rawText: string;
  hook?: string;
  core?: string;
  mythOrContext?: string;
  virality?: string;
  timecode?: string;
}

export interface PipelineStepProgress {
  videoId: string;
  videoTitle: string;
  step: 'idle' | 'transcribing' | 'analyzing' | 'sending_tg' | 'done' | 'rejected' | 'error';
  stepNumber: 1 | 2 | 3;
  stepMessage: string;
  currentVideoIndex: number;
  totalVideosCount: number;
  transcriptLength?: number;
  isFilteredOut?: boolean;
  telegramSent?: boolean;
  telegramError?: string;
  scriptId?: string;
  error?: string;
}


