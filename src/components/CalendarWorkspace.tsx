import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, ExternalLink } from 'lucide-react';
import { GeneratedScript } from '../types';
import { authFetch } from '../services/authFetch';
import { useI18n } from '../i18n';

interface CalendarWorkspaceProps {
  onOpenScript: (scriptId: string) => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  telegram: 'Telegram',
  other: 'Other',
};

export const CalendarWorkspace: React.FC<CalendarWorkspaceProps> = ({ onOpenScript }) => {
  const { locale, t } = useI18n();
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  useEffect(() => {
    authFetch('/api/radar/scripts')
      .then(async r => r.ok ? await r.json() : [])
      .then((data) => setScripts(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const scheduled = useMemo(
    () => scripts
      .filter(s => Boolean(s.scheduledAt) && !s.archivedAt)
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()),
    [scripts]
  );

  const byDay = useMemo(() => {
    const map = new Map<string, GeneratedScript[]>();
    for (const script of scheduled) {
      const date = new Date(script.scheduledAt!);
      const key = [date.getFullYear(), date.getMonth(), date.getDate()].join('-');
      const list = map.get(key) || [];
      list.push(script);
      map.set(key, list);
    }
    return map;
  }, [scheduled]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const cells: Array<number | null> = [
    ...Array.from({ length: mondayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const upcoming = scheduled.filter(s => !s.isPublished && new Date(s.scheduledAt!).getTime() >= Date.now()).slice(0, 8);
  const monthLabel = cursor.toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="p-5 sm:p-7 max-w-[1500px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">{t('calendar.plan')}</div>
          <h2 className="text-3xl font-bold tracking-tight mt-1">{t('calendar.title')}</h2>
          <p className="text-sm text-stone-500 mt-1">{t('calendar.subtitle')}</p>
        </div>
        <div className="text-xs text-stone-500">{t('calendar.scheduled', { count: scheduled.length })}</div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <section className="rounded-3xl border border-stone-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
            <button
              onClick={() => setCursor(new Date(year, month - 1, 1))}
              className="p-2 rounded-xl hover:bg-stone-100"
              aria-label={t('calendar.previousMonth')}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="font-bold capitalize">{monthLabel}</div>
            <button
              onClick={() => setCursor(new Date(year, month + 1, 1))}
              className="p-2 rounded-xl hover:bg-stone-100"
              aria-label={t('calendar.nextMonth')}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-stone-100 text-[10px] font-bold uppercase tracking-wide text-stone-400">
            {t('calendar.days').split('|').map(day => (
              <div key={day} className="px-2 py-2 text-center">{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((day, index) => {
              if (!day) return <div key={'empty-' + index} className="min-h-28 border-r border-b border-stone-100 bg-stone-50/40" />;
              const key = [year, month, day].join('-');
              const items = byDay.get(key) || [];
              const today = new Date();
              const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
              return (
                <div key={key} className="min-h-28 border-r border-b border-stone-100 p-2">
                  <div className={`text-xs font-bold mb-2 ${isToday ? 'inline-flex w-6 h-6 items-center justify-center rounded-full bg-stone-900 text-white' : 'text-stone-500'}`}>
                    {day}
                  </div>
                  <div className="space-y-1">
                    {items.slice(0, 3).map(script => (
                      <button
                        key={script.id}
                        onClick={() => onOpenScript(script.id)}
                        className="w-full text-left rounded-lg bg-indigo-50 border border-indigo-100 px-2 py-1.5 hover:border-indigo-300 transition"
                      >
                        <div className="text-[10px] font-bold text-indigo-800 truncate">{script.ideaTitle || script.title}</div>
                        <div className="text-[9px] text-indigo-500 mt-0.5">
                          {new Date(script.scheduledAt!).toLocaleTimeString(locale === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                          {script.publicationPlatform ? ' · ' + (PLATFORM_LABELS[script.publicationPlatform] || script.publicationPlatform) : ''}
                        </div>
                      </button>
                    ))}
                    {items.length > 3 && <div className="text-[9px] text-stone-400">{t('calendar.more', { count: items.length - 3 })}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="rounded-3xl border border-stone-200 bg-white p-5 h-fit">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold">{t('calendar.upcoming')}</h3>
          </div>
          <div className="space-y-3">
            {upcoming.map(script => (
              <button
                key={script.id}
                onClick={() => onOpenScript(script.id)}
                className="w-full text-left rounded-2xl border border-stone-200 p-3 hover:border-stone-300 hover:shadow-sm transition"
              >
                <div className="text-xs font-semibold line-clamp-2">{script.ideaTitle || script.title}</div>
                <div className="flex items-center gap-1.5 text-[10px] text-stone-500 mt-2">
                  <Clock3 className="w-3 h-3" />
                  {new Date(script.scheduledAt!).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] font-semibold text-indigo-700">
                    {PLATFORM_LABELS[script.publicationPlatform || ''] || t('calendar.publication')}
                  </span>
                  {script.calendarEventId && <span className="inline-flex items-center gap-1 text-[9px] text-emerald-700"><ExternalLink className="w-3 h-3" /> Google</span>}
                </div>
              </button>
            ))}
            {!loading && upcoming.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-stone-200 px-4 py-8 text-center text-xs text-stone-400">
                {t('calendar.none')}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
