import React, { useEffect, useState } from 'react';
import { Activity, ArrowRight, Brain, CalendarDays, CheckCircle2, FileText, Globe2, Instagram, Lightbulb, Music2, Plug, Radio, Send, Settings2, Sparkles, Sprout, Target, Waypoints, Youtube } from 'lucide-react';
import { AppSettings, GeneratedScript, ProductSection, RadarDiscoveryState, RadarOpportunity, RadarTodayState, StoredVideo, TrackedChannel } from '../types';
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
  userName?: string | null;
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
  userName,
}) => {
  const [today, setToday] = useState<RadarTodayState | null>(null);
  const [todayScripts, setTodayScripts] = useState<GeneratedScript[]>([]);
  const [todayDiscovery, setTodayDiscovery] = useState<RadarDiscoveryState | null>(null);
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
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const [todayRes, scriptsRes, discoveryRes] = await Promise.all([
        authFetch('/api/radar/today?timeZone=' + encodeURIComponent(timeZone)),
        authFetch('/api/radar/scripts'),
        authFetch('/api/radar/discovery'),
      ]);
      if (!todayRes.ok) throw new Error('Не удалось загрузить Today');
      setToday(await todayRes.json());
      if (scriptsRes.ok) setTodayScripts(await scriptsRes.json());
      if (discoveryRes.ok) setTodayDiscovery(await discoveryRes.json());
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

  const upcomingScripts = todayScripts
    .filter(script => script.scheduledAt && !script.archivedAt && !script.isPublished)
    .sort((a, b) => new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime())
    .slice(0, 3);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const displayGreeting = userName?.trim() ? `${greeting}, ${userName.trim()}` : greeting;

  const focusItems = (today?.attention || []).slice(0, 2);
  const recommended = (today?.topOpportunities || []).slice(0, 3);
  const tasteSignals = todayDiscovery?.feedbackCount || 0;
  const tasteGoal = Math.max(todayDiscovery?.minimumSignals || 5, 20);
  const tasteProgress = Math.min(100, Math.round((tasteSignals / tasteGoal) * 100));

  const renderPlatformIcon = (platform?: GeneratedScript['publicationPlatform']) => {
    const iconClass = 'h-3.5 w-3.5';
    if (platform === 'instagram') return <Instagram className={iconClass} />;
    if (platform === 'youtube') return <Youtube className={iconClass} />;
    if (platform === 'telegram') return <Send className={iconClass} />;
    if (platform === 'tiktok') return <Music2 className={iconClass} />;
    return <Globe2 className={iconClass} />;
  };

  const platformLabel = (platform?: GeneratedScript['publicationPlatform']) => {
    if (!platform) return 'Publication';
    if (platform === 'instagram') return 'Instagram';
    if (platform === 'youtube') return 'YouTube';
    if (platform === 'telegram') return 'Telegram';
    if (platform === 'tiktok') return 'TikTok';
    return 'Other';
  };

  const opportunityById = new Map<string, RadarOpportunity>(
    (today?.topOpportunities || []).map(opportunity => [opportunity.id, opportunity] as [string, RadarOpportunity])
  );
  const scriptById = new Map<string, GeneratedScript>(
    todayScripts.map(script => [script.id, script] as [string, GeneratedScript])
  );
  const resolveFocusOpportunity = (item: RadarTodayState['attention'][number]) => {
    if (item.type === 'opportunity') return opportunityById.get(item.opportunityId || item.id);
    const script = scriptById.get(item.id);
    return script?.radarOpportunityId ? opportunityById.get(script.radarOpportunityId) : undefined;
  };

  return (
    <div className="w-full p-4 sm:p-5 xl:p-6">
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {error} <button onClick={load} className="font-semibold underline">Повторить</button>
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="flex min-w-0 items-center gap-2 text-3xl font-bold tracking-tight text-stone-950 sm:text-[36px]">
            <span className="truncate">{displayGreeting}</span>
            <span className="shrink-0 text-[30px] leading-none" aria-hidden="true">👋</span>
          </h2>
          <p className="mt-1.5 text-sm text-stone-500">Вот что Radar подготовил для тебя сегодня.</p>
        </div>

        <div className="self-start rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-xs text-stone-500 lg:self-auto">
          <div className="font-semibold leading-5 text-stone-800">
            {new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
          </div>
          <div className="mt-0.5 text-[11px] text-stone-400">
            {today?.generatedAt ? 'Обновлено ' + new Date(today.generatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Radar синхронизируется'}
          </div>
        </div>
      </div>

      <div className="mb-5 grid gap-0 overflow-hidden rounded-3xl border border-stone-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: <Lightbulb className="h-[18px] w-[18px] text-amber-600" />, value: today?.summary.newOpportunities24h ?? 0, label: 'новых идей', iconBg: 'bg-amber-50' },
          { icon: <FileText className="h-[18px] w-[18px] text-rose-600" />, value: today?.summary.scriptsNeedReview ?? 0, label: 'ждут review', iconBg: 'bg-rose-50' },
          { icon: <CalendarDays className="h-[18px] w-[18px] text-blue-600" />, value: today?.summary.scriptsScheduledToday ?? 0, label: 'публикаций сегодня', iconBg: 'bg-blue-50' },
          { icon: <Activity className="h-[18px] w-[18px] text-sky-600" />, value: today?.summary.newDiscoveryCandidates ?? 0, label: 'новых сигналов', iconBg: 'bg-sky-50' },
        ].map((item, index) => (
          <div key={item.label} className={`grid min-h-[88px] grid-cols-[42px_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:px-5 ${index > 0 ? 'border-t border-stone-100 sm:border-t-0 sm:border-l' : ''} ${index === 2 ? 'sm:border-l-0 xl:border-l' : ''}`}>
            <span className={`flex h-10 w-10 items-center justify-center self-center rounded-2xl ${item.iconBg}`}>{item.icon}</span>
            <div className="min-w-0">
              <div className="flex h-6 items-center text-[22px] font-bold leading-none text-stone-950">{item.value}</div>
              <div className="mt-1.5 truncate text-[11px] font-semibold text-stone-700">{item.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,.96fr)] lg:auto-rows-max">
        <div className="contents">
          <section className="order-1 min-w-0 self-start rounded-3xl border border-stone-200 bg-white p-5 lg:col-start-1 lg:row-start-1">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50">
                    <Target className="h-4 w-4 text-rose-500" />
                  </span>
                  <h3 className="text-lg font-bold text-stone-950">Today's focus</h3>
                </div>
                <p className="mt-1.5 text-xs text-stone-500">
                  {focusItems.length ? `${focusItems.length} действия реально продвинут контент вперёд` : 'На сегодня обязательных действий нет'}
                </p>
              </div>
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-500">{focusItems.length}</span>
            </div>

            <div className="space-y-3">
              {focusItems.map((item, index) => {
                const linkedOpportunity = resolveFocusOpportunity(item);
                const thumbnail = linkedOpportunity?.sourceThumbnail;
                const tags = [
                  linkedOpportunity?.topic,
                  linkedOpportunity?.sourceType === 'youtube' ? 'YouTube' : undefined,
                ].filter(Boolean) as string[];

                return (
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
                    className="group w-full rounded-2xl border border-stone-200 bg-white p-3.5 text-left transition hover:border-emerald-300 hover:shadow-sm"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-xs font-bold text-stone-600">{index + 1}</span>

                      {thumbnail ? (
                        <img src={thumbnail} alt="" className="h-20 w-24 shrink-0 rounded-xl bg-stone-100 object-cover sm:h-24 sm:w-28" />
                      ) : (
                        <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-xl bg-stone-50 sm:h-24 sm:w-28">
                          {item.type === 'opportunity' ? <Lightbulb className="h-5 w-5 text-amber-500" /> : <FileText className="h-5 w-5 text-rose-500" />}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{item.subtitle}</div>
                        <div className="mt-1 line-clamp-2 text-sm font-bold leading-5 text-stone-900">{item.title}</div>

                        {tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {tags.map(tag => <span key={tag} className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-medium text-stone-500">{tag}</span>)}
                          </div>
                        )}

                        <div className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white">
                          {item.type === 'opportunity' ? 'Open idea' : 'Review script'} <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}

              {!loading && !error && !focusItems.length && (
                <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/60 p-7 text-center">
                  <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
                  <div className="mt-3 text-sm font-bold text-stone-900">На сегодня всё разобрано</div>
                  <p className="mt-1 text-xs text-stone-500">Можно перейти к новым идеям или продолжить обучать Radar.</p>
                  <button onClick={() => onNavigate('ideas')} className="mt-4 h-9 rounded-xl bg-stone-950 px-3 text-xs font-semibold text-white">Explore ideas</button>
                </div>
              )}
            </div>
          </section>

          <section className="order-3 min-w-0 self-stretch rounded-3xl border border-stone-200 bg-white p-5 lg:col-start-1 lg:row-start-2 lg:h-full">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50">
                    <CalendarDays className="h-4 w-4 text-violet-600" />
                  </span>
                  <h3 className="text-lg font-bold text-stone-950">Upcoming</h3>
                </div>
                <p className="mt-1.5 text-xs text-stone-500">Ближайшие публикации из твоего контент-плана.</p>
              </div>
              <button onClick={() => onNavigate('calendar')} className="shrink-0 text-[11px] font-semibold text-emerald-700">View calendar →</button>
            </div>

            <div className="space-y-2">
              {upcomingScripts.map(script => (
                <button
                  key={script.id}
                  onClick={() => { setTargetScriptId(script.id); onNavigate('scripts'); }}
                  className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-stone-200 px-3.5 py-3 text-left transition hover:border-stone-300 hover:bg-stone-50/60"
                >
                  <div className="w-16 shrink-0 text-[10px] font-semibold text-stone-500">
                    <div>{new Date(script.scheduledAt || '').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div>
                    <div className="mt-0.5 text-stone-900">{new Date(script.scheduledAt || '').toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-stone-900">{script.ideaTitle || script.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-stone-400">
                      <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-1 text-stone-600">
                        {renderPlatformIcon(script.publicationPlatform)}
                        {platformLabel(script.publicationPlatform)}
                      </span>
                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Scheduled</span>
                    </div>
                  </div>

                </button>
              ))}

              {!upcomingScripts.length && (
                <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-6 text-center">
                  <div className="text-xs font-semibold text-stone-700">Пока ничего не запланировано</div>
                  <button onClick={() => onNavigate('calendar')} className="mt-2 text-[11px] font-semibold text-emerald-700">Open calendar →</button>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="contents">
          <section className="order-2 min-w-0 self-start rounded-3xl border border-stone-200 bg-white p-5 lg:col-start-2 lg:row-start-1">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50">
                    <Sparkles className="h-4 w-4 text-emerald-600" />
                  </span>
                  <h3 className="text-lg font-bold text-stone-950">Recommended next</h3>
                </div>
                <p className="mt-1.5 text-xs text-stone-500">Идеи, которые лучше всего совпадают с твоим профилем.</p>
              </div>
              <button onClick={() => onNavigate('ideas')} className="shrink-0 text-[11px] font-semibold text-emerald-700">See all ideas →</button>
            </div>

            <div className="space-y-3">
              {recommended.map(op => {
                const tags = [
                  op.topic,
                  op.sourceChannel,
                  op.sourceType === 'youtube' ? 'YouTube' : undefined,
                ].filter(Boolean).filter((tag, index, all) => all.indexOf(tag) === index).slice(0, 3) as string[];

                return (
                  <button
                    key={op.id}
                    onClick={() => { setTargetOpportunityId(op.id); setTargetScriptId(null); onNavigate('ideas'); }}
                    className="flex w-full min-w-0 gap-3 rounded-2xl border border-stone-200 p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50/20"
                  >
                    {op.sourceThumbnail ? (
                      <img src={op.sourceThumbnail} alt="" className="h-20 w-24 shrink-0 rounded-xl bg-stone-100 object-cover lg:h-[84px] lg:w-[104px]" />
                    ) : (
                      <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-xl bg-stone-100 lg:h-[84px] lg:w-[104px]">
                        <Lightbulb className="h-5 w-5 text-stone-400" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-lime-100 px-2 py-1 text-[10px] font-bold text-lime-800">{op.relevance}% match</span>
                        {op.topic && <span className="truncate text-[10px] font-medium text-stone-400">{op.topic}</span>}
                      </div>

                      <div className="mt-1.5 line-clamp-2 text-sm font-bold leading-5 text-stone-900">{op.title}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-stone-500">
                        <b className="font-semibold text-stone-600">Почему Radar выбрал это:</b> {op.whyInteresting}
                      </div>

                      {tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {tags.map(tag => (
                            <span key={tag} className="max-w-[160px] truncate rounded-full bg-stone-100 px-2 py-1 text-[10px] font-medium text-stone-500">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}

              {!loading && !recommended.length && (
                <div className="rounded-2xl border border-dashed border-stone-200 p-6 text-center text-xs text-stone-400">
                  Пока нет новых рекомендаций. Обнови Radar или добавь новые интересы.
                </div>
              )}
            </div>
          </section>

          <section className="order-4 min-w-0 self-stretch rounded-3xl border border-stone-200 bg-white p-5 lg:col-start-2 lg:row-start-2 lg:h-full">
            <div className="grid h-full min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50">
                    <Brain className="h-4 w-4 text-emerald-600" />
                  </span>
                  <h3 className="text-lg font-bold text-stone-950">Improve your Radar</h3>
                </div>

                <div className="mt-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-bold text-stone-900">{tasteSignals} signals learned</div>
                    <div className="text-[11px] text-stone-400">{tasteProgress}%</div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: tasteProgress + '%' }} />
                  </div>
                </div>

                <button onClick={() => onNavigate('discover')} className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white">
                  Train Radar <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="hidden h-full min-h-[180px] flex-col items-center justify-center text-center sm:flex">
                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-emerald-50">
                  <Sprout className="h-14 w-14 text-emerald-600" />
                </div>
                <p className="mt-4 max-w-[150px] text-xs font-medium leading-5 text-stone-500">
                  The more you interact, the better the ideas.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

    </div>
  );
};
