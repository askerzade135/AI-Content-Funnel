import React, { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import ruLocale from '@fullcalendar/core/locales/ru';
import { CalendarDays, CheckCircle2, FileText } from 'lucide-react';
import { GeneratedScript, PublicationJob, PublicationPlatform } from '../types';
import { authFetch } from '../services/authFetch';
import { connectGoogleCalendar } from '../services/googleAuth';
import { useIntegrationState } from '../hooks/useIntegrationState';
import { useI18n } from '../i18n';
import { PlatformIcon, publicationPlatformLabel } from './PlatformIcon';
import { CustomSelect } from './CustomSelect';
import { PublicationDetailsModal } from './PublicationDetailsModal';
import { PublicationModal } from './PublicationModal';
import { createContentRadarCalendarEvent } from '../services/googleCalendarService';

interface CalendarWorkspaceProps {
  onOpenScript: (scriptId: string) => void;
}

type CalendarView = 'timeGridWeek' | 'dayGridMonth';
type PlatformFilter = 'all' | PublicationPlatform;
const VIEW_STORAGE_KEY = 'acf:calendar-view';

interface CalendarItem {
  id: string;
  scheduledAt: string;
  platform?: GeneratedScript['publicationPlatform'];
  script: GeneratedScript;
  publication?: PublicationJob;
}

const platformTint = (platform?: GeneratedScript['publicationPlatform']) => {
  if (platform === 'youtube') return { background: '#fff1f2', border: '#fecdd3' };
  if (platform === 'instagram') return { background: '#fff1f6', border: '#fbcfe8' };
  if (platform === 'tiktok') return { background: 'linear-gradient(135deg,#f0fdfa 0%,#fff7fb 100%)', border: '#99f6e4' };
  if (platform === 'telegram') return { background: '#eff6ff', border: '#bfdbfe' };
  return { background: '#f5f5f4', border: '#e7e5e4' };
};

const isNoTime = (value: string) => {
  const date = new Date(value);
  return date.getHours() === 0 && date.getMinutes() === 0;
};

export const CalendarWorkspace: React.FC<CalendarWorkspaceProps> = ({ onOpenScript }) => {
  const { locale, t } = useI18n();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [publications, setPublications] = useState<PublicationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CalendarView>(() => {
    try { return localStorage.getItem(VIEW_STORAGE_KEY) === 'dayGridMonth' ? 'dayGridMonth' : 'timeGridWeek'; }
    catch { return 'timeGridWeek'; }
  });
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [title, setTitle] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null);
  const { connected: googleConnected, refresh: refreshCalendarConnection } = useIntegrationState('calendar');

  const loadData = async () => {
    setLoading(true);
    try {
      const [scriptsRes, publicationsRes] = await Promise.all([
        authFetch('/api/radar/scripts'),
        authFetch('/api/publications'),
      ]);
      const scriptsData = scriptsRes.ok ? await scriptsRes.json() : [];
      const publicationsData = publicationsRes.ok ? await publicationsRes.json() : { jobs: [] };
      setScripts(Array.isArray(scriptsData) ? scriptsData : []);
      setPublications(Array.isArray(publicationsData?.jobs) ? publicationsData.jobs : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const items = useMemo<CalendarItem[]>(() => {
    const scriptMap = new Map(scripts.map(script => [script.id, script]));
    const publicationItems: CalendarItem[] = publications
      .filter(job => Boolean(job.scheduledAt))
      .map(job => {
        const script = scriptMap.get(job.scriptId);
        return script ? {
          id: 'publication:' + job.id,
          scheduledAt: job.scheduledAt!,
          platform: job.platform,
          script,
          publication: job,
        } : null;
      })
      .filter(Boolean) as CalendarItem[];

    const representedScripts = new Set(publicationItems.map(item => item.script.id));
    const legacyItems: CalendarItem[] = scripts
      .filter(script => Boolean(script.scheduledAt) && !script.archivedAt && !representedScripts.has(script.id))
      .map(script => ({
        id: 'script:' + script.id,
        scheduledAt: script.scheduledAt!,
        platform: script.publicationPlatform,
        script,
      }));

    return [...publicationItems, ...legacyItems]
      .filter(item => platformFilter === 'all' || item.platform === platformFilter)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [scripts, publications, platformFilter]);

  const events = useMemo(() => items.map(item => ({
    id: item.id,
    title: item.publication?.title || item.script.ideaTitle || item.script.title,
    start: item.scheduledAt,
    allDay: isNoTime(item.scheduledAt),
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    textColor: '#1c1917',
    extendedProps: { item },
  })), [items]);

  const upcoming = items.filter(item => new Date(item.scheduledAt).getTime() >= Date.now());
  const dateLocale = locale === 'ru' ? 'ru-RU' : 'en-US';

  const setCalendarView = (next: CalendarView) => {
    setView(next);
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch {}
    calendarRef.current?.getApi().changeView(next);
  };

  const connectCalendar = async () => {
    setGoogleBusy(true);
    setMoveError(null);
    try {
      await connectGoogleCalendar();
      await refreshCalendarConnection();
    } catch (error: any) {
      setMoveError(error?.message || t('calendar.googleNotConnected'));
    } finally {
      setGoogleBusy(false);
    }
  };

  const moveItem = async (item: CalendarItem, scheduledAt: string) => {
    setMoveError(null);
    if (item.publication) {
      const previous = publications;
      setPublications(current => current.map(job => job.id === item.publication!.id ? { ...job, scheduledAt } : job));
      try {
        const response = await authFetch('/api/publications/' + item.publication.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledAt }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || t('calendar.moveFailed'));
        let updatedJob = data.job as PublicationJob;
        if (googleConnected) {
          const calendar = await createContentRadarCalendarEvent({
            title: updatedJob.title || item.script.ideaTitle || item.script.title,
            description: updatedJob.description,
            scheduledAt,
            publicationPlatform: updatedJob.platform,
          }, updatedJob.calendarId && updatedJob.calendarEventId ? { calendarId: updatedJob.calendarId, eventId: updatedJob.calendarEventId } : undefined);
          const syncResponse = await authFetch('/api/publications/' + updatedJob.id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              calendarId: calendar.calendarId,
              calendarEventId: calendar.eventId,
              calendarEventUrl: calendar.url,
            }),
          });
          const syncData = await syncResponse.json().catch(() => ({}));
          if (syncResponse.ok && syncData.job) updatedJob = syncData.job;
        }
        setPublications(current => current.map(job => job.id === item.publication!.id ? updatedJob : job));
      } catch (error: any) {
        setPublications(previous);
        setMoveError(error?.message || t('calendar.moveFailed'));
        throw error;
      }
      return;
    }

    const previous = scripts;
    setScripts(current => current.map(script => script.id === item.script.id ? { ...script, scheduledAt } : script));
    try {
      const response = await authFetch('/api/radar/scripts/' + item.script.id + '/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('calendar.moveFailed'));
      setScripts(current => current.map(script => script.id === item.script.id ? { ...script, ...(data.script || {}), scheduledAt } : script));
    } catch (error: any) {
      setScripts(previous);
      setMoveError(error?.message || t('calendar.moveFailed'));
      throw error;
    }
  };

  const openScriptFromDetails = (item: CalendarItem) => {
    setSelectedItem(null);
    setEditingItem(null);
    onOpenScript(item.script.id);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 xl:p-7">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight text-stone-950">{t('calendar.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-500">{t('calendar.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void connectCalendar()}
            disabled={googleBusy}
            className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition disabled:opacity-50 ${googleConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-white text-stone-600'}`}
          >
            {googleConnected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
            Google Calendar
          </button>
          <div className="inline-flex h-10 items-center rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600">
            {t('calendar.scheduled', { count: items.length })}
          </div>
        </div>
      </header>

      {moveError && <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{moveError}</div>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-[0_12px_36px_rgba(28,25,23,0.03)]">
          <div className="flex flex-col gap-3 border-b border-stone-100 p-3 lg:flex-row lg:items-center lg:justify-between lg:px-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button type="button" onClick={() => calendarRef.current?.getApi().prev()} className="h-10 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700">←</button>
              <button type="button" onClick={() => calendarRef.current?.getApi().today()} className="h-10 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-700">{t('calendar.today')}</button>
              <button type="button" onClick={() => calendarRef.current?.getApi().next()} className="h-10 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700">→</button>
              <div className="min-w-0 text-sm font-bold capitalize text-stone-900 sm:text-base">{title}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CustomSelect
                value={platformFilter}
                onChange={setPlatformFilter}
                ariaLabel={locale === 'ru' ? 'Фильтр платформ' : 'Platform filter'}
                className="w-[170px]"
                triggerClassName="!h-10 !text-xs"
                options={[
                  { value: 'all', label: locale === 'ru' ? 'Все платформы' : 'All platforms' },
                  { value: 'youtube', label: 'YouTube', icon: <PlatformIcon platform="youtube" /> },
                  { value: 'instagram', label: 'Instagram', icon: <PlatformIcon platform="instagram" /> },
                  { value: 'tiktok', label: 'TikTok', icon: <PlatformIcon platform="tiktok" /> },
                ]}
              />
              <div className="grid shrink-0 grid-cols-2 rounded-xl bg-stone-100 p-1">
                <button type="button" onClick={() => setCalendarView('timeGridWeek')} className={`h-9 rounded-lg px-4 text-xs font-semibold ${view === 'timeGridWeek' ? 'bg-emerald-600 text-white shadow-sm' : 'text-stone-500'}`}>{t('calendar.week')}</button>
                <button type="button" onClick={() => setCalendarView('dayGridMonth')} className={`h-9 rounded-lg px-4 text-xs font-semibold ${view === 'dayGridMonth' ? 'bg-emerald-600 text-white shadow-sm' : 'text-stone-500'}`}>{t('calendar.month')}</button>
              </div>
            </div>
          </div>

          <div className="calendar-shell min-w-0 overflow-x-auto p-1.5 sm:p-2">
            <div className={view === 'timeGridWeek' ? 'content-calendar-compact min-w-[760px]' : 'min-w-[680px]'}>
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView={view}
                headerToolbar={false}
                locales={[ruLocale]}
                locale={locale === 'ru' ? 'ru' : 'en'}
                firstDay={1}
                editable
                eventStartEditable
                eventDurationEditable={false}
                allDayMaintainDuration
                nowIndicator
                height={view === 'timeGridWeek' ? 620 : 'auto'}
                stickyHeaderDates
                expandRows={false}
                slotDuration="00:30:00"
                slotLabelInterval="01:00:00"
                slotMinTime="07:00:00"
                slotMaxTime="22:00:00"
                scrollTime="08:00:00"
                scrollTimeReset={false}
                dayMaxEventRows={3}
                moreLinkClick="popover"
                events={events}
                datesSet={info => {
                  setTitle(info.view.title);
                  setView(info.view.type as CalendarView);
                }}
                eventClick={info => setSelectedItem(info.event.extendedProps.item as CalendarItem)}
                eventDrop={info => {
                  const next = info.event.start;
                  const item = info.event.extendedProps.item as CalendarItem;
                  if (!next || !item) return info.revert();
                  const scheduledAt = info.event.allDay
                    ? new Date(next.getFullYear(), next.getMonth(), next.getDate(), 0, 0, 0, 0).toISOString()
                    : next.toISOString();
                  void moveItem(item, scheduledAt).catch(() => info.revert());
                }}
                eventContent={arg => {
                  const item = arg.event.extendedProps.item as CalendarItem;
                  const tint = platformTint(item.platform);
                  return (
                    <div style={{ background: tint.background, borderColor: tint.border }} className="min-w-0 rounded-md border px-1.5 py-1 text-left shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
                      <div className="flex min-w-0 items-center gap-1 text-[9px] font-semibold text-stone-700">
                        <PlatformIcon platform={item.platform} className="h-3.5 w-3.5" />
                        <span className="truncate">{arg.timeText || t('calendar.allDay')}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[9px] font-bold leading-3 text-stone-900">{arg.event.title}</div>
                    </div>
                  );
                }}
              />
            </div>
          </div>
        </section>

        <aside className="min-w-0 rounded-3xl border border-stone-200 bg-white p-4 shadow-[0_12px_36px_rgba(28,25,23,0.03)]">
          <div className="mb-4">
            <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-emerald-600" /><h3 className="font-bold text-stone-950">{t('calendar.upcoming')}</h3></div>
            <p className="mt-1 text-[11px] text-stone-500">{t('calendar.upcomingHint')}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {upcoming.map(item => {
              const tint = platformTint(item.platform);
              const cover = item.script.thumbnail || (
                item.publication?.remoteId && item.platform === 'youtube'
                  ? `https://i.ytimg.com/vi/${item.publication.remoteId}/hqdefault.jpg`
                  : undefined
              );
              return (
                <button key={item.id} type="button" onClick={() => setSelectedItem(item)} style={{ borderColor: tint.border }} className="w-full rounded-2xl border bg-white p-3 text-left transition hover:shadow-sm">
                  <div className="flex min-w-0 gap-3">
                    <div style={{ background: tint.background }} className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl">
                      {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : <PlatformIcon platform={item.platform} className="h-7 w-7" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-stone-500"><PlatformIcon platform={item.platform} className="h-3.5 w-3.5" /> {publicationPlatformLabel(item.platform, locale)}</div>
                      <div className="mt-1 text-[10px] text-stone-400">{new Date(item.scheduledAt).toLocaleString(dateLocale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                      <div className="mt-1 line-clamp-2 text-xs font-bold leading-4 text-stone-900">{item.publication?.title || item.script.ideaTitle || item.script.title}</div>
                    </div>
                  </div>
                </button>
              );
            })}
            {!loading && upcoming.length === 0 && <div className="rounded-2xl border-2 border-dashed border-stone-200 px-4 py-8 text-center text-xs text-stone-400 sm:col-span-2 xl:col-span-1"><FileText className="mx-auto mb-2 h-5 w-5 text-stone-300" />{t('calendar.none')}</div>}
          </div>
        </aside>
      </div>

      {selectedItem && !editingItem && (
        <PublicationDetailsModal
          publication={selectedItem.publication || null}
          script={selectedItem.script}
          onClose={() => setSelectedItem(null)}
          onEdit={() => { setEditingItem(selectedItem); setSelectedItem(null); }}
          onOpenScript={() => openScriptFromDetails(selectedItem)}
          onChanged={loadData}
        />
      )}

      {editingItem && (
        <PublicationModal
          script={editingItem.script}
          initialPublication={editingItem.publication || null}
          onClose={() => setEditingItem(null)}
          onPublished={async () => {
            await loadData();
            setEditingItem(null);
          }}
        />
      )}
    </div>
  );
};
