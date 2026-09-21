import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Brain, Plug, Radio, Settings2, Sparkles, Waypoints } from 'lucide-react';
import { AppSettings, ProductSection, RadarTodayState, StoredVideo, TrackedChannel } from '../types';
import { authFetch } from '../services/authFetch';
import { ContentRadar } from './ContentRadar';
import { RadarScriptsWorkspace } from './RadarScriptsWorkspace';
import { CalendarWorkspace } from './CalendarWorkspace';
import { SourcesWorkspace } from './SourcesWorkspace';
import { IntegrationsWorkspace } from './IntegrationsWorkspace';
import { SettingsModal } from './SettingsModal';

interface RadarWorkspaceProps {
  section: Exclude<ProductSection, 'library'>;
  videos: StoredVideo[];
  channels: TrackedChannel[];
  onNavigate: (section: ProductSection) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenAddSource: () => void;
  settings: AppSettings | null;
  onSaveSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  onSyncNow: () => void;
  isSyncing: boolean;
  onOpenPromptsModal: () => void;
  onOnboardingCompleted?: () => void;
}

export const RadarWorkspace: React.FC<RadarWorkspaceProps> = ({
  section,
  videos,
  channels,
  onNavigate,
  onRefresh,
  onOpenSettings,
  onOpenAddSource,
  settings,
  onSaveSettings,
  onSyncNow,
  isSyncing,
  onOpenPromptsModal,
  onOnboardingCompleted,
}) => {
  const [today, setToday] = useState<RadarTodayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [targetScriptId, setTargetScriptId] = useState<string | null>(null);
  const [targetOpportunityId, setTargetOpportunityId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'personalization' | 'sources' | 'integrations' | 'ai'>('personalization');
  const [isAdmin, setIsAdmin] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const todayRes = await authFetch('/api/radar/today?timeZone=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
      if (!todayRes.ok) throw new Error('Не удалось загрузить Today');
      setToday(await todayRes.json());
    } catch (error: any) {
      setError(error.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [section]);
  useEffect(() => {
    let cancelled = false;
    void authFetch('/api/admin/discovery-runs?limit=1')
      .then(response => { if (!cancelled) setIsAdmin(response.ok); })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (section === 'sources') setSettingsTab('sources');
    if (section === 'integrations') setSettingsTab('integrations');
  }, [section]);

  if (section === 'discover' || section === 'ideas') {
    return (
      <div className="px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
        <ContentRadar
          isOpen={true}
          embedded={true}
          initialView={section}
          onClose={() => undefined}
          videos={videos}
          channels={channels}
          onRefresh={onRefresh}
          onOpenAddSource={onOpenAddSource}
          onOnboardingCompleted={onOnboardingCompleted}
          initialOpportunityId={section === 'ideas' ? targetOpportunityId || undefined : undefined}
          onOpenScript={(scriptId) => {
            setTargetScriptId(scriptId);
            setTargetOpportunityId(null);
            onNavigate('scripts');
          }}
        />
      </div>
    );
  }

  if (section === 'scripts') {
    return <RadarScriptsWorkspace initialSelectedId={targetScriptId || undefined} onGoIdeas={() => onNavigate('ideas')} />;
  }

  if (section === 'calendar') {
    return (
      <CalendarWorkspace
        onOpenScript={(scriptId) => {
          setTargetScriptId(scriptId);
          onNavigate('scripts');
        }}
      />
    );
  }

  if (section === 'settings' || section === 'sources' || section === 'integrations') {
    const tabs = [
      { id: 'personalization' as const, label: 'Personalization', icon: <Brain className="w-4 h-4" /> },
      { id: 'sources' as const, label: 'Sources', icon: <Waypoints className="w-4 h-4" /> },
      ...(isAdmin ? [{ id: 'integrations' as const, label: 'Integrations', icon: <Plug className="w-4 h-4" /> }] : []),
      { id: 'ai' as const, label: 'AI & Usage', icon: <Settings2 className="w-4 h-4" /> },
    ];
    return (
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
        <div className="mb-5">
          <h2 className="text-2xl font-bold tracking-tight text-stone-950">Settings</h2>
          <p className="mt-1 text-sm text-stone-500">Personalize Radar, manage content sources and connect services.</p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSettingsTab(tab.id)}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${
                settingsTab === tab.id
                  ? 'border-stone-950 bg-stone-950 text-white'
                  : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {settingsTab === 'personalization' && (
          <div className="rounded-3xl border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-5 py-4 sm:px-6">
              <div className="font-semibold text-stone-900">Tune Radar</div>
              <div className="mt-1 text-xs text-stone-500">Change topics, goals, formats, angles, exclusions and reference content without resetting your feedback history.</div>
            </div>
            <div className="px-2 pb-2">
              <ContentRadar
                isOpen={true}
                embedded={true}
                initialView="setup"
                onClose={() => undefined}
                videos={videos}
                channels={channels}
                onRefresh={onRefresh}
                onOpenAddSource={onOpenAddSource}
                onOnboardingCompleted={onOnboardingCompleted}
              />
            </div>
          </div>
        )}
        {settingsTab === 'sources' && <SourcesWorkspace />}
        {settingsTab === 'integrations' && isAdmin && <IntegrationsWorkspace onOpenSettings={onOpenSettings} />}
        {settingsTab === 'ai' && (
          <SettingsModal
            isOpen={true}
            embedded={true}
            onClose={() => undefined}
            settings={settings}
            onSaveSettings={onSaveSettings}
            onSyncNow={onSyncNow}
            isSyncing={isSyncing}
            onOpenPromptsModal={onOpenPromptsModal}
            videos={videos}
          />
        )}
      </div>
    );
  }

  return (
    <div className="p-5 sm:p-7 max-w-7xl mx-auto">
      {error && <div role="alert" className="mb-4 text-rose-600">{error} <button onClick={load} className="underline">Повторить</button></div>}
      <div className="mb-7">
        <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 uppercase tracking-[0.18em]"><Radio className="w-3.5 h-3.5"/> Live Radar</div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">Что требует твоего решения сегодня</h2>
        <p className="text-sm text-stone-500 mt-2">Radar ищет и сортирует сам. Здесь остаются только решения, где нужен человек.</p>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-7">
        {[
          ['Новых сигналов', today?.summary.newDiscoveryCandidates ?? 0, 'bg-lime-100'],
          ['Новых идей', today?.summary.newOpportunities24h ?? 0, 'bg-emerald-100'],
          ['Ждут review', today?.summary.scriptsNeedReview ?? 0, 'bg-amber-100'],
          ['Готовы к экспорту', today?.summary.scriptsReadyToExport ?? 0, 'bg-violet-100'],
          ['Публикаций сегодня', today?.summary.scriptsScheduledToday ?? 0, 'bg-indigo-100'],
        ].map(([label, value, bg]) => (
          <div key={String(label)} className={`rounded-2xl border border-stone-200 p-4 ${bg}`}>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs font-semibold text-stone-600 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {today && (today.summary.scriptsExported > 0 || (today.summary.scriptsScheduledToday ?? 0) > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-stone-500">
          {today.summary.scriptsExported > 0 && <span>Экспортировано и ждёт планирования/публикации: <b className="text-stone-800">{today.summary.scriptsExported}</b></span>}
          {(today.summary.scriptsScheduledToday ?? 0) > 0 && (
            <button onClick={() => onNavigate('calendar')} className="font-semibold text-indigo-700">
              Открыть публикации на сегодня →
            </button>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-5">
        <section>
          <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-lg">Needs your attention</h3><span className="text-xs text-stone-400">{today?.attention.length || 0}</span></div>
          <div className="space-y-3">
            {(today?.attention || []).map(item => (
              <button
                key={item.type + item.id}
                onClick={() => {
                  if (item.type === 'opportunity') {
                    setTargetOpportunityId(item.opportunityId || item.id);
                    setTargetScriptId(null);
                    onNavigate('ideas');
                  } else {
                    setTargetScriptId(item.id);
                    setTargetOpportunityId(item.opportunityId || null);
                    onNavigate('scripts');
                  }
                }}
                className="w-full text-left bg-white border border-stone-200 rounded-2xl p-4 hover:border-stone-300 hover:shadow-sm transition"
              >
                <div className="text-[10px] uppercase tracking-wide font-bold text-stone-400">{item.subtitle}</div>
                <div className="flex items-center justify-between gap-3 mt-1"><span className="font-semibold">{item.title}</span><ArrowRight className="w-4 h-4 text-stone-400"/></div>
              </button>
            ))}
            {!loading && !error && !today?.attention.length && <div className="border-2 border-dashed rounded-2xl p-8 text-center text-sm text-stone-400">На сегодня всё разобрано.</div>}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-lg">Top opportunities</h3><button onClick={() => onNavigate('ideas')} className="text-xs font-semibold text-emerald-700">Все идеи →</button></div>
          <div className="space-y-3">
            {(today?.topOpportunities || []).slice(0,4).map(op => (
              <button
                key={op.id}
                onClick={() => { setTargetOpportunityId(op.id); setTargetScriptId(null); onNavigate('ideas'); }}
                className="w-full text-left bg-stone-900 text-white rounded-2xl p-4"
              >
                <div className="flex items-center gap-2"><span className="px-2 py-0.5 rounded-full bg-lime-300 text-stone-900 text-[10px] font-bold">{op.relevance}%</span>{op.topic && <span className="text-[10px] text-stone-400">{op.topic}</span>}</div>
                <div className="font-bold mt-2">{op.title}</div>
                <div className="text-xs text-stone-400 mt-2 line-clamp-2">{op.whyInteresting}</div>
              </button>
            ))}
          </div>
        </section>
      </div>

      <button onClick={() => onNavigate('discover')} className="mt-7 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-semibold"><Sparkles className="w-4 h-4"/> Обучить Radar дальше</button>
    </div>
  );
};
