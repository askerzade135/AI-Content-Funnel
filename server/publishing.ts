import { getDb, getDefaultOwnerId, PublicationJob, PublicationPlatform, saveDb } from './storage.js';

const ACTIVE_STATUSES = new Set<PublicationJob['status']>(['draft', 'queued', 'uploading', 'processing']);

function nowIso() {
  return new Date().toISOString();
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
    mediaName?: string;
    mediaType?: string;
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
  if (existing) return existing;

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
    mediaName: input.mediaName?.slice(0, 300),
    mediaType: input.mediaType?.slice(0, 120),
  };
  db.publicationJobs.unshift(job);
  await saveDb();
  return job;
}

export async function updatePublicationJob(
  ownerId: string | undefined,
  jobId: string,
  input: Partial<Pick<PublicationJob, 'status' | 'scheduledAt' | 'remoteId' | 'remoteUrl' | 'errorCode' | 'errorMessage'>>
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
