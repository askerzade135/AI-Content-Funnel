import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Radio, Sparkles, X, ScanSearch, ExternalLink, Loader2, Bookmark, Eye, EyeOff, MessageCircle, ThumbsUp, SkipForward, ArrowRight, ArrowLeft, Tags, Plus, Check, Settings2, ChevronDown, Clock3, SlidersHorizontal, Youtube, MoreHorizontal } from 'lucide-react';
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
  onOnboardingCompleted?: () => void;
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


const decodeHtmlEntities = (value?: string | null): string => {
  if (!value) return '';
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  }
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
};

const profileTasteFingerprint = (profile?: RadarProfile | null): string => JSON.stringify({
  topics: [...(profile?.topics || [])].sort(),
  preferredAngles: [...(profile?.preferredAngles || [])].sort(),
  contentFormats: [...(profile?.contentFormats || [])].sort(),
  goals: [...(profile?.goals || [])].sort(),
  avoid: [...(profile?.avoid || [])].sort(),
  description: profile?.description || '',
  customInstructions: profile?.customInstructions || '',
});

const discoveryFingerprint = (profile?: RadarProfile | null, references: RadarReferenceSignal[] = []): string =>
  JSON.stringify({
    profile: profileTasteFingerprint(profile),
    references: references
      .map(ref => ({ id: ref.id, value: ref.value, intent: ref.intent }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });

const OnboardingStepper: React.FC<{ currentStep: 1 | 2 | 3 }> = ({ currentStep }) => {
  const steps = ['Setup', 'Taste training', 'Ideas'];
  return (
    <div className="max-w-3xl mx-auto mt-7 mb-2 px-2">
      <div className="flex items-center">
        {steps.map((label, index) => {
          const step = (index + 1) as 1 | 2 | 3;
          const done = step < currentStep;
          const active = step === currentStep;
          return (
            <React.Fragment key={label}>
              <div className="flex flex-col items-center gap-1.5 min-w-[92px]">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border transition ${
                  done ? 'bg-emerald-600 border-emerald-600 text-white' :
                  active ? 'bg-white border-emerald-500 text-emerald-700 ring-4 ring-emerald-50' :
                  'bg-white border-stone-200 text-stone-400'
                }`}>
                  {done ? <Check className="w-3.5 h-3.5" /> : step}
                </div>
                <span className={`text-[10px] font-semibold ${active ? 'text-stone-800' : done ? 'text-emerald-700' : 'text-stone-400'}`}>{label}</span>
              </div>
              {index < steps.length - 1 && <div className={`h-px flex-1 -mt-5 ${step < currentStep ? 'bg-emerald-400' : 'bg-stone-200'}`} />}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export const ContentRadar: React.FC<ContentRadarProps> = ({ isOpen, onClose, onOpenAddSource, embedded = false, initialView, initialOpportunityId, onOpenScript, onOnboardingCompleted }) => {
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
  const [expandedDescriptionId, setExpandedDescriptionId] = useState<string | null>(null);
  const [interestsEditorOpen, setInterestsEditorOpen] = useState(false);
  const [draftTopics, setDraftTopics] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState('');
  const [interestsSaving, setInterestsSaving] = useState(false);
  const [ideasFilter, setIdeasFilter] = useState<'all' | 'new' | 'saved'>('all');
  const [ideasSort, setIdeasSort] = useState<'match' | 'newest'>('match');
  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(null);
  const persistedProfileFingerprintRef = useRef('');
  const lastDiscoveryFingerprintRef = useRef('');
  const discoveryAbortRef = useRef<AbortController | null>(null);

  const loadRadar = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [p, d, o, s, r] = await Promise.all([
        authFetch('/api/radar/profile'),
        authFetch('/api/radar/discovery'),
        authFetch('/api/radar/opportunities'),
        authFetch('/api/radar/scripts'),
        authFetch('/api/radar/references'),
      ]);
      if (![p, d, o, s, r].every(response => response.ok)) throw new Error('Не удалось загрузить Radar. Повторите попытку.');

      const [profileData, discoveryData, opportunitiesData, scriptsData, referencesData] = await Promise.all([
        p.json() as Promise<RadarProfile>,
        d.json() as Promise<RadarDiscoveryState>,
        o.json() as Promise<RadarOpportunity[]>,
        s.json() as Promise<GeneratedScript[]>,
        r.json() as Promise<RadarReferenceSignal[]>,
      ]);

      setProfile(profileData);
      setDiscovery(discoveryData);
      setOpportunities(opportunitiesData);
      setReferences(referencesData);
      persistedProfileFingerprintRef.current = profileTasteFingerprint(profileData);
      if (discoveryData?.candidates?.length) {
        lastDiscoveryFingerprintRef.current = discoveryFingerprint(profileData, referencesData);
      }
      setView(!profileData.topics?.length ? 'setup' : !profileData.onboardingCompletedAt ? 'discover' : initialView || 'ideas');

      const byOpportunity: Record<string, string> = {};
      for (const script of scriptsData) {
        if (script.radarOpportunityId && !byOpportunity[script.radarOpportunityId]) {
          byOpportunity[script.radarOpportunityId] = script.id;
        }
      }
      setGeneratedScriptByOpportunity(byOpportunity);
    } catch (error: any) {
      setError(error.message || 'Ошибка загрузки Radar');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (isOpen) void loadRadar(); }, [isOpen]);
  useEffect(() => () => discoveryAbortRef.current?.abort(), []);
  useEffect(() => {
    if (isOpen && initialView && profile?.onboardingCompletedAt) setView(initialView);
  }, [isOpen, initialView]);

  const saveProfile = async (next: RadarProfile): Promise<RadarProfile> => {
    const res = await authFetch('/api/radar/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error('Не удалось сохранить интересы');
    const saved = await res.json() as RadarProfile;
    setProfile(saved);
    persistedProfileFingerprintRef.current = profileTasteFingerprint(saved);
    return saved;
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
      lastDiscoveryFingerprintRef.current = '';
      setReferenceInput('');
    } catch (error: any) {
      setError(error.message || 'Не удалось добавить пример');
    } finally {
      setReferenceBusy(false);
    }
  };

  const startDiscovery = async (options?: { forceRefresh?: boolean; profileOverride?: RadarProfile }) => {
    const targetProfile = options?.profileOverride || profile;
    if (!targetProfile || !(targetProfile.topics || []).length || isDiscovering) return;

    const profileFp = profileTasteFingerprint(targetProfile);
    const discoveryFp = discoveryFingerprint(targetProfile, references);
    const hasCachedCandidates = Boolean(discovery?.candidates?.length);

    setView('discover');
    setSkipReasonOpen(false);

    if (!options?.forceRefresh && hasCachedCandidates && lastDiscoveryFingerprintRef.current === discoveryFp) {
      if (profileFp !== persistedProfileFingerprintRef.current) await saveProfile(targetProfile);
      return;
    }

    discoveryAbortRef.current?.abort();
    const controller = new AbortController();
    discoveryAbortRef.current = controller;
    setIsDiscovering(true);
    setError(null);

    try {
      if (profileFp !== persistedProfileFingerprintRef.current) {
        await saveProfile(targetProfile);
      }
      const res = await authFetch('/api/radar/discovery/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perQuery: 5 }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Не удалось загрузить рекомендации. Попробуй ещё раз.');
      if (data?.discovery) {
        setDiscovery(data.discovery);
        setDiscoveryDiagnostics(data as RadarDiscoveryRefreshDiagnostics);
        lastDiscoveryFingerprintRef.current = discoveryFp;
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      console.warn('[Content Radar] discovery refresh failed', error);
      setError(error?.message || 'Не удалось загрузить рекомендации. Попробуй ещё раз.');
    } finally {
      if (discoveryAbortRef.current === controller) discoveryAbortRef.current = null;
      setIsDiscovering(false);
    }
  };

  const openInterestsEditor = () => {
    if (!profile || isDiscovering) return;
    setDraftTopics([...(profile.topics || [])]);
    setInterestInput('');
    setInterestsEditorOpen(true);
  };

  const addDraftTopic = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    setDraftTopics(prev => prev.some(topic => topic.toLowerCase() === clean.toLowerCase()) ? prev : [...prev, clean].slice(0, 50));
    setInterestInput('');
  };

  const saveInterestsFromDiscover = async () => {
    if (!profile || !draftTopics.length || interestsSaving || isDiscovering) return;
    const current = [...(profile.topics || [])].sort().join('|');
    const nextTopics = [...draftTopics].sort().join('|');
    setInterestsSaving(true);
    setError(null);
    try {
      if (current === nextTopics) {
        setInterestsEditorOpen(false);
        return;
      }
      const saved = await saveProfile({ ...profile, topics: draftTopics });
      setInterestsEditorOpen(false);
      lastDiscoveryFingerprintRef.current = '';
      await startDiscovery({ forceRefresh: true, profileOverride: saved });
    } catch (error: any) {
      setError(error?.message || 'Не удалось сохранить интересы');
    } finally {
      setInterestsSaving(false);
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
    onOnboardingCompleted?.();
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

  const filteredIdeas = useMemo(() => {
    let items = visible.filter(item => {
      if (ideasFilter === 'saved') return item.status === 'saved';
      if (ideasFilter === 'new') return item.status === 'new';
      return true;
    });
    items = [...items].sort((a, b) => ideasSort === 'match'
      ? b.relevance - a.relevance
      : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items;
  }, [visible, ideasFilter, ideasSort]);
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
            <button disabled={isDiscovering || !profile.topics?.length} onClick={() => void startDiscovery()} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold disabled:opacity-40">Начать обучение <ArrowRight className="w-4 h-4"/></button>
          </div>
        </div>}

        {!isLoading && profile && view === 'discover' && <div className="max-w-[1360px] mx-auto">
          {(() => {
            const feedbackCount = discovery?.feedbackCount || 0;
            const minimumSignals = discovery?.minimumSignals || 5;
            const trainingComplete = feedbackCount >= minimumSignals;
            const item = discovery?.candidates?.[0];
            const nextCandidates = (discovery?.candidates || []).slice(1, 4);
            const candidateText = item ? `${item.title} ${item.summary || item.description || ''}`.toLowerCase() : '';
            const matchedTopics = item
              ? (profile.topics || []).filter(topic => candidateText.includes(topic.toLowerCase())).slice(0, 4)
              : [];
            const keyTopics = item
              ? ((item.keyTopics || []).filter(Boolean).slice(0, 5).length
                  ? (item.keyTopics || []).filter(Boolean).slice(0, 5)
                  : matchedTopics)
              : [];
            const displayTags = keyTopics.slice(0, 3);
            const descriptionText = item ? decodeHtmlEntities(item.summary || item.description || '') : '';
            const descriptionExpanded = Boolean(item && expandedDescriptionId === item.id);
            const canExpandDescription = descriptionText.length > 220;
            const formatMetric = (value?: number) => {
              if (typeof value !== 'number' || !Number.isFinite(value)) return null;
              return Intl.NumberFormat(undefined, { notation: value >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
            };
            const sourceName = item
              ? (item.sourceLabel || (item.sourceType === 'youtube' ? 'YouTube' : item.sourceType === 'x' ? 'X' : item.sourceType === 'web' ? 'Web' : 'Manual'))
              : '';
            const preview = item?.imageUrl || item?.thumbnail;
            const author = decodeHtmlEntities(item?.author || item?.channelTitle || '');
            const title = decodeHtmlEntities(item?.title || '');

            return <>
              <div className="mb-6 flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
                <div>
                  <h2 className="text-[32px] leading-[1.1] font-bold tracking-tight text-stone-950">Discover</h2>
                  <p className="text-sm text-stone-500 mt-1">AI finds the best content for you, based on your interests and goals.</p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2.5">
                  <div className="min-w-[150px] px-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-stone-700">Taste training</span>
                      <span className="font-bold text-stone-950">{Math.min(feedbackCount, minimumSignals)} / {minimumSignals}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-stone-200 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (feedbackCount / minimumSignals) * 100)}%` }} />
                    </div>
                  </div>
                  <button type="button" disabled={isDiscovering} onClick={() => setView('setup')} className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>
                  <button type="button" disabled={isDiscovering} onClick={openInterestsEditor} className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                    <Settings2 className="w-3.5 h-3.5 text-emerald-600" /> Edit interests
                  </button>
                  {onOpenAddSource && <button type="button" disabled={isDiscovering} onClick={onOpenAddSource} className="hidden lg:inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm disabled:opacity-40">
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
                      <button onClick={() => void startDiscovery({ forceRefresh: true })} disabled={isDiscovering} className="px-3.5 py-2 rounded-xl border border-emerald-300 bg-white text-xs font-semibold text-emerald-800 disabled:opacity-50">Продолжить Discover</button>
                      <button onClick={completeLearning} className="px-4 py-2 rounded-xl bg-stone-900 text-white text-xs font-semibold">Перейти к Ideas</button>
                    </div>
                  </div>
                </div>
              )}

              {isDiscovering ? (
                <div className="grid xl:grid-cols-[minmax(0,1fr)_310px] gap-6">
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
                <div className="grid xl:grid-cols-[minmax(0,1fr)_310px] gap-6 items-start">
                  <article className="rounded-2xl border border-stone-200 bg-white shadow-[0_8px_28px_rgba(28,25,23,0.04)] overflow-hidden">
                    <div className="grid lg:grid-cols-[minmax(320px,48%)_minmax(0,1fr)] items-stretch">
                      <div className="relative bg-stone-100 min-h-[320px] lg:min-h-[340px] overflow-hidden">
                        {preview ? <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover scale-[1.035]"/> : (
                          <div className="h-full min-h-[320px] lg:min-h-[340px] flex items-center justify-center text-stone-400"><Radio className="w-8 h-8"/></div>
                        )}
                        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                          <span className="rounded-full bg-stone-950/90 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">{sourceName}</span>
                          {displayTags.slice(0,2).map(topic => <span key={topic} className="rounded-full bg-stone-900/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">{decodeHtmlEntities(topic)}</span>)}
                          {keyTopics.length > 2 && <span className="rounded-full bg-stone-900/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">+{keyTopics.length - 2}</span>}
                        </div>
                      </div>

                      <div className="p-5 lg:p-6 flex flex-col min-w-0 min-h-[320px] lg:min-h-[340px]">
                        <div className="flex justify-end">
                          <a href={item.url} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700" title="Открыть оригинал"><ExternalLink className="w-4 h-4"/></a>
                        </div>

                        <h3 className="-mt-1 pr-7 text-[19px] font-bold leading-[1.35] text-stone-950 line-clamp-3">{title}</h3>
                        {author && <div className="mt-3 text-[13px] font-semibold text-stone-700">{author}</div>}
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-400">
                          {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleDateString()}</span>}
                        </div>

                        {(typeof item.viewCount === 'number' || typeof item.likeCount === 'number' || typeof item.commentCount === 'number') && (
                          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-stone-500">
                            {typeof item.viewCount === 'number' && <span className="inline-flex items-center gap-1.5"><Eye className="w-3.5 h-3.5"/>{formatMetric(item.viewCount)} views</span>}
                            {typeof item.likeCount === 'number' && <span className="inline-flex items-center gap-1.5"><ThumbsUp className="w-3.5 h-3.5"/>{formatMetric(item.likeCount)}</span>}
                            {typeof item.commentCount === 'number' && <span className="inline-flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5"/>{formatMetric(item.commentCount)}</span>}
                          </div>
                        )}

                        {descriptionText && <div className="mt-4">
                          <p className={`text-sm leading-6 text-stone-600 ${descriptionExpanded ? '' : 'line-clamp-4'}`}>{descriptionText}</p>
                          {canExpandDescription && (
                            <button
                              type="button"
                              onClick={() => setExpandedDescriptionId(descriptionExpanded ? null : item.id)}
                              className="mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                            >
                              {descriptionExpanded ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </div>}
                      </div>
                    </div>

                    <div className={`grid gap-4 p-5 pt-4 ${keyTopics.length ? 'lg:grid-cols-[minmax(0,1.85fr)_minmax(220px,.75fr)]' : ''}`}>
                      <section className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="inline-flex items-center gap-2 text-sm font-bold text-emerald-950"><Sparkles className="w-4 h-4 text-emerald-600" />Why this matches you</div>
                          {typeof item.rankingScore === 'number' && <span title="AI ranking score based on your profile, references, Interested/Skip history and negative preferences." className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700">{item.rankingScore}% match</span>}
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

                      {keyTopics.length > 0 && <section className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                        <div className="inline-flex items-center gap-2 text-sm font-bold text-stone-900"><Tags className="w-4 h-4 text-stone-500" />Key topics</div>
                        <div className="mt-3 space-y-2.5">
                          {keyTopics.map(topic => <div key={topic} className="flex items-start gap-2 text-xs text-stone-600"><span className="mt-[3px] h-3.5 w-3.5 rounded border border-stone-300 bg-white shrink-0"/> <span>{topic}</span></div>)}
                        </div>
                      </section>}
                    </div>

                    <div className="border-t border-stone-100 p-5 pt-4">
                      <div className="grid sm:grid-cols-2 gap-4">
                        <button onClick={() => setSkipReasonOpen(v => !v)} disabled={feedbackBusy || isDiscovering} className="h-14 inline-flex justify-center items-center gap-2 px-4 rounded-xl border border-stone-300 bg-white font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"><SkipForward className="w-4 h-4"/> Skip</button>
                        <button disabled={feedbackBusy || isDiscovering} onClick={() => feedback('interesting')} className="h-14 inline-flex justify-center items-center gap-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50 shadow-sm"><ThumbsUp className="w-4 h-4"/> Interested</button>
                      </div>

                      <button type="button" disabled={feedbackBusy || isDiscovering} onClick={() => setSkipReasonOpen(v => !v)} className="mt-3 mx-auto flex items-center gap-1.5 text-[11px] text-stone-500 underline decoration-dotted underline-offset-4 hover:text-stone-800 disabled:opacity-40">
                        <Settings2 className="w-3.5 h-3.5" /> Not sure? Show fewer videos like this.
                      </button>
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
                        <button disabled={isDiscovering} onClick={openInterestsEditor} className="text-xs font-semibold text-emerald-700 disabled:opacity-40">Edit</button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(profile.topics || []).slice(0,8).map(topic => <span key={topic} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-medium text-stone-700">{topic}</span>)}
                        <button disabled={isDiscovering} onClick={openInterestsEditor} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-40">+ Add</button>
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
                            {(candidate.imageUrl || candidate.thumbnail) ? <img src={candidate.imageUrl || candidate.thumbnail} alt="" className="w-28 h-16 rounded-lg object-cover bg-stone-100 shrink-0"/> : <div className="w-28 h-16 rounded-lg bg-stone-100 shrink-0"/>}
                            <div className="min-w-0">
                              <div className="text-xs font-semibold leading-4 text-stone-800 line-clamp-2 group-hover:text-emerald-700">{decodeHtmlEntities(candidate.title)}</div>
                              <div className="mt-1 text-[10px] text-stone-400">{decodeHtmlEntities(candidate.author || candidate.channelTitle || candidate.sourceLabel || candidate.sourceType)}</div>
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
                    <button onClick={() => void startDiscovery({ forceRefresh: true })} disabled={isDiscovering} className="px-4 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-semibold disabled:opacity-50">Найти ещё</button>
                    <button onClick={openInterestsEditor} disabled={isDiscovering} className="px-4 py-2.5 rounded-xl border border-stone-200 text-xs font-semibold disabled:opacity-40">Изменить интересы</button>
                    {onOpenAddSource && <button onClick={onOpenAddSource} className="px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold">Add source</button>}
                  </div>
                </div>
              )}
            </>;
          })()}
        </div>}

        {!isLoading && profile && view === 'ideas' && <div className="max-w-[1360px] mx-auto">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[30px] leading-none font-bold tracking-tight text-stone-950">Ideas</h2>
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-500">{visible.length}</span>
                </div>
                <p className="mt-2 text-sm text-stone-500">Turn the strongest Radar findings into content worth making.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-stone-200 bg-white p-1">
                  {(['all','new','saved'] as const).map(filter => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setIdeasFilter(filter)}
                      className={`h-8 rounded-lg px-3 text-[11px] font-semibold transition ${ideasFilter === filter ? 'bg-stone-950 text-white' : 'text-stone-500 hover:bg-stone-50'}`}
                    >
                      {filter === 'all' ? 'All' : filter === 'new' ? 'New' : 'Saved'}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-stone-400" />
                  <select
                    value={ideasSort}
                    onChange={event => setIdeasSort(event.target.value as 'match' | 'newest')}
                    className="h-10 appearance-none rounded-xl border border-stone-200 bg-white pl-9 pr-8 text-[11px] font-semibold text-stone-700 outline-none"
                  >
                    <option value="match">Sort: Match</option>
                    <option value="newest">Sort: Newest</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-stone-400" />
                </div>
              </div>
            </div>

            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Sparkles className="w-3.5 h-3.5" /></span>
                  Radar personalized
                </div>
                <span className="text-xs text-stone-500">{discovery?.interestingCount || 0} interesting</span>
                <span className="text-stone-300">·</span>
                <span className="text-xs text-stone-500">{discovery?.skipCount || 0} skipped</span>
                {isScanning && <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><Loader2 className="w-3.5 h-3.5 animate-spin" />Analyzing new material…</span>}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => scan(false)}
                  disabled={isScanning}
                  className="h-9 inline-flex items-center gap-2 rounded-xl bg-stone-950 px-3.5 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
                >
                  {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
                  {isScanning ? 'Analyzing…' : 'Refresh Radar'}
                </button>
                <button
                  onClick={() => setView('discover')}
                  disabled={isScanning}
                  className="h-9 rounded-xl border border-stone-200 bg-white px-3.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                >
                  Train more
                </button>
              </div>
            </div>

            {error && <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

            {visible.length === 0 ? (
              <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
                {isScanning ? (
                  <>
                    <div className="flex items-center gap-2 text-sm font-semibold text-stone-800"><Loader2 className="w-4 h-4 animate-spin text-emerald-600" />Analyzing selected content…</div>
                    <div className="mt-1 text-xs text-stone-500">Radar is extracting content opportunities. New ideas will appear here automatically.</div>
                    <div className="mt-5 grid md:grid-cols-2 gap-4">
                      {[0,1,2,3].map(index => (
                        <div key={index} className="rounded-2xl border border-stone-100 bg-stone-50/70 p-4 animate-pulse">
                          <div className="h-4 w-24 rounded bg-stone-200" />
                          <div className="mt-4 h-5 w-4/5 rounded bg-stone-200" />
                          <div className="mt-3 h-3 w-full rounded bg-stone-200" />
                          <div className="mt-2 h-3 w-5/6 rounded bg-stone-200" />
                          <div className="mt-5 h-9 w-32 rounded bg-stone-200" />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Sparkles className="w-5 h-5" /></div>
                      <div>
                        <div className="text-sm font-bold text-stone-900">No ideas yet</div>
                        <div className="mt-1 text-xs leading-5 text-stone-500">Refresh Radar to analyze selected content and turn the strongest findings into ideas.</div>
                      </div>
                    </div>
                    <button onClick={() => scan(false)} className="h-10 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white">Refresh Radar</button>
                  </div>
                )}
              </section>
            ) : filteredIdeas.length === 0 ? (
              <section className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
                <div className="text-sm font-bold text-stone-900">Nothing in this filter</div>
                <div className="mt-1 text-xs text-stone-500">Try another view or refresh Radar for more opportunities.</div>
                <button onClick={() => setIdeasFilter('all')} className="mt-4 rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold">Show all ideas</button>
              </section>
            ) : (
              <div className="grid xl:grid-cols-2 gap-4">
                {filteredIdeas.map(item => {
                  const expanded = expandedIdeaId === item.id;
                  const scriptedId = generatedScriptByOpportunity[item.id];
                  return (
                    <article
                      key={item.id}
                      className={`group rounded-2xl border bg-white p-5 transition shadow-[0_8px_26px_rgba(28,25,23,0.025)] hover:shadow-[0_10px_32px_rgba(28,25,23,0.055)] ${item.id === initialOpportunityId ? 'border-violet-300 ring-2 ring-violet-100' : 'border-stone-200'}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">{item.relevance}% match</span>
                          {item.topic && <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-500">{item.topic}</span>}
                        </div>
                        <button
                          type="button"
                          title="More actions"
                          className="rounded-lg p-1.5 text-stone-300 opacity-0 transition group-hover:opacity-100 hover:bg-stone-100 hover:text-stone-600"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>

                      <h3 className="mt-3 text-[17px] font-bold leading-[1.35] text-stone-950 line-clamp-2">{item.title}</h3>

                      <div className="mt-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">Hook</div>
                        <p className="mt-1 text-sm leading-5 text-stone-700 line-clamp-2">{item.hook}</p>
                      </div>

                      <div className="mt-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">Core insight</div>
                        <p className="mt-1 text-xs leading-5 text-stone-600 line-clamp-3">{item.coreIdea}</p>
                      </div>

                      <div className="mt-4 flex items-center gap-2 border-t border-stone-100 pt-3 text-[11px] text-stone-400">
                        <Youtube className="w-3.5 h-3.5 text-rose-500" />
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-emerald-700">
                          {item.sourceChannel || item.sourceTitle}
                        </a>
                        <span className="text-stone-300">·</span>
                        <Clock3 className="w-3 h-3" />
                        <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpandedIdeaId(expanded ? null : item.id)}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 hover:text-stone-950"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        {expanded ? 'Hide details' : 'Why this idea?'}
                      </button>

                      {expanded && (
                        <div className="mt-3 rounded-xl bg-stone-50 p-3.5 text-xs leading-5 text-stone-600">
                          {item.whyInteresting && <p><span className="font-semibold text-stone-800">Why:</span> {item.whyInteresting}</p>}
                          {item.angle && <p className="mt-2"><span className="font-semibold text-stone-800">Angle:</span> {item.angle}</p>}
                          {item.evidence?.length ? (
                            <div className="mt-3">
                              <div className="font-semibold text-stone-800">Evidence</div>
                              <div className="mt-1.5 space-y-1">
                                {item.evidence.map((evidence, index) => <div key={index} className="flex gap-2"><span className="text-stone-300">•</span><span>{evidence}</span></div>)}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}

                      <div className="mt-5 flex flex-wrap items-center gap-2">
                        {scriptedId ? (
                          <button
                            onClick={() => onOpenScript?.(scriptedId)}
                            className="h-10 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700"
                          >
                            Open script <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => generateScript(item.id)}
                            disabled={generatingScriptId === item.id}
                            className="h-10 inline-flex items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
                          >
                            {generatingScriptId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {generatingScriptId === item.id ? 'Generating…' : 'Generate script'}
                          </button>
                        )}
                        <button
                          onClick={() => setStatus(item.id, item.status === 'saved' ? 'new' : 'saved')}
                          className={`h-10 inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold ${item.status === 'saved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
                        >
                          <Bookmark className="w-3.5 h-3.5" />{item.status === 'saved' ? 'Saved' : 'Save'}
                        </button>
                        <button
                          onClick={() => setStatus(item.id, 'dismissed')}
                          className="ml-auto h-10 inline-flex items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-stone-400 hover:bg-stone-50 hover:text-stone-700"
                        >
                          <EyeOff className="w-3.5 h-3.5" />Skip
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>}

        {!isLoading && profile && <OnboardingStepper currentStep={step as 1 | 2 | 3} />}

        {interestsEditorOpen && profile && (
          <div className="fixed inset-0 z-[110] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4" onMouseDown={(event) => {
            if (event.currentTarget === event.target && !interestsSaving) setInterestsEditorOpen(false);
          }}>
            <div className="w-full max-w-xl rounded-3xl border border-stone-200 bg-white shadow-2xl p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-stone-950">Edit interests</h3>
                  <p className="mt-1 text-xs text-stone-500">Update what Radar should look for. You will stay in Taste Training.</p>
                </div>
                <button type="button" disabled={interestsSaving} onClick={() => setInterestsEditorOpen(false)} className="p-2 rounded-xl text-stone-400 hover:bg-stone-100 disabled:opacity-40"><X className="w-4 h-4" /></button>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {TOPICS.map(topic => {
                  const selected = draftTopics.includes(topic);
                  return (
                    <button key={topic} type="button" disabled={interestsSaving} onClick={() => setDraftTopics(prev => selected ? prev.filter(value => value !== topic) : [...prev, topic])} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${selected ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}>
                      {selected ? '✓ ' : ''}{topic}
                    </button>
                  );
                })}
              </div>

              {draftTopics.filter(topic => !TOPICS.includes(topic)).length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Custom interests</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draftTopics.filter(topic => !TOPICS.includes(topic)).map(topic => (
                      <button key={topic} type="button" disabled={interestsSaving} onClick={() => setDraftTopics(prev => prev.filter(value => value !== topic))} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-40">
                        {topic} <span className="ml-1 text-emerald-500">×</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 flex gap-2">
                <input
                  value={interestInput}
                  disabled={interestsSaving}
                  onChange={event => setInterestInput(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addDraftTopic(interestInput); } }}
                  placeholder="Add your own interest"
                  className="h-10 flex-1 rounded-xl border border-stone-200 px-3 text-sm outline-none focus:border-emerald-400 disabled:bg-stone-50"
                />
                <button type="button" disabled={!interestInput.trim() || interestsSaving} onClick={() => addDraftTopic(interestInput)} className="h-10 inline-flex items-center gap-1.5 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Add</button>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 border-t border-stone-100 pt-4">
                <button type="button" disabled={interestsSaving} onClick={() => setInterestsEditorOpen(false)} className="h-10 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-700 disabled:opacity-40">Cancel</button>
                <button type="button" disabled={interestsSaving || !draftTopics.length} onClick={() => void saveInterestsFromDiscover()} className="h-10 inline-flex items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white disabled:opacity-40">
                  {interestsSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save interests
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>;
};
