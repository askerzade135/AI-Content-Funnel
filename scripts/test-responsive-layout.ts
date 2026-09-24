import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/components/ContentRadar.tsx', import.meta.url), 'utf8');

test('Ideas keeps three cards on standard and wide desktop', () => {
  assert.match(source, /data-testid="ideas-grid"[^>]*md:grid-cols-2[^>]*xl:grid-cols-3/);
  assert.doesNotMatch(source, /data-testid="ideas-grid"[^>]*min-\[1440px\]:grid-cols-3/);
});

test('Recommended format has fixed equal height and compact Create/Open + format select action', () => {
  assert.match(source, /data-testid="recommended-format"[^>]*h-\[132px\][^>]*flex-col/);
  assert.match(source, /data-testid="create-format-select"/);
  assert.match(source, /w-\[96px\] shrink-0/);
  assert.match(source, /selectedOutput[\s\S]{0,400}Открыть[\s\S]{0,80}Open/);
  assert.doesNotMatch(source, /Create in another format:/);
  assert.doesNotMatch(source, /Другой формат:/);
});

test('Ideas filters use tablet two-column layout before desktop row', () => {
  assert.match(source, /grid gap-2 md:grid-cols-2 xl:grid-cols-\[minmax\(260px,1fr\)_180px_180px_160px\]/);
});
