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
    await radar.saveRadarProfile(owner, { topics: ['Technology'] });
    await assert.rejects(radar.completeRadarOnboarding(owner), { code: 'RADAR_NOT_ENOUGH_SIGNALS' });
    for (let index = 0; index < 5; index++) {
      await radar.saveRadarDiscoveryFeedback(owner, `video-${index}`, index % 2 ? 'skip' : 'interesting');
    }
    assert.ok((await radar.completeRadarOnboarding(owner)).onboardingCompletedAt);
    assert.equal((await radar.getRadarDiscovery(other)).feedbackCount, 0);
    assert.equal((await radar.getRadarProfile(other)).onboardingCompletedAt, undefined);

    // Fixture stands in for paid LLM generation; no provider calls in regression tests.
    db.radarOpportunities ||= [];
    db.scripts ||= [];
    db.radarOpportunities.push({ id: 'op-a', ownerId: owner, title: 'Test idea', status: 'scripted', createdAt: new Date().toISOString(), relevance: 90 } as any);
    db.scripts.push({ id: 'script-a', ownerId: owner, radarOpportunityId: 'op-a', title: 'Test script', content: 'Original', createdAt: new Date().toISOString(), version: 1, exportedAt: new Date().toISOString(), exportMethod: 'copy' } as any);
    await storage.saveDb();
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
    } finally { Date.now = originalNow; }
  } finally {
    process.chdir(originalCwd);
    await rm(scratch, { recursive: true, force: true });
  }
});
