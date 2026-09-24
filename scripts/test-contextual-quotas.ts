import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quotaState, quotaReset } from '../src/lib/productQuota.js';

for (const [used, expected] of [[79, 'normal'], [80, 'warning'], [99, 'warning'], [100, 'exhausted']] as const) {
  test(`quota boundary ${used}%`, () => {
    assert.equal(quotaState(used, 100), expected);
    assert.equal(quotaState(used / 10, 10), expected);
  });
}
test('zero limits and UTC year rollover', () => {
  assert.equal(quotaState(0, 0), 'exhausted');
  assert.equal(quotaReset('2026-12-01T00:00:00.000Z'), '2027-01-01T00:00:00.000Z');
});

test('quota admission, concurrent work, replay, feedback and renewal', async () => {
  const cwd = process.cwd();
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'contextual-quota-'));
  process.env.APP_STORAGE = 'local-json';
  process.chdir(scratch);
  await mkdir('data');
  await writeFile('data/store.json', JSON.stringify({ videos: [], channels: [], scripts: [], logs: [], users: [] }));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let output = 'A useful generated script';
  globalThis.fetch = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 15));
    return new Response(JSON.stringify({ output_text: output, usage: {} }), { status: 200 });
  };
  try {
    const storage = await import('../server/storage.js');
    const { getUserQuota, reserveUserQuota } = await import('../server/quotas.js');
    const radar = await import('../server/radar.js');
    const db = await storage.getDb();
    for (const role of ['member', 'admin', 'owner']) {
      const owner = 'quota-' + role;
      db.users.push({ id: owner, uid: owner, email: role + '@example.test', role } as any);
      const quota = await getUserQuota(owner);
      db.userQuotas![owner].scriptGenerations = quota.limits.scriptGenerations;
      const opportunity = { id: 'idea-' + role, ownerId: owner, title: 'An idea', coreIdea: 'Evidence', sourceContentId: 'source-' + role, sourceTitle: 'Source', sourceUrl: 'https://example.com', evidence: ['Evidence'], recommendedFormat: 'short_video', status: 'new', createdAt: new Date().toISOString() } as any;
      (db.radarOpportunities ||= []).push(opportunity);
      await assert.rejects(radar.generateRadarOpportunityScript(owner, opportunity.id, 'short_video', 'blocked'), { code: 'PRODUCT_QUOTA_EXCEEDED' });
      assert.equal(calls, 0, role + ' must not call AI at exhaustion');
      db.userQuotas![owner].radarAnalyses = quota.limits.radarAnalyses;
      await radar.saveRadarProfile(owner, { topics: ['Technology'] });
      await radar.saveRadarDiscoveryFeedback(owner, opportunity.sourceContentId, 'interesting');
      await radar.saveRadarDiscoveryExposure(owner, 'skipped-' + role, 'passed');
      assert.ok(db.radarDiscoveryFeedback?.some(f => f.ownerId === owner && f.decision === 'interesting'));
      assert.ok(db.radarDiscoveryExposures?.some(f => f.ownerId === owner && f.action === 'passed'));
      db.videos.push({ id: opportunity.sourceContentId, ownerId: owner, title: 'Source needing transcription', status: 'pending' } as any);
      const scan = await radar.runRadarScan(owner, { selectedOnly: true });
      assert.equal(scan.run.scanned, 0);
      assert.equal(calls, 0, 'Radar blocks before transcription/API calls');
    }
    const owner = 'quota-owner';
    db.userQuotas![owner].scriptGenerations = 9;
    const attempts = await Promise.allSettled([
      reserveUserQuota(owner, 'scriptGenerations', 'a'),
      reserveUserQuota(owner, 'scriptGenerations', 'b'),
    ]);
    assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
    const reservation = (attempts.find(x => x.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
    assert.equal((await getUserQuota(owner)).scriptGenerations, 10, 'in-flight reservation is visible');
    reservation.release();
    reservation.release();
    assert.equal((await getUserQuota(owner)).scriptGenerations, 9, 'failed/cancelled work releases once');

    db.userSettings![owner] = { ...storage.getSettingsForOwner(db, owner), llmMode: 'byok', llmProvider: 'openai', llmModel: 'gpt-4o-mini', openaiApiKey: 'fixture-only' };
    const [first, duplicate] = await Promise.all([
      radar.generateRadarOpportunityScript(owner, 'idea-owner', 'short_video', 'same-request'),
      radar.generateRadarOpportunityScript(owner, 'idea-owner', 'short_video', 'same-request'),
    ]);
    assert.equal(first.script.id, duplicate.script.id);
    assert.equal(calls, 1);
    assert.equal((await getUserQuota(owner)).scriptGenerations, 10);
    const replay = await radar.generateRadarOpportunityScript(owner, 'idea-owner', 'short_video', 'same-request');
    assert.equal(replay.script.id, first.script.id, 'replay succeeds even when quota is now exhausted');
    assert.equal(calls, 1);
    const saved = JSON.parse(await readFile('data/store.json', 'utf8'));
    assert.equal(saved.scripts.find((s: any) => s.id === first.script.id).generationRequestId, 'same-request');
    await assert.rejects(radar.generateRadarOpportunityScript(owner, 'different-idea', 'short_video', 'same-request'), { code: 'INVALID_GENERATION_REQUEST' });

    db.userQuotas![owner].periodStart = '2000-01-01T00:00:00.000Z';
    assert.equal((await getUserQuota(owner)).scriptGenerations, 0);
    const commit = await reserveUserQuota(owner, 'scriptGenerations', 'commit-once');
    await commit.commit(); await commit.commit(); commit.release();
    assert.equal((await getUserQuota(owner)).scriptGenerations, 1);

    // Competing manual scans cannot process or charge the same source twice.
    db.userQuotas![owner].radarAnalyses = 0;
    const video = db.videos.find(v => v.ownerId === owner)!;
    video.transcript = 'Already transcribed source with enough evidence to analyze. '.repeat(10);
    output = '{"opportunities":[]}';
    const scans = await Promise.all([radar.runRadarScan(owner), radar.runRadarScan(owner)]);
    assert.equal(scans.reduce((sum, x) => sum + x.run.scanned, 0), 1);
    assert.equal((await getUserQuota(owner)).radarAnalyses, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(cwd);
    await rm(scratch, { recursive: true, force: true });
  }
});
