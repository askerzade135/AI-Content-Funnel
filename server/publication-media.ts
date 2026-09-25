import path from 'path';
import { getStorage } from 'firebase-admin/storage';
import { getFirebaseAdmin } from './auth.js';
import { getDefaultOwnerId } from './storage.js';

const MAX_PUBLICATION_MEDIA_BYTES = 1024 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

function bucketName(): string {
  const value = String(process.env.FIREBASE_STORAGE_BUCKET || '').trim();
  if (!value) throw new Error('FIREBASE_STORAGE_BUCKET_MISSING');
  return value;
}

function safeName(value: string): string {
  return path.basename(value || 'asset').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || 'asset';
}

function objectPath(ownerId: string, kind: 'video' | 'thumbnail', fileName: string): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `publication-media/${ownerId}/${kind}/${Date.now()}-${suffix}-${safeName(fileName)}`;
}

function scriptCoverPath(ownerId: string, scriptId: string, fileName: string): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  const safeScriptId = safeName(scriptId);
  return `script-covers/${ownerId}/${safeScriptId}/${Date.now()}-${suffix}-${safeName(fileName)}`;
}

export async function uploadPublicationAssetData(
  ownerId: string | undefined,
  input: { fileName: string; contentType: string; kind: 'thumbnail'; data: Buffer }
): Promise<{ objectPath: string }> {
  const id = getDefaultOwnerId(ownerId);
  const size = input.data?.byteLength || 0;
  if (!size || size > MAX_THUMBNAIL_BYTES) {
    const error: any = new Error('PUBLICATION_THUMBNAIL_SIZE_INVALID');
    error.code = error.message;
    throw error;
  }
  if (!String(input.contentType || '').startsWith('image/')) {
    const error: any = new Error('PUBLICATION_THUMBNAIL_TYPE_UNSUPPORTED');
    error.code = error.message;
    throw error;
  }

  const targetPath = objectPath(id, input.kind, input.fileName);
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  await bucket.file(targetPath).save(input.data, {
    resumable: false,
    validation: 'crc32c',
    metadata: {
      contentType: input.contentType,
      cacheControl: 'private, max-age=300',
    },
  });
  return { objectPath: targetPath };
}

export async function uploadScriptCoverData(
  ownerId: string | undefined,
  scriptId: string,
  input: { fileName: string; contentType: string; data: Buffer }
): Promise<{ objectPath: string }> {
  const id = getDefaultOwnerId(ownerId);
  const size = input.data?.byteLength || 0;
  if (!size || size > MAX_THUMBNAIL_BYTES) {
    const error: any = new Error('SCRIPT_COVER_SIZE_INVALID');
    error.code = error.message;
    throw error;
  }
  if (!String(input.contentType || '').startsWith('image/')) {
    const error: any = new Error('SCRIPT_COVER_TYPE_UNSUPPORTED');
    error.code = error.message;
    throw error;
  }

  const targetPath = scriptCoverPath(id, scriptId, input.fileName);
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  await bucket.file(targetPath).save(input.data, {
    resumable: false,
    validation: 'crc32c',
    metadata: {
      contentType: input.contentType,
      cacheControl: 'private, max-age=300',
    },
  });
  return { objectPath: targetPath };
}

export async function createPublicationUploadUrl(
  ownerId: string | undefined,
  input: { fileName: string; contentType: string; size: number; kind: 'video' | 'thumbnail' }
): Promise<{ uploadUrl: string; objectPath: string; expiresAt: string }> {
  const id = getDefaultOwnerId(ownerId);
  const size = Number(input.size || 0);
  const limit = input.kind === 'video' ? MAX_PUBLICATION_MEDIA_BYTES : MAX_THUMBNAIL_BYTES;
  if (!Number.isFinite(size) || size <= 0 || size > limit) {
    const error: any = new Error(input.kind === 'video' ? 'PUBLICATION_MEDIA_SIZE_INVALID' : 'PUBLICATION_THUMBNAIL_SIZE_INVALID');
    error.code = error.message;
    throw error;
  }
  if (input.kind === 'video' && !String(input.contentType || '').startsWith('video/')) {
    const error: any = new Error('PUBLICATION_MEDIA_TYPE_UNSUPPORTED');
    error.code = error.message;
    throw error;
  }
  if (input.kind === 'thumbnail' && !String(input.contentType || '').startsWith('image/')) {
    const error: any = new Error('PUBLICATION_THUMBNAIL_TYPE_UNSUPPORTED');
    error.code = error.message;
    throw error;
  }

  const targetPath = objectPath(id, input.kind, input.fileName);
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  const file = bucket.file(targetPath);
  const expires = Date.now() + 15 * 60_000;
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires,
    contentType: input.contentType,
  });
  return { uploadUrl, objectPath: targetPath, expiresAt: new Date(expires).toISOString() };
}

export async function createPublicationReadUrl(ownerId: string | undefined, objectPathValue: string, expiresInMs = 2 * 60 * 60_000): Promise<string> {
  const id = getDefaultOwnerId(ownerId);
  const prefix = `publication-media/${id}/`;
  if (!objectPathValue.startsWith(prefix)) throw new Error('PUBLICATION_MEDIA_FORBIDDEN');
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  const file = bucket.file(objectPathValue);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMs,
  });
  return url;
}

export async function downloadPublicationMediaRange(
  ownerId: string | undefined,
  objectPathValue: string,
  start: number,
  end: number
): Promise<Buffer> {
  const id = getDefaultOwnerId(ownerId);
  const prefix = `publication-media/${id}/`;
  if (!objectPathValue.startsWith(prefix)) throw new Error('PUBLICATION_MEDIA_FORBIDDEN');
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  const [buffer] = await bucket.file(objectPathValue).download({ start, end });
  return buffer;
}

export async function deletePublicationMedia(ownerId: string | undefined, objectPathValue?: string): Promise<void> {
  if (!objectPathValue) return;
  const id = getDefaultOwnerId(ownerId);
  const prefix = `publication-media/${id}/`;
  if (!objectPathValue.startsWith(prefix)) return;
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  await bucket.file(objectPathValue).delete({ ignoreNotFound: true }).catch(() => undefined);
}


export async function createScriptCoverUploadUrl(
  ownerId: string | undefined,
  scriptId: string,
  input: { fileName: string; contentType: string; size: number }
): Promise<{ uploadUrl: string; objectPath: string; expiresAt: string }> {
  const id = getDefaultOwnerId(ownerId);
  const size = Number(input.size || 0);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_THUMBNAIL_BYTES) {
    const error: any = new Error('SCRIPT_COVER_SIZE_INVALID');
    error.code = error.message;
    throw error;
  }
  if (!String(input.contentType || '').startsWith('image/')) {
    const error: any = new Error('SCRIPT_COVER_TYPE_UNSUPPORTED');
    error.code = error.message;
    throw error;
  }
  const targetPath = scriptCoverPath(id, scriptId, input.fileName);
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  const file = bucket.file(targetPath);
  const expires = Date.now() + 15 * 60_000;
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires,
    contentType: input.contentType,
  });
  return { uploadUrl, objectPath: targetPath, expiresAt: new Date(expires).toISOString() };
}

export async function createScriptCoverReadUrl(
  ownerId: string | undefined,
  objectPathValue: string,
  expiresInMs = 24 * 60 * 60_000
): Promise<string> {
  const id = getDefaultOwnerId(ownerId);
  const prefix = `script-covers/${id}/`;
  if (!objectPathValue.startsWith(prefix)) throw new Error('SCRIPT_COVER_FORBIDDEN');
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  const [url] = await bucket.file(objectPathValue).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMs,
  });
  return url;
}

export async function deleteScriptCover(ownerId: string | undefined, objectPathValue?: string): Promise<void> {
  if (!objectPathValue) return;
  const id = getDefaultOwnerId(ownerId);
  const prefix = `script-covers/${id}/`;
  if (!objectPathValue.startsWith(prefix)) return;
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  await bucket.file(objectPathValue).delete({ ignoreNotFound: true }).catch(() => undefined);
}


export async function downloadScriptCover(
  ownerId: string | undefined,
  objectPathValue: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const id = getDefaultOwnerId(ownerId);
  const prefix = `script-covers/${id}/`;
  if (!objectPathValue.startsWith(prefix)) throw new Error('SCRIPT_COVER_FORBIDDEN');
  const bucket = getStorage(getFirebaseAdmin()).bucket(bucketName());
  const file = bucket.file(objectPathValue);
  const [metadata] = await file.getMetadata();
  const [buffer] = await file.download();
  return {
    buffer,
    contentType: String(metadata.contentType || 'image/jpeg'),
  };
}
