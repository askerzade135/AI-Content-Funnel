export const MAX_TEMP_PUBLICATION_ASSET_BYTES = 400 * 1024 * 1024;
export const MAX_TEMP_PUBLICATION_ASSET_MB = 400;

export interface PublicationMediaLike {
  size: number;
  type?: string;
}

export function assertTemporaryPublicationMedia(file: PublicationMediaLike) {
  if (file.type && !file.type.startsWith('video/')) {
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
