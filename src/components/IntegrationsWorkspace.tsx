import React, { useEffect, useState } from 'react';
import { CalendarDays, FileText, Send, Settings2, Loader2 } from 'lucide-react';
import { authFetch } from '../services/authFetch';
import { getOrCreateContentRadarCalendar } from '../services/googleCalendarService';
import { connectYouTubePublishing, getConnectedYouTubeChannel, type YouTubeChannelIdentity } from '../services/youtubePublishingService';
import { PlatformIcon } from './PlatformIcon';
import { useI18n } from '../i18n';
import { useIntegrationState } from '../hooks/useIntegrationState';

interface IntegrationsWorkspaceProps {
  onOpenSettings: () => void;
}

export const IntegrationsWorkspace: React.FC<IntegrationsWorkspaceProps> = ({ onOpenSettings }) => {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const [telegram, setTelegram] = useState<any>(null);
  const { connected: calendarConnected, refresh: refreshCalendarConnection } = useIntegrationState('calendar');
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [youtubeChannel, setYoutubeChannel] = useState<YouTubeChannelIdentity | null>(null);
  const { connected: youtubeConnected, refresh: refreshYoutubeConnection, revision: youtubeRevision } = useIntegrationState('youtube');
  const [youtubeBusy, setYoutubeBusy] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/telegram/status')
      .then(async r => r.ok ? await r.json() : null)
      .then(setTelegram)
      .catch(() => setTelegram(null));
  }, []);

  useEffect(() => {
    let active = true;
    if (!youtubeConnected) {
      setYoutubeChannel(null);
      return () => { active = false; };
    }
    void getConnectedYouTubeChannel()
      .then(channel => { if (active) setYoutubeChannel(channel); })
      .catch(() => { if (active) setYoutubeChannel(null); });
    return () => { active = false; };
  }, [youtubeConnected, youtubeRevision]);

  const connectYoutube = async () => {
    setYoutubeBusy(true);
    setYoutubeError(null);
    try {
      const channel = await connectYouTubePublishing();
      if (!channel) throw new Error(tr('Канал YouTube не найден', 'YouTube channel not found'));
      setYoutubeChannel(channel);
      await refreshYoutubeConnection();
    } catch (e: any) {
      setYoutubeError(e?.message || tr('Не удалось подключить YouTube', 'Could not connect YouTube'));
    } finally {
      setYoutubeBusy(false);
    }
  };

  const connectCalendar = async () => {
    setCalendarBusy(true);
    setCalendarError(null);
    try {
      await getOrCreateContentRadarCalendar();
      await refreshCalendarConnection();
    } catch (e: any) {
      setCalendarError(e?.message || 'Не удалось подключить Google Calendar');
    } finally {
      setCalendarBusy(false);
    }
  };

  return (
    <div className="w-full">
      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="flex min-h-[230px] h-full flex-col rounded-3xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-50"><PlatformIcon platform="youtube" className="h-5 w-5" /></div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${youtubeConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
              {youtubeConnected ? 'CONNECTED' : 'NOT CONNECTED'}
            </span>
          </div>
          <h3 className="mt-4 font-bold">YouTube</h3>
          <p className="mt-1 text-xs text-stone-500">{tr('Прямая загрузка видео и отложенная публикация через YouTube Data API.', 'Direct video upload and scheduled publishing through the YouTube Data API.')}</p>
          {youtubeChannel && <div className="mt-3 text-[11px] font-semibold text-emerald-700">{youtubeChannel.title}</div>}
          <button onClick={() => void connectYoutube()} disabled={youtubeBusy} className="mt-auto inline-flex w-fit items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold disabled:opacity-50">
            {youtubeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlatformIcon platform="youtube" className="h-4 w-4" />} {youtubeConnected ? tr('Переподключить', 'Reconnect') : tr('Подключить', 'Connect')}
          </button>
          {youtubeError && <div className="mt-2 line-clamp-2 text-[10px] text-rose-600">{youtubeError}</div>}
        </div>

        {(['instagram', 'tiktok'] as const).map(platform => (
          <div key={platform} className="flex min-h-[230px] h-full flex-col rounded-3xl border border-stone-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-50"><PlatformIcon platform={platform} className="h-5 w-5" /></div>
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">API SETUP</span>
            </div>
            <h3 className="mt-4 font-bold">{platform === 'instagram' ? 'Instagram' : 'TikTok'}</h3>
            <p className="mt-1 text-xs text-stone-500">{platform === 'instagram'
              ? tr('Direct publishing для Professional account. Подключается к общему Publish flow.', 'Direct publishing for Professional accounts. Plugs into the shared Publish flow.')
              : tr('Content Posting API: Direct Post / Upload. Подключается к общему Publish flow.', 'Content Posting API: Direct Post / Upload. Plugs into the shared Publish flow.')}</p>
            <div className="mt-auto rounded-xl bg-stone-50 px-3 py-2 text-[10px] leading-4 text-stone-500">
              {tr('UX и PublicationJob готовы; OAuth/provider adapter подключается следующим проверяемым шагом.', 'UX and PublicationJob are ready; OAuth/provider adapter is the next verified step.')}
            </div>
          </div>
        ))}


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
