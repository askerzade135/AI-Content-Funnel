import crypto from 'crypto';
import { getDb, getDefaultOwnerId, saveDb, SocialIntegrationRecord } from './storage.js';

export type SocialPlatform = 'instagram' | 'tiktok';

export interface SocialIntegrationStatus {
  platform: SocialPlatform;
  configured: boolean;
  connected: boolean;
  accountId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  expiresAt?: string;
  audited?: boolean;
}

export interface TikTokCreatorInfo {
  creatorAvatarUrl?: string;
  creatorUsername?: string;
  creatorNickname?: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec?: number;
}

function appBaseUrl(): string {
  const value = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!value) throw new Error('APP_URL_REQUIRED_FOR_SOCIAL_OAUTH');
  return value;
}

function providerSecret(platform: SocialPlatform): string {
  const value = platform === 'instagram'
    ? process.env.INSTAGRAM_APP_SECRET
    : process.env.TIKTOK_CLIENT_SECRET;
  if (!value?.trim()) throw new Error(platform === 'instagram' ? 'INSTAGRAM_APP_SECRET_MISSING' : 'TIKTOK_CLIENT_SECRET_MISSING');
  return value.trim();
}

function providerClientId(platform: SocialPlatform): string {
  const value = platform === 'instagram'
    ? process.env.INSTAGRAM_APP_ID
    : process.env.TIKTOK_CLIENT_KEY;
  if (!value?.trim()) throw new Error(platform === 'instagram' ? 'INSTAGRAM_APP_ID_MISSING' : 'TIKTOK_CLIENT_KEY_MISSING');
  return value.trim();
}

function callbackUrl(platform: SocialPlatform): string {
  return `${appBaseUrl()}/api/oauth/${platform}/callback`;
}

function encodeState(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeState(state: string, secret: string): any {
  const [body, signature] = state.split('.');
  if (!body || !signature) throw new Error('OAUTH_STATE_INVALID');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error('OAUTH_STATE_INVALID');
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!parsed?.ownerId || !parsed?.platform || !parsed?.exp || Date.now() > Number(parsed.exp)) throw new Error('OAUTH_STATE_EXPIRED');
  return parsed;
}

function encryptionKey(platform: SocialPlatform): Buffer {
  return crypto.createHash('sha256').update(providerSecret(platform)).digest();
}

function encrypt(platform: SocialPlatform, value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(platform), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(part => part.toString('base64url')).join('.');
}

function decrypt(platform: SocialPlatform, value: string): string {
  const [ivText, tagText, encryptedText] = value.split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('SOCIAL_TOKEN_INVALID');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(platform), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function configured(platform: SocialPlatform): boolean {
  try {
    providerClientId(platform);
    providerSecret(platform);
    appBaseUrl();
    return true;
  } catch {
    return false;
  }
}

export function buildSocialOAuthUrl(ownerId: string | undefined, platform: SocialPlatform): string {
  const resolvedOwnerId = getDefaultOwnerId(ownerId);
  const secret = providerSecret(platform);
  const state = encodeState({
    ownerId: resolvedOwnerId,
    platform,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + 10 * 60_000,
  }, secret);

  if (platform === 'instagram') {
    const url = new URL('https://www.instagram.com/oauth/authorize');
    url.searchParams.set('client_id', providerClientId(platform));
    url.searchParams.set('redirect_uri', callbackUrl(platform));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'instagram_business_basic,instagram_business_content_publish');
    url.searchParams.set('enable_fb_login', '0');
    url.searchParams.set('force_authentication', '1');
    url.searchParams.set('state', state);
    return url.toString();
  }

  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', providerClientId(platform));
  url.searchParams.set('redirect_uri', callbackUrl(platform));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user.info.basic,video.publish');
  url.searchParams.set('state', state);
  return url.toString();
}

async function saveIntegration(record: SocialIntegrationRecord): Promise<void> {
  const db = await getDb();
  if (!db.socialIntegrations) db.socialIntegrations = [];
  db.socialIntegrations = db.socialIntegrations.filter(item => !(item.ownerId === record.ownerId && item.platform === record.platform));
  db.socialIntegrations.push(record);
  await saveDb();
}

export async function getSocialIntegration(ownerId: string | undefined, platform: SocialPlatform): Promise<SocialIntegrationRecord | null> {
  const id = getDefaultOwnerId(ownerId);
  const db = await getDb();
  return (db.socialIntegrations || []).find(item => item.ownerId === id && item.platform === platform) || null;
}

export async function getSocialAccessToken(ownerId: string | undefined, platform: SocialPlatform): Promise<string | null> {
  const record = await getSocialIntegration(ownerId, platform);
  if (!record) return null;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return null;
  return decrypt(platform, record.encryptedAccessToken);
}

export async function disconnectSocialIntegration(ownerId: string | undefined, platform: SocialPlatform): Promise<void> {
  const id = getDefaultOwnerId(ownerId);
  const db = await getDb();
  db.socialIntegrations = (db.socialIntegrations || []).filter(item => !(item.ownerId === id && item.platform === platform));
  await saveDb();
}

export async function getSocialIntegrationStatus(ownerId: string | undefined, platform: SocialPlatform): Promise<SocialIntegrationStatus> {
  const record = await getSocialIntegration(ownerId, platform);
  const isExpired = Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() <= Date.now());
  return {
    platform,
    configured: configured(platform),
    connected: Boolean(record && !isExpired),
    accountId: record?.accountId,
    username: record?.username,
    displayName: record?.displayName,
    avatarUrl: record?.avatarUrl,
    expiresAt: record?.expiresAt,
    audited: platform === 'tiktok' ? String(process.env.TIKTOK_AUDITED || '').toLowerCase() === 'true' : undefined,
  };
}

async function exchangeInstagram(code: string, ownerId: string): Promise<SocialIntegrationRecord> {
  const body = new URLSearchParams({
    client_id: providerClientId('instagram'),
    client_secret: providerSecret('instagram'),
    grant_type: 'authorization_code',
    redirect_uri: callbackUrl('instagram'),
    code,
  });
  const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body });
  const tokenBody: any = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenBody?.access_token) {
    throw new Error(tokenBody?.error_message || tokenBody?.error?.message || 'INSTAGRAM_TOKEN_EXCHANGE_FAILED');
  }

  let accessToken = String(tokenBody.access_token);
  let expiresIn = Number(tokenBody.expires_in || 3600);
  try {
    const exchangeUrl = new URL('https://graph.instagram.com/access_token');
    exchangeUrl.searchParams.set('grant_type', 'ig_exchange_token');
    exchangeUrl.searchParams.set('client_secret', providerSecret('instagram'));
    exchangeUrl.searchParams.set('access_token', accessToken);
    const longResponse = await fetch(exchangeUrl);
    const longBody: any = await longResponse.json().catch(() => ({}));
    if (longResponse.ok && longBody?.access_token) {
      accessToken = String(longBody.access_token);
      expiresIn = Number(longBody.expires_in || 60 * 24 * 60 * 60);
    }
  } catch {
    // Short-lived access remains valid; reconnect can refresh if long-lived exchange is unavailable.
  }

  const profileUrl = new URL('https://graph.instagram.com/me');
  profileUrl.searchParams.set('fields', 'id,user_id,username,name,profile_picture_url,account_type');
  profileUrl.searchParams.set('access_token', accessToken);
  const profileResponse = await fetch(profileUrl);
  const profile: any = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok) throw new Error(profile?.error?.message || 'INSTAGRAM_PROFILE_FAILED');

  return {
    ownerId,
    platform: 'instagram',
    accountId: String(profile.user_id || profile.id || tokenBody.user_id || ''),
    username: profile.username ? String(profile.username) : undefined,
    displayName: profile.name ? String(profile.name) : profile.username ? String(profile.username) : undefined,
    avatarUrl: profile.profile_picture_url ? String(profile.profile_picture_url) : undefined,
    encryptedAccessToken: encrypt('instagram', accessToken),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    updatedAt: new Date().toISOString(),
  };
}

async function exchangeTikTok(code: string, ownerId: string): Promise<SocialIntegrationRecord> {
  const body = new URLSearchParams({
    client_key: providerClientId('tiktok'),
    client_secret: providerSecret('tiktok'),
    code,
    grant_type: 'authorization_code',
    redirect_uri: callbackUrl('tiktok'),
  });
  const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokenBody: any = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenBody?.access_token) {
    throw new Error(tokenBody?.error_description || tokenBody?.error || 'TIKTOK_TOKEN_EXCHANGE_FAILED');
  }

  const accessToken = String(tokenBody.access_token);
  const profileResponse = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profileBody: any = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || profileBody?.error?.code && profileBody.error.code !== 'ok') {
    throw new Error(profileBody?.error?.message || 'TIKTOK_PROFILE_FAILED');
  }
  const user = profileBody?.data?.user || {};

  return {
    ownerId,
    platform: 'tiktok',
    accountId: String(user.open_id || tokenBody.open_id || ''),
    username: user.display_name ? String(user.display_name) : undefined,
    displayName: user.display_name ? String(user.display_name) : undefined,
    avatarUrl: user.avatar_url ? String(user.avatar_url) : undefined,
    encryptedAccessToken: encrypt('tiktok', accessToken),
    encryptedRefreshToken: tokenBody.refresh_token ? encrypt('tiktok', String(tokenBody.refresh_token)) : undefined,
    expiresAt: tokenBody.expires_in ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000).toISOString() : undefined,
    refreshExpiresAt: tokenBody.refresh_expires_in ? new Date(Date.now() + Number(tokenBody.refresh_expires_in) * 1000).toISOString() : undefined,
    scopes: String(tokenBody.scope || 'user.info.basic,video.publish').split(',').filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
}

export async function completeSocialOAuth(platform: SocialPlatform, code: string, state: string): Promise<SocialIntegrationStatus> {
  const payload = decodeState(state, providerSecret(platform));
  if (payload.platform !== platform) throw new Error('OAUTH_PLATFORM_MISMATCH');
  const ownerId = getDefaultOwnerId(String(payload.ownerId));
  const record = platform === 'instagram'
    ? await exchangeInstagram(code, ownerId)
    : await exchangeTikTok(code, ownerId);
  if (!record.accountId) throw new Error('SOCIAL_ACCOUNT_ID_MISSING');
  await saveIntegration(record);
  return getSocialIntegrationStatus(ownerId, platform);
}

export async function getTikTokCreatorInfo(ownerId: string | undefined): Promise<TikTokCreatorInfo> {
  const token = await getSocialAccessToken(ownerId, 'tiktok');
  if (!token) throw new Error('TIKTOK_CONNECTION_REQUIRED');
  const response = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || body?.error?.code && body.error.code !== 'ok') {
    const error: any = new Error(body?.error?.message || 'TIKTOK_CREATOR_INFO_FAILED');
    error.code = body?.error?.code || 'TIKTOK_CREATOR_INFO_FAILED';
    throw error;
  }
  const data = body?.data || {};
  const audited = String(process.env.TIKTOK_AUDITED || '').toLowerCase() === 'true';
  const options = Array.isArray(data.privacy_level_options) ? data.privacy_level_options.map(String) : [];
  return {
    creatorAvatarUrl: data.creator_avatar_url ? String(data.creator_avatar_url) : undefined,
    creatorUsername: data.creator_username ? String(data.creator_username) : undefined,
    creatorNickname: data.creator_nickname ? String(data.creator_nickname) : undefined,
    privacyLevelOptions: audited ? options : options.filter((value: string) => value === 'SELF_ONLY'),
    commentDisabled: Boolean(data.comment_disabled),
    duetDisabled: Boolean(data.duet_disabled),
    stitchDisabled: Boolean(data.stitch_disabled),
    maxVideoPostDurationSec: Number.isFinite(Number(data.max_video_post_duration_sec)) ? Number(data.max_video_post_duration_sec) : undefined,
  };
}
