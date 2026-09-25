import { authFetch } from './authFetch';
import { INTEGRATION_STATE_EVENT } from './googleAuth';
import type { SocialIntegrationStatus, TikTokCreatorInfo } from '../types';

export type SocialPlatform = 'instagram' | 'tiktok';

function notifyIntegrationState() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(INTEGRATION_STATE_EVENT));
}

export async function getSocialIntegrationStatus(platform: SocialPlatform): Promise<SocialIntegrationStatus> {
  const response = await authFetch('/api/integrations/' + platform + '/status');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'SOCIAL_STATUS_FAILED');
  return data as SocialIntegrationStatus;
}

export async function connectSocialPlatform(platform: SocialPlatform): Promise<SocialIntegrationStatus> {
  const start = await authFetch('/api/integrations/' + platform + '/oauth/start', { method: 'POST' });
  const data = await start.json().catch(() => ({}));
  if (!start.ok || !data.url) throw new Error(data.error || 'SOCIAL_OAUTH_START_FAILED');

  const popup = window.open(String(data.url), 'radar-social-oauth', 'width=620,height=760,resizable=yes,scrollbars=yes');
  if (!popup) throw new Error('SOCIAL_OAUTH_POPUP_BLOCKED');

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedTimer);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'radar-social-oauth' || event.data?.platform !== platform) return;
      finished = true;
      cleanup();
      if (event.data?.ok) resolve();
      else reject(new Error(event.data?.error || 'SOCIAL_OAUTH_FAILED'));
    };
    const closedTimer = window.setInterval(() => {
      if (!popup.closed || finished) return;
      cleanup();
      reject(new Error('SOCIAL_OAUTH_CANCELLED'));
    }, 500);
    window.addEventListener('message', onMessage);
  });

  const status = await getSocialIntegrationStatus(platform);
  notifyIntegrationState();
  return status;
}

export async function disconnectSocialPlatform(platform: SocialPlatform): Promise<void> {
  const response = await authFetch('/api/integrations/' + platform, { method: 'DELETE' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'SOCIAL_DISCONNECT_FAILED');
  notifyIntegrationState();
}

export async function getTikTokCreatorInfo(): Promise<TikTokCreatorInfo> {
  const response = await authFetch('/api/integrations/tiktok/creator-info');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'TIKTOK_CREATOR_INFO_FAILED');
  return data as TikTokCreatorInfo;
}

export async function uploadPublicationAsset(file: File, kind: 'video' | 'thumbnail'): Promise<string> {
  const response = await authFetch('/api/publication-media/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
      size: file.size,
      kind,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.uploadUrl || !data.objectPath) throw new Error(data.error || 'PUBLICATION_UPLOAD_URL_FAILED');

  const upload = await fetch(String(data.uploadUrl), {
    method: 'PUT',
    headers: { 'Content-Type': file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg') },
    body: file,
  });
  if (!upload.ok) throw new Error('PUBLICATION_ASSET_UPLOAD_FAILED');
  return String(data.objectPath);
}


export async function uploadScriptCover(scriptId: string, file: File) {
  const response = await authFetch('/api/radar/scripts/' + scriptId + '/cover/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || 'image/jpeg',
      size: file.size,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.uploadUrl || !data.objectPath) {
    throw new Error(data.error || 'SCRIPT_COVER_UPLOAD_URL_FAILED');
  }

  const upload = await fetch(String(data.uploadUrl), {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'image/jpeg' },
    body: file,
  });
  if (!upload.ok) throw new Error('SCRIPT_COVER_UPLOAD_FAILED');

  const save = await authFetch('/api/radar/scripts/' + scriptId + '/cover', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectPath: String(data.objectPath) }),
  });
  const saved = await save.json().catch(() => ({}));
  if (!save.ok || !saved.script) throw new Error(saved.error || 'SCRIPT_COVER_SAVE_FAILED');
  return saved.script;
}


export async function getScriptCoverFile(scriptId: string, fileName = 'cover.jpg'): Promise<File | null> {
  const response = await authFetch('/api/radar/scripts/' + scriptId + '/cover/file');
  if (response.status === 404) return null;
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'SCRIPT_COVER_DOWNLOAD_FAILED');
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
}
