import { XMLParser } from 'fast-xml-parser';
import { YoutubeTranscript } from 'youtube-transcript';
import { getGemini, generateWithFallback } from './gemini.js';
import { getDb } from './storage.js';
import { transcribeVideoAudioWithGemini, YouTubeBotBlockError } from './audio.js';
import { fetchTranscriptFromSupadata, SupadataLimitExceededError } from './supadata.js';
import { executeTranscriptChain, ExtractTranscriptOptions, ExtractTranscriptResponse } from './transcript-providers.js';

export interface YouTubeVideoItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  description: string;
  thumbnail: string;
  channelId: string;
  channelTitle: string;
}

export interface TranscriptSegment {
  text: string;
  offset: number; // in seconds
  duration: number; // in seconds
  formattedTime: string;
}

export function formatSeconds(seconds: number): string {
  const sec = Math.floor(seconds);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0) {
    return `${h}:${min.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${min.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function parseRelativeYouTubeDate(relativeText?: string, offsetIndex = 0): string {
  const now = new Date();
  if (!relativeText) {
    now.setDate(now.getDate() - (offsetIndex + 1));
    return now.toISOString();
  }

  const text = relativeText.toLowerCase().trim();
  const numMatch = text.match(/(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 1;

  if (text.includes('год') || text.includes('лет') || text.includes('year')) {
    now.setFullYear(now.getFullYear() - num);
  } else if (text.includes('месяц') || text.includes('month')) {
    now.setMonth(now.getMonth() - num);
  } else if (text.includes('недел') || text.includes('week')) {
    now.setDate(now.getDate() - num * 7);
  } else if (text.includes('дн') || text.includes('ден') || text.includes('day')) {
    now.setDate(now.getDate() - num);
  } else if (text.includes('вчера') || text.includes('yesterday')) {
    now.setDate(now.getDate() - 1);
  } else if (text.includes('час') || text.includes('hour')) {
    now.setHours(now.getHours() - num);
  } else if (text.includes('минут') || text.includes('min')) {
    now.setMinutes(now.getMinutes() - num);
  } else {
    now.setDate(now.getDate() - (offsetIndex + 1));
  }

  now.setMinutes(now.getMinutes() - (offsetIndex % 60));
  return now.toISOString();
}

export function extractVideoId(input: string): string | null {
  const cleanInput = input.trim();
  const vMatch = cleanInput.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if (vMatch && vMatch[1]) return vMatch[1];
  const shortsMatch = cleanInput.match(/youtube\.com\/shorts\/([^"&?\/\s]{11})/i);
  if (shortsMatch && shortsMatch[1]) return shortsMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleanInput)) return cleanInput;
  return null;
}

export function extractChannelIdFromHtml(html: string): string | null {
  const canonicalMatch = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/i);
  if (canonicalMatch && canonicalMatch[1]) return canonicalMatch[1];

  const rssMatch = html.match(/feeds\/videos\.xml\?channel_id=(UC[a-zA-Z0-9_-]{22})/i);
  if (rssMatch && rssMatch[1]) return rssMatch[1];

  const ogMatch = html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/i);
  if (ogMatch && ogMatch[1]) return ogMatch[1];

  const metadataMatch = html.match(/"channelMetadataRenderer":\{[^}]*"externalId":"(UC[a-zA-Z0-9_-]{22})"/i);
  if (metadataMatch && metadataMatch[1]) return metadataMatch[1];

  const extIdMatch = html.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/i);
  if (extIdMatch && extIdMatch[1]) return extIdMatch[1];

  const browseMatch = html.match(/"browseEndpoint":\{[^}]*"browseId":"(UC[a-zA-Z0-9_-]{22})"/i);
  if (browseMatch && browseMatch[1]) return browseMatch[1];

  return null;
}

export async function searchYouTubeChannel(query: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAg%253D%253D`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"channelRenderer":\{[^}]*"channelId":"(UC[a-zA-Z0-9_-]{22})"/i);
    return m ? m[1] : null;
  } catch (err) {
    console.error('Channel search failed:', err);
    return null;
  }
}

export async function resolveChannelId(input: string): Promise<{ channelId: string; title: string; handle?: string; avatarUrl?: string }> {
  const trimmed = input.trim();

  if (/^UC[a-zA-Z0-9_-]{22}$/.test(trimmed)) {
    const rss = await fetchChannelVideos(trimmed);
    return {
      channelId: trimmed,
      title: rss.channelTitle || trimmed,
      avatarUrl: `https://avatar.vercel.sh/${trimmed}.png`,
    };
  }

  const possibleVideoId = extractVideoId(trimmed);
  if (possibleVideoId) {
    try {
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${possibleVideoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
        },
      });
      if (pageRes.ok) {
        const pageHtml = await pageRes.text();
        const cid = extractChannelIdFromHtml(pageHtml) || pageHtml.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/)?.[1];
        if (cid) {
          const rss = await fetchChannelVideos(cid);
          return {
            channelId: cid,
            title: rss.channelTitle || cid,
            avatarUrl: `https://avatar.vercel.sh/${cid}.png`,
          };
        }
      }
    } catch {
      // Fallback
    }
  }

  let targetUrl = trimmed;
  if (trimmed.startsWith('@')) {
    targetUrl = `https://www.youtube.com/${trimmed}`;
  } else if (trimmed.startsWith('youtube.com/') || trimmed.startsWith('www.youtube.com/')) {
    targetUrl = `https://${trimmed}`;
  } else if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    targetUrl = `https://www.youtube.com/@${trimmed.replace(/^@/, '')}`;
  }

  let resolvedChannelId: string | null = null;
  let pageTitle: string | null = null;
  let pageAvatar: string | undefined = undefined;

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
      },
    });

    if (res.ok) {
      const html = await res.text();
      resolvedChannelId = extractChannelIdFromHtml(html);

      const titleMatch = 
        html.match(/<meta property="og:title" content="([^"]+)">/i) ||
        html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        pageTitle = titleMatch[1].replace(' - YouTube', '').trim();
      }

      const avatarMatch = html.match(/<meta property="og:image" content="([^"]+)">/i);
      if (avatarMatch) {
        pageAvatar = avatarMatch[1];
      }
    }
  } catch (err) {
    console.warn(`Direct fetch to ${targetUrl} failed:`, err);
  }

  if (!resolvedChannelId) {
    const searchClean = trimmed
      .replace(/^https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|user\/)?/i, '')
      .replace(/^@/, '')
      .trim();

    const searchId = await searchYouTubeChannel(searchClean);
    if (searchId) {
      resolvedChannelId = searchId;
    }
  }

  if (!resolvedChannelId) {
    throw new Error(`Не удалось найти канал по запросу "${input}". Проверьте название или укажите ссылку вида https://www.youtube.com/@handle или ID (UC...)`);
  }

  const rss = await fetchChannelVideos(resolvedChannelId);
  const finalTitle = rss.channelTitle && rss.channelTitle !== 'Unknown Channel' && rss.channelTitle !== 'YouTube Channel'
    ? rss.channelTitle
    : (pageTitle || resolvedChannelId);

  return {
    channelId: resolvedChannelId,
    title: finalTitle,
    handle: trimmed.startsWith('@') ? trimmed : undefined,
    avatarUrl: pageAvatar || `https://avatar.vercel.sh/${resolvedChannelId}.png`,
  };
}

export async function fetchChannelVideos(channelId: string): Promise<{ channelTitle: string; videos: YouTubeVideoItem[] }> {
  return fetchChannelDeepVideos(channelId, 15);
}

export async function fetchChannelVideosRSS(channelId: string): Promise<{ channelTitle: string; videos: YouTubeVideoItem[] }> {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

  const res = await fetch(rssUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
  });

  if (!res.ok) {
    throw new Error(`Ошибка загрузки RSS канала (HTTP ${res.status})`);
  }

  const xmlText = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const parsed = parser.parse(xmlText);

  const feed = parsed.feed;
  if (!feed) {
    return { channelTitle: 'Unknown Channel', videos: [] };
  }

  const channelTitle = feed.title || 'YouTube Channel';
  let entries = feed.entry || [];
  if (!Array.isArray(entries)) {
    entries = [entries];
  }

  const videos: YouTubeVideoItem[] = entries.map((entry: any) => {
    const videoId = entry['yt:videoId'] || entry.id?.replace('yt:video:', '') || '';
    const title = entry.title || 'Без названия';
    const publishedAt = entry.published || entry.updated || new Date().toISOString();
    const mediaGroup = entry['media:group'] || {};
    const description = mediaGroup['media:description'] || '';
    const thumbnail = 
      mediaGroup['media:thumbnail']?.['@_url'] || 
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return {
      id: videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt,
      description,
      thumbnail,
      channelId,
      channelTitle,
    };
  }).filter((v: YouTubeVideoItem) => Boolean(v.id));

  return { channelTitle, videos };
}

export async function fetchChannelDeepVideos(
  channelId: string,
  maxVideos = 500
): Promise<{ channelTitle: string; videos: YouTubeVideoItem[] }> {
  const collected = new Map<string, YouTubeVideoItem>();
  let channelTitle = 'YouTube Channel';

  try {
    const rss = await fetchChannelVideosRSS(channelId);
    if (rss.channelTitle && rss.channelTitle !== 'Unknown Channel' && rss.channelTitle !== 'YouTube Channel') {
      channelTitle = rss.channelTitle;
    }
    for (const v of rss.videos) {
      collected.set(v.id, v);
    }
  } catch (rssErr) {
    // ignore
  }

  const tabsToFetch = ['videos', 'streams'];

  for (const tabName of tabsToFetch) {
    if (collected.size >= maxVideos) break;

    try {
      const url = `https://www.youtube.com/channel/${channelId}/${tabName}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      if (!res.ok) continue;

      const text = await res.text();
      const match = text.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
      const apiKey = text.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];

      if (match) {
        const data = JSON.parse(match[1]);
        const metaTitle = text.match(/<meta property="og:title" content="([^"]+)"/i);
        if (metaTitle && (!channelTitle || channelTitle === 'YouTube Channel')) {
          channelTitle = metaTitle[1].replace(' - YouTube', '').trim();
        }

        const parseItems = (items: any[]): string | null => {
          let nextToken: string | null = null;
          if (!items || !Array.isArray(items)) return null;

          for (const it of items) {
            if (it.richItemRenderer) {
              const lvm = it.richItemRenderer.content?.lockupViewModel;
              if (lvm && lvm.contentId) {
                const title = lvm.metadata?.lockupMetadataViewModel?.title?.content || 'Без названия';
                const img =
                  lvm.contentImage?.thumbnailViewModel?.image?.sources?.slice(-1)?.[0]?.url ||
                  `https://i.ytimg.com/vi/${lvm.contentId}/hqdefault.jpg`;
                
                let relDateText = '';
                const rows = lvm.metadata?.lockupMetadataViewModel?.metadataRows || [];
                for (const r of rows) {
                  for (const p of r.metadataParts || []) {
                    const txt = p.text?.content || '';
                    if (txt.includes('назад') || txt.includes('ago') || txt.includes('вчера') || txt.includes('yesterday')) {
                      relDateText = txt;
                    }
                  }
                }

                if (!collected.has(lvm.contentId)) {
                  collected.set(lvm.contentId, {
                    id: lvm.contentId,
                    title,
                    url: `https://www.youtube.com/watch?v=${lvm.contentId}`,
                    thumbnail: img,
                    publishedAt: parseRelativeYouTubeDate(relDateText, collected.size),
                    description: '',
                    channelId,
                    channelTitle,
                  });
                }
              }

              const vr = it.richItemRenderer.content?.videoRenderer;
              if (vr && vr.videoId) {
                const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || 'Без названия';
                const img =
                  vr.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                  `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`;
                
                const relDateText = vr.publishedTimeText?.simpleText || vr.publishedTimeText?.runs?.[0]?.text || '';

                if (!collected.has(vr.videoId)) {
                  collected.set(vr.videoId, {
                    id: vr.videoId,
                    title,
                    url: `https://www.youtube.com/watch?v=${vr.videoId}`,
                    thumbnail: img,
                    publishedAt: parseRelativeYouTubeDate(relDateText, collected.size),
                    description: '',
                    channelId,
                    channelTitle,
                  });
                }
              }
            } else if (it.videoRenderer || it.gridVideoRenderer || it.compactVideoRenderer) {
              const vr = it.videoRenderer || it.gridVideoRenderer || it.compactVideoRenderer;
              if (vr && vr.videoId && !collected.has(vr.videoId)) {
                const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || 'Без названия';
                const img =
                  vr.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                  `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`;
                
                const relDateText = vr.publishedTimeText?.simpleText || vr.publishedTimeText?.runs?.[0]?.text || '';

                collected.set(vr.videoId, {
                  id: vr.videoId,
                  title,
                  url: `https://www.youtube.com/watch?v=${vr.videoId}`,
                  thumbnail: img,
                  publishedAt: parseRelativeYouTubeDate(relDateText, collected.size),
                  description: '',
                  channelId,
                  channelTitle,
                });
              }
            } else if (it.continuationItemRenderer) {
              nextToken =
                it.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null;
            }
          }
          return nextToken;
        };

        const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
        const currentTab = tabs?.find(
          (t: any) =>
            t.tabRenderer?.selected ||
            t.tabRenderer?.title === 'Видео' ||
            t.tabRenderer?.title === 'Videos' ||
            t.tabRenderer?.title === 'Трансляции' ||
            t.tabRenderer?.title === 'Streams'
        );
        const richGrid =
          currentTab?.tabRenderer?.content?.richGridRenderer ||
          currentTab?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.gridRenderer;

        let token = parseItems(richGrid?.contents || []);

        let page = 0;
        while (token && collected.size < maxVideos && page < 20 && apiKey) {
          page++;
          try {
            const bRes = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
                continuation: token,
              }),
            });
            if (!bRes.ok) break;

            const bData = await bRes.json();
            const actions = bData.onResponseReceivedActions;
            const contItems = actions?.[0]?.appendContinuationItemsAction?.continuationItems || [];
            token = parseItems(contItems);
          } catch (pErr) {
            console.warn(`[DeepScrape] Browse page ${page} error:`, pErr);
            break;
          }
        }
      }
    } catch (tabErr) {
      console.warn(`[DeepScrape] Tab ${tabName} error:`, tabErr);
    }
  }

  return { channelTitle, videos: Array.from(collected.values()) };
}

export async function fetchVideoExactPublishDate(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const dateTextMatch = html.match(/"(?:dateText|publishDate)":\{"simpleText":"([^"]+)"/i);
    if (dateTextMatch && dateTextMatch[1]) {
      const parsed = new Date(dateTextMatch[1]);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    const jsonPublishMatch = html.match(/"(?:publishDate|uploadDate)":"([^"]+)"/i);
    if (jsonPublishMatch && jsonPublishMatch[1]) {
      const parsed = new Date(jsonPublishMatch[1]);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    const itempropMatch = html.match(/itemprop="(?:datePublished|uploadDate)" content="([^"]+)"/i);
    if (itempropMatch && itempropMatch[1]) {
      const parsed = new Date(itempropMatch[1]);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    const metaDateMatch = html.match(/<meta (?:property|name)="(?:og:video:release_date|datePublished|uploadDate)" content="([^"]+)">/i);
    if (metaDateMatch && metaDateMatch[1]) {
      const parsed = new Date(metaDateMatch[1]);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
  } catch (e) {
    console.warn(`[VideoDate] Failed to fetch date for ${videoId}:`, e);
  }
  return null;
}

export async function fetchSingleVideoInfo(videoId: string): Promise<YouTubeVideoItem> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const exactDate = await fetchVideoExactPublishDate(videoId);

  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      return {
        id: videoId,
        title: data.title || `Video ${videoId}`,
        url,
        publishedAt: exactDate || new Date().toISOString(),
        description: data.author_name ? `Автор: ${data.author_name}` : '',
        thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        channelId: data.author_url ? data.author_url.split('/').pop() || 'unknown' : 'unknown',
        channelTitle: data.author_name || 'YouTube Video',
      };
    }
  } catch (e) {
    console.warn('noembed fallback failed, using defaults', e);
  }

  return {
    id: videoId,
    title: `YouTube Video (${videoId})`,
    url,
    publishedAt: exactDate || new Date().toISOString(),
    description: '',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    channelId: 'custom',
    channelTitle: 'YouTube',
  };
}

function cleanXmlCaptionText(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * Extracts transcript from YouTube video using the configurable multi-tier provider chain:
 * Level A: Public auto-captions scraper (Fast, 0 tokens)
 * Level B1: Supadata API gateway (Fast captions proxy, 100/mo)
 * Level B2: ChocoData YouTube Transcript API (Fast captions proxy, ~200 lifetime)
 * Level C / B3: Gemini AI Multimodal direct audio stream comprehension (paid/free Gemini Audio)
 */
export async function extractVideoTranscript(
  videoId: string,
  videoTitle?: string,
  options?: {
    allowGeminiAudioFallback?: boolean;
    forcePaidModel?: boolean;
    ownerId?: string;
  }
): Promise<{
  text: string;
  segments: TranscriptSegment[];
  source: 'subtitles' | 'gemini_multimodal' | 'supadata' | 'chocodata';
  language?: string;
}> {
  return await executeTranscriptChain(videoId, videoTitle, options);
}

