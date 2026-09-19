export interface UserAccount {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
  lastLoginAt?: string;
  legacyOwnerIdMapped?: string;
}

export interface TrackedChannel {
  id: string;
  ownerId?: string;
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

export type VideoStatus = 'new' | 'transcribe_queued' | 'transcribing' | 'transcribed' | 'processing_gemini' | 'completed' | 'error' | 'quota_exceeded' | 'requires_payment';

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
  status: VideoStatus;
  pendingPaidAction?: 'transcription' | 'stage1' | 'filter' | 'stage2' | 'script' | 'pipeline' | string;
  paidActionReason?: string;
  lastPassedStatus?: 'new' | 'transcribed' | 'approved' | 'rejected' | 'has_script';
  errorStage?: 'transcription' | 'filter' | 'script' | string;
  transcript?: string;
  transcriptSource?: 'subtitles' | 'gemini_multimodal' | 'supadata' | 'chocodata';
  transcriptSegments?: TranscriptSegment[];
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
  updatedAt: string;
  durationSeconds?: number;
  forcePaidModel?: boolean;
  radarScannedAt?: string;
}

export interface AppSettings {
  ownerId?: string;
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
  chocodataApiKey?: string;
  telegramAutoSend: boolean;
  telegramChatId?: string;
  skipTelegramIfFilteredOut?: boolean;
  radarDefaultDestination?: 'telegram' | 'google_docs' | 'copy';
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
  exportMethod?: 'copy' | 'download' | 'telegram';
  isPublished?: boolean;
  publishedAt?: string;
  archivedAt?: string;
  editedManually?: boolean;
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
  ownerId?: string;
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

export interface SupadataUsageLog {
  id: string;
  ownerId?: string;
  timestamp: string;
  videoId?: string;
  status: 'success' | 'limit_exceeded' | 'error' | 'not_found';
  message?: string;
}

export interface ChocodataUsageLog {
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

export interface ChocodataUsageSummary {
  usedTotal: number;
  totalLimit: number;
  remainingTotal: number;
  isLimitExceeded: boolean;
  usedLast24h: number;
  quotaPolicy: 'never';
}

export interface DailyActivityStats {
  processedVideos24h: number;
  generatedScripts24h: number;
  approvedVideos24h: number;
  rejectedVideos24h: number;
  telegramSentScripts24h: number;
  geminiUsage24h?: GeminiUsageSummary;
  supadataUsage?: SupadataUsageSummary;
  chocodataUsage?: ChocodataUsageSummary;
}

export type QuotaResetPolicy = 'monthly' | 'never';

export interface ProviderQuotaInfo {
  id: string;
  name: string;
  levelTag: string;
  planBadge?: string;
  used: number;
  limit: number;
  remaining: number;
  resetPolicy: QuotaResetPolicy;
  usedLast24h?: number;
  isLimitExceeded: boolean;
  isLiveAccount?: boolean;
  fallbackTargetName: string;
  unitLabel?: string;
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
  ownerId?: string;
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


export interface RadarDiscoveryCandidate {
  id: string;
  title: string;
  channelTitle: string;
  url: string;
  thumbnail?: string;
  publishedAt?: string;
  description?: string;
  query?: string;
  source?: 'external' | 'local';
  rankingScore?: number;
  rankingReason?: string;
}

export interface RadarDiscoveryState {
  candidates: RadarDiscoveryCandidate[];
  feedbackCount: number;
  interestingCount: number;
  skipCount: number;
  minimumSignals: number;
  externalCount?: number;
  youtubeApiConfigured?: boolean;
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


export interface RadarYouTubeSubscription {
  ownerId: string;
  channelId: string;
  title: string;
  description?: string;
  thumbnail?: string;
  importedAt: string;
  enabled: boolean;
}


export type RadarSkipReason = 'too_generic' | 'not_my_topic' | 'wrong_style' | 'too_shallow' | 'seen_before';


export type RadarScriptFeedbackReason = 'too_generic' | 'wrong_tone' | 'too_long' | 'weak_hook' | 'wrong_angle';


export interface RadarTodayState {
  generatedAt: string;
  summary: {
    newDiscoveryCandidates: number;
    newOpportunities24h: number;
    scriptsGenerated24h: number;
    scriptsNeedReview: number;
    scriptsReadyToExport: number;
    scriptsExported: number;
  };
  attention: Array<{
    type: 'script_review' | 'ready_to_export' | 'opportunity';
    id: string;
    title: string;
    subtitle: string;
    action: 'review' | 'export' | 'open';
    opportunityId?: string;
  }>;
  topOpportunities: RadarOpportunity[];
  topDiscovery: RadarDiscoveryCandidate[];
}

export type ProductSection = 'today' | 'discover' | 'ideas' | 'scripts' | 'library';


export interface RadarScriptDetail {
  script: GeneratedScript;
  opportunity?: RadarOpportunity;
  versions: GeneratedScript[];
  feedback: Array<{
    id: string;
    scriptId: string;
    opportunityId: string;
    decision: 'approved' | 'rewrite' | 'rejected';
    reason?: RadarScriptFeedbackReason;
    createdAt: string;
  }>;
}
