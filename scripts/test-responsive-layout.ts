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


test('FullCalendar provides Month/Week with drag-and-drop through existing schedule endpoint', () => {
  const calendar = fs.readFileSync(new URL('../src/components/CalendarWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(calendar, /@fullcalendar\/react/);
  assert.match(calendar, /dayGridPlugin/);
  assert.match(calendar, /timeGridPlugin/);
  assert.match(calendar, /interactionPlugin/);
  assert.match(calendar, /eventDrop=/);
  assert.match(calendar, /\/api\/radar\/scripts\/.*\/schedule/);
});

test('Discover uses source type badges and Web placeholders with domain metadata', () => {
  assert.match(source, /item\.sourceType === 'web'/);
  assert.match(source, /sourceDomain/);
  assert.match(source, /Globe2/);
  assert.match(source, /PlatformIcon platform="youtube"/);
  assert.doesNotMatch(source, /<select\b/);
});

test('shared CustomSelect replaces native select on main product surfaces', () => {
  const paths = [
    '../src/components/ContentRadar.tsx',
    '../src/components/PublicationModal.tsx',
    '../src/components/SettingsModal.tsx',
  ];
  for (const item of paths) {
    const component = fs.readFileSync(new URL(item, import.meta.url), 'utf8');
    assert.doesNotMatch(component, /<select\b/);
  }
});
