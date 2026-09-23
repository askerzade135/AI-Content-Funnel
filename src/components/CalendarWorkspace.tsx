import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Link2,
} from 'lucide-react';
import { GeneratedScript } from '../types';
import { authFetch } from '../services/authFetch';
import { connectGoogleCalendar, getCalendarAccessToken } from '../services/googleAuth';
import { useI18n } from '../i18n';
import { PlatformIcon, publicationPlatformLabel } from './PlatformIcon';

interface CalendarWorkspaceProps {
  onOpenScript: (scriptId: string) => void;
}

type CalendarView = 'week' | 'month';

const VIEW_STORAGE_KEY = 'acf:calendar-view';

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  telegram: 'Telegram',
  other: 'Other',
};

const startOfWeek = (input: Date) => {
  const date = new Date(input.getFullYear(), input.getMonth(), input.getDate());
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date;
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

const dateKey = (date: Date) => [date.getFullYear(), date.getMonth(), date.getDate()].join('-');

const isNoTime = (script: GeneratedScript) => {
  if (!script.scheduledAt) return false;
  const date = new Date(script.scheduledAt);
  return date.getHours() === 0 && date.getMinutes() === 0;
};

export const CalendarWorkspace: React.FC<CalendarWorkspaceProps> = ({ onOpenScript }) => {
  const { locale, t } = useI18n();
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CalendarView>(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      return saved === 'month' ? 'month' : 'week';
    } catch {
      return 'week';
    }
  });
  const [cursor, setCursor] = useState(() => new Date());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      authFetch('/api/radar/scripts')
        .then(async response => response.ok ? await response.json() : [])
        .then(data => setScripts(Array.isArray(data) ? data : [])),
      getCalendarAccessToken().then(token => setGoogleConnected(Boolean(token))),
    ]).finally(() => setLoading(false));
  }, []);

  const setCalendarView = (next: CalendarView) => {
    setView(next);
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch {}
  };

  const scheduled = useMemo(
    () => scripts
      .filter(script => Boolean(script.scheduledAt) && !script.archivedAt)
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()),
    [scripts]
  );

  const byDay = useMemo(() => {
    const map = new Map<string, GeneratedScript[]>();
    for (const script of scheduled) {
      const date = new Date(script.scheduledAt!);
      const key = dateKey(date);
      const list = map.get(key) || [];
      list.push(script);
      map.set(key, list);
    }
    return map;
  }, [scheduled]);

  const now = new Date();
  const weekStart = startOfWeek(cursor);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const monthCells: Array<number | null> = [
    ...Array.from({ length: mondayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (monthCells.length % 7 !== 0) monthCells.push(null);

  const upcoming = scheduled
    .filter(script => !script.isPublished && new Date(script.scheduledAt!).getTime() >= Date.now());

  const dateLocale = locale === 'ru' ? 'ru-RU' : 'en-US';

  const periodLabel = view === 'week'
    ? (() => {
        const first = weekDays[0];
        const last = weekDays[6];
        const firstMonth = first.toLocaleDateString(dateLocale, { month: 'short' });
        const lastMonth = last.toLocaleDateString(dateLocale, { month: 'short' });
        const sameMonth = first.getMonth() === last.getMonth();
        return sameMonth
          ? `${first.getDate()}–${last.getDate()} ${last.toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' })}`
          : `${first.getDate()} ${firstMonth} – ${last.getDate()} ${lastMonth} ${last.getFullYear()}`;
      })()
    : cursor.toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' });

  const movePeriod = (direction: -1 | 1) => {
    setCursor(current => {
      const next = new Date(current);
      if (view === 'week') next.setDate(next.getDate() + direction * 7);
      else next.setMonth(next.getMonth() + direction, 1);
      return next;
    });
  };

  const resetToday = () => setCursor(new Date());

  const platformLabel = (platform?: GeneratedScript['publicationPlatform']) =>
    publicationPlatformLabel(platform, locale);

  const weekEventPosition = (script: GeneratedScript) => {
    const date = new Date(script.scheduledAt!);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const startMinutes = 8 * 60;
    const endMinutes = 23 * 60;
    const clamped = Math.min(endMinutes, Math.max(startMinutes, minutes));
    return ((clamped - startMinutes) / (endMinutes - startMinutes)) * 100;
  };

  const connectCalendar = async () => {
    setGoogleBusy(true);
    setMoveError(null);
    try {
      const result = await connectGoogleCalendar();
      setGoogleConnected(Boolean(result?.accessToken));
    } catch (error: any) {
      setMoveError(error?.message || t('calendar.googleNotConnected'));
    } finally {
      setGoogleBusy(false);
    }
  };

  const moveScriptToDay = async (scriptId: string, targetDate: Date) => {
    const script = scripts.find(item => item.id === scriptId);
    if (!script?.scheduledAt) return;

    const original = new Date(script.scheduledAt);
    const next = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), original.getHours(), original.getMinutes(), 0, 0);
    if (sameDay(original, next)) {
      setDraggingId(null);
      setDragOverDay(null);
      return;
    }

    const originalScripts = scripts;
    const optimisticIso = next.toISOString();
    setScripts(items => items.map(item => item.id === script.id ? { ...item, scheduledAt: optimisticIso } : item));
    setDraggingId(null);
    setDragOverDay(null);
    setMoveError(null);

    try {
      const response = await authFetch('/api/radar/scripts/' + script.id + '/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt: optimisticIso,
          publicationPlatform: script.publicationPlatform,
          publicationTimeZone: script.publicationTimeZone,
          calendarProvider: script.calendarProvider,
          calendarId: script.calendarId,
          calendarEventId: script.calendarEventId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('calendar.moveFailed'));
      setScripts(items => items.map(item => item.id === script.id ? { ...item, ...(data.script || {}), scheduledAt: optimisticIso } : item));
    } catch (error: any) {
      setScripts(originalScripts);
      setMoveError(error?.message || t('calendar.moveFailed'));
    }
  };

  const dropProps = (date: Date) => ({
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setDragOverDay(dateKey(date));
    },
    onDragLeave: () => {
      if (dragOverDay === dateKey(date)) setDragOverDay(null);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const id = event.dataTransfer.getData('text/script-id') || draggingId;
      if (id) void moveScriptToDay(id, date);
    },
  });

  const eventDragProps = (script: GeneratedScript) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      setDraggingId(script.id);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/script-id', script.id);
    },
    onDragEnd: () => {
      setDraggingId(null);
      setDragOverDay(null);
    },
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 xl:p-7">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight text-stone-950">{t('calendar.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-500">{t('calendar.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          <button
            type="button"
            onClick={() => void connectCalendar()}
            disabled={googleBusy}
            title={googleConnected ? t('calendar.googleConnected') : t('calendar.connectGoogle')}
            className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition disabled:opacity-50 ${googleConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
          >
            {googleConnected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
            Google Calendar
          </button>
          <div className="inline-flex h-10 items-center rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600">
            {t('calendar.scheduled', { count: scheduled.length })}
          </div>
        </div>
      </header>

      {moveError && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{moveError}</div>
      )}

      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 overflow-hidden rounded-3xl border border-stone-200 bg-white xl:h-full">
          <div className="flex flex-col gap-3 border-b border-stone-100 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button type="button" onClick={() => movePeriod(-1)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-50" aria-label={t('calendar.previousMonth')}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={resetToday} className="h-10 rounded-xl border border-stone-200 bg-white px-4 text-xs font-semibold text-stone-700 transition hover:bg-stone-50">
                {t('calendar.today')}
              </button>
              <button type="button" onClick={() => movePeriod(1)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-50" aria-label={t('calendar.nextMonth')}>
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="ml-1 min-w-0 text-sm font-bold capitalize text-stone-900 sm:text-base">{periodLabel}</div>
            </div>

            <div className="grid shrink-0 grid-cols-2 rounded-xl bg-stone-100 p-1">
              <button type="button" onClick={() => setCalendarView('week')} className={`h-9 rounded-lg px-4 text-xs font-semibold transition ${view === 'week' ? 'bg-stone-950 text-white shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}>
                {t('calendar.week')}
              </button>
              <button type="button" onClick={() => setCalendarView('month')} className={`h-9 rounded-lg px-4 text-xs font-semibold transition ${view === 'month' ? 'bg-stone-950 text-white shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}>
                {t('calendar.month')}
              </button>
            </div>
          </div>

          {view === 'week' ? (
            <div>
              <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] border-b border-stone-100">
                <div />
                {weekDays.map(date => {
                  const isToday = sameDay(date, now);
                  return (
                    <div key={dateKey(date)} {...dropProps(date)} className={`border-l border-stone-100 px-1 py-3 text-center transition ${isToday ? 'bg-emerald-50/50' : ''} ${dragOverDay === dateKey(date) ? 'bg-emerald-100/70' : ''}`}>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-stone-400">{date.toLocaleDateString(dateLocale, { weekday: 'short' })}</div>
                      <div className={`mx-auto mt-1 flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold ${isToday ? 'bg-emerald-600 text-white' : 'text-stone-800'}`}>{date.getDate()}</div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] border-b border-stone-100 bg-stone-50/50">
                <div className="flex items-center justify-center px-1 py-2 text-[8px] font-semibold uppercase text-stone-400">{t('calendar.allDay')}</div>
                {weekDays.map(date => {
                  const items = (byDay.get(dateKey(date)) || []).filter(isNoTime);
                  return (
                    <div key={'all-' + dateKey(date)} {...dropProps(date)} className={`min-h-12 border-l border-stone-100 p-1 transition ${dragOverDay === dateKey(date) ? 'bg-emerald-100/70' : ''}`}>
                      {items.slice(0, 2).map(script => (
                        <button
                          key={script.id}
                          type="button"
                          {...eventDragProps(script)}
                          onClick={() => onOpenScript(script.id)}
                          className="mb-1 flex h-9 w-full items-center gap-1.5 overflow-hidden rounded-lg border border-emerald-200 bg-white px-1.5 text-left text-[9px] font-semibold text-stone-700"
                        >
                          <PlatformIcon platform={script.publicationPlatform} />
                          <span className="truncate">{script.ideaTitle || script.title}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))]">
                <div className="relative h-[390px] border-r border-stone-100">
                  {[9, 12, 15, 18, 21].map(hour => {
                    const top = ((hour * 60 - 8 * 60) / (15 * 60)) * 100;
                    return <div key={hour} className="absolute left-0 right-0 -translate-y-1/2 px-1 text-right text-[8px] font-medium text-stone-400" style={{ top: top + '%' }}>{String(hour).padStart(2, '0')}:00</div>;
                  })}
                </div>

                {weekDays.map(date => {
                  const items = (byDay.get(dateKey(date)) || []).filter(item => !isNoTime(item));
                  const isToday = sameDay(date, now);
                  return (
                    <div key={dateKey(date)} {...dropProps(date)} className={`relative h-[390px] border-r border-stone-100 last:border-r-0 transition ${isToday ? 'bg-emerald-50/35' : ''} ${dragOverDay === dateKey(date) ? 'bg-emerald-100/60' : ''}`}>
                      {[9, 12, 15, 18, 21].map(hour => {
                        const top = ((hour * 60 - 8 * 60) / (15 * 60)) * 100;
                        return <div key={hour} className="absolute left-0 right-0 border-t border-stone-100" style={{ top: top + '%' }} />;
                      })}

                      {items.slice(0, 3).map((script, index) => (
                        <button
                          key={script.id}
                          type="button"
                          {...eventDragProps(script)}
                          onClick={() => onOpenScript(script.id)}
                          className={`absolute left-1 right-1 z-10 h-[54px] overflow-hidden rounded-lg border border-emerald-200 bg-white p-1.5 text-left shadow-sm transition hover:border-emerald-400 ${draggingId === script.id ? 'opacity-50' : ''}`}
                          style={{ top: `calc(${weekEventPosition(script)}% - ${index * 2}px)` }}
                        >
                          <div className="flex items-center gap-1 text-[8px] font-bold text-stone-800">
                            <PlatformIcon platform={script.publicationPlatform} />
                            <span>{new Date(script.scheduledAt!).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="mt-1 line-clamp-2 text-[9px] font-bold leading-3 text-stone-900">{script.ideaTitle || script.title}</div>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 border-b border-stone-100 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                {t('calendar.days').split('|').map(day => <div key={day} className="px-1 py-2 text-center">{day}</div>)}
              </div>

              <div className="grid grid-cols-7">
                {monthCells.map((day, index) => {
                  if (!day) return <div key={'empty-' + index} className="min-h-24 border-r border-b border-stone-100 bg-stone-50/40" />;
                  const date = new Date(year, month, day);
                  const key = dateKey(date);
                  const items = byDay.get(key) || [];
                  const isToday = sameDay(date, now);
                  return (
                    <div key={key} {...dropProps(date)} className={`min-h-[118px] border-r border-b border-stone-100 p-2 transition ${isToday ? 'bg-emerald-50/30' : ''} ${dragOverDay === key ? 'bg-emerald-100/70' : ''}`}>
                      <div className="mb-2 flex h-6 items-center">
                        <div className={`text-xs font-bold ${isToday ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white' : 'text-stone-500'}`}>{day}</div>
                      </div>
                      <div className="grid auto-rows-[48px] gap-1.5">
                        {items.slice(0, 2).map(script => (
                          <button
                            key={script.id}
                            type="button"
                            {...eventDragProps(script)}
                            onClick={() => onOpenScript(script.id)}
                            className={`flex h-12 w-full min-w-0 flex-col justify-center overflow-hidden rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left transition hover:border-emerald-300 hover:shadow-sm ${draggingId === script.id ? 'opacity-50' : ''}`}
                          >
                            <div className="flex h-4 min-w-0 items-center gap-1.5 text-[9px] font-medium leading-none text-stone-500">
                              <PlatformIcon platform={script.publicationPlatform} className="h-3.5 w-3.5" />
                              {!isNoTime(script) && <span className="truncate">{new Date(script.scheduledAt!).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}</span>}
                            </div>
                            <div className="mt-1 w-full truncate text-[9px] font-bold leading-3 text-stone-800">{script.ideaTitle || script.title}</div>
                          </button>
                        ))}
                        {items.length > 2 && <div className="flex h-4 items-center text-[8px] text-stone-400">{t('calendar.more', { count: items.length - 2 })}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <aside className="min-w-0 rounded-3xl border border-stone-200 bg-white p-4 xl:h-full">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-emerald-600" />
              <h3 className="font-bold text-stone-950">{t('calendar.upcoming')}</h3>
            </div>
            <p className="mt-1 text-[11px] text-stone-500">{t('calendar.upcomingHint')}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {upcoming.map(script => (
              <button key={script.id} type="button" onClick={() => onOpenScript(script.id)} className="w-full rounded-2xl border border-stone-200 p-3 text-left transition hover:border-emerald-300 hover:shadow-sm">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center"><PlatformIcon platform={script.publicationPlatform} className="h-9 w-9" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold text-stone-500">
                      {platformLabel(script.publicationPlatform)}
                    </div>
                    <div className="mt-1 text-[10px] text-stone-400">
                      {new Date(script.scheduledAt!).toLocaleString(dateLocale, { day: 'numeric', month: 'short', ...(isNoTime(script) ? {} : { hour: '2-digit', minute: '2-digit' }) })}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs font-bold leading-4 text-stone-900">{script.ideaTitle || script.title}</div>
                    <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700">{t('calendar.scheduledStatus')}</span>
                  </div>
                </div>

                {script.calendarEventId && (
                  <div className="mt-2 flex justify-end">
                    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-700"><ExternalLink className="h-3 w-3" /> Google</span>
                  </div>
                )}
              </button>
            ))}

            {!loading && upcoming.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-stone-200 px-4 py-8 text-center text-xs text-stone-400 sm:col-span-2 xl:col-span-1">{t('calendar.none')}</div>
            )}
          </div>

        </aside>
      </div>
    </div>
  );
};
