import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Radio, Sparkles, X, ScanSearch, ExternalLink, Loader2, Bookmark, EyeOff, ThumbsUp, SkipForward, ArrowRight } from 'lucide-react';
import { GeneratedScript, RadarDiscoveryRefreshDiagnostics, RadarDiscoveryState, RadarOpportunity, RadarProfile, RadarSkipReason, StoredVideo, TrackedChannel } from '../types';
import { authFetch } from '../services/authFetch';

interface ContentRadarProps {
  isOpen: boolean;
  onClose: () => void;
  videos: StoredVideo[];
  channels: TrackedChannel[];
  onRefresh: () => void;
  embedded?: boolean;
  initialView?: 'setup' | 'discover' | 'ideas';
  initialOpportunityId?: string;
  onOpenScript?: (scriptId: string) => void;
}

const TOPICS = ["Психология","Воспитание","Отношения","Общество","Ценности","Религия и традиции","История","Культура","Бизнес","Технологии"];
const ANGLES = ["Спорные темы","Неожиданные факты","Разрушение мифов","Исследования","Сильные истории","Культурные конфликты","Противоположные точки зрения"];

export const ContentRadar: React.FC<ContentRadarProps> = ({ isOpen, onClose, embedded = false, initialView, initialOpportunityId, onOpenScript }) => {
  const [profile, setProfile] = useState<RadarProfile | null>(null);
  const [discovery, setDiscovery] = useState<RadarDiscoveryState | null>(null);
  const [discoveryDiagnostics, setDiscoveryDiagnostics] = useState<RadarDiscoveryRefreshDiagnostics | null>(null);
  const [opportunities, setOpportunities] = useState<RadarOpportunity[]>([]);
  const [view, setView] = useState<'setup' | 'discover' | 'ideas'>('setup');
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [skipReasonOpen, setSkipReasonOpen] = useState(false);
  const [generatingScriptId, setGeneratingScriptId] = useState<string | null>(null);
  const [generatedScriptByOpportunity, setGeneratedScriptByOpportunity] = useState<Record<string, string>>({});

  const loadRadar = async () => {
    setIsLoading(true);
    try {
      const [p, d, o, s] = await Promise.all([
        authFetch('/api/radar/profile'),
        authFetch('/api/radar/discovery'),
        authFetch('/api/radar/opportunities'),
        authFetch('/api/radar/scripts'),
      ]);
      if (![p, d, o, s].every(response => response.ok)) throw new Error('Не удалось загрузить Radar. Повторите попытку.');
      const profileData = await p.json();
      if (profileData) {
        setProfile(profileData);
        setView(!profileData.topics?.length ? 'setup' : !profileData.onboardingCompletedAt ? 'discover' : initialView || 'ideas');
      }
      if (d.ok) setDiscovery(await d.json());
      if (o.ok) setOpportunities(await o.json());
      if (s.ok) {
        const scripts = await s.json() as GeneratedScript[];
        const byOpportunity: Record<string, string> = {};
        for (const script of scripts) {
          if (script.radarOpportunityId && !byOpportunity[script.radarOpportunityId]) {
            byOpportunity[script.radarOpportunityId] = script.id;
          }
        }
        setGeneratedScriptByOpportunity(byOpportunity);
      }
    } catch (error: any) {
      setError(error.message || 'Ошибка загрузки Radar');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (isOpen) void loadRadar(); }, [isOpen]);
  useEffect(() => {
    if (isOpen && initialView && profile?.onboardingCompletedAt) setView(initialView);
  }, [isOpen, initialView]);

  const saveProfile = async (next: RadarProfile) => {
    setProfile(next);
    const res = await authFetch('/api/radar/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error('Не удалось сохранить интересы');
    setProfile(await res.json());
  };

  const toggle = (field: 'topics' | 'preferredAngles', value: string) => {
    if (!profile) return;
    const current = profile[field] || [];
    const next = current.includes(value) ? current.filter(x => x !== value) : [...current, value];
    setProfile({ ...profile, [field]: next });
  };

  const updateAvoid = (value: string) => {
    if (!profile) return;
    const avoid = value
      .split(/[,\n]/)
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 50);
    setProfile({ ...profile, avoid });
  };

  const startDiscovery = async () => {
    if (!profile || !(profile.topics || []).length) return;
    setIsDiscovering(true);
    setError(null);
    try {
      await saveProfile(profile);
      setView('discover');
      const res = await authFetch('/api/radar/discovery/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perQuery: 5 }),
      });
      const data = await res.json();
      if (res.ok && data?.discovery) {
        setDiscovery(data.discovery);
        setDiscoveryDiagnostics(data as RadarDiscoveryRefreshDiagnostics);
      } else if (!res.ok) setError(data?.error || 'Не удалось найти новые видео');
    } catch (error: any) {
      setError(error.message || 'Ошибка поиска');
    } finally {
      setIsDiscovering(false);
    }
  };

  const feedback = async (decision: 'interesting' | 'skip', reason?: RadarSkipReason) => {
    const item = discovery?.candidates[0];
    if (!item || feedbackBusy) return;
    setFeedbackBusy(true);
    setError(null);
    try {
    const res = await authFetch('/api/radar/discovery-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceContentId: item.id, decision, reason }),
    });
    if (!res.ok) throw new Error('Не удалось сохранить решение');
    if (res.ok) {
      const data = await res.json();
      if (data?.expansion?.expanded && data?.expansion?.discovery) {
        setDiscovery(data.expansion.discovery);
      } else {
        const d = await authFetch('/api/radar/discovery');
        if (d.ok) setDiscovery(await d.json());
      }
      setSkipReasonOpen(false);
    }
    } catch (error: any) {
      setError(error.message || 'Ошибка сохранения решения');
    } finally { setFeedbackBusy(false); }
  };

  const completeLearning = async () => {
    const res = await authFetch('/api/radar/onboarding/complete', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { setError(data?.error || 'Нужно больше сигналов'); return; }
    setProfile(data);
    setView('ideas');
    if (opportunities.length === 0) await scan(true);
  };

  const scan = async (selectedOnly = false) => {
    setIsScanning(true); setError(null);
    try {
      const res = await authFetch('/api/radar/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 12, selectedOnly }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Radar scan failed');
      const o = await authFetch('/api/radar/opportunities');
      if (o.ok) setOpportunities(await o.json());
    } catch (e: any) { setError(e?.message || 'Ошибка Radar'); }
    finally { setIsScanning(false); }
  };

  const setStatus = async (id: string, status: RadarOpportunity['status']) => {
    const res = await authFetch(`/api/radar/opportunities/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = await res.json();
      setOpportunities(prev => prev.map(x => x.id === id ? updated : x));
    }
  };

  const generateScript = async (opportunityId: string) => {
    setGeneratingScriptId(opportunityId); setError(null);
    try {
      const res = await authFetch(`/api/radar/opportunities/${opportunityId}/script`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Не удалось создать сценарий');
      setOpportunities(prev => prev.map(x => x.id === opportunityId ? data.opportunity : x));
      if (data.script?.id) {
        setGeneratedScriptByOpportunity(prev => ({ ...prev, [opportunityId]: data.script.id }));
      }
    } catch (e: any) {
      setError(e?.message || 'Ошибка генерации сценария');
    } finally {
      setGeneratingScriptId(null);
    }
  };

  const visible = useMemo(() => {
    const items = opportunities.filter(x => x.status !== 'dismissed');
    if (!initialOpportunityId) return items;
    return [...items].sort((a, b) => {
      if (a.id === initialOpportunityId) return -1;
      if (b.id === initialOpportunityId) return 1;
      return 0;
    });
  }, [opportunities, initialOpportunityId]);
  if (!isOpen) return null;

  const step = view === 'setup' ? 1 : view === 'discover' ? 2 : 3;

  return <div className={embedded ? "w-full" : "fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"}>
    <div className={embedded ? "w-full bg-white border border-stone-200 rounded-3xl overflow-hidden" : "w-full max-w-6xl max-h-[92vh] overflow-hidden bg-white rounded-3xl shadow-2xl border border-stone-200 flex flex-col"}>
      <div className="px-5 sm:px-7 py-5 border-b border-stone-200 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2"><Radio className="w-5 h-5 text-emerald-600"/><h2 className="font-bold">Content Radar</h2></div>
          <div className="text-xs text-stone-500 mt-1">Шаг {step}/3 · Настройка → обучение → идеи</div>
        </div>
        {!embedded && <button onClick={onClose} className="p-2 rounded-xl hover:bg-stone-100"><X className="w-5 h-5"/></button>}
      </div>

      <div className="overflow-y-auto p-5 sm:p-7">
        {error && <div role="alert" className="mb-4 text-sm text-rose-600">{error}{!profile && <button onClick={loadRadar} className="ml-3 underline">Повторить</button>}</div>}
        {view === 'discover' && discoveryDiagnostics && (
          <div className="mb-4 space-y-2">
            {!discoveryDiagnostics.youtubeApiConfigured && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div><b>YouTube Data API не настроен.</b> Radar использует менее надёжный web fallback.</div>
              </div>
            )}
            {discoveryDiagnostics.queryGeneration.source === 'fallback' && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <b>AI не сгенерировал поисковые запросы.</b> Используются fallback-запросы.
                  {discoveryDiagnostics.queryGeneration.error && <div className="mt-1 text-[10px] opacity-70 break-words">{discoveryDiagnostics.queryGeneration.error}</div>}
                </div>
              </div>
            )}
            {discoveryDiagnostics.search.some(item => item.sourceType === 'youtube' && item.provider === 'youtube_web_fallback') && discoveryDiagnostics.youtubeApiConfigured && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div><b>YouTube API дал ошибку.</b> Один или несколько запросов были выполнены через web fallback.</div>
              </div>
            )}
            <details className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-600">
              <summary className="cursor-pointer font-semibold">
                Диагностика поиска · {discoveryDiagnostics.plan.youtube.length + discoveryDiagnostics.plan.web.length + discoveryDiagnostics.plan.x.length} запросов · {discoveryDiagnostics.search.reduce((sum, item) => sum + item.found, 0)} найдено · {discoveryDiagnostics.added} добавлено
              </summary>
              <div className="mt-2 space-y-1.5">
                <div>
                  Queries: <b>{discoveryDiagnostics.queryGeneration.source}</b>
                  {discoveryDiagnostics.queryGeneration.provider ? ' · ' + discoveryDiagnostics.queryGeneration.provider : ''}
                  {discoveryDiagnostics.queryGeneration.model ? ' · ' + discoveryDiagnostics.queryGeneration.model : ''}
                </div>
                {discoveryDiagnostics.search.map(item => (
                  <div key={item.query} className="flex flex-wrap gap-x-2">
                    <span className="font-medium text-stone-800">{item.query}</span>
                    <span>{item.sourceType}</span>
                    <span>{item.provider}</span>
                    <span>found {item.found}</span>
                    <span>added {item.added}</span>
                  </div>
                ))}
                <div>
                  Ranking: <b>{discoveryDiagnostics.ranking.source}</b> · {discoveryDiagnostics.ranking.ranked}/{discoveryDiagnostics.ranking.candidates}
                  {discoveryDiagnostics.ranking.provider ? ' · ' + discoveryDiagnostics.ranking.provider : ''}
                </div>
              </div>
            </details>
          </div>
        )}
        {isLoading || (!profile && !error) ? <div className="min-h-[420px] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin"/></div> : null}

        {!isLoading && profile && view === 'setup' && <div className="max-w-5xl mx-auto lg:min-h-[calc(100vh-13rem)] lg:flex lg:flex-col">
          <div className="mb-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-1">Настройка вкуса</div>
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-2">
              <div>
                <h3 className="text-xl lg:text-2xl font-bold text-stone-900">Что Radar должен находить для тебя?</h3>
                <p className="text-xs lg:text-sm text-stone-500 mt-1">Выбери темы и коротко опиши вкус — этого достаточно для старта.</p>
              </div>
              <div className="text-[11px] text-stone-400">Потом можно изменить в Settings</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-4 lg:gap-5 flex-1">
            <div className="space-y-4">
              <section className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2.5">
                  <h4 className="font-bold text-sm">Темы</h4>
                  <span className="text-[11px] text-stone-400">Выбери несколько</span>
                </div>
                <div className="flex flex-wrap gap-1.5">{TOPICS.map(x => <button key={x} onClick={() => toggle('topics', x)} className={`px-2.5 py-1.5 rounded-lg text-xs border transition ${profile.topics?.includes(x) ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-200 hover:border-stone-300'}`}>{x}</button>)}</div>
              </section>

              <section className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2.5">
                  <h4 className="font-bold text-sm">Углы и форматы</h4>
                  <span className="text-[11px] text-stone-400">Влияет на ranking</span>
                </div>
                <div className="flex flex-wrap gap-1.5">{ANGLES.map(x => <button key={x} onClick={() => toggle('preferredAngles', x)} className={`px-2.5 py-1.5 rounded-lg text-xs border transition ${profile.preferredAngles?.includes(x) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-stone-200 hover:border-stone-300'}`}>{x}</button>)}</div>
              </section>
            </div>

            <div className="grid gap-4">
              <label className="block rounded-2xl border border-stone-200 bg-stone-50/50 p-4">
                <span className="block text-sm font-bold text-stone-900">Что хочется находить</span>
                <span className="block text-[11px] text-stone-500 mt-1">Например: исследования, исторические параллели, сильные человеческие истории, спорные тезисы.</span>
                <textarea
                  value={profile.description || ''}
                  onChange={(e) => setProfile({ ...profile, description: e.target.value })}
                  rows={3}
                  maxLength={4000}
                  className="mt-2.5 w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                  placeholder="Какой контент действительно тебя цепляет?"
                />
              </label>

              <label className="block rounded-2xl border border-stone-200 bg-stone-50/50 p-4">
                <span className="block text-sm font-bold text-stone-900">Что не показывать?</span>
                <span className="block text-[11px] text-stone-500 mt-1">Необязательно. Через запятую или с новой строки.</span>
                <textarea
                  value={(profile.avoid || []).join('\n')}
                  onChange={(e) => updateAvoid(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="mt-2.5 w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                  placeholder={"Кликбейт\nПоверхностные советы"}
                />
              </label>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end border-t border-stone-100 pt-4">
            <button disabled={isDiscovering || !profile.topics?.length} onClick={startDiscovery} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold disabled:opacity-40">Начать обучение <ArrowRight className="w-4 h-4"/></button>
          </div>
        </div>}

        {!isLoading && profile && view === 'discover' && <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-1.5">Taste training</div>
              <h3 className="text-2xl font-bold text-stone-900">Научи Radar своему вкусу</h3>
              <p className="text-sm text-stone-500 mt-1">Radar показывает разные источники по одному. Твои решения улучшают следующие поиски и рекомендации.</p>
            </div>
            <div className="shrink-0 text-sm font-bold text-stone-700">{discovery?.feedbackCount || 0} / {discovery?.minimumSignals || 5} сигналов</div>
          </div>

          <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden mb-6"><div className="h-full bg-emerald-500 transition-all" style={{width: `${Math.min(100, ((discovery?.feedbackCount || 0)/(discovery?.minimumSignals || 5))*100)}%`}}/></div>

          {isDiscovering ? <div className="min-h-[360px] rounded-3xl border border-stone-200 bg-white flex flex-col items-center justify-center">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-600"/>
            <div className="mt-3 text-sm font-semibold">Ищу подходящие источники…</div>
            <div className="mt-1 text-xs text-stone-500">Radar строит план поиска и собирает кандидатов</div>
          </div> : discovery?.candidates?.[0] ? (() => {
            const item = discovery.candidates[0];
            const preview = item.imageUrl || item.thumbnail;
            const sourceName = item.sourceLabel || (item.sourceType === 'youtube' ? 'YouTube' : item.sourceType === 'x' ? 'X' : item.sourceType === 'web' ? 'Web' : 'Источник');
            const author = item.author || item.channelTitle;
            return <article className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
              <div className="grid lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
                <div className="bg-stone-100">
                  {preview ? (
                    <div className="aspect-video lg:h-full lg:min-h-[330px] overflow-hidden">
                      <img src={preview} alt="" className="w-full h-full object-cover"/>
                    </div>
                  ) : (
                    <div className="aspect-video lg:h-full lg:min-h-[330px] flex items-center justify-center text-stone-400">
                      <div className="text-center">
                        <Radio className="w-7 h-7 mx-auto mb-2"/>
                        <div className="text-xs">{sourceName}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-5 sm:p-6 lg:p-7 flex flex-col min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <span className="inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-2 py-1 font-medium text-stone-700">{sourceName}</span>
                    {author && <span className="truncate">{author}</span>}
                    {typeof item.rankingScore === 'number' && <span className="ml-auto px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold">{item.rankingScore}% match</span>}
                  </div>

                  <h4 className="text-xl font-bold leading-snug mt-3 text-stone-900">{item.title}</h4>

                  {(item.summary || item.description) && <div className="mt-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">О чём источник</div>
                    <p className="text-sm leading-6 text-stone-600 line-clamp-4">{item.summary || item.description}</p>
                  </div>}

                  <div className="mt-5 rounded-2xl bg-emerald-50/70 border border-emerald-100 p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 mb-1.5">Почему это подходит тебе</div>
                    <p className="text-sm leading-6 text-emerald-950">{item.rankingReason || 'Radar выбрал этот источник на основе твоих тем, предпочитаемых углов и предыдущих решений.'}</p>
                  </div>

                  <div className="mt-auto pt-6">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <button onClick={() => setSkipReasonOpen(v => !v)} className="inline-flex justify-center items-center gap-2 px-4 py-3 rounded-2xl border border-stone-300 bg-white font-semibold text-stone-700 hover:bg-stone-50"><SkipForward className="w-4 h-4"/> Skip</button>
                      <button disabled={feedbackBusy} onClick={() => feedback('interesting')} className="inline-flex justify-center items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"><ThumbsUp className="w-4 h-4"/> Интересно</button>
                    </div>

                    {skipReasonOpen && <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                      <div className="text-[11px] font-semibold text-stone-700 mb-2">Почему не подходит? Это поможет Radar быстрее перестроиться.</div>
                      <div className="flex flex-wrap gap-2">{[['too_generic','Слишком банально'],['not_my_topic','Не моя тема'],['wrong_style','Не нравится подача'],['too_shallow','Слишком поверхностно'],['seen_before','Уже видел такое']].map(([value,label]) => <button key={value} onClick={() => feedback('skip', value as RadarSkipReason)} className="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-[11px] font-medium hover:bg-stone-100">{label}</button>)}<button disabled={feedbackBusy} onClick={() => feedback('skip')} className="px-2.5 py-1.5 rounded-lg text-[11px] text-stone-500">Просто Skip</button></div>
                    </div>}

                    <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600">Открыть источник <ExternalLink className="w-3 h-3"/></a>
                  </div>
                </div>
              </div>
            </article>;
          })() : <div className="p-10 text-center border-2 border-dashed rounded-2xl text-sm text-stone-500">Кандидаты закончились. <button onClick={startDiscovery} disabled={isDiscovering} className="underline">Найти новые источники</button></div>}

          {(discovery?.feedbackCount || 0) >= (discovery?.minimumSignals || 5) && <button onClick={completeLearning} className="mt-5 w-full px-5 py-3 rounded-2xl bg-stone-900 text-white font-semibold">Перейти к идеям</button>}
        </div>}

        {!isLoading && profile && view === 'ideas' && <div className="grid lg:grid-cols-[260px_1fr] gap-6">
          <aside className="space-y-3">
            <div className="rounded-2xl border p-4">
              <div className="font-bold text-sm">Radar обучен</div>
              <div className="text-xs text-stone-500 mt-1">{discovery?.interestingCount || 0} интересно · {discovery?.skipCount || 0} skip</div>
            </div>
            <button onClick={() => scan(false)} disabled={isScanning} className="w-full inline-flex justify-center items-center gap-2 px-4 py-3 rounded-2xl bg-stone-900 text-white text-sm font-semibold disabled:opacity-50">{isScanning ? <Loader2 className="w-4 h-4 animate-spin"/> : <ScanSearch className="w-4 h-4"/>}{isScanning ? 'Анализирую…' : 'Обновить Radar'}</button><button onClick={() => setView('discover')} className="w-full px-4 py-2 rounded-xl border text-xs font-semibold">Ещё обучить Radar</button>{error && <p className="text-xs text-rose-600">{error}</p>}</aside>
          <section><div className="flex items-end justify-between mb-3"><div><h3 className="text-lg font-bold">Идеи</h3><p className="text-xs text-stone-500">Feed пополняется после глубокого анализа выбранного контента</p></div><span className="text-xs text-stone-400">{visible.length}</span></div>{visible.length===0?<div className="min-h-[340px] border-2 border-dashed rounded-2xl flex flex-col justify-center items-center text-center"><Sparkles className="w-8 h-8 text-emerald-500"/><div className="font-bold mt-2">Пока нет идей</div><div className="text-xs text-stone-500 mt-1">Нажми «Обновить Radar»</div></div>:<div className="space-y-3">{visible.map(item=><article key={item.id} className={'rounded-2xl border p-4 transition ' + (item.id === initialOpportunityId ? 'border-violet-400 ring-2 ring-violet-100 bg-violet-50/30' : '')}><div className="flex items-center gap-2"><span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">{item.relevance}%</span>{item.topic&&<span className="text-[10px] text-stone-500">{item.topic}</span>}</div><h4 className="font-bold mt-2">{item.title}</h4><div className="text-xs mt-2"><b>Hook:</b> {item.hook}</div><div className="text-xs text-stone-600 mt-1"><b>Ядро:</b> {item.coreIdea}</div><div className="text-xs text-stone-600 mt-1"><b>Угол:</b> {item.angle}</div>{item.evidence?.length?<div className="mt-2 p-2.5 rounded-xl bg-stone-50 text-[11px] text-stone-600">{item.evidence.map((e,i)=><div key={i}>• {e}</div>)}</div>:null}<div className="mt-3 flex gap-2 flex-wrap"><button onClick={()=>setStatus(item.id,item.status==='saved'?'new':'saved')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold"><Bookmark className="w-3 h-3"/>{item.status==='saved'?'Unsave':'Save'}</button><button onClick={()=>setStatus(item.id,'dismissed')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold"><EyeOff className="w-3 h-3"/>Skip</button>{generatedScriptByOpportunity[item.id] ? (
  <button
    onClick={() => onOpenScript?.(generatedScriptByOpportunity[item.id])}
    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-semibold"
  >
    Open in Scripts <ArrowRight className="w-3 h-3"/>
  </button>
) : (
  <button onClick={()=>generateScript(item.id)} disabled={generatingScriptId===item.id} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-900 text-white text-[11px] font-semibold disabled:opacity-50">{generatingScriptId===item.id?'Пишу…':'Generate Script'}</button>
)}</div></article>)}</div>}</section>
        </div>}
      </div>
    </div>
  </div>;
};
