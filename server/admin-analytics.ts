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

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const monthStart = startOfMonth.getTime();

  const allLlmUsage = db.geminiUsageLogs || [];
  const allSearchUsage = db.webSearchUsageLogs || [];
  const monthSearch = allSearchUsage.filter(log => inRange(log.timestamp, monthStart));
  const todayLlmFree = allLlmUsage.filter(log =>
    inRange(log.timestamp, dayStart)
    && (log.billingPhase || (log.isPaid ? 'paid' : 'free')) === 'free'
  );

  const searchUsed = (provider: 'google' | 'tavily' | 'brave' | 'openai') =>
    monthSearch.filter(log => log.provider === provider).reduce((sum, log) => sum + Number(log.units || 1), 0);
  const llmModelUsed = (provider: string, model?: string) => {
    const logs = todayLlmFree.filter(log => (log.provider || 'gemini') === provider && (!model || log.model === model));
    return {
      requests: logs.length,
      tokens: logs.reduce((sum, log) => sum + Number(log.totalTokens || 0), 0),
    };
  };
  const quotaRemaining = (limit: number | null, used: number) => limit === null ? null : Math.max(0, limit - used);

  const googleSearchUsed = searchUsed('google');
  const tavilyUsed = searchUsed('tavily');
  const braveUsed = searchUsed('brave');
  const openaiSearchUsed = searchUsed('openai');
  const groq20 = llmModelUsed('groq', 'openai/gpt-oss-20b');
  const groq120 = llmModelUsed('groq', 'openai/gpt-oss-120b');
  const openrouterFree = llmModelUsed('openrouter');
  const geminiFree = llmModelUsed('gemini');

  const providerQuota = [
    {
      id: 'search-google',
      category: 'search',
      provider: 'Google Search grounding',
      tier: 'free allowance on paid Gemini tier',
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()) && process.env.GOOGLE_WEB_SEARCH_ENABLED !== 'false',
      unit: 'requests',
      used: googleSearchUsed,
      limit: 5000,
      remaining: quotaRemaining(5000, googleSearchUsed),
      reset: 'monthly',
      source: 'local usage + published allowance',
      accuracy: 'estimated',
      note: '5,000 Search-grounding requests/month are included on the paid Gemini tier; Gemini model tokens may still be billable.',
    },
    {
      id: 'search-tavily',
      category: 'search',
      provider: 'Tavily',
      tier: 'free',
      configured: Boolean(process.env.TAVILY_API_KEY?.trim()),
      unit: 'credits',
      used: tavilyUsed,
      limit: 1000,
      remaining: quotaRemaining(1000, tavilyUsed),
      reset: 'monthly',
      source: 'local usage + published allowance',
      accuracy: 'estimated',
      note: 'Basic Search consumes one credit in the current SearchRouter.',
    },
    {
      id: 'search-brave',
      category: 'search',
      provider: 'Brave Search',
      tier: 'free monthly credits',
      configured: Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim()),
      unit: 'requests',
      used: braveUsed,
      limit: 1000,
      remaining: quotaRemaining(1000, braveUsed),
      reset: 'monthly',
      source: 'local usage + published allowance',
      accuracy: 'estimated',
      note: '$5 monthly free credits at $5 / 1,000 Search requests.',
    },
    {
      id: 'search-openai',
      category: 'search',
      provider: 'OpenAI Web Search',
      tier: 'paid fallback',
      configured: Boolean(process.env.OPENAI_API_KEY?.trim()) && process.env.OPENAI_WEB_SEARCH_ENABLED === 'true',
      unit: 'requests',
      used: openaiSearchUsed,
      limit: null,
      remaining: null,
      reset: 'billing account',
      source: 'local usage',
      accuracy: 'usage-only',
      note: 'No recurring free Web Search allowance is assumed.',
    },
    {
      id: 'llm-gemini',
      category: 'llm',
      provider: 'Google Gemini',
      tier: 'free/included routing',
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      unit: 'requests / tokens',
      used: geminiFree.requests,
      tokenUsed: geminiFree.tokens,
      limit: null,
      remaining: null,
      reset: 'provider/model-specific',
      source: 'local usage; provider limit varies by model/project',
      accuracy: 'unknown-limit',
      note: 'Gemini RPM/TPM/RPD are project/model-specific; do not infer a universal remaining quota.',
    },
    {
      id: 'llm-groq-20b',
      category: 'llm',
      provider: 'Groq · gpt-oss-20b',
      tier: 'free',
      configured: Boolean(process.env.GROQ_API_KEY?.trim()),
      unit: 'requests/day',
      used: groq20.requests,
      tokenUsed: groq20.tokens,
      tokenLimit: 200000,
      tokenRemaining: quotaRemaining(200000, groq20.tokens),
      limit: 1000,
      remaining: quotaRemaining(1000, groq20.requests),
      reset: 'daily',
      source: 'local usage + published base limits',
      accuracy: 'estimated',
      note: 'Published base limit: 1,000 RPD and 200K TPD; exact organization limits may differ.',
    },
    {
      id: 'llm-groq-120b',
      category: 'llm',
      provider: 'Groq · gpt-oss-120b',
      tier: 'free',
      configured: Boolean(process.env.GROQ_API_KEY?.trim()),
      unit: 'requests/day',
      used: groq120.requests,
      tokenUsed: groq120.tokens,
      tokenLimit: 200000,
      tokenRemaining: quotaRemaining(200000, groq120.tokens),
      limit: 1000,
      remaining: quotaRemaining(1000, groq120.requests),
      reset: 'daily',
      source: 'local usage + published base limits',
      accuracy: 'estimated',
      note: 'Published base limit: 1,000 RPD and 200K TPD; exact organization limits may differ.',
    },
    {
      id: 'llm-openrouter',
      category: 'llm',
      provider: 'OpenRouter · free',
      tier: 'free',
      configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      unit: 'requests/day',
      used: openrouterFree.requests,
      tokenUsed: openrouterFree.tokens,
      limit: 50,
      remaining: quotaRemaining(50, openrouterFree.requests),
      reset: 'daily',
      source: 'local usage + published free-plan limit',
      accuracy: 'estimated',
      note: 'Free plan currently publishes a 50 requests/day rate limit.',
    },
    {
      id: 'llm-openai',
      category: 'llm',
      provider: 'OpenAI',
      tier: 'paid fallback',
      configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      unit: 'tokens',
      used: allLlmUsage.filter(log => log.provider === 'openai').reduce((sum, log) => sum + Number(log.totalTokens || 0), 0),
      limit: null,
      remaining: null,
      reset: 'billing account',
      source: 'local usage',
      accuracy: 'usage-only',
      note: 'OpenAI is treated as paid fallback; no recurring free-token allowance is assumed.',
    },
  ];
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
      providerQuota,
      searchRequestsThisMonth: monthSearch.reduce((sum, log) => sum + Number(log.units || 1), 0),
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
