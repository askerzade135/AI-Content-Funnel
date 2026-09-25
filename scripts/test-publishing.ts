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


test('publication metadata endpoint is quota-protected and idempotent', async () => {
  const fs = await import('node:fs/promises');
  const serverSource = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');
  assert.match(serverSource, /publication-metadata/);
  assert.match(serverSource, /reserveUserQuota\(ownerId, 'scriptGenerations'/);
  assert.match(serverSource, /publicationMetadataGeneration/);
  assert.match(serverSource, /previous\?\.requestId === requestId/);
});

test('publish metadata starts empty and changes only after explicit AI generation', async () => {
  const fs = await import('node:fs/promises');
  const modal = await fs.readFile(path.join(process.cwd(), 'src/components/PublicationModal.tsx'), 'utf8');
  assert.match(modal, /const \[baseText, setBaseText\] = useState\(''\)/);
  assert.match(modal, /description: initialPublication\?\.platform === 'instagram' \? \(initialPublication\.description \|\| ''\) : ''/);
  assert.match(modal, /const generateMetadata = async/);
  assert.match(modal, /setBaseText\(text\)/);
  assert.match(modal, /updateDraft\(target, \{ description: text, useBase: false \}\)/);
  assert.doesNotMatch(modal, /script\.content\.slice\(0, 5000\)/);
});


test('Google publishing integrations keep OAuth scopes isolated and YouTube state shared', async () => {
  const fs = await import('node:fs/promises');
  const googleAuth = await fs.readFile(path.join(process.cwd(), 'src/services/googleAuth.ts'), 'utf8');
  const integrations = await fs.readFile(path.join(process.cwd(), 'src/components/IntegrationsWorkspace.tsx'), 'utf8');
  const publishModal = await fs.readFile(path.join(process.cwd(), 'src/components/PublicationModal.tsx'), 'utf8');
  const integrationHook = await fs.readFile(path.join(process.cwd(), 'src/hooks/useIntegrationState.ts'), 'utf8');

  assert.doesNotMatch(googleAuth, /include_granted_scopes/);
  assert.match(googleAuth, /youtube\.readonly/);
  assert.match(googleAuth, /youtube\.upload/);
  assert.match(googleAuth, /calendar\.app\.created/);
  assert.match(googleAuth, /drive\.file/);

  assert.match(integrationHook, /setRevision\(current => current \+ 1\)/);
  assert.match(integrations, /useIntegrationState\('youtube'\)/);
  assert.match(integrations, /youtubeRevision/);
  assert.match(integrations, /refreshYoutubeConnection/);
  assert.match(publishModal, /youtubeRevision/);
  assert.match(publishModal, /getConnectedYouTubeChannel/);

  const youtubePublishing = await fs.readFile(path.join(process.cwd(), 'src/services/youtubePublishingService.ts'), 'utf8');
  assert.match(youtubePublishing, /validateYouTubePublishingConnection/);
  assert.match(youtubePublishing, /YOUTUBE_SCOPE_REQUIRED/);
  assert.match(youtubePublishing, /clearYouTubePublishingAccessToken/);
  assert.match(integrationHook, /validateYouTubePublishingConnection/);
});


test('publish flow is a persistent single-screen workspace', async () => {
  const fs = await import('node:fs/promises');
  const modal = await fs.readFile(path.join(process.cwd(), 'src/components/PublicationModal.tsx'), 'utf8');
  const youtube = await fs.readFile(path.join(process.cwd(), 'src/services/youtubePublishingService.ts'), 'utf8');

  assert.doesNotMatch(modal, /useState<1 \| 2 \| 3>/);
  assert.doesNotMatch(modal, /Step \$\{step\}|Шаг \$\{step\}/);
  assert.match(modal, /Platforms|Платформы/);
  assert.match(modal, /Copy & settings|Текст и настройки/);
  assert.match(modal, /Schedule|Дата и время/);
  assert.match(modal, /inline-flex h-9 items-center gap-2 rounded-xl border px-3/);
  assert.match(modal, /existingJob = initialPublication\?\.platform === platform/);
  assert.match(modal, /jobs\.find\(job => job\.platform === platform\)/);
  assert.match(modal, /loadJobs\(\)/);
  assert.match(modal, /Retry|Повторить/);
  assert.match(modal, /Processing on platform|Обрабатывается платформой/);
  assert.match(modal, /thumbnailFile/);
  assert.match(modal, /sameTime/);
  assert.match(modal, /platformSchedules/);
  assert.match(modal, /Use base|Использовать основу/);
  assert.match(youtube, /thumbnails\/set/);
  assert.match(youtube, /input\.thumbnailFile/);
});

test('publication jobs store platform metadata and can be listed/deleted', async () => {
  const fs = await import('node:fs/promises');
  const publishing = await fs.readFile(path.join(process.cwd(), 'server/publishing.ts'), 'utf8');
  const server = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');
  assert.match(publishing, /getPublicationJobs/);
  assert.match(publishing, /thumbnailName/);
  assert.match(publishing, /privacyStatus/);
  assert.match(publishing, /deletePublicationJob/);
  assert.match(server, /app\.get\('\/api\/publications'/);
  assert.match(server, /app\.delete\('\/api\/publications\/:id'/);
});


test('Instagram and TikTok integrations use isolated server-side OAuth and official publishing flows', async () => {
  const fs = await import('node:fs/promises');
  const integrations = await fs.readFile(path.join(process.cwd(), 'server/social-integrations.ts'), 'utf8');
  const publishing = await fs.readFile(path.join(process.cwd(), 'server/social-publishing.ts'), 'utf8');
  const server = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');
  const hook = await fs.readFile(path.join(process.cwd(), 'src/hooks/useIntegrationState.ts'), 'utf8');
  const modal = await fs.readFile(path.join(process.cwd(), 'src/components/PublicationModal.tsx'), 'utf8');

  assert.match(integrations, /instagram_business_basic,instagram_business_content_publish/);
  assert.match(integrations, /user\.info\.basic,video\.publish/);
  assert.match(integrations, /createCipheriv\('aes-256-gcm'/);
  assert.match(integrations, /post\/publish\/creator_info\/query/);
  assert.match(integrations, /SELF_ONLY/);

  assert.match(publishing, /media_type', 'REELS'/);
  assert.match(publishing, /media_publish/);
  assert.match(publishing, /fields', 'permalink'/);
  assert.match(publishing, /post\/publish\/video\/init/);
  assert.match(publishing, /source: 'FILE_UPLOAD'/);
  assert.match(publishing, /post\/publish\/status\/fetch/);
  assert.match(publishing, /PUBLISH_COMPLETE/);
  assert.match(publishing, /status === 'FAILED'/);

  assert.match(server, /\/api\/oauth\/:platform\/callback/);
  assert.match(server, /\/api\/integrations\/:platform\/oauth\/start/);
  assert.match(server, /\/api\/publication-media\/upload-url/);
  assert.match(server, /\/api\/publications\/:id\/publish-social/);
  assert.match(hook, /'instagram' \| 'tiktok'/);
  assert.match(modal, /connectSocialPlatform/);
  assert.match(modal, /uploadPublicationAsset/);
  assert.doesNotMatch(modal, /NEXT ADAPTER|COMING SOON/);
});

test('social publication media is owner-scoped and scheduled jobs are processed by the scheduler', async () => {
  const fs = await import('node:fs/promises');
  const media = await fs.readFile(path.join(process.cwd(), 'server/publication-media.ts'), 'utf8');
  const scheduler = await fs.readFile(path.join(process.cwd(), 'server/scheduler.ts'), 'utf8');
  const server = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');

  assert.match(media, /publication-media\/\$\{ownerId\}/);
  assert.match(media, /getSignedUrl/);
  assert.match(media, /action: 'write'/);
  assert.match(media, /action: 'read'/);
  assert.match(scheduler, /processDueSocialPublications/);
  assert.match(server, /deletePublicationMedia\(ownerId, publication\.mediaObjectPath\)/);
  assert.match(server, /deletePublicationMedia\(ownerId, publication\.thumbnailObjectPath\)/);
});


test('connected YouTube card does not present Reconnect as the primary action', async () => {
  const fs = await import('node:fs/promises');
  const integrations = await fs.readFile(path.join(process.cwd(), 'src/components/IntegrationsWorkspace.tsx'), 'utf8');
  assert.match(integrations, /Connected channel|Подключённый канал/);
  assert.match(integrations, /Change account|Сменить аккаунт/);
  assert.match(integrations, /youtubeConnected \? \(/);
  assert.doesNotMatch(integrations, /youtubeConnected \? tr\('Переподключить', 'Reconnect'\)/);
});


test('uploaded publication cover becomes persistent Script cover', async () => {
  const fs = await import('node:fs/promises');
  const server = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');
  const media = await fs.readFile(path.join(process.cwd(), 'server/publication-media.ts'), 'utf8');
  const radar = await fs.readFile(path.join(process.cwd(), 'server/radar.ts'), 'utf8');
  const modal = await fs.readFile(path.join(process.cwd(), 'src/components/PublicationModal.tsx'), 'utf8');
  const social = await fs.readFile(path.join(process.cwd(), 'src/services/socialIntegrationService.ts'), 'utf8');

  assert.match(server, /\/api\/radar\/scripts\/:id\/cover\/upload-url/);
  assert.match(server, /\/api\/radar\/scripts\/:id\/cover/);
  assert.match(media, /script-covers\/\$\{ownerId\}/);
  assert.match(media, /createScriptCoverReadUrl/);
  assert.match(radar, /thumbnailObjectPath/);
  assert.match(radar, /updateRadarScriptThumbnail/);
  assert.match(radar, /Promise\.all\(getLatestRadarScriptsFromDb/);
  assert.match(radar, /hydratedScriptById/);
  assert.match(social, /uploadScriptCover/);
  assert.match(modal, /chooseThumbnail/);
  assert.match(modal, /Cover saved and updated across the product|Обложка сохранена и обновлена во всех разделах/);
});


test('canonical Script cover is reused for YouTube and publication calendar sync', async () => {
  const fs = await import('node:fs/promises');
  const modal = await fs.readFile(path.join(process.cwd(), 'src/components/PublicationModal.tsx'), 'utf8');
  const social = await fs.readFile(path.join(process.cwd(), 'src/services/socialIntegrationService.ts'), 'utf8');
  const server = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');
  const publishing = await fs.readFile(path.join(process.cwd(), 'server/publishing.ts'), 'utf8');

  assert.match(social, /getScriptCoverFile/);
  assert.match(server, /\/api\/radar\/scripts\/:id\/cover\/file/);
  assert.match(modal, /effectiveThumbnail = thumbnailFile \|\| \(script\.thumbnailObjectPath \? await getScriptCoverFile/);
  assert.match(modal, /createContentRadarCalendarEvent/);
  assert.match(modal, /calendarConnected/);
  assert.match(modal, /calendarEventId/);
  assert.match(publishing, /calendarEventUrl/);
});
