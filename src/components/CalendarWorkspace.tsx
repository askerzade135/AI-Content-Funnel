import React, { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { CalendarDays, CheckCircle2, ExternalLink } from 'lucide-react';
import { GeneratedScript } from '../types';
import { authFetch } from '../services/authFetch';
import { connectGoogleCalendar } from '../services/googleAuth';
import { useIntegrationState } from '../hooks/useIntegrationState';
import { useI18n } from '../i18n';
import { PlatformIcon, publicationPlatformLabel } from './PlatformIcon';

interface CalendarWorkspaceProps {
  onOpenScript: (scriptId: string) => void;
}

type CalendarView = 'timeGridWeek' | 'dayGridMonth';
const VIEW_STORAGE_KEY = 'acf:calendar-view';

const isNoTime = (script: GeneratedScript) => {
  if (!script.scheduledAt) return false;
  const date = new Date(script.scheduledAt);
  return date.getHours() === 0 && date.getMinutes() === 0;
};

export const CalendarWorkspace: React.FC<CalendarWorkspaceProps> = ({ onOpenScript }) => {
  const { locale, t } = useI18n();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CalendarView>(() => {
    try { return localStorage.getItem(VIEW_STORAGE_KEY) === 'dayGridMonth' ? 'dayGridMonth' : 'timeGridWeek'; }
    catch { return 'timeGridWeek'; }
  });
  const [title, setTitle] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const { connected: googleConnected, refresh: refreshCalendarConnection } = useIntegrationState('calendar');

  useEffect(() => {
    void authFetch('/api/radar/scripts')
      .then(async response => response.ok ? await response.json() : [])
      .then(data => setScripts(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const scheduled = useMemo(
    () => scripts
      .filter(script => Boolean(script.scheduledAt) && !script.archivedAt)
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()),
    [scripts]
  );

  const events = useMemo(() => scheduled.map(script => ({
    id: script.id,
    title: script.ideaTitle || script.title,
    start: script.scheduledAt!,
    allDay: isNoTime(script),
    extendedProps: { script },
  })), [scheduled]);

  const upcoming = scheduled.filter(script =>
    !script.isPublished && new Date(script.scheduledAt!).getTime() >= Date.now()
  );
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

  const moveScript = async (scriptId: string, scheduledAt: string) => {
    const previous = scripts;
    setScripts(items => items.map(item => item.id === scriptId ? { ...item, scheduledAt } : item));
    setMoveError(null);
    try {
      const response = await authFetch('/api/radar/scripts/' + scriptId + '/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('calendar.moveFailed'));
      setScripts(items => items.map(item => item.id === scriptId ? { ...item, ...(data.script || {}), scheduledAt } : item));
    } catch (error: any) {
      setScripts(previous);
      setMoveError(error?.message || t('calendar.moveFailed'));
      throw error;
    }
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
            {t('calendar.scheduled', { count: scheduled.length })}
          </div>
        </div>
      </header>

      {moveError && <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{moveError}</div>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 overflow-hidden rounded-3xl border border-stone-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-stone-100 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button type="button" onClick={() => calendarRef.current?.getApi().prev()} className="h-10 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700">←</button>
              <button type="button" onClick={() => calendarRef.current?.getApi().today()} className="h-10 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-700">{t('calendar.today')}</button>
              <button type="button" onClick={() => calendarRef.current?.getApi().next()} className="h-10 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700">→</button>
              <div className="min-w-0 text-sm font-bold capitalize text-stone-900 sm:text-base">{title}</div>
            </div>
            <div className="grid shrink-0 grid-cols-2 rounded-xl bg-stone-100 p-1">
              <button type="button" onClick={() => setCalendarView('timeGridWeek')} className={`h-9 rounded-lg px-4 text-xs font-semibold ${view === 'timeGridWeek' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>{t('calendar.week')}</button>
              <button type="button" onClick={() => setCalendarView('dayGridMonth')} className={`h-9 rounded-lg px-4 text-xs font-semibold ${view === 'dayGridMonth' ? 'bg-stone-950 text-white' : 'text-stone-500'}`}>{t('calendar.month')}</button>
            </div>
          </div>

          <div className="calendar-shell min-w-0 overflow-x-auto p-2 sm:p-3">
            <div className={view === 'timeGridWeek' ? 'min-w-[760px]' : 'min-w-[620px]'}>
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView={view}
                headerToolbar={false}
                firstDay={1}
                editable
                eventStartEditable
                eventDurationEditable={false}
                allDayMaintainDuration
                nowIndicator
                height="auto"
                slotMinTime="08:00:00"
                slotMaxTime="23:00:00"
                dayMaxEventRows={3}
                events={events}
                datesSet={info => {
                  setTitle(info.view.title);
                  setView(info.view.type as CalendarView);
                }}
                eventClick={info => onOpenScript(info.event.id)}
                eventDrop={info => {
                  const next = info.event.start;
                  if (!next) return info.revert();
                  const script = scripts.find(item => item.id === info.event.id);
                  if (!script) return info.revert();
                  const scheduledAt = info.event.allDay
                    ? new Date(next.getFullYear(), next.getMonth(), next.getDate(), 0, 0, 0, 0).toISOString()
                    : next.toISOString();
                  void moveScript(script.id, scheduledAt).catch(() => info.revert());
                }}
                eventContent={arg => {
                  const script = arg.event.extendedProps.script as GeneratedScript;
                  return (
                    <div className="min-w-0 rounded-lg px-1.5 py-1 text-left">
                      <div className="flex min-w-0 items-center gap-1 text-[10px] font-semibold">
                        <PlatformIcon platform={script.publicationPlatform} className="h-3.5 w-3.5" />
                        <span className="truncate">{arg.timeText || t('calendar.allDay')}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] font-bold">{arg.event.title}</div>
                    </div>
                  );
                }}
              />
            </div>
          </div>
        </section>

        <aside className="min-w-0 rounded-3xl border border-stone-200 bg-white p-4">
          <div className="mb-4">
            <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-emerald-600" /><h3 className="font-bold text-stone-950">{t('calendar.upcoming')}</h3></div>
            <p className="mt-1 text-[11px] text-stone-500">{t('calendar.upcomingHint')}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {upcoming.map(script => (
              <button key={script.id} type="button" onClick={() => onOpenScript(script.id)} className="w-full rounded-2xl border border-stone-200 p-3 text-left transition hover:border-emerald-300 hover:shadow-sm">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center"><PlatformIcon platform={script.publicationPlatform} className="h-9 w-9" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold text-stone-500">{publicationPlatformLabel(script.publicationPlatform, locale)}</div>
                    <div className="mt-1 text-[10px] text-stone-400">{new Date(script.scheduledAt!).toLocaleString(dateLocale, { day: 'numeric', month: 'short', ...(isNoTime(script) ? {} : { hour: '2-digit', minute: '2-digit' }) })}</div>
                    <div className="mt-1 line-clamp-2 text-xs font-bold leading-4 text-stone-900">{script.ideaTitle || script.title}</div>
                    <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700">{t('calendar.scheduledStatus')}</span>
                  </div>
                </div>
                {script.calendarEventId && <div className="mt-2 flex justify-end"><span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-700"><ExternalLink className="h-3 w-3" /> Google</span></div>}
              </button>
            ))}
            {!loading && upcoming.length === 0 && <div className="rounded-2xl border-2 border-dashed border-stone-200 px-4 py-8 text-center text-xs text-stone-400 sm:col-span-2 xl:col-span-1">{t('calendar.none')}</div>}
          </div>
        </aside>
      </div>
    </div>
  );
};
