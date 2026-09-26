import { getDb, getDefaultOwnerId, PublicationJob, saveDb } from './storage.js';
import { createPublicationReadUrl, downloadPublicationMediaRange, deletePublicationMedia } from './publication-media.js';
import { getSocialAccessToken, getSocialIntegration } from './social-integrations.js';

const TIKTOK_MAX_CHUNK_BYTES = 64 * 1024 * 1024;

function graphVersion() {
  return String(process.env.INSTAGRAM_GRAPH_VERSION || 'v24.0').replace(/^\/+|\/+$/g, '');
}

function instagramBaseUrl() {
  return `https://graph.instagram.com/${graphVersion()}`;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateJob(ownerId: string, jobId: string, patch: Partial<PublicationJob>): Promise<PublicationJob> {
  const db = await getDb();
  const job = (db.publicationJobs || []).find(item => item.ownerId === ownerId && item.id === jobId);
  if (!job) throw new Error('PUBLICATION_JOB_NOT_FOUND');
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  await saveDb();
  return job;
}

async function publishInstagram(ownerId: string, job: PublicationJob): Promise<PublicationJob> {
  const token = await getSocialAccessToken(ownerId, 'instagram');
  const integration = await getSocialIntegration(ownerId, 'instagram');
  if (!token || !integration) throw new Error('INSTAGRAM_CONNECTION_REQUIRED');
  if (!job.mediaObjectPath) throw new Error('PUBLICATION_MEDIA_OBJECT_MISSING');

  const videoUrl = await createPublicationReadUrl(ownerId, job.mediaObjectPath, 3 * 60 * 60_000);
  const createUrl = new URL(`${instagramBaseUrl()}/${integration.accountId}/media`);
  createUrl.searchParams.set('media_type', 'REELS');
  createUrl.searchParams.set('video_url', videoUrl);
  createUrl.searchParams.set('caption', (job.description || '').slice(0, 2200));
  createUrl.searchParams.set('share_to_feed', job.instagramShareToFeed === false ? 'false' : 'true');
  createUrl.searchParams.set('access_token', token);

  const createResponse = await fetch(createUrl, { method: 'POST' });
  const createBody: any = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok || !createBody?.id) {
    const error: any = new Error(createBody?.error?.message || 'INSTAGRAM_CONTAINER_CREATE_FAILED');
    error.code = createBody?.error?.code || 'INSTAGRAM_CONTAINER_CREATE_FAILED';
    throw error;
  }

  const containerId = String(createBody.id);
  await updateJob(ownerId, job.id, { status: 'processing', providerContainerId: containerId });

  let statusCode = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    const statusUrl = new URL(`${instagramBaseUrl()}/${containerId}`);
    statusUrl.searchParams.set('fields', 'status_code,status');
    statusUrl.searchParams.set('access_token', token);
    const statusResponse = await fetch(statusUrl);
    const statusBody: any = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) {
      const error: any = new Error(statusBody?.error?.message || 'INSTAGRAM_CONTAINER_STATUS_FAILED');
      error.code = statusBody?.error?.code || 'INSTAGRAM_CONTAINER_STATUS_FAILED';
      throw error;
    }
    statusCode = String(statusBody?.status_code || '');
    if (statusCode === 'FINISHED') break;
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(`INSTAGRAM_CONTAINER_${statusCode}`);
    }
    await sleep(2000);
  }
  if (statusCode !== 'FINISHED') throw new Error('INSTAGRAM_CONTAINER_PROCESSING_TIMEOUT');

  const publishUrl = new URL(`${instagramBaseUrl()}/${integration.accountId}/media_publish`);
  publishUrl.searchParams.set('creation_id', containerId);
  publishUrl.searchParams.set('access_token', token);
  const publishResponse = await fetch(publishUrl, { method: 'POST' });
  const publishBody: any = await publishResponse.json().catch(() => ({}));
  if (!publishResponse.ok || !publishBody?.id) {
    const error: any = new Error(publishBody?.error?.message || 'INSTAGRAM_PUBLISH_FAILED');
    error.code = publishBody?.error?.code || 'INSTAGRAM_PUBLISH_FAILED';
    throw error;
  }

  const mediaId = String(publishBody.id);
  let remoteUrl: string | undefined;
  try {
    const mediaUrl = new URL(`${instagramBaseUrl()}/${mediaId}`);
    mediaUrl.searchParams.set('fields', 'permalink');
    mediaUrl.searchParams.set('access_token', token);
    const mediaResponse = await fetch(mediaUrl);
    const mediaBody: any = await mediaResponse.json().catch(() => ({}));
    if (mediaResponse.ok && mediaBody?.permalink) remoteUrl = String(mediaBody.permalink);
  } catch {
    // A successful publish must not be downgraded because permalink lookup failed.
  }
  const published = await updateJob(ownerId, job.id, {
    status: 'published',
    remoteId: mediaId,
    remoteUrl,
    providerContainerId: containerId,
    errorCode: undefined,
    errorMessage: undefined,
  });
  await deletePublicationMedia(ownerId, job.mediaObjectPath);
  return published;
}

function tikTokChunkPlan(size: number): { chunkSize: number; totalChunkCount: number } {
  if (!Number.isFinite(size) || size <= 0) throw new Error('TIKTOK_VIDEO_SIZE_INVALID');
  if (size <= TIKTOK_MAX_CHUNK_BYTES) return { chunkSize: size, totalChunkCount: 1 };
  const totalChunkCount = Math.ceil(size / TIKTOK_MAX_CHUNK_BYTES);
  return {
    chunkSize: Math.ceil(size / totalChunkCount),
    totalChunkCount,
  };
}

async function publishTikTok(ownerId: string, job: PublicationJob): Promise<PublicationJob> {
  const token = await getSocialAccessToken(ownerId, 'tiktok');
  if (!token) throw new Error('TIKTOK_CONNECTION_REQUIRED');
  if (!job.mediaObjectPath || !job.mediaSize) throw new Error('PUBLICATION_MEDIA_OBJECT_MISSING');

  const audited = String(process.env.TIKTOK_AUDITED || '').toLowerCase() === 'true';
  const privacyLevel = audited ? (job.tiktokPrivacyLevel || 'SELF_ONLY') : 'SELF_ONLY';
  const { chunkSize, totalChunkCount } = tikTokChunkPlan(job.mediaSize);

  const initResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: (job.description || '').slice(0, 2200),
        privacy_level: privacyLevel,
        disable_duet: Boolean(job.tiktokDisableDuet),
        disable_comment: Boolean(job.tiktokDisableComment),
        disable_stitch: Boolean(job.tiktokDisableStitch),
        video_cover_timestamp_ms: 0,
        brand_content_toggle: Boolean(job.tiktokBrandContentToggle),
        brand_organic_toggle: Boolean(job.tiktokBrandOrganicToggle),
        is_aigc: Boolean(job.containsSyntheticMedia),
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: job.mediaSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }),
  });
  const initBody: any = await initResponse.json().catch(() => ({}));
  if (!initResponse.ok || initBody?.error?.code && initBody.error.code !== 'ok' || !initBody?.data?.upload_url) {
    const error: any = new Error(initBody?.error?.message || 'TIKTOK_POST_INIT_FAILED');
    error.code = initBody?.error?.code || 'TIKTOK_POST_INIT_FAILED';
    throw error;
  }

  const publishId = String(initBody.data.publish_id || '');
  const uploadUrl = String(initBody.data.upload_url);
  await updateJob(ownerId, job.id, { status: 'uploading', providerContainerId: publishId || undefined });

  let start = 0;
  for (let index = 0; index < totalChunkCount; index++) {
    const isLast = index === totalChunkCount - 1;
    const end = isLast ? job.mediaSize - 1 : Math.min(job.mediaSize - 1, start + chunkSize - 1);
    const chunk = await downloadPublicationMediaRange(ownerId, job.mediaObjectPath, start, end);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': job.mediaType || 'video/mp4',
        'Content-Length': String(chunk.byteLength),
        'Content-Range': `bytes ${start}-${end}/${job.mediaSize}`,
      },
      body: chunk,
    });
    const expected = isLast ? 201 : 206;
    if (response.status !== expected && !(isLast && response.ok)) {
      const text = await response.text().catch(() => '');
      const error: any = new Error(text || `TIKTOK_UPLOAD_FAILED_${response.status}`);
      error.code = 'TIKTOK_UPLOAD_FAILED';
      throw error;
    }
    start = end + 1;
  }

  const updated = await updateJob(ownerId, job.id, {
    status: 'processing',
    remoteId: publishId || undefined,
    providerContainerId: publishId || undefined,
    errorCode: undefined,
    errorMessage: undefined,
  });
  await deletePublicationMedia(ownerId, job.mediaObjectPath);
  return updated;
}

export async function publishSocialPublication(ownerId: string | undefined, jobId: string): Promise<PublicationJob> {
  const id = getDefaultOwnerId(ownerId);
  const db = await getDb();
  const job = (db.publicationJobs || []).find(item => item.ownerId === id && item.id === jobId);
  if (!job) throw new Error('PUBLICATION_JOB_NOT_FOUND');
  if (job.platform !== 'instagram' && job.platform !== 'tiktok') throw new Error('SOCIAL_PUBLICATION_PLATFORM_REQUIRED');
  if (job.status === 'published') return job;

  const scheduledAt = job.scheduledAt ? new Date(job.scheduledAt).getTime() : 0;
  if (scheduledAt && scheduledAt > Date.now()) {
    return updateJob(id, job.id, { status: 'queued' });
  }

  try {
    return job.platform === 'instagram'
      ? await publishInstagram(id, job)
      : await publishTikTok(id, job);
  } catch (error: any) {
    await updateJob(id, job.id, {
      status: 'failed',
      errorCode: error?.code || 'SOCIAL_PUBLISH_FAILED',
      errorMessage: error?.message || String(error),
    }).catch(() => undefined);
    throw error;
  }
}

export async function refreshTikTokPublication(ownerId: string | undefined, jobId: string): Promise<PublicationJob> {
  const id = getDefaultOwnerId(ownerId);
  const db = await getDb();
  const job = (db.publicationJobs || []).find(item => item.ownerId === id && item.id === jobId);
  if (!job) throw new Error('PUBLICATION_JOB_NOT_FOUND');
  if (job.platform !== 'tiktok') throw new Error('TIKTOK_PUBLICATION_REQUIRED');
  const publishId = job.providerContainerId || job.remoteId;
  if (!publishId) throw new Error('TIKTOK_PUBLISH_ID_MISSING');

  const token = await getSocialAccessToken(id, 'tiktok');
  const integration = await getSocialIntegration(id, 'tiktok');
  if (!token || !integration) throw new Error('TIKTOK_CONNECTION_REQUIRED');

  const response = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || body?.error?.code && body.error.code !== 'ok') {
    const error: any = new Error(body?.error?.message || 'TIKTOK_STATUS_FETCH_FAILED');
    error.code = body?.error?.code || 'TIKTOK_STATUS_FETCH_FAILED';
    throw error;
  }

  const data = body?.data || {};
  const status = String(data.status || '');
  if (status === 'FAILED') {
    return updateJob(id, job.id, {
      status: 'failed',
      errorCode: String(data.fail_reason || 'TIKTOK_PUBLISH_FAILED'),
      errorMessage: String(data.fail_reason || 'TikTok failed to publish the video'),
    });
  }

  if (status === 'PUBLISH_COMPLETE') {
    const publicIds = Array.isArray(data.publicaly_available_post_id)
      ? data.publicaly_available_post_id.map(String).filter(Boolean)
      : [];
    const postId = publicIds[0];
    const remoteUrl = postId && integration.username
      ? `https://www.tiktok.com/@${encodeURIComponent(integration.username)}/video/${encodeURIComponent(postId)}`
      : undefined;
    return updateJob(id, job.id, {
      status: 'published',
      remoteId: postId || publishId,
      remoteUrl,
      errorCode: undefined,
      errorMessage: undefined,
    });
  }

  return updateJob(id, job.id, {
    status: 'processing',
    errorCode: undefined,
    errorMessage: undefined,
  });
}

export async function processDueSocialPublications(): Promise<{ attempted: number; published: number; failed: number; refreshed: number }> {
  const db = await getDb();
  const now = Date.now();
  const due = (db.publicationJobs || []).filter(job =>
    (job.platform === 'instagram' || job.platform === 'tiktok') &&
    (job.status === 'draft' || job.status === 'queued') &&
    Boolean(job.mediaObjectPath) &&
    (!job.scheduledAt || new Date(job.scheduledAt).getTime() <= now)
  );
  const processingTikTok = (db.publicationJobs || []).filter(job =>
    job.platform === 'tiktok' &&
    job.status === 'processing' &&
    Boolean(job.providerContainerId || job.remoteId) &&
    now - new Date(job.updatedAt).getTime() >= 15_000
  );

  let published = 0;
  let failed = 0;
  let refreshed = 0;
  for (const job of due) {
    try {
      const result = await publishSocialPublication(job.ownerId, job.id);
      if (result.status === 'published' || result.status === 'processing') published++;
    } catch (error) {
      failed++;
      console.error('[Social publishing] Failed', job.id, error);
    }
  }
  for (const job of processingTikTok) {
    try {
      const result = await refreshTikTokPublication(job.ownerId, job.id);
      refreshed++;
      if (result.status === 'published') published++;
      if (result.status === 'failed') failed++;
    } catch (error) {
      console.error('[TikTok status] Refresh failed', job.id, error);
    }
  }
  return { attempted: due.length, published, failed, refreshed };
}
