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

test('shared CustomSelect replaces native select across user-facing components', () => {
  const componentsDir = new URL('../src/components/', import.meta.url);
  const paths = fs.readdirSync(componentsDir)
    .filter(name => name.endsWith('.tsx') && name !== 'CustomSelect.tsx');
  for (const item of paths) {
    const component = fs.readFileSync(new URL('../src/components/' + item, import.meta.url), 'utf8');
    assert.doesNotMatch(component, /<select\b/, item + ' still contains a native select');
  }
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /<select\b/, 'App.tsx still contains a native select');

  const customSelect = fs.readFileSync(new URL('../src/components/CustomSelect.tsx', import.meta.url), 'utf8');
  assert.match(customSelect, /createPortal/);
  assert.match(customSelect, /position: 'fixed'/);
  assert.match(customSelect, /icon\?: ReactNode/);
});


test('FullCalendar follows RU/EN application locale', () => {
  const calendar = fs.readFileSync(new URL('../src/components/CalendarWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(calendar, /@fullcalendar\/core\/locales\/ru/);
  assert.match(calendar, /locale=\{locale === 'ru' \? 'ru' : 'en'\}/);
});


test('Calendar is publication-centric with platform tints, filters and details modal', () => {
  const calendar = fs.readFileSync(new URL('../src/components/CalendarWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(calendar, /\/api\/publications/);
  assert.match(calendar, /PublicationDetailsModal/);
  assert.match(calendar, /PublicationModal/);
  assert.match(calendar, /moreLinkClick="popover"/);
  assert.match(calendar, /platformTint/);
  assert.match(calendar, /PlatformFilter/);
  assert.match(calendar, /authFetch\('\/api\/publications\/' \+ item\.publication\.id/);
  assert.match(calendar, /method: 'PATCH'/);
});


test('global offline and crash recovery prevent blank grey screen', () => {
  const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const banner = fs.readFileSync(new URL('../src/components/NetworkStatusBanner.tsx', import.meta.url), 'utf8');
  const boundary = fs.readFileSync(new URL('../src/components/AppErrorBoundary.tsx', import.meta.url), 'utf8');
  const authFetch = fs.readFileSync(new URL('../src/services/authFetch.ts', import.meta.url), 'utf8');

  assert.match(main, /NetworkStatusBanner/);
  assert.match(main, /installGlobalCrashFallback/);
  assert.match(banner, /window\.addEventListener\('offline'/);
  assert.match(banner, /window\.addEventListener\('online'/);
  assert.match(banner, /Connection restored|Соединение восстановлено/);
  assert.match(boundary, /installGlobalCrashFallback/);
  assert.match(boundary, /window\.addEventListener\('error'/);
  assert.match(boundary, /window\.addEventListener\('unhandledrejection'/);
  assert.match(boundary, /Reload|Перезагрузить/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /NETWORK_RETRY_EVENT/);
  assert.match(app, /getIdToken\(true\)/);
  assert.match(authFetch, /normalizeNetworkError/);
  assert.match(authFetch, /isBrowserOffline/);
});


test('weekly Content plan uses compact bounded density instead of page-height expansion', () => {
  const calendar = fs.readFileSync(new URL('../src/components/CalendarWorkspace.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(calendar, /content-calendar-compact/);
  assert.match(calendar, /height=\{view === 'timeGridWeek' \? 620 : 'auto'\}/);
  assert.match(calendar, /slotDuration="00:30:00"/);
  assert.match(calendar, /slotLabelInterval="01:00:00"/);
  assert.match(calendar, /slotMinTime="07:00:00"/);
  assert.match(calendar, /slotMaxTime="22:00:00"/);
  assert.match(calendar, /scrollTime="08:00:00"/);
  assert.match(css, /\.content-calendar-compact \.fc \.fc-timegrid-slot/);
  assert.match(css, /height: 18px/);
});


test('core product actions use Radar green instead of heavy black controls', () => {
  const radar = fs.readFileSync(new URL('../src/components/ContentRadar.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/components/RadarWorkspace.tsx', import.meta.url), 'utf8');
  const scripts = fs.readFileSync(new URL('../src/components/RadarScriptsWorkspace.tsx', import.meta.url), 'utf8');
  const calendar = fs.readFileSync(new URL('../src/components/CalendarWorkspace.tsx', import.meta.url), 'utf8');
  const publish = fs.readFileSync(new URL('../src/components/PublicationModal.tsx', import.meta.url), 'utf8');

  assert.match(radar, /bg-emerald-600 px-5 text-xs font-semibold text-white/);
  assert.match(workspace, /border-emerald-200 bg-emerald-50 text-emerald-800/);
  assert.doesNotMatch(workspace, /bg-stone-950/);
  assert.doesNotMatch(scripts, /bg-stone-950(?:\s|["'])[^\n]*(?:text-white|rounded-(?:xl|full)|px-\d)/);
  assert.doesNotMatch(calendar, /bg-stone-950/);
  assert.match(publish, /bg-emerald-600 px-4 text-xs font-semibold text-white/);
});

test('Ideas header and settings language block stay compact on desktop', () => {
  const radar = fs.readFileSync(new URL('../src/components/ContentRadar.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/components/RadarWorkspace.tsx', import.meta.url), 'utf8');

  assert.match(radar, /xl:max-w-\[720px\]/);
  assert.match(radar, /lg:flex-row lg:items-center lg:justify-between/);
  assert.doesNotMatch(radar, /ideasUpdatedLabel/);

  assert.match(workspace, /max-w-3xl rounded-2xl border border-stone-200 bg-white px-4 py-3\.5/);
  assert.match(workspace, /sm:w-\[260px\]/);
});

test('Today focus removes ornamental numbering and Plan Quotas is denser', () => {
  const workspace = fs.readFileSync(new URL('../src/components/RadarWorkspace.tsx', import.meta.url), 'utf8');
  const quotas = fs.readFileSync(new URL('../src/components/PlanQuotasWorkspace.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(workspace, /\{index \+ 1\}/);
  assert.doesNotMatch(workspace, /today\.focusCount/);
  assert.match(workspace, /What is worth moving forward today/);

  assert.match(quotas, /mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4/);
  assert.match(quotas, /rounded-2xl border bg-white p-4 shadow-sm/);
  assert.match(quotas, /How quotas work/);
});

test('Radar source platform icon keeps YouTube brand treatment', () => {
  const radar = fs.readFileSync(new URL('../src/components/ContentRadar.tsx', import.meta.url), 'utf8');
  assert.match(radar, /item\.value === 'youtube'/);
  assert.match(radar, /border border-rose-100 bg-white shadow-sm/);
  assert.match(radar, /<PlatformIcon platform="youtube" className="h-4 w-4"/);
});


test('Scripts uses Board/List library with a fullscreen work surface', () => {
  const scripts = fs.readFileSync(new URL('../src/components/RadarScriptsWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(scripts, /useState<'board' \| 'list'>\('board'\)/);
  assert.match(scripts, /setViewMode\('board'\)/);
  assert.match(scripts, /setViewMode\('list'\)/);
  assert.match(scripts, /boardColumns/);
  assert.match(scripts, /onDragStart=\{\(\) => setDraggedScriptId\(script\.id\)\}/);
  assert.match(scripts, /onDrop=\{event =>/);
  assert.match(scripts, /fixed inset-0 z-\[80\]/);
  assert.match(scripts, /h-\[94vh\]/);
  assert.match(scripts, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(scripts, /'script', locale === 'ru' \? 'Сценарий' : 'Script'/);
  assert.match(scripts, /'media', locale === 'ru' \? 'Медиа' : 'Media'/);
  assert.match(scripts, /'publication', locale === 'ru' \? 'Публикация' : 'Publication'/);
  assert.match(scripts, /'history', locale === 'ru' \? 'История' : 'History'/);
  assert.match(scripts, /Script details|Детали сценария/);
  assert.doesNotMatch(scripts, /xl:grid-cols-\[minmax\(360px,42%\)_minmax\(0,58%\)\]/);
});


test('Scripts editor uses click-to-edit and embedded publication workspace', () => {
  const scripts = fs.readFileSync(new URL('../src/components/RadarScriptsWorkspace.tsx', import.meta.url), 'utf8');
  const publication = fs.readFileSync(new URL('../src/components/PublicationModal.tsx', import.meta.url), 'utf8');

  assert.match(scripts, /Click the text to edit|Нажмите на текст, чтобы редактировать/);
  assert.match(scripts, /editorTextareaRef/);
  assert.match(scripts, /requestEditorTab/);
  assert.match(scripts, /Save & continue|Сохранить и продолжить/);
  assert.match(scripts, /Continue without saving|Без сохранения/);
  assert.match(scripts, /<PublicationModal\s+embedded/);
  assert.doesNotMatch(scripts, /setPublishingScript/);
  assert.doesNotMatch(scripts, /Open publishing|Открыть публикацию/);
  assert.doesNotMatch(scripts, /Sync with Google Calendar|Синхронизировать с Google Calendar/);
  assert.doesNotMatch(scripts, /onClick=\{\(\) => void review\(current, 'approved'\)\}/);
  assert.match(scripts, /confirmImproveScript/);
  assert.match(scripts, /This uses 1 AI Generation|Используется 1 AI Generation/);
  assert.match(scripts, /confirmCreateManualScript/);
  assert.match(scripts, /Creates a manual standalone script|Создаст самостоятельный сценарий вручную/);

  assert.match(publication, /embedded\?: boolean/);
  assert.match(publication, /embedded \? 'h-full min-h-0'/);
  assert.match(publication, /!embedded && <button type="button" onClick=\{onClose\}/);
});
