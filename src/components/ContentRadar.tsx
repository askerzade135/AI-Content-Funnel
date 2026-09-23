import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Radio, Sparkles, X, ScanSearch, ExternalLink, Loader2, Bookmark, Eye, EyeOff, MessageCircle, ThumbsUp, ThumbsDown, SkipForward, ArrowRight, ArrowLeft, Tags, Plus, Check, Settings2, ChevronDown, Clock3, SlidersHorizontal, Youtube, MoreHorizontal, Target, TrendingUp, BookmarkPlus, Video, FileText, Link2, RefreshCw } from 'lucide-react';
import { GeneratedScript, RadarDiscoveryRefreshDiagnostics, RadarDiscoveryState, RadarOpportunity, RadarProfile, RadarReferenceSignal, RadarSkipReason, StoredVideo, TrackedChannel } from '../types';
import { authFetch } from '../services/authFetch';
import { useI18n } from '../i18n';

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
  hideSetupHeader?: boolean;
  onOpenMyRadar?: () => void;
  onOpenDiscover?: () => void;
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

const MAX_PARALLEL_SCRIPT_GENERATIONS = 3;


let sharedDiscoveryRefreshPromise: Promise<RadarDiscoveryRefreshDiagnostics> | null = null;

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

const OnboardingProgress: React.FC<{ currentStep: 1 | 2 }> = ({ currentStep }) => {
  const { t } = useI18n();
  return (
  <div className="mx-auto mt-6 max-w-md rounded-2xl border border-stone-200 bg-white px-4 py-3 sm:px-5">
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          currentStep > 1 ? 'bg-emerald-600 text-white' : 'bg-stone-950 text-white'
        }`}>
          {currentStep > 1 ? <Check className="h-3.5 w-3.5" /> : 1}
        </span>
        <span className={`truncate text-[11px] font-semibold ${currentStep === 1 ? 'text-stone-900' : 'text-emerald-700'}`}>{t('radar.setup')}</span>
      </div>
      <div className={`h-px flex-1 ${currentStep > 1 ? 'bg-emerald-400' : 'bg-stone-200'}`} />
      <div className="flex min-w-0 items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
          currentStep === 2 ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-white text-stone-400'
        }`}>2</span>
        <span className={`truncate text-[11px] font-semibold ${currentStep === 2 ? 'text-stone-900' : 'text-stone-400'}`}>{t('radar.tasteTraining')}</span>
      </div>
    </div>
  </div>
  );
};

export const ContentRadar: React.FC<ContentRadarProps> = ({ isOpen, onClose, onOpenAddSource, embedded = false, initialView, initialOpportunityId, onOpenScript, onOnboardingCompleted, hideSetupHeader = false, onOpenMyRadar, onOpenDiscover }) => {
  const { t, locale } = useI18n();
  const [profile, setProfile] = useState<RadarProfile | null>(null);
  const [discovery, setDiscovery] = useState<RadarDiscoveryState | null>(null);
  const [discoveryDiagnostics, setDiscoveryDiagnostics] = useState<RadarDiscoveryRefreshDiagnostics | null>(null);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [canViewDiscoveryDiagnostics, setCanViewDiscoveryDiagnostics] = useState(false);
  const [opportunities, setOpportunities] = useState<RadarOpportunity[]>([]);
  const [view, setView] = useState<'setup' | 'discover' | 'ideas'>('setup');
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackAction, setFeedbackAction] = useState<'interesting' | 'not_interested' | 'pass' | null>(null);
  const [skipReasonOpen, setSkipReasonOpen] = useState(false);
  const [generatingScriptIds, setGeneratingScriptIds] = useState<Set<string>>(() => new Set());
  const [generatedScriptByOpportunity, setGeneratedScriptByOpportunity] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<RadarReferenceSignal[]>([]);
  const [referenceInput, setReferenceInput] = useState('');
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [customAngle, setCustomAngle] = useState('');
  const [customAvoid, setCustomAvoid] = useState('');
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const [showAllSimilar, setShowAllSimilar] = useState(false);
  const [interestsEditorOpen, setInterestsEditorOpen] = useState(false);
  const [draftTopics, setDraftTopics] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState('');
  const [interestsSaving, setInterestsSaving] = useState(false);
  const [ideasFilter, setIdeasFilter] = useState<'all' | 'liked' | 'saved' | 'scripts'>('all');
  const [newIdeasCount, setNewIdeasCount] = useState(0);
  const [ideasSort, setIdeasSort] = useState<'match' | 'newest'>('match');
  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(null);
  const persistedProfileFingerprintRef = useRef('');
  const lastDiscoveryFingerprintRef = useRef('');
  const appliedTasteFingerprintRef = useRef('');

  const loadRadar = async () => {
    setIsLoading(true);
    setError(null);
    setDiscoveryDiagnostics(null);
    setDiagnosticsExpanded(false);
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
      appliedTasteFingerprintRef.current = discoveryFingerprint(profileData, referencesData);
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
  useEffect(() => {
    if (!isOpen || !sharedDiscoveryRefreshPromise) return;
    let active = true;
    setIsDiscovering(true);
    void sharedDiscoveryRefreshPromise
      .then((data) => {
        if (!active || !data?.discovery) return;
        setDiscovery(data.discovery);
        setDiscoveryDiagnostics(data);
      })
      .catch(() => {
        // The original request owner surfaces the error.
      })
      .finally(() => {
        if (active) setIsDiscovering(false);
      });
    return () => { active = false; };
  }, [isOpen]);
  useEffect(() => {
    if (isOpen && initialView && profile?.onboardingCompletedAt) setView(initialView);
  }, [isOpen, initialView]);

  useEffect(() => {
    if (!isOpen || view !== 'ideas' || (discovery?.analysisPendingCount || 0) <= 0) return;
    const timer = window.setInterval(() => {
      void Promise.all([
        authFetch('/api/radar/discovery'),
        authFetch('/api/radar/opportunities'),
      ]).then(async ([d, o]) => {
        if (d.ok) setDiscovery(await d.json());
        if (o.ok) {
          const next = await o.json() as RadarOpportunity[];
          setOpportunities(prev => {
            const previousIds = new Set(prev.map(item => item.id));
            const added = next.filter(item => !previousIds.has(item.id)).length;
            if (added > 0) setNewIdeasCount(count => count + added);
            return next;
          });
        }
      }).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [isOpen, view, discovery?.analysisPendingCount]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void authFetch('/api/admin/discovery-runs?limit=1')
      .then(response => { if (!cancelled) setCanViewDiscoveryDiagnostics(response.ok); })
      .catch(() => { if (!cancelled) setCanViewDiscoveryDiagnostics(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    setError(null);
    if (view !== 'discover') {
      setDiscoveryDiagnostics(null);
      setDiagnosticsExpanded(false);
    }
  }, [view]);

  useEffect(() => {
    setShowAllSimilar(false);
  }, [discovery?.candidates?.[0]?.id]);

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

  const addAvoidItem = () => {
    if (!profile) return;
    const clean = customAvoid.trim();
    if (!clean) return;
    const current = profile.avoid || [];
    if (!current.some(item => item.toLowerCase() === clean.toLowerCase())) {
      setProfile({ ...profile, avoid: [...current, clean].slice(0, 50) });
    }
    setCustomAvoid('');
  };

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 168;
    el.style.height = Math.min(Math.max(el.scrollHeight, 112), maxHeight) + 'px';
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [profile?.description]);

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

    if (!onOpenDiscover) setView('discover');
    setSkipReasonOpen(false);
    setError(null);
    setDiscoveryDiagnostics(null);
    setDiagnosticsExpanded(false);

    if (!options?.forceRefresh && hasCachedCandidates && lastDiscoveryFingerprintRef.current === discoveryFp) {
      if (profileFp !== persistedProfileFingerprintRef.current) await saveProfile(targetProfile);
      onOpenDiscover?.();
      return;
    }

    setIsDiscovering(true);
    setError(null);

    try {
      if (profileFp !== persistedProfileFingerprintRef.current) {
        await saveProfile(targetProfile);
      }

      if (!sharedDiscoveryRefreshPromise) {
        sharedDiscoveryRefreshPromise = (async () => {
          const res = await authFetch('/api/radar/discovery/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ perQuery: 5 }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || 'Не удалось загрузить рекомендации. Попробуй ещё раз.');
          return data as RadarDiscoveryRefreshDiagnostics;
        })().finally(() => {
          sharedDiscoveryRefreshPromise = null;
        });
      }

      const data = await sharedDiscoveryRefreshPromise;
      if (data?.discovery) {
        setDiscovery(data.discovery);
        setDiscoveryDiagnostics(data);
        lastDiscoveryFingerprintRef.current = discoveryFp;
        appliedTasteFingerprintRef.current = discoveryFp;
        onOpenDiscover?.();
      }
    } catch (error: any) {
      console.warn('[Content Radar] discovery refresh failed', error);
      setError(error?.message || 'Не удалось загрузить рекомендации. Попробуй ещё раз.');
    } finally {
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

  const nextRecommendation = async () => {
    const item = discovery?.candidates?.[0];
    if (!item || feedbackBusy) return;

    setFeedbackBusy(true);
    setFeedbackAction('pass');
    setSkipReasonOpen(false);
    setError(null);

    try {
      const [res] = await Promise.all([
        authFetch('/api/radar/discovery-pass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceContentId: item.id }),
        }),
        new Promise(resolve => setTimeout(resolve, 500)),
      ]);
      if (!res.ok) throw new Error('Не удалось перейти к следующей рекомендации');

      const d = await authFetch('/api/radar/discovery');
      if (!d.ok) throw new Error('Не удалось обновить рекомендации');
      const next = await d.json() as RadarDiscoveryState;
      setDiscovery(next);
      setShowAllSimilar(false);

      if (!next.candidates?.length) {
        await startDiscovery({ forceRefresh: true });
      }
    } catch (error: any) {
      setError(error?.message || 'Ошибка перехода к следующей рекомендации');
    } finally {
      setFeedbackAction(null);
      setFeedbackBusy(false);
    }
  };

  const openMyRadar = () => {
    if (onOpenMyRadar) onOpenMyRadar();
    else setView('setup');
  };

  const feedback = async (decision: 'interesting' | 'not_interested', reason?: RadarSkipReason) => {
    const item = discovery?.candidates[0];
    if (!item || feedbackBusy) return;

    setFeedbackBusy(true);
    setFeedbackAction(decision);
    setError(null);

    try {
      const [res] = await Promise.all([
        authFetch('/api/radar/discovery-feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceContentId: item.id, decision, reason }),
        }),
        new Promise(resolve => setTimeout(resolve, 550)),
      ]);
      if (!res.ok) throw new Error('Не удалось сохранить решение');

      const data = await res.json();
      if (data?.expansion?.expanded && data?.expansion?.discovery) {
        setDiscovery(data.expansion.discovery);
      } else {
        const d = await authFetch('/api/radar/discovery');
        if (d.ok) setDiscovery(await d.json());
      }
      setSkipReasonOpen(false);
      setShowAllSimilar(false);
    } catch (error: any) {
      setError(error.message || 'Ошибка сохранения решения');
    } finally {
      setFeedbackAction(null);
      setFeedbackBusy(false);
    }
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
      const createdCount = Array.isArray(data?.opportunities) ? data.opportunities.length : 0;
      if (createdCount > 0) setNewIdeasCount(count => count + createdCount);
      const [o, d] = await Promise.all([
        authFetch('/api/radar/opportunities'),
        authFetch('/api/radar/discovery'),
      ]);
      if (o.ok) setOpportunities(await o.json());
      if (d.ok) setDiscovery(await d.json());
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
    if (generatingScriptIds.has(opportunityId)) return;
    if (generatingScriptIds.size >= MAX_PARALLEL_SCRIPT_GENERATIONS) {
      setError(`Одновременно можно генерировать не больше ${MAX_PARALLEL_SCRIPT_GENERATIONS} сценариев. Дождись завершения одного из них.`);
      return;
    }

    setGeneratingScriptIds(prev => {
      const next = new Set(prev);
      next.add(opportunityId);
      return next;
    });
    setError(null);

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
      setGeneratingScriptIds(prev => {
        const next = new Set(prev);
        next.delete(opportunityId);
        return next;
      });
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
      if (ideasFilter === 'liked') return item.sourceFeedback === 'interesting';
      if (ideasFilter === 'saved') return item.status === 'saved';
      if (ideasFilter === 'scripts') return item.status === 'scripted';
      return true;
    });
    items = [...items].sort((a, b) => ideasSort === 'match'
      ? b.relevance - a.relevance
      : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items;
  }, [visible, ideasFilter, ideasSort]);

  const ideasCounts = useMemo(() => ({
    all: visible.length,
    liked: visible.filter(item => item.sourceFeedback === 'interesting').length,
    saved: visible.filter(item => item.status === 'saved').length,
    scripts: visible.filter(item => item.status === 'scripted').length,
  }), [visible]);

  const topicLabels = [
    t('radar.topic.psychology'), t('radar.topic.parenting'), t('radar.topic.relationships'), t('radar.topic.society'), t('radar.topic.values'),
    t('radar.topic.religion'), t('radar.topic.history'), t('radar.topic.culture'), t('radar.topic.business'), t('radar.topic.technology'),
  ];
  const angleLabels = [
    t('radar.angle.controversial'), t('radar.angle.unexpected'), t('radar.angle.myths'), t('radar.angle.research'),
    t('radar.angle.stories'), t('radar.angle.cultural'), t('radar.angle.opposing'),
  ];
  const topicLabel = (value: string) => {
    const index = TOPICS.indexOf(value);
    return index >= 0 ? topicLabels[index] : value;
  };
  const angleLabel = (value: string) => {
    const index = ANGLES.indexOf(value);
    return index >= 0 ? angleLabels[index] : value;
  };
  const formatLabel = (value: string) => ({
    short_video: t('radar.format.short'),
    long_video_or_podcast: t('radar.format.long'),
    article: t('radar.format.article'),
    post: t('radar.format.post'),
  } as Record<string, string>)[value] || value;
  const goalLabel = (value: string) => ({
    ideas_for_content: t('radar.goal.ideas'),
    learn_deeper: t('radar.goal.learn'),
    follow_trends: t('radar.goal.trends'),
    save_for_later: t('radar.goal.save'),
  } as Record<string, string>)[value] || value;

  const userVisibleDiscoveryIssues = useMemo(
    () => (discoveryDiagnostics?.search || []).filter(item =>
      item.configured &&
      Boolean(item.error) &&
      item.found === 0 &&
      !item.recovered
    ),
    [discoveryDiagnostics]
  );
  if (!isOpen) return null;

  return <div className={embedded ? "w-full" : "fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"}>
    <div className={embedded ? "w-full" : "w-full max-w-6xl max-h-[92vh] overflow-hidden bg-white rounded-3xl shadow-2xl border border-stone-200 flex flex-col"}>
      {!embedded && <div className="px-5 sm:px-7 py-5 border-b border-stone-200 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2"><Radio className="w-5 h-5 text-emerald-600"/><h2 className="font-bold">{t('radar.contentRadar')}</h2></div>
          <div className="text-xs text-stone-500 mt-1">{profile?.onboardingCompletedAt ? t('radar.contentRadar') : `${t('radar.setup')} · ${view === 'setup' ? t('radar.setup') : t('radar.tasteTraining')}`}</div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-stone-100"><X className="w-5 h-5"/></button>
      </div>}

      <div className={embedded ? "" : "overflow-y-auto p-5 sm:p-7"}>
        {error && <div role="alert" className="mb-4 text-sm text-rose-600">{error}{!profile && <button onClick={loadRadar} className="ml-3 underline">{t('radar.retry')}</button>}</div>}
        {view === 'discover' && discoveryDiagnostics && userVisibleDiscoveryIssues.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div><b>{t('radar.partialSources')}</b> {t('radar.availableSources')}</div>
                {canViewDiscoveryDiagnostics && (
                  <button
                    type="button"
                    onClick={() => setDiagnosticsExpanded(value => !value)}
                    className="mt-1.5 text-[11px] font-semibold text-amber-800 underline underline-offset-2"
                  >
                    {diagnosticsExpanded ? 'Hide diagnostics' : 'View diagnostics'}
                  </button>
                )}
              </div>
            </div>

            {canViewDiscoveryDiagnostics && diagnosticsExpanded && (
              <div className="mt-3 rounded-lg border border-amber-200/80 bg-white/70 p-3 text-[11px] text-stone-700">
                <div className="font-bold text-stone-900">{t('radar.latestRefresh')}</div>

                <div className="mt-2">
                  <span className="font-semibold">{t('radar.discoveryPlan')}:</span>{' '}
                  {discoveryDiagnostics.queryGeneration.source}
                  {discoveryDiagnostics.queryGeneration.provider ? ` · ${discoveryDiagnostics.queryGeneration.provider}` : ''}
                  {discoveryDiagnostics.queryGeneration.model ? ` / ${discoveryDiagnostics.queryGeneration.model}` : ''}
                </div>
                {discoveryDiagnostics.queryGeneration.error && (
                  <div className="mt-1 break-words text-stone-500">
                    Plan fallback reason: {discoveryDiagnostics.queryGeneration.error}
                  </div>
                )}

                <div className="mt-3 space-y-2">
                  {discoveryDiagnostics.search
                    .filter(item => item.error || item.recovered || (item.configured && item.found === 0))
                    .map((item, index) => (
                      <div key={`${item.sourceType}-${item.query}-${index}`} className="rounded-lg border border-stone-200 bg-white px-2.5 py-2">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold text-stone-900">{item.sourceType}</span>
                          <span className="text-stone-400">provider: {item.provider}</span>
                          <span className={item.recovered ? 'text-emerald-700' : item.error && item.found === 0 ? 'text-rose-600' : 'text-stone-500'}>
                            {item.recovered ? 'recovered by fallback' : item.error && item.found === 0 ? 'failed' : 'degraded'}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-stone-500">Query: {item.query}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-stone-500">
                          <span>found: {item.found}</span>
                          <span>added: {item.added}</span>
                          {typeof item.durationMs === 'number' && <span>{item.durationMs} ms</span>}
                        </div>
                        {item.reasonCode && <div className="mt-1"><span className="font-semibold">{t('radar.reason')}:</span> {item.reasonCode}</div>}
                        {item.primaryProvider && <div className="mt-1">Primary: {item.primaryProvider}</div>}
                        {item.fallbackProvider && <div className="mt-1">Fallback: {item.fallbackProvider}</div>}
                        {item.error && <div className="mt-1 break-words text-stone-500">{item.error}</div>}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
        {isLoading || (!profile && !error) ? <div className="min-h-[420px] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin"/></div> : null}


        {!isLoading && profile && view === 'setup' && (() => {
          const currentTasteFingerprint = discoveryFingerprint(profile, references);
          const hasPendingTasteChanges = Boolean(
            profile.onboardingCompletedAt &&
            currentTasteFingerprint !== appliedTasteFingerprintRef.current
          );
          return (
          <div className="mx-auto w-full max-w-[1320px]">
            {!hideSetupHeader && (
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">{t('radar.personalization')}</div>
                  <h2 className="mt-1 text-3xl font-bold tracking-tight text-stone-950">{t('radar.customize')}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
                    {t('radar.customizeHint')}
                    {profile.onboardingCompletedAt ? ' ' + t('radar.historyIntact') : ''}
                  </p>
                </div>
                <div className="rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-semibold text-stone-500">{t('radar.onlyTopicsRequired')}</div>
              </div>
            )}

            {error && <div className="mb-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
              <div className="contents">
                <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_30px_rgba(28,25,23,0.025)] order-1 h-full lg:col-start-1 lg:row-start-1">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-bold text-stone-950">{t('radar.topicsTitle')}</h3>
                      <p className="mt-1 text-xs text-stone-500">{t('radar.topicsHint')}</p>
                    </div>
                    <span className="text-[11px] font-medium text-stone-400">{t('radar.required')}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TOPICS.map(topic => {
                      const selected = (profile.topics || []).includes(topic);
                      return (
                        <button key={topicLabel(topic)} type="button" onClick={() => toggle('topics', topic)}
                          className={selected ? 'min-h-11 rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm' : 'min-h-11 rounded-xl border border-stone-200 bg-white px-4 py-2 text-[13px] font-semibold text-stone-700 transition hover:border-stone-300 hover:bg-stone-50'}>
                          {topicLabel(topic)}
                        </button>
                      );
                    })}
                    {(profile.topics || []).filter(topic => !TOPICS.includes(topic)).map(topic => (
                      <button key={topicLabel(topic)} type="button" onClick={() => toggle('topics', topic)} className="min-h-11 rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white">
                        {topicLabel(topic)} ×
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input value={customTopic} onChange={event => setCustomTopic(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomValue('topics', customTopic); } }}
                      placeholder={t('radar.addTopic')}
                      className="h-11 min-w-0 flex-1 rounded-xl border border-stone-200 px-3.5 text-[13px] outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                    <button type="button" disabled={!customTopic.trim()} onClick={() => addCustomValue('topics', customTopic)} className="h-11 rounded-xl border border-stone-200 px-4 text-[13px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40">{t('radar.addTopic')}</button>
                  </div>
                </section>

                <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_30px_rgba(28,25,23,0.025)] order-3 h-full lg:col-start-1 lg:row-start-2">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-bold text-stone-950">{t('radar.anglesTitle')}</h3>
                      <p className="mt-1 text-xs text-stone-500">{t('radar.anglesHint')}</p>
                    </div>
                    <span className="text-[11px] font-medium text-stone-400">{t('radar.selectMultiple')}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ANGLES.map(angle => {
                      const selected = (profile.preferredAngles || []).includes(angle);
                      return (
                        <button key={angleLabel(angle)} type="button" onClick={() => toggle('preferredAngles', angle)}
                          className={selected ? 'min-h-11 rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white' : 'min-h-11 rounded-xl border border-stone-200 bg-white px-4 py-2 text-[13px] font-semibold text-stone-700 transition hover:border-stone-300 hover:bg-stone-50'}>
                          {angleLabel(angle)}
                        </button>
                      );
                    })}
                    {(profile.preferredAngles || []).filter(angle => !ANGLES.includes(angle)).map(angle => (
                      <button key={angleLabel(angle)} type="button" onClick={() => toggle('preferredAngles', angle)} className="min-h-11 rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white">
                        {angleLabel(angle)} ×
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input value={customAngle} onChange={event => setCustomAngle(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomValue('preferredAngles', customAngle); } }}
                      placeholder={t('radar.addAngle')}
                      className="h-11 min-w-0 flex-1 rounded-xl border border-stone-200 px-3.5 text-[13px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                    <button type="button" disabled={!customAngle.trim()} onClick={() => addCustomValue('preferredAngles', customAngle)} className="h-11 rounded-xl border border-stone-200 px-4 text-[13px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40">{t('radar.addAngle')}</button>
                  </div>
                </section>

                <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_30px_rgba(28,25,23,0.025)] order-4 h-full lg:col-start-2 lg:row-start-2">
                  <div className="mb-4">
                    <h3 className="text-[15px] font-bold text-stone-950">{t('radar.formatsTitle')}</h3>
                    <p className="mt-1 text-xs text-stone-500">{t('radar.formatsHint')}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CONTENT_FORMATS.map((item, index) => {
                      const selected = (profile.contentFormats || []).includes(item.value);
                      const icon = index < 2 ? <Video className="h-4 w-4" /> : <FileText className="h-4 w-4" />;
                      return (
                        <button key={item.value} type="button" onClick={() => toggleProfileList('contentFormats', item.value)}
                          className={selected ? 'min-h-[72px] rounded-2xl border border-emerald-500 bg-emerald-50 p-3.5 text-left ring-1 ring-emerald-100' : 'min-h-[72px] rounded-2xl border border-stone-200 bg-white p-3.5 text-left transition hover:border-stone-300'}>
                          <div className="flex items-start gap-3">
                            <span className={selected ? 'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white' : 'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500'}>{icon}</span>
                            <div>
                              <div className="text-[13px] font-bold text-stone-900">{item.label}</div>
                              <div className="mt-1 text-[11px] text-stone-500">{item.hint}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_30px_rgba(28,25,23,0.025)] order-6 h-full lg:col-start-2 lg:row-start-3">
                  <div className="mb-4">
                    <h3 className="text-[15px] font-bold text-stone-950">{t('radar.avoidTitle')}</h3>
                    <p className="mt-1 text-xs text-stone-500">{t('radar.avoidHint')}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(profile.avoid || []).map(item => (
                      <button key={item} type="button" onClick={() => setProfile({ ...profile, avoid: (profile.avoid || []).filter(value => value !== item) })} className="min-h-10 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[12px] font-medium text-stone-700 hover:bg-stone-100">
                        {item} ×
                      </button>
                    ))}
                    {(profile.avoid || []).length === 0 && <span className="text-xs text-stone-400">{t('radar.nothingExcluded')}</span>}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input value={customAvoid} onChange={event => setCustomAvoid(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addAvoidItem(); } }}
                      placeholder="Add content to avoid"
                      className="h-11 min-w-0 flex-1 rounded-xl border border-stone-200 px-3.5 text-[13px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                    <button type="button" disabled={!customAvoid.trim()} onClick={addAvoidItem} className="h-11 rounded-xl border border-stone-200 px-4 text-[13px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40">{t('radar.add')}</button>
                  </div>
                </section>
              </div>

              <div className="contents">
                <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_30px_rgba(28,25,23,0.025)] order-2 h-full lg:col-start-2 lg:row-start-1">
                  <div className="mb-4">
                    <h3 className="text-[15px] font-bold text-stone-950">{t('radar.goalsTitle')}</h3>
                    <p className="mt-1 text-xs text-stone-500">{t('radar.goalsHint')}</p>
                  </div>
                  <div className="space-y-2">
                    {GOALS.map((item, index) => {
                      const selected = (profile.goals || []).includes(item.value);
                      const icons = [<Target className="h-4 w-4" />, <Sparkles className="h-4 w-4" />, <TrendingUp className="h-4 w-4" />, <BookmarkPlus className="h-4 w-4" />];
                      return (
                        <button key={item.value} type="button" onClick={() => toggleProfileList('goals', item.value)}
                          className={selected ? 'flex min-h-[62px] w-full items-center gap-3 rounded-2xl border border-emerald-500 bg-emerald-50 px-4 py-3 text-left ring-1 ring-emerald-100' : 'flex min-h-[62px] w-full items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left transition hover:border-stone-300'}>
                          <span className={selected ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white' : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500'}>{icons[index]}</span>
                          <div className="text-[13px] font-bold text-stone-900">{item.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_30px_rgba(28,25,23,0.025)] order-5 h-full lg:col-start-1 lg:row-start-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-bold text-stone-950">{t('radar.notesTitle')}</h3>
                      <p className="mt-1 text-xs text-stone-500">{t('radar.notesHint')}</p>
                    </div>
                    <span className="text-[11px] text-stone-400">{(profile.description || '').length} / 4000</span>
                  </div>
                  <textarea ref={descriptionRef} value={profile.description || ''}
                    onChange={event => setProfile({ ...profile, description: event.target.value })}
                    rows={5} maxLength={4000}
                    placeholder={t('radar.notesPlaceholder')}
                    className="min-h-[112px] w-full resize-none rounded-2xl border border-stone-200 bg-white px-4 py-3 text-[13px] leading-6 text-stone-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                </section>

                <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_30px_rgba(28,25,23,0.025)] order-7 h-full lg:col-span-2 lg:row-start-4">
                  <div className="mb-4">
                    <h3 className="text-[15px] font-bold text-stone-950">{t('radar.referencesTitle')} <span className="font-medium text-stone-400">({t('radar.optional')})</span></h3>
                    <p className="mt-1 text-xs text-stone-500">{t('radar.referencesHint')}</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-0 flex-1">
                      <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                      <input value={referenceInput} onChange={event => setReferenceInput(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addReference(); } }}
                        disabled={referenceBusy || references.length >= 3}
                        placeholder="https://youtube.com/..."
                        className="h-11 w-full rounded-xl border border-stone-200 pl-10 pr-3 text-[13px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-50" />
                    </div>
                    <button type="button" onClick={() => void addReference()} disabled={!referenceInput.trim() || referenceBusy || references.length >= 3} className="h-11 rounded-xl bg-stone-950 px-4 text-[13px] font-semibold text-white disabled:opacity-40">
                      {referenceBusy ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {references.map(ref => (
                      <div key={ref.id} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-3.5 py-3">
                        <Link2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-semibold text-stone-800">{ref.title || ref.value}</div>
                          <div className="mt-0.5 truncate text-[10px] text-stone-400">{ref.value}</div>
                        </div>
                      </div>
                    ))}
                    {references.length === 0 && <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-5 text-center text-xs text-stone-400">{t('radar.noReferences')}</div>}
                  </div>
                  <div className="mt-2 text-right text-[10px] text-stone-400">{references.length} / 3 references</div>
                </section>
              </div>
            </div>

            {!profile.onboardingCompletedAt && (
              <div className="mt-6 flex justify-end border-t border-stone-200 pt-4">
                <button
                  type="button"
                  disabled={isDiscovering || !(profile.topics || []).length}
                  onClick={() => void startDiscovery({ forceRefresh: false })}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-stone-950 px-6 text-[13px] font-semibold text-white shadow-sm hover:bg-stone-800 disabled:opacity-40"
                >
                  {isDiscovering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('radar.startTasteTraining')}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {(hasPendingTasteChanges || isDiscovering) && profile.onboardingCompletedAt && (
              <div className="pointer-events-none fixed inset-x-3 bottom-3 z-40 sm:inset-x-auto sm:bottom-5 sm:right-5 lg:right-7">
                <div className="pointer-events-auto mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border border-stone-200 bg-white/95 p-3.5 shadow-[0_18px_55px_rgba(28,25,23,0.18)] backdrop-blur sm:min-w-[440px] sm:flex-row sm:items-center sm:justify-between sm:p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-bold text-stone-950">
                      {isDiscovering ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : <Sparkles className="h-4 w-4 text-emerald-600" />}
                      <span>{isDiscovering ? t('radar.updatingRecommendations') : t('radar.pendingChangesTitle')}</span>
                    </div>
                    {!isDiscovering && <p className="mt-1 text-[11px] leading-5 text-stone-500">{t('radar.pendingChangesHint')}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={isDiscovering || !(profile.topics || []).length}
                    onClick={() => void startDiscovery({ forceRefresh: true })}
                    className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white shadow-sm hover:bg-stone-800 disabled:opacity-50"
                  >
                    {isDiscovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isDiscovering ? t('radar.updatingRecommendations') : t('radar.updateRecommendations')}
                    {!isDiscovering && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {!isLoading && profile && view === 'discover' && <div className="max-w-[1360px] mx-auto">
          {(() => {
            const feedbackCount = discovery?.feedbackCount || 0;
            const minimumSignals = discovery?.minimumSignals || 5;
            const trainingComplete = feedbackCount >= minimumSignals;
            const item = discovery?.candidates?.[0];
            const relatedCandidates = (discovery?.candidates || []).slice(1, 11);
            const nextCandidates = showAllSimilar ? relatedCandidates : relatedCandidates.slice(0, 3);
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
            const formatMetric = (value?: number) => {
              if (typeof value !== 'number' || !Number.isFinite(value)) return null;
              return Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { notation: value >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
            };
            const sourceName = item
              ? (item.sourceLabel || (item.sourceType === 'youtube' ? 'YouTube' : item.sourceType === 'x' ? 'X' : item.sourceType === 'web' ? 'Web' : 'Manual'))
              : '';
            const preview = item?.imageUrl || item?.thumbnail;
            const author = decodeHtmlEntities(item?.author || item?.channelTitle || '');
            const title = decodeHtmlEntities(item?.title || '');

            return <>
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-[30px] leading-none font-bold tracking-tight text-stone-950">{t('radar.discover')}</h2>
                  <p className="mt-1 text-sm text-stone-500">{t('radar.discoverHint')}</p>
                </div>

                <div className="flex w-full flex-wrap items-center gap-2.5 lg:w-auto lg:justify-end">
                  {!profile.onboardingCompletedAt && (
                    <>
                      <div className="mr-auto min-w-[145px] flex-1 px-1 sm:flex-none sm:px-2 xl:mr-0">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-semibold text-stone-700">{t('radar.tasteTraining')}</span>
                          <span className="font-bold text-stone-950">{Math.min(feedbackCount, minimumSignals)} / {minimumSignals}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (feedbackCount / minimumSignals) * 100)}%` }} />
                        </div>
                      </div>
                      <button type="button" disabled={isDiscovering} onClick={() => setView('setup')} className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                        <ArrowLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t('radar.back')}</span>
                      </button>
                    </>
                  )}
                  {item && (
                    <button
                      type="button"
                      disabled={isDiscovering}
                      onClick={() => void startDiscovery({ forceRefresh: true })}
                      className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                      title={t('radar.refreshRecommendations')}
                      aria-label={t('radar.refreshRecommendations')}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isDiscovering ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  {onOpenAddSource && <button type="button" disabled={isDiscovering} onClick={onOpenAddSource} className="h-10 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40 sm:px-4">
                    <Sparkles className="w-3.5 h-3.5" /> <span>{t('radar.addSource')}</span>
                  </button>}
                </div>
              </div>

              {trainingComplete && !profile.onboardingCompletedAt && (
                <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-bold text-emerald-950">{t('radar.ready')}</div>
                      <p className="mt-1 text-xs leading-5 text-emerald-800">{t('radar.readyHint', { count: minimumSignals })}</p>
                    </div>
                    <div className="flex flex-col gap-2 xs:flex-row sm:flex-row">
                      <button onClick={() => void startDiscovery({ forceRefresh: true })} disabled={isDiscovering} className="h-10 rounded-xl border border-emerald-300 bg-white px-3.5 text-xs font-semibold text-emerald-800 disabled:opacity-50">{t('radar.keepTraining')}</button>
                      <button onClick={completeLearning} className="h-10 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white">{t('radar.viewIdeas')}</button>
                    </div>
                  </div>
                </div>
              )}

              {isDiscovering ? (
                <div className="rounded-[28px] border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/40 to-white px-5 py-10 sm:px-8 sm:py-14">
                  <div className="mx-auto max-w-3xl text-center">
                    <div className="relative mx-auto flex h-28 w-28 items-center justify-center">
                      <span className="absolute inset-2 rounded-full border border-emerald-200/80 animate-ping [animation-duration:2.4s]" />
                      <span className="absolute inset-5 rounded-full border border-emerald-300/80 animate-ping [animation-duration:2.4s] [animation-delay:400ms]" />
                      <span className="absolute inset-8 rounded-full bg-emerald-100/80 animate-pulse" />
                      <ScanSearch className="relative z-10 h-8 w-8 text-emerald-700" />
                      <span className="absolute right-1 top-4 h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.10)] animate-pulse" />
                    </div>

                    <h3 className="mt-4 text-xl font-bold tracking-tight text-stone-950 sm:text-2xl">{t('radar.searchingTitle')}</h3>
                    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-stone-500">{t('radar.searchingHint')}</p>

                    <div className="mx-auto mt-7 grid max-w-2xl gap-2.5 text-left sm:grid-cols-3">
                      {[
                        [Radio, t('radar.searchStepSources')],
                        [Target, t('radar.searchStepFilter')],
                        [Sparkles, t('radar.searchStepRank')],
                      ].map(([Icon, label], index) => {
                        const StepIcon = Icon as React.ComponentType<{ className?: string }>;
                        return (
                          <div key={String(label)} className="flex items-center gap-3 rounded-2xl border border-stone-200/80 bg-white/90 px-3.5 py-3 shadow-sm">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 animate-pulse ${index === 1 ? '[animation-delay:350ms]' : index === 2 ? '[animation-delay:700ms]' : ''}`}>
                              <StepIcon className="h-4 w-4" />
                            </span>
                            <span className="text-xs font-semibold leading-4 text-stone-700">{label}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mx-auto mt-6 h-1.5 max-w-md overflow-hidden rounded-full bg-stone-100">
                      <div className="h-full w-1/3 rounded-full bg-emerald-500 animate-[pulse_1.5s_ease-in-out_infinite]" />
                    </div>
                    <div className="mt-3 text-[11px] text-stone-400">{t('radar.searchingHint')}</div>
                  </div>
                </div>
              ) : item ? (
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_310px] xl:gap-5">
                  <article className={`rounded-[24px] border border-stone-200 bg-white shadow-[0_8px_28px_rgba(28,25,23,0.04)] overflow-hidden transition-all duration-300 ${feedbackAction ? 'scale-[0.995] opacity-90' : ''}`}>
                    <div className="p-4 sm:p-5">
                      <div className="grid items-start gap-5 lg:grid-cols-[minmax(360px,52%)_minmax(0,1fr)] lg:gap-6">
                        <div className="relative overflow-hidden rounded-[20px] bg-stone-950 aspect-video self-start shadow-[0_10px_24px_rgba(28,25,23,0.08)]">
                          {preview ? <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover object-center"/> : (
                            <div className="h-full flex items-center justify-center text-stone-400"><Radio className="w-8 h-8"/></div>
                          )}
                          <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/35 to-transparent pointer-events-none" />
                          <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                            <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-stone-900 shadow-sm">{sourceName}</span>
                            {displayTags.slice(0,2).map(topic => <span key={topicLabel(topic)} className="rounded-full bg-stone-950/80 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">{topicLabel(decodeHtmlEntities(topic))}</span>)}
                            {keyTopics.length > 2 && <span className="rounded-full bg-stone-950/80 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">+{keyTopics.length - 2}</span>}
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-col py-1 lg:py-2">
                        <div className="flex justify-end">
                          <a href={item.url} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700" title={t('radar.openSource')}><ExternalLink className="w-4 h-4"/></a>
                        </div>

                        <h3 className="-mt-1 pr-7 text-[19px] font-bold leading-[1.35] text-stone-950 line-clamp-3">{title}</h3>
                        {author && <div className="mt-3 text-[13px] font-semibold text-stone-700">{author}</div>}
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-400">
                          {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span>}
                        </div>

                        {(typeof item.viewCount === 'number' || typeof item.likeCount === 'number' || typeof item.commentCount === 'number') && (
                          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-stone-500">
                            {typeof item.viewCount === 'number' && <span className="inline-flex items-center gap-1.5"><Eye className="w-3.5 h-3.5"/>{formatMetric(item.viewCount)} {t('radar.views')}</span>}
                            {typeof item.likeCount === 'number' && <span className="inline-flex items-center gap-1.5"><ThumbsUp className="w-3.5 h-3.5"/>{formatMetric(item.likeCount)}</span>}
                            {typeof item.commentCount === 'number' && <span className="inline-flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5"/>{formatMetric(item.commentCount)}</span>}
                          </div>
                        )}


                        </div>
                      </div>

                    </div>

                    <div className="grid gap-4 px-5 pb-5 pt-1 lg:grid-cols-[minmax(0,1.85fr)_minmax(220px,.75fr)]">
                      <section className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="inline-flex items-center gap-2 text-sm font-bold text-emerald-950"><Sparkles className="w-4 h-4 text-emerald-600" />{t('radar.whyMatch')}</div>
                          {typeof item.rankingScore === 'number' && <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700">{item.rankingScore}% {t('radar.match')}</span>}
                        </div>
                        <div className="mt-3 space-y-2">
                          {(item.rankingReason ? item.rankingReason.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0,3) : [
                            t('radar.defaultReason')
                          ]).map((reason, index) => (
                            <div key={index} className="flex items-start gap-2 text-xs leading-5 text-emerald-950">
                              <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">✓</span>
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                        <div className="inline-flex items-center gap-2 text-sm font-bold text-stone-900"><Tags className="w-4 h-4 text-stone-500" />{t('radar.keyTopics')}</div>
                        {keyTopics.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {keyTopics.map(topic => (
                              <span key={topicLabel(topic)} className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-700">
                                <Tags className="h-3.5 w-3.5 text-stone-400" />
                                <span>{topicLabel(decodeHtmlEntities(topic))}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 space-y-2">
                            <div className="h-3 w-4/5 rounded bg-stone-200 animate-pulse" />
                            <div className="h-3 w-3/5 rounded bg-stone-200 animate-pulse" />
                            <div className="text-[10px] text-stone-400">{t('radar.topicsAfterRefresh')}</div>
                          </div>
                        )}
                      </section>
                    </div>

                    <div className="border-t border-stone-100 p-4 sm:p-5">
                      {feedbackAction ? (
                        <div className={`flex min-h-14 items-center justify-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${feedbackAction === 'interesting' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : feedbackAction === 'not_interested' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-stone-200 bg-stone-50 text-stone-700'}`}>
                          {feedbackAction === 'pass' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                          <span>{feedbackAction === 'interesting'
                            ? (locale === 'ru' ? '✓ Учтено — Radar обновляет ваши интересы' : '✓ Got it — Radar is updating your interests')
                            : feedbackAction === 'not_interested'
                              ? (locale === 'ru' ? '✓ Учтено — похожее будет показываться реже' : '✓ Got it — similar content will be shown less often')
                              : t('radar.feedbackPassing')}</span>
                        </div>
                      ) : skipReasonOpen ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm font-bold text-stone-950">{t('radar.notInterestedTitle')}</div>
                              <p className="mt-1 text-xs leading-5 text-stone-600">{t('radar.notInterestedHint')}</p>
                            </div>
                            <button type="button" onClick={() => setSkipReasonOpen(false)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 hover:bg-white hover:text-stone-700">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {[
                              ['too_generic', t('radar.skipGeneric')],
                              ['not_my_topic', t('radar.skipTopic')],
                              ['wrong_style', t('radar.skipStyle')],
                              ['too_shallow', t('radar.skipShallow')],
                              ['seen_before', t('radar.skipSeen')],
                            ].map(([value,label]) => (
                              <button key={value} disabled={feedbackBusy} onClick={() => feedback('not_interested', value as RadarSkipReason)} className="min-h-10 rounded-xl border border-rose-100 bg-white px-3 py-2 text-left text-xs font-semibold text-stone-700 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50">
                                {label}
                              </button>
                            ))}
                          </div>
                          <button disabled={feedbackBusy} onClick={() => feedback('not_interested')} className="mt-3 text-xs font-semibold text-stone-500 hover:text-stone-800 disabled:opacity-50">{t('radar.justNotInterested')}</button>
                        </div>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <button disabled={feedbackBusy || isDiscovering} onClick={() => feedback('interesting')} className="h-12 inline-flex justify-center items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 sm:h-14">
                            <ThumbsUp className="w-4 h-4"/> {t('radar.interested')}
                          </button>
                          <button onClick={() => setSkipReasonOpen(true)} disabled={feedbackBusy || isDiscovering} className="h-12 inline-flex justify-center items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50 sm:h-14">
                            <ThumbsDown className="w-4 h-4"/> {t('radar.notInterested')}
                          </button>
                          <button onClick={() => void nextRecommendation()} disabled={feedbackBusy || isDiscovering} className="h-12 inline-flex justify-center items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50 sm:h-14">
                            <SkipForward className="w-4 h-4"/> {t('radar.nextRecommendation')}
                          </button>
                        </div>
                      )}

                      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-emerald-950">{t('radar.notSuitable')}</div>
                          <div className="mt-1 text-[11px] leading-5 text-emerald-800">{t('radar.improveHint')}</div>
                        </div>
                        <button type="button" onClick={openMyRadar} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-3.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">
                          <Sparkles className="h-3.5 w-3.5" /> {t('radar.improveRecommendations')}
                        </button>
                      </div>
                    </div>
                  </article>

                  <aside className="space-y-3 xl:pt-0">
                    <section className="rounded-2xl border border-stone-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-bold text-stone-900">{t('radar.yourInterests')}</h4>
                        <button disabled={isDiscovering} onClick={openMyRadar} className="text-xs font-semibold text-emerald-700 disabled:opacity-40">{t('radar.customizeShort')}</button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(profile.topics || []).slice(0,8).map(topic => <span key={topicLabel(topic)} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-medium text-stone-700">{topicLabel(topic)}</span>)}
                        <button disabled={isDiscovering} onClick={openInterestsEditor} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-40">{t('radar.addInterest')}</button>
                      </div>
                    </section>

                    {!trainingComplete && <section className="rounded-2xl border border-violet-100 bg-violet-50 p-4">
                      <div className="text-sm font-bold text-violet-900">{t('radar.tip')}</div>
                      <p className="mt-2 text-xs leading-5 text-violet-800">{t('radar.trainingTip', { count: minimumSignals })}</p>
                    </section>}

                    {relatedCandidates.length > 0 && <section className="rounded-2xl border border-stone-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-bold text-stone-900">{t('radar.similarContent')}</div>
                        {relatedCandidates.length > 3 && (
                          <button type="button" onClick={() => setShowAllSimilar(value => !value)} className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800">
                            {showAllSimilar ? t('radar.collapse') : t('radar.showAll')}
                          </button>
                        )}
                      </div>
                      <div className="mt-3 space-y-3">
                        {nextCandidates.map(candidate => (
                          <a key={candidate.id} href={candidate.url} target="_blank" rel="noreferrer" className="group flex gap-3">
                            {(candidate.imageUrl || candidate.thumbnail) ? <img src={candidate.imageUrl || candidate.thumbnail} alt="" className="h-16 w-24 shrink-0 rounded-lg bg-stone-100 object-cover sm:w-28"/> : <div className="h-16 w-24 shrink-0 rounded-lg bg-stone-100 sm:w-28"/>}
                            <div className="min-w-0">
                              <div className="line-clamp-2 text-xs font-semibold leading-4 text-stone-800 group-hover:text-emerald-700">{decodeHtmlEntities(candidate.title)}</div>
                              <div className="mt-1 line-clamp-1 text-[10px] text-stone-400">{decodeHtmlEntities(candidate.author || candidate.channelTitle || candidate.sourceLabel || candidate.sourceType)}</div>
                            </div>
                          </a>
                        ))}
                      </div>
                    </section>}
                  </aside>
                </div>
              ) : (
                <div className="rounded-[28px] border border-stone-200 bg-white px-5 py-12 text-center shadow-[0_8px_30px_rgba(28,25,23,0.03)] sm:px-8 sm:py-16">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                    <ScanSearch className="h-7 w-7" />
                  </div>
                  <div className="mt-5 text-lg font-bold text-stone-950">{t('radar.emptyTitle')}</div>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-stone-500">{t('radar.emptyHint')}</p>

                  {(profile.topics || []).length > 0 && (
                    <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
                      {(profile.topics || []).slice(0, 6).map(topic => (
                        <span key={topic} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-medium text-stone-600">
                          {topicLabel(topic)}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
                    <button onClick={() => void startDiscovery({ forceRefresh: true })} disabled={isDiscovering} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-stone-950 px-5 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50">
                      <ScanSearch className="h-4 w-4" /> {t('radar.findRecommendations')}
                    </button>
                    <button onClick={openMyRadar} disabled={isDiscovering} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                      <Sparkles className="h-4 w-4 text-emerald-600" /> {t('radar.improveRecommendations')}
                    </button>
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
                  <h2 className="text-[30px] leading-none font-bold tracking-tight text-stone-950">{t('radar.ideas')}</h2>
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-500">{visible.length}</span>
                </div>
                <p className="mt-2 text-sm text-stone-500">{t('radar.ideasHint')}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-stone-200 bg-white p-1">
                  {([
                    ['all', locale === 'ru' ? 'Все идеи' : 'All ideas'],
                    ['liked', locale === 'ru' ? 'Из понравившихся' : 'From liked videos'],
                    ['saved', locale === 'ru' ? 'Сохранённые' : 'Saved'],
                    ['scripts', locale === 'ru' ? 'Сценарии' : 'Scripts'],
                  ] as const).map(([filter, label]) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setIdeasFilter(filter)}
                      className={`h-8 rounded-lg px-3 text-[11px] font-semibold transition ${ideasFilter === filter ? 'bg-stone-950 text-white' : 'text-stone-500 hover:bg-stone-50'}`}
                    >
                      {label} <span className="ml-1 opacity-60">{ideasCounts[filter]}</span>
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
                    <option value="match">{t('radar.sortMatch')}</option>
                    <option value="newest">{t('radar.sortNewest')}</option>
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
                <span className="text-xs text-stone-500">{discovery?.interestingCount || 0} interested</span>
                <span className="text-stone-300">·</span>
                <span className="text-xs text-stone-500">{discovery?.notInterestedCount || 0} not interested</span>
                <span className="text-stone-300">·</span>
                <span className="text-xs text-stone-500">{discovery?.skipCount || 0} skipped</span>
                {(isScanning || (discovery?.analysisProcessingCount || 0) > 0) && <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><Loader2 className="w-3.5 h-3.5 animate-spin" />{locale === 'ru' ? `Анализируем ${Math.max(1, discovery?.analysisProcessingCount || 0)} понравившихся видео…` : `Analyzing ${Math.max(1, discovery?.analysisProcessingCount || 0)} liked videos…`}</span>}
                {(discovery?.analysisWaitingCount || 0) > 0 && (discovery?.analysisProcessingCount || 0) === 0 && !isScanning && <span className="text-xs font-semibold text-amber-700">{locale === 'ru' ? `${discovery?.analysisWaitingCount} видео ожидают Radar Analysis` : `${discovery?.analysisWaitingCount} videos are waiting for Radar Analysis`}</span>}
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

            {newIdeasCount > 0 && (
              <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-bold text-emerald-950">
                    {locale === 'ru' ? `${newIdeasCount} новых идей из ваших интересов` : `${newIdeasCount} new ideas from your interests`}
                  </div>
                  <div className="mt-0.5 text-xs text-emerald-800">
                    {locale === 'ru' ? 'Radar закончил анализ понравившегося контента.' : 'Radar finished analyzing your liked content.'}
                  </div>
                </div>
                <button type="button" onClick={() => { setIdeasFilter('liked'); setNewIdeasCount(0); }} className="h-9 rounded-xl bg-emerald-700 px-3.5 text-xs font-semibold text-white hover:bg-emerald-800">
                  {locale === 'ru' ? 'Посмотреть новые идеи' : 'View new ideas'}
                </button>
              </div>
            )}

            {error && <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

            {visible.length === 0 ? (
              <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
                {isScanning ? (
                  <>
                    <div className="flex items-center gap-2 text-sm font-semibold text-stone-800"><Loader2 className="w-4 h-4 animate-spin text-emerald-600" />{t('radar.analyzingSelected')}</div>
                    <div className="mt-1 text-xs text-stone-500">{t('radar.analyzingHint')}</div>
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
                        <div className="text-sm font-bold text-stone-900">{t('radar.noIdeas')}</div>
                        <div className="mt-1 text-xs leading-5 text-stone-500">{t('radar.noIdeasHint')}</div>
                      </div>
                    </div>
                    <button onClick={() => scan(false)} className="h-10 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white">{t('radar.refreshRadar')}</button>
                  </div>
                )}
              </section>
            ) : filteredIdeas.length === 0 ? (
              <section className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
                <div className="text-sm font-bold text-stone-900">{t('radar.nothingFilter')}</div>
                <div className="mt-1 text-xs text-stone-500">{t('radar.nothingFilterHint')}</div>
                <button onClick={() => setIdeasFilter('all')} className="mt-4 rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold">{t('radar.showAllIdeas')}</button>
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
                          {item.status === 'new' && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">New</span>}
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
                        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">{t('radar.hook')}</div>
                        <p className="mt-1 text-sm leading-5 text-stone-700 line-clamp-2">{item.hook}</p>
                      </div>

                      <div className="mt-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">{t('radar.coreInsight')}</div>
                        <p className="mt-1 text-xs leading-5 text-stone-600 line-clamp-3">{item.coreIdea}</p>
                      </div>

                      <div className="mt-4 border-t border-stone-100 pt-3">
                        <div className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700">
                          <Link2 className="h-3 w-3" />
                          {item.sourceFeedback === 'interesting'
                            ? (locale === 'ru' ? 'На основе видео, которое вам понравилось' : 'Based on a video you liked')
                            : (locale === 'ru' ? 'Источник Radar' : 'Radar source')}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-stone-400">
                        <Youtube className="w-3.5 h-3.5 text-rose-500" />
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-emerald-700">
                          {item.sourceTitle || item.sourceChannel}
                        </a>
                        <span className="text-stone-300">·</span>
                        <Clock3 className="w-3 h-3" />
                        <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                        </div>
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
                              <div className="font-semibold text-stone-800">{t('radar.evidence')}</div>
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
                            disabled={generatingScriptIds.has(item.id) || generatingScriptIds.size >= MAX_PARALLEL_SCRIPT_GENERATIONS}
                            title={!generatingScriptIds.has(item.id) && generatingScriptIds.size >= MAX_PARALLEL_SCRIPT_GENERATIONS
                              ? `Достигнут лимит: ${MAX_PARALLEL_SCRIPT_GENERATIONS} параллельных генерации`
                              : undefined}
                            className="h-10 inline-flex items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
                          >
                            {generatingScriptIds.has(item.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {generatingScriptIds.has(item.id)
                              ? 'Generating…'
                              : generatingScriptIds.size >= MAX_PARALLEL_SCRIPT_GENERATIONS
                                ? `${MAX_PARALLEL_SCRIPT_GENERATIONS} in progress`
                                : 'Generate script'}
                          </button>
                        )}
                        <button
                          onClick={() => setStatus(item.id, item.status === 'saved' ? 'new' : 'saved')}
                          className={`h-10 inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold ${item.status === 'saved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
                        >
                          <Bookmark className="w-3.5 h-3.5" />{item.status === 'saved' ? t('radar.saved') : t('radar.save')}
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

        {!isLoading && profile && !profile.onboardingCompletedAt && view !== 'ideas' && (
          <OnboardingProgress currentStep={view === 'setup' ? 1 : 2} />
        )}

        {interestsEditorOpen && profile && (
          <div className="fixed inset-0 z-[110] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4" onMouseDown={(event) => {
            if (event.currentTarget === event.target && !interestsSaving) setInterestsEditorOpen(false);
          }}>
            <div className="w-full max-w-xl rounded-3xl border border-stone-200 bg-white shadow-2xl p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-stone-950">{t('radar.quickAdd')}</h3>
                  <p className="mt-1 text-xs text-stone-500">{t('radar.fullPersonalizationHint')}</p>
                </div>
                <button type="button" disabled={interestsSaving} onClick={() => setInterestsEditorOpen(false)} className="p-2 rounded-xl text-stone-400 hover:bg-stone-100 disabled:opacity-40"><X className="w-4 h-4" /></button>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {TOPICS.map(topic => {
                  const selected = draftTopics.includes(topic);
                  return (
                    <button key={topicLabel(topic)} type="button" disabled={interestsSaving} onClick={() => setDraftTopics(prev => selected ? prev.filter(value => value !== topic) : [...prev, topic])} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${selected ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}>
                      {selected ? '✓ ' : ''}{topicLabel(topic)}
                    </button>
                  );
                })}
              </div>

              {draftTopics.filter(topic => !TOPICS.includes(topic)).length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{t('radar.customInterests')}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draftTopics.filter(topic => !TOPICS.includes(topic)).map(topic => (
                      <button key={topicLabel(topic)} type="button" disabled={interestsSaving} onClick={() => setDraftTopics(prev => prev.filter(value => value !== topic))} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-40">
                        {topicLabel(topic)} <span className="ml-1 text-emerald-500">×</span>
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

              {profile.onboardingCompletedAt && (
                <button
                  type="button"
                  disabled={interestsSaving}
                  onClick={() => { setInterestsEditorOpen(false); setView('setup'); }}
                  className="mt-5 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-left text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-40"
                >
                  Open full personalization
                  <span className="mt-0.5 block text-[10px] font-normal text-stone-400">{t('radar.fullPersonalizationHint')}</span>
                </button>
              )}

              <div className="mt-6 flex items-center justify-end gap-2 border-t border-stone-100 pt-4">
                <button type="button" disabled={interestsSaving} onClick={() => setInterestsEditorOpen(false)} className="h-10 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-700 disabled:opacity-40">{t('radar.cancel')}</button>
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
