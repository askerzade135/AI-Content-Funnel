import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('owner-scoped onboarding, review, export, scheduling and publication', async () => {
  const originalCwd = process.cwd();
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'radar-journey-'));
  process.env.APP_STORAGE = 'local-json';
  process.chdir(scratch);
  await mkdir(path.join(scratch, 'data'));
  await writeFile(path.join(scratch, 'data/store.json'), JSON.stringify({ videos: [], channels: [], scripts: [], logs: [], users: [] }));
  try {
    const storage = await import('../server/storage.js');
    const radar = await import('../server/radar.js');
    const db = await storage.getDb();
    const owner = 'journey-owner-a';
    const other = 'journey-owner-b';
    assert.equal((await radar.getRadarProfile(owner)).onboardingCompletedAt, undefined);
    await radar.saveRadarProfile(owner, {
      topics: ['Technology'],
      discoverySources: ['youtube', 'web'],
      contentFormats: ['short_video', 'article', 'post'],
    });
    const tasteVersionBeforeLegacyFormatChange = (await radar.getRadarProfile(owner)).tasteVersion;
    await radar.saveRadarProfile(owner, {
      contentFormats: ['article', 'short_video', 'post'],
    });
    assert.equal(
      (await radar.getRadarProfile(owner)).tasteVersion,
      tasteVersionBeforeLegacyFormatChange,
      'legacy contentFormats must no longer affect Discovery taste/ranking'
    );

    await assert.rejects(
      radar.saveRadarProfile(owner, { discoverySources: [] }),
      (error: any) => error?.code === 'RADAR_DISCOVERY_SOURCE_REQUIRED'
    );

    const tasteVersionBeforeSourceChange = (await radar.getRadarProfile(owner)).tasteVersion;
    await radar.saveRadarProfile(owner, { discoverySources: ['web'] });
    assert.equal(
      (await radar.getRadarProfile(owner)).tasteVersion,
      tasteVersionBeforeSourceChange + 1,
      'changing Discovery sources must update Discovery taste context'
    );
    await radar.saveRadarProfile(owner, { discoverySources: ['youtube', 'web'] });
    await assert.rejects(radar.completeRadarOnboarding(owner), { code: 'RADAR_NOT_ENOUGH_SIGNALS' });
    await radar.saveRadarDiscoveryFeedback(owner, 'video-0', 'interesting');
    await radar.saveRadarDiscoveryFeedback(owner, 'video-1', 'not_interested', 'not_my_topic');
    await radar.saveRadarDiscoveryFeedback(owner, 'video-2', 'interesting');
    await radar.saveRadarDiscoveryExposure(owner, 'video-3', 'passed');
    await radar.saveRadarDiscoveryExposure(owner, 'video-4', 'passed');
    const learningState = await radar.getRadarDiscovery(owner);
    assert.equal(learningState.feedbackCount, 3);
    assert.equal(learningState.decisionCount, 5);
    assert.equal(learningState.interestingCount, 2);
    assert.equal(learningState.notInterestedCount, 1);
    assert.equal(learningState.skipCount, 2);
    assert.equal(learningState.discoveryBufferTarget, 15);
    assert.equal(learningState.discoveryLowWatermark, 6);
    assert.equal(learningState.discoveryEmergencyWatermark, 2);
    assert.equal(learningState.discoveryRerankDebounceMs, 2500);
    assert.ok((await radar.completeRadarOnboarding(owner)).onboardingCompletedAt);
    assert.equal((await radar.getRadarDiscovery(other)).feedbackCount, 0);
    assert.equal((await radar.getRadarProfile(other)).onboardingCompletedAt, undefined);

    // Fixture stands in for paid LLM generation; no provider calls in regression tests.
    db.radarOpportunities ||= [];
    db.scripts ||= [];
    db.radarOpportunities.push({
      id: 'op-a',
      ownerId: owner,
      sourceType: 'youtube',
      sourceContentId: 'video-0',
      sourceTitle: 'Source',
      sourceUrl: 'https://example.com/source',
      title: 'Test idea',
      hook: 'Hook',
      coreIdea: 'Core',
      whyInteresting: 'Why',
      angle: 'Angle',
      status: 'scripted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      relevance: 90,
      recommendedFormat: 'article',
      alternativeFormats: ['short_video', 'post'],
    } as any);
    db.scripts.push(
      { id: 'script-a', ownerId: owner, radarOpportunityId: 'op-a', title: 'Article output', content: 'Original article', createdAt: new Date().toISOString(), version: 1, outputFormat: 'article', exportedAt: new Date().toISOString(), exportMethod: 'copy' } as any,
      { id: 'script-b', ownerId: owner, radarOpportunityId: 'op-a', title: 'Post output', content: 'Original post', createdAt: new Date(Date.now() - 1000).toISOString(), version: 1, outputFormat: 'post' } as any,
    );
    await storage.saveDb();
    const storedOpportunity = (await radar.getRadarOpportunities(owner))[0];
    assert.equal(storedOpportunity.sourceFeedback, 'interesting');
    assert.equal(storedOpportunity.recommendedFormat, 'article');
    assert.deepEqual(storedOpportunity.alternativeFormats, ['short_video', 'post']);

    const savedOpportunity = await radar.setRadarOpportunitySaved(owner, 'op-a', true);
    assert.ok(savedOpportunity?.savedAt, 'Saved must be independent from scripted/output state');
    assert.equal(savedOpportunity?.status, 'scripted');
    const savedAndScripted = (await radar.getRadarOpportunities(owner)).find(item => item.id === 'op-a');
    assert.ok(savedAndScripted?.savedAt);
    assert.equal(savedAndScripted?.status, 'scripted');

    const ideaOutputs = (await radar.getRadarScripts(owner)).filter(item => item.radarOpportunityId === 'op-a');
    assert.equal(ideaOutputs.length, 2, 'one Idea may expose multiple output-format lineages');
    assert.deepEqual(new Set(ideaOutputs.map(item => item.outputFormat)), new Set(['article', 'post']));

    const outputProfile = await radar.getRadarProfile(owner);
    assert.equal(
      radar.resolveRadarOpportunityOutputFormat(outputProfile, storedOpportunity),
      'article',
      'Idea recommendedFormat is the default generation format'
    );
    assert.equal(radar.resolveRadarOpportunityOutputFormat(outputProfile, storedOpportunity, 'post'), 'post');
    assert.equal(
      radar.resolveRadarOpportunityOutputFormat(outputProfile, storedOpportunity, 'long_video_or_podcast'),
      'long_video_or_podcast',
      'all supported formats remain creatable even when not selected in My Radar'
    );
    assert.equal(await radar.getRadarScriptDetail(other, 'script-a'), null);
    assert.equal(await radar.scheduleRadarScript(other, 'script-a', { scheduledAt: new Date().toISOString() }), null);
    assert.equal(await radar.updateRadarScriptLifecycle(other, 'script-a', 'published'), null);
    assert.equal((await radar.getRadarScripts(other)).length, 0);

    const version = await radar.saveRadarScriptVersion(owner, 'script-a', { content: 'Edited content' });
    assert.ok(version);
    const script = version;
    assert.equal(script.version, 2);
    assert.equal(script.outputFormat, 'article', 'regenerate/version keeps the same output format');
    assert.equal(script.exportedAt, undefined);
    assert.equal(script.exportMethod, undefined);
    assert.equal(script.isReviewed, false);
    await radar.saveRadarScriptFeedback(owner, { scriptId: script.id, opportunityId: 'op-a', decision: 'approved' });
    await radar.markRadarScriptExported(owner, script.id, 'copy');
    const unsavedOpportunity = await radar.setRadarOpportunitySaved(owner, 'op-a', false);
    assert.equal(unsavedOpportunity?.savedAt, undefined);
    assert.equal(unsavedOpportunity?.status, 'scripted', 'unsaving must not remove outputs');

    const todayContract = await radar.getRadarToday(owner, 'UTC');
    assert.deepEqual(todayContract.limits, { focus: 2, recommendedIdeas: 3, upcoming: 3 });
    assert.equal(todayContract.refreshPolicy.autoRefreshSeconds, 60);
    assert.equal(todayContract.refreshPolicy.source, 'persisted_snapshot');
    assert.equal(todayContract.refreshPolicy.externalCalls, false);
    assert.ok(Array.isArray(todayContract.attention) && todayContract.attention.length <= 2);
    assert.ok(Array.isArray(todayContract.topOpportunities) && todayContract.topOpportunities.length <= 3);
    assert.ok(Array.isArray(todayContract.upcomingScripts) && todayContract.upcomingScripts.length <= 3);
    assert.equal(
      todayContract.learning.preferenceSignals,
      todayContract.learning.interested + todayContract.learning.notInterested,
      'neutral Skip must not be counted as a preference signal'
    );

    // UTC and Baku straddle midnight for this fixture regardless of the machine timezone.
    const originalNow = Date.now;
    Date.now = () => new Date('2026-09-19T22:00:00Z').getTime();
    try {
      await radar.scheduleRadarScript(owner, script.id, { scheduledAt: '2026-09-20T06:00:00Z', publicationPlatform: 'youtube', calendarProvider: 'google', calendarId: 'calendar-a', calendarEventId: 'event-a' });
      assert.equal((await radar.getRadarToday(owner, 'Asia/Baku')).summary.scriptsScheduledToday, 1);
      assert.equal((await radar.getRadarToday(owner, 'UTC')).summary.scriptsScheduledToday, 0);
      assert.equal((await radar.getRadarToday(other, 'Asia/Baku')).summary.scriptsScheduledToday, 0);
      await assert.rejects(radar.scheduleRadarScript(owner, script.id, { scheduledAt: 'invalid' }), { code: 'INVALID_SCHEDULE_DATE' });
      assert.equal(script.scheduledAt, '2026-09-20T06:00:00.000Z');
      await radar.scheduleRadarScript(owner, script.id, { scheduledAt: '2026-09-20T07:00:00Z' });
      assert.equal(script.calendarProvider, undefined);
      assert.equal(script.calendarEventId, 'event-a');
      await radar.scheduleRadarScript(owner, script.id, { scheduledAt: null });
      assert.equal(script.scheduledAt, undefined);
      assert.equal(script.calendarEventId, 'event-a', 'retain remote identifier for retry after failed deletion');
      await radar.scheduleRadarScript(owner, script.id, { calendarId: null, calendarEventId: null });
      assert.equal(script.calendarEventId, undefined);
      await radar.scheduleRadarScript(owner, script.id, { scheduledAt: '2026-09-20T07:00:00Z' });
      await radar.updateRadarScriptLifecycle(owner, script.id, 'published');
      assert.ok(script.publishedAt);
      assert.equal((await radar.getRadarToday(owner, 'Asia/Baku')).summary.scriptsScheduledToday, 0);
      // Scheduling normalizes every lifecycle, including archived published scripts and past dates.
      for (const action of ['review', 'approved', 'published', 'archive'] as const) {
        await radar.updateRadarScriptLifecycle(owner, script.id, action);
        await radar.scheduleRadarScript(owner, script.id, { scheduledAt: '2020-01-01T08:00:00Z', publicationPlatform: 'tiktok' });
        assert.equal(script.isReviewed, true, action);
        assert.equal(script.isPublished, false, action);
        assert.equal(script.publishedAt, undefined, action);
        assert.equal(script.archivedAt, undefined, action);
        assert.equal(script.scheduledAt, '2020-01-01T08:00:00.000Z');
        assert.equal(script.publicationPlatform, 'tiktok');
      }
      await radar.scheduleRadarScript(owner, script.id, { scheduledAt: '2020-02-01T08:00:00Z', publicationPlatform: 'youtube' });
      assert.equal(script.scheduledAt, '2020-02-01T08:00:00.000Z');
      assert.equal(script.publicationPlatform, 'youtube');
      await radar.scheduleRadarScript(owner, script.id, { scheduledAt: '2026-09-22T08:00:00Z', publicationPlatform: 'youtube', publicationTimeZone: 'Asia/Baku' });
      assert.equal(await radar.publishPastRadarScripts(owner, Date.parse('2026-09-22T19:59:59Z')), 0);
      assert.equal(script.isPublished, false, 'stay scheduled throughout the publication day');
      assert.equal(await radar.publishPastRadarScripts(other, Date.parse('2026-09-22T20:00:00Z')), 0);
      assert.equal(await radar.publishPastRadarScripts(owner, Date.parse('2026-09-22T20:00:00Z')), 1);
      assert.equal(script.isPublished, true, 'publish at the next local calendar day');
      assert.equal(await radar.publishPastRadarScripts(owner, Date.parse('2026-09-23T20:00:00Z')), 0);
      await radar.updateRadarScriptLifecycle(owner, script.id, 'archive');
      script.isPublished = false;
      assert.equal(await radar.publishPastRadarScripts(owner, Date.parse('2026-09-23T20:00:00Z')), 0, 'archive remains archived');
      assert.equal(await radar.deleteRadarScript(other, script.id), false);
      assert.ok(await radar.getRadarScriptDetail(owner, script.id));
      assert.equal(await radar.deleteRadarScript(owner, script.id), true);
      assert.equal(await radar.getRadarScriptDetail(owner, script.id), null);
      assert.ok(await radar.getRadarScriptDetail(owner, 'script-a'), 'other versions remain');
    } finally { Date.now = originalNow; }
  } finally {
    process.chdir(originalCwd);
    await rm(scratch, { recursive: true, force: true });
  }
});


test('thought-to-script generation uses AI Generation quota and preserves provenance', async () => {
  const fs = await import('node:fs/promises');
  const radar = await fs.readFile(path.join(process.cwd(), 'server/radar.ts'), 'utf8');
  const server = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');
  const tasks = await fs.readFile(path.join(process.cwd(), 'server/llm-tasks.ts'), 'utf8');
  const workspace = await fs.readFile(path.join(process.cwd(), 'src/components/RadarScriptsWorkspace.tsx'), 'utf8');

  assert.match(radar, /generateRadarScriptFromThought/);
  assert.match(radar, /reserveUserQuota\(id, 'scriptGenerations', `manual-script:\$\{requestId\}`\)/);
  assert.match(radar, /runLLMTask\(id, 'manual_script_generation'/);
  assert.match(radar, /sourceType: 'ai_prompt'/);
  assert.match(radar, /sourcePrompt: thought\.slice\(0, 12000\)/);
  assert.match(radar, /generationRequestId: requestId/);
  assert.match(radar, /item\.sourceType === 'ai_prompt'[\s\S]*item\.generationRequestId === requestId/);
  assert.match(radar, /sourceType: 'manual'/);
  assert.match(radar, /sourceType: 'radar_idea'/);

  assert.match(tasks, /manual_script_generation/);
  assert.match(tasks, /quotaMetric: 'scriptGenerations'/);

  assert.match(server, /\/api\/radar\/scripts\/generate-from-thought/);
  assert.match(server, /getUserQuota\(ownerId\)/);

  assert.match(workspace, /Create with AI|Создать с AI/);
  assert.match(workspace, /1 AI Generation/);
  assert.match(workspace, /This does not use Radar Analysis|Это не расходует Radar Analysis/);
  assert.match(workspace, /sourceType === 'ai_prompt'/);
});
