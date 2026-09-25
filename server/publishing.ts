import { getDb, getDefaultOwnerId, PublicationJob, PublicationPlatform, saveDb } from './storage.js';

const ACTIVE_STATUSES = new Set<PublicationJob['status']>(['draft', 'queued', 'uploading', 'processing']);

function nowIso() {
  return new Date().toISOString();
}

export async function getPublicationJobs(ownerId: string | undefined): Promise<PublicationJob[]> {
  const id = getDefaultOwnerId(ownerId);
  const db = await getDb();
  return (db.publicationJobs || [])
    .filter(job => job.ownerId === id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getScriptPublicationJobs(ownerId: string | undefined, scriptId: string): Promise<PublicationJob[]> {
  const id = getDefaultOwnerId(ownerId);
  const db = await getDb();
  return (db.publicationJobs || [])
    .filter(job => job.ownerId === id && job.scriptId === scriptId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function createPublicationJob(
  ownerId: string | undefined,
  scriptId: string,
  input: {
    platform: PublicationPlatform;
    scheduledAt?: string;
    timeZone?: string;
    mediaName?: string;
    mediaType?: string;
    thumbnailName?: string;
    thumbnailType?: string;
    title?: string;
    description?: string;
    privacyStatus?: 'public' | 'unlisted' | 'private';
    madeForKids?: boolean;
    containsSyntheticMedia?: boolean;
    instagramShareToFeed?: boolean;
    tiktokPrivacyLevel?: string;
    tiktokDisableComment?: boolean;
    tiktokDisableDuet?: boolean;
    tiktokDisableStitch?: boolean;
    tiktokBrandContentToggle?: boolean;
    tiktokBrandOrganicToggle?: boolean;
    mediaObjectPath?: string;
    thumbnailObjectPath?: string;
  }
): Promise<PublicationJob> {
  const id = getDefaultOwnerId(ownerId);
  const db = await getDb();
  const script = (db.scripts || []).find(item => item.id === scriptId && item.ownerId === id);
  if (!script) {
    const error: any = new Error('SCRIPT_NOT_FOUND');
    error.code = 'SCRIPT_NOT_FOUND';
    throw error;
  }

  if (!['youtube', 'instagram', 'tiktok'].includes(input.platform)) {
    const error: any = new Error('PUBLICATION_PLATFORM_UNSUPPORTED');
    error.code = 'PUBLICATION_PLATFORM_UNSUPPORTED';
    throw error;
  }

  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    const error: any = new Error('PUBLICATION_DATE_INVALID');
    error.code = 'PUBLICATION_DATE_INVALID';
    throw error;
  }

  if (!db.publicationJobs) db.publicationJobs = [];

  const existing = db.publicationJobs.find(job =>
    job.ownerId === id &&
    job.scriptId === scriptId &&
    job.platform === input.platform &&
    ACTIVE_STATUSES.has(job.status)
  );
  if (existing) {
    if (input.scheduledAt !== undefined) existing.scheduledAt = scheduledAt?.toISOString();
    if (input.timeZone !== undefined) existing.timeZone = input.timeZone?.slice(0, 100);
    if (input.mediaName !== undefined) existing.mediaName = input.mediaName?.slice(0, 300);
    if (input.mediaType !== undefined) existing.mediaType = input.mediaType?.slice(0, 120);
    if (input.thumbnailName !== undefined) existing.thumbnailName = input.thumbnailName?.slice(0, 300);
    if (input.thumbnailType !== undefined) existing.thumbnailType = input.thumbnailType?.slice(0, 120);
    if (input.title !== undefined) existing.title = input.title?.slice(0, 100);
    if (input.description !== undefined) existing.description = input.description?.slice(0, 5000);
    if (input.privacyStatus !== undefined) existing.privacyStatus = input.privacyStatus;
    if (input.madeForKids !== undefined) existing.madeForKids = input.madeForKids;
    if (input.containsSyntheticMedia !== undefined) existing.containsSyntheticMedia = input.containsSyntheticMedia;
    if (input.instagramShareToFeed !== undefined) existing.instagramShareToFeed = input.instagramShareToFeed;
    if (input.tiktokPrivacyLevel !== undefined) existing.tiktokPrivacyLevel = input.tiktokPrivacyLevel?.slice(0, 80);
    if (input.tiktokDisableComment !== undefined) existing.tiktokDisableComment = input.tiktokDisableComment;
    if (input.tiktokDisableDuet !== undefined) existing.tiktokDisableDuet = input.tiktokDisableDuet;
    if (input.tiktokDisableStitch !== undefined) existing.tiktokDisableStitch = input.tiktokDisableStitch;
    if (input.tiktokBrandContentToggle !== undefined) existing.tiktokBrandContentToggle = input.tiktokBrandContentToggle;
    if (input.tiktokBrandOrganicToggle !== undefined) existing.tiktokBrandOrganicToggle = input.tiktokBrandOrganicToggle;
    if (input.mediaObjectPath !== undefined) existing.mediaObjectPath = input.mediaObjectPath;
    if (input.thumbnailObjectPath !== undefined) existing.thumbnailObjectPath = input.thumbnailObjectPath;
    existing.updatedAt = nowIso();
    await saveDb();
    return existing;
  }

  const now = nowIso();
  const job: PublicationJob = {
    id: `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ownerId: id,
    scriptId,
    platform: input.platform,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    scheduledAt: scheduledAt?.toISOString(),
    timeZone: input.timeZone?.slice(0, 100),
    mediaName: input.mediaName?.slice(0, 300),
    mediaType: input.mediaType?.slice(0, 120),
    thumbnailName: input.thumbnailName?.slice(0, 300),
    thumbnailType: input.thumbnailType?.slice(0, 120),
    title: input.title?.slice(0, 100),
    description: input.description?.slice(0, 5000),
    privacyStatus: input.privacyStatus,
    madeForKids: input.madeForKids,
    containsSyntheticMedia: input.containsSyntheticMedia,
    instagramShareToFeed: input.instagramShareToFeed,
    tiktokPrivacyLevel: input.tiktokPrivacyLevel?.slice(0, 80),
    tiktokDisableComment: input.tiktokDisableComment,
    tiktokDisableDuet: input.tiktokDisableDuet,
    tiktokDisableStitch: input.tiktokDisableStitch,
    tiktokBrandContentToggle: input.tiktokBrandContentToggle,
    tiktokBrandOrganicToggle: input.tiktokBrandOrganicToggle,
    mediaObjectPath: input.mediaObjectPath,
    thumbnailObjectPath: input.thumbnailObjectPath,
  };
  db.publicationJobs.unshift(job);
  await saveDb();
  return job;
}

export async function updatePublicationJob(
  ownerId: string | undefined,
  jobId: string,
  input: Partial<Pick<PublicationJob, 'status' | 'scheduledAt' | 'timeZone' | 'title' | 'description' | 'privacyStatus' | 'madeForKids' | 'containsSyntheticMedia' | 'instagramShareToFeed' | 'tiktokPrivacyLevel' | 'tiktokDisableComment' | 'tiktokDisableDuet' | 'tiktokDisableStitch' | 'tiktokBrandContentToggle' | 'tiktokBrandOrganicToggle' | 'thumbnailName' | 'thumbnailType' | 'mediaObjectPath' | 'thumbnailObjectPath' | 'providerContainerId' | 'remoteId' | 'remoteUrl' | 'errorCode' | 'errorMessage'>>
): Promise<PublicationJob | null> {
  const id = getDefaultOwnerId(ownerId);
  const db = await getDb();
  const job = (db.publicationJobs || []).find(item => item.id === jobId && item.ownerId === id);
  if (!job) return null;

  if (input.scheduledAt !== undefined) {
    const parsed = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (parsed && Number.isNaN(parsed.getTime())) {
      const error: any = new Error('PUBLICATION_DATE_INVALID');
      error.code = 'PUBLICATION_DATE_INVALID';
      throw error;
    }
    job.scheduledAt = parsed?.toISOString();
  }

  if (input.status) job.status = input.status;
  if (input.timeZone !== undefined) job.timeZone = input.timeZone?.slice(0, 100) || undefined;
  if (input.title !== undefined) job.title = input.title?.slice(0, 100) || undefined;
  if (input.description !== undefined) job.description = input.description?.slice(0, 5000) || undefined;
  if (input.privacyStatus !== undefined) job.privacyStatus = input.privacyStatus;
  if (input.madeForKids !== undefined) job.madeForKids = input.madeForKids;
  if (input.containsSyntheticMedia !== undefined) job.containsSyntheticMedia = input.containsSyntheticMedia;
  if (input.instagramShareToFeed !== undefined) job.instagramShareToFeed = input.instagramShareToFeed;
  if (input.tiktokPrivacyLevel !== undefined) job.tiktokPrivacyLevel = input.tiktokPrivacyLevel?.slice(0, 80) || undefined;
  if (input.tiktokDisableComment !== undefined) job.tiktokDisableComment = input.tiktokDisableComment;
  if (input.tiktokDisableDuet !== undefined) job.tiktokDisableDuet = input.tiktokDisableDuet;
  if (input.tiktokDisableStitch !== undefined) job.tiktokDisableStitch = input.tiktokDisableStitch;
  if (input.tiktokBrandContentToggle !== undefined) job.tiktokBrandContentToggle = input.tiktokBrandContentToggle;
  if (input.tiktokBrandOrganicToggle !== undefined) job.tiktokBrandOrganicToggle = input.tiktokBrandOrganicToggle;
  if (input.mediaObjectPath !== undefined) job.mediaObjectPath = input.mediaObjectPath || undefined;
  if (input.thumbnailObjectPath !== undefined) job.thumbnailObjectPath = input.thumbnailObjectPath || undefined;
  if (input.providerContainerId !== undefined) job.providerContainerId = input.providerContainerId || undefined;
  if (input.thumbnailName !== undefined) job.thumbnailName = input.thumbnailName?.slice(0, 300) || undefined;
  if (input.thumbnailType !== undefined) job.thumbnailType = input.thumbnailType?.slice(0, 120) || undefined;
  if (input.remoteId !== undefined) job.remoteId = input.remoteId || undefined;
  if (input.remoteUrl !== undefined) job.remoteUrl = input.remoteUrl || undefined;
  if (input.errorCode !== undefined) job.errorCode = input.errorCode || undefined;
  if (input.errorMessage !== undefined) job.errorMessage = input.errorMessage?.slice(0, 1000) || undefined;
  job.updatedAt = nowIso();

  if (job.status === 'published') {
    const script = (db.scripts || []).find(item => item.id === job.scriptId && item.ownerId === id);
    if (script) {
      script.isReviewed = true;
      script.isPublished = true;
      script.publishedAt = job.updatedAt;
      script.publicationPlatform = job.platform;
      script.archivedAt = undefined;
    }
  }

  await saveDb();
  return job;
}


export async function deletePublicationJob(ownerId: string | undefined, jobId: string): Promise<boolean> {
  const id = getDefaultOwnerId(ownerId);
  const db = await getDb();
  const before = (db.publicationJobs || []).length;
  db.publicationJobs = (db.publicationJobs || []).filter(job => !(job.id === jobId && job.ownerId === id));
  if (db.publicationJobs.length === before) return false;
  await saveDb();
  return true;
}
