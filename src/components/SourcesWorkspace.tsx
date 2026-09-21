import React, { useEffect, useState } from 'react';
import { ExternalLink, Globe2, Loader2, Plus, RefreshCw, Youtube } from 'lucide-react';
import { RadarProfile, RadarReferenceSignal, RadarYouTubeSubscription } from '../types';
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
  const [profile, setProfile] = useState<RadarProfile | null>(null);
  const [availability, setAvailability] = useState<Array<{ sourceType: 'youtube' | 'web' | 'x'; available: boolean }>>([]);
  const [savingSources, setSavingSources] = useState(false);

  const load = async () => {
    const [r, y, p, a] = await Promise.all([
      authFetch('/api/radar/references'),
      authFetch('/api/radar/youtube-subscriptions'),
      authFetch('/api/radar/profile'),
      authFetch('/api/radar/source-availability'),
    ]);
    if (r.ok) setReferences(await r.json());
    if (y.ok) setSubscriptions(await y.json());
    if (p.ok) setProfile(await p.json());
    if (a.ok) setAvailability(await a.json());
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

  const toggleDiscoverySource = async (sourceType: 'youtube' | 'web' | 'x') => {
    if (!profile || savingSources) return;
    const available = availability.find(item => item.sourceType === sourceType)?.available;
    if (!available) return;

    const current = profile.discoverySources?.length
      ? profile.discoverySources
      : availability.filter(item => item.available).map(item => item.sourceType);
    const next = current.includes(sourceType)
      ? current.filter(item => item !== sourceType)
      : [...current, sourceType];

    if (!next.length) {
      setError('Оставьте хотя бы один источник включённым.');
      return;
    }

    setSavingSources(true);
    setError(null);
    try {
      const res = await authFetch('/api/radar/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, discoverySources: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не удалось сохранить источники');
      setProfile(data);
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить источники');
    } finally {
      setSavingSources(false);
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

      <section className="mb-5 rounded-3xl border border-stone-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold">Search sources</h3>
            <p className="mt-1 max-w-2xl text-xs text-stone-500">
              Выбери, откуда Radar может искать контент. Здесь нет API-ключей — только пользовательские предпочтения.
            </p>
          </div>
          <Globe2 className="h-5 w-5 text-emerald-600" />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {availability.filter(item => item.available).map(item => {
            const label = item.sourceType === 'youtube' ? 'YouTube' : item.sourceType === 'web' ? 'Web' : 'X';
            const enabled = (profile?.discoverySources?.length
              ? profile.discoverySources
              : availability.filter(source => source.available).map(source => source.sourceType)
            ).includes(item.sourceType);
            return (
              <button
                key={item.sourceType}
                type="button"
                disabled={savingSources}
                onClick={() => void toggleDiscoverySource(item.sourceType)}
                className={`flex min-h-[72px] items-center justify-between rounded-2xl border px-4 py-3 text-left transition disabled:opacity-50 ${
                  enabled ? 'border-emerald-400 bg-emerald-50' : 'border-stone-200 bg-white hover:border-stone-300'
                }`}
              >
                <div>
                  <div className="text-sm font-bold text-stone-900">{label}</div>
                  <div className="mt-1 text-[11px] text-stone-500">{enabled ? 'Included in Radar search' : 'Excluded from Radar search'}</div>
                </div>
                <span className={`h-5 w-9 rounded-full p-0.5 transition ${enabled ? 'bg-emerald-600' : 'bg-stone-200'}`}>
                  <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
                </span>
              </button>
            );
          })}
          {availability.filter(item => item.available).length === 0 && (
            <div className="sm:col-span-3 rounded-2xl border border-dashed border-stone-200 px-4 py-5 text-xs text-stone-400">
              Доступные search providers пока не настроены администратором.
            </div>
          )}
        </div>
      </section>

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
