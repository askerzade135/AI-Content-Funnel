import { RadarDiscoveryCandidateRecord, RadarDiscoverySourceType } from './storage.js';
import { searchYouTubeVideosDetailed } from './youtube.js';

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
}

export interface DiscoverySourceAdapter {
  sourceType: RadarDiscoverySourceType;
  isConfigured(): boolean;
  search(request: DiscoverySearchRequest): Promise<DiscoverySearchResult>;
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
    return {
      sourceType: 'youtube',
      provider: result.provider,
      configured: result.apiConfigured,
      candidates: result.videos.map((video) => createYouTubeCandidate(request.ownerId, request.query, video)),
      error: result.apiError,
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

export const webDiscoveryAdapter = createDisabledAdapter('web');
export const xDiscoveryAdapter = createDisabledAdapter('x');

export const DISCOVERY_SOURCE_ADAPTERS: Record<Exclude<RadarDiscoverySourceType, 'manual'>, DiscoverySourceAdapter> = {
  youtube: youtubeDiscoveryAdapter,
  web: webDiscoveryAdapter,
  x: xDiscoveryAdapter,
};

export function getDiscoverySourceAdapter(sourceType: 'youtube' | 'web' | 'x'): DiscoverySourceAdapter {
  return DISCOVERY_SOURCE_ADAPTERS[sourceType];
}
