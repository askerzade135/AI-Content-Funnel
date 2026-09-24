import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('publication jobs are owner-scoped, idempotent while active, and mark script published on success', async () => {
  const originalCwd = process.cwd();
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'publishing-'));
  process.env.APP_STORAGE = 'local-json';
  process.chdir(scratch);
  await mkdir(path.join(scratch, 'data'));
  await writeFile(path.join(scratch, 'data/store.json'), JSON.stringify({
    videos: [],
    channels: [],
    logs: [],
    scripts: [{
      id: 'script-1',
      ownerId: 'owner-a',
      createdAt: new Date().toISOString(),
      title: 'Test',
      promptTemplate: 'manual_script',
      videoIds: [],
      videoTitles: [],
      content: 'Body',
    }],
    users: [],
  }));

  try {
    const publishing = await import('../server/publishing.js');
    const storage = await import('../server/storage.js');

    const first = await publishing.createPublicationJob('owner-a', 'script-1', {
      platform: 'youtube',
      mediaName: 'video.mp4',
      mediaType: 'video/mp4',
    });
    const duplicate = await publishing.createPublicationJob('owner-a', 'script-1', {
      platform: 'youtube',
      mediaName: 'video.mp4',
      mediaType: 'video/mp4',
    });
    assert.equal(duplicate.id, first.id);

    const uploading = await publishing.updatePublicationJob('owner-a', first.id, { status: 'uploading' });
    assert.equal(uploading?.status, 'uploading');

    const published = await publishing.updatePublicationJob('owner-a', first.id, {
      status: 'published',
      remoteId: 'yt-123',
      remoteUrl: 'https://www.youtube.com/watch?v=yt-123',
    });
    assert.equal(published?.remoteId, 'yt-123');

    const jobs = await publishing.getScriptPublicationJobs('owner-a', 'script-1');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'published');
    assert.equal((await publishing.getScriptPublicationJobs('owner-b', 'script-1')).length, 0);

    const db = await storage.getDb();
    const script = db.scripts.find(item => item.id === 'script-1');
    assert.equal(script?.isPublished, true);
    assert.equal(script?.publicationPlatform, 'youtube');
  } finally {
    process.chdir(originalCwd);
    await rm(scratch, { recursive: true, force: true });
  }
});
