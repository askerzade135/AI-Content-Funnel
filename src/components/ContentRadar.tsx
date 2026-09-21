import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Radio, Sparkles, X, ScanSearch, ExternalLink, Loader2, Bookmark, EyeOff, ThumbsUp, SkipForward, ArrowRight, ArrowLeft } from 'lucide-react';
import { GeneratedScript, RadarDiscoveryRefreshDiagnostics, RadarDiscoveryState, RadarOpportunity, RadarProfile, RadarReferenceSignal, RadarSkipReason, StoredVideo, TrackedChannel } from '../types';
import { authFetch } from '../services/authFetch';

interface ContentRadarProps {
  isOpen: boolean;
  onClose: () => void;
  videos: StoredVideo[];
  channels: TrackedChannel[];
  onRefresh: () => void;
  onOpenAddSource?: () => void;
  embedded?: boolean;
  initialView?: 'setup' | 'discover' | 'ideas';
  initialOpportunityId?: string;
  onOpenScript?: (scriptId: string) => void;
}

const TOPICS = ["Психология","Воспитание","Отношения","Общество","Ценности","Религия и традиции","История","Культура","Бизнес","Технологии"];
const ANGLES = ["Спорные темы","Неожиданные факты","Разрушение мифов","Исследования","Сильные истории","Культурные конфликты","Противоположные точки зрения"];
const CONTENT_FORMATS = [
  { value: 'short_video', label: 'Короткие видео', hint: 'Reels · Shorts · TikTok' },
  { value: 'long_video_or_podcast', label: 'Длинные видео / подкасты', hint: 'YouTube · Podcast' },
  { value: 'article', label: 'Статьи', hint: 'Long-form' },
  { value: 'post', label: 'Посты', hint: 'Social posts' },
];
const GOALS = [
  { value: 'ideas_for_content', label: 'Идеи для контента' },
  { value: 'learn_deeper', label: 'Разбираться глубже' },
  { value: 'follow_trends', label: 'Следить за трендами' },
  { value: 'save_for_later', label: 'Сохранять интересное' },
];

export const ContentRadar: React.FC<ContentRadarProps> = ({ isOpen, onClose, onOpenAddSource, embedded = false, initialView, initialOpportunityId, onOpenScript }) => {
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
  const [references, setReferences] = useState<RadarReferenceSignal[]>([]);
  const [referenceInput, setReferenceInput] = useState('');
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [customAngle, setCustomAngle] = useState('');

  const loadRadar = async () => {
    setIsLoading(true);
    try {
      const [p, d, o, s, r] = await Promise.all([
        authFetch('/api/radar/profile'),
        authFetch('/api/radar/discovery'),
        authFetch('/api/radar/opportunities'),
        authFetch('/api/radar/scripts'),
        authFetch('/api/radar/references'),
      ]);
      if (![p, d, o, s, r].every(response => response.ok)) throw new Error('Не удалось загрузить Radar. Повторите попытку.');
      const profileData = await p.json();
      if (profileData) {
        setProfile(profileData);
        setView(!profileData.topics?.length ? 'setup' : !profileData.onboardingCompletedAt ? 'discover' : initialView || 'ideas');
      }
      if (d.ok) setDiscovery(await d.json());
      if (o.ok) setOpportunities(await o.json());
      if (r.ok) setReferences(await r.json());
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

  const addCustomValue = (field: 'topics' | 'preferredAngles', value: string) => {
    if (!profile) return;
    const clean = value.trim();
    if (!clean) return;
    const current = profile[field] || [];
    if (!current.some(item => item.toLowerCase() === clean.toLowerCase())) {
      setProfile({ ...profile, [field]: [...current, clean].slice(0, 50) });
    }
    if (field === 'topics') setCustomTopic('');
    else setCustomAngle('');
  };

  const toggleProfileList = (field: 'contentFormats' | 'goals', value: string) => {
    if (!profile) return;
    const current = profile[field] || [];
    const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
    setProfile({ ...profile, [field]: next });
  };

  const addReference = async () => {
    const value = referenceInput.trim();
    if (!value || referenceBusy || references.length >= 3) return;
    setReferenceBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/radar/references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, intent: 'more_like_this' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Не удалось добавить пример');
      setReferences(prev => [data, ...prev].slice(0, 3));
      setReferenceInput('');
    } catch (error: any) {
      setError(error.message || 'Не удалось добавить пример');
    } finally {
      setReferenceBusy(false);
    }
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
      } else if (!res.ok) setError('Не удалось загрузить рекомендации. Попробуй ещё раз.');
    } catch (error: any) {
      console.warn('[Content Radar] discovery refresh failed', error);
      setError('Не удалось загрузить рекомендации. Попробуй ещё раз.');
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
    <div className={embedded ? "w-full" : "w-full max-w-6xl max-h-[92vh] overflow-hidden bg-white rounded-3xl shadow-2xl border border-stone-200 flex flex-col"}>
      {!embedded && <div className="px-5 sm:px-7 py-5 border-b border-stone-200 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2"><Radio className="w-5 h-5 text-emerald-600"/><h2 className="font-bold">Content Radar</h2></div>
          <div className="text-xs text-stone-500 mt-1">Шаг {step}/3 · Настройка → обучение → идеи</div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-stone-100"><X className="w-5 h-5"/></button>
      </div>}

      <div className={embedded ? "" : "overflow-y-auto p-5 sm:p-7"}>
        {error && <div role="alert" className="mb-4 text-sm text-rose-600">{error}{!profile && <button onClick={loadRadar} className="ml-3 underline">Повторить</button>}</div>}
        {view === 'discover' && discoveryDiagnostics && (
          discoveryDiagnostics.queryGeneration.source === 'fallback' ||
          !discoveryDiagnostics.youtubeApiConfigured ||
          discoveryDiagnostics.search.some(item => item.error)
        ) && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div><b>Часть источников сейчас недоступна.</b> Radar продолжает поиск по доступным источникам.</div>
          </div>
        )}
        {isLoading || (!profile && !error) ? <div className="min-h-[420px] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin"/></div> : null}

        {!isLoading && profile && view === 'setup' && <div className="max-w-5xl mx-auto lg:min-h-[calc(100vh-13rem)] lg:flex lg:flex-col">
          <div className="mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 mb-1">Настройка вкуса</div>
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-2">
              <div>
                <h3 className="text-xl lg:text-2xl font-bold text-stone-900">Давай настроим твой Radar</h3>
                <p className="text-xs lg:text-sm text-stone-500 mt-1">Это поможет сделать первые рекомендации точнее. Потом Radar продолжит учиться по Interested и Skip.</p>
              </div>
              <div className="text-[11px] text-stone-400">Только темы обязательны</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-4 lg:gap-5 flex-1">
            <div className="space-y-3">
              <section className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2.5">
                  <h4 className="font-bold text-sm">Темы интересов</h4>
                  <span className="text-[11px] text-stone-400">обязательно</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TOPICS.map(x => <button key={x} onClick={() => toggle('topics', x)} className={`px-2.5 py-1.5 rounded-lg text-xs border transition ${profile.topics?.includes(x) ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-200 hover:border-stone-300'}`}>{x}</button>)}
                  {(profile.topics || []).filter(x => !TOPICS.includes(x)).map(x => <button key={x} onClick={() => toggle('topics', x)} className="px-2.5 py-1.5 rounded-lg text-xs border bg-stone-900 text-white border-stone-900">{x} ×</button>)}
                </div>
                <div className="mt-2 flex gap-2">
                  <input value={customTopic} onChange={e => setCustomTopic(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomValue('topics', customTopic); } }} maxLength={80} className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-200" placeholder="+ Добавить свою тему"/>
                  <button type="button" onClick={() => addCustomValue('topics', customTopic)} disabled={!customTopic.trim()} className="px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-medium disabled:opacity-40">Добавить</button>
                </div>
              </section>

              <section className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2.5">
                  <h4 className="font-bold text-sm">Как тебе нравится раскрывать темы?</h4>
                  <span className="text-[11px] text-stone-400">Preferred angles</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ANGLES.map(x => <button key={x} onClick={() => toggle('preferredAngles', x)} className={`px-2.5 py-1.5 rounded-lg text-xs border transition ${profile.preferredAngles?.includes(x) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-stone-200 hover:border-stone-300'}`}>{x}</button>)}
                  {(profile.preferredAngles || []).filter(x => !ANGLES.includes(x)).map(x => <button key={x} onClick={() => toggle('preferredAngles', x)} className="px-2.5 py-1.5 rounded-lg text-xs border bg-emerald-600 text-white border-emerald-600">{x} ×</button>)}
                </div>
                <div className="mt-2 flex gap-2">
                  <input value={customAngle} onChange={e => setCustomAngle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomValue('preferredAngles', customAngle); } }} maxLength={100} className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-200" placeholder="+ Добавить свой подход"/>
                  <button type="button" onClick={() => addCustomValue('preferredAngles', customAngle)} disabled={!customAngle.trim()} className="px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-medium disabled:opacity-40">Добавить</button>
                </div>
              </section>

              <section className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2.5">
                  <h4 className="font-bold text-sm">Что ты создаёшь?</h4>
                  <span className="text-[11px] text-stone-400">можно несколько</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {CONTENT_FORMATS.map(item => {
                    const selected = (profile.contentFormats || []).includes(item.value);
                    return <button key={item.value} type="button" onClick={() => toggleProfileList('contentFormats', item.value)} className={`rounded-xl border p-2.5 text-left transition ${selected ? 'border-emerald-500 bg-emerald-50' : 'border-stone-200 bg-white hover:border-stone-300'}`}>
                      <span className="block text-xs font-bold text-stone-900">{item.label}</span>
                      <span className="block text-[10px] text-stone-500 mt-0.5">{item.hint}</span>
                    </button>;
                  })}
                </div>
              </section>
            </div>

            <div className="space-y-3">
              <section className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2.5">
                  <h4 className="font-bold text-sm">Зачем тебе Radar?</h4>
                  <span className="text-[11px] text-stone-400">можно несколько</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {GOALS.map(item => {
                    const selected = (profile.goals || []).includes(item.value);
                    return <button key={item.value} type="button" onClick={() => toggleProfileList('goals', item.value)} className={`rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition ${selected ? 'border-emerald-500 bg-emerald-50 text-emerald-950' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'}`}>{item.label}</button>;
                  })}
                </div>
              </section>

              <label className="block rounded-2xl border border-stone-200 bg-stone-50/50 p-4">
                <span className="block text-sm font-bold text-stone-900">Что именно хочется находить?</span>
                <textarea value={profile.description || ''} onChange={(e) => setProfile({ ...profile, description: e.target.value })} rows={3} maxLength={4000} className="mt-2 w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400" placeholder="Например: глубокие темы по психологии, исследования, исторические параллели…"/>
              </label>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block rounded-2xl border border-stone-200 bg-stone-50/50 p-3">
                  <span className="block text-xs font-bold text-stone-900">Что лучше не показывать?</span>
                  <textarea value={(profile.avoid || []).join('\n')} onChange={(e) => updateAvoid(e.target.value)} rows={2} maxLength={2000} className="mt-2 w-full resize-none rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs text-stone-800 outline-none focus:ring-2 focus:ring-emerald-200" placeholder="Кликбейт, поверхностные советы…"/>
                  <span className="text-[10px] text-stone-400">Optional</span>
                </label>

                <div className="rounded-2xl border border-stone-200 bg-stone-50/50 p-3">
                  <span className="block text-xs font-bold text-stone-900">Есть пример контента?</span>
                  <div className="mt-2 flex gap-1.5">
                    <input value={referenceInput} onChange={e => setReferenceInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addReference(); } }} disabled={referenceBusy || references.length >= 3} className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-200 disabled:bg-stone-100" placeholder="Ссылка на видео / канал / пост"/>
                    <button type="button" onClick={() => void addReference()} disabled={!referenceInput.trim() || referenceBusy || references.length >= 3} className="px-2.5 rounded-lg bg-stone-900 text-white text-xs font-semibold disabled:opacity-40">{referenceBusy ? '…' : '+'}</button>
                  </div>
                  {references.length > 0 && <div className="mt-2 space-y-1">{references.slice(0,3).map(ref => <div key={ref.id} className="truncate text-[10px] text-stone-500" title={ref.value}>• {ref.title || ref.value}</div>)}</div>}
                  <span className="text-[10px] text-stone-400">{references.length}/3 примеров</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-stone-100 pt-4">
            <div className="text-[11px] text-stone-400">Optional-поля можно пропустить и уточнить позже.</div>
            <button disabled={isDiscovering || !profile.topics?.length} onClick={startDiscovery} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold disabled:opacity-40">Начать обучение <ArrowRight className="w-4 h-4"/></button>
          </div>
        </div>}

        {!isLoading && profile && view === 'discover' && <div className="max-w-7xl mx-auto">
          {(() => {
            const feedbackCount = discovery?.feedbackCount || 0;
            const minimumSignals = discovery?.minimumSignals || 5;
            const progress = Math.min(100, (feedbackCount / minimumSignals) * 100);
            const trainingComplete = feedbackCount >= minimumSignals;
            const item = discovery?.candidates?.[0];
            const nextCandidates = (discovery?.candidates || []).slice(1, 4);
            const candidateText = item ? `${item.title} ${item.summary || item.description || ''}`.toLowerCase() : '';
            const matchedTopics = item
              ? (profile.topics || []).filter(topic => candidateText.includes(topic.toLowerCase())).slice(0, 4)
              : [];
            const sourceName = item
              ? (item.sourceLabel || (item.sourceType === 'youtube' ? 'YouTube' : item.sourceType === 'x' ? 'X' : item.sourceType === 'web' ? 'Web' : 'Manual'))
              : '';
            const preview = item?.imageUrl || item?.thumbnail;
            const author = item?.author || item?.channelTitle;

            return <>
              <div className="mb-5 flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight text-stone-950">Discover</h2>
                  <p className="text-sm text-stone-500 mt-1">AI finds the best content for you, based on your interests and goals.</p>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[155px]">
                    <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                      <span className="font-medium text-stone-600">Taste training</span>
                      <span className="font-bold text-stone-900">{Math.min(feedbackCount, minimumSignals)} / {minimumSignals}</span>
                    </div>
                    <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <button type="button" onClick={() => setView('setup')} className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 text-xs font-semibold text-stone-700 hover:bg-stone-50">
                    <ArrowLeft className="w-3.5 h-3.5" /> Edit interests
                  </button>
                  {onOpenAddSource && <button type="button" onClick={onOpenAddSource} className="h-10 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700">
                    <Sparkles className="w-3.5 h-3.5" /> Add source
                  </button>}
                </div>
              </div>

              {trainingComplete && (
                <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <div className="text-sm font-bold text-emerald-950">Radar уже понял базовый вкус</div>
                      <p className="text-xs text-emerald-800 mt-1">{minimumSignals} сигналов собрано. Можно перейти к идеям или продолжить обучать Radar.</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => void startDiscovery()} disabled={isDiscovering} className="px-3.5 py-2 rounded-xl border border-emerald-300 bg-white text-xs font-semibold text-emerald-800 disabled:opacity-50">Продолжить Discover</button>
                      <button onClick={completeLearning} className="px-4 py-2 rounded-xl bg-stone-900 text-white text-xs font-semibold">Перейти к Ideas</button>
                    </div>
                  </div>
                </div>
              )}

              {isDiscovering ? (
                <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-5">
                  <div className="min-h-[520px] rounded-2xl border border-stone-200 bg-white p-6 animate-pulse">
                    <div className="h-64 rounded-xl bg-stone-100" />
                    <div className="mt-5 h-5 w-2/3 rounded bg-stone-100" />
                    <div className="mt-3 h-4 w-1/2 rounded bg-stone-100" />
                    <div className="mt-8 h-28 rounded-xl bg-emerald-50" />
                  </div>
                  <div className="space-y-4">
                    <div className="h-40 rounded-2xl bg-stone-100 animate-pulse" />
                    <div className="h-28 rounded-2xl bg-stone-100 animate-pulse" />
                  </div>
                </div>
              ) : item ? (
                <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
                  <article className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden">
                    <div className="grid lg:grid-cols-[minmax(300px,45%)_minmax(0,1fr)]">
                      <div className="bg-stone-100 min-h-[280px]">
                        {preview ? <img src={preview} alt="" className="w-full h-full min-h-[280px] object-cover"/> : (
                          <div className="h-full min-h-[280px] flex items-center justify-center text-stone-400"><Radio className="w-8 h-8"/></div>
                        )}
                      </div>

                      <div className="p-5 flex flex-col min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="rounded-full bg-stone-900 px-2.5 py-1 font-semibold text-white">{sourceName}</span>
                          {matchedTopics.slice(0,2).map(topic => <span key={topic} className="rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-600">{topic}</span>)}
                          <a href={item.url} target="_blank" rel="noreferrer" className="ml-auto p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700" title="Открыть оригинал"><ExternalLink className="w-4 h-4"/></a>
                        </div>

                        <h3 className="mt-3 text-xl font-bold leading-snug text-stone-950">{item.title}</h3>
                        {author && <div className="mt-3 text-xs font-semibold text-stone-700">{author}</div>}
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-400">
                          {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleDateString()}</span>}
                          {item.query && <span>Found for: {item.query}</span>}
                        </div>

                        {(item.summary || item.description) && <div className="mt-4">
                          <p className="text-sm leading-6 text-stone-600 line-clamp-4">{item.summary || item.description}</p>
                        </div>}
                      </div>
                    </div>

                    <div className="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(220px,.8fr)] gap-4 p-5 pt-4">
                      <section className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-bold text-emerald-950">Why this matches you</div>
                          {typeof item.rankingScore === 'number' && <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700">{item.rankingScore}% match</span>}
                        </div>
                        <div className="mt-3 space-y-2">
                          {(item.rankingReason ? item.rankingReason.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0,3) : [
                            'Radar выбрал этот материал на основе твоих интересов и предыдущих решений.'
                          ]).map((reason, index) => (
                            <div key={index} className="flex items-start gap-2 text-xs leading-5 text-emerald-950">
                              <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">✓</span>
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                        <div className="text-sm font-bold text-stone-900">Key topics</div>
                        <div className="mt-3 space-y-2">
                          {(matchedTopics.length ? matchedTopics : item.query ? [item.query] : []).map(topic => <div key={topic} className="text-xs text-stone-600">• {topic}</div>)}
                          {!matchedTopics.length && !item.query && <div className="text-xs text-stone-400">Темы появятся после анализа источника.</div>}
                        </div>
                      </section>
                    </div>

                    <div className="border-t border-stone-100 p-5 pt-4">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <button onClick={() => setSkipReasonOpen(v => !v)} disabled={feedbackBusy} className="inline-flex justify-center items-center gap-2 px-4 py-3 rounded-xl border border-stone-300 bg-white font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"><SkipForward className="w-4 h-4"/> Skip</button>
                        <button disabled={feedbackBusy} onClick={() => feedback('interesting')} className="inline-flex justify-center items-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"><ThumbsUp className="w-4 h-4"/> Interested</button>
                      </div>

                      {skipReasonOpen && <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                        <div className="text-xs font-semibold text-stone-700 mb-2">Почему не подходит?</div>
                        <div className="flex flex-wrap gap-2">{[['too_generic','Слишком банально'],['not_my_topic','Не моя тема'],['wrong_style','Не нравится подача'],['too_shallow','Слишком поверхностно'],['seen_before','Уже видел такое']].map(([value,label]) => <button key={value} disabled={feedbackBusy} onClick={() => feedback('skip', value as RadarSkipReason)} className="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-[11px] font-medium hover:bg-stone-100 disabled:opacity-50">{label}</button>)}<button disabled={feedbackBusy} onClick={() => feedback('skip')} className="px-2.5 py-1.5 rounded-lg text-[11px] text-stone-500 disabled:opacity-50">Просто Skip</button></div>
                      </div>}
                    </div>
                  </article>

                  <aside className="space-y-4">
                    <section className="rounded-2xl border border-stone-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-bold text-stone-900">Your interests</h4>
                        <button onClick={() => setView('setup')} className="text-xs font-semibold text-emerald-700">Edit</button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(profile.topics || []).slice(0,8).map(topic => <span key={topic} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-medium text-stone-700">{topic}</span>)}
                        <button onClick={() => setView('setup')} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">+ Add</button>
                      </div>
                    </section>

                    {!trainingComplete && <section className="rounded-2xl border border-violet-100 bg-violet-50 p-4">
                      <div className="text-sm font-bold text-violet-900">Tip</div>
                      <p className="mt-2 text-xs leading-5 text-violet-800">Mark at least {minimumSignals} items to help Radar understand your taste.</p>
                    </section>}

                    {nextCandidates.length > 0 && <section className="rounded-2xl border border-stone-200 bg-white p-4">
                      <div className="text-sm font-bold text-stone-900">Similar content</div>
                      <div className="mt-3 space-y-3">
                        {nextCandidates.map(candidate => (
                          <a key={candidate.id} href={candidate.url} target="_blank" rel="noreferrer" className="flex gap-3 group">
                            {(candidate.imageUrl || candidate.thumbnail) ? <img src={candidate.imageUrl || candidate.thumbnail} alt="" className="w-20 h-14 rounded-lg object-cover bg-stone-100"/> : <div className="w-20 h-14 rounded-lg bg-stone-100 shrink-0"/>}
                            <div className="min-w-0">
                              <div className="text-xs font-semibold leading-4 text-stone-800 line-clamp-2 group-hover:text-emerald-700">{candidate.title}</div>
                              <div className="mt-1 text-[10px] text-stone-400">{candidate.author || candidate.channelTitle || candidate.sourceLabel || candidate.sourceType}</div>
                            </div>
                          </a>
                        ))}
                      </div>
                    </section>}
                  </aside>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-stone-200 bg-white p-10 text-center">
                  <div className="text-base font-bold text-stone-900">Пока не нашли подходящих материалов</div>
                  <p className="mt-2 text-sm text-stone-500">Попробуй новый поиск, измени интересы или добавь источник вручную.</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button onClick={startDiscovery} disabled={isDiscovering} className="px-4 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-semibold disabled:opacity-50">Найти ещё</button>
                    <button onClick={() => setView('setup')} className="px-4 py-2.5 rounded-xl border border-stone-200 text-xs font-semibold">Изменить интересы</button>
                    {onOpenAddSource && <button onClick={onOpenAddSource} className="px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold">Add source</button>}
                  </div>
                </div>
              )}
            </>;
          })()}
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
