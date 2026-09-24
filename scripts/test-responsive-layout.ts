import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/components/ContentRadar.tsx', import.meta.url), 'utf8');

test('Ideas grid stays two columns through 1280 and becomes three columns at 1440+', () => {
  assert.match(source, /data-testid="ideas-grid"[^>]*md:grid-cols-2[^>]*min-\[1440px\]:grid-cols-3/);
  assert.doesNotMatch(source, /data-testid="ideas-grid"[^>]*xl:grid-cols-3/);
});

test('Recommended format uses a full-width stacked action', () => {
  assert.match(source, /data-testid="recommended-format"/);
  assert.match(source, /data-testid="recommended-format"[\s\S]{0,500}flex min-w-0 flex-col gap-3/);
  assert.match(source, /relative flex w-full min-w-0/);
  assert.match(source, /min-w-0 flex-1 items-center justify-center/);
});

test('Ideas filters use tablet two-column layout before desktop row', () => {
  assert.match(source, /grid gap-2 md:grid-cols-2 xl:grid-cols-\[minmax\(260px,1fr\)_180px_180px_160px\]/);
});
