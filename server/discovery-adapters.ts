import { RadarDiscoveryCandidateRecord, RadarDiscoverySourceType } from './storage.js';
import { searchYouTubeVideosDetailed } from './youtube.js';
import { isAnyWebSearchConfigured, searchWebCostAware } from './search-router.js';

export interface DiscoverySearchRequest {
  ownerId: string;
  sourceType: RadarDiscoverySourceType;
  query: string;
  limit: number;
}

export interface DiscoverySearchResult {
  sourceType: RadarDiscoverySourceType;
  provider: string;
  configured: boolean;
  candidates: RadarDiscoveryCandidateRecord[];
  error?: string;
  reasonCode?: string;
  primaryProvider?: string;
  fallbackProvider?: string;
  recovered?: boolean;
}

export interface DiscoverySourceAdapter {
  sourceType: RadarDiscoverySourceType;
  isConfigured(): boolean;
  search(request: DiscoverySearchRequest): Promise<DiscoverySearchResult>;
}

function normalizeDiscoveryError(error?: string): string | undefined {
  if (!error) return undefined;
  const value = error.toLowerCase();
  if (value.includes('quota') || value.includes('429') || value.includes('resource_exhausted')) return 'quota_exhausted';
  if (value.includes('api key not valid') || value.includes('invalid key') || value.includes('keyinvalid') || value.includes('invalid_api_key')) return 'invalid_api_key';
  if (value.includes('403')) return 'http_403';
  if (value.includes('429')) return 'http_429';
  if (value.includes('404')) return 'http_404';
  if (value.includes('503') || value.includes('unavailable')) return 'provider_unavailable';
  return 'provider_error';
}

function createYouTubeCandidate(
  ownerId: string,
  query: string,
  video: {
    id: string;
    title: string;
    channelTitle: string;
    channelId: string;
    url: string;
    thumbnail?: string;
    publishedAt?: string;
    description?: string;
    viewCount?: number;
    likeCount?: number;
    commentCount?: number;
  },
): RadarDiscoveryCandidateRecord {
  return {
    id: `rdc-${video.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ownerId,
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
    viewCount: video.viewCount,
    likeCount: video.likeCount,
    commentCount: video.commentCount,
    query,
    createdAt: new Date().toISOString(),
  };
}

export const youtubeDiscoveryAdapter: DiscoverySourceAdapter = {
  sourceType: 'youtube',
  isConfigured() {
    return Boolean(process.env.YOUTUBE_API_KEY?.trim());
  },
  async search(request) {
    const result = await searchYouTubeVideosDetailed(request.query, request.limit);
    const candidates = result.videos.map((video) => createYouTubeCandidate(request.ownerId, request.query, video));
    const usedFallback = result.provider === 'youtube_web_fallback';
    return {
      sourceType: 'youtube',
      provider: result.provider,
      configured: result.apiConfigured,
      candidates,
      error: result.apiError,
      reasonCode: normalizeDiscoveryError(result.apiError),
      primaryProvider: 'youtube_api',
      fallbackProvider: usedFallback ? 'youtube_web_fallback' : undefined,
      recovered: Boolean(result.apiError && usedFallback && candidates.length > 0),
    };
  },
};

function createDisabledAdapter(sourceType: 'web' | 'x'): DiscoverySourceAdapter {
  return {
    sourceType,
    isConfigured() {
      return false;
    },
    async search() {
      return {
        sourceType,
        provider: 'not_configured',
        configured: false,
        candidates: [],
      };
    },
  };
}

export const webDiscoveryAdapter: DiscoverySourceAdapter = {
  sourceType: 'web',
  isConfigured() {
    return isAnyWebSearchConfigured();
  },
  async search(request) {
    const result = await searchWebCostAware({
      ownerId: request.ownerId,
      query: request.query,
      limit: request.limit,
    });
    return {
      sourceType: 'web',
      provider: result.provider,
      configured: result.configured,
      candidates: result.candidates,
      error: result.error,
      reasonCode: result.reasonCode,
      primaryProvider: result.primaryProvider,
      fallbackProvider: result.fallbackProvider,
      recovered: result.recovered,
    };
  },
};
export const xDiscoveryAdapter = createDisabledAdapter('x');

export const DISCOVERY_SOURCE_ADAPTERS: Record<Exclude<RadarDiscoverySourceType, 'manual'>, DiscoverySourceAdapter> = {
  youtube: youtubeDiscoveryAdapter,
  web: webDiscoveryAdapter,
  x: xDiscoveryAdapter,
};

export function getDiscoverySourceAdapter(sourceType: 'youtube' | 'web' | 'x'): DiscoverySourceAdapter {
  return DISCOVERY_SOURCE_ADAPTERS[sourceType];
}


export function getDiscoverySourceAvailability() {
  return (['youtube', 'web', 'x'] as const).map(sourceType => {
    const adapter = DISCOVERY_SOURCE_ADAPTERS[sourceType];
    return {
      sourceType,
      available: adapter.isConfigured(),
    };
  });
}
