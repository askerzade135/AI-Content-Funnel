import { getDb, saveDb, getDefaultOwnerId, getVideosForOwner, RadarOpportunity, RadarProfile, RadarScanRun, RadarDiscoveryRun, RadarDiscoveryFeedback, RadarDiscoveryExposure, RadarDiscoveryCandidateRecord, RadarReferenceSignal, RadarYouTubeSubscription, RadarScriptFeedback, GeneratedScript, RadarContentFormat } from './storage.js';
import { executeTranscriptChain } from './transcript-providers.js';
import { runLLMTask } from './llm-tasks.js';
import { assertUserQuotaAvailable, consumeUserQuota } from './quotas.js';
import { searchYouTubeVideos, extractVideoId, fetchSingleVideoInfo, resolveChannelId, fetchChannelVideos, enrichYouTubeVideoStatistics } from './youtube.js';
import { getDiscoverySourceAdapter } from './discovery-adapters.js';

const LEGACY_DEFAULT_PROFILE = 'Я создаю контент про психологию, воспитание, отношения между поколениями, общество и ценности. Ищу необычные, дискуссионные и содержательные темы, а не обычные советы.';

const MAX_CONCURRENT_SCRIPT_GENERATIONS = 3;
const DISCOVERY_READY_BUFFER_TARGET = 15;
const DISCOVERY_LOW_WATERMARK = 6;
const DISCOVERY_EMERGENCY_WATERMARK = 2;
const DISCOVERY_RERANK_DEBOUNCE_MS = 2500;
const DISCOVERY_MAX_RERANK_PASSES_PER_BURST = 2;
const RADAR_CONTENT_FORMATS: RadarContentFormat[] = ['short_video', 'long_video_or_podcast', 'article', 'post'];

function normalizeRadarContentFormats(values?: string[]): RadarContentFormat[] {
  return (values || [])
    .map(String)
    .filter((value): value is RadarContentFormat => RADAR_CONTENT_FORMATS.includes(value as RadarContentFormat))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, RADAR_CONTENT_FORMATS.length);
}

function getRadarPrimaryFormat(profile: RadarProfile): RadarContentFormat {
  return normalizeRadarContentFormats(profile.contentFormats)[0] || 'short_video';
}

function getRadarSecondaryFormats(profile: RadarProfile): RadarContentFormat[] {
  return normalizeRadarContentFormats(profile.contentFormats).slice(1);
}

function parseOpportunityFormats(
  profile: RadarProfile,
  recommendedInput: unknown,
  alternativesInput: unknown
): { recommendedFormat: RadarContentFormat; alternativeFormats: RadarContentFormat[] } {
  // My Radar contentFormats is an ordered preference list, not a permission list.
  // The first selected format is always the default format for the Idea CTA.
  const primaryFormat = getRadarPrimaryFormat(profile);
  const recommendedCandidate = String(recommendedInput || '') as RadarContentFormat;

  const candidates = [
    ...getRadarSecondaryFormats(profile),
    ...(Array.isArray(alternativesInput) ? alternativesInput.map(String) : []),
    recommendedCandidate,
    ...RADAR_CONTENT_FORMATS,
  ]
    .filter((value): value is RadarContentFormat => RADAR_CONTENT_FORMATS.includes(value as RadarContentFormat))
    .filter((value, index, all) => value !== primaryFormat && all.indexOf(value) === index);

  return {
    recommendedFormat: primaryFormat,
    alternativeFormats: candidates.slice(0, 2),
  };
}
const activeScriptGenerationsByOwner = new Map<string, number>();
const activeDiscoveryMaintenance = new Set<string>();
const pendingDiscoveryMaintenance = new Map<string, { negative: boolean }>();
const discoveryMaintenanceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function beginScriptGeneration(ownerId: string) {
  const active = activeScriptGenerationsByOwner.get(ownerId) || 0;
  if (active >= MAX_CONCURRENT_SCRIPT_GENERATIONS) {
    const error: any = new Error(`Одновременно можно генерировать не больше ${MAX_CONCURRENT_SCRIPT_GENERATIONS} сценариев`);
    error.code = 'SCRIPT_GENERATION_CONCURRENCY_LIMIT';
    error.limit = MAX_CONCURRENT_SCRIPT_GENERATIONS;
    error.active = active;
    throw error;
  }
  activeScriptGenerationsByOwner.set(ownerId, active + 1);
}

function endScriptGeneration(ownerId: string) {
  const active = activeScriptGenerationsByOwner.get(ownerId) || 0;
  if (active <= 1) activeScriptGenerationsByOwner.delete(ownerId);
  else activeScriptGenerationsByOwner.set(ownerId, active - 1);
}

function logDiscoveryEvent(event: string, payload: Record<string, unknown>) {
  console.log(JSON.stringify({
    severity: 'INFO',
    component: 'content-radar',
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  }));
}


function normalizedList(values?: string[]) {
  return (values || []).map((value) => String(value).trim()).filter(Boolean);
}

function sameStringSet(left?: string[], right?: string[]) {
  const a = normalizedList(left).map((value) => value.toLocaleLowerCase()).sort();
  const b = normalizedList(right).map((value) => value.toLocaleLowerCase()).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameOrderedStringList(left?: string[], right?: string[]) {
  const a = normalizedList(left).map((value) => value.toLocaleLowerCase());
  const b = normalizedList(right).map((value) => value.toLocaleLowerCase());
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function profileRankingContextChanged(current: RadarProfile, next: RadarProfile) {
  return !sameStringSet(current.topics, next.topics)
    || !sameStringSet(current.avoid, next.avoid)
    || !sameStringSet(current.preferredAngles, next.preferredAngles)
    || !sameStringSet(current.goals, next.goals)
    || !sameOrderedStringList(current.contentFormats, next.contentFormats)
    || !sameStringSet(current.discoverySources, next.discoverySources)
    || String(current.description || '').trim() !== String(next.description || '').trim()
    || String(current.customInstructions || '').trim() !== String(next.customInstructions || '').trim();
}

function hardDiscoveryContextChanged(current: RadarProfile, next: RadarProfile) {
  return !sameStringSet(current.topics, next.topics) || !sameStringSet(current.avoid, next.avoid);
}

function invalidateOwnerDiscoveryCandidates(
  db: Awaited<ReturnType<typeof getDb>>,
  ownerId: string,
  options: { clearUnreviewed: boolean }
) {
  const reviewedIds = new Set(
    (db.radarDiscoveryFeedback || [])
      .filter((item) => item.ownerId === ownerId)
      .map((item) => item.sourceContentId)
  );

  if (options.clearUnreviewed) {
    db.radarDiscoveryCandidates = (db.radarDiscoveryCandidates || []).filter((candidate) => {
      if (candidate.ownerId !== ownerId) return true;
      const contentId = candidate.sourceContentId || candidate.videoId;
      return reviewedIds.has(contentId);
    });
    return;
  }

  for (const candidate of db.radarDiscoveryCandidates || []) {
    if (candidate.ownerId !== ownerId) continue;
    const contentId = candidate.sourceContentId || candidate.videoId;
    if (reviewedIds.has(contentId)) continue;
    candidate.rankedAt = undefined;
    candidate.rankingScore = undefined;
    candidate.rankingReason = undefined;
    candidate.rankedForTasteVersion = undefined;
    candidate.eligible = undefined;
    candidate.eligibilityReason = undefined;
  }
}


export async function getRadarProfile(ownerId?: string): Promise<RadarProfile> {
  const db = await getDb();
  if (!db.radarProfiles) db.radarProfiles = {};
  const id = getDefaultOwnerId(ownerId);
  const existing = db.radarProfiles[id];
  if (existing) {
    const hasLegacyDefaultDescription = String(existing.description || '').trim() === LEGACY_DEFAULT_PROFILE;
    const needsMigration = !Array.isArray(existing.contentFormats)
      || !Array.isArray(existing.goals)
      || !Array.isArray(existing.discoverySources)
      || !Number.isFinite(existing.tasteVersion)
      || hasLegacyDefaultDescription;
    const normalized: RadarProfile = {
      ...existing,
      description: hasLegacyDefaultDescription ? '' : String(existing.description || ''),
      contentFormats: Array.isArray(existing.contentFormats) ? existing.contentFormats : [],
      goals: Array.isArray(existing.goals) ? existing.goals : [],
      discoverySources: Array.isArray(existing.discoverySources) ? existing.discoverySources : ['youtube', 'web', 'x'],
      tasteVersion: Number.isFinite(existing.tasteVersion) ? Math.max(1, Number(existing.tasteVersion)) : 1,
    };
    if (needsMigration) {
      db.radarProfiles[id] = normalized;
      await saveDb();
    }
    return normalized;
  }
  const profile: RadarProfile = {
    ownerId: id,
    description: '',
    topics: [],
    preferredAngles: [],
    contentFormats: [],
    goals: [],
    discoverySources: ['youtube', 'web', 'x'],
    avoid: [],
    customInstructions: '',
    onboardingCompletedAt: undefined,
    tasteVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  db.radarProfiles[id] = profile;
  await saveDb();
  return profile;
}

export async function saveRadarProfile(ownerId: string | undefined, input: Partial<RadarProfile>): Promise<RadarProfile> {
  const db = await getDb();
  if (!db.radarProfiles) db.radarProfiles = {};
  const id = getDefaultOwnerId(ownerId);
  const current = await getRadarProfile(id);
  const candidate: RadarProfile = {
    ...current,
    ...input,
    ownerId: id,
    description: String(input.description ?? current.description).trim(),
    topics: Array.isArray(input.topics) ? input.topics.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 50) : current.topics,
    preferredAngles: Array.isArray(input.preferredAngles) ? input.preferredAngles.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 50) : current.preferredAngles,
    contentFormats: Array.isArray(input.contentFormats) ? normalizeRadarContentFormats(input.contentFormats.map(String)) : (current.contentFormats || []),
    goals: Array.isArray(input.goals) ? input.goals.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 10) : (current.goals || []),
    discoverySources: Array.isArray(input.discoverySources)
      ? input.discoverySources.map(String).filter((source): source is 'youtube' | 'web' | 'x' => ['youtube', 'web', 'x'].includes(source)).slice(0, 3)
      : (current.discoverySources || ['youtube', 'web', 'x']),
    avoid: Array.isArray(input.avoid) ? input.avoid.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 50) : current.avoid,
    customInstructions: typeof input.customInstructions === 'string' ? input.customInstructions.slice(0, 10000) : current.customInstructions,
    onboardingCompletedAt: typeof input.onboardingCompletedAt === 'string' ? input.onboardingCompletedAt : current.onboardingCompletedAt,
    tasteVersion: Math.max(1, Number(current.tasteVersion || 1)),
    updatedAt: new Date().toISOString(),
  };

  const rankingChanged = profileRankingContextChanged(current, candidate);
  const hardChanged = hardDiscoveryContextChanged(current, candidate);
  if (rankingChanged) candidate.tasteVersion = Math.max(1, Number(current.tasteVersion || 1)) + 1;

  db.radarProfiles[id] = candidate;
  if (rankingChanged) {
    invalidateOwnerDiscoveryCandidates(db, id, { clearUnreviewed: hardChanged });
    logDiscoveryEvent('radar_taste_context_changed', {
      ownerId: id,
      previousTasteVersion: current.tasteVersion || 1,
      tasteVersion: candidate.tasteVersion,
      hardChanged,
      topics: candidate.topics || [],
      avoid: candidate.avoid || [],
      primaryContentFormat: getRadarPrimaryFormat(candidate),
      secondaryContentFormats: getRadarSecondaryFormats(candidate),
    });
  }
  await saveDb();
  return candidate;
}

export async function getRadarOpportunities(ownerId?: string, status?: RadarOpportunity['status']) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const feedbackBySource = new Map(
    (db.radarDiscoveryFeedback || [])
      .filter((x) => x.ownerId === id)
      .map((x) => [x.sourceContentId, x.decision] as const)
  );
  return (db.radarOpportunities || [])
    .filter((x) => x.ownerId === id && (!status || x.status === status))
    .map((x) => ({
      ...x,
      savedAt: x.savedAt || (x.status === 'saved' ? x.updatedAt || x.createdAt : undefined),
      sourceFeedback: feedbackBySource.get(x.sourceContentId),
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function updateRadarOpportunityStatus(ownerId: string | undefined, opportunityId: string, status: RadarOpportunity['status']) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const opportunity = (db.radarOpportunities || []).find((x) => x.id === opportunityId && x.ownerId === id);
  if (!opportunity) return null;
  opportunity.status = status;
  opportunity.updatedAt = new Date().toISOString();
  await saveDb();
  return opportunity;
}

export async function setRadarOpportunitySaved(ownerId: string | undefined, opportunityId: string, saved: boolean) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const opportunity = (db.radarOpportunities || []).find((x) => x.id === opportunityId && x.ownerId === id);
  if (!opportunity) return null;

  const now = new Date().toISOString();
  opportunity.savedAt = saved ? now : undefined;
  // Migrate the old mutually-exclusive "saved" status into the independent flag.
  if (opportunity.status === 'saved') opportunity.status = 'new';
  opportunity.updatedAt = now;
  await saveDb();
  return opportunity;
}

function buildPrompt(profile: RadarProfile, video: { title: string; channelTitle: string; transcript: string }) {
  return `You are Content Radar. Analyze the source as research material for the creator. Do not summarize the video.

CREATOR STRATEGY
Additional context: ${profile.description || 'none'}

TOPICS
${(profile.topics || []).join(', ') || 'not specified'}

PREFERRED ANGLES
${(profile.preferredAngles || []).join(', ') || 'not specified'}

PRIMARY OUTPUT FORMAT
${getRadarPrimaryFormat(profile)}

SECONDARY OUTPUT FORMAT PREFERENCES
${getRadarSecondaryFormats(profile).join(', ') || 'none'}

ALL SUPPORTED OUTPUT FORMATS
${RADAR_CONTENT_FORMATS.join(', ')}

CREATOR GOALS
${(profile.goals || []).join(', ') || 'not specified'}

AVOID
${(profile.avoid || []).join(', ') || 'not specified'}

CUSTOM INSTRUCTIONS
${profile.customInstructions || 'none'}

SOURCE
Title: ${video.title}
Channel: ${video.channelTitle}

TRANSCRIPT
${video.transcript.slice(0, 55000)}

Return ONLY valid JSON in this exact shape:
{
  "opportunities": [
    {
      "title": "working title",
      "topic": "short topic",
      "hook": "strong opening line",
      "coreIdea": "central thesis",
      "whyInteresting": "why this fits the creator strategy",
      "angle": "how to develop it without copying the source",
      "evidence": ["1-3 short factual/source-grounded notes from the transcript"],
      "relevance": 0,
      "recommendedFormat": "one of the creator output formats",
      "alternativeFormats": ["0-2 other creator output formats"]
    }
  ]
}

Rules:
- Return 0 to 3 opportunities.
- PRIMARY OUTPUT FORMAT is the creator's default destination and MUST be used as recommendedFormat for every returned Idea.
- SECONDARY OUTPUT FORMAT PREFERENCES are softer preferences, not permissions.
- ALL SUPPORTED OUTPUT FORMATS are always available for creation later.
- Output-format preference may shape which source material is valuable, but source type and output type are separate dimensions.
- alternativeFormats may contain 0-2 other supported output formats when the same Idea adapts well to them.
- Do not duplicate the same idea once per format.
- relevance is an integer 0-100.
- Only include opportunities with relevance >= 60.
- Prefer tension, paradox, myth, overlooked implication, counterintuitive evidence, or a strong discussion angle.
- Do not invent facts not supported by the transcript.
- If nothing is useful, return {"opportunities":[]}.
`;
}

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^\`\`\`json/i, '').replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
  return JSON.parse(cleaned);
}

function dedupeKey(item: { title?: string; coreIdea?: string }) {
  return `${String(item.title || '').toLowerCase().replace(/\W+/g, ' ').trim()}|${String(item.coreIdea || '').toLowerCase().replace(/\W+/g, ' ').trim()}`;
}

export async function runRadarScan(ownerId?: string, options?: { limit?: number; selectedOnly?: boolean }) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const profile = await getRadarProfile(id);
  if (!db.radarOpportunities) db.radarOpportunities = [];
  if (!db.radarScanRuns) db.radarScanRuns = [];

  const limit = Math.max(1, Math.min(options?.limit || 12, 30));
  const interestingIds = new Set(
    (db.radarDiscoveryFeedback || [])
      .filter((x) => x.ownerId === id && x.decision === 'interesting')
      .map((x) => x.sourceContentId)
  );
  const videos = getVideosForOwner(db, id)
    .filter((v) => !v.radarScannedAt)
    .filter((v) => !options?.selectedOnly || interestingIds.has(v.id))
    .sort((a, b) => new Date(b.publishedAt || b.updatedAt || 0).getTime() - new Date(a.publishedAt || a.updatedAt || 0).getTime())
    .slice(0, limit);

  const scanStartedAt = Date.now();
  const run: RadarScanRun = {
    id: `radar-scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerId: id,
    startedAt: new Date(scanStartedAt).toISOString(),
    transcriptDurationMs: 0,
    analysisDurationMs: 0,
    llm: [],
    scanned: 0,
    opportunitiesCreated: 0,
    errors: 0,
    status: 'running',
  };
  db.radarScanRuns.unshift(run);
  await saveDb();

  const created: RadarOpportunity[] = [];
  for (const video of videos) {
    try {
      await assertUserQuotaAvailable(id, 'radarAnalyses', 1);
      video.radarAnalysisState = 'processing';
      video.radarAnalysisRequestedAt = video.radarAnalysisRequestedAt || new Date().toISOString();
      video.updatedAt = new Date().toISOString();
      await saveDb();

      let transcript = video.transcript;
      if (!transcript || transcript.trim().length < 50) {
        const transcriptStartedAt = Date.now();
        const extracted = await executeTranscriptChain(video.id, video.title, { ownerId: id });
        run.transcriptDurationMs = (run.transcriptDurationMs || 0) + (Date.now() - transcriptStartedAt);
        transcript = extracted.text;
        video.transcript = extracted.text;
        video.transcriptSegments = extracted.segments;
        video.transcriptSource = extracted.source;
        video.status = 'transcribed';
        video.updatedAt = new Date().toISOString();
        await saveDb();
      }

      const analysisStartedAt = Date.now();
      const response = await runLLMTask(id, 'radar_opportunity_analysis', buildPrompt(profile, {
        title: video.title,
        channelTitle: video.channelTitle,
        transcript,
      }));
      run.analysisDurationMs = (run.analysisDurationMs || 0) + (Date.now() - analysisStartedAt);
      const existingLlm = (run.llm || []).find(item =>
        item.provider === response.provider &&
        item.model === response.model &&
        item.operation === 'radar_opportunity_analysis:v1'
      );
      if (existingLlm) existingLlm.count += 1;
      else (run.llm ||= []).push({
        provider: response.provider,
        model: response.model,
        operation: 'radar_opportunity_analysis:v1',
        count: 1,
      });
      await consumeUserQuota(id, 'radarAnalyses', 1);

      const parsed = parseJson(response.text);
      const rawItems = Array.isArray(parsed?.opportunities) ? parsed.opportunities : [];
      const existingKeys = new Set(db.radarOpportunities.filter((x) => x.ownerId === id).map(dedupeKey));

      for (const raw of rawItems.slice(0, 3)) {
        const relevance = Math.max(0, Math.min(100, Math.round(Number(raw.relevance) || 0)));
        if (relevance < 60) continue;
        const candidate = {
          title: String(raw.title || '').trim(),
          coreIdea: String(raw.coreIdea || '').trim(),
        };
        if (!candidate.title || !candidate.coreIdea || existingKeys.has(dedupeKey(candidate))) continue;

        const now = new Date().toISOString();
        const ideaFormats = parseOpportunityFormats(profile, raw.recommendedFormat, raw.alternativeFormats);
        const opportunity: RadarOpportunity = {
          id: `opp-${video.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ownerId: id,
          sourceType: 'youtube',
          sourceContentId: video.id,
          sourceTitle: video.title,
          sourceUrl: video.url,
          sourceChannel: video.channelTitle,
          sourceThumbnail: video.thumbnail,
          title: candidate.title,
          topic: String(raw.topic || '').trim() || undefined,
          hook: String(raw.hook || '').trim(),
          coreIdea: candidate.coreIdea,
          whyInteresting: String(raw.whyInteresting || '').trim(),
          angle: String(raw.angle || '').trim(),
          evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String).filter(Boolean).slice(0, 3) : [],
          relevance,
          recommendedFormat: ideaFormats.recommendedFormat,
          alternativeFormats: ideaFormats.alternativeFormats,
          status: 'new',
          sourceFeedback: interestingIds.has(video.id) ? 'interesting' : undefined,
          analysisBatchId: run.id,
          createdAt: now,
          updatedAt: now,
        };
        db.radarOpportunities.unshift(opportunity);
        existingKeys.add(dedupeKey(opportunity));
        created.push(opportunity);
      }
      video.radarScannedAt = new Date().toISOString();
      video.radarAnalysisState = 'completed';
      video.updatedAt = new Date().toISOString();
      run.scanned++;
    } catch (err: any) {
      console.warn('[Content Radar] Scan item failed:', video.id, err);
      // Keep radarScannedAt empty on transient failures so the item can be retried.
      if (err?.code === 'PRODUCT_QUOTA_EXCEEDED') {
        video.radarAnalysisState = 'waiting';
        video.updatedAt = new Date().toISOString();
        run.errors++;
        await saveDb();
        break;
      }
      video.radarAnalysisState = 'error';
      video.updatedAt = new Date().toISOString();
      run.errors++;
    }
    run.opportunitiesCreated = created.length;
    await saveDb();
  }

  run.status = 'completed';
  run.completedAt = new Date().toISOString();
  run.durationMs = Date.now() - scanStartedAt;
  await saveDb();

  return { run, opportunities: created };
}


const activeInterestedRadarScans = new Set<string>();

async function drainInterestedRadarAnalysis(ownerId: string) {
  try {
    const result = await runRadarScan(ownerId, { limit: 12, selectedOnly: true });
    // A new Interested action can arrive while this owner scan is already running.
    // If we made progress, run one more pass to pick up newly queued liked sources.
    if ((result?.run?.scanned || 0) > 0) {
      const db = await getDb();
      const pendingLiked = new Set(
        (db.radarDiscoveryFeedback || [])
          .filter((item) => item.ownerId === ownerId && item.decision === 'interesting')
          .map((item) => item.sourceContentId)
      );
      const hasPending = getVideosForOwner(db, ownerId).some(
        (video) => pendingLiked.has(video.id) && !video.radarScannedAt && video.radarAnalysisState === 'waiting'
      );
      if (hasPending) {
        await drainInterestedRadarAnalysis(ownerId);
      }
    }
  } catch (error) {
    console.warn('[Content Radar] Interested analysis queue failed:', ownerId, error);
  }
}

export function queueInterestedRadarAnalysis(ownerId?: string) {
  const id = getDefaultOwnerId(ownerId);
  if (activeInterestedRadarScans.has(id)) {
    return { queued: true, alreadyRunning: true };
  }
  activeInterestedRadarScans.add(id);
  setTimeout(() => {
    void drainInterestedRadarAnalysis(id)
      .finally(() => activeInterestedRadarScans.delete(id));
  }, 0);
  return { queued: true, alreadyRunning: false };
}

export async function getRadarDiscovery(ownerId?: string) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const profile = await getRadarProfile(id);
  const tasteVersion = Math.max(1, Number(profile.tasteVersion || 1));
  const feedback = (db.radarDiscoveryFeedback || []).filter((x) => x.ownerId === id);
  const reviewed = new Set(feedback.map((x) => x.sourceContentId));
  const passed = new Set(
    (db.radarDiscoveryExposures || [])
      .filter((x) => x.ownerId === id && x.tasteVersion === tasteVersion && x.action === 'passed')
      .map((x) => x.sourceContentId)
  );

  const discovered = (db.radarDiscoveryCandidates || [])
    .filter((x) => x.ownerId === id && !reviewed.has(x.sourceContentId || x.videoId) && !passed.has(x.sourceContentId || x.videoId))
    .filter((x) => x.rankedForTasteVersion === tasteVersion && x.eligible === true)
    .sort((a, b) => (b.rankingScore ?? 0) - (a.rankingScore ?? 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((x) => ({
      id: x.sourceContentId || x.videoId,
      sourceType: x.sourceType || 'youtube' as const,
      sourceContentId: x.sourceContentId || x.videoId,
      sourceLabel: x.sourceLabel || 'YouTube',
      title: x.title,
      author: x.author || x.channelTitle,
      authorHandle: x.authorHandle,
      channelTitle: x.channelTitle,
      url: x.url,
      imageUrl: x.imageUrl || x.thumbnail,
      thumbnail: x.thumbnail,
      publishedAt: x.publishedAt,
      summary: x.summary || x.description,
      description: x.description,
      query: x.query,
      rankingScore: x.rankingScore,
      rankingReason: x.rankingReason,
      rankedForTasteVersion: x.rankedForTasteVersion,
      eligible: x.eligible,
      eligibilityReason: x.eligibilityReason,
      keyTopics: x.keyTopics,
      viewCount: x.viewCount,
      likeCount: x.likeCount,
      commentCount: x.commentCount,
      qualityScore: x.qualityScore,
      qualityReason: x.qualityReason,
      qualityConfidence: x.qualityConfidence,
      source: 'external' as const,
    }));

  const discoveredIds = new Set(discovered.map((x) => x.id));
  const local = getVideosForOwner(db, id)
    .filter((v) => !reviewed.has(v.id) && !passed.has(v.id) && !discoveredIds.has(v.id))
    .filter((v) => fallbackCandidateEligibility({
      id: v.id,
      ownerId: id,
      videoId: v.id,
      title: v.title,
      channelTitle: v.channelTitle,
      channelId: v.channelId,
      url: v.url,
      thumbnail: v.thumbnail,
      description: v.description,
      createdAt: v.updatedAt || v.publishedAt || new Date(0).toISOString(),
    }, profile).eligible)
    .sort((a, b) => new Date(b.publishedAt || b.updatedAt || 0).getTime() - new Date(a.publishedAt || a.updatedAt || 0).getTime())
    .map((v) => ({
      id: v.id,
      sourceType: 'youtube' as const,
      sourceContentId: v.id,
      sourceLabel: 'YouTube',
      title: v.title,
      author: v.channelTitle,
      channelTitle: v.channelTitle,
      url: v.url,
      imageUrl: v.thumbnail,
      thumbnail: v.thumbnail,
      publishedAt: v.publishedAt,
      summary: v.description,
      description: v.description,
      source: 'local' as const,
    }));

  return {
    candidates: [...discovered, ...local].slice(0, DISCOVERY_READY_BUFFER_TARGET),
    feedbackCount: feedback.length,
    decisionCount: feedback.length + passed.size,
    interestingCount: feedback.filter((x) => x.decision === 'interesting').length,
    notInterestedCount: feedback.filter((x) => x.decision === 'not_interested').length,
    skipCount: passed.size,
    analysisPendingCount: getVideosForOwner(db, id).filter((v) => v.radarAnalysisState === 'waiting' || v.radarAnalysisState === 'processing').length,
    analysisWaitingCount: getVideosForOwner(db, id).filter((v) => v.radarAnalysisState === 'waiting').length,
    analysisProcessingCount: getVideosForOwner(db, id).filter((v) => v.radarAnalysisState === 'processing').length,
    analysisQueueActive: activeInterestedRadarScans.has(id),
    discoveryRankingActive: activeDiscoveryMaintenance.has(id) || discoveryMaintenanceTimers.has(id),
    discoveryBufferTarget: DISCOVERY_READY_BUFFER_TARGET,
    discoveryLowWatermark: DISCOVERY_LOW_WATERMARK,
    discoveryEmergencyWatermark: DISCOVERY_EMERGENCY_WATERMARK,
    discoveryRerankDebounceMs: DISCOVERY_RERANK_DEBOUNCE_MS,
    minimumSignals: 5,
    externalCount: discovered.length,
    youtubeApiConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
  };
}

export async function saveRadarDiscoveryFeedback(
  ownerId: string | undefined,
  sourceContentId: string,
  decision: RadarDiscoveryFeedback['decision'],
  reason?: RadarDiscoveryFeedback['reason']
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  if (!db.radarDiscoveryFeedback) db.radarDiscoveryFeedback = [];
  const profile = await getRadarProfile(id);
  const tasteVersion = Math.max(1, Number(profile.tasteVersion || 1));
  db.radarDiscoveryFeedback = db.radarDiscoveryFeedback.filter(
    (x) => !(x.ownerId === id && x.sourceContentId === sourceContentId)
  );
  const item: RadarDiscoveryFeedback = {
    id: `rdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerId: id,
    sourceContentId,
    decision,
    reason,
    tasteVersion,
    createdAt: new Date().toISOString(),
  };
  db.radarDiscoveryFeedback.push(item);

  if (decision === 'interesting') {
    const candidate = (db.radarDiscoveryCandidates || []).find(
      (x) => x.ownerId === id && x.videoId === sourceContentId
    );
    const alreadyInCorpus = getVideosForOwner(db, id).some((v) => v.id === sourceContentId);
    if (candidate && !alreadyInCorpus) {
      const now = new Date().toISOString();
      db.videos.push({
        id: candidate.videoId,
        ownerId: id,
        channelId: candidate.channelId || 'youtube-search',
        channelTitle: candidate.channelTitle,
        title: candidate.title,
        url: candidate.url,
        description: candidate.description || '',
        thumbnail: candidate.thumbnail || `https://i.ytimg.com/vi/${candidate.videoId}/hqdefault.jpg`,
        publishedAt: candidate.publishedAt || now,
        status: 'new',
        radarAnalysisState: 'waiting',
        radarAnalysisRequestedAt: now,
        updatedAt: now,
      });
    } else if (alreadyInCorpus) {
      const video = getVideosForOwner(db, id).find((v) => v.id === sourceContentId);
      if (video && !video.radarScannedAt) {
        video.radarAnalysisState = 'waiting';
        video.radarAnalysisRequestedAt = video.radarAnalysisRequestedAt || new Date().toISOString();
        video.updatedAt = new Date().toISOString();
      }
    }
  }

  // Persist feedback immediately. The existing ready queue remains usable so the
  // client can advance without waiting for an LLM rerank. Maintenance runs in background.
  await saveDb();
  return item;
}

export async function saveRadarDiscoveryExposure(
  ownerId: string | undefined,
  sourceContentId: string,
  action: RadarDiscoveryExposure['action']
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const profile = await getRadarProfile(id);
  const tasteVersion = Math.max(1, Number(profile.tasteVersion || 1));
  if (!db.radarDiscoveryExposures) db.radarDiscoveryExposures = [];

  db.radarDiscoveryExposures = db.radarDiscoveryExposures.filter(
    (x) => !(x.ownerId === id && x.sourceContentId === sourceContentId && x.tasteVersion === tasteVersion)
  );

  const item: RadarDiscoveryExposure = {
    id: `rde-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerId: id,
    sourceContentId,
    action,
    tasteVersion,
    createdAt: new Date().toISOString(),
  };
  db.radarDiscoveryExposures.push(item);
  await saveDb();
  return item;
}

export async function completeRadarOnboarding(ownerId?: string) {
  const profile = await getRadarProfile(ownerId);
  const discovery = await getRadarDiscovery(ownerId);
  const decisionCount = discovery.decisionCount ?? discovery.feedbackCount;
  if (decisionCount < discovery.minimumSignals) {
    const err: any = new Error(`Need at least ${discovery.minimumSignals} discovery signals`);
    err.code = 'RADAR_NOT_ENOUGH_SIGNALS';
    err.required = discovery.minimumSignals;
    err.current = decisionCount;
    throw err;
  }
  return saveRadarProfile(ownerId, {
    ...profile,
    onboardingCompletedAt: new Date().toISOString(),
  });
}



function getSkipPreferenceContext(db: Awaited<ReturnType<typeof getDb>>, ownerId: string, tasteVersion?: number) {
  const feedback = (db.radarDiscoveryFeedback || [])
    .filter((x) => x.ownerId === ownerId)
    .filter((x) => !tasteVersion || x.tasteVersion === tasteVersion || (tasteVersion === 1 && !x.tasteVersion))
    .slice(-60);

  const consecutive: RadarDiscoveryFeedback[] = [];
  for (let i = feedback.length - 1; i >= 0; i--) {
    if (feedback[i].decision !== 'not_interested') break;
    consecutive.unshift(feedback[i]);
  }

  const skips = feedback.filter((x) => x.decision === 'not_interested');
  const counts = skips.reduce<Record<string, number>>((acc, item) => {
    const key = item.reason || 'unspecified';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const dominantReasons = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));

  return {
    consecutive,
    recentSkips: skips.slice(-20),
    dominantReasons,
    totalRecentSkips: skips.length,
  };
}

async function generateDiscoveryPlan(profile: RadarProfile): Promise<{
  plan: { youtube: string[]; web: string[]; x: string[] };
  source: 'llm' | 'fallback';
  provider?: string;
  model?: string;
  task: 'radar_discovery_plan:v1';
  error?: string;
}> {
  const db = await getDb();
  const references = (db.radarReferences || [])
    .filter((x) => x.ownerId === profile.ownerId)
    .slice(-10)
    .reverse();
  const referenceContext = references.map((x) => ({
    intent: x.intent,
    summary: x.summary,
    topics: x.topics,
    angles: x.angles,
    title: x.title,
    platform: x.platform,
  }));
  const referenceTopics = references.flatMap((x) => x.topics || []);
  const referenceAngles = references.flatMap((x) => x.angles || []);
  const skipPreferences = getSkipPreferenceContext(db, profile.ownerId, profile.tasteVersion || 1);
  const recentSkipContext = skipPreferences.consecutive.map((x) => {
    const candidate = (db.radarDiscoveryCandidates || []).find(
      (c) => c.ownerId === profile.ownerId && (c.sourceContentId || c.videoId) === x.sourceContentId
    );
    const localVideo = getVideosForOwner(db, profile.ownerId).find((v) => v.id === x.sourceContentId);
    return {
      reason: x.reason || 'unspecified',
      title: candidate?.title || localVideo?.title || x.sourceContentId,
      sourceType: candidate?.sourceType || (localVideo ? 'youtube' : undefined),
      author: candidate?.author || candidate?.channelTitle || localVideo?.channelTitle,
      query: candidate?.query,
      summary: (candidate?.summary || candidate?.description || localVideo?.description || '').slice(0, 280),
    };
  });

  const activeTopics = (profile.topics || []).filter(Boolean);
  const primaryTopic = activeTopics[0] || '';
  const primaryOutputFormat = getRadarPrimaryFormat(profile);
  const secondaryOutputFormats = getRadarSecondaryFormats(profile);
  const formatSearchHint: Record<RadarContentFormat, string> = {
    short_video: 'strong hook visual storytelling concise argument',
    long_video_or_podcast: 'deep dive interview lecture long-form discussion',
    article: 'research analysis essay expert evidence',
    post: 'clear claim discussion thread concise insight',
  };
  const baseFallback = [
    ...activeTopics.slice(0, 4),
    ...(profile.preferredAngles || []).slice(0, 2).map((angle) => `${primaryTopic || 'society'} ${angle}`),
    ...(primaryTopic ? [`${primaryTopic} ${formatSearchHint[primaryOutputFormat]}`] : []),
    ...(primaryTopic ? referenceTopics.slice(0, 3).map((topic) => `${primaryTopic} ${topic}`) : referenceTopics.slice(0, 3)),
    ...(profile.preferredAngles || []).length === 0 && primaryTopic
      ? referenceAngles.slice(0, 2).map((angle) => `${primaryTopic} ${angle}`)
      : [],
  ].filter(Boolean).slice(0, 8);

  const fallbackPlan = {
    youtube: baseFallback,
    web: baseFallback.slice(0, 4),
    x: baseFallback.slice(0, 4),
  };

  try {
    const response = await runLLMTask(profile.ownerId, 'radar_discovery_plan', `Build a multi-source discovery search plan for a creator intelligence system.

CREATOR PROFILE
ACTIVE TOPICS: ${(profile.topics || []).join(', ')}
Preferred angles: ${(profile.preferredAngles || []).join(', ')}
Creator goals: ${(profile.goals || []).join(', ') || 'not specified'}
Primary output format: ${primaryOutputFormat}
Secondary output format preferences: ${secondaryOutputFormats.join(', ') || 'none'}
Additional context: ${profile.description || 'none'}
Avoid: ${(profile.avoid || []).join(', ')}
Custom instructions: ${profile.customInstructions || 'none'}

STRONG MANUAL REFERENCES
${JSON.stringify(referenceContext)}

RECENT CONSECUTIVE SKIPS
${JSON.stringify(recentSkipContext)}

PERSISTENT SKIP PATTERNS
${JSON.stringify({
  dominantReasons: skipPreferences.dominantReasons,
  totalRecentSkips: skipPreferences.totalRecentSkips,
})}

Return ONLY JSON:
{
  "youtube": ["query 1", "query 2"],
  "web": ["query 1", "query 2"],
  "x": ["query 1", "query 2"]
}

Rules:
- YouTube: up to 8 queries optimized for videos, interviews, lectures, documentaries, debates, or strong creator material.
- Web: up to 6 queries optimized for articles, research, essays, reports, studies, and expert commentary.
- X: up to 6 concise queries optimized for current discussion, strong claims, expert threads, and emerging conversations.
- Do not simply duplicate the same wording across all sources; adapt queries to how each source is searched.
- Mix broad and long-tail queries.
- Prefer English plus the creator's apparent language when useful.
- ACTIVE TOPICS are the hard search boundary. Every query must target at least one ACTIVE TOPIC.
- PRIMARY OUTPUT FORMAT is a strong soft preference: favor source material that can become excellent content in that format.
- SECONDARY OUTPUT FORMAT PREFERENCES are weaker soft signals.
- Output formats MUST NOT become source-type restrictions: e.g. an Article preference may still discover YouTube, Web or X source material.
- Manual references may refine angle/style inside ACTIVE TOPICS, but must never broaden discovery into topics that are absent from ACTIVE TOPICS.
- Creator description, old feedback, subscriptions and goals are secondary context and must never re-introduce removed topics.
- Respect Avoid as a hard negative boundary and respect repeated Skip reasons.
- If several recent items were skipped, deliberately broaden or change the search space.
- Focus on substantive, thought-provoking material rather than generic tutorials or motivational content.
- Do not include explanations outside the JSON.`);

    const parsed = parseJson(response.text);
    const clean = (value: unknown, max: number) =>
      Array.isArray(value)
        ? value.map(String).map((x) => x.trim()).filter(Boolean).slice(0, max)
        : [];

    const plan = {
      youtube: clean(parsed?.youtube, 8),
      web: clean(parsed?.web, 6),
      x: clean(parsed?.x, 6),
    };

    if (!plan.youtube.length && !plan.web.length && !plan.x.length) {
      const error = 'LLM returned no usable discovery plan';
      console.warn('[Radar discovery plan]', error);
      return { plan: fallbackPlan, source: 'fallback', task: 'radar_discovery_plan:v1', error };
    }

    return {
      plan: {
        youtube: plan.youtube.length ? plan.youtube : fallbackPlan.youtube,
        web: plan.web.length ? plan.web : fallbackPlan.web,
        x: plan.x.length ? plan.x : fallbackPlan.x,
      },
      source: 'llm',
      provider: response.provider,
      model: response.model,
      task: 'radar_discovery_plan:v1',
    };
  } catch (err: any) {
    const error = err?.message || String(err);
    console.warn('[Radar discovery plan] Failed, using fallback:', error);
    return { plan: fallbackPlan, source: 'fallback', task: 'radar_discovery_plan:v1', error };
  }
}


function normalizeEligibilityText(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
}

function topicTokens(value: string) {
  return normalizeEligibilityText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .map((token) => token.length > 6 ? token.slice(0, 6) : token);
}

function textMatchesConcept(text: string, concept: string) {
  const normalized = normalizeEligibilityText(text);
  const tokens = topicTokens(concept);
  if (!tokens.length) return normalized.includes(normalizeEligibilityText(concept).trim());
  return tokens.some((token) => normalized.includes(token));
}

function assessCandidateQuality(candidate: RadarDiscoveryCandidateRecord) {
  if ((candidate.sourceType || 'youtube') !== 'youtube') {
    return {
      score: 60,
      confidence: 'low' as const,
      reason: 'Quality signals are limited for this source type.',
      hardReject: false,
    };
  }

  const views = typeof candidate.viewCount === 'number' ? Math.max(0, candidate.viewCount) : undefined;
  const likes = typeof candidate.likeCount === 'number' ? Math.max(0, candidate.likeCount) : undefined;
  const comments = typeof candidate.commentCount === 'number' ? Math.max(0, candidate.commentCount) : undefined;
  const publishedAt = candidate.publishedAt ? new Date(candidate.publishedAt).getTime() : NaN;
  const ageDays = Number.isFinite(publishedAt) ? Math.max(1, (Date.now() - publishedAt) / 86_400_000) : undefined;

  if (views === undefined) {
    return {
      score: 55,
      confidence: 'low' as const,
      reason: 'View and engagement statistics are unavailable; quality confidence is limited.',
      hardReject: false,
    };
  }

  let score = 50;
  const reasons: string[] = [];

  if (views >= 100_000) { score += 20; reasons.push('strong reach'); }
  else if (views >= 10_000) { score += 12; reasons.push('solid reach'); }
  else if (views >= 1_000) { score += 4; reasons.push('moderate reach'); }
  else if (views < 100) { score -= 20; reasons.push('very low reach'); }
  else if (views < 500) { score -= 12; reasons.push('low reach'); }
  else { score -= 4; reasons.push('limited reach'); }

  if (views > 0 && likes !== undefined) {
    const likeRate = likes / views;
    if (likeRate >= 0.04) { score += 8; reasons.push('strong like rate'); }
    else if (likeRate >= 0.02) { score += 4; reasons.push('healthy like rate'); }
    else if (likeRate < 0.005) { score -= 4; reasons.push('weak like rate'); }
  }

  if (views > 0 && comments !== undefined) {
    const commentRate = comments / views;
    if (commentRate >= 0.005) { score += 6; reasons.push('strong discussion'); }
    else if (commentRate >= 0.001) { score += 3; reasons.push('active discussion'); }
  }

  if (ageDays !== undefined) {
    const viewsPerDay = views / ageDays;
    if (ageDays <= 30 && viewsPerDay >= 100) { score += 8; reasons.push('good recent velocity'); }
    else if (ageDays <= 90 && viewsPerDay >= 30) { score += 4; reasons.push('healthy velocity'); }
    if (ageDays > 180 && views < 300) { score -= 8; reasons.push('old content with very low reach'); }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const knownSignals = [views, likes, comments, ageDays].filter((value) => value !== undefined).length;
  const confidence = knownSignals >= 4 ? 'high' as const : knownSignals >= 2 ? 'medium' as const : 'low' as const;
  const hardReject = confidence !== 'low' && score < 40;

  return {
    score,
    confidence,
    reason: reasons.length ? reasons.join(', ') : 'Limited quality signals.',
    hardReject,
  };
}

function fallbackCandidateEligibility(candidate: RadarDiscoveryCandidateRecord, profile: RadarProfile) {
  const text = [
    candidate.title,
    candidate.summary,
    candidate.description,
    candidate.query,
    ...(candidate.keyTopics || []),
  ].filter(Boolean).join(' ');

  const topics = normalizedList(profile.topics);
  const avoid = normalizedList(profile.avoid);
  const blockedBy = avoid.find((concept) => textMatchesConcept(text, concept));
  if (blockedBy) {
    return { eligible: false, reason: `Matches Avoid: ${blockedBy}` };
  }
  if (!topics.length) return { eligible: true, reason: 'No active topic boundary' };

  const matchedTopic = topics.find((topic) => textMatchesConcept(text, topic));
  return matchedTopic
    ? { eligible: true, reason: `Matches active topic: ${matchedTopic}` }
    : { eligible: false, reason: 'No substantive match to current active topics' };
}

function deriveFallbackKeyTopics(candidate: RadarDiscoveryCandidateRecord, profile: RadarProfile): string[] {
  const text = `${candidate.title || ''} ${candidate.description || ''}`.toLowerCase();
  const matched = (profile.topics || []).filter(topic => text.includes(topic.toLowerCase())).slice(0, 3);
  const titleParts = String(candidate.title || '')
    .split(/[|:—–-]/)
    .map(part => part.trim())
    .filter(part => part.length >= 4 && part.length <= 64);
  const combined = [...matched, ...titleParts];
  return Array.from(new Set(combined)).slice(0, 5);
}

async function rankRadarDiscoveryCandidates(ownerId: string, limit = 24, options?: { rerankExisting?: boolean }) {
  const db = await getDb();
  const profile = await getRadarProfile(ownerId);
  const references = (db.radarReferences || []).filter((x) => x.ownerId === ownerId).slice(-8).reverse();
  const tasteVersion = Math.max(1, Number(profile.tasteVersion || 1));
  const feedback = (db.radarDiscoveryFeedback || [])
    .filter((x) => x.ownerId === ownerId)
    .filter((x) => x.tasteVersion === tasteVersion || (tasteVersion === 1 && !x.tasteVersion))
    .slice(-60);
  const skipPreferences = getSkipPreferenceContext(db, ownerId, tasteVersion);
  const handledIds = new Set([
    ...(db.radarDiscoveryFeedback || [])
      .filter((x) => x.ownerId === ownerId)
      .map((x) => x.sourceContentId),
    ...(db.radarDiscoveryExposures || [])
      .filter((x) => x.ownerId === ownerId && (x.tasteVersion === tasteVersion || (tasteVersion === 1 && !x.tasteVersion)))
      .map((x) => x.sourceContentId),
  ]);
  const allCandidates = (db.radarDiscoveryCandidates || [])
    .filter((x) => x.ownerId === ownerId)
    .filter((x) => !handledIds.has(x.sourceContentId || x.videoId))
    .filter((x) => options?.rerankExisting || !x.rankedAt)
    .slice(0, limit);
  if (!allCandidates.length) return { source: 'none' as const, candidates: 0, ranked: 0 };

  const knownTitles = new Map<string, string>();
  for (const c of db.radarDiscoveryCandidates || []) {
    if (c.ownerId === ownerId) knownTitles.set(c.sourceContentId || c.videoId, c.title);
  }
  for (const v of getVideosForOwner(db, ownerId)) knownTitles.set(v.id, v.title);

  const feedbackContext = feedback.map((x) => ({
    decision: x.decision,
    reason: x.reason,
    title: knownTitles.get(x.sourceContentId) || x.sourceContentId,
  }));

  const payload = allCandidates.map((x) => {
    const quality = assessCandidateQuality(x);
    return {
      id: x.sourceContentId || x.videoId,
      sourceType: x.sourceType || 'youtube',
      title: x.title,
      author: x.author || x.channelTitle,
      summary: (x.summary || x.description || '').slice(0, 500),
      query: x.query,
      publishedAt: x.publishedAt,
      viewCount: x.viewCount,
      likeCount: x.likeCount,
      commentCount: x.commentCount,
      qualityScore: quality.score,
      qualityConfidence: quality.confidence,
      qualityReason: quality.reason,
    };
  });

  try {
    const response = await runLLMTask(ownerId, 'radar_discovery_ranking', `Rank candidate content items from multiple sources for a personalized editorial discovery feed.

CREATOR PROFILE
ACTIVE TOPICS: ${(profile.topics || []).join(', ')}
Preferred angles: ${(profile.preferredAngles || []).join(', ')}
Creator goals: ${(profile.goals || []).join(', ') || 'not specified'}
Primary output format: ${getRadarPrimaryFormat(profile)}
Secondary output format preferences: ${getRadarSecondaryFormats(profile).join(', ') || 'none'}
Additional context: ${profile.description || 'none'}
Avoid: ${(profile.avoid || []).join(', ') || 'none'}
Custom instructions: ${profile.customInstructions || 'none'}

STRONG MANUAL REFERENCES
${JSON.stringify(references.map((x) => ({
  intent: x.intent,
  title: x.title,
  summary: x.summary,
  topics: x.topics,
  angles: x.angles,
})))}

PAST FEEDBACK
${JSON.stringify(feedbackContext)}

PERSISTENT NEGATIVE PREFERENCES
${JSON.stringify({
  dominantReasons: skipPreferences.dominantReasons,
  totalRecentSkips: skipPreferences.totalRecentSkips,
})}

CANDIDATES
${JSON.stringify(payload)}

Return ONLY JSON:
{
  "rankings": [
    {
      "id":"content-id",
      "eligible":true,
      "eligibilityReason":"why this is or is not substantively inside the ACTIVE TOPICS boundary",
      "score":0,
      "reason":"2-3 concise sentences explaining why this specifically fits the creator",
      "keyTopics":["specific topic 1","specific topic 2","specific topic 3"]
    }
  ]
}

Rules:
- ACTIVE TOPICS are a hard eligibility boundary, not a soft preference.
- eligible=true ONLY when the candidate has a substantive connection to at least one ACTIVE TOPIC.
- Avoid is also a hard boundary: a substantive conflict with Avoid means eligible=false.
- Manual references, old feedback, creator description, goals, and preferred angles MUST NOT make an off-topic candidate eligible.
- The creator description is secondary context and MUST NOT re-introduce topics that are absent from ACTIVE TOPICS.
- A subscription/channel source is only a source pool; it does not bypass topic eligibility.
- PRIMARY OUTPUT FORMAT is a strong soft ranking signal after topic eligibility: reward source material that can become strong content in that format.
- SECONDARY OUTPUT FORMAT PREFERENCES are weaker ranking signals.
- Output formats never change topic eligibility and never restrict source type.
- QUALITY is a separate gate after topic eligibility. Consider reach, engagement, age/velocity, source credibility signals, and the supplied qualityScore/confidence.
- Very low-quality or weakly validated material must not rank highly just because the topic matches.
- Low views alone are not an automatic rejection for a niche expert, but old content with very low reach and weak engagement should normally fail the quality gate.
- score is integer 0-100. Ineligible candidates should score below 40.
- Manual references are strong ranking signals only after topic eligibility is satisfied.
- "interesting" feedback is positive; "not_interested" feedback is negative; neutral Next/Skip exposures are not taste feedback.
- Repeated Not interested reasons are durable preference signals: apply them consistently across candidates, not only to near-duplicates.
- Reward unusual, substantive, discussion-worthy material matching the user's editorial taste.
- Penalize generic tutorials, repetitive listicles, obvious clickbait, and topics resembling skipped material.
- reason must be a personalized user-facing explanation in Russian, usually 2-3 concise sentences.
- keyTopics must contain 2-5 concise, concrete topics actually present in the candidate; use the candidate's language when natural.
- Explicitly connect the candidate to the creator's selected topics, preferred angles, free-form description, manual references, or prior Interesting/Skip signals when those signals are relevant.
- Avoid generic phrases like "подходит под ваши интересы" without saying what matched.
- If the candidate conflicts with Avoid or repeated Skip reasons, lower the score and explain the mismatch.
- Return one item for every candidate id.`
    );

    const parsed = parseJson(response.text);
    const rankings = Array.isArray(parsed?.rankings) ? parsed.rankings : [];
    const byId = new Map(rankings.map((x: any) => [String(x.id), x]));
    const now = new Date().toISOString();
    for (const candidate of allCandidates) {
      const ranked: any = byId.get(candidate.sourceContentId || candidate.videoId);
      const fallbackEligibility = fallbackCandidateEligibility(candidate, profile);
      const quality = assessCandidateQuality(candidate);
      candidate.qualityScore = quality.score;
      candidate.qualityReason = quality.reason;
      candidate.qualityConfidence = quality.confidence;
      const topicEligible = typeof ranked?.eligible === 'boolean' ? ranked.eligible : fallbackEligibility.eligible;
      candidate.eligible = topicEligible && !quality.hardReject;
      candidate.eligibilityReason = !topicEligible
        ? (String(ranked?.eligibilityReason || '').trim() || fallbackEligibility.reason)
        : quality.hardReject
          ? `Quality gate: ${quality.reason}`
          : (String(ranked?.eligibilityReason || '').trim() || fallbackEligibility.reason);
      candidate.rankingScore = Math.max(0, Math.min(100, Math.round(Number(ranked?.score) || 0)));
      candidate.rankingScore = Math.round(candidate.rankingScore * 0.8 + quality.score * 0.2);
      if (!candidate.eligible) candidate.rankingScore = Math.min(candidate.rankingScore, 39);
      candidate.rankingReason = String(ranked?.reason || '').trim() || 'Подходит под выбранные интересы и сигналы Radar.';
      const rankedTopics = Array.isArray(ranked?.keyTopics)
        ? ranked.keyTopics.map(String).map((topic: string) => topic.trim()).filter(Boolean).slice(0, 5)
        : [];
      candidate.keyTopics = rankedTopics.length >= 2
        ? rankedTopics
        : deriveFallbackKeyTopics(candidate, profile);
      candidate.rankedForTasteVersion = tasteVersion;
      candidate.rankedAt = now;
    }
    await saveDb();
    return { source: 'llm' as const, provider: response.provider, model: response.model, candidates: allCandidates.length, ranked: allCandidates.length };
  } catch (err: any) {
    const error = err?.message || String(err);
    console.warn('[Radar ranking] Failed:', error);
    const now = new Date().toISOString();
    for (const candidate of allCandidates) {
      const fallback = fallbackCandidateEligibility(candidate, profile);
      const quality = assessCandidateQuality(candidate);
      candidate.qualityScore = quality.score;
      candidate.qualityReason = quality.reason;
      candidate.qualityConfidence = quality.confidence;
      candidate.eligible = fallback.eligible && !quality.hardReject;
      candidate.eligibilityReason = !fallback.eligible
        ? fallback.reason
        : quality.hardReject
          ? `Quality gate: ${quality.reason}`
          : fallback.reason;
      candidate.rankingScore = candidate.eligible ? Math.round(48 + quality.score * 0.2) : 0;
      candidate.rankingReason = fallback.eligible
        ? 'Кандидат проходит базовый фильтр актуальных тем Radar.'
        : 'Кандидат не соответствует текущим активным темам Radar.';
      candidate.keyTopics = deriveFallbackKeyTopics(candidate, profile);
      candidate.rankedForTasteVersion = tasteVersion;
      candidate.rankedAt = now;
    }
    await saveDb();
    return { source: 'failed' as const, candidates: allCandidates.length, ranked: allCandidates.length, error };
  }
}

export async function getRadarDiscoveryRuns(ownerId?: string, limit = 20) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  return (db.radarDiscoveryRuns || [])
    .filter((run) => run.ownerId === id)
    .sort((x, y) => new Date(y.startedAt).getTime() - new Date(x.startedAt).getTime())
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function refreshRadarDiscovery(ownerId?: string, options?: { perQuery?: number }) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  if (!db.radarDiscoveryRuns) db.radarDiscoveryRuns = [];
  const runStarted = Date.now();
  const runId = `radar-discovery-${runStarted}-${Math.random().toString(36).slice(2, 7)}`;
  const run: RadarDiscoveryRun = {
    id: runId,
    ownerId: id,
    startedAt: new Date(runStarted).toISOString(),
    status: 'running',
    added: 0,
    search: [],
  };
  db.radarDiscoveryRuns.unshift(run);
  db.radarDiscoveryRuns = db.radarDiscoveryRuns.slice(0, 100);
  await saveDb();

  logDiscoveryEvent('radar_discovery_start', {
    runId,
    ownerId: id,
    youtubeApiConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
  });

  try {
    const profile = await getRadarProfile(id);

    const queryStarted = Date.now();
    const queryGeneration = await generateDiscoveryPlan(profile);
    const queryDurationMs = Date.now() - queryStarted;
    const plan = queryGeneration.plan;
    const queries = plan.youtube;
    const totalQueryCount = plan.youtube.length + plan.web.length + plan.x.length;
    run.queryGeneration = {
      source: queryGeneration.source,
      provider: queryGeneration.provider,
      model: queryGeneration.model,
      task: queryGeneration.task,
      queryCount: totalQueryCount,
      plan,
      error: queryGeneration.error,
      durationMs: queryDurationMs,
    };
    logDiscoveryEvent('radar_discovery_plan', {
      runId,
      ownerId: id,
      source: queryGeneration.source,
      provider: queryGeneration.provider,
      model: queryGeneration.model,
      task: queryGeneration.task,
      queryCount: totalQueryCount,
      plan,
      durationMs: queryDurationMs,
      error: queryGeneration.error,
    });

    if (!db.radarDiscoveryCandidates) db.radarDiscoveryCandidates = [];

    const perQuery = Math.max(2, Math.min(options?.perQuery || 5, 10));
    const existing = new Set(
      db.radarDiscoveryCandidates.filter((x) => x.ownerId === id).map((x) => x.videoId)
    );
    const feedbackIds = new Set(
      (db.radarDiscoveryFeedback || []).filter((x) => x.ownerId === id).map((x) => x.sourceContentId)
    );

    let added = 0;
    const search: RadarDiscoveryRun['search'] = [];

    const subscriptionSources = (db.radarYouTubeSubscriptions || [])
      .filter((x) => x.ownerId === id && x.enabled)
      .slice(0, 12);

    for (const source of subscriptionSources) {
      try {
        const channelStarted = Date.now();
        const channel = await fetchChannelVideos(source.channelId);
        let addedFromChannel = 0;
        for (const video of channel.videos.slice(0, 2)) {
          if (existing.has(video.id) || feedbackIds.has(video.id)) continue;
          db.radarDiscoveryCandidates.push({
            id: `rdc-${video.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ownerId: id,
            videoId: video.id,
            title: video.title,
            channelTitle: video.channelTitle,
            channelId: video.channelId,
            url: video.url,
            thumbnail: video.thumbnail,
            publishedAt: video.publishedAt,
            description: video.description,
            viewCount: video.viewCount,
            likeCount: video.likeCount,
            commentCount: video.commentCount,
            query: `youtube-subscription:${source.title}`,
            createdAt: new Date().toISOString(),
          });
          existing.add(video.id);
          added++;
          addedFromChannel++;
          if (added >= 30) break;
        }
        logDiscoveryEvent('radar_discovery_subscription_source', {
          runId,
          ownerId: id,
          channelId: source.channelId,
          channelTitle: source.title,
          found: channel.videos.length,
          added: addedFromChannel,
          durationMs: Date.now() - channelStarted,
        });
      } catch (err: any) {
        logDiscoveryEvent('radar_discovery_subscription_error', {
          runId,
          ownerId: id,
          channelId: source.channelId,
          error: err?.message || String(err),
        });
      }
      if (added >= 30) break;
    }

    const enabledSources = new Set<'youtube' | 'web' | 'x'>(
      profile.discoverySources?.length ? profile.discoverySources : ['youtube', 'web', 'x']
    );
    const allSourcePlans: Array<{ sourceType: 'youtube' | 'web' | 'x'; queries: string[] }> = [
      { sourceType: 'youtube', queries: plan.youtube },
      { sourceType: 'web', queries: plan.web },
      { sourceType: 'x', queries: plan.x },
    ];
    const sourcePlans = allSourcePlans.filter(sourcePlan => enabledSources.has(sourcePlan.sourceType));

    for (const sourcePlan of sourcePlans) {
      const adapter = getDiscoverySourceAdapter(sourcePlan.sourceType);
      if (!adapter.isConfigured() && sourcePlan.sourceType !== 'youtube') {
        logDiscoveryEvent('radar_discovery_source_skipped', {
          runId,
          ownerId: id,
          sourceType: sourcePlan.sourceType,
          reason: 'not_configured',
          queryCount: sourcePlan.queries.length,
        });
        continue;
      }

      for (const query of sourcePlan.queries) {
        const searchStarted = Date.now();
        const result = await adapter.search({
          ownerId: id,
          sourceType: sourcePlan.sourceType,
          query,
          limit: perQuery,
        });
        let addedForQuery = 0;

        for (const candidate of result.candidates) {
          const contentId = candidate.sourceContentId || candidate.videoId;
          if (existing.has(contentId) || feedbackIds.has(contentId)) continue;
          db.radarDiscoveryCandidates.push(candidate);
          existing.add(contentId);
          added++;
          addedForQuery++;
          if (added >= 30) break;
        }

        const item = {
          sourceType: sourcePlan.sourceType,
          query,
          provider: result.provider,
          found: result.candidates.length,
          added: addedForQuery,
          configured: result.configured,
          error: result.error,
          reasonCode: result.reasonCode,
          primaryProvider: result.primaryProvider,
          fallbackProvider: result.fallbackProvider,
          recovered: result.recovered,
          durationMs: Date.now() - searchStarted,
        };
        search.push(item);
        logDiscoveryEvent('radar_discovery_search', {
          runId,
          ownerId: id,
          ...item,
        });

        if (added >= 30) break;
      }

      if (added >= 30) break;
    }

    run.search = search;
    run.added = added;

    const youtubeCandidatesMissingStats = db.radarDiscoveryCandidates
      .filter((candidate) =>
        candidate.ownerId === id &&
        (!candidate.sourceType || candidate.sourceType === 'youtube') &&
        Boolean(candidate.videoId) &&
        (
          typeof candidate.viewCount !== 'number' ||
          typeof candidate.likeCount !== 'number' ||
          typeof candidate.commentCount !== 'number'
        )
      )
      .slice(0, 50);

    if (youtubeCandidatesMissingStats.length) {
      const statItems = youtubeCandidatesMissingStats.map((candidate) => ({
        id: candidate.videoId,
        title: candidate.title,
        url: candidate.url,
        publishedAt: candidate.publishedAt || new Date().toISOString(),
        description: candidate.description || '',
        thumbnail: candidate.thumbnail || `https://i.ytimg.com/vi/${candidate.videoId}/hqdefault.jpg`,
        channelId: candidate.channelId || 'youtube',
        channelTitle: candidate.channelTitle || 'YouTube',
        viewCount: candidate.viewCount,
        likeCount: candidate.likeCount,
        commentCount: candidate.commentCount,
      }));
      await enrichYouTubeVideoStatistics(statItems);
      const statsById = new Map(statItems.map(item => [item.id, item]));
      for (const candidate of youtubeCandidatesMissingStats) {
        const stats = statsById.get(candidate.videoId);
        if (!stats) continue;
        candidate.viewCount = stats.viewCount;
        candidate.likeCount = stats.likeCount;
        candidate.commentCount = stats.commentCount;
      }
    }

    await saveDb();

    const rankingStarted = Date.now();
    const ranking = await rankRadarDiscoveryCandidates(id, 24);
    const rankingDurationMs = Date.now() - rankingStarted;
    run.ranking = {
      task: 'radar_discovery_ranking:v1',
      ...ranking,
      durationMs: rankingDurationMs,
    };
    logDiscoveryEvent('radar_discovery_ranking', {
      runId,
      ownerId: id,
      task: 'radar_discovery_ranking:v1',
      ...ranking,
      durationMs: rankingDurationMs,
    });

    run.status = 'completed';
    run.completedAt = new Date().toISOString();
    run.durationMs = Date.now() - runStarted;
    await saveDb();

    logDiscoveryEvent('radar_discovery_complete', {
      runId,
      ownerId: id,
      added,
      queryCount: totalQueryCount,
      sourceQueryCounts: { youtube: plan.youtube.length, web: plan.web.length, x: plan.x.length },
      searchFound: search.reduce((sum, item) => sum + item.found, 0),
      searchAdded: search.reduce((sum, item) => sum + item.added, 0),
      rankingSource: ranking.source,
      rankingCandidates: ranking.candidates,
      rankingRanked: ranking.ranked,
      durationMs: run.durationMs,
    });

    return {
      runId,
      added,
      queries,
      plan,
      youtubeApiConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
      queryGeneration: { ...queryGeneration, queries },
      search,
      ranking: {
        task: 'radar_discovery_ranking:v1',
        ...ranking,
      },
      discovery: await getRadarDiscovery(id),
    };
  } catch (err: any) {
    const error = err?.message || String(err);
    run.status = 'failed';
    run.error = error;
    run.completedAt = new Date().toISOString();
    run.durationMs = Date.now() - runStarted;
    await saveDb();
    console.error(JSON.stringify({
      severity: 'ERROR',
      component: 'content-radar',
      event: 'radar_discovery_failed',
      timestamp: new Date().toISOString(),
      runId,
      ownerId: id,
      error,
      durationMs: run.durationMs,
    }));
    throw err;
  }
}


function detectReferenceKind(value: string): RadarReferenceSignal['kind'] {
  const v = value.trim();
  if (extractVideoId(v)) return 'youtube_video';
  if (/youtube\.com\/(?:@|channel\/|c\/|user\/)/i.test(v) || /^@[A-Za-z0-9._-]+$/.test(v)) return 'youtube_channel';
  if (/^https?:\/\//i.test(v)) return 'social_url';
  return 'text';
}

function detectPlatform(value: string): string | undefined {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
    if (host.includes('reddit.com')) return 'reddit';
    if (host.includes('t.me') || host.includes('telegram.me')) return 'telegram';
    return host;
  } catch {
    return undefined;
  }
}

async function analyzeReference(ownerId: string, input: string, title?: string) {
  try {
    const response = await runLLMTask(ownerId, 'radar_reference_analysis', `Analyze this user-provided content reference for a personalized content discovery system.

TITLE
${title || 'none'}

REFERENCE
${input.slice(0, 12000)}

Return ONLY JSON:
{
  "summary":"one sentence",
  "topics":["topic"],
  "angles":["angle"]
}

Rules:
- topics: 1-5 concise themes.
- angles: 1-5 editorial patterns such as myth-busting, cultural conflict, counterintuitive claim, personal story, research, debate.
- Do not invent facts not present in the reference.`
    );
    const parsed = parseJson(response.text);
    return {
      summary: String(parsed?.summary || '').trim(),
      topics: Array.isArray(parsed?.topics) ? parsed.topics.map(String).filter(Boolean).slice(0, 5) : [],
      angles: Array.isArray(parsed?.angles) ? parsed.angles.map(String).filter(Boolean).slice(0, 5) : [],
    };
  } catch {
    return { summary: '', topics: [] as string[], angles: [] as string[] };
  }
}

export async function getRadarReferences(ownerId?: string) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  return (db.radarReferences || [])
    .filter((x) => x.ownerId === id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function addRadarReference(
  ownerId: string | undefined,
  input: { value: string; intent?: RadarReferenceSignal['intent'] }
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  if (!db.radarReferences) db.radarReferences = [];
  if (!db.radarDiscoveryCandidates) db.radarDiscoveryCandidates = [];
  if (!db.radarDiscoveryFeedback) db.radarDiscoveryFeedback = [];

  const value = String(input.value || '').trim();
  if (!value) throw new Error('Reference is empty');
  const currentProfile = await getRadarProfile(id);
  const nextTasteVersion = Math.max(1, Number(currentProfile.tasteVersion || 1)) + 1;
  const intent = input.intent || 'more_like_this';
  const kind = detectReferenceKind(value);
  const platform = detectPlatform(value);

  let title: string | undefined;
  let sourceContentId: string | undefined;
  let channelId: string | undefined;
  let analysisInput = value;

  if (kind === 'youtube_video') {
    const videoId = extractVideoId(value)!;
    const video = await fetchSingleVideoInfo(videoId);
    title = video.title;
    sourceContentId = video.id;
    channelId = video.channelId;
    analysisInput = `${video.title}\n${video.description || ''}\n${video.channelTitle}`;

    const exists = getVideosForOwner(db, id).some((v) => v.id === video.id);
    if (!exists) {
      db.videos.push({
        id: video.id,
        ownerId: id,
        channelId: video.channelId,
        channelTitle: video.channelTitle,
        title: video.title,
        url: video.url,
        description: video.description || '',
        thumbnail: video.thumbnail,
        publishedAt: video.publishedAt,
        status: 'new',
        updatedAt: new Date().toISOString(),
      });
    }

    db.radarDiscoveryFeedback = db.radarDiscoveryFeedback.filter(
      (x) => !(x.ownerId === id && x.sourceContentId === video.id)
    );
    db.radarDiscoveryFeedback.push({
      id: `rdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ownerId: id,
      sourceContentId: video.id,
      decision: 'interesting',
      tasteVersion: nextTasteVersion,
      createdAt: new Date().toISOString(),
    });
  }

  if (kind === 'youtube_channel') {
    const channel = await resolveChannelId(value);
    title = channel.title;
    channelId = channel.channelId;
    const channelVideos = await fetchChannelVideos(channel.channelId);
    const sample = channelVideos.videos.slice(0, 6);
    analysisInput = `${channel.title}\n${sample.map((v) => v.title).join('\n')}`;

    const existingCandidates = new Set(
      db.radarDiscoveryCandidates.filter((x) => x.ownerId === id).map((x) => x.videoId)
    );
    for (const video of sample) {
      if (existingCandidates.has(video.id)) continue;
      db.radarDiscoveryCandidates.push({
        id: `rdc-${video.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ownerId: id,
        sourceType: 'youtube',
        sourceContentId: video.id,
        sourceLabel: 'YouTube',
        author: video.channelTitle,
        imageUrl: video.thumbnail,
        summary: video.description,
        videoId: video.id,
        title: video.title,
        channelTitle: video.channelTitle,
        channelId: video.channelId,
        url: video.url,
        thumbnail: video.thumbnail,
        publishedAt: video.publishedAt,
        description: video.description,
        query: `manual-channel:${channel.title}`,
        createdAt: new Date().toISOString(),
      });
      existingCandidates.add(video.id);
    }
  }

  const analysis = await analyzeReference(id, analysisInput, title);
  const reference: RadarReferenceSignal = {
    id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerId: id,
    kind,
    value,
    intent,
    platform,
    title,
    summary: analysis.summary,
    topics: analysis.topics,
    angles: analysis.angles,
    sourceContentId,
    channelId,
    createdAt: new Date().toISOString(),
  };
  db.radarReferences.unshift(reference);
  if (!db.radarProfiles) db.radarProfiles = {};
  db.radarProfiles[id] = {
    ...currentProfile,
    tasteVersion: nextTasteVersion,
    updatedAt: new Date().toISOString(),
  };
  invalidateOwnerDiscoveryCandidates(db, id, { clearUnreviewed: false });
  logDiscoveryEvent('radar_reference_changed_taste_context', {
    ownerId: id,
    previousTasteVersion: currentProfile.tasteVersion || 1,
    tasteVersion: nextTasteVersion,
    referenceKind: reference.kind,
  });
  await saveDb();
  return reference;
}


export async function getRadarYouTubeSubscriptions(ownerId?: string) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  return (db.radarYouTubeSubscriptions || [])
    .filter((x) => x.ownerId === id)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function importRadarYouTubeSubscriptions(
  ownerId: string | undefined,
  items: Array<Partial<RadarYouTubeSubscription>>
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  if (!db.radarYouTubeSubscriptions) db.radarYouTubeSubscriptions = [];
  const now = new Date().toISOString();

  for (const raw of items.slice(0, 500)) {
    const channelId = String(raw.channelId || '').trim();
    if (!channelId) continue;
    const existing = db.radarYouTubeSubscriptions.find((x) => x.ownerId === id && x.channelId === channelId);
    if (existing) {
      existing.title = String(raw.title || existing.title || channelId);
      existing.description = typeof raw.description === 'string' ? raw.description : existing.description;
      existing.thumbnail = typeof raw.thumbnail === 'string' ? raw.thumbnail : existing.thumbnail;
      existing.importedAt = now;
      continue;
    }
    db.radarYouTubeSubscriptions.push({
      ownerId: id,
      channelId,
      title: String(raw.title || channelId),
      description: typeof raw.description === 'string' ? raw.description : '',
      thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : undefined,
      importedAt: now,
      enabled: true,
    });
  }

  await saveDb();
  return getRadarYouTubeSubscriptions(id);
}


async function runDiscoveryFeedbackMaintenance(ownerId: string, negative: boolean) {
  const db = await getDb();
  const profile = await getRadarProfile(ownerId);
  const discovery = await getRadarDiscovery(ownerId);
  const negativeContext = getSkipPreferenceContext(db, ownerId, profile.tasteVersion || 1);
  const readyCount = discovery.candidates.length;
  const emergencyBuffer = readyCount <= DISCOVERY_EMERGENCY_WATERMARK;
  const lowBuffer = readyCount <= DISCOVERY_LOW_WATERMARK;
  const negativeMilestone = negative && negativeContext.consecutive.length >= 5 && negativeContext.consecutive.length % 5 === 0;

  if (emergencyBuffer || lowBuffer || negativeMilestone) {
    logDiscoveryEvent('radar_discovery_maintenance_refresh', {
      ownerId,
      readyCount,
      emergencyBuffer,
      lowBuffer,
      negativeMilestone,
    });
    await refreshRadarDiscovery(ownerId, {
      perQuery: emergencyBuffer ? 8 : lowBuffer ? 6 : 4,
    });
    return;
  }

  // Reorder the already-fetched buffer once per debounced feedback burst.
  await rankRadarDiscoveryCandidates(ownerId, DISCOVERY_READY_BUFFER_TARGET, { rerankExisting: true });
}

function scheduleDiscoveryFeedbackMaintenance(ownerId: string, delayMs = DISCOVERY_RERANK_DEBOUNCE_MS) {
  const existing = discoveryMaintenanceTimers.get(ownerId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    discoveryMaintenanceTimers.delete(ownerId);
    if (activeDiscoveryMaintenance.has(ownerId)) return;
    activeDiscoveryMaintenance.add(ownerId);
    void drainDiscoveryFeedbackMaintenance(ownerId);
  }, delayMs);

  discoveryMaintenanceTimers.set(ownerId, timer);
}

async function drainDiscoveryFeedbackMaintenance(ownerId: string) {
  let passCount = 0;
  try {
    while (
      passCount < DISCOVERY_MAX_RERANK_PASSES_PER_BURST &&
      pendingDiscoveryMaintenance.has(ownerId)
    ) {
      const pending = pendingDiscoveryMaintenance.get(ownerId)!;
      pendingDiscoveryMaintenance.delete(ownerId);
      passCount += 1;
      await runDiscoveryFeedbackMaintenance(ownerId, pending.negative);
    }
  } catch (error) {
    console.warn('[Content Radar] Discovery feedback maintenance failed:', ownerId, error);
  } finally {
    activeDiscoveryMaintenance.delete(ownerId);

    // Signals that arrived during the second pass are kept and folded into the
    // next debounced burst instead of causing an unbounded rerank chain.
    if (pendingDiscoveryMaintenance.has(ownerId)) {
      scheduleDiscoveryFeedbackMaintenance(ownerId);
    }
  }
}

export function queueRadarDiscoveryFeedbackMaintenance(ownerId: string | undefined, decision: 'interesting' | 'not_interested') {
  const id = getDefaultOwnerId(ownerId);
  const previous = pendingDiscoveryMaintenance.get(id);
  pendingDiscoveryMaintenance.set(id, {
    negative: Boolean(previous?.negative || decision === 'not_interested'),
  });

  if (activeDiscoveryMaintenance.has(id)) {
    return {
      queued: true,
      alreadyRunning: true,
      catchUpQueued: true,
      debounceMs: DISCOVERY_RERANK_DEBOUNCE_MS,
    };
  }

  // Trailing-edge debounce: a rapid click burst becomes one rerank over the
  // latest persisted feedback state instead of one LLM call per click.
  scheduleDiscoveryFeedbackMaintenance(id);
  return {
    queued: true,
    alreadyRunning: false,
    debounced: true,
    debounceMs: DISCOVERY_RERANK_DEBOUNCE_MS,
  };
}

export async function maybeExpandDiscoveryAfterSkips(ownerId?: string) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const profile = await getRadarProfile(id);
  const recentSkips = getSkipPreferenceContext(db, id, profile.tasteVersion || 1).consecutive;
  const discovery = await getRadarDiscovery(id);
  const queueEmpty = discovery.candidates.length === 0;
  const skipMilestone = recentSkips.length >= 5 && recentSkips.length % 5 === 0;

  if (!queueEmpty && !skipMilestone) {
    return {
      expanded: false,
      consecutiveSkips: recentSkips.length,
      queueEmpty: false,
      discovery,
    };
  }

  const result = await refreshRadarDiscovery(id, { perQuery: queueEmpty ? 6 : 4 });
  return {
    expanded: true,
    consecutiveSkips: recentSkips.length,
    queueEmpty,
    reason: queueEmpty ? 'queue_empty' : 'skip_milestone',
    ...result,
  };
}


export function resolveRadarOpportunityOutputFormat(
  profile: RadarProfile,
  opportunity: RadarOpportunity,
  requestedFormat?: string
): RadarContentFormat {
  const selected = normalizeRadarContentFormats(profile.contentFormats);
  if (requestedFormat) {
    const requested = requestedFormat as RadarContentFormat;
    if (!RADAR_CONTENT_FORMATS.includes(requested)) {
      const err: any = new Error('Invalid content format');
      err.code = 'INVALID_RADAR_CONTENT_FORMAT';
      throw err;
    }
    if (selected.length && !selected.includes(requested)) {
      const err: any = new Error('Content format is not selected in My Radar');
      err.code = 'RADAR_CONTENT_FORMAT_NOT_SELECTED';
      throw err;
    }
    return requested;
  }

  if (opportunity.recommendedFormat && (!selected.length || selected.includes(opportunity.recommendedFormat))) {
    return opportunity.recommendedFormat;
  }
  return selected[0] || 'short_video';
}

function buildRadarScriptPrompt(
  profile: RadarProfile,
  opportunity: RadarOpportunity,
  feedback: RadarScriptFeedback[],
  outputFormat: RadarContentFormat
) {
  const primaryFormat = outputFormat;
  const formatGuidance = primaryFormat === 'long_video_or_podcast'
    ? 'Write a structured long-form video/podcast script outline with enough material for roughly 8-15 minutes.'
    : primaryFormat === 'article'
      ? 'Write a structured article draft with a clear opening, developed sections, and a concise conclusion.'
      : primaryFormat === 'post'
        ? 'Write a concise social post with a strong opening, one developed idea, and a compact ending.'
        : 'Write a short-form social video script for roughly 45-75 seconds.';
  return `Write content from a selected Content Radar opportunity.

CREATOR PROFILE
Additional context: ${profile.description || 'none'}

TOPICS
${(profile.topics || []).join(', ') || 'not specified'}

PREFERRED ANGLES
${(profile.preferredAngles || []).join(', ') || 'not specified'}

AVAILABLE OUTPUT FORMATS
${getRadarIdeaFormatOptions(profile).join(', ')}

SELECTED OUTPUT FORMAT FOR THIS SCRIPT
${primaryFormat}

CREATOR GOALS
${(profile.goals || []).join(', ') || 'not specified'}

CUSTOM INSTRUCTIONS
${profile.customInstructions || 'none'}

SELECTED OPPORTUNITY
Title: ${opportunity.title}
Hook direction: ${opportunity.hook}
Core idea: ${opportunity.coreIdea}
Why interesting: ${opportunity.whyInteresting}
Creator angle: ${opportunity.angle}

SOURCE-GROUNDED EVIDENCE
${(opportunity.evidence || []).map((x) => '- ' + x).join('\n') || '- none'}

SOURCE
${opportunity.sourceTitle}
${opportunity.sourceUrl}

PAST SCRIPT FEEDBACK
${JSON.stringify(feedback.slice(-20))}

Write the final script only, in Russian unless the creator profile clearly indicates another language.

Requirements:
- ${formatGuidance}
- Strong opening appropriate to the selected format.
- One clear thesis.
- Natural spoken language, not an article.
- Do not mention the source unless necessary.
- Do not invent facts beyond the evidence.
- Avoid generic motivational filler.
- End with a compact thought-provoking conclusion or CTA.
- Use past feedback to avoid repeated problems.
`;
}

export async function generateRadarOpportunityScript(ownerId: string | undefined, opportunityId: string, requestedFormat?: string) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const opportunity = (db.radarOpportunities || []).find((x) => x.id === opportunityId && x.ownerId === id);
  if (!opportunity) return null;

  beginScriptGeneration(id);
  try {
    const profile = await getRadarProfile(id);
    const feedback = (db.radarScriptFeedback || []).filter((x) => x.ownerId === id);
    const outputFormat = resolveRadarOpportunityOutputFormat(profile, opportunity, requestedFormat);

    await assertUserQuotaAvailable(id, 'scriptGenerations', 1);
    const response = await runLLMTask(id, 'radar_script_generation', buildRadarScriptPrompt(profile, opportunity, feedback, outputFormat));
    await consumeUserQuota(id, 'scriptGenerations', 1);

    const now = new Date().toISOString();
    const wasLegacySaved = opportunity.status === 'saved';
    if (wasLegacySaved && !opportunity.savedAt) {
      opportunity.savedAt = opportunity.updatedAt || now;
    }

    const existingVersions = (db.scripts || []).filter(
      (x) =>
        x.ownerId === id &&
        x.radarOpportunityId === opportunity.id &&
        (x.outputFormat || 'short_video') === outputFormat
    );
    const latestVersion = existingVersions.reduce((max, x) => Math.max(max, Number(x.version || 1)), 0);
    const parentScript = existingVersions[0];
    const script: GeneratedScript = {
      id: `script-radar-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ownerId: id,
      radarOpportunityId: opportunity.id,
      parentScriptId: parentScript?.parentScriptId || parentScript?.id,
      version: latestVersion + 1,
      createdAt: now,
      title: `Сценарий: ${opportunity.title}`,
      promptTemplate: 'radar_opportunity_script',
      ideaTitle: opportunity.title,
      videoIds: [opportunity.sourceContentId],
      videoTitles: [opportunity.sourceTitle],
      content: response.text.trim(),
      matchedFilter: true,
      telegramSent: false,
      outputFormat,
    };

    if (!db.scripts) db.scripts = [];
    db.scripts.unshift(script);
    opportunity.status = 'scripted';
    opportunity.updatedAt = now;
    await saveDb();
    return { script, opportunity };
  } finally {
    endScriptGeneration(id);
  }
}

export async function saveRadarScriptFeedback(
  ownerId: string | undefined,
  input: {
    scriptId: string;
    opportunityId: string;
    decision: RadarScriptFeedback['decision'];
    reason?: RadarScriptFeedback['reason'];
  }
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const script = (db.scripts || []).find((x) => x.id === input.scriptId && x.ownerId === id);
  const opportunity = (db.radarOpportunities || []).find((x) => x.id === input.opportunityId && x.ownerId === id);
  if (!script || !opportunity) return null;
  if (!db.radarScriptFeedback) db.radarScriptFeedback = [];

  const item: RadarScriptFeedback = {
    id: `rsf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerId: id,
    scriptId: script.id,
    opportunityId: opportunity.id,
    decision: input.decision,
    reason: input.reason,
    createdAt: new Date().toISOString(),
  };
  db.radarScriptFeedback.unshift(item);

  if (input.decision === 'approved') {
    script.isReviewed = true;
  }
  if (input.decision === 'rejected') {
    opportunity.savedAt = opportunity.savedAt || new Date().toISOString();
    opportunity.updatedAt = new Date().toISOString();
  }

  await saveDb();
  return item;
}

function isRadarWorkspaceScript(script: GeneratedScript) {
  return Boolean(script.radarOpportunityId) || script.promptTemplate === 'manual_script';
}

function withRadarScriptThumbnail(
  db: Awaited<ReturnType<typeof getDb>>,
  ownerId: string,
  script: GeneratedScript
): GeneratedScript {
  if (script.thumbnail) return script;
  const videoId = script.videoIds?.[0];
  if (!videoId) return script;
  const video = getVideosForOwner(db, ownerId).find((item) => item.id === videoId);
  const candidate = (db.radarDiscoveryCandidates || []).find((item) => item.ownerId === ownerId && item.videoId === videoId);
  const thumbnail = video?.thumbnail || candidate?.thumbnail || candidate?.imageUrl;
  return thumbnail ? { ...script, thumbnail } : script;
}

export async function createManualRadarScript(
  ownerId: string | undefined,
  input: { title?: string; content?: string }
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const title = String(input.title || '').trim();
  const content = String(input.content || '').trim();
  if (!title || !content) {
    const err: any = new Error('Script title and content are required');
    err.code = 'SCRIPT_CONTENT_REQUIRED';
    throw err;
  }
  const now = new Date().toISOString();
  const script: GeneratedScript = {
    id: `script-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ownerId: id,
    version: 1,
    createdAt: now,
    title: title.slice(0, 300),
    promptTemplate: 'manual_script',
    videoIds: [],
    videoTitles: [],
    content,
    matchedFilter: true,
    telegramSent: false,
    editedManually: true,
  };
  if (!db.scripts) db.scripts = [];
  db.scripts.unshift(script);
  await saveDb();
  return script;
}

export async function updateRadarScriptTitle(
  ownerId: string | undefined,
  scriptId: string,
  titleInput: string
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const script = (db.scripts || []).find((item) => item.id === scriptId && item.ownerId === id && isRadarWorkspaceScript(item));
  if (!script) return null;
  const title = String(titleInput || '').trim();
  if (!title) {
    const err: any = new Error('Script title is required');
    err.code = 'SCRIPT_TITLE_REQUIRED';
    throw err;
  }
  script.title = title.slice(0, 300);
  script.ideaTitle = title.slice(0, 300);
  await saveDb();
  return script;
}

function getRadarScriptLineageRootId(script: GeneratedScript): string {
  return script.parentScriptId || script.id;
}

function getRadarScriptLineage(
  db: Awaited<ReturnType<typeof getDb>>,
  ownerId: string,
  script: GeneratedScript
): GeneratedScript[] {
  const rootId = getRadarScriptLineageRootId(script);
  return (db.scripts || [])
    .filter((x) => {
      if (x.ownerId !== ownerId || !isRadarWorkspaceScript(x)) return false;
      return x.id === rootId || x.parentScriptId === rootId;
    })
    .sort(
      (a, b) =>
        Number(b.version || 1) - Number(a.version || 1) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

function getLatestRadarScriptsFromDb(db: Awaited<ReturnType<typeof getDb>>, ownerId: string) {
  const all = (db.scripts || [])
    .filter((x) => x.ownerId === ownerId && isRadarWorkspaceScript(x))
    .sort(
      (a, b) =>
        Number(b.version || 1) - Number(a.version || 1) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  const byLineage = new Map<string, GeneratedScript>();
  for (const script of all) {
    const key = getRadarScriptLineageRootId(script);
    if (!byLineage.has(key)) byLineage.set(key, script);
  }
  return Array.from(byLineage.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getRadarScripts(ownerId?: string) {
  await publishPastRadarScripts(getDefaultOwnerId(ownerId));
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  return getLatestRadarScriptsFromDb(db, id).map((script) => withRadarScriptThumbnail(db, id, script));
}


export async function getRadarToday(ownerId?: string, timeZone = 'UTC') {
  await publishPastRadarScripts(getDefaultOwnerId(ownerId));
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const now = Date.now();
  const since24h = now - 24 * 60 * 60 * 1000;

  const opportunities = (db.radarOpportunities || [])
    .filter((x) => x.ownerId === id && x.status !== 'dismissed');

  const scripts = getLatestRadarScriptsFromDb(db, id);
  const outputOpportunityIds = new Set(
    scripts.map((script) => script.radarOpportunityId).filter(Boolean) as string[]
  );

  const newIdeas24h = opportunities.filter((item) => new Date(item.createdAt).getTime() >= since24h);
  const readyIdeas = opportunities
    .filter((item) => !outputOpportunityIds.has(item.id))
    .sort((a, b) => {
      const newPriority = Number(b.status === 'new') - Number(a.status === 'new');
      if (newPriority) return newPriority;
      const savedPriority = Number(Boolean(b.savedAt || b.status === 'saved')) - Number(Boolean(a.savedAt || a.status === 'saved'));
      if (savedPriority) return savedPriority;
      return b.relevance - a.relevance || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const needsReview = scripts
    .filter((script) => !script.isReviewed && !script.archivedAt && !script.isPublished)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const readyToSchedule = scripts
    .filter((script) => script.isReviewed && !script.scheduledAt && !script.isPublished && !script.archivedAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  let dayFormatter: Intl.DateTimeFormat;
  try {
    dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const todayKey = dayFormatter.format(new Date(now));
  const scheduledToday = scripts.filter((script) => {
    if (!script.scheduledAt || script.isPublished || script.archivedAt) return false;
    const scheduled = new Date(script.scheduledAt);
    return !Number.isNaN(scheduled.getTime()) && dayFormatter.format(scheduled) === todayKey;
  });

  const upcomingAll = scripts
    .filter((script) => script.scheduledAt && !script.archivedAt && !script.isPublished)
    .sort((a, b) => new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime());

  const opportunityById = new Map(opportunities.map((item) => [item.id, item] as const));
  const focusCandidates = [
    ...needsReview.map((script) => {
      const opportunity = script.radarOpportunityId ? opportunityById.get(script.radarOpportunityId) : undefined;
      return {
        type: 'script_review' as const,
        id: script.id,
        title: script.ideaTitle || script.title,
        subtitle: 'Нужен review',
        action: 'review' as const,
        opportunityId: script.radarOpportunityId,
        thumbnail: opportunity?.sourceThumbnail,
        topic: opportunity?.topic,
      };
    }),
    ...readyToSchedule.map((script) => {
      const opportunity = script.radarOpportunityId ? opportunityById.get(script.radarOpportunityId) : undefined;
      return {
        type: 'ready_to_schedule' as const,
        id: script.id,
        title: script.ideaTitle || script.title,
        subtitle: 'Готово к планированию',
        action: 'schedule' as const,
        opportunityId: script.radarOpportunityId,
        thumbnail: opportunity?.sourceThumbnail,
        topic: opportunity?.topic,
      };
    }),
    ...readyIdeas.map((opportunity) => ({
      type: 'opportunity' as const,
      id: opportunity.id,
      title: opportunity.title,
      subtitle: `${opportunity.relevance}% match · идея без output`,
      action: 'open' as const,
      opportunityId: opportunity.id,
      thumbnail: opportunity.sourceThumbnail,
      topic: opportunity.topic,
    })),
  ].slice(0, 2);

  const discovery = await getRadarDiscovery(id);

  return {
    generatedAt: new Date().toISOString(),
    refreshPolicy: {
      autoRefreshSeconds: 60,
      source: 'persisted_snapshot' as const,
      externalCalls: false as const,
    },
    limits: {
      focus: 2,
      recommendedIdeas: 3,
      upcoming: 3,
    },
    summary: {
      newOpportunities24h: newIdeas24h.length,
      scriptsNeedReview: needsReview.length,
      scriptsScheduledToday: scheduledToday.length,
      readyIdeas: readyIdeas.length,
    },
    attention: focusCandidates,
    topOpportunities: readyIdeas.slice(0, 3),
    upcomingScripts: upcomingAll.slice(0, 3).map((script) => withRadarScriptThumbnail(db, id, script)),
    upcomingTotal: upcomingAll.length,
    learning: {
      preferenceSignals: discovery.feedbackCount || 0,
      interested: discovery.interestingCount || 0,
      notInterested: discovery.notInterestedCount || 0,
      skipped: discovery.skipCount || 0,
    },
  };
}

export async function getRadarScriptDetail(ownerId: string | undefined, scriptId: string) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const script = (db.scripts || []).find((x) => x.id === scriptId && x.ownerId === id && isRadarWorkspaceScript(x));
  if (!script) return null;

  const opportunity = script.radarOpportunityId
    ? (db.radarOpportunities || []).find((x) => x.id === script.radarOpportunityId && x.ownerId === id)
    : undefined;
  const versions = getRadarScriptLineage(db, id, script);
  const lineageIds = new Set(versions.map((x) => x.id));
  const feedback = (db.radarScriptFeedback || [])
    .filter((x) => x.ownerId === id && lineageIds.has(x.scriptId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { script: withRadarScriptThumbnail(db, id, script), opportunity, versions, feedback };
}

export async function saveRadarScriptVersion(
  ownerId: string | undefined,
  scriptId: string,
  input: { content?: string; title?: string }
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const source = (db.scripts || []).find((x) => x.id === scriptId && x.ownerId === id && isRadarWorkspaceScript(x));
  if (!source) return null;

  const content = String(input.content || '').trim();
  if (!content) {
    const err: any = new Error('Script content is required');
    err.code = 'SCRIPT_CONTENT_REQUIRED';
    throw err;
  }

  const versions = getRadarScriptLineage(db, id, source);
  const latestVersion = versions.reduce((max, x) => Math.max(max, Number(x.version || 1)), 0);
  const now = new Date().toISOString();

  const next: GeneratedScript = {
    ...source,
    id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parentScriptId: source.parentScriptId || source.id,
    version: latestVersion + 1,
    createdAt: now,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 300) : source.title,
    content,
    isReviewed: false,
    telegramSent: false,
    telegramSentAt: undefined,
    telegramMessageIds: undefined,
    isPublished: false,
    publishedAt: undefined,
    scheduledAt: undefined,
    publicationPlatform: undefined,
    calendarProvider: undefined,
    calendarId: undefined,
    calendarEventId: undefined,
    archivedAt: undefined,
    exportedAt: undefined,
    exportMethod: undefined,
    editedManually: true,
  };

  db.scripts.push(next);
  await saveDb();
  return next;
}

export async function markRadarScriptExported(
  ownerId: string | undefined,
  scriptId: string,
  method: 'copy' | 'download' | 'telegram' | 'google_docs'
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const script = (db.scripts || []).find((x) => x.id === scriptId && x.ownerId === id && isRadarWorkspaceScript(x));
  if (!script) return null;

  script.exportedAt = new Date().toISOString();
  script.exportMethod = method;
  await saveDb();
  return script;
}

export async function scheduleRadarScript(
  ownerId: string | undefined,
  scriptId: string,
  input: {
    scheduledAt?: string | null;
    publicationTimeZone?: string;
    publicationPlatform?: GeneratedScript['publicationPlatform'];
    calendarProvider?: GeneratedScript['calendarProvider'];
    calendarId?: string | null;
    calendarEventId?: string | null;
  }
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const script = (db.scripts || []).find((x) => x.id === scriptId && x.ownerId === id && isRadarWorkspaceScript(x));
  if (!script) return null;

  if (input.publicationTimeZone) {
    try { new Intl.DateTimeFormat('en', { timeZone: input.publicationTimeZone }); }
    catch {
      const error: any = new Error('Invalid publication time zone');
      error.code = 'INVALID_SCHEDULE_DATE';
      throw error;
    }
  }

  if (input.scheduledAt === null) {
    script.scheduledAt = undefined;
    script.publicationPlatform = undefined;
    script.calendarProvider = undefined;
    // Keep remote identifiers until deletion succeeds, so cleanup can be retried.
  } else if (typeof input.scheduledAt === 'string') {
    const parsed = new Date(input.scheduledAt);
    if (Number.isNaN(parsed.getTime())) {
      const error: any = new Error('Invalid scheduledAt');
      error.code = 'INVALID_SCHEDULE_DATE';
      throw error;
    }
    if (script.scheduledAt !== parsed.toISOString() || (input.publicationPlatform && input.publicationPlatform !== script.publicationPlatform)) script.calendarProvider = undefined;
    script.scheduledAt = parsed.toISOString();
    if (input.publicationTimeZone) script.publicationTimeZone = input.publicationTimeZone;
    script.isReviewed = true;
    script.isPublished = false;
    script.publishedAt = undefined;
    script.archivedAt = undefined;
    if (input.publicationPlatform) script.publicationPlatform = input.publicationPlatform;
    if (input.calendarProvider) script.calendarProvider = input.calendarProvider;
    if (typeof input.calendarId === 'string') script.calendarId = input.calendarId;
    if (typeof input.calendarEventId === 'string') script.calendarEventId = input.calendarEventId;
  } else {
    if (input.publicationPlatform) script.publicationPlatform = input.publicationPlatform;
    if (input.calendarProvider) script.calendarProvider = input.calendarProvider;
    if (typeof input.calendarId === 'string') script.calendarId = input.calendarId;
    if (typeof input.calendarEventId === 'string') script.calendarEventId = input.calendarEventId;
  }

  if (input.calendarId === null && input.calendarEventId === null) {
    script.calendarId = undefined;
    script.calendarEventId = undefined;
    script.calendarProvider = undefined;
  }
  await saveDb();
  return script;
}

export async function updateRadarScriptLifecycle(
  ownerId: string | undefined,
  scriptId: string,
  action: 'review' | 'approved' | 'published' | 'unpublished' | 'archive' | 'restore'
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const script = (db.scripts || []).find((x) => x.id === scriptId && x.ownerId === id && isRadarWorkspaceScript(x));
  if (!script) return null;

  const now = new Date().toISOString();
  if (action === 'review') {
    script.isReviewed = false;
    script.isPublished = false;
    script.publishedAt = undefined;
    script.scheduledAt = undefined;
    script.publicationPlatform = undefined;
    script.archivedAt = undefined;
  } else if (action === 'approved') {
    script.isReviewed = true;
    script.isPublished = false;
    script.publishedAt = undefined;
    script.scheduledAt = undefined;
    script.archivedAt = undefined;
  } else if (action === 'published') {
    script.isReviewed = true;
    script.isPublished = true;
    script.publishedAt = now;
    script.archivedAt = undefined;
  } else if (action === 'unpublished') {
    script.isPublished = false;
    script.publishedAt = undefined;
  } else if (action === 'archive') {
    script.archivedAt = now;
  } else if (action === 'restore') {
    script.archivedAt = undefined;
  }

  await saveDb();
  return script;
}

export async function deleteRadarScript(ownerId: string | undefined, scriptId: string) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const index = (db.scripts || []).findIndex(script => script.id === scriptId && script.ownerId === id && isRadarWorkspaceScript(script));
  if (index === -1) return false;
  db.scripts.splice(index, 1);
  await saveDb();
  return true;
}

// A scheduled script becomes published after its publication calendar day ends.
// Old schedules without a saved time zone use UTC.
export async function publishPastRadarScripts(ownerId?: string, now = Date.now()) {
  const db = await getDb();
  const owner = ownerId ? getDefaultOwnerId(ownerId) : null;
  let changed = 0;
  for (const script of db.scripts || []) {
    if (!isRadarWorkspaceScript(script) || (owner && script.ownerId !== owner) || !script.scheduledAt || script.isPublished || script.archivedAt) continue;
    const scheduled = new Date(script.scheduledAt);
    if (Number.isNaN(scheduled.getTime())) continue;
    let formatter: Intl.DateTimeFormat;
    try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: script.publicationTimeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    const day = (date: Date) => {
      const parts = formatter.formatToParts(date);
      return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
    };
    if (day(scheduled) >= day(new Date(now))) continue;
    script.isReviewed = true;
    script.isPublished = true;
    script.publishedAt = script.scheduledAt;
    changed++;
  }
  if (changed) await saveDb();
  return changed;
}
