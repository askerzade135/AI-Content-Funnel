import { getDb, saveDb, getDefaultOwnerId, getVideosForOwner, RadarOpportunity, RadarProfile, RadarScanRun, RadarDiscoveryFeedback, RadarDiscoveryCandidateRecord, RadarReferenceSignal, RadarYouTubeSubscription } from './storage.js';
import { executeTranscriptChain } from './transcript-providers.js';
import { generateWithProvider } from './llm.js';
import { consumeUserQuota } from './quotas.js';
import { searchYouTubeVideos, extractVideoId, fetchSingleVideoInfo, resolveChannelId, fetchChannelVideos } from './youtube.js';

const DEFAULT_PROFILE = 'Я создаю контент про психологию, воспитание, отношения между поколениями, общество и ценности. Ищу необычные, дискуссионные и содержательные темы, а не обычные советы.';

export async function getRadarProfile(ownerId?: string): Promise<RadarProfile> {
  const db = await getDb();
  if (!db.radarProfiles) db.radarProfiles = {};
  const id = getDefaultOwnerId(ownerId);
  const existing = db.radarProfiles[id];
  if (existing) return existing;
  const profile: RadarProfile = {
    ownerId: id,
    description: DEFAULT_PROFILE,
    topics: [],
    preferredAngles: [],
    avoid: [],
    customInstructions: '',
    onboardingCompletedAt: undefined,
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
  const updated: RadarProfile = {
    ...current,
    ...input,
    ownerId: id,
    description: String(input.description ?? current.description).trim(),
    topics: Array.isArray(input.topics) ? input.topics.map(String).filter(Boolean).slice(0, 50) : current.topics,
    preferredAngles: Array.isArray(input.preferredAngles) ? input.preferredAngles.map(String).filter(Boolean).slice(0, 50) : current.preferredAngles,
    avoid: Array.isArray(input.avoid) ? input.avoid.map(String).filter(Boolean).slice(0, 50) : current.avoid,
    customInstructions: typeof input.customInstructions === 'string' ? input.customInstructions.slice(0, 10000) : current.customInstructions,
    onboardingCompletedAt: typeof input.onboardingCompletedAt === 'string' ? input.onboardingCompletedAt : current.onboardingCompletedAt,
    updatedAt: new Date().toISOString(),
  };
  db.radarProfiles[id] = updated;
  await saveDb();
  return updated;
}

export async function getRadarOpportunities(ownerId?: string, status?: RadarOpportunity['status']) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  return (db.radarOpportunities || [])
    .filter((x) => x.ownerId === id && (!status || x.status === status))
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

function buildPrompt(profile: RadarProfile, video: { title: string; channelTitle: string; transcript: string }) {
  return `You are Content Radar. Analyze the source as research material for the creator. Do not summarize the video.

CREATOR STRATEGY
${profile.description}

TOPICS
${(profile.topics || []).join(', ') || 'not specified'}

PREFERRED ANGLES
${(profile.preferredAngles || []).join(', ') || 'not specified'}

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
      "relevance": 0
    }
  ]
}

Rules:
- Return 0 to 3 opportunities.
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
  if (!profile.description.trim()) throw new Error('Radar profile is empty');

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

  const run: RadarScanRun = {
    id: `radar-scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerId: id,
    startedAt: new Date().toISOString(),
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
      let transcript = video.transcript;
      if (!transcript || transcript.trim().length < 50) {
        const extracted = await executeTranscriptChain(video.id, video.title, { ownerId: id });
        transcript = extracted.text;
        video.transcript = extracted.text;
        video.transcriptSegments = extracted.segments;
        video.transcriptSource = extracted.source;
        video.status = 'transcribed';
        video.updatedAt = new Date().toISOString();
        await saveDb();
      }

      await consumeUserQuota(id, 'radarAnalyses', 1);
      const response = await generateWithProvider({
        provider: 'gemini',
        prompt: buildPrompt(profile, {
          title: video.title,
          channelTitle: video.channelTitle,
          transcript,
        }),
        temperature: 0.3,
        maxTokens: 2500,
        operation: 'content_radar',
        ownerId: id,
      }, {});

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
          status: 'new',
          createdAt: now,
          updatedAt: now,
        };
        db.radarOpportunities.unshift(opportunity);
        existingKeys.add(dedupeKey(opportunity));
        created.push(opportunity);
      }
      video.radarScannedAt = new Date().toISOString();
      run.scanned++;
    } catch (err) {
      console.warn('[Content Radar] Scan item failed:', video.id, err);
      video.radarScannedAt = new Date().toISOString();
      run.errors++;
    }
    run.opportunitiesCreated = created.length;
    await saveDb();
  }

  run.status = 'completed';
  run.completedAt = new Date().toISOString();
  await saveDb();

  return { run, opportunities: created };
}


export async function getRadarDiscovery(ownerId?: string) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const feedback = (db.radarDiscoveryFeedback || []).filter((x) => x.ownerId === id);
  const reviewed = new Set(feedback.map((x) => x.sourceContentId));

  const discovered = (db.radarDiscoveryCandidates || [])
    .filter((x) => x.ownerId === id && !reviewed.has(x.videoId))
    .sort((a, b) => (b.rankingScore ?? 0) - (a.rankingScore ?? 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((x) => ({
      id: x.videoId,
      title: x.title,
      channelTitle: x.channelTitle,
      url: x.url,
      thumbnail: x.thumbnail,
      publishedAt: x.publishedAt,
      description: x.description,
      query: x.query,
      rankingScore: x.rankingScore,
      rankingReason: x.rankingReason,
      source: 'external' as const,
    }));

  const discoveredIds = new Set(discovered.map((x) => x.id));
  const local = getVideosForOwner(db, id)
    .filter((v) => !reviewed.has(v.id) && !discoveredIds.has(v.id))
    .sort((a, b) => new Date(b.publishedAt || b.updatedAt || 0).getTime() - new Date(a.publishedAt || a.updatedAt || 0).getTime())
    .map((v) => ({
      id: v.id,
      title: v.title,
      channelTitle: v.channelTitle,
      url: v.url,
      thumbnail: v.thumbnail,
      publishedAt: v.publishedAt,
      description: v.description,
      source: 'local' as const,
    }));

  return {
    candidates: [...discovered, ...local].slice(0, 30),
    feedbackCount: feedback.length,
    interestingCount: feedback.filter((x) => x.decision === 'interesting').length,
    skipCount: feedback.filter((x) => x.decision === 'skip').length,
    minimumSignals: 5,
    externalCount: discovered.length,
    youtubeApiConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
  };
}

export async function saveRadarDiscoveryFeedback(
  ownerId: string | undefined,
  sourceContentId: string,
  decision: RadarDiscoveryFeedback['decision']
) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  if (!db.radarDiscoveryFeedback) db.radarDiscoveryFeedback = [];
  db.radarDiscoveryFeedback = db.radarDiscoveryFeedback.filter(
    (x) => !(x.ownerId === id && x.sourceContentId === sourceContentId)
  );
  const item: RadarDiscoveryFeedback = {
    id: `rdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerId: id,
    sourceContentId,
    decision,
    createdAt: new Date().toISOString(),
  };
  db.radarDiscoveryFeedback.push(item);

  if (decision === 'interesting') {
    const candidate = (db.radarDiscoveryCandidates || []).find(
      (x) => x.ownerId === id && x.videoId === sourceContentId
    );
    const alreadyInCorpus = getVideosForOwner(db, id).some((v) => v.id === sourceContentId);
    if (candidate && !alreadyInCorpus) {
      db.videos.push({
        id: candidate.videoId,
        ownerId: id,
        channelId: candidate.channelId || 'youtube-search',
        channelTitle: candidate.channelTitle,
        title: candidate.title,
        url: candidate.url,
        description: candidate.description || '',
        thumbnail: candidate.thumbnail || `https://i.ytimg.com/vi/${candidate.videoId}/hqdefault.jpg`,
        publishedAt: candidate.publishedAt || new Date().toISOString(),
        status: 'new',
        updatedAt: new Date().toISOString(),
      });
    }
  }

  await saveDb();
  return item;
}

export async function completeRadarOnboarding(ownerId?: string) {
  const profile = await getRadarProfile(ownerId);
  const discovery = await getRadarDiscovery(ownerId);
  if (discovery.feedbackCount < discovery.minimumSignals) {
    const err: any = new Error(`Need at least ${discovery.minimumSignals} discovery signals`);
    err.code = 'RADAR_NOT_ENOUGH_SIGNALS';
    err.required = discovery.minimumSignals;
    err.current = discovery.feedbackCount;
    throw err;
  }
  return saveRadarProfile(ownerId, {
    ...profile,
    onboardingCompletedAt: new Date().toISOString(),
  });
}


async function generateDiscoveryQueries(profile: RadarProfile): Promise<string[]> {
  const db = await getDb();
  const references = (db.radarReferences || [])
    .filter((x) => x.ownerId === profile.ownerId)
    .slice(0, 10);
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
  const fallback = [
    ...(profile.topics || []).slice(0, 4),
    ...(profile.preferredAngles || []).slice(0, 2).map((angle) => `${(profile.topics || [])[0] || 'society'} ${angle}`),
    ...referenceTopics.slice(0, 3),
    ...referenceAngles.slice(0, 2).map((angle) => `${referenceTopics[0] || (profile.topics || [])[0] || 'society'} ${angle}`),
  ].filter(Boolean);

  try {
    const response = await generateWithProvider({
      provider: 'gemini',
      temperature: 0.5,
      maxTokens: 1200,
      operation: 'radar_discovery_queries',
      ownerId: profile.ownerId,
      prompt: `Generate YouTube search queries for a content creator discovery system.

Creator topics: ${(profile.topics || []).join(', ')}
Preferred angles: ${(profile.preferredAngles || []).join(', ')}
Description: ${profile.description}

Strong manual references from the user:
${JSON.stringify(referenceContext)}

Treat manual references as stronger preference signals than generic topic selections.
If intent is "style", imitate only the editorial pattern, not the source content.
If intent is "topic", prefer the subject even if the source's tone/style differs.

Return ONLY JSON:
{"queries":["query 1","query 2",...]}
Rules:
- 8 queries maximum.
- Mix broad and specific long-tail queries.
- Prefer English plus the creator's apparent language when useful.
- Focus on discovering thought-provoking source videos, not generic tutorials.
- Do not include explanations.`
    }, {});
    const parsed = parseJson(response.text);
    const queries = Array.isArray(parsed?.queries) ? parsed.queries.map(String).map((x: string) => x.trim()).filter(Boolean) : [];
    return queries.slice(0, 8).length ? queries.slice(0, 8) : fallback.slice(0, 8);
  } catch {
    return fallback.slice(0, 8);
  }
}


async function rankRadarDiscoveryCandidates(ownerId: string, limit = 24) {
  const db = await getDb();
  const profile = await getRadarProfile(ownerId);
  const references = (db.radarReferences || []).filter((x) => x.ownerId === ownerId).slice(0, 8);
  const feedback = (db.radarDiscoveryFeedback || []).filter((x) => x.ownerId === ownerId).slice(-40);
  const allCandidates = (db.radarDiscoveryCandidates || [])
    .filter((x) => x.ownerId === ownerId)
    .filter((x) => !x.rankedAt)
    .slice(0, limit);
  if (!allCandidates.length) return 0;

  const knownTitles = new Map<string, string>();
  for (const c of db.radarDiscoveryCandidates || []) {
    if (c.ownerId === ownerId) knownTitles.set(c.videoId, c.title);
  }
  for (const v of getVideosForOwner(db, ownerId)) knownTitles.set(v.id, v.title);

  const feedbackContext = feedback.map((x) => ({
    decision: x.decision,
    title: knownTitles.get(x.sourceContentId) || x.sourceContentId,
  }));

  const payload = allCandidates.map((x) => ({
    id: x.videoId,
    title: x.title,
    channel: x.channelTitle,
    description: (x.description || '').slice(0, 500),
    query: x.query,
  }));

  try {
    const response = await generateWithProvider({
      provider: 'gemini',
      temperature: 0.2,
      maxTokens: 2200,
      operation: 'radar_discovery_ranking',
      ownerId,
      prompt: `Rank candidate YouTube videos for a personalized editorial discovery feed.

CREATOR PROFILE
Topics: ${(profile.topics || []).join(', ')}
Preferred angles: ${(profile.preferredAngles || []).join(', ')}
Description: ${profile.description}

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

CANDIDATES
${JSON.stringify(payload)}

Return ONLY JSON:
{
  "rankings": [
    {"id":"video-id","score":0,"reason":"short reason"}
  ]
}

Rules:
- score is integer 0-100.
- Manual references are stronger signals than generic selected topics.
- "interesting" feedback is positive; "skip" feedback is negative.
- Reward unusual, substantive, discussion-worthy material matching the user's editorial taste.
- Penalize generic tutorials, repetitive listicles, obvious clickbait, and topics resembling skipped material.
- reason must be a concise user-facing explanation in Russian.
- Return one item for every candidate id.`
    }, {});

    const parsed = parseJson(response.text);
    const rankings = Array.isArray(parsed?.rankings) ? parsed.rankings : [];
    const byId = new Map(rankings.map((x: any) => [String(x.id), x]));
    const now = new Date().toISOString();
    for (const candidate of allCandidates) {
      const ranked: any = byId.get(candidate.videoId);
      candidate.rankingScore = Math.max(0, Math.min(100, Math.round(Number(ranked?.score) || 0)));
      candidate.rankingReason = String(ranked?.reason || '').trim() || 'Подходит под выбранные интересы и сигналы Radar.';
      candidate.rankedAt = now;
    }
    await saveDb();
    return allCandidates.length;
  } catch (err) {
    console.warn('[Radar ranking] Failed:', err);
    return 0;
  }
}

export async function refreshRadarDiscovery(ownerId?: string, options?: { perQuery?: number }) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const profile = await getRadarProfile(id);
  const queries = await generateDiscoveryQueries(profile);
  if (!db.radarDiscoveryCandidates) db.radarDiscoveryCandidates = [];

  const perQuery = Math.max(2, Math.min(options?.perQuery || 5, 10));
  const existing = new Set(
    db.radarDiscoveryCandidates.filter((x) => x.ownerId === id).map((x) => x.videoId)
  );
  const feedbackIds = new Set(
    (db.radarDiscoveryFeedback || []).filter((x) => x.ownerId === id).map((x) => x.sourceContentId)
  );

  let added = 0;
  const subscriptionSources = (db.radarYouTubeSubscriptions || [])
    .filter((x) => x.ownerId === id && x.enabled)
    .slice(0, 12);

  for (const source of subscriptionSources) {
    try {
      const channel = await fetchChannelVideos(source.channelId);
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
          query: `youtube-subscription:${source.title}`,
          createdAt: new Date().toISOString(),
        });
        existing.add(video.id);
        added++;
        if (added >= 30) break;
      }
    } catch (err) {
      console.warn('[Radar YouTube subscriptions] Failed channel', source.channelId, err);
    }
    if (added >= 30) break;
  }

  for (const query of queries) {
    const videos = await searchYouTubeVideos(query, perQuery);
    for (const video of videos) {
      if (existing.has(video.id) || feedbackIds.has(video.id)) continue;
      const record: RadarDiscoveryCandidateRecord = {
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
        query,
        createdAt: new Date().toISOString(),
      };
      db.radarDiscoveryCandidates.push(record);
      existing.add(video.id);
      added++;
      if (added >= 30) break;
    }
    if (added >= 30) break;
  }

  await saveDb();
  await rankRadarDiscoveryCandidates(id, 24);
  return {
    added,
    queries,
    youtubeApiConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
    discovery: await getRadarDiscovery(id),
  };
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
    const response = await generateWithProvider({
      provider: 'gemini',
      temperature: 0.2,
      maxTokens: 900,
      operation: 'radar_reference_analysis',
      ownerId,
      prompt: `Analyze this user-provided content reference for a personalized content discovery system.

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
    }, {});
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
