import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sidebar = fs.readFileSync(new URL('../src/components/ProductSidebar.tsx', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../src/components/PlanQuotasWorkspace.tsx', import.meta.url), 'utf8');
const radarWorkspace = fs.readFileSync(new URL('../src/components/RadarWorkspace.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const types = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');

test('Plan and Quotas is a real product section instead of a decorative sidebar card', () => {
  assert.match(types, /'quotas'/);
  assert.match(sidebar, /onChange\('quotas'\)/);
  assert.match(sidebar, /nav\.planQuotas/);
  assert.match(app, /'calendar', 'quotas', 'settings'/);
  assert.match(radarWorkspace, /section === 'quotas'/);
  assert.match(radarWorkspace, /PlanQuotasWorkspace/);
});

test('sidebar quota status warns at 80 percent and exhausts at 100 percent', () => {
  assert.match(sidebar, /quotaPercent >= 100 \? 'exhausted'/);
  assert.match(sidebar, /quotaPercent >= 80 \? 'warning'/);
  assert.match(sidebar, /quotaRemaining/);
});

test('quota workspace separates customer product quotas from provider infrastructure', () => {
  assert.match(workspace, /Radar Analysis/);
  assert.match(workspace, /AI Generation/);
  assert.match(workspace, /Transcriptions/);
  assert.match(workspace, /Transcript minutes/);
  assert.match(workspace, /Provider rate limits are infrastructure constraints/);
  assert.match(workspace, /Below 80%/);
  assert.match(workspace, /At 100%/);
});

test('target Free and Pro model is explicitly preview-only until billing is connected', () => {
  assert.match(workspace, /free:\s*\{[\s\S]*radar: 20/);
  assert.match(workspace, /pro:\s*\{[\s\S]*radar: 300/);
  assert.match(workspace, /Until billing is connected/);
  assert.match(workspace, /Billing coming later/);
});
