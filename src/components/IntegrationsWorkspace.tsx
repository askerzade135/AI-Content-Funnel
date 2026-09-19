import React, { useEffect, useState } from 'react';
import { FileText, Send, Settings2 } from 'lucide-react';
import { authFetch } from '../services/authFetch';

interface IntegrationsWorkspaceProps {
  onOpenSettings: () => void;
}

export const IntegrationsWorkspace: React.FC<IntegrationsWorkspaceProps> = ({ onOpenSettings }) => {
  const [telegram, setTelegram] = useState<any>(null);

  useEffect(() => {
    authFetch('/api/telegram/status')
      .then(async r => r.ok ? await r.json() : null)
      .then(setTelegram)
      .catch(() => setTelegram(null));
  }, []);

  return (
    <div className="p-5 sm:p-7 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-700">Destinations</div>
        <h2 className="text-3xl font-bold mt-1">Integrations</h2>
        <p className="text-sm text-stone-500 mt-1">Куда экспортировать готовые сценарии и контент.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-3xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-2xl bg-sky-50 flex items-center justify-center"><Send className="w-5 h-5 text-sky-600"/></div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${telegram?.isConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
              {telegram?.isConfigured ? 'CONNECTED' : 'NOT CONFIGURED'}
            </span>
          </div>
          <h3 className="font-bold mt-4">Telegram</h3>
          <p className="text-xs text-stone-500 mt-1">Отправка approved scripts напрямую в Telegram.</p>
          <button onClick={onOpenSettings} className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-stone-200 text-xs font-semibold">
            <Settings2 className="w-4 h-4"/> Configure
          </button>
        </div>

        <div className="rounded-3xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center"><FileText className="w-5 h-5 text-blue-600"/></div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">READY</span>
          </div>
          <h3 className="font-bold mt-4">Google Docs</h3>
          <p className="text-xs text-stone-500 mt-1">Экспорт approved scripts в нативный Google Doc через Google Drive.</p>
          <div className="mt-4 text-[11px] text-stone-400">Доступно в Scripts → Google Docs.</div>
        </div>
      </div>
    </div>
  );
};
