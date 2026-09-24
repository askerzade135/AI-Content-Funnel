import React, { useEffect, useState } from 'react';
import { Activity, ArrowRight, Brain, CalendarDays, CheckCircle2, FileText, Languages, Lightbulb, Moon, Plug, Radio, Settings2, ShieldCheck, Sparkles, Sprout, Sun, Sunset, Target, Waypoints } from 'lucide-react';
import { AppSettings, GeneratedScript, ProductSection, RadarDiscoveryState, RadarOpportunity, RadarTodayState, StoredVideo, TrackedChannel } from '../types';
import { authFetch } from '../services/authFetch';
import { ContentRadar } from './ContentRadar';
import { RadarScriptsWorkspace } from './RadarScriptsWorkspace';
import { CalendarWorkspace } from './CalendarWorkspace';
import { SourcesWorkspace } from './SourcesWorkspace';
import { IntegrationsWorkspace } from './IntegrationsWorkspace';
import { SettingsModal } from './SettingsModal';
import { AdminWorkspace } from './AdminWorkspace';
import { useI18n } from '../i18n';
import { PlatformIcon, publicationPlatformLabel } from './PlatformIcon';

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
  const { locale, setLocale, t } = useI18n();
  const [today, setToday] = useState<RadarTodayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [targetScriptId, setTargetScriptId] = useState<string | null>(null);
  const [targetOpportunityId, setTargetOpportunityId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'general' | 'sources' | 'connections' | 'admin'>('general');
  const [currentRole, setCurrentRole] = useState<'owner' | 'admin' | 'member'>('member');
  const isAdmin = currentRole === 'owner' || currentRole === 'admin';

  const load = async (silent = false) => {
    if (section !== 'today') return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const todayRes = await authFetch('/api/radar/today?timeZone=' + encodeURIComponent(timeZone));
      if (!todayRes.ok) throw new Error(locale === 'ru' ? 'Не удалось загрузить обзор' : 'Could not load overview');
      setToday(await todayRes.json());
    } catch (error: any) {
      setError(error.message || (locale === 'ru' ? 'Ошибка загрузки' : 'Loading error'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (section !== 'today') return;
    void load();
  }, [section]);

  useEffect(() => {
    if (section !== 'today') return;
    const intervalMs = Math.max(30, today?.refreshPolicy?.autoRefreshSeconds || 60) * 1000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [section, today?.refreshPolicy?.autoRefreshSeconds]);
  useEffect(() => {
    let cancelled = false;
    void authFetch('/api/auth/me')
      .then(async response => {
        if (!response.ok) throw new Error('profile');
        const payload = await response.json();
        const role = payload?.role || payload?.account?.role || payload?.user?.role || 'member';
        if (!cancelled) setCurrentRole(role === 'owner' || role === 'admin' ? role : 'member');
      })
      .catch(() => { if (!cancelled) setCurrentRole('member'); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (section === 'sources') setSettingsTab('sources');
    if (section === 'integrations') setSettingsTab('connections');
    if (section === 'settings' && settingsTab === 'admin' && !isAdmin) setSettingsTab('general');
  }, [section, isAdmin]);

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
          onOpenMyRadar={() => onNavigate('radar')}
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

  if (section === 'radar') {
    return (
      <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
        <div className="mb-4">
          <h2 className="text-2xl font-bold tracking-tight text-stone-950">{t('nav.myRadar')}</h2>
          <p className="mt-1 text-sm text-stone-500">
            {locale === 'ru'
              ? 'Настрой темы, цели, форматы и предпочтения — Radar будет учитывать их в рекомендациях.'
              : 'Set topics, goals, formats and preferences — Radar will use them in recommendations.'}
          </p>
        </div>
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
          hideSetupHeader={true}
          onOpenDiscover={() => onNavigate('discover')}
        />
      </div>
    );
  }

  if (section === 'scripts') {
    return (
      <RadarScriptsWorkspace
        initialSelectedId={targetScriptId || undefined}
        onGoIdeas={() => onNavigate('ideas')}
        onOpenCalendar={() => onNavigate('calendar')}
      />
    );
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
      { id: 'general' as const, label: t('settings.general'), icon: <Languages className="w-4 h-4" /> },
      { id: 'sources' as const, label: t('settings.sources'), icon: <Waypoints className="w-4 h-4" /> },
      { id: 'connections' as const, label: t('settings.connections'), icon: <Plug className="w-4 h-4" /> },
      ...(isAdmin ? [{ id: 'admin' as const, label: t('settings.admin'), icon: <ShieldCheck className="w-4 h-4" /> }] : []),
    ];

    return (
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
        <div className="mb-5">
          <h2 className="text-2xl font-bold tracking-tight text-stone-950">{t('settings.title')}</h2>
          <p className="mt-1 text-sm text-stone-500">
            {locale === 'ru'
              ? 'Управляй языком, источниками и подключёнными сервисами.'
              : 'Manage language, sources and connected services.'}
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
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
              {tab.id === 'admin' && (
                <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase ${settingsTab === 'admin' ? 'bg-white/15 text-white' : 'bg-emerald-50 text-emerald-700'}`}>
                  Admin
                </span>
              )}
            </button>
          ))}
        </div>

        {settingsTab === 'general' && (
          <section className="max-w-xl rounded-3xl border border-stone-200 bg-white p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Languages className="h-4 w-4 text-emerald-600" />
              <h3 className="font-bold text-stone-950">{t('settings.language')}</h3>
            </div>
            <p className="mt-1 text-xs text-stone-500">{t('settings.languageHint')}</p>
            <div className="mt-4 grid max-w-sm grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
              {(['ru', 'en'] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLocale(value)}
                  className={`h-9 rounded-lg text-xs font-semibold transition ${locale === value ? 'bg-white text-stone-950 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                >
                  {value === 'ru' ? t('settings.russian') : t('settings.english')}
                </button>
              ))}
            </div>
          </section>
        )}

        {settingsTab === 'sources' && <SourcesWorkspace />}

        {settingsTab === 'connections' && <IntegrationsWorkspace onOpenSettings={onOpenSettings} />}

        {settingsTab === 'admin' && isAdmin && (
          <AdminWorkspace onOpenPromptsModal={onOpenPromptsModal} currentRole={currentRole} />
        )}
      </div>
    );
  }

  const upcomingScripts = today?.upcomingScripts || [];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('today.morning') : hour < 18 ? t('today.afternoon') : t('today.evening');
  const displayGreeting = userName?.trim() ? `${greeting}, ${userName.trim()}` : greeting;

  const timeOfDay =
    hour >= 5 && hour < 17
      ? {
          icon: <Sun className="h-5 w-5 text-amber-500" />,
          label: locale === 'ru' ? 'День' : 'Day',
          bg: 'bg-amber-50',
        }
      : hour >= 17 && hour < 22
        ? {
            icon: <Sunset className="h-5 w-5 text-orange-500" />,
            label: locale === 'ru' ? 'Вечер' : 'Evening',
            bg: 'bg-orange-50',
          }
        : {
            icon: <Moon className="h-5 w-5 text-indigo-500" />,
            label: locale === 'ru' ? 'Ночь' : 'Night',
            bg: 'bg-indigo-50',
          };

  const focusItems = today?.attention || [];
  const recommended = today?.topOpportunities || [];
  const tasteSignals = today?.learning.preferenceSignals || 0;

  const platformLabel = (platform?: GeneratedScript['publicationPlatform']) =>
    publicationPlatformLabel(platform, locale);



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
          <p className="mt-1.5 text-sm text-stone-500">{t('today.subtitle')}</p>
        </div>

        <div className="flex self-start items-center gap-3 rounded-2xl border border-stone-200 bg-white px-3.5 py-2.5 text-xs text-stone-500 lg:self-auto">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${timeOfDay.bg}`} title={timeOfDay.label} aria-label={timeOfDay.label}>
            {timeOfDay.icon}
          </span>
          <div className="min-w-0">
            <div className="whitespace-nowrap font-semibold leading-5 text-stone-800">
              {new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
            </div>
            <div className="mt-0.5 whitespace-nowrap text-[11px] text-stone-400">
              {today?.generatedAt ? t('today.updated') + ' ' + new Date(today.generatedAt).toLocaleTimeString(locale === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : t('today.syncing')}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-5 grid gap-0 overflow-hidden rounded-3xl border border-stone-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            icon: <Lightbulb className="h-5 w-5 text-amber-600" />,
            value: today?.summary.newOpportunities24h ?? 0,
            label: t('today.newIdeas'),
            iconBg: 'bg-amber-50',
          },
          {
            icon: <FileText className="h-5 w-5 text-rose-600" />,
            value: today?.summary.scriptsNeedReview ?? 0,
            label: t('today.needsReview'),
            iconBg: 'bg-rose-50',
          },
          {
            icon: <CalendarDays className="h-5 w-5 text-blue-600" />,
            value: today?.summary.scriptsScheduledToday ?? 0,
            label: t('today.publicationsToday'),
            iconBg: 'bg-blue-50',
          },
          {
            icon: <Sparkles className="h-5 w-5 text-emerald-600" />,
            value: today?.summary.readyIdeas ?? 0,
            label: locale === 'ru' ? 'идей готовы к созданию' : 'ideas ready to create',
            iconBg: 'bg-emerald-50',
          },
        ].map((item, index) => (
          <div
            key={item.label}
            className={`min-h-[92px] px-4 py-4 sm:px-5 ${index > 0 ? 'border-t border-stone-100 sm:border-t-0 sm:border-l' : ''} ${index === 2 ? 'sm:border-l-0 xl:border-l' : ''}`}
          >
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${item.iconBg}`}>
                {item.icon}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className="text-[27px] font-bold leading-[1] tracking-tight text-stone-950">{item.value}</div>
                <div className="mt-1.5 truncate text-[11px] font-semibold text-stone-700">{item.label}</div>
              </div>
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
                  <h3 className="text-lg font-bold text-stone-950">{t('today.focus')}</h3>
                </div>
                <p className="mt-1.5 text-xs text-stone-500">
                  {focusItems.length ? t('today.focusCount', { count: focusItems.length }) : t('today.noActions')}
                </p>
              </div>
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-500">{focusItems.length}</span>
            </div>

            <div className="space-y-3">
              {focusItems.map((item, index) => {
                const thumbnail = item.thumbnail;
                const tags = [item.topic].filter(Boolean) as string[];

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
                          {item.type === 'opportunity' ? t('today.openIdea') : t('today.reviewScript')} <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}

              {!loading && !error && !focusItems.length && (
                <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/60 p-7 text-center">
                  <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
                  <div className="mt-3 text-sm font-bold text-stone-900">{t('today.caughtUp')}</div>
                  <p className="mt-1 text-xs text-stone-500">{t('today.caughtUpHint')}</p>
                  <button onClick={() => onNavigate('ideas')} className="mt-4 h-9 rounded-xl bg-stone-950 px-3 text-xs font-semibold text-white">{t('today.exploreIdeas')}</button>
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
                  <h3 className="text-lg font-bold text-stone-950">{t('today.upcoming')}</h3>
                </div>
                <p className="mt-1.5 text-xs text-stone-500">{t('today.upcomingHint')}</p>
              </div>
              <button onClick={() => onNavigate('calendar')} className="shrink-0 text-[11px] font-semibold text-emerald-700">
                {(today?.upcomingTotal || 0) > (today?.limits.upcoming || 3)
                  ? (locale === 'ru' ? `Все ${today?.upcomingTotal}` : `View all ${today?.upcomingTotal}`)
                  : t('today.viewCalendar')} →
              </button>
            </div>

            <div className="space-y-2">
              {upcomingScripts.map(script => (
                <button
                  key={script.id}
                  onClick={() => { setTargetScriptId(script.id); onNavigate('scripts'); }}
                  className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-stone-200 px-3.5 py-3 text-left transition hover:border-stone-300 hover:bg-stone-50/60"
                >
                  <div className="w-16 shrink-0 text-[10px] font-semibold text-stone-500">
                    <div>{new Date(script.scheduledAt || '').toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' })}</div>
                    <div className="mt-0.5 text-stone-900">{new Date(script.scheduledAt || '').toLocaleTimeString(locale === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-stone-900">{script.ideaTitle || script.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-stone-400">
                      <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-1 text-stone-600">
                        <PlatformIcon platform={script.publicationPlatform} />
                        {platformLabel(script.publicationPlatform)}
                      </span>
                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{t('today.scheduled')}</span>
                    </div>
                  </div>

                </button>
              ))}

              {!upcomingScripts.length && (
                <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-6 text-center">
                  <div className="text-xs font-semibold text-stone-700">{t('today.noUpcoming')}</div>
                  <button onClick={() => onNavigate('calendar')} className="mt-2 text-[11px] font-semibold text-emerald-700">{t('today.openCalendar')} →</button>
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
                  <h3 className="text-lg font-bold text-stone-950">{t('today.recommended')}</h3>
                </div>
                <p className="mt-1.5 text-xs text-stone-500">{t('today.recommendedHint')}</p>
              </div>
              <button onClick={() => onNavigate('ideas')} className="shrink-0 text-[11px] font-semibold text-emerald-700">{t('today.seeAllIdeas')} →</button>
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
                        <b className="font-semibold text-stone-600">{t('today.whyPicked')}</b> {op.whyInteresting}
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
                  {t('today.noRecommendations')}
                </div>
              )}
            </div>
          </section>

          <section className="order-4 min-w-0 self-stretch rounded-3xl border border-stone-200 bg-white p-5 lg:col-start-2 lg:row-start-2 lg:h-full">
            <div className="grid h-full min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50">
                    <Brain className="h-4 w-4 text-emerald-600" />
                  </span>
                  <h3 className="text-lg font-bold text-stone-950">{t('today.improve')}</h3>
                </div>

                <div className="mt-5 rounded-2xl bg-stone-50 p-4">
                  <div className="text-sm font-bold text-stone-900">{t('today.signalsLearned', { count: tasteSignals })}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                      Interested {today?.learning.interested || 0}
                    </span>
                    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">
                      Not interested {today?.learning.notInterested || 0}
                    </span>
                    <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-500">
                      Skip {today?.learning.skipped || 0}
                    </span>
                  </div>
                  <p className="mt-3 text-[11px] leading-5 text-stone-500">
                    {locale === 'ru'
                      ? 'Interested и Not interested обучают персонализацию. Skip остаётся нейтральным.'
                      : 'Interested and Not interested train personalization. Skip stays neutral.'}
                  </p>
                </div>

                <button onClick={() => onNavigate('discover')} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white">
                  {t('today.trainRadar')} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="hidden h-full min-h-[180px] flex-col items-center justify-center self-center text-center sm:flex">
                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-emerald-50">
                  <Sprout className="h-14 w-14 text-emerald-600" />
                </div>
                <p className="mt-4 max-w-[150px] text-xs font-medium leading-5 text-stone-500">
                  {t('today.moreInteract')}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

    </div>
  );
};
