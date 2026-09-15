import React, { useState, useEffect } from 'react';
import { X, Loader2, Square, Film, AlertCircle, Clock, RotateCw, ArrowUpDown } from 'lucide-react';
import { StoredVideo } from '../types';
import { isProcessing, isEligibleForQueue, isRateLimited, VIDEO_STATUS } from '../utils/video-actions';

interface QueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  videos: StoredVideo[];
  batchQueueIds?: string[];
  onStopProcess: (video: StoredVideo) => void;
  onClearAllQueue?: () => void;
  onRetryRateLimited?: (videoIds: string[]) => void;
}

export const QueueModal: React.FC<QueueModalProps> = ({
  isOpen,
  onClose,
  videos,
  batchQueueIds = [],
  onStopProcess,
  onClearAllQueue,
  onRetryRateLimited,
}) => {
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [queueSortOrder, setQueueSortOrder] = useState<'asc' | 'desc'>('asc');
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const formatQueueTime = (isoString?: string) => {
    if (!isoString) return null;
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return null;

      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (isToday) {
        return timeStr;
      }
      const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      return `${dateStr}, ${timeStr}`;
    } catch {
      return null;
    }
  };

  const activeVideos = videos.filter(isProcessing);
  
  const activeIds = new Set(activeVideos.map(v => v.id));

  // Queued videos: combined from batchQueueIds and any pending videos with queueTimestamp
  const queuedVideoMap = new Map<string, StoredVideo>();

  (batchQueueIds || [])
    .filter((id) => !activeIds.has(id))
    .forEach((id) => {
      const v = videos.find((item) => item.id === id);
      if (v && isEligibleForQueue(v)) {
        queuedVideoMap.set(id, v);
      }
    });

  videos.forEach((v) => {
    if (v.queueTimestamp && !activeIds.has(v.id) && isEligibleForQueue(v)) {
      queuedVideoMap.set(v.id, v);
    }
  });

  const queuedVideos = Array.from(queuedVideoMap.values()).sort((a, b) => {
    const timeA = a.queueTimestamp ? new Date(a.queueTimestamp).getTime() : 0;
    const timeB = b.queueTimestamp ? new Date(b.queueTimestamp).getTime() : 0;
    if (timeA && timeB) {
      return queueSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    }
    if (timeA && !timeB) return queueSortOrder === 'asc' ? -1 : 1;
    if (!timeA && timeB) return queueSortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const inQueueIds = new Set([...activeVideos.map(v => v.id), ...queuedVideos.map(v => v.id)]);

  const rateLimitedVideos = videos.filter(
    (v) => !inQueueIds.has(v.id) && isRateLimited(v)
  );

  const now = Date.now();
  const cooldownSeconds = 60;

  const rateLimitedWithCooldown = rateLimitedVideos.map((video) => {
    const updatedAtTime = video.updatedAt ? new Date(video.updatedAt).getTime() : 0;
    const elapsed = (now - updatedAtTime) / 1000;
    const remaining = Math.max(0, Math.ceil(cooldownSeconds - elapsed));
    return {
      video,
      remainingCooldown: remaining,
      isReady: remaining === 0,
    };
  });

  const readyForRetryIds = rateLimitedWithCooldown.filter((item) => item.isReady).map((item) => item.video.id);

  const totalQueueCount = activeVideos.length + queuedVideos.length + rateLimitedVideos.length;

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        id="queue-modal-container"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden border border-stone-200"
      >
        {/* Header */}
        <div className="p-5 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 relative">
              {totalQueueCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-sky-500 animate-ping" />
              )}
              <Loader2 className={`w-5 h-5 ${totalQueueCount > 0 ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">Очередь обработки видео</h2>
              <p className="text-xs text-stone-500">
                {totalQueueCount > 0
                  ? `Активно: ${activeVideos.length} | В очереди: ${queuedVideos.length} (параллельно до 3)`
                  : 'Нет видео в процессе обработки'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {totalQueueCount === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-12 h-12 rounded-2xl bg-stone-100 text-stone-400 flex items-center justify-center mx-auto mb-3">
                <Film className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-stone-800 mb-1">Очередь обработки пуста</h3>
              <p className="text-xs text-stone-500 max-w-sm mx-auto">
                Когда вы запустите 1 этап (фильтр) или 2 этап для видео или каналов, они появятся здесь в режиме реального времени.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Active Processing Section */}
              {activeVideos.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-sky-700 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                      Сейчас обрабатывается ({activeVideos.length})
                    </h3>
                  </div>
                  <div className="space-y-2.5">
                    {activeVideos.map((video) => {
                      const isTranscribing = video.status === VIDEO_STATUS.TRANSCRIBING;
                      return (
                        <div
                          key={video.id}
                          className="flex items-center justify-between gap-3 p-3.5 bg-sky-50/40 hover:bg-sky-50/80 border border-sky-200/80 rounded-xl transition"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-16 h-10 bg-stone-200 rounded-lg overflow-hidden shrink-0 relative">
                              <img
                                src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
                                alt={video.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-[10px] font-semibold text-stone-500 truncate">
                                  {video.channelTitle}
                                </span>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-100 text-sky-800 border border-sky-300 animate-pulse">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin text-sky-700" />
                                  {isTranscribing ? 'Транскрибация...' : 'Анализ Gemini...'}
                                </span>
                                {video.queueTimestamp && (
                                  <span 
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-200"
                                    title={`Дата и время постановки в очередь: ${new Date(video.queueTimestamp).toLocaleString('ru-RU')}`}
                                  >
                                    <Clock className="w-2.5 h-2.5 text-sky-600" />
                                    <span>В очереди с: {formatQueueTime(video.queueTimestamp)}</span>
                                  </span>
                                )}
                              </div>
                              <h4 className="text-xs font-bold text-stone-900 truncate" title={video.title}>
                                {video.title}
                              </h4>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] text-sky-700 font-medium bg-sky-100 px-2 py-1 rounded-lg">
                              ~15–25 сек
                            </span>
                            <button
                              type="button"
                              onClick={() => onStopProcess(video)}
                              title="Остановить обработку этого видео"
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition shadow-2xs cursor-pointer whitespace-nowrap"
                            >
                              <Square className="w-3 h-3 fill-current text-red-600" />
                              <span>Остановить</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Queued Section */}
              {queuedVideos.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      В очереди ожидания ({queuedVideos.length})
                    </h3>

                    {queuedVideos.length > 1 && (
                      <div className="flex items-center gap-1 bg-stone-100 p-0.5 rounded-lg border border-stone-200 text-[11px]">
                        <span className="text-[10px] text-stone-500 px-1 font-medium flex items-center gap-1">
                          <ArrowUpDown className="w-3 h-3 text-stone-400" />
                          Сортировка:
                        </span>
                        <button
                          type="button"
                          onClick={() => setQueueSortOrder('asc')}
                          className={`px-2 py-0.5 rounded-md transition cursor-pointer flex items-center gap-1 ${
                            queueSortOrder === 'asc'
                              ? 'bg-white text-stone-900 shadow-2xs font-semibold'
                              : 'text-stone-500 hover:text-stone-800'
                          }`}
                          title="Сортировать по дате постановки в очередь: сначала старые (FIFO)"
                        >
                          Сначала старые
                        </button>
                        <button
                          type="button"
                          onClick={() => setQueueSortOrder('desc')}
                          className={`px-2 py-0.5 rounded-md transition cursor-pointer flex items-center gap-1 ${
                            queueSortOrder === 'desc'
                              ? 'bg-white text-stone-900 shadow-2xs font-semibold'
                              : 'text-stone-500 hover:text-stone-800'
                          }`}
                          title="Сортировать по дате постановки в очередь: сначала новые (LIFO)"
                        >
                          Сначала новые
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2.5">
                    {queuedVideos.map((video, idx) => {
                      const formattedTime = formatQueueTime(video.queueTimestamp);
                      return (
                        <div
                          key={video.id}
                          className="flex items-center justify-between gap-3 p-3.5 bg-stone-50 hover:bg-stone-100/80 border border-stone-200 rounded-xl transition"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-16 h-10 bg-stone-200 rounded-lg overflow-hidden shrink-0 relative">
                              <img
                                src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
                                alt={video.title}
                                className="w-full h-full object-cover"
                              />
                              <span className="absolute bottom-0.5 right-0.5 bg-stone-900/80 text-white text-[9px] font-bold px-1 rounded">
                                #{idx + 1}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-[10px] font-semibold text-stone-500 truncate">
                                  {video.channelTitle}
                                </span>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                  В очереди (#{idx + 1})
                                </span>
                                {video.queueTimestamp && (
                                  <span 
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-stone-200/70 text-stone-700 border border-stone-300/80"
                                    title={`Дата и время постановки в очередь: ${new Date(video.queueTimestamp).toLocaleString('ru-RU')}`}
                                  >
                                    <Clock className="w-2.5 h-2.5 text-stone-500" />
                                    <span>В очереди с: {formattedTime}</span>
                                  </span>
                                )}
                              </div>
                              <h4 className="text-xs font-bold text-stone-900 truncate" title={video.title}>
                                {video.title}
                              </h4>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] text-stone-500 font-medium bg-stone-100 px-2 py-1 rounded-lg whitespace-nowrap">
                              ~{Math.ceil((idx + 1) / 3) * 20} сек
                            </span>
                            <button
                              type="button"
                              onClick={() => onStopProcess(video)}
                              title="Убрать из очереди / остановить"
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-stone-600 bg-white hover:bg-red-50 hover:text-red-700 border border-stone-200 hover:border-red-200 rounded-lg transition shadow-2xs cursor-pointer whitespace-nowrap"
                            >
                              <Square className="w-3 h-3 fill-current text-stone-400 group-hover:text-red-600" />
                              <span>Убрать</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Rate Limited / Quota Exceeded Videos (Waiting for retry) */}
              {rateLimitedWithCooldown.length > 0 && (
                <div className="pt-2 border-t border-stone-200">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                      Видео с превышением квоты ({rateLimitedWithCooldown.length})
                    </h3>
                    {readyForRetryIds.length > 0 && onRetryRateLimited && (
                      <button
                        type="button"
                        onClick={() => onRetryRateLimited(readyForRetryIds)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition cursor-pointer"
                      >
                        <RotateCw className="w-3 h-3" />
                        Повторить готовые ({readyForRetryIds.length})
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {rateLimitedWithCooldown.map(({ video, remainingCooldown, isReady }) => (
                      <div
                        key={video.id}
                        className="flex items-center justify-between gap-3 p-3 bg-rose-50/50 border border-rose-200/70 rounded-xl"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-14 h-9 bg-stone-200 rounded-lg overflow-hidden shrink-0">
                            <img
                              src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
                              alt={video.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-stone-900 truncate" title={video.title}>
                              {video.title}
                            </h4>
                            <p className="text-[10px] text-rose-600 truncate mt-0.5">
                              {video.error || 'Лимит квоты Gemini'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isReady ? (
                            onRetryRateLimited && (
                              <button
                                type="button"
                                onClick={() => onRetryRateLimited([video.id])}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-white hover:bg-rose-100 border border-rose-300 rounded-lg transition cursor-pointer"
                              >
                                <RotateCw className="w-3 h-3" />
                                В очередь
                              </button>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-stone-600 bg-white border border-stone-200 rounded-lg">
                              <Clock className="w-3 h-3 text-stone-400" />
                              Ожидание: {remainingCooldown}с
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-stone-200 bg-stone-50 flex items-center justify-between text-xs text-stone-500">
          <div className="flex items-center gap-3">
            <span>Воркер: до 3 потоков</span>
            {totalQueueCount > 0 && onClearAllQueue && (
              isConfirmingClear ? (
                <div className="flex items-center gap-2 bg-red-50 p-1.5 rounded-xl border border-red-200">
                  <span className="text-red-800 font-bold px-1">Очистить всю очередь?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsConfirmingClear(false);
                      onClearAllQueue();
                    }}
                    className="px-2.5 py-1 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition cursor-pointer shadow-xs"
                  >
                    Да, очистить
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsConfirmingClear(false)}
                    className="px-2.5 py-1 bg-white text-stone-700 border border-stone-300 font-medium rounded-lg hover:bg-stone-100 transition cursor-pointer"
                  >
                    Отмена
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsConfirmingClear(true)}
                  className="text-red-600 hover:text-red-700 font-semibold hover:underline cursor-pointer"
                >
                  Очистить очередь
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
