import { getApp } from 'firebase/app';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { auth } from './googleAuth';

export const MAX_TEMP_PUBLICATION_ASSET_BYTES = 400 * 1024 * 1024;
export const MAX_TEMP_PUBLICATION_ASSET_MB = 400;

export interface TemporaryPublicationAsset {
  path: string;
  downloadUrl: string;
  size: number;
  contentType: string;
  originalName: string;
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'video';
}

export function validateTemporaryPublicationAsset(file: File) {
  if (!file.type.startsWith('video/')) {
    const error: any = new Error('PUBLICATION_MEDIA_TYPE_UNSUPPORTED');
    error.code = 'PUBLICATION_MEDIA_TYPE_UNSUPPORTED';
    throw error;
  }
  if (file.size > MAX_TEMP_PUBLICATION_ASSET_BYTES) {
    const error: any = new Error('PUBLICATION_MEDIA_TOO_LARGE');
    error.code = 'PUBLICATION_MEDIA_TOO_LARGE';
    error.limitBytes = MAX_TEMP_PUBLICATION_ASSET_BYTES;
    throw error;
  }
}

export async function uploadTemporaryPublicationAsset(
  file: File,
  onProgress?: (percent: number) => void
): Promise<TemporaryPublicationAsset> {
  validateTemporaryPublicationAsset(file);
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');

  const storage = getStorage(getApp());
  const objectPath = `publication-assets/${user.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeFileName(file.name)}`;
  const objectRef = ref(storage, objectPath);

  const task = uploadBytesResumable(objectRef, file, {
    contentType: file.type || 'video/mp4',
    customMetadata: {
      purpose: 'scheduled-publication',
      ownerUid: user.uid,
      originalName: file.name.slice(0, 200),
    },
  });

  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', snapshot => {
      if (snapshot.totalBytes > 0) {
        onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
      }
    }, reject, () => resolve());
  });

  return {
    path: objectPath,
    downloadUrl: await getDownloadURL(task.snapshot.ref),
    size: file.size,
    contentType: file.type || 'video/mp4',
    originalName: file.name,
  };
}

export async function deleteTemporaryPublicationAsset(path: string): Promise<void> {
  if (!path.startsWith('publication-assets/')) throw new Error('INVALID_PUBLICATION_ASSET_PATH');
  const storage = getStorage(getApp());
  await deleteObject(ref(storage, path));
}
