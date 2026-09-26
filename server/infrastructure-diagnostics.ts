import { getDb, getFirestoreSnapshotStatus, getFirestoreSyncStatus, getStorageMode, type AppDatabase } from './storage.js';
import { getAdminAnalytics } from './admin-analytics.js';
import { getDiscoverySourceAvailability } from './discovery-adapters.js';
import { serverActiveJobIds, serverPendingQueue } from './queue.js';

export type DiagnosticState = 'healthy' | 'attention' | 'unavailable';

const toTime = (value?: string) => {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};
const latest = <T>(items: T[], pick: (item: T) => string | undefined) =>
  items.map(pick).filter((v): v is string => Boolean(v)).sort((a, b) => toTime(b) - toTime(a))[0];
const recent = <T>(items: T[], pick: (item: T) => string | undefined, ms = 24 * 60 * 60 * 1000) => {
  const since = Date.now() - ms;
  return items.filter(item => toTime(pick(item)) >= since);
};

function duplicateIds(db: AppDatabase): number {
  const sets: Array<Array<{ id?: string }>> = [
    db.users || [], db.adminInvites || [], db.channels || [], db.videos || [], db.deletedVideos || [],
    db.scripts || [], db.logs || [], db.geminiUsageLogs || [], db.supadataUsageLogs || [],
    db.chocodataUsageLogs || [], db.transcriptUsageLogs || [], db.webSearchUsageLogs || [],
    db.radarOpportunities || [], db.radarScanRuns || [], db.radarDiscoveryRuns || [],
    db.radarDiscoveryFeedback || [], db.radarDiscoveryExposures || [], db.radarDiscoveryCandidates || [],
    db.radarReferences || [], db.radarScriptFeedback || [], db.publicationJobs || [],
  ];
  let count = 0;
  for (const items of sets) {
    const seen = new Set<string>();
    for (const item of items) {
      const id = String(item.id || '');
      if (!id) continue;
      if (seen.has(id)) count += 1;
      else seen.add(id);
    }
  }
  return count;
}

function collectionCounts(db: AppDatabase) {
  return {
    users: (db.users || []).length,
    channels: db.channels.length,
    videos: db.videos.length,
    scripts: db.scripts.filter(item => !item.parentScriptId).length,
    scriptVersions: db.scripts.filter(item => Boolean(item.parentScriptId)).length,
    publicationJobs: (db.publicationJobs || []).length,
    radarProfiles: Object.keys(db.radarProfiles || {}).length,
    radarOpportunities: (db.radarOpportunities || []).length,
    radarDiscoveryCandidates: (db.radarDiscoveryCandidates || []).length,
    transcriptCache: (db.transcriptCache || []).length,
    socialIntegrations: (db.socialIntegrations || []).length,
    userQuotas: Object.keys(db.userQuotas || {}).length,
  };
}

function integrity(db: AppDatabase) {
  const scripts = db.scripts || [];
  const scriptIds = new Set(scripts.map(item => item.id));
  const rootIds = new Set(scripts.filter(item => !item.parentScriptId).map(item => item.id));
  const opportunityIds = new Set((db.radarOpportunities || []).map(item => item.id));
  const candidateIds = new Set((db.radarDiscoveryCandidates || []).map(item => item.sourceContentId || item.videoId));
  const issues = {
    scriptVersionsWithoutParent: scripts.filter(item => item.parentScriptId && !rootIds.has(item.parentScriptId)).length,
    publicationJobsWithoutScript: (db.publicationJobs || []).filter(item => !scriptIds.has(item.scriptId)).length,
    scriptsWithoutOwner: scripts.filter(item => !item.ownerId).length,
    opportunitiesWithoutOwner: (db.radarOpportunities || []).filter(item => !item.ownerId).length,
    opportunitiesWithoutSource: (db.radarOpportunities || []).filter(item => !item.sourceContentId || !item.sourceUrl).length,
    feedbackWithoutCandidate: (db.radarDiscoveryFeedback || []).filter(item => !candidateIds.has(item.sourceContentId)).length,
    scriptFeedbackWithoutIdea: (db.radarScriptFeedback || []).filter(item => !opportunityIds.has(item.opportunityId)).length,
    publishedWithoutTimestamp: scripts.filter(item => item.workflowStatus === 'published' && item.isPublished && !item.publishedAt).length,
    duplicateIds: duplicateIds(db),
  };
  const issueCount = Object.values(issues).reduce((sum, value) => sum + value, 0);
  return {
    state: issueCount === 0 ? 'healthy' as const : 'attention' as const,
    issueCount,
    issues,
    workflowOnlyScheduled: scripts.filter(item => item.workflowStatus === 'scheduled' && !item.scheduledAt).length,
  };
}

export async function getInfrastructureDiagnostics() {
  const db = await getDb();
  const [storage, analytics] = await Promise.all([getFirestoreSnapshotStatus(), getAdminAnalytics('24h')]);
  const sync = getFirestoreSyncStatus();
  const now = Date.now();

  const discovery24h = recent(db.radarDiscoveryRuns || [], item => item.startedAt);
  const scans24h = recent(db.radarScanRuns || [], item => item.startedAt);
  const publication24h = recent(db.publicationJobs || [], item => item.updatedAt || item.createdAt);
  const llm24h = recent(db.geminiUsageLogs || [], item => item.timestamp);
  const transcript24h = recent(db.transcriptUsageLogs || [], item => item.timestamp);
  const search24h = recent(db.webSearchUsageLogs || [], item => item.timestamp);

  const stuckVideoStatuses = new Set(['transcribing', 'processing_gemini', 'transcribe_queued']);
  const stuckVideos = db.videos.filter(video =>
    stuckVideoStatuses.has(String(video.status || ''))
    && toTime(video.updatedAt) > 0
    && now - toTime(video.updatedAt) > 30 * 60 * 1000
  );
  const stuckPublicationJobs = (db.publicationJobs || []).filter(job =>
    ['uploading', 'processing'].includes(job.status)
    && toTime(job.updatedAt || job.createdAt) > 0
    && now - toTime(job.updatedAt || job.createdAt) > 60 * 60 * 1000
  );

  const failedPublication24h = publication24h.filter(job => job.status === 'failed');
  const failedDiscovery24h = discovery24h.filter(run => run.status === 'failed');
  const failedScans24h = scans24h.filter(run => run.status === 'failed');
  const failedLlm24h = llm24h.filter(log => log.success === false);
  const failedTranscripts24h = transcript24h.filter(log => ['error', 'quota_exceeded', 'not_found'].includes(log.status));
  const failedSearch24h = search24h.filter(log => log.status !== 'success');

  const sourceAvailability = getDiscoverySourceAvailability();
  const quotas = analytics.ai.providerQuota;
  const social = (['instagram', 'tiktok'] as const).map(platform => {
    const records = (db.socialIntegrations || []).filter(item => item.platform === platform);
    const expired = records.filter(item => item.expiresAt && toTime(item.expiresAt) <= now).length;
    const expiringSoon = records.filter(item => {
      const expiry = toTime(item.expiresAt);
      return expiry > now && expiry - now < 7 * 24 * 60 * 60 * 1000;
    }).length;
    const configured = platform === 'instagram'
      ? Boolean(process.env.INSTAGRAM_APP_ID?.trim() && process.env.INSTAGRAM_APP_SECRET?.trim() && process.env.APP_URL?.trim())
      : Boolean(process.env.TIKTOK_CLIENT_KEY?.trim() && process.env.TIKTOK_CLIENT_SECRET?.trim() && process.env.APP_URL?.trim());
    return { platform, configured, connections: records.length, expired, expiringSoon };
  });

  const dataIntegrity = integrity(db);
  const aiConfigured = quotas.some(item => item.category === 'llm' && item.configured);
  const searchConfigured = sourceAvailability.some(item => item.sourceType === 'web' && item.available);
  const transcriptionConfigured = quotas.some(item => item.category === 'transcription' && item.configured);

  const states = {
    storage: storage.readable && sync.ok ? 'healthy' : 'attention',
    ai: !aiConfigured ? 'unavailable' : failedLlm24h.length ? 'attention' : 'healthy',
    search: !searchConfigured ? 'unavailable' : failedSearch24h.length ? 'attention' : 'healthy',
    transcription: !transcriptionConfigured ? 'unavailable' : failedTranscripts24h.length ? 'attention' : 'healthy',
    publishing: failedPublication24h.length || stuckPublicationJobs.length ? 'attention' : 'healthy',
    queue: stuckVideos.length || stuckPublicationJobs.length ? 'attention' : 'healthy',
    integrations: social.some(item => item.expired) ? 'attention' : social.some(item => item.configured) ? 'healthy' : 'unavailable',
    dataIntegrity: dataIntegrity.state,
  } satisfies Record<string, DiagnosticState>;

  return {
    generatedAt: new Date().toISOString(),
    health: Object.entries(states).map(([id, state]) => ({ id, state })),
    storage: {
      mode: getStorageMode(),
      databaseId: storage.databaseId,
      format: storage.format,
      entityCount: storage.entityCount || 0,
      readable: storage.readable,
      syncOk: sync.ok,
      lastSyncAt: sync.lastSyncAt,
      lastError: sync.lastError,
      legacySnapshotExists: Boolean(storage.legacySnapshotExists),
      chunkCount: storage.chunkCount,
      collections: collectionCounts(db),
    },
    migration: {
      state: storage.format === 'normalized-v2' && storage.readable ? 'verified' : 'fallback',
      format: storage.format || 'unknown',
      entityCount: storage.entityCount || 0,
      legacySnapshotRetained: Boolean(storage.legacySnapshotExists),
      safeToRetireLegacy: storage.format === 'normalized-v2' && storage.readable && sync.ok && dataIntegrity.issueCount === 0,
      lastVerifiedAt: storage.updatedAt,
    },
    jobs: {
      pendingQueue: serverPendingQueue.length,
      activeQueue: serverActiveJobIds.size,
      stuckVideos: stuckVideos.length,
      stuckPublicationJobs: stuckPublicationJobs.length,
      publicationFailed24h: failedPublication24h.length,
      discoveryFailed24h: failedDiscovery24h.length,
      radarScanFailed24h: failedScans24h.length,
      lastDiscoveryRunAt: latest(db.radarDiscoveryRuns || [], item => item.completedAt || item.startedAt),
      lastRadarScanAt: latest(db.radarScanRuns || [], item => item.completedAt || item.startedAt),
      lastPublicationUpdateAt: latest(db.publicationJobs || [], item => item.updatedAt || item.createdAt),
    },
    providers: {
      llm: {
        requests24h: llm24h.length,
        failed24h: failedLlm24h.length,
        paidRequests24h: llm24h.filter(item => item.isPaid || item.billingPhase === 'paid').length,
        lastUsed: latest(llm24h, item => item.timestamp),
        configured: quotas.filter(item => item.category === 'llm'),
      },
      search: {
        requests24h: search24h.length,
        failed24h: failedSearch24h.length,
        lastUsed: latest(search24h, item => item.timestamp),
        sources: sourceAvailability,
        configured: quotas.filter(item => item.category === 'search'),
      },
      transcription: {
        requests24h: transcript24h.length,
        failed24h: failedTranscripts24h.length,
        lastUsed: latest(transcript24h, item => item.timestamp),
        configured: quotas.filter(item => item.category === 'transcription'),
      },
    },
    integrations: {
      social,
      googleCalendar: {
        observability: 'client-session',
        note: 'Google Calendar OAuth state is browser-session scoped and is not centrally persisted on the server.',
      },
    },
    dataIntegrity,
  };
}
