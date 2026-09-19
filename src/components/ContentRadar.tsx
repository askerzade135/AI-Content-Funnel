import React, { useEffect, useMemo, useState } from 'react';
import { Radio, Sparkles, X, ScanSearch, ExternalLink, Loader2, Bookmark, EyeOff, ThumbsUp, SkipForward, ArrowRight } from 'lucide-react';
import { GeneratedScript, RadarDiscoveryState, RadarOpportunity, RadarProfile, RadarReferenceSignal, RadarScriptFeedbackReason, RadarSkipReason, RadarYouTubeSubscription, StoredVideo, TrackedChannel } from '../types';
import { authFetch } from '../services/authFetch';
import { createGoogleDocFromHtml } from '../services/googleDocsService';
import { connectYouTube } from '../services/googleAuth';

interface ContentRadarProps {
  isOpen: boolean;
  onClose: () => void;
  videos: StoredVideo[];
  channels: TrackedChannel[];
  onRefresh: () => void;
  embedded?: boolean;
  initialView?: 'setup' | 'discover' | 'ideas';
  initialOpportunityId?: string;
}

const TOPICS = ["Психология","Воспитание","Отношения","Общество","Ценности","Религия и традиции","История","Культура","Бизнес","Технологии"];
const ANGLES = ["Спорные темы","Неожиданные факты","Разрушение мифов","Исследования","Сильные истории","Культурные конфликты","Противоположные точки зрения"];

export const ContentRadar: React.FC<ContentRadarProps> = ({ isOpen, onClose, embedded = false, initialView, initialOpportunityId }) => {
  const [profile, setProfile] = useState<RadarProfile | null>(null);
  const [discovery, setDiscovery] = useState<RadarDiscoveryState | null>(null);
  const [opportunities, setOpportunities] = useState<RadarOpportunity[]>([]);
  const [view, setView] = useState<'setup' | 'discover' | 'ideas'>('setup');
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [references, setReferences] = useState<RadarReferenceSignal[]>([]);
  const [referenceValue, setReferenceValue] = useState('');
  const [referenceIntent, setReferenceIntent] = useState<RadarReferenceSignal['intent']>('more_like_this');
  const [isAddingReference, setIsAddingReference] = useState(false);
  const [youtubeSubscriptions, setYoutubeSubscriptions] = useState<RadarYouTubeSubscription[]>([]);
  const [isConnectingYouTube, setIsConnectingYouTube] = useState(false);
  const [skipReasonOpen, setSkipReasonOpen] = useState(false);
  const [radarScripts, setRadarScripts] = useState<GeneratedScript[]>([]);
  const [generatingScriptId, setGeneratingScriptId] = useState<string | null>(null);
  const [reviewingScriptId, setReviewingScriptId] = useState<string | null>(null);
  const [defaultDestination, setDefaultDestination] = useState<'telegram' | 'google_docs' | 'copy'>('copy');
  const [sendingScriptId, setSendingScriptId] = useState<string | null>(null);

  const loadRadar = async () => {
    setIsLoading(true);
    try {
      const [p, d, o, r, ys, rs, settingsRes] = await Promise.all([
        authFetch('/api/radar/profile'),
        authFetch('/api/radar/discovery'),
        authFetch('/api/radar/opportunities'),
        authFetch('/api/radar/references'),
        authFetch('/api/radar/youtube-subscriptions'),
        authFetch('/api/radar/scripts'),
        authFetch('/api/settings'),
      ]);
      const profileData = p.ok ? await p.json() : null;
      if (profileData) {
        setProfile(profileData);
        setView(initialView || (profileData.onboardingCompletedAt ? 'ideas' : ((profileData.topics?.length || 0) > 0 ? 'discover' : 'setup')));
      }
      if (d.ok) setDiscovery(await d.json());
      if (o.ok) setOpportunities(await o.json());
      if (r.ok) setReferences(await r.json());
      if (ys.ok) setYoutubeSubscriptions(await ys.json());
      if (rs.ok) setRadarScripts(await rs.json());
      if (settingsRes.ok) { const s = await settingsRes.json(); if (s?.radarDefaultDestination) setDefaultDestination(s.radarDefaultDestination); }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (isOpen) void loadRadar(); }, [isOpen]);
  useEffect(() => { if (isOpen && initialView) setView(initialView); }, [isOpen, initialView]);

  const saveProfile = async (next: RadarProfile) => {
    setProfile(next);
    const res = await authFetch('/api/radar/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    if (res.ok) setProfile(await res.json());
  };

  const toggle = (field: 'topics' | 'preferredAngles', value: string) => {
    if (!profile) return;
    const current = profile[field] || [];
    const next = current.includes(value) ? current.filter(x => x !== value) : [...current, value];
    setProfile({ ...profile, [field]: next });
  };

  const startDiscovery = async () => {
    if (!profile || !(profile.topics || []).length) return;
    await saveProfile(profile);
    setView('discover');
    setIsDiscovering(true);
    setError(null);
    try {
      const res = await authFetch('/api/radar/discovery/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perQuery: 5 }),
      });
      const data = await res.json();
      if (res.ok && data?.discovery) setDiscovery(data.discovery);
      else if (!res.ok) setError(data?.error || 'Не удалось найти новые видео');
    } finally {
      setIsDiscovering(false);
    }
  };

  const feedback = async (decision: 'interesting' | 'skip', reason?: RadarSkipReason) => {
    const item = discovery?.candidates[0];
    if (!item) return;
    const res = await authFetch('/api/radar/discovery-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceContentId: item.id, decision, reason }),
    });
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

  const addReference = async () => {
    if (!referenceValue.trim()) return;
    setIsAddingReference(true); setError(null);
    try {
      const res = await authFetch('/api/radar/references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: referenceValue.trim(), intent: referenceIntent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Не удалось добавить reference');
      setReferences(prev => [data, ...prev]);
      setReferenceValue('');
      const d = await authFetch('/api/radar/discovery');
      if (d.ok) setDiscovery(await d.json());
    } catch (e: any) {
      setError(e?.message || 'Ошибка reference');
    } finally {
      setIsAddingReference(false);
    }
  };

  const connectYouTubeSubscriptions = async () => {
    setIsConnectingYouTube(true); setError(null);
    try {
      const authResult = await connectYouTube();
      if (!authResult?.accessToken) return;
      const items: any[] = [];
      let pageToken = '';
      do {
        const url = new URL('https://www.googleapis.com/youtube/v3/subscriptions');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('mine', 'true');
        url.searchParams.set('maxResults', '50');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${authResult.accessToken}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || 'YouTube subscriptions request failed');
        for (const item of data.items || []) {
          const sn = item.snippet || {};
          items.push({
            channelId: sn.resourceId?.channelId,
            title: sn.title,
            description: sn.description,
            thumbnail: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url,
          });
        }
        pageToken = data.nextPageToken || '';
      } while (pageToken && items.length < 500);

      const save = await authFetch('/api/radar/youtube-subscriptions/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
      });
      const saved = await save.json();
      if (!save.ok) throw new Error(saved?.error || 'Не удалось импортировать подписки');
      setYoutubeSubscriptions(saved);
    } catch (e: any) {
      setError(e?.message || 'Ошибка подключения YouTube');
    } finally {
      setIsConnectingYouTube(false);
    }
  };

  const generateScript = async (opportunityId: string) => {
    setGeneratingScriptId(opportunityId); setError(null);
    try {
      const res = await authFetch(`/api/radar/opportunities/${opportunityId}/script`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Не удалось создать сценарий');
      setRadarScripts(prev => [data.script, ...prev]);
      setOpportunities(prev => prev.map(x => x.id === opportunityId ? data.opportunity : x));
    } catch (e: any) {
      setError(e?.message || 'Ошибка генерации сценария');
    } finally {
      setGeneratingScriptId(null);
    }
  };

  const reviewScript = async (script: GeneratedScript, decision: 'approved' | 'rewrite' | 'rejected', reason?: RadarScriptFeedbackReason) => {
    if (!script.radarOpportunityId) return;
    setReviewingScriptId(script.id); setError(null);
    try {
      const res = await authFetch('/api/radar/script-feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: script.id, opportunityId: script.radarOpportunityId, decision, reason }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || 'Не удалось сохранить review');
      }
      if (decision === 'rewrite') await generateScript(script.radarOpportunityId);
      if (decision === 'approved') setRadarScripts(prev => prev.map(x => x.id === script.id ? { ...x, isReviewed: true } : x));
    } catch (e: any) {
      setError(e?.message || 'Ошибка review');
    } finally {
      setReviewingScriptId(null);
    }
  };

  const saveDefaultDestination = async (destination: 'telegram' | 'google_docs' | 'copy') => {
    setDefaultDestination(destination);
    const res = await authFetch('/api/settings');
    if (!res.ok) return;
    const settings = await res.json();
    await authFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, radarDefaultDestination: destination }),
    });
  };

  const sendScript = async (script: GeneratedScript, destination = defaultDestination) => {
    setSendingScriptId(script.id); setError(null);
    try {
      if (destination === 'telegram') {
        const res = await authFetch(`/api/radar/scripts/${script.id}/send-telegram`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Telegram send failed');
        setRadarScripts(prev => prev.map(x => x.id === script.id ? data.script : x));
        return;
      }

      if (destination === 'google_docs') {
        const escaped = script.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = `<!doctype html><html><body><h1>${script.ideaTitle || script.title}</h1><pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escaped}</pre></body></html>`;
        const doc = await createGoogleDocFromHtml(script.ideaTitle || script.title, html);
        if (!doc) throw new Error('Google Docs creation cancelled');
        window.open(doc.url, '_blank');
        return;
      }

      await navigator.clipboard.writeText(script.content);
    } catch (e: any) {
      setError(e?.message || 'Ошибка отправки сценария');
    } finally {
      setSendingScriptId(null);
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
        {isLoading || !profile ? <div className="min-h-[420px] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin"/></div> : null}

        {!isLoading && profile && view === 'setup' && <div className="max-w-3xl mx-auto space-y-6">
          <div><h3 className="text-xl font-bold">Что тебе интересно?</h3><p className="text-sm text-stone-500 mt-1">Выбери несколько тем. Писать длинный промпт не обязательно.</p></div>
          <div className="flex flex-wrap gap-2">{TOPICS.map(x => <button key={x} onClick={() => toggle('topics', x)} className={`px-3 py-2 rounded-xl text-sm border ${profile.topics?.includes(x) ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-200'}`}>{x}</button>)}</div>
          <div><h4 className="font-bold mb-2">Какой контент показывать чаще?</h4><div className="flex flex-wrap gap-2">{ANGLES.map(x => <button key={x} onClick={() => toggle('preferredAngles', x)} className={`px-3 py-2 rounded-xl text-sm border ${profile.preferredAngles?.includes(x) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-stone-200'}`}>{x}</button>)}</div></div>
          <button disabled={!profile.topics?.length} onClick={startDiscovery} className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-stone-900 text-white font-semibold disabled:opacity-40">Дальше <ArrowRight className="w-4 h-4"/></button>
        </div>}

        {!isLoading && profile && view === 'discover' && <div className="max-w-4xl mx-auto">
          <div className="flex items-end justify-between mb-5"><div><h3 className="text-xl font-bold">Научи Radar своему вкусу</h3><p className="text-sm text-stone-500 mt-1">Radar ищет видео по выбранным темам и показывает их по одному. Отметь хотя бы {discovery?.minimumSignals || 5}.</p></div><div className="text-sm font-bold">{discovery?.feedbackCount || 0} / {discovery?.minimumSignals || 5}</div></div>
          <div className="h-2 bg-stone-100 rounded-full overflow-hidden mb-5"><div className="h-full bg-emerald-500" style={{width: `${Math.min(100, ((discovery?.feedbackCount || 0)/(discovery?.minimumSignals || 5))*100)}%`}}/></div>
          {isDiscovering ? <div className="min-h-[320px] rounded-3xl border border-stone-200 flex flex-col items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-emerald-600"/><div className="mt-3 text-sm font-semibold">Ищу подходящие видео…</div><div className="mt-1 text-xs text-stone-500">LLM строит запросы, YouTube возвращает реальные кандидаты</div></div> : discovery?.candidates?.[0] ? <div className="rounded-3xl border border-stone-200 overflow-hidden">
            {discovery.candidates[0].thumbnail && <img src={discovery.candidates[0].thumbnail} className="w-full h-56 object-cover"/>}
            <div className="p-5"><div className="flex items-center gap-2 text-xs text-stone-500"><span>{discovery.candidates[0].channelTitle}</span>{discovery.candidates[0].source === 'external' && <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[10px]">Discovery</span>}{typeof discovery.candidates[0].rankingScore === 'number' && <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px]">{discovery.candidates[0].rankingScore}% match</span>}</div><h4 className="text-lg font-bold mt-1">{discovery.candidates[0].title}</h4><p className="text-sm text-stone-500 mt-2 line-clamp-3">{discovery.candidates[0].description}</p>{discovery.candidates[0].rankingReason && <div className="mt-3 rounded-xl bg-emerald-50/60 border border-emerald-100 p-3 text-xs text-emerald-900"><span className="font-semibold">Почему Radar показал:</span> {discovery.candidates[0].rankingReason}</div>}<div className="flex gap-3 mt-5"><button onClick={() => setSkipReasonOpen(v => !v)} className="flex-1 inline-flex justify-center items-center gap-2 px-4 py-3 rounded-2xl border border-stone-300 font-semibold"><SkipForward className="w-4 h-4"/> Skip</button><button onClick={() => feedback('interesting')} className="flex-1 inline-flex justify-center items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-600 text-white font-semibold"><ThumbsUp className="w-4 h-4"/> Интересно</button></div>{skipReasonOpen && <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3"><div className="text-[11px] font-semibold text-stone-700 mb-2">Почему не подходит? Можно просто пропустить.</div><div className="flex flex-wrap gap-2">{[['too_generic','Слишком банально'],['not_my_topic','Не моя тема'],['wrong_style','Не нравится подача'],['too_shallow','Слишком поверхностно'],['seen_before','Уже видел такое']].map(([value,label]) => <button key={value} onClick={() => feedback('skip', value as RadarSkipReason)} className="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-[11px] font-medium hover:bg-stone-100">{label}</button>)}<button onClick={() => feedback('skip')} className="px-2.5 py-1.5 rounded-lg text-[11px] text-stone-500">Просто Skip</button></div></div>}<a href={discovery.candidates[0].url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-stone-400">Открыть видео <ExternalLink className="w-3 h-3"/></a></div>
          </div> : <div className="p-10 text-center border-2 border-dashed rounded-2xl text-sm text-stone-500">Кандидаты закончились. Можно перейти к идеям или добавить новые источники.</div>}
          {(discovery?.feedbackCount || 0) >= (discovery?.minimumSignals || 5) && <button onClick={completeLearning} className="mt-5 w-full px-5 py-3 rounded-2xl bg-stone-900 text-white font-semibold">Перейти к идеям</button>}
        </div>}

        {!isLoading && profile && view === 'ideas' && <div className="grid lg:grid-cols-[260px_1fr] gap-6">
          <aside className="space-y-3">
            <div className="rounded-2xl border p-4">
              <div className="font-bold text-sm">Radar обучен</div>
              <div className="text-xs text-stone-500 mt-1">{discovery?.interestingCount || 0} интересно · {discovery?.skipCount || 0} skip · {references.length} references</div>
            </div>
            <div className="rounded-2xl border p-4 space-y-2">
              <div className="font-bold text-sm">Default destination</div>
              <select value={defaultDestination} onChange={e => saveDefaultDestination(e.target.value as 'telegram' | 'google_docs' | 'copy')} className="w-full rounded-xl border px-2.5 py-2 text-xs bg-white">
                <option value="copy">Copy</option>
                <option value="telegram">Telegram</option>
                <option value="google_docs">Google Docs</option>
              </select>
              <div className="text-[10px] text-stone-500">После approve сценарий можно отправить туда одним кликом.</div>
            </div>
            <div className="rounded-2xl border p-4 space-y-2">
              <div className="font-bold text-sm">YouTube subscriptions</div>
              <div className="text-[11px] text-stone-500">Импортируем каналы, на которые ты уже подписан, и используем их как персональный source pool.</div>
              <button
                onClick={connectYouTubeSubscriptions}
                disabled={isConnectingYouTube}
                className="w-full px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs font-semibold disabled:opacity-40"
              >
                {isConnectingYouTube ? 'Подключаю…' : youtubeSubscriptions.length ? `Обновить YouTube (${youtubeSubscriptions.length})` : 'Connect YouTube'}
              </button>
              {youtubeSubscriptions.length > 0 && <div className="text-[10px] text-stone-500">{youtubeSubscriptions.length} подписок импортировано</div>}
            </div>
            <div className="rounded-2xl border p-4 space-y-2">
              <div className="font-bold text-sm">Add reference</div>
              <div className="text-[11px] text-stone-500">Вставь видео, канал, пост или текст, который тебе интересен.</div>
              <textarea
                value={referenceValue}
                onChange={e => setReferenceValue(e.target.value)}
                rows={4}
                placeholder="https://youtube.com/... или текст"
                className="w-full rounded-xl border p-2.5 text-xs"
              />
              <select
                value={referenceIntent}
                onChange={e => setReferenceIntent(e.target.value as RadarReferenceSignal['intent'])}
                className="w-full rounded-xl border px-2.5 py-2 text-xs bg-white"
              >
                <option value="more_like_this">Хочу больше такого</option>
                <option value="interesting">Мне это интересно</option>
                <option value="style">Нравится именно стиль</option>
                <option value="topic">Нравится тема, не обязательно подача</option>
              </select>
              <button
                onClick={addReference}
                disabled={isAddingReference || !referenceValue.trim()}
                className="w-full px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40"
              >
                {isAddingReference ? 'Анализирую…' : 'Add to Radar'}
              </button>
              {references[0] && (
                <div className="pt-2 border-t text-[10px] text-stone-500">
                  Последний: <span className="font-semibold text-stone-700">{references[0].title || references[0].platform || references[0].kind}</span>
                  {references[0].summary ? <div className="mt-1">{references[0].summary}</div> : null}
                </div>
              )}
            </div>
            <button onClick={() => scan(false)} disabled={isScanning} className="w-full inline-flex justify-center items-center gap-2 px-4 py-3 rounded-2xl bg-stone-900 text-white text-sm font-semibold disabled:opacity-50">{isScanning ? <Loader2 className="w-4 h-4 animate-spin"/> : <ScanSearch className="w-4 h-4"/>}{isScanning ? 'Анализирую…' : 'Обновить Radar'}</button><button onClick={() => setView('discover')} className="w-full px-4 py-2 rounded-xl border text-xs font-semibold">Ещё обучить Radar</button>{error && <p className="text-xs text-rose-600">{error}</p>}</aside>
          <section><div className="flex items-end justify-between mb-3"><div><h3 className="text-lg font-bold">Идеи</h3><p className="text-xs text-stone-500">Feed пополняется после глубокого анализа выбранного контента</p></div><span className="text-xs text-stone-400">{visible.length}</span></div>{visible.length===0?<div className="min-h-[340px] border-2 border-dashed rounded-2xl flex flex-col justify-center items-center text-center"><Sparkles className="w-8 h-8 text-emerald-500"/><div className="font-bold mt-2">Пока нет идей</div><div className="text-xs text-stone-500 mt-1">Нажми «Обновить Radar»</div></div>:<div className="space-y-3">{visible.map(item=><article key={item.id} className={'rounded-2xl border p-4 transition ' + (item.id === initialOpportunityId ? 'border-violet-400 ring-2 ring-violet-100 bg-violet-50/30' : '')}><div className="flex items-center gap-2"><span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">{item.relevance}%</span>{item.topic&&<span className="text-[10px] text-stone-500">{item.topic}</span>}</div><h4 className="font-bold mt-2">{item.title}</h4><div className="text-xs mt-2"><b>Hook:</b> {item.hook}</div><div className="text-xs text-stone-600 mt-1"><b>Ядро:</b> {item.coreIdea}</div><div className="text-xs text-stone-600 mt-1"><b>Угол:</b> {item.angle}</div>{item.evidence?.length?<div className="mt-2 p-2.5 rounded-xl bg-stone-50 text-[11px] text-stone-600">{item.evidence.map((e,i)=><div key={i}>• {e}</div>)}</div>:null}<div className="mt-3 flex gap-2 flex-wrap"><button onClick={()=>setStatus(item.id,item.status==='saved'?'new':'saved')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold"><Bookmark className="w-3 h-3"/>{item.status==='saved'?'Unsave':'Save'}</button><button onClick={()=>setStatus(item.id,'dismissed')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold"><EyeOff className="w-3 h-3"/>Skip</button><button onClick={()=>generateScript(item.id)} disabled={generatingScriptId===item.id} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-900 text-white text-[11px] font-semibold disabled:opacity-50">{generatingScriptId===item.id?'Пишу…':'Generate Script'}</button></div>{radarScripts.filter(s=>s.radarOpportunityId===item.id).slice(0,1).map(script=><div key={script.id} className="mt-4 rounded-xl border border-sky-100 bg-sky-50/50 p-3"><div className="text-[10px] uppercase tracking-wide font-bold text-sky-700 mb-2">Script review</div><div className="text-xs whitespace-pre-wrap text-stone-700 max-h-64 overflow-y-auto">{script.content}</div><div className="mt-3 flex flex-wrap gap-2"><button disabled={reviewingScriptId===script.id} onClick={()=>reviewScript(script,'approved')} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold">Approve</button><button disabled={sendingScriptId===script.id || !script.isReviewed} onClick={()=>sendScript(script)} className="px-2.5 py-1.5 rounded-lg bg-sky-600 text-white text-[11px] font-semibold disabled:opacity-40">{sendingScriptId===script.id?'Отправляю…':`Send → ${defaultDestination==='telegram'?'Telegram':defaultDestination==='google_docs'?'Google Docs':'Copy'}`}</button><button disabled={reviewingScriptId===script.id} onClick={()=>reviewScript(script,'rewrite','wrong_angle')} className="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold">Rewrite</button>{[['too_generic','Too generic'],['wrong_tone','Wrong tone'],['too_long','Too long'],['weak_hook','Weak hook']].map(([reason,label])=><button key={reason} disabled={reviewingScriptId===script.id} onClick={()=>reviewScript(script,'rewrite',reason as RadarScriptFeedbackReason)} className="px-2 py-1 rounded-lg border border-stone-200 text-[10px] text-stone-600">{label}</button>)}</div></div>)}</article>)}</div>}</section>
        </div>}
      </div>
    </div>
  </div>;
};
