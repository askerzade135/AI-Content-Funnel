import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('admin analytics aggregates users, costs, product funnel and LLM registry without provider calls', async () => {
  const originalCwd = process.cwd();
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'admin-analytics-'));
  process.env.APP_STORAGE = 'local-json';
  const previousChocodataKey = process.env.CHOCODATA_API_KEY;
  process.env.CHOCODATA_API_KEY = 'test-chocodata-platform-key';
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
    db.transcriptUsageLogs = [{
      id: 'transcript-choco-live',
      ownerId: 'user-a',
      timestamp: now,
      videoId: 'v1',
      provider: 'chocodata',
      keySource: 'platform',
      operation: 'transcript',
      units: 1,
      unitType: 'request',
      status: 'success',
      providerQuota: {
        used: 21,
        limit: 1000,
        remaining: 979,
        unit: 'request',
        source: 'provider_response',
      },
    }];

    db.webSearchUsageLogs = [
      {
        id: 'search-google-1',
        ownerId: 'user-a',
        timestamp: now,
        provider: 'google',
        status: 'success',
        units: 1,
        unitType: 'request',
      },
      {
        id: 'search-tavily-1',
        ownerId: 'user-a',
        timestamp: now,
        provider: 'tavily',
        status: 'success',
        units: 1,
        unitType: 'credit',
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
    assert.equal(result.ai.searchRequestsThisMonth, 2);
    const googleQuota = result.ai.providerQuota.find(item => item.id === 'search-google');
    const tavilyQuota = result.ai.providerQuota.find(item => item.id === 'search-tavily');
    const geminiQuota = result.ai.providerQuota.find(item => item.id === 'llm-gemini');
    const chocodataQuota = result.ai.providerQuota.find(item => item.id === 'transcript-chocodata');
    assert.equal(googleQuota?.used, 1);
    assert.equal(googleQuota?.remaining, 4999);
    assert.equal(tavilyQuota?.used, 1);
    assert.equal(tavilyQuota?.remaining, 999);
    assert.equal(geminiQuota?.remaining, null);
    assert.equal(chocodataQuota?.category, 'transcription');
    assert.equal(chocodataQuota?.used, 21);
    assert.equal(chocodataQuota?.limit, 1000);
    assert.equal(chocodataQuota?.remaining, 979);
    assert.equal(chocodataQuota?.accuracy, 'live');
    assert.ok(result.ai.providerQuota.every(item => item.remaining === null || item.remaining >= 0));

    const registry = llmTasks.getLLMTaskRegistry();
    assert.equal(registry.length, Object.keys(llmTasks.LLM_TASKS).length);
    assert.ok(registry.every(task => task.version && task.operation.endsWith(':' + task.version)));
    assert.ok(registry.every(task => task.promptSource && task.outputContract && task.fallbackPolicy));
    assert.ok(registry.every(task => !JSON.stringify(task).toLowerCase().includes('api_key')));
  } finally {
    process.chdir(originalCwd);
    if (previousChocodataKey === undefined) delete process.env.CHOCODATA_API_KEY;
    else process.env.CHOCODATA_API_KEY = previousChocodataKey;
    await rm(scratch, { recursive: true, force: true });
  }
});


test('infrastructure diagnostics aggregate health without exposing secrets', async () => {
  const fs = await import('node:fs/promises');
  const diagnostics = await fs.readFile(path.join(process.cwd(), 'server/infrastructure-diagnostics.ts'), 'utf8');
  const server = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');

  assert.match(server, /\/api\/admin\/infrastructure-diagnostics/);
  assert.match(diagnostics, /getFirestoreSnapshotStatus/);
  assert.match(diagnostics, /serverPendingQueue/);
  assert.match(diagnostics, /serverActiveJobIds/);
  assert.match(diagnostics, /safeToRetireLegacy/);
  assert.match(diagnostics, /scriptVersionsWithoutParent/);
  assert.match(diagnostics, /publicationJobsWithoutScript/);
  assert.match(diagnostics, /workflowOnlyScheduled/);
  assert.match(diagnostics, /paidRequests24h/);
  assert.match(diagnostics, /googleCalendar:[\s\S]*client-events/);
  assert.match(diagnostics, /googleCalendarFailures24h/);
  assert.match(diagnostics, /lastFailure/);
  assert.doesNotMatch(diagnostics, /encryptedAccessToken/);
  assert.doesNotMatch(diagnostics, /process\.env\.[A-Z0-9_]+.*return|apiKey:/);
});


test('Google Calendar client failures are accepted as structured integration diagnostics without tokens', async () => {
  const fs = await import('node:fs/promises');
  const server = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');
  const calendar = await fs.readFile(path.join(process.cwd(), 'src/components/CalendarWorkspace.tsx'), 'utf8');
  const calendarService = await fs.readFile(path.join(process.cwd(), 'src/services/googleCalendarService.ts'), 'utf8');
  const reporter = await fs.readFile(path.join(process.cwd(), 'src/services/integrationDiagnostics.ts'), 'utf8');

  assert.match(server, /\/api\/integrations\/client-event/);
  assert.match(server, /category: 'integration'/);
  assert.match(server, /provider,/);
  assert.match(server, /operation,/);
  assert.match(server, /errorCode:/);
  assert.match(calendar, /provider: 'google_calendar'/);
  assert.match(calendar, /operation: 'connect'/);
  assert.match(calendarService, /operation: 'api_request'/);
  assert.match(calendarService, /HTTP_\$\{response\.status\}/);
  assert.match(reporter, /Diagnostics must never block the user's integration flow/);
  assert.doesNotMatch(reporter, /accessToken|refreshToken/);
});
