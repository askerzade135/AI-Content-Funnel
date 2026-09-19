import React, { useEffect, useMemo, useState } from 'react';
import { Radio, Sparkles, X, ScanSearch, Youtube, ExternalLink, Loader2, Settings2, Bookmark, EyeOff } from 'lucide-react';
import { RadarOpportunity, RadarProfile, StoredVideo, TrackedChannel } from '../types';
import { authFetch } from '../services/authFetch';

interface ContentRadarProps {
  isOpen: boolean;
  onClose: () => void;
  videos: StoredVideo[];
  channels: TrackedChannel[];
  onRefresh: () => void;
}

export const ContentRadar: React.FC<ContentRadarProps> = ({ isOpen, onClose, videos, channels }) => {
  const [profile, setProfile] = useState<RadarProfile | null>(null);
  const [opportunities, setOpportunities] = useState<RadarOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const candidatesCount = useMemo(
    () => videos.filter(v => v.status === 'new' || v.status === 'transcribed').length,
    [videos]
  );

  const loadRadar = async () => {
    setIsLoading(true);
    try {
      const [profileRes, opportunitiesRes] = await Promise.all([
        authFetch('/api/radar/profile'),
        authFetch('/api/radar/opportunities'),
      ]);
      if (profileRes.ok) setProfile(await profileRes.json());
      if (opportunitiesRes.ok) setOpportunities(await opportunitiesRes.json());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) void loadRadar();
  }, [isOpen]);

  const saveProfile = async () => {
    if (!profile) return;
    setIsSavingProfile(true);
    try {
      const res = await authFetch('/api/radar/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (res.ok) setProfile(await res.json());
    } finally {
      setIsSavingProfile(false);
    }
  };

  const scan = async () => {
    setIsScanning(true);
    setScanError(null);
    try {
      if (profile) await saveProfile();
      const res = await authFetch('/api/radar/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 12 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Radar scan failed');
      await loadRadar();
    } catch (err: any) {
      setScanError(err?.message || 'Не удалось завершить сканирование');
    } finally {
      setIsScanning(false);
    }
  };

  const setStatus = async (id: string, status: RadarOpportunity['status']) => {
    const res = await authFetch(`/api/radar/opportunities/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = await res.json();
      setOpportunities(prev => prev.map(x => x.id === id ? updated : x));
    }
  };

  if (!isOpen) return null;

  const visible = opportunities.filter(x => x.status !== 'dismissed');

  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-6xl max-h-[92vh] overflow-hidden bg-white rounded-3xl shadow-2xl border border-stone-200 flex flex-col">
        <div className="px-5 sm:px-7 py-5 border-b border-stone-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-stone-900">Content Radar</h2>
              <p className="text-xs text-stone-500">Персональные контентные возможности из подключённых источников</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-stone-100 text-stone-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 sm:p-7">
          <div className="grid lg:grid-cols-[360px_1fr] gap-6">
            <aside className="space-y-4">
              <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Settings2 className="w-4 h-4 text-stone-500" />
                  <h3 className="text-sm font-bold">Radar Profile</h3>
                </div>
                {isLoading || !profile ? (
                  <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-stone-400" /></div>
                ) : (
                  <>
                    <p className="text-[11px] text-stone-500 mb-3">Это серверный профиль автора. Он применяется ко всем новым сканированиям.</p>
                    <textarea
                      value={profile.description}
                      onChange={e => setProfile({ ...profile, description: e.target.value })}
                      rows={9}
                      className="w-full rounded-xl border border-stone-200 bg-white p-3 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-emerald-100"
                    />
                    <button
                      onClick={saveProfile}
                      disabled={isSavingProfile}
                      className="mt-2 w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-xs font-semibold hover:bg-stone-50 disabled:opacity-50"
                    >
                      {isSavingProfile ? 'Сохраняю…' : 'Сохранить стратегию'}
                    </button>
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-stone-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Youtube className="w-4 h-4 text-red-500" />
                  <h3 className="text-sm font-bold">Источники</h3>
                </div>
                <div className="text-xs text-stone-600 mb-2">{channels.length} каналов · {candidatesCount} потенциально новых видео</div>
                <div className="space-y-2 max-h-44 overflow-y-auto">
                  {channels.slice(0, 10).map(ch => (
                    <div key={ch.id} className="flex items-center gap-2 text-xs">
                      <div className="w-6 h-6 rounded-lg bg-stone-100 overflow-hidden shrink-0">
                        {ch.avatarUrl ? <img src={ch.avatarUrl} className="w-full h-full object-cover" /> : null}
                      </div>
                      <span className="truncate font-medium text-stone-700">{ch.title}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={scan}
                disabled={isScanning || !profile || channels.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 disabled:opacity-50"
              >
                {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
                {isScanning ? 'Radar анализирует…' : 'Scan now'}
              </button>
              {scanError && <p className="text-xs text-rose-600">{scanError}</p>}
            </aside>

            <section>
              <div className="flex items-end justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">Opportunities</h3>
                  <p className="text-xs text-stone-500 mt-0.5">Не видео, а конкретные идеи, которые Radar нашёл для твоей стратегии</p>
                </div>
                <span className="text-[11px] text-stone-400">{visible.length} найдено</span>
              </div>

              {isLoading ? (
                <div className="min-h-[320px] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-stone-400" /></div>
              ) : visible.length === 0 ? (
                <div className="min-h-[320px] rounded-2xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center text-center p-8">
                  <Sparkles className="w-8 h-8 text-emerald-500 mb-3" />
                  <h4 className="text-sm font-bold text-stone-800">Radar пока пуст</h4>
                  <p className="text-xs text-stone-500 max-w-sm mt-1">Сохрани стратегию и запусти Scan now. Radar создаст отдельные opportunities с hook, angle и evidence.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {visible.map(item => (
                    <article key={item.id} className="rounded-2xl border border-stone-200 p-4 hover:border-stone-300 transition">
                      <div className="flex gap-4">
                        {item.sourceThumbnail && <img src={item.sourceThumbnail} className="w-28 h-16 sm:w-36 sm:h-20 rounded-xl object-cover shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{item.relevance}% relevance</span>
                            {item.topic && <span className="text-[10px] text-stone-500">{item.topic}</span>}
                            {item.status === 'saved' && <span className="text-[10px] font-semibold text-sky-700">Saved</span>}
                          </div>
                          <h4 className="text-sm font-bold text-stone-900 mt-1">{item.title}</h4>
                          <div className="mt-2 text-xs text-stone-700"><strong>Hook:</strong> {item.hook}</div>
                          <div className="mt-1 text-xs text-stone-600"><strong>Ядро:</strong> {item.coreIdea}</div>
                          <div className="mt-1 text-xs text-stone-600"><strong>Почему интересно:</strong> {item.whyInteresting}</div>
                          <div className="mt-1 text-xs text-stone-600"><strong>Твой угол:</strong> {item.angle}</div>
                          {item.evidence && item.evidence.length > 0 && (
                            <div className="mt-2 rounded-xl bg-stone-50 border border-stone-200 p-2.5">
                              <div className="text-[10px] uppercase tracking-wide font-bold text-stone-500 mb-1">Evidence</div>
                              {item.evidence.map((e, i) => <div key={i} className="text-[11px] text-stone-600">• {e}</div>)}
                            </div>
                          )}
                          <div className="mt-3 flex items-center gap-2 flex-wrap">
                            <button onClick={() => setStatus(item.id, item.status === 'saved' ? 'new' : 'saved')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-200 text-[11px] font-semibold hover:bg-stone-50">
                              <Bookmark className="w-3 h-3" /> {item.status === 'saved' ? 'Unsave' : 'Save'}
                            </button>
                            <button onClick={() => setStatus(item.id, 'dismissed')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-200 text-[11px] font-semibold hover:bg-stone-50">
                              <EyeOff className="w-3 h-3" /> Dismiss
                            </button>
                            <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-700">
                              {item.sourceChannel || item.sourceTitle} <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
