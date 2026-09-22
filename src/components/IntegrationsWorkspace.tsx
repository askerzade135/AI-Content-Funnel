import React, { useEffect, useState } from 'react';
import { CalendarDays, FileText, Send, Settings2 } from 'lucide-react';
import { authFetch } from '../services/authFetch';
import { getOrCreateContentRadarCalendar } from '../services/googleCalendarService';

interface IntegrationsWorkspaceProps {
  onOpenSettings: () => void;
}

export const IntegrationsWorkspace: React.FC<IntegrationsWorkspaceProps> = ({ onOpenSettings }) => {
  const [telegram, setTelegram] = useState<any>(null);
  const [calendarConnected, setCalendarConnected] = useState(() => {
    try { return sessionStorage.getItem('content_radar_calendar_connected') === 'true'; } catch { return false; }
  });
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/telegram/status')
      .then(async r => r.ok ? await r.json() : null)
      .then(setTelegram)
      .catch(() => setTelegram(null));
  }, []);

  const connectCalendar = async () => {
    setCalendarBusy(true);
    setCalendarError(null);
    try {
      await getOrCreateContentRadarCalendar();
      setCalendarConnected(true);
      try { sessionStorage.setItem('content_radar_calendar_connected', 'true'); } catch {}
    } catch (e: any) {
      setCalendarError(e?.message || 'Не удалось подключить Google Calendar');
    } finally {
      setCalendarBusy(false);
    }
  };

  return (
    <div className="w-full">
      <div className="grid items-stretch gap-4 md:grid-cols-2">
        <div className="flex min-h-[230px] h-full flex-col rounded-3xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-2xl bg-sky-50 flex items-center justify-center"><Send className="w-5 h-5 text-sky-600"/></div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${telegram?.isConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
              {telegram?.isConfigured ? 'CONNECTED' : 'NOT CONFIGURED'}
            </span>
          </div>
          <h3 className="font-bold mt-4">Telegram</h3>
          <p className="text-xs text-stone-500 mt-1">Отправка approved scripts напрямую в Telegram.</p>
          <button onClick={onOpenSettings} className="mt-auto inline-flex w-fit items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold">
            <Settings2 className="w-4 h-4"/> Configure
          </button>
        </div>

        <div className="flex min-h-[230px] h-full flex-col rounded-3xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center"><FileText className="w-5 h-5 text-blue-600"/></div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">READY</span>
          </div>
          <h3 className="font-bold mt-4">Google Docs</h3>
          <p className="text-xs text-stone-500 mt-1">Экспорт approved scripts в нативный Google Doc через Google Drive.</p>
          <div className="mt-auto text-[11px] text-stone-400">Доступно в Scripts → Google Docs.</div>
        </div>

        <div className="flex min-h-[230px] h-full flex-col rounded-3xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center"><CalendarDays className="w-5 h-5 text-indigo-600"/></div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${calendarConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
              {calendarConnected ? 'CONNECTED' : 'OPTIONAL'}
            </span>
          </div>
          <h3 className="font-bold mt-4">Google Calendar</h3>
          <p className="text-xs text-stone-500 mt-1">Синхронизация запланированных публикаций в отдельный календарь Content Radar.</p>
          <button
            onClick={connectCalendar}
            disabled={calendarBusy}
            className="mt-auto inline-flex w-fit items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold disabled:opacity-50"
          >
            <CalendarDays className="w-4 h-4"/> {calendarConnected ? 'Reconnect' : calendarBusy ? 'Connecting…' : 'Connect'}
          </button>
          {calendarError && <div className="mt-2 text-[10px] text-rose-600 line-clamp-2">{calendarError}</div>}
        </div>
      </div>
    </div>
  );
};
