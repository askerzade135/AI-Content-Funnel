import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Radio, Sparkles } from 'lucide-react';
import { ProductSection, RadarTodayState, StoredVideo, TrackedChannel } from '../types';
import { authFetch } from '../services/authFetch';
import { ContentRadar } from './ContentRadar';
import { RadarScriptsWorkspace } from './RadarScriptsWorkspace';

interface RadarWorkspaceProps {
  section: Exclude<ProductSection, 'library'>;
  videos: StoredVideo[];
  channels: TrackedChannel[];
  onNavigate: (section: ProductSection) => void;
  onRefresh: () => void;
}

export const RadarWorkspace: React.FC<RadarWorkspaceProps> = ({ section, videos, channels, onNavigate, onRefresh }) => {
  const [today, setToday] = useState<RadarTodayState | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const todayRes = await authFetch('/api/radar/today');
      if (todayRes.ok) setToday(await todayRes.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [section]);

  if (section === 'discover' || section === 'ideas') {
    return (
      <div className="p-5 sm:p-7">
        <ContentRadar
          isOpen={true}
          embedded={true}
          initialView={section}
          onClose={() => undefined}
          videos={videos}
          channels={channels}
          onRefresh={onRefresh}
        />
      </div>
    );
  }

  if (section === 'scripts') {
    return <RadarScriptsWorkspace onGoIdeas={() => onNavigate('ideas')} />;
  }

  return (
    <div className="p-5 sm:p-7 max-w-7xl mx-auto">
      <div className="mb-7">
        <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 uppercase tracking-[0.18em]"><Radio className="w-3.5 h-3.5"/> Live Radar</div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">Что требует твоего решения сегодня</h2>
        <p className="text-sm text-stone-500 mt-2">Radar ищет и сортирует сам. Здесь остаются только решения, где нужен человек.</p>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-7">
        {[
          ['Новых сигналов', today?.summary.newDiscoveryCandidates ?? 0, 'bg-lime-100'],
          ['Новых идей', today?.summary.newOpportunities24h ?? 0, 'bg-emerald-100'],
          ['Ждут review', today?.summary.scriptsNeedReview ?? 0, 'bg-amber-100'],
          ['Готовы к отправке', today?.summary.scriptsReadyToSend ?? 0, 'bg-violet-100'],
        ].map(([label, value, bg]) => (
          <div key={String(label)} className={`rounded-2xl border border-stone-200 p-4 ${bg}`}>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs font-semibold text-stone-600 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-5">
        <section>
          <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-lg">Needs your attention</h3><span className="text-xs text-stone-400">{today?.attention.length || 0}</span></div>
          <div className="space-y-3">
            {(today?.attention || []).map(item => (
              <button key={item.type + item.id} onClick={() => onNavigate(item.type === 'opportunity' ? 'ideas' : 'scripts')} className="w-full text-left bg-white border border-stone-200 rounded-2xl p-4 hover:border-stone-300 hover:shadow-sm transition">
                <div className="text-[10px] uppercase tracking-wide font-bold text-stone-400">{item.subtitle}</div>
                <div className="flex items-center justify-between gap-3 mt-1"><span className="font-semibold">{item.title}</span><ArrowRight className="w-4 h-4 text-stone-400"/></div>
              </button>
            ))}
            {!loading && !today?.attention.length && <div className="border-2 border-dashed rounded-2xl p-8 text-center text-sm text-stone-400">На сегодня всё разобрано.</div>}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-lg">Top opportunities</h3><button onClick={() => onNavigate('ideas')} className="text-xs font-semibold text-emerald-700">Все идеи →</button></div>
          <div className="space-y-3">
            {(today?.topOpportunities || []).slice(0,4).map(op => (
              <button key={op.id} onClick={() => onNavigate('ideas')} className="w-full text-left bg-stone-900 text-white rounded-2xl p-4">
                <div className="flex items-center gap-2"><span className="px-2 py-0.5 rounded-full bg-lime-300 text-stone-900 text-[10px] font-bold">{op.relevance}%</span>{op.topic && <span className="text-[10px] text-stone-400">{op.topic}</span>}</div>
                <div className="font-bold mt-2">{op.title}</div>
                <div className="text-xs text-stone-400 mt-2 line-clamp-2">{op.whyInteresting}</div>
              </button>
            ))}
          </div>
        </section>
      </div>

      <button onClick={() => onNavigate('discover')} className="mt-7 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-semibold"><Sparkles className="w-4 h-4"/> Обучить Radar дальше</button>
    </div>
  );
};
