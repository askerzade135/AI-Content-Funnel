import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TEMP_PUBLICATION_ASSET_BYTES, assertTemporaryPublicationMedia } from '../src/utils/publicationMedia.js';

test('temporary publication media accepts video at or below 400 MB', () => {
  assert.doesNotThrow(() => assertTemporaryPublicationMedia({ size: MAX_TEMP_PUBLICATION_ASSET_BYTES, type: 'video/mp4' }));
});

test('temporary publication media rejects files above 400 MB', () => {
  assert.throws(
    () => assertTemporaryPublicationMedia({ size: MAX_TEMP_PUBLICATION_ASSET_BYTES + 1, type: 'video/mp4' }),
    (error: any) => error?.code === 'PUBLICATION_MEDIA_TOO_LARGE'
  );
});

test('temporary publication media rejects non-video files', () => {
  assert.throws(
    () => assertTemporaryPublicationMedia({ size: 1024, type: 'image/png' }),
    (error: any) => error?.code === 'PUBLICATION_MEDIA_TYPE_UNSUPPORTED'
  );
});


test('small media uploads encode Unicode filenames before putting them in HTTP headers', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const service = await fs.readFile(path.join(process.cwd(), 'src/services/socialIntegrationService.ts'), 'utf8');
  const server = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');

  assert.match(service, /'X-File-Name': encodeURIComponent\(file\.name\)/);
  assert.match(server, /decodeHeaderFileName/);
  assert.match(server, /decodeURIComponent\(String\(raw\)\)/);
  assert.match(server, /decodeHeaderFileName\(req\.headers\['x-file-name'\], 'thumbnail'\)/);
  assert.match(server, /decodeHeaderFileName\(req\.headers\['x-file-name'\], 'cover'\)/);
});
