import React, { useState, useMemo } from 'react';
import { 
  Activity, 
  Film, 
  Sparkles, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  ChevronDown, 
  ChevronUp, 
  BarChart3, 
  Zap
} from 'lucide-react';
import { StoredVideo, GeneratedScript, DailyActivityStats } from '../types';

interface DailyActivityWidgetProps {
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

export const DailyActivityWidget: React.FC<DailyActivityWidgetProps> = ({
  videos,
  scripts,
  serverDailyActivity,
  activeProcessingCount = 0,
  batchQueueCount = 0,
}) => {
  const [showChart, setShowChart] = useState(true);
  const [hoveredBucket, setHoveredBucket] = useState<HourlyBucket | null>(null);

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

  const isPipelineActive = activeProcessingCount > 0 || batchQueueCount > 0;

  return (
    <div id="daily-activity-widget" className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200/70 flex items-center justify-center text-amber-700 shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-stone-900">Дневная активность (24ч)</h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-600 border border-stone-200">
                <Clock className="w-2.5 h-2.5 text-stone-500" />
                24 часа
              </span>
              {isPipelineActive && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 animate-pulse">
                  <Zap className="w-2.5 h-2.5" />
                  Конвейер активен
                </span>
              )}
            </div>
            <p className="text-[11px] text-stone-500 mt-0.5">
              {activityData.timeWindowLabel} • Текущая пропускная способность конвейера
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setShowChart(!showChart)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200/80 rounded-lg transition cursor-pointer"
            title={showChart ? 'Скрыть почасовой график' : 'Показать почасовой график'}
          >
            <BarChart3 className="w-3.5 h-3.5 text-stone-500" />
            <span>{showChart ? 'Скрыть график' : 'Почасовой график'}</span>
            {showChart ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Primary KPI Throughput Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Card 1: Processed Videos */}
        <div className="bg-stone-50/70 border border-stone-200 rounded-xl p-3.5 flex flex-col justify-between hover:border-stone-300 transition">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-stone-700 uppercase tracking-wider">
                <Film className="w-3.5 h-3.5 text-sky-600" />
                <span>Обработано видео</span>
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-stone-900 mt-1">
                {activityData.processedVideosCount}
                <span className="text-xs font-normal text-stone-500 ml-2">
                  за 24ч (~{activityData.videosPerHour}/ч)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-stone-200/70 text-xs flex-wrap">
            {/* Non-clickable static badge */}
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium select-none">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Одобрено: <strong>{activityData.approvedVideosCount}</strong></span>
            </span>
            {/* Non-clickable static badge */}
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-stone-100 text-stone-700 border border-stone-200 font-medium select-none">
              <XCircle className="w-3 h-3 text-stone-400" />
              <span>Отклонено: <strong>{activityData.rejectedVideosCount}</strong></span>
            </span>
          </div>
        </div>

        {/* Card 2: Generated Scripts - ONLY the count for the last 24h, no breakdown */}
        <div className="bg-purple-50/40 border border-purple-100 rounded-xl p-3.5 flex flex-col justify-between hover:border-purple-200 transition">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-purple-900 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>Создано сценариев</span>
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-purple-900 mt-1">
                {activityData.generatedScriptsCount}
                <span className="text-xs font-normal text-purple-700/80 ml-2">
                  за 24ч (~{activityData.scriptsPerHour}/ч)
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-purple-100 text-xs text-purple-800/80 flex items-center justify-between">
            <span className="text-[11px]">За последний день (24 часа)</span>
            <span className="font-semibold text-purple-900">{activityData.generatedScriptsCount} сц.</span>
          </div>
        </div>
      </div>

      {/* 24-Hour Hourly Throughput Visualizer (Chart) */}
      {showChart && (
        <div className="pt-2 border-t border-stone-100">
          <div className="flex items-center justify-between text-xs text-stone-500 mb-2">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-stone-700">Почасовая разбивка за 24 часа:</span>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 inline-block" />
                <span>Видео</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2.5 h-2.5 rounded-xs bg-purple-500 inline-block" />
                <span>Сценарии</span>
              </div>
            </div>
            {activityData.peakBucket.totalCount > 0 && (
              <span className="text-[11px] text-stone-500 hidden sm:inline">
                Пик: <strong>{activityData.peakBucket.hourLabel}</strong> ({activityData.peakBucket.totalCount} оп.)
              </span>
            )}
          </div>

          {/* Bar Chart Bars Container */}
          <div className="relative bg-stone-50/70 border border-stone-200/80 rounded-xl p-3">
            <div className="h-16 flex items-end gap-1 sm:gap-1.5">
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
                    {/* The Stacked Bar */}
                    <div 
                      className={`w-full rounded-xs transition-all duration-200 overflow-hidden flex flex-col justify-end ${
                        isHovered ? 'ring-2 ring-stone-900/30 brightness-110' : ''
                      } ${total === 0 ? 'bg-stone-200/60' : 'bg-stone-100'}`}
                      style={{ height: `${heightPercent}%` }}
                    >
                      {/* Scripts portion (top) */}
                      {scriptPercent > 0 && (
                        <div 
                          className="w-full bg-purple-500" 
                          style={{ height: `${scriptPercent}%` }} 
                        />
                      )}
                      {/* Videos portion (bottom) */}
                      {videoPercent > 0 && (
                        <div 
                          className="w-full bg-sky-500" 
                          style={{ height: `${videoPercent}%` }} 
                        />
                      )}
                    </div>

                    {/* Timeline hour ticks (every 4 hours or first/last) */}
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
            <div className="mt-2 text-xs flex items-center justify-between text-stone-600 bg-white/90 border border-stone-200/80 rounded-lg px-2.5 py-1 min-h-[28px]">
              {hoveredBucket ? (
                <div className="flex items-center gap-3 text-[11px] font-medium w-full justify-between">
                  <span className="text-stone-800 font-semibold">{hoveredBucket.fullTimeLabel}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sky-700">Видео: <strong>{hoveredBucket.videosCount}</strong></span>
                    <span className="text-purple-700">Сценариев: <strong>{hoveredBucket.scriptsCount}</strong></span>
                    <span className="text-stone-900 font-bold">Всего: {hoveredBucket.totalCount}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-stone-400 flex items-center justify-between w-full">
                  <span>Наведите курсор на столбик времени для детализации по часам</span>
                  <span>{activityData.timeWindowLabel}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
