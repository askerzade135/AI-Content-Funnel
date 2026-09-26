import React, { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, WifiOff } from 'lucide-react';
import { useI18n } from '../i18n';

export const NETWORK_RETRY_EVENT = 'radar:network-retry';

export const NetworkStatusBanner: React.FC = () => {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    let recoveryTimer: number | undefined;
    const onOffline = () => {
      if (recoveryTimer) window.clearTimeout(recoveryTimer);
      setRecovered(false);
      setOnline(false);
    };
    const onOnline = () => {
      setOnline(true);
      setRecovered(true);
      window.dispatchEvent(new Event(NETWORK_RETRY_EVENT));
      if (recoveryTimer) window.clearTimeout(recoveryTimer);
      recoveryTimer = window.setTimeout(() => setRecovered(false), 3000);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      if (recoveryTimer) window.clearTimeout(recoveryTimer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (online && !recovered) return null;

  const tone = online ? 'border-emerald-200 bg-emerald-50/95 text-emerald-900' : 'border-amber-200 bg-amber-50/95 text-amber-950';
  const iconTone = online ? 'bg-emerald-100' : 'bg-amber-100';
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[250] flex justify-center px-3 pt-3">
      <div className={'pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-md ' + tone}>
        <div className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ' + iconTone}>
          {online ? <CheckCircle2 className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{online ? tr('Соединение восстановлено', 'Connection restored') : tr('Нет подключения к интернету', 'No internet connection')}</div>
          {!online && <div className="mt-0.5 text-xs opacity-75">{tr('Данные останутся на экране. Онлайн-действия временно недоступны.', 'Your current data stays visible. Online actions are temporarily unavailable.')}</div>}
        </div>
        {!online && (
          <button type="button" onClick={() => window.dispatchEvent(new Event(NETWORK_RETRY_EVENT))} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-amber-300 bg-white/80 px-3 text-xs font-semibold">
            <RefreshCw className="h-3.5 w-3.5" /> {tr('Повторить', 'Retry')}
          </button>
        )}
      </div>
    </div>
  );
};
