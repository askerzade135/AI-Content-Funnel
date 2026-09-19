import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Plus, RefreshCw, Youtube } from 'lucide-react';
import { RadarReferenceSignal, RadarYouTubeSubscription } from '../types';
import { authFetch } from '../services/authFetch';
import { connectYouTube } from '../services/googleAuth';

export const SourcesWorkspace: React.FC = () => {
  const [references, setReferences] = useState<RadarReferenceSignal[]>([]);
  const [subscriptions, setSubscriptions] = useState<RadarYouTubeSubscription[]>([]);
  const [referenceValue, setReferenceValue] = useState('');
  const [referenceIntent, setReferenceIntent] = useState<RadarReferenceSignal['intent']>('more_like_this');
  const [busy, setBusy] = useState(false);
  const [youtubeBusy, setYoutubeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [r, y] = await Promise.all([
      authFetch('/api/radar/references'),
      authFetch('/api/radar/youtube-subscriptions'),
    ]);
    if (r.ok) setReferences(await r.json());
    if (y.ok) setSubscriptions(await y.json());
  };

  useEffect(() => { void load(); }, []);

  const addReference = async () => {
    if (!referenceValue.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await authFetch('/api/radar/references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: referenceValue.trim(), intent: referenceIntent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не удалось добавить reference');
      setReferences(prev => [data, ...prev]);
      setReferenceValue('');
    } catch (e: any) {
      setError(e?.message || 'Ошибка reference');
    } finally {
      setBusy(false);
    }
  };

  const connectSubscriptions = async () => {
    setYoutubeBusy(true); setError(null);
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await save.json().catch(() => []);
      if (!save.ok) throw new Error(data?.error || 'Не удалось импортировать подписки');
      setSubscriptions(data);
    } catch (e: any) {
      setError(e?.message || 'Ошибка подключения YouTube');
    } finally {
      setYoutubeBusy(false);
    }
  };

  return (
    <div className="p-5 sm:p-7 max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Source intelligence</div>
        <h2 className="text-3xl font-bold mt-1">Sources</h2>
        <p className="text-sm text-stone-500 mt-1">Управляй источниками, которые обучают Radar твоему вкусу.</p>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>}

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="rounded-3xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold">YouTube subscriptions</h3>
              <p className="text-xs text-stone-500 mt-1">Подписки становятся персональным source pool для discovery.</p>
            </div>
            <Youtube className="w-5 h-5 text-red-600"/>
          </div>
          <button onClick={connectSubscriptions} disabled={youtubeBusy} className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold disabled:opacity-50">
            {youtubeBusy ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCw className="w-4 h-4"/>}
            {subscriptions.length ? `Обновить подписки (${subscriptions.length})` : 'Connect YouTube'}
          </button>
          <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
            {subscriptions.slice(0, 30).map(item => (
              <div key={item.channelId} className="rounded-xl border border-stone-200 px-3 py-2">
                <div className="text-xs font-semibold">{item.title}</div>
                {item.description && <div className="text-[10px] text-stone-500 mt-1 line-clamp-2">{item.description}</div>}
              </div>
            ))}
            {!subscriptions.length && <div className="text-xs text-stone-400">Подписки пока не импортированы.</div>}
          </div>
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-5">
          <h3 className="font-bold">References</h3>
          <p className="text-xs text-stone-500 mt-1">Добавляй видео, каналы, посты или текст как сигналы для Radar.</p>
          <textarea value={referenceValue} onChange={e => setReferenceValue(e.target.value)} rows={4} placeholder="https://youtube.com/... или текст" className="mt-4 w-full rounded-xl border border-stone-200 p-3 text-xs"/>
          <select value={referenceIntent} onChange={e => setReferenceIntent(e.target.value as RadarReferenceSignal['intent'])} className="mt-2 w-full rounded-xl border border-stone-200 px-3 py-2 text-xs bg-white">
            <option value="more_like_this">Хочу больше такого</option>
            <option value="interesting">Мне это интересно</option>
            <option value="style">Нравится стиль</option>
            <option value="topic">Нравится тема</option>
          </select>
          <button onClick={addReference} disabled={busy || !referenceValue.trim()} className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-900 text-white text-xs font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin"/> : <Plus className="w-4 h-4"/>} Add reference
          </button>
          <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
            {references.map(item => (
              <div key={item.id} className="rounded-xl border border-stone-200 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold">{item.title || item.platform || item.kind}</div>
                  {item.value.startsWith('http') && <a href={item.value} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3 text-stone-400"/></a>}
                </div>
                {item.summary && <div className="text-[10px] text-stone-500 mt-1">{item.summary}</div>}
              </div>
            ))}
            {!references.length && <div className="text-xs text-stone-400">References пока нет.</div>}
          </div>
        </section>
      </div>
    </div>
  );
};
