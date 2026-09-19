import { getDb, saveDb, TranscriptCacheEntry } from './storage.js';
import { TranscriptSegment } from './youtube.js';

export async function getCachedTranscript(videoId: string): Promise<TranscriptCacheEntry | null> {
  const db = await getDb();
  const entry = (db.transcriptCache || []).find((x) => x.videoId === videoId && x.source === 'youtube');
  return entry || null;
}

export async function saveCachedTranscript(input: {
  videoId: string;
  text: string;
  segments?: TranscriptSegment[];
  language?: string;
  provider: TranscriptCacheEntry['provider'];
}): Promise<TranscriptCacheEntry> {
  const db = await getDb();
  if (!db.transcriptCache) db.transcriptCache = [];
  const existing = db.transcriptCache.find((x) => x.videoId === input.videoId && x.source === 'youtube');
  const entry: TranscriptCacheEntry = {
    videoId: input.videoId,
    source: 'youtube',
    text: input.text,
    segments: input.segments,
    language: input.language,
    provider: input.provider,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  if (existing) Object.assign(existing, entry);
  else db.transcriptCache.push(entry);
  if (db.transcriptCache.length > 10000) db.transcriptCache = db.transcriptCache.slice(-10000);
  await saveDb();
  return entry;
}
