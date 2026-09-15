import { XMLParser } from 'fast-xml-parser';
import { YoutubeTranscript } from 'youtube-transcript';
import crypto from 'crypto';
import { getGemini, generateWithFallback } from './gemini.js';
import { getDb } from './storage.js';

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
    // When relative text is absent, space older items by days into the past so they don't appear as 'just uploaded'
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

  // Offset slightly by offsetIndex so items in the same relative bucket (e.g. '2 года назад') preserve exact order
  now.setMinutes(now.getMinutes() - (offsetIndex % 60));

  return now.toISOString();
}

export function extractVideoId(input: string): string | null {
  const cleanInput = input.trim();
  // Standard full youtube URL
  const vMatch = cleanInput.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if (vMatch && vMatch[1]) return vMatch[1];
  // Shorts URL
  const shortsMatch = cleanInput.match(/youtube\.com\/shorts\/([^"&?\/\s]{11})/i);
  if (shortsMatch && shortsMatch[1]) return shortsMatch[1];
  // Direct 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleanInput)) return cleanInput;
  return null;
}

export function extractChannelIdFromHtml(html: string): string | null {
  // 1. Canonical tag: <link rel="canonical" href="https://www.youtube.com/channel/(UC...)">
  const canonicalMatch = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/i);
  if (canonicalMatch && canonicalMatch[1]) return canonicalMatch[1];

  // 2. RSS link in page: feeds/videos.xml?channel_id=(UC...)
  const rssMatch = html.match(/feeds\/videos\.xml\?channel_id=(UC[a-zA-Z0-9_-]{22})/i);
  if (rssMatch && rssMatch[1]) return rssMatch[1];

  // 3. OpenGraph URL: <meta property="og:url" content="https://www.youtube.com/channel/(UC...)">
  const ogMatch = html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/i);
  if (ogMatch && ogMatch[1]) return ogMatch[1];

  // 4. channelMetadataRenderer externalId (this is YouTube's authoritative channel metadata)
  const metadataMatch = html.match(/"channelMetadataRenderer":\{[^}]*"externalId":"(UC[a-zA-Z0-9_-]{22})"/i);
  if (metadataMatch && metadataMatch[1]) return metadataMatch[1];

  // 5. externalId specifically: "externalId":"(UC...)"
  const extIdMatch = html.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/i);
  if (extIdMatch && extIdMatch[1]) return extIdMatch[1];

  // 6. browseEndpoint browseId in header / main tab
  const browseMatch = html.match(/"browseEndpoint":\{[^}]*"browseId":"(UC[a-zA-Z0-9_-]{22})"/i);
  if (browseMatch && browseMatch[1]) return browseMatch[1];

  return null;
}

/**
 * Searches YouTube for a channel by query/name and returns the first channel ID.
 */
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

/**
 * Resolves channel ID from a channel URL, handle, channel name, or direct video URL.
 */
export async function resolveChannelId(input: string): Promise<{ channelId: string; title: string; handle?: string; avatarUrl?: string }> {
  const trimmed = input.trim();

  // If already a direct channel ID
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(trimmed)) {
    const rss = await fetchChannelVideos(trimmed);
    return {
      channelId: trimmed,
      title: rss.channelTitle || trimmed,
      avatarUrl: `https://avatar.vercel.sh/${trimmed}.png`,
    };
  }

  // If user pasted a video URL, resolve channel from that video!
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

  // Determine potential direct channel URL
  let targetUrl = trimmed;
  const isHttpOrHandle = trimmed.startsWith('http') || trimmed.startsWith('@') || trimmed.startsWith('youtube.com/') || trimmed.startsWith('www.youtube.com/');
  
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

  // Try direct page fetch
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

  // If direct fetch didn't resolve a channel ID, try YouTube Search
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

  // Fetch official RSS to get the authoritative channel title and confirm the feed works
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

/**
 * Fetches latest videos from YouTube channel RSS feed.
 */

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

/**
 * Deeply scrapes all or up to maxVideos from a channel's /videos and /streams tabs
 * bypassing YouTube's 15-item RSS limitation.
 */
export async function fetchChannelDeepVideos(
  channelId: string,
  maxVideos = 500
): Promise<{ channelTitle: string; videos: YouTubeVideoItem[] }> {
  const collected = new Map<string, YouTubeVideoItem>();
  let channelTitle = 'YouTube Channel';

  // 1. First fetch latest RSS videos to ensure newest uploads and channel title
  try {
    const rss = await fetchChannelVideosRSS(channelId);
    if (rss.channelTitle && rss.channelTitle !== 'Unknown Channel' && rss.channelTitle !== 'YouTube Channel') {
      channelTitle = rss.channelTitle;
    }
    for (const v of rss.videos) {
      collected.set(v.id, v);
    }
  } catch (rssErr) {
    // console.warn(`[DeepScrape] RSS fetch failed for ${channelId}:`, rssErr);
  }

  // 2. Fetch /videos and /streams tabs and paginate through continuations
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
            // New YouTube lockupViewModel layout
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

/**
 * Fetches metadata for a single video.
 */
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

/**
 * Helper to clean XML caption texts
 */
function cleanXmlCaptionText(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '') // remove inner HTML tags like <font>
    .trim();
}

/**
 * Helper to parse user provided session headers or raw cookie string
 */
export function parseYoutubeSessionHeaders(rawInput?: string): {
  cookie: string;
  authorization?: string;
  userAgent?: string;
} {
  if (!rawInput || !rawInput.trim()) return { cookie: '' };

  let cookie = '';
  let authorization = '';
  let userAgent = '';

  // Check if it's Netscape Cookie format
  if (rawInput.includes('Netscape HTTP Cookie File') || rawInput.includes('.youtube.com\t')) {
    const lines = rawInput.split(/\r?\n/);
    const cookieParts = [];
    for (const line of lines) {
      if (line.startsWith('#') || !line.trim()) continue;
      const cols = line.split('\t');
      if (cols.length >= 7) {
        cookieParts.push(`${cols[5]}=${cols[6].trim()}`);
      }
    }
    cookie = cookieParts.join('; ');
  } else {
    // Normal header/raw format parsing
    const lines = rawInput.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const lower = line.toLowerCase();

      if (lower.startsWith('cookie:')) {
        cookie = line.substring(7).trim();
      } else if (lower.startsWith('authorization:')) {
        authorization = line.substring(14).trim();
      } else if (lower.startsWith('user-agent:')) {
        userAgent = line.substring(11).trim();
      } else if (lower === 'cookie' && i + 1 < lines.length) {
        cookie = lines[++i].trim();
      } else if (lower === 'authorization' && i + 1 < lines.length) {
        authorization = lines[++i].trim();
      } else if (lower === 'user-agent' && i + 1 < lines.length) {
        userAgent = lines[++i].trim();
      }
    }

    if (!cookie && rawInput.includes('=')) {
      cookie = rawInput.trim();
    }
  }

  // ALWAYS dynamically generate the required SAPISIDHASH authorization header if possible,
  // to avoid using expired timestamps from user-pasted headers.
  if (cookie) {
    const sapisidMatch = cookie.match(/(?:^|;) *SAPISID=([^;]+)/) || cookie.match(/(?:^|;) *__Secure-1PAPISID=([^;]+)/) || cookie.match(/(?:^|;) *__Secure-3PAPISID=([^;]+)/);
    if (sapisidMatch) {
      const sapisid = sapisidMatch[1];
      const origin = 'https://www.youtube.com';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const hashString = `${timestamp} ${sapisid} ${origin}`;
      const hash = crypto.createHash('sha1').update(hashString).digest('hex');
      authorization = `SAPISIDHASH ${timestamp}_${hash}`;
    }
  }

  return {
    cookie,
    ...(authorization ? { authorization } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

/**
 * Level B: Fetch captions directly using Innertube Player API with optional session cookies.
 * This directly extracts captionTracks from player response and parses the XML timedtext track.
 */
export async function fetchCaptionsViaInnertube(videoId: string, customCookie?: string): Promise<{
  text: string;
  segments: TranscriptSegment[];
} | null> {
  try {
    const db = await getDb().catch(() => null);
    const rawSession = customCookie || db?.settings?.youtubeCookie || process.env.YOUTUBE_COOKIE || '';
    const parsed = parseYoutubeSessionHeaders(rawSession);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent':
        parsed.userAgent ||
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Origin': 'https://www.youtube.com',
      'X-Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
      'x-youtube-client-name': '1',
      'x-youtube-client-version': '2.20260911.01.00',
    };

    if (parsed.cookie && parsed.cookie.trim()) {
      headers['Cookie'] = parsed.cookie.trim();
    }
    if (parsed.authorization && parsed.authorization.trim()) {
      headers['authorization'] = parsed.authorization.trim();
    }

    // Call Innertube player endpoint with WEB client
    const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: {
          client: {
            hl: 'ru',
            gl: 'RU',
            clientName: 'WEB',
            clientVersion: '2.20260911.01.00',
          },
        },
        videoId,
      }),
    });

    
    if (!playerRes.ok) {
      const errorText = await playerRes.text();
      const snippet = errorText.substring(0, 500);
      console.error(`[Innertube Debug] HTTP ${playerRes.status} ${playerRes.statusText} for video ${videoId}. Body snippet: ${snippet}`);
      throw new Error(`Innertube HTTP ${playerRes.status} ${playerRes.statusText}. Детали ответа: ${snippet}`);
    }

    let playerData;
    try {
      const rawText = await playerRes.text();
      try {
         playerData = JSON.parse(rawText);
      } catch(e) {
         const snippet = rawText.substring(0, 500);
         console.error(`[Innertube Debug] Failed to parse JSON for ${videoId}. Body snippet: ${snippet}`);
         throw new Error(`Сбой парсинга ответа YouTube. Детали: ${snippet}`);
      }
    } catch(e) {
       throw e;
    }

    const captionTracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || !Array.isArray(captionTracks) || captionTracks.length === 0) {
      const playability = playerData.playabilityStatus?.status || 'unknown';
      const reason = playerData.playabilityStatus?.reason || playerData.playabilityStatus?.messages?.[0] || 'Unknown reason';
      
      console.error(`[Innertube Debug] No tracks for ${videoId}. Playability: ${playability}, Reason: ${reason}.`);
      
      throw new Error(`Отсутствуют субтитры. Статус: ${playability}. Причина: ${reason}`);
    }

    // Find best matching track: Russian (manual or auto) -> English -> First available
    let selectedTrack = captionTracks.find((t: any) => t.languageCode === 'ru' && !t.kind);
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((t: any) => t.languageCode === 'ru');
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((t: any) => t.languageCode === 'en');
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks[0];
    }

    if (!selectedTrack || !selectedTrack.baseUrl) {
      throw new Error('No valid track URL found among captionTracks');
    }

    // Fetch XML timedtext
    const captionFetchHeaders: Record<string, string> = {
      'User-Agent': headers['User-Agent'],
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
    };
    if (parsed.cookie && parsed.cookie.trim()) {
      captionFetchHeaders['Cookie'] = parsed.cookie.trim();
    }

    const xmlRes = await fetch(selectedTrack.baseUrl, { headers: captionFetchHeaders });
    if (!xmlRes.ok) {
      const trackErrText = await xmlRes.text();
      console.warn(`[Innertube] Failed to fetch caption track XML: ${xmlRes.status}`);
      throw new Error(`Failed to fetch XML timedtext. HTTP ${xmlRes.status}: ${trackErrText}`);
    }

    const xmlText = await xmlRes.text();
    if (!xmlText || xmlText.length < 20) return null;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const parsedXml = parser.parse(xmlText);
    const textNodes = parsedXml.transcript?.text;

    if (!textNodes) return null;

    const rawList = Array.isArray(textNodes) ? textNodes : [textNodes];
    const segments: TranscriptSegment[] = [];

    for (const node of rawList) {
      const rawText = typeof node === 'string' ? node : node['#text'] || '';
      const cleanText = cleanXmlCaptionText(rawText);
      if (!cleanText) continue;

      const startSec = parseFloat(node['@_start'] || '0');
      const durSec = parseFloat(node['@_dur'] || '2');

      segments.push({
        text: cleanText,
        offset: Math.round(startSec),
        duration: Math.round(durSec),
        formattedTime: formatSeconds(startSec),
      });
    }

    if (segments.length === 0) return null;

    const fullText = segments.map((s) => `[${s.formattedTime}] ${s.text}`).join('\n');
    return {
      text: fullText,
      segments,
    };
  } catch (err: any) {
    console.log(`[Innertube] Captions unavailable for ${videoId}: ${err.message || 'unknown error'}`);
    throw err;
  }
}

/**
 * Extracts transcript from YouTube video using the 3-tier Pyramid (A -> B -> C):
 * 1. Level A: Public auto-caption scraper (Fast, 0 tokens)
 * 2. Level B: Innertube session scraping with YouTube Cookies (Bypasses LOGIN_REQUIRED, 0 tokens)
 * 3. Level C: Gemini AI Video/Audio direct multimodal comprehension (Requires prompt/tokens)
 */
export async function extractVideoTranscript(
  videoId: string,
  videoTitle?: string,
  options?: {
    allowGeminiAudioFallback?: boolean;
    customCookie?: string;
    forcePaidModel?: boolean;
  }
): Promise<{
  text: string;
  segments: TranscriptSegment[];
  source: 'subtitles' | 'gemini_multimodal';
}> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const allowGeminiFallback = options?.allowGeminiAudioFallback ?? true;

  // Level A: Standard YoutubeTranscript scraper
  try {
    const rawSegments = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: 'ru',
    }).catch(async () => {
      return await YoutubeTranscript.fetchTranscript(videoId);
    });

    if (rawSegments && rawSegments.length > 0) {
      const segments: TranscriptSegment[] = rawSegments.map((item: any) => {
        const offsetSec = (item.offset || 0) / 1000;
        const durSec = (item.duration || 0) / 1000;
        return {
          text: cleanXmlCaptionText(item.text),
          offset: Math.round(offsetSec),
          duration: Math.round(durSec),
          formattedTime: formatSeconds(offsetSec),
        };
      });

      const fullText = segments.map((s) => `[${s.formattedTime}] ${s.text}`).join('\n');

      return {
        text: fullText,
        segments,
        source: 'subtitles',
      };
    }
  } catch {
    console.log(`[Transcript Level A] Public subtitles unavailable for ${videoId}. Trying Level B (Cookies / Innertube)...`);
  }

  
  let levelBError = '';
  // Level B: Direct Innertube Player API with YouTube Cookie session
  try {
    const innertubeResult = await fetchCaptionsViaInnertube(videoId, options?.customCookie);
    if (innertubeResult && innertubeResult.segments.length > 0) {
      if (innertubeResult.text.trim().length >= 50) {
        console.log(`[Transcript Level B] Successfully fetched ${innertubeResult.segments.length} caption segments via Innertube for ${videoId}!`);
        return {
          text: innertubeResult.text,
          segments: innertubeResult.segments,
          source: 'subtitles',
        };
      } else {
        console.log(`[Transcript Level B] Text too short (${innertubeResult.text.length} chars) for ${videoId}, falling back.`);
      }
    }
  } catch (innertubeErr: any) {
    levelBError = innertubeErr.message || String(innertubeErr);
    console.log(`[Transcript Level B] Innertube unavailable for ${videoId}: ${levelBError}`);
  }

  // Level C: Gemini AI Multimodal Video/Audio Comprehension (Always trigger if A and B fail, unless quota exceeded)
  if (allowGeminiFallback) {

    try {
      console.log(`[Transcript Level C] Running Gemini AI Multimodal comprehension for ${videoId}...`);
      const prompt = `Ты профессиональный транскрибатор и аналитик видео. 
Пожалуйста, внимательно проанализируй звуковую дорожку и видеоряд этого YouTube видео: ${videoUrl}
Название: "${videoTitle || 'YouTube Video'}"

Сделай полную, подробную и связную расшифровку (транскрипцию) речи из этого видео на русском языке (если язык оригинала другой, предоставь точную расшифровку и перевод).
Структурируй текст с временными метками в формате [ММ:СС] или [ЧЧ:ММ:СС] для каждой смысловой фразы или блока речи.`;

      const generatedText = await generateWithFallback([
        {
          text: prompt,
        },
      ], undefined, options?.forcePaidModel);

      let isAiRefusal = false;
      const t = generatedText.toLowerCase();
      isAiRefusal = [
        'к сожалению',
        'как языков',
        'как ии',
        'не имею прямого доступа',
        'нет прямого доступа',
        'как текстовая модель',
        'i cannot fulfill',
        'я не могу'
      ].some(phrase => t.includes(phrase));
      
      if (t.includes('я не могу') && !t.includes('видео')) {
        isAiRefusal = false;
      }

      if (isAiRefusal) {
        throw new Error('Субтитры отсутствуют или заблокированы YouTube (для видео без открытых субтитров добавьте YouTube Cookies в настройках)');
      }

      const segments: TranscriptSegment[] = [];
      const timestampRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?:\*\*)?\s*([^[\n]+)/g;
      let match;
      while ((match = timestampRegex.exec(generatedText)) !== null) {
        const timeStr = match[1];
        const text = match[2].trim().replace(/^\*\*|^\*|\*\*$/g, '').trim();
        if (text) {
          const parts = timeStr.split(':').map(Number);
          let seconds = 0;
          if (parts.length === 2) {
            seconds = parts[0] * 60 + parts[1];
          } else if (parts.length === 3) {
            seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
          }
          segments.push({
            offset: seconds,
            duration: 10,
            formattedTime: timeStr,
            text: text.replace(/^[:\-–—\s]+/, ''),
          });
        }
      }

      if (segments.length === 0 || generatedText.trim().length < 50) {
        throw new Error('Субтитры отсутствуют на YouTube. Невозможно продолжить анализ');
      }
      return {
        text: generatedText,
        segments,
        source: 'gemini_multimodal',
      };
    } catch (geminiErr: any) {
      console.warn('[Transcript Level C] Gemini video analysis fallback:', geminiErr.message || geminiErr);
      const errMsg = geminiErr.message || String(geminiErr);
      if (errMsg.includes('429') || errMsg.includes('Quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        const error: any = new Error(`Лимит запросов Gemini AI исчерпан (429): ${errMsg}`);
        error.isQuotaExceeded = true;
        throw error;
      }
      if (errMsg.includes('Субтитры отсутствуют') || errMsg.includes('заглушка/отказ от ИИ') || errMsg.includes('заблокированы')) {
        throw new Error('Субтитры отсутствуют или заблокированы YouTube (для видео без открытых субтитров добавьте YouTube Cookies в настройках)');
      }
      throw new Error(`Не удалось транскрибировать видео: ${errMsg}`);
    }
  }

  throw new Error(
    `Субтитры недоступны на YouTube (или заблокированы).${levelBError ? '\nУровень Б (Cookies) упал с ошибкой: ' + levelBError : ''}\nДобавьте валидные YouTube Cookies в настройках (Уровень Б) либо запустите AI Аудио-расшифровку (Уровень В).`
  );
}

export async function validateYoutubeCookies(rawCookie: string): Promise<{ valid: boolean; message: string }> {
  if (!rawCookie || !rawCookie.trim()) {
    return { valid: false, message: 'Поле cookies пустое' };
  }
  const parsed = parseYoutubeSessionHeaders(rawCookie);
  if (!parsed.cookie || parsed.cookie.length < 10) {
    return { valid: false, message: 'Не найдены корректные куки или заголовок Cookie' };
  }

  const hasSid = parsed.cookie.includes('SID=') || parsed.cookie.includes('__Secure-1PSID=');
  const hasLoginInfo = parsed.cookie.includes('LOGIN_INFO=');
  const hasNetscape = rawCookie.includes('.youtube.com') || rawCookie.includes('Netscape HTTP Cookie File');

  if (!hasSid && !hasLoginInfo && !hasNetscape) {
    return { 
      valid: false, 
      message: 'Формат не распознан: куки должны содержать токены авторизации YouTube (SID / LOGIN_INFO) или соответствовать формату Netscape.' 
    };
  }

  return { 
    valid: true, 
    message: 'Куки успешно прошли проверку и содержат необходимые токены авторизации YouTube!' 
  };
}

