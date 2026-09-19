import React, { useEffect, useMemo, useState } from 'react';
import { Radio, Sparkles, X, ScanSearch, Youtube, ExternalLink, Loader2, Settings2 } from 'lucide-react';
import { StoredVideo, TrackedChannel } from '../types';
import { authFetch } from '../services/authFetch';

interface ContentRadarProps {
  isOpen: boolean;
  onClose: () => void;
  videos: StoredVideo[];
  channels: TrackedChannel[];
  onRefresh: () => void;
}

const DEFAULT_INTERESTS =
  'Я создаю контент про психологию, воспитание, отношения между поколениями, общество и ценности. Ищу необычные, дискуссионные и содержательные темы, а не обычные советы.';

export const ContentRadar: React.FC<ContentRadarProps> = ({
  isOpen,
  onClose,
  videos,
  channels,
  onRefresh,
}) => {
  const [interests, setInterests] = useState(DEFAULT_INTERESTS);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('content-radar-interests');
      if (saved) setInterests(saved);
    } catch (_) {}
  }, []);

  const saveInterests = (value: string) => {
    setInterests(value);
    try { localStorage.setItem('content-radar-interests', value); } catch (_) {}
  };

  const candidates = useMemo(
    () => videos
      .filter(v => v.status === 'new' || v.status === 'transcribed')
      .sort((a, b) => new Date(b.publishedAt || b.updatedAt || 0).getTime() - new Date(a.publishedAt || a.updatedAt || 0).getTime())
      .slice(0, 12),
    [videos]
  );

  const radarResults = useMemo(
    () => videos
      .filter(v => v.matchedFilter === true && v.geminiResult)
      .sort((a, b) => new Date(b.processedAt || b.updatedAt || 0).getTime() - new Date(a.processedAt || a.updatedAt || 0).getTime())
      .slice(0, 20),
    [videos]
  );

  const scan = async () => {
    if (!interests.trim() || candidates.length === 0) return;
    setIsScanning(true);
    setScanError(null);
    setScanProgress({ done: 0, total: candidates.length });

    const prompt = `CONTENT RADAR — найди контентные возможности внутри этого видео.

Профиль автора:
${interests}

Твоя задача:
1. Не пересказывай видео.
2. Найди 1–3 потенциальные темы/идеи, которые автор может развить в собственном контенте.
3. Для каждой идеи дай:
   - Тема / рабочий заголовок
   - Почему это интересно
   - Возможный hook
   - Ядро мысли
   - Какой угол можно взять, чтобы не копировать исходное видео
4. Если материал не даёт содержательной идеи для моего профиля — напиши FILTERED OUT.

Ищи неожиданные связи, конфликт идей, мифы, парадоксы, спорные утверждения и темы, которые могут вызвать обсуждение.`;

    for (let i = 0; i < candidates.length; i++) {
      const video = candidates[i];
      try {
        await authFetch(`/api/videos/${video.id}/run-stage1`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            promptTemplate: 'filter_screener',
            customPrompt: prompt,
          }),
        });
      } catch (_) {
        // Continue scanning the remaining corpus.
      }
      setScanProgress({ done: i + 1, total: candidates.length });
    }

    await onRefresh();
    setIsScanning(false);
  };

  if (!isOpen) return null;

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
              <p className="text-xs text-stone-500">Ищем идеи в подключённом контентном поле</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-stone-100 text-stone-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 sm:p-7 space-y-6">
          <div className="grid lg:grid-cols-[360px_1fr] gap-6">
            <aside className="space-y-4">
              <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Settings2 className="w-4 h-4 text-stone-500" />
                  <h3 className="text-sm font-bold">Моя контентная стратегия</h3>
                </div>
                <p className="text-[11px] text-stone-500 mb-3">
                  Это главный фильтр Radar. Опиши не только темы, но и какой контент ты считаешь интересным.
                </p>
                <textarea
                  value={interests}
                  onChange={e => saveInterests(e.target.value)}
                  rows={9}
                  className="w-full rounded-xl border border-stone-200 bg-white p-3 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              <div className="rounded-2xl border border-stone-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Youtube className="w-4 h-4 text-red-500" />
                  <h3 className="text-sm font-bold">Источники</h3>
                </div>
                {channels.length === 0 ? (
                  <p className="text-xs text-stone-500">Подключи хотя бы один YouTube-канал.</p>
                ) : (
                  <div className="space-y-2">
                    {channels.slice(0, 8).map(ch => (
                      <div key={ch.id} className="flex items-center gap-2 text-xs">
                        <div className="w-6 h-6 rounded-lg bg-stone-100 overflow-hidden shrink-0">
                          {ch.avatarUrl ? <img src={ch.avatarUrl} className="w-full h-full object-cover" /> : null}
                        </div>
                        <span className="truncate font-medium text-stone-700">{ch.title}</span>
                      </div>
                    ))}
                    {channels.length > 8 && <span className="text-[11px] text-stone-400">+ ещё {channels.length - 8}</span>}
                  </div>
                )}
              </div>

              <button
                onClick={scan}
                disabled={isScanning || candidates.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 disabled:opacity-50"
              >
                {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
                {isScanning ? `Сканирование ${scanProgress.done}/${scanProgress.total}` : `Сканировать ${candidates.length} новых видео`}
              </button>

              {scanError && <p className="text-xs text-rose-600">{scanError}</p>}
            </aside>

            <section>
              <div className="flex items-end justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">Radar feed</h3>
                  <p className="text-xs text-stone-500 mt-0.5">Материалы, прошедшие твой интеллектуальный фильтр</p>
                </div>
                <span className="text-[11px] text-stone-400">{radarResults.length} результатов</span>
              </div>

              {radarResults.length === 0 ? (
                <div className="min-h-[320px] rounded-2xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center text-center p-8">
                  <Sparkles className="w-8 h-8 text-emerald-500 mb-3" />
                  <h4 className="text-sm font-bold text-stone-800">Radar пока пуст</h4>
                  <p className="text-xs text-stone-500 max-w-sm mt-1">
                    Задай свою контентную стратегию и запусти сканирование. MVP пока использует подключённые YouTube-каналы как первый источник.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {radarResults.map(video => (
                    <article key={video.id} className="rounded-2xl border border-stone-200 p-4 hover:border-stone-300 transition">
                      <div className="flex gap-4">
                        {video.thumbnail && (
                          <img src={video.thumbnail} className="w-28 h-16 sm:w-36 sm:h-20 rounded-xl object-cover shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-stone-400 mb-1">{video.channelTitle}</div>
                          <h4 className="text-sm font-bold text-stone-900 line-clamp-2">{video.title}</h4>
                          <div className="mt-2 text-xs text-stone-600 whitespace-pre-wrap line-clamp-6">{video.geminiResult}</div>
                          <a href={video.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-700 mt-2">
                            Открыть источник <ExternalLink className="w-3 h-3" />
                          </a>
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
