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
      contentFormats: ['short_video', 'article', 'post'],
    });
    const tasteVersionBeforeFormatOnlyChange = (await radar.getRadarProfile(owner)).tasteVersion;
    await radar.saveRadarProfile(owner, {
      contentFormats: ['article', 'post'],
    });
    assert.equal(
      (await radar.getRadarProfile(owner)).tasteVersion,
      tasteVersionBeforeFormatOnlyChange,
      'output format changes must not invalidate Discovery taste ranking'
    );
    await radar.saveRadarProfile(owner, {
      contentFormats: ['short_video', 'article', 'post'],
    });
    assert.equal(
      (await radar.getRadarProfile(owner)).tasteVersion,
      tasteVersionBeforeFormatOnlyChange,
      'restoring output formats must still leave Discovery taste version unchanged'
    );
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
    db.scripts.push({ id: 'script-a', ownerId: owner, radarOpportunityId: 'op-a', title: 'Test script', content: 'Original', createdAt: new Date().toISOString(), version: 1, exportedAt: new Date().toISOString(), exportMethod: 'copy' } as any);
    await storage.saveDb();
    const storedOpportunity = (await radar.getRadarOpportunities(owner))[0];
    assert.equal(storedOpportunity.sourceFeedback, 'interesting');
    assert.equal(storedOpportunity.recommendedFormat, 'article');
    assert.deepEqual(storedOpportunity.alternativeFormats, ['short_video', 'post']);

    const outputProfile = await radar.getRadarProfile(owner);
    assert.equal(radar.resolveRadarOpportunityOutputFormat(outputProfile, storedOpportunity), 'article');
    assert.equal(radar.resolveRadarOpportunityOutputFormat(outputProfile, storedOpportunity, 'post'), 'post');
    assert.throws(
      () => radar.resolveRadarOpportunityOutputFormat(outputProfile, storedOpportunity, 'long_video_or_podcast'),
      { code: 'RADAR_CONTENT_FORMAT_NOT_SELECTED' }
    );
    assert.equal(await radar.getRadarScriptDetail(other, 'script-a'), null);
    assert.equal(await radar.scheduleRadarScript(other, 'script-a', { scheduledAt: new Date().toISOString() }), null);
    assert.equal(await radar.updateRadarScriptLifecycle(other, 'script-a', 'published'), null);
    assert.equal((await radar.getRadarScripts(other)).length, 0);

    const version = await radar.saveRadarScriptVersion(owner, 'script-a', { content: 'Edited content' });
    assert.ok(version);
    const script = version;
    assert.equal(script.version, 2);
    assert.equal(script.exportedAt, undefined);
    assert.equal(script.exportMethod, undefined);
    assert.equal(script.isReviewed, false);
    await radar.saveRadarScriptFeedback(owner, { scriptId: script.id, opportunityId: 'op-a', decision: 'approved' });
    await radar.markRadarScriptExported(owner, script.id, 'copy');

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
