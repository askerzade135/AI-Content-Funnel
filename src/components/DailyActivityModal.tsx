import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, 
  Film, 
  Sparkles, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  BarChart3, 
  Zap,
  X
} from 'lucide-react';
import { StoredVideo, GeneratedScript, DailyActivityStats } from '../types';

interface DailyActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  videos: StoredVideo[];
  scripts: GeneratedScript[];
  serverDailyActivity?: DailyActivityStats;
  activeProcessingCount?: number;
  batchQueueCount?: number;
}

interface HourlyBucket {
  hourLabel: string;
  fullTimeLabel: string;
  videosCount: number;
  scriptsCount: number;
  totalCount: number;
  isCurrentHour: boolean;
}

export const DailyActivityModal: React.FC<DailyActivityModalProps> = ({
  isOpen,
  onClose,
  videos,
  scripts,
  serverDailyActivity,
  activeProcessingCount = 0,
  batchQueueCount = 0,
}) => {
  const [hoveredBucket, setHoveredBucket] = useState<HourlyBucket | null>(null);

  // Close modal on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Calculate 24-hour activity metrics
  const activityData = useMemo(() => {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    // Filter videos processed in the last 24 hours
    const recentVideos = videos.filter((v) => {
      if (v.status !== 'completed' && !v.geminiResult) return false;
      const timestampStr = v.processedAt || v.updatedAt;
      if (!timestampStr) return false;
      const t = new Date(timestampStr).getTime();
      return !isNaN(t) && t >= twentyFourHoursAgo;
    });

    const processedVideosCount = recentVideos.length;
    const approvedVideosCount = recentVideos.filter((v) => v.matchedFilter === true).length;
    const rejectedVideosCount = recentVideos.filter((v) => v.matchedFilter === false).length;

    // Filter scripts generated in the last 24 hours
    const recentScripts = (scripts || []).filter((s) => {
      if (!s.createdAt) return false;
      const t = new Date(s.createdAt).getTime();
      return !isNaN(t) && t >= twentyFourHoursAgo;
    });

    const generatedScriptsCount = recentScripts.length;

    // Build 24 hourly buckets (from 23 hours ago to current hour)
    const buckets: HourlyBucket[] = [];
    const oneHourMs = 60 * 60 * 1000;
    const currentHourStart = new Date(now).setMinutes(0, 0, 0);

    for (let i = 23; i >= 0; i--) {
      const bucketStart = currentHourStart - i * oneHourMs;
      const bucketEnd = bucketStart + oneHourMs;
      const dateObj = new Date(bucketStart);

      const hourLabel = dateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const nextHourObj = new Date(bucketEnd);
      const nextHourLabel = nextHourObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const dayLabel = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

      const videosInBucket = recentVideos.filter((v) => {
        const time = new Date(v.processedAt || v.updatedAt).getTime();
        return time >= bucketStart && time < bucketEnd;
      }).length;

      const scriptsInBucket = recentScripts.filter((s) => {
        const time = new Date(s.createdAt).getTime();
        return time >= bucketStart && time < bucketEnd;
      }).length;

      buckets.push({
        hourLabel,
        fullTimeLabel: `${dayLabel}, ${hourLabel} – ${nextHourLabel}`,
        videosCount: videosInBucket,
        scriptsCount: scriptsInBucket,
        totalCount: videosInBucket + scriptsInBucket,
        isCurrentHour: i === 0,
      });
    }

    const maxBucketTotal = Math.max(...buckets.map((b) => b.totalCount), 1);
    const peakBucket = buckets.reduce((max, b) => (b.totalCount > max.totalCount ? b : max), buckets[0]);

    // Format start time string (24 hours ago)
    const startTimeStr = new Date(twentyFourHoursAgo).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const startDateStr = new Date(twentyFourHoursAgo).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    });

    return {
      processedVideosCount,
      approvedVideosCount,
      rejectedVideosCount,
      generatedScriptsCount,
      buckets,
      maxBucketTotal,
      peakBucket,
      timeWindowLabel: `С ${startDateStr}, ${startTimeStr} по сейчас`,
      videosPerHour: (processedVideosCount / 24).toFixed(1),
      scriptsPerHour: (generatedScriptsCount / 24).toFixed(1),
    };
  }, [videos, scripts]);

  if (!isOpen) return null;

  const isPipelineActive = activeProcessingCount > 0 || batchQueueCount > 0;

  return (
    <div 
      id="daily-activity-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div 
        id="daily-activity-modal" 
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200/70 flex items-center justify-center text-amber-700 shrink-0 shadow-2xs">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-stone-900">Дневная активность</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-stone-100 text-stone-600 border border-stone-200">
                  <Clock className="w-3 h-3 text-stone-500" />
                  Последние 24 часа
                </span>
                {isPipelineActive && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 animate-pulse">
                    <Zap className="w-2.5 h-2.5" />
                    Конвейер активен
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                {activityData.timeWindowLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-xl transition cursor-pointer"
            title="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Card 1: Processed Videos */}
          <div className="bg-stone-50/80 border border-stone-200 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-stone-600 uppercase tracking-wider">
                <Film className="w-3.5 h-3.5 text-sky-600" />
                <span>Обработано видео</span>
              </div>
              <div className="text-3xl font-extrabold text-stone-900 mt-1.5">
                {activityData.processedVideosCount}
                <span className="text-xs font-normal text-stone-500 ml-2">
                  (~{activityData.videosPerHour}/ч)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-stone-200 text-xs flex-wrap">
              {/* Static non-clickable badge */}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium select-none">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Одобрено: <strong>{activityData.approvedVideosCount}</strong></span>
              </span>
              {/* Static non-clickable badge */}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-100 text-stone-700 border border-stone-200 font-medium select-none">
                <XCircle className="w-3.5 h-3.5 text-stone-400" />
                <span>Отклонено: <strong>{activityData.rejectedVideosCount}</strong></span>
              </span>
            </div>
          </div>

          {/* Card 2: Generated Scripts - ONLY the count for the last 24 hours */}
          <div className="bg-purple-50/40 border border-purple-100 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-purple-900 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>Создано сценариев</span>
              </div>
              <div className="text-3xl font-extrabold text-purple-900 mt-1.5">
                {activityData.generatedScriptsCount}
                <span className="text-xs font-normal text-purple-700/80 ml-2">
                  (~{activityData.scriptsPerHour}/ч)
                </span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-purple-100/80 text-xs text-purple-800/80 flex items-center justify-between">
              <span className="text-[11px]">За последний день (24 часа)</span>
              <span className="font-semibold text-purple-900">{activityData.generatedScriptsCount} сц.</span>
            </div>
          </div>
        </div>

        {/* 24-Hour Hourly Visualizer - ALWAYS EXPANDED */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-1.5 font-semibold text-stone-800">
                <BarChart3 className="w-3.5 h-3.5 text-stone-500" />
                <span>Почасовая активность (24ч)</span>
              </div>
              <div className="hidden sm:flex items-center gap-2 text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 inline-block" />
                  <span>Видео</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-purple-500 inline-block" />
                  <span>Сценарии</span>
                </span>
              </div>
            </div>
            {activityData.peakBucket.totalCount > 0 && (
              <span className="text-[11px] text-stone-500">
                Пик: <strong>{activityData.peakBucket.hourLabel}</strong> ({activityData.peakBucket.totalCount} оп.)
              </span>
            )}
          </div>

          <div className="bg-stone-50/80 border border-stone-200/80 rounded-2xl p-3.5">
            <div className="h-20 flex items-end gap-1 sm:gap-1.5">
              {activityData.buckets.map((bucket, idx) => {
                const total = bucket.totalCount;
                const heightPercent = total > 0 
                  ? Math.max(14, Math.round((total / activityData.maxBucketTotal) * 100))
                  : 6;

                const videoPercent = total > 0 ? (bucket.videosCount / total) * 100 : 0;
                const scriptPercent = total > 0 ? (bucket.scriptsCount / total) * 100 : 0;

                const isHovered = hoveredBucket === bucket;

                return (
                  <div
                    key={idx}
                    className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                    onMouseEnter={() => setHoveredBucket(bucket)}
                    onMouseLeave={() => setHoveredBucket(null)}
                  >
                    <div 
                      className={`w-full rounded-xs transition-all duration-200 overflow-hidden flex flex-col justify-end ${
                        isHovered ? 'ring-2 ring-stone-900/30 brightness-110' : ''
                      } ${total === 0 ? 'bg-stone-200/60' : 'bg-stone-100'}`}
                      style={{ height: `${heightPercent}%` }}
                    >
                      {scriptPercent > 0 && (
                        <div 
                          className="w-full bg-purple-500" 
                          style={{ height: `${scriptPercent}%` }} 
                        />
                      )}
                      {videoPercent > 0 && (
                        <div 
                          className="w-full bg-sky-500" 
                          style={{ height: `${videoPercent}%` }} 
                        />
                      )}
                    </div>

                    {(idx % 4 === 0 || idx === 23) && (
                      <span className="text-[9px] text-stone-400 mt-1 font-mono leading-none select-none">
                        {bucket.hourLabel.slice(0, 2)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Hover Tooltip / Status Display */}
            <div className="mt-3 text-xs flex items-center justify-between text-stone-600 bg-white border border-stone-200 rounded-xl px-3 py-1.5 min-h-[32px]">
              {hoveredBucket ? (
                <div className="flex items-center gap-3 text-[11px] font-medium w-full justify-between flex-wrap">
                  <span className="text-stone-800 font-semibold">{hoveredBucket.fullTimeLabel}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sky-700">Видео: <strong>{hoveredBucket.videosCount}</strong></span>
                    <span className="text-purple-700">Сценариев: <strong>{hoveredBucket.scriptsCount}</strong></span>
                    <span className="text-stone-900 font-bold">Всего: {hoveredBucket.totalCount}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-stone-400 flex items-center justify-between w-full">
                  <span>Наведите курсор на столбик времени для просмотра деталей</span>
                  <span className="hidden sm:inline">24 часа</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
