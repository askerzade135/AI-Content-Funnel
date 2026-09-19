import { getDb, saveDb, UserQuota, getDefaultOwnerId } from './storage.js';

export const DEFAULT_PRODUCT_QUOTAS = {
  transcripts: 50,
  transcriptMinutes: 300,
  radarAnalyses: 100,
  scriptGenerations: 10,
} as const;

function periodStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function getUserQuota(ownerId?: string): Promise<UserQuota & { limits: typeof DEFAULT_PRODUCT_QUOTAS }> {
  const db = await getDb();
  if (!db.userQuotas) db.userQuotas = {};
  const id = getDefaultOwnerId(ownerId);
  const currentPeriod = periodStart();
  const existing = db.userQuotas[id];
  if (!existing || existing.periodStart !== currentPeriod) {
    db.userQuotas[id] = {
      periodStart: currentPeriod,
      transcripts: 0,
      transcriptMinutes: 0,
      radarAnalyses: 0,
      scriptGenerations: 0,
    };
    await saveDb();
  }
  return { ...db.userQuotas[id], limits: DEFAULT_PRODUCT_QUOTAS };
}

export async function assertUserQuotaAvailable(
  ownerId: string | undefined,
  metric: keyof typeof DEFAULT_PRODUCT_QUOTAS,
  amount = 1,
): Promise<UserQuota & { limits: typeof DEFAULT_PRODUCT_QUOTAS }> {
  const current = await getUserQuota(ownerId);
  if (current[metric] + amount > current.limits[metric]) {
    const error: any = new Error(`Лимит продукта исчерпан: ${metric}`);
    error.code = 'PRODUCT_QUOTA_EXCEEDED';
    error.metric = metric;
    error.limit = current.limits[metric];
    throw error;
  }
  return current;
}

export async function consumeUserQuota(
  ownerId: string | undefined,
  metric: keyof typeof DEFAULT_PRODUCT_QUOTAS,
  amount = 1,
): Promise<UserQuota & { limits: typeof DEFAULT_PRODUCT_QUOTAS }> {
  const id = getDefaultOwnerId(ownerId);
  const current = await getUserQuota(id);
  if (current[metric] + amount > current.limits[metric]) {
    const error: any = new Error(`Лимит продукта исчерпан: ${metric}`);
    error.code = 'PRODUCT_QUOTA_EXCEEDED';
    error.metric = metric;
    error.limit = current.limits[metric];
    throw error;
  }
  const db = await getDb();
  const quota = db.userQuotas![id];
  quota[metric] += amount;
  await saveDb();
  return { ...quota, limits: DEFAULT_PRODUCT_QUOTAS };
}

export async function recordTranscriptUsage(ownerId: string | undefined, durationMinutes = 0) {
  const db = await getDb();
  const id = getDefaultOwnerId(ownerId);
  const current = await getUserQuota(id);
  const next = await consumeUserQuota(id, 'transcripts', 1);
  if (durationMinutes > 0) {
    if (next.transcriptMinutes + durationMinutes > next.limits.transcriptMinutes) {
      // Roll back the transcript counter if minute quota blocks the operation.
      db.userQuotas![id].transcripts = Math.max(0, db.userQuotas![id].transcripts - 1);
      await saveDb();
      const error: any = new Error('Лимит минут транскрипции исчерпан');
      error.code = 'PRODUCT_QUOTA_EXCEEDED';
      error.metric = 'transcriptMinutes';
      throw error;
    }
    db.userQuotas![id].transcriptMinutes += durationMinutes;
    await saveDb();
  }
  return await getUserQuota(id);
}
