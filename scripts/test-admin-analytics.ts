import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('admin analytics aggregates users, costs, product funnel and LLM registry without provider calls', async () => {
  const originalCwd = process.cwd();
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'admin-analytics-'));
  process.env.APP_STORAGE = 'local-json';
  process.chdir(scratch);
  await mkdir(path.join(scratch, 'data'));
  await writeFile(path.join(scratch, 'data/store.json'), JSON.stringify({ videos: [], channels: [], scripts: [], logs: [], users: [] }));

  try {
    const storage = await import('../server/storage.js');
    const analytics = await import('../server/admin-analytics.js');
    const llmTasks = await import('../server/llm-tasks.js');
    const db = await storage.getDb();
    const now = new Date().toISOString();

    db.users = [{
      id: 'user-a',
      email: 'a@example.com',
      name: 'User A',
      role: 'member',
      createdAt: now,
      lastLoginAt: now,
    }];
    db.radarProfiles = {
      'user-a': {
        ownerId: 'user-a',
        description: '',
        topics: ['Technology'],
        contentFormats: ['article'],
        onboardingCompletedAt: now,
        tasteVersion: 1,
        updatedAt: now,
      },
    };
    db.userQuotas = {
      'user-a': {
        periodStart: now,
        transcripts: 2,
        transcriptMinutes: 20,
        radarAnalyses: 4,
        scriptGenerations: 2,
      },
    };
    db.geminiUsageLogs = [
      {
        id: 'usage-a',
        ownerId: 'user-a',
        timestamp: now,
        provider: 'gemini',
        model: 'gemini-test',
        isPaid: true,
        billingPhase: 'paid',
        operation: 'radar_opportunity_analysis:v1',
        latencyMs: 700,
        success: true,
        promptTokens: 100,
        candidatesTokens: 40,
        thoughtsTokens: 10,
        totalTokens: 150,
        estimatedCostUsd: 0.012,
      },
      {
        id: 'usage-failed',
        ownerId: 'user-a',
        timestamp: now,
        provider: 'gemini',
        model: 'gemini-test',
        isPaid: false,
        billingPhase: 'free',
        operation: 'radar_discovery_ranking:v1',
        latencyMs: 300,
        success: false,
        errorCode: 'quota_exhausted',
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    ];
    db.radarDiscoveryRuns = [{
      id: 'discover-a',
      ownerId: 'user-a',
      startedAt: now,
      completedAt: now,
      status: 'completed',
      added: 8,
    }];
    db.radarDiscoveryFeedback = [
      { id: 'f1', ownerId: 'user-a', sourceContentId: 'v1', decision: 'interesting', createdAt: now },
      { id: 'f2', ownerId: 'user-a', sourceContentId: 'v2', decision: 'not_interested', createdAt: now },
    ];
    db.radarDiscoveryExposures = [
      { id: 'e1', ownerId: 'user-a', sourceContentId: 'v3', action: 'passed', tasteVersion: 1, createdAt: now },
    ];
    db.radarScanRuns = [{
      id: 'scan-a',
      ownerId: 'user-a',
      startedAt: now,
      completedAt: now,
      scanned: 1,
      opportunitiesCreated: 1,
      errors: 0,
      status: 'completed',
    }];
    db.radarOpportunities = [{
      id: 'op-a',
      ownerId: 'user-a',
      sourceType: 'youtube',
      sourceContentId: 'v1',
      sourceTitle: 'Source',
      sourceUrl: 'https://example.com',
      title: 'Idea',
      hook: 'Hook',
      coreIdea: 'Core',
      whyInteresting: 'Why',
      angle: 'Angle',
      relevance: 90,
      status: 'scripted',
      savedAt: now,
      createdAt: now,
      updatedAt: now,
    }];
    db.scripts = [{
      id: 'script-a',
      ownerId: 'user-a',
      radarOpportunityId: 'op-a',
      createdAt: now,
      title: 'Article',
      promptTemplate: 'radar_opportunity_script',
      videoIds: ['v1'],
      videoTitles: ['Source'],
      content: 'Output',
      outputFormat: 'article',
      version: 1,
      scheduledAt: now,
    } as any];

    await storage.saveDb();

    const result = await analytics.getAdminAnalytics('7d');
    assert.equal(result.kpis.totalUsers, 1);
    assert.equal(result.kpis.activeUsers, 1);
    assert.equal(result.kpis.radarAnalyses, 1);
    assert.equal(result.kpis.aiGenerations, 1);
    assert.equal(result.ai.totalTokens, 150);
    assert.equal(result.ai.estimatedCostUsd, 0.012);
    assert.equal(result.ai.byModel[0].errors + result.ai.byModel[1].errors, 1);
    assert.equal(result.product.discoveryRuns, 1);
    assert.equal(result.product.recommendationsFound, 8);
    assert.equal(result.product.feedback.interested, 1);
    assert.equal(result.product.feedback.notInterested, 1);
    assert.equal(result.product.feedback.skipped, 1);
    assert.equal(result.product.ideasCreated, 1);
    assert.equal(result.product.ideasSaved, 1);
    assert.equal(result.product.outputsCreated, 1);
    assert.equal(result.product.scheduled, 1);
    assert.equal(result.users[0].quota.used.radarAnalyses, 4);

    const registry = llmTasks.getLLMTaskRegistry();
    assert.equal(registry.length, Object.keys(llmTasks.LLM_TASKS).length);
    assert.ok(registry.every(task => task.version && task.operation.endsWith(':' + task.version)));
    assert.ok(registry.every(task => task.promptSource && task.outputContract && task.fallbackPolicy));
    assert.ok(registry.every(task => !JSON.stringify(task).toLowerCase().includes('api_key')));
  } finally {
    process.chdir(originalCwd);
    await rm(scratch, { recursive: true, force: true });
  }
});
