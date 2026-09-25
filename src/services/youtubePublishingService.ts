import { connectYouTube, getYouTubePublishingAccessToken } from './googleAuth';

export interface YouTubeChannelIdentity {
  id: string;
  title: string;
  thumbnail?: string;
}

export interface YouTubePublishInput {
  file: File;
  thumbnailFile?: File | null;
  title: string;
  description?: string;
  privacyStatus: 'public' | 'unlisted' | 'private';
  publishAt?: string;
  madeForKids?: boolean;
  containsSyntheticMedia?: boolean;
}

export interface YouTubePublishResult {
  videoId: string;
  url: string;
}

async function requireToken(): Promise<string> {
  const existing = await getYouTubePublishingAccessToken();
  if (existing) return existing;
  const connected = await connectYouTube();
  if (!connected?.accessToken) throw new Error('YOUTUBE_CONNECTION_REQUIRED');
  return connected.accessToken;
}

async function youtubeJson(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error: any = new Error(body?.error?.message || 'YOUTUBE_API_ERROR');
    error.code = body?.error?.errors?.[0]?.reason || body?.error?.status || 'YOUTUBE_API_ERROR';
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function getConnectedYouTubeChannel(): Promise<YouTubeChannelIdentity | null> {
  const token = await getYouTubePublishingAccessToken();
  if (!token) return null;
  try {
    const body = await youtubeJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1', token);
    const item = body?.items?.[0];
    if (!item?.id) return null;
    return {
      id: item.id,
      title: item.snippet?.title || 'YouTube',
      thumbnail: item.snippet?.thumbnails?.default?.url,
    };
  } catch {
    return null;
  }
}

export async function connectYouTubePublishing(): Promise<YouTubeChannelIdentity | null> {
  const connected = await connectYouTube();
  if (!connected?.accessToken) return null;
  const body = await youtubeJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1', connected.accessToken);
  const item = body?.items?.[0];
  if (!item?.id) return null;
  return {
    id: item.id,
    title: item.snippet?.title || 'YouTube',
    thumbnail: item.snippet?.thumbnails?.default?.url,
  };
}

async function setYouTubeThumbnail(videoId: string, file: File, token: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || 'image/jpeg',
      'Content-Length': String(file.size),
    },
    body: file,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error: any = new Error(body?.error?.message || 'YOUTUBE_THUMBNAIL_UPLOAD_FAILED');
    error.code = body?.error?.errors?.[0]?.reason || body?.error?.status || 'YOUTUBE_THUMBNAIL_UPLOAD_FAILED';
    error.status = response.status;
    throw error;
  }
}

export async function publishVideoToYouTube(input: YouTubePublishInput): Promise<YouTubePublishResult> {
  const token = await requireToken();
  const publishDate = input.publishAt ? new Date(input.publishAt) : null;
  if (publishDate && Number.isNaN(publishDate.getTime())) throw new Error('INVALID_PUBLISH_DATE');

  const status: Record<string, any> = {
    privacyStatus: publishDate && publishDate.getTime() > Date.now() ? 'private' : input.privacyStatus,
    selfDeclaredMadeForKids: Boolean(input.madeForKids),
  };
  if (publishDate && publishDate.getTime() > Date.now()) status.publishAt = publishDate.toISOString();
  if (input.containsSyntheticMedia !== undefined) status.containsSyntheticMedia = Boolean(input.containsSyntheticMedia);

  const metadata = {
    snippet: {
      title: input.title.slice(0, 100),
      description: (input.description || '').slice(0, 5000),
      categoryId: '22',
    },
    status,
  };

  const initResponse = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(input.file.size),
      'X-Upload-Content-Type': input.file.type || 'video/*',
    },
    body: JSON.stringify(metadata),
  });

  if (!initResponse.ok) {
    const body = await initResponse.json().catch(() => ({}));
    const error: any = new Error(body?.error?.message || 'YOUTUBE_UPLOAD_INIT_FAILED');
    error.code = body?.error?.errors?.[0]?.reason || body?.error?.status || 'YOUTUBE_UPLOAD_INIT_FAILED';
    error.status = initResponse.status;
    throw error;
  }

  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) throw new Error('YOUTUBE_UPLOAD_URL_MISSING');

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': input.file.type || 'video/*',
      'Content-Length': String(input.file.size),
    },
    body: input.file,
  });
  const body = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !body?.id) {
    const error: any = new Error(body?.error?.message || 'YOUTUBE_UPLOAD_FAILED');
    error.code = body?.error?.errors?.[0]?.reason || body?.error?.status || 'YOUTUBE_UPLOAD_FAILED';
    error.status = uploadResponse.status;
    throw error;
  }

  if (input.thumbnailFile) {
    await setYouTubeThumbnail(body.id, input.thumbnailFile, token);
  }

  return { videoId: body.id, url: `https://www.youtube.com/watch?v=${body.id}` };
}
