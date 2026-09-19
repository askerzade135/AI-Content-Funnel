import { getDb, saveDb, getDefaultOwnerId, getVideosForOwner, RadarOpportunity, RadarProfile, RadarScanRun, RadarDiscoveryFeedback, RadarDiscoveryCandidateRecord } from './storage.js';
import { executeTranscriptChain } from './transcript-providers.js';
import { generateWithProvider } from './llm.js';
import { consumeUserQuota } from './quotas.js';
import { searchYouTubeVideos } from './youtube.js';

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
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((x) => ({
      id: x.videoId,
      title: x.title,
      channelTitle: x.channelTitle,
      url: x.url,
      thumbnail: x.thumbnail,
      publishedAt: x.publishedAt,
      description: x.description,
      query: x.query,
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
  const fallback = [
    ...(profile.topics || []).slice(0, 4),
    ...(profile.preferredAngles || []).slice(0, 2).map((angle) => `${(profile.topics || [])[0] || 'society'} ${angle}`),
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
  return {
    added,
    queries,
    youtubeApiConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
    discovery: await getRadarDiscovery(id),
  };
}
