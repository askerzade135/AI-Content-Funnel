import { getDb, getDefaultOwnerId, LEGACY_OWNER_ID, UserAccount, GeminiUsageLog } from './storage.js';
import { DEFAULT_PRODUCT_QUOTAS } from './quotas.js';
import { LLM_TASKS, getLLMTaskRegistry } from './llm-tasks.js';

export type AdminAnalyticsPeriod = '24h' | '7d' | '30d';

function periodMs(period: AdminAnalyticsPeriod): number {
  if (period === '24h') return 24 * 60 * 60 * 1000;
  if (period === '30d') return 30 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function inRange(value: string | undefined, since: number): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= since;
}

function normalizeOwner(ownerId?: string): string {
  return getDefaultOwnerId(ownerId);
}

function usageOperation(log: GeminiUsageLog): string {
  const raw = String(log.operation || 'unknown');
  return raw.split(':')[0] || 'unknown';
}

function formatUserLabel(user: UserAccount | undefined, ownerId: string) {
  if (user) {
    return {
      name: user.name || user.email?.split('@')[0] || ownerId,
      email: user.email || '',
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }
  return {
    name: ownerId === LEGACY_OWNER_ID ? 'Primary owner' : ownerId,
    email: '',
    role: ownerId === LEGACY_OWNER_ID ? 'owner' : 'member',
    createdAt: '',
    lastLoginAt: undefined,
  };
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  const valid = values
    .filter(Boolean)
    .map(value => ({ value: value!, time: new Date(value!).getTime() }))
    .filter(item => Number.isFinite(item.time))
    .sort((a, b) => b.time - a.time);
  return valid[0]?.value;
}

export async function getAdminAnalytics(period: AdminAnalyticsPeriod = '7d') {
  const db = await getDb();
  const now = Date.now();
  const since = now - periodMs(period);

  const allOwnerIds = new Set<string>();
  for (const user of db.users || []) allOwnerIds.add(normalizeOwner(user.id));
  for (const item of db.geminiUsageLogs || []) if (item.ownerId) allOwnerIds.add(normalizeOwner(item.ownerId));
  for (const item of db.radarDiscoveryFeedback || []) allOwnerIds.add(normalizeOwner(item.ownerId));
  for (const item of db.radarDiscoveryExposures || []) allOwnerIds.add(normalizeOwner(item.ownerId));
  for (const item of db.radarOpportunities || []) allOwnerIds.add(normalizeOwner(item.ownerId));
  for (const item of db.radarScanRuns || []) allOwnerIds.add(normalizeOwner(item.ownerId));
  for (const item of db.radarDiscoveryRuns || []) allOwnerIds.add(normalizeOwner(item.ownerId));
  for (const item of db.scripts || []) if (item.ownerId) allOwnerIds.add(normalizeOwner(item.ownerId));
  for (const ownerId of Object.keys(db.radarProfiles || {})) allOwnerIds.add(normalizeOwner(ownerId));
  for (const ownerId of Object.keys(db.userQuotas || {})) allOwnerIds.add(normalizeOwner(ownerId));

  if (
    (db.videos || []).some(item => !item.ownerId || normalizeOwner(item.ownerId) === LEGACY_OWNER_ID) ||
    (db.scripts || []).some(item => !item.ownerId || normalizeOwner(item.ownerId) === LEGACY_OWNER_ID)
  ) {
    allOwnerIds.add(LEGACY_OWNER_ID);
  }

  const usersByResolvedOwner = new Map<string, UserAccount>();
  for (const user of db.users || []) usersByResolvedOwner.set(normalizeOwner(user.id), user);

  const periodUsage = (db.geminiUsageLogs || []).filter(log => inRange(log.timestamp, since));
  const periodDiscoveryRuns = (db.radarDiscoveryRuns || []).filter(run => inRange(run.startedAt, since));
  const periodFeedback = (db.radarDiscoveryFeedback || []).filter(item => inRange(item.createdAt, since));
  const periodPasses = (db.radarDiscoveryExposures || []).filter(item => inRange(item.createdAt, since));
  const periodIdeas = (db.radarOpportunities || []).filter(item => inRange(item.createdAt, since));
  const periodScripts = (db.scripts || []).filter(item => inRange(item.createdAt, since));

  const userRows = Array.from(allOwnerIds).map(ownerId => {
    const usage = periodUsage.filter(log => normalizeOwner(log.ownerId) === ownerId);
    const allUsage = (db.geminiUsageLogs || []).filter(log => normalizeOwner(log.ownerId) === ownerId);
    const feedback = (db.radarDiscoveryFeedback || []).filter(item => normalizeOwner(item.ownerId) === ownerId);
    const passes = (db.radarDiscoveryExposures || []).filter(item => normalizeOwner(item.ownerId) === ownerId);
    const ideas = (db.radarOpportunities || []).filter(item => normalizeOwner(item.ownerId) === ownerId);
    const outputs = (db.scripts || []).filter(item => normalizeOwner(item.ownerId) === ownerId && Boolean(item.radarOpportunityId));
    const analyses = (db.radarScanRuns || []).filter(item => normalizeOwner(item.ownerId) === ownerId);
    const discoveryRuns = (db.radarDiscoveryRuns || []).filter(item => normalizeOwner(item.ownerId) === ownerId);
    const quota = db.userQuotas?.[ownerId];
    const profile = db.radarProfiles?.[ownerId];
    const account = usersByResolvedOwner.get(ownerId);
    const accountInfo = formatUserLabel(account, ownerId);

    const scheduled = outputs.filter(item => Boolean(item.scheduledAt)).length;
    const savedIdeas = ideas.filter(item => Boolean(item.savedAt || item.status === 'saved')).length;
    const interested = feedback.filter(item => item.decision === 'interesting').length;
    const notInterested = feedback.filter(item => item.decision === 'not_interested').length;

    const lastActive = latestTimestamp([
      accountInfo.lastLoginAt,
      ...allUsage.map(item => item.timestamp),
      ...feedback.map(item => item.createdAt),
      ...passes.map(item => item.createdAt),
      ...ideas.map(item => item.updatedAt || item.createdAt),
      ...outputs.map(item => item.createdAt),
      ...analyses.map(item => item.completedAt || item.startedAt),
      ...discoveryRuns.map(item => item.completedAt || item.startedAt),
    ]);

    const inputTokens = usage.reduce((sum, item) => sum + Number(item.promptTokens || 0), 0);
    const outputTokens = usage.reduce((sum, item) => sum + Number(item.candidatesTokens || 0) + Number(item.thoughtsTokens || 0), 0);
    const totalTokens = usage.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0);
    const estimatedCostUsd = Number(usage.reduce((sum, item) => sum + Number(item.estimatedCostUsd || 0), 0).toFixed(6));

    return {
      ownerId,
      ...accountInfo,
      plan: 'default',
      lastActive,
      onboardingCompleted: Boolean(profile?.onboardingCompletedAt),
      activeInPeriod: Boolean(lastActive && inRange(lastActive, since)),
      tokens: { input: inputTokens, output: outputTokens, total: totalTokens },
      estimatedCostUsd,
      analyses: analyses.filter(item => inRange(item.startedAt, since)).length,
      discoveryRuns: discoveryRuns.filter(item => inRange(item.startedAt, since)).length,
      feedback: {
        interested,
        notInterested,
        skipped: passes.length,
      },
      ideas: ideas.length,
      savedIdeas,
      outputs: outputs.length,
      scheduled,
      quota: {
        used: {
          radarAnalyses: quota?.radarAnalyses || 0,
          scriptGenerations: quota?.scriptGenerations || 0,
          transcripts: quota?.transcripts || 0,
          transcriptMinutes: quota?.transcriptMinutes || 0,
        },
        limits: DEFAULT_PRODUCT_QUOTAS,
      },
    };
  }).sort((a, b) => new Date(b.lastActive || 0).getTime() - new Date(a.lastActive || 0).getTime());

  const totalInputTokens = periodUsage.reduce((sum, item) => sum + Number(item.promptTokens || 0), 0);
  const totalOutputTokens = periodUsage.reduce((sum, item) => sum + Number(item.candidatesTokens || 0) + Number(item.thoughtsTokens || 0), 0);
  const totalTokens = periodUsage.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0);
  const estimatedCostUsd = Number(periodUsage.reduce((sum, item) => sum + Number(item.estimatedCostUsd || 0), 0).toFixed(6));
  const activeUsers = userRows.filter(user => user.activeInPeriod).length;
  const newUsers = (db.users || []).filter(user => inRange(user.createdAt, since)).length;

  const costByOperation = Object.entries(periodUsage.reduce<Record<string, { requests: number; tokens: number; estimatedCostUsd: number }>>((acc, log) => {
    const key = usageOperation(log);
    acc[key] ||= { requests: 0, tokens: 0, estimatedCostUsd: 0 };
    acc[key].requests += 1;
    acc[key].tokens += Number(log.totalTokens || 0);
    acc[key].estimatedCostUsd += Number(log.estimatedCostUsd || 0);
    return acc;
  }, {})).map(([operation, value]) => ({
    operation,
    requests: value.requests,
    tokens: value.tokens,
    estimatedCostUsd: Number(value.estimatedCostUsd.toFixed(6)),
  })).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.tokens - a.tokens);

  const modelBreakdown = Object.entries(periodUsage.reduce<Record<string, {
    provider: string;
    model: string;
    billingPhase: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    errors: number;
    fallbackCount: number;
  }>>((acc, log) => {
    const provider = log.provider || 'gemini';
    const phase = log.billingPhase || (log.isPaid ? 'paid' : 'free');
    const key = `${provider}|${log.model}|${phase}`;
    acc[key] ||= { provider, model: log.model, billingPhase: phase, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, errors: 0, fallbackCount: 0 };
    acc[key].requests += 1;
    acc[key].inputTokens += Number(log.promptTokens || 0);
    acc[key].outputTokens += Number(log.candidatesTokens || 0) + Number(log.thoughtsTokens || 0);
    acc[key].totalTokens += Number(log.totalTokens || 0);
    acc[key].estimatedCostUsd += Number(log.estimatedCostUsd || 0);
    acc[key].errors += log.success === false ? 1 : 0;
    acc[key].fallbackCount += log.fallbackReason ? 1 : 0;
    return acc;
  }, {})).map(([, value]) => ({
    ...value,
    estimatedCostUsd: Number(value.estimatedCostUsd.toFixed(6)),
  })).sort((a, b) => b.requests - a.requests);

  const interested = periodFeedback.filter(item => item.decision === 'interesting').length;
  const notInterested = periodFeedback.filter(item => item.decision === 'not_interested').length;
  const skipped = periodPasses.length;
  const feedbackTotal = interested + notInterested + skipped;

  const funnel = {
    users: activeUsers,
    discover: new Set(periodDiscoveryRuns.map(item => normalizeOwner(item.ownerId))).size,
    interestedUsers: new Set(periodFeedback.filter(item => item.decision === 'interesting').map(item => normalizeOwner(item.ownerId))).size,
    ideaUsers: new Set(periodIdeas.map(item => normalizeOwner(item.ownerId))).size,
    outputUsers: new Set(periodScripts.filter(item => item.radarOpportunityId).map(item => normalizeOwner(item.ownerId))).size,
    scheduledUsers: new Set(periodScripts.filter(item => item.radarOpportunityId && item.scheduledAt).map(item => normalizeOwner(item.ownerId))).size,
  };

  return {
    generatedAt: new Date().toISOString(),
    period,
    periodStart: new Date(since).toISOString(),
    kpis: {
      totalUsers: userRows.length,
      activeUsers,
      newUsers,
      radarAnalyses: (db.radarScanRuns || []).filter(item => inRange(item.startedAt, since)).length,
      aiGenerations: periodScripts.filter(item => Boolean(item.radarOpportunityId)).length,
      estimatedCostUsd,
      avgCostPerActiveUserUsd: activeUsers ? Number((estimatedCostUsd / activeUsers).toFixed(6)) : 0,
    },
    ai: {
      requests: periodUsage.length,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      estimatedCostUsd,
      freeRequests: periodUsage.filter(item => (item.billingPhase || (item.isPaid ? 'paid' : 'free')) === 'free').length,
      paidRequests: periodUsage.filter(item => (item.billingPhase || (item.isPaid ? 'paid' : 'free')) === 'paid').length,
      byOperation: costByOperation,
      byModel: modelBreakdown,
    },
    product: {
      discoveryRuns: periodDiscoveryRuns.length,
      recommendationsFound: periodDiscoveryRuns.reduce((sum, item) => sum + Number(item.added || 0), 0),
      feedback: {
        interested,
        notInterested,
        skipped,
        total: feedbackTotal,
        interestedRate: feedbackTotal ? interested / feedbackTotal : 0,
        notInterestedRate: feedbackTotal ? notInterested / feedbackTotal : 0,
        skipRate: feedbackTotal ? skipped / feedbackTotal : 0,
      },
      ideasCreated: periodIdeas.length,
      ideasSaved: periodIdeas.filter(item => Boolean(item.savedAt || item.status === 'saved')).length,
      outputsCreated: periodScripts.filter(item => Boolean(item.radarOpportunityId)).length,
      regenerations: periodScripts.filter(item => Boolean(item.radarOpportunityId) && Number(item.version || 1) > 1).length,
      scheduled: periodScripts.filter(item => Boolean(item.radarOpportunityId) && Boolean(item.scheduledAt)).length,
      funnel,
    },
    users: userRows,
    llm: {
      tasks: getLLMTaskRegistry(),
      registeredTaskCount: Object.keys(LLM_TASKS).length,
    },
  };
}
