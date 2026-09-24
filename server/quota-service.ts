import { getDb, getDefaultOwnerId, getSettingsForOwner } from './storage.js';
import { getUserQuota } from './quotas.js';
import { fetchSupadataLiveAccount } from './supadata.js';

export type ProviderId = 'supadata' | 'chocodata';
export type CredentialSource = 'platform' | 'byok';

export interface ProviderQuotaSnapshot {
  provider: ProviderId;
  keySource: CredentialSource;
  configured: boolean;
  available: boolean;
  source: 'live' | 'local_fallback' | 'unavailable';
  used: number | null;
  limit: number | null;
  remaining: number | null;
  resetAt?: string | null;
  checkedAt: string;
  plan?: string;
  message?: string;
}

export interface QuotaOverview {
  product: Awaited<ReturnType<typeof getUserQuota>>;
  providers: {
    supadata: { byok: ProviderQuotaSnapshot; platform: ProviderQuotaSnapshot };
    chocodata: { byok: ProviderQuotaSnapshot; platform: ProviderQuotaSnapshot };
  };
}

export async function getProviderCredential(
  provider: ProviderId,
  keySource: CredentialSource,
  ownerId?: string
): Promise<string | null> {
  if (keySource === 'platform') {
    const envName = provider === 'supadata' ? 'SUPADATA_API_KEY' : 'CHOCODATA_API_KEY';
    const value = process.env[envName];
    return value?.trim() || null;
  }

  const db = await getDb();
  const settings = getSettingsForOwner(db, ownerId);
  const value = provider === 'supadata' ? settings.supadataApiKey : settings.chocodataApiKey;
  return value?.trim() || null;
}

async function getLocalFallback(
  provider: ProviderId,
  keySource: CredentialSource,
  ownerId?: string
): Promise<ProviderQuotaSnapshot> {
  const apiKey = await getProviderCredential(provider, keySource, ownerId);
  const checkedAt = new Date().toISOString();
  if (!apiKey) {
    return {
      provider, keySource, configured: false, available: false,
      source: 'unavailable', used: null, limit: null, remaining: null, checkedAt,
      message: 'API key is not configured',
    };
  }

  const db = await getDb();
  const targetOwnerId = getDefaultOwnerId(ownerId);
  const logs = (db.transcriptUsageLogs || []).filter((l) =>
    (keySource === 'platform' || l.ownerId === targetOwnerId || (!l.ownerId && targetOwnerId === 'legacy-account-1')) &&
    l.provider === provider &&
    l.keySource === keySource
  );
  const latestQuotaError = [...logs].reverse().find((l) => l.status === 'quota_exceeded');
  const latestSuccess = [...logs].reverse().find((l) => l.status === 'success');
  const exhausted = Boolean(
    latestQuotaError &&
    (!latestSuccess || new Date(latestQuotaError.timestamp).getTime() > new Date(latestSuccess.timestamp).getTime())
  );
  const latestLiveQuota = [...logs].reverse().find((l) =>
    l.providerQuota &&
    (l.providerQuota.used !== null && l.providerQuota.used !== undefined ||
      l.providerQuota.limit !== null && l.providerQuota.limit !== undefined ||
      l.providerQuota.remaining !== null && l.providerQuota.remaining !== undefined)
  )?.providerQuota;

  if (latestLiveQuota) {
    const remaining = latestLiveQuota.remaining ?? null;
    return {
      provider,
      keySource,
      configured: true,
      available: remaining === null ? !exhausted : remaining > 0,
      source: 'live',
      used: latestLiveQuota.used ?? null,
      limit: latestLiveQuota.limit ?? null,
      remaining,
      resetAt: latestLiveQuota.resetAt ?? null,
      checkedAt,
      message: `Quota read from the latest ${provider} API response`,
    };
  }

  return {
    provider,
    keySource,
    configured: true,
    available: !exhausted,
    source: 'local_fallback',
    used: logs.filter((l) => l.status === 'success').length,
    limit: null,
    remaining: null,
    checkedAt,
    message: exhausted
      ? 'Last provider response reported exhausted quota'
      : 'No live quota snapshot has been observed yet; using local usage/error state',
  };
}

export async function getProviderQuotaSnapshot(
  provider: ProviderId,
  keySource: CredentialSource,
  ownerId?: string
): Promise<ProviderQuotaSnapshot> {
  const apiKey = await getProviderCredential(provider, keySource, ownerId);
  const checkedAt = new Date().toISOString();

  if (!apiKey) {
    return {
      provider, keySource, configured: false, available: false,
      source: 'unavailable', used: null, limit: null, remaining: null, checkedAt,
      message: 'API key is not configured',
    };
  }

  if (provider === 'supadata') {
    const live = await fetchSupadataLiveAccount(apiKey, ownerId).catch(() => null);
    if (live) {
      const limit = Number.isFinite(live.maxCredits) ? live.maxCredits : null;
      const used = Number.isFinite(live.usedCredits) ? live.usedCredits : null;
      const remaining = limit !== null && used !== null ? Math.max(0, limit - used) : null;
      return {
        provider,
        keySource,
        configured: true,
        available: remaining === null ? true : remaining > 0,
        source: 'live',
        used,
        limit,
        remaining,
        checkedAt,
        plan: live.plan,
      };
    }
  }

  return getLocalFallback(provider, keySource, ownerId);
}

export async function getQuotaOverview(ownerId?: string): Promise<QuotaOverview> {
  const [product, supadataByok, supadataPlatform, chocodataByok, chocodataPlatform] = await Promise.all([
    getUserQuota(ownerId),
    getProviderQuotaSnapshot('supadata', 'byok', ownerId),
    getProviderQuotaSnapshot('supadata', 'platform', ownerId),
    getProviderQuotaSnapshot('chocodata', 'byok', ownerId),
    getProviderQuotaSnapshot('chocodata', 'platform', ownerId),
  ]);

  return {
    product,
    providers: {
      supadata: { byok: supadataByok, platform: supadataPlatform },
      chocodata: { byok: chocodataByok, platform: chocodataPlatform },
    },
  };
}

export async function getTranscriptProviderRoutes(ownerId?: string) {
  const overview = await getQuotaOverview(ownerId);
  const ordered = [
    overview.providers.supadata.byok,
    overview.providers.chocodata.byok,
    overview.providers.supadata.platform,
    overview.providers.chocodata.platform,
  ];
  return ordered.filter((x) => x.configured && x.available);
}
