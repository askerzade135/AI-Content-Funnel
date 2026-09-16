import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, 
  Clock, 
  Zap,
  DollarSign,
  Cpu,
  Layers,
  CheckCircle2,
  AlertTriangle,
  X
} from 'lucide-react';
import { StoredVideo, GeneratedScript, DailyActivityStats, GeminiUsageSummary, SupadataUsageSummary } from '../types';

interface DailyActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  videos?: StoredVideo[];
  scripts?: GeneratedScript[];
  serverDailyActivity?: DailyActivityStats;
  activeProcessingCount?: number;
  batchQueueCount?: number;
}

export const DailyActivityModal: React.FC<DailyActivityModalProps> = ({
  isOpen,
  onClose,
  videos: _videos,
  scripts: _scripts,
  serverDailyActivity,
  activeProcessingCount = 0,
  batchQueueCount = 0,
}) => {
  const [liveUsage, setLiveUsage] = useState<GeminiUsageSummary | null>(null);
  const [liveSupadata, setLiveSupadata] = useState<SupadataUsageSummary | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);

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

  // Fetch live Gemini and Supadata usage metrics when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoadingUsage(true);

    Promise.all([
      fetch('/api/gemini/usage').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/supadata/usage').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([geminiData, supadataData]) => {
        if (!isMounted) return;
        if (geminiData) setLiveUsage(geminiData);
        if (supadataData) setLiveSupadata(supadataData);
      })
      .catch((err) => {
        console.warn('Could not fetch usage endpoints:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingUsage(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Calculate 24-hour activity time label
  const timeWindowLabel = useMemo(() => {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const startTimeStr = new Date(twentyFourHoursAgo).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const startDateStr = new Date(twentyFourHoursAgo).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    });
    return `С ${startDateStr}, ${startTimeStr} по сейчас`;
  }, []);

  if (!isOpen) return null;

  const isPipelineActive = activeProcessingCount > 0 || batchQueueCount > 0;

  // Active usage summary (from live endpoint or serverDailyActivity)
  const usageStats = liveUsage || serverDailyActivity?.geminiUsage24h;
  const supadataStats: SupadataUsageSummary = liveSupadata || serverDailyActivity?.supadataUsage || {
    usedThisMonth: 0,
    monthlyLimit: 100,
    remainingThisMonth: 100,
    isLimitExceeded: false,
    usedLast24h: 0,
  };

  const freeRequestsCount = usageStats?.freeTier?.requestsCount ?? 0;
  const freePromptTokens = usageStats?.freeTier?.promptTokens ?? 0;
  const freeCandidatesTokens = usageStats?.freeTier?.candidatesTokens ?? 0;
  const freeThoughtsTokens = usageStats?.freeTier?.thoughtsTokens ?? 0;
  const freeTotalTokens = usageStats?.freeTier?.totalTokens ?? 0;
  const freeDailyLimit = usageStats?.freeTier?.dailyLimitRequests ?? 1500;
  const freeRemainingRequests = usageStats?.freeTier?.remainingRequests ?? Math.max(0, 1500 - freeRequestsCount);

  const paidRequestsCount = usageStats?.paidTier?.requestsCount ?? 0;
  const paidPromptTokens = usageStats?.paidTier?.promptTokens ?? 0;
  const paidCandidatesTokens = usageStats?.paidTier?.candidatesTokens ?? 0;
  const paidThoughtsTokens = usageStats?.paidTier?.thoughtsTokens ?? 0;
  const paidTotalTokens = usageStats?.paidTier?.totalTokens ?? 0;
  const paidCostUsd = usageStats?.paidTier?.estimatedCostUsd ?? 0;

  // Supadata progress calculations
  const sdUsed = supadataStats.usedThisMonth;
  const sdLimit = supadataStats.monthlyLimit || 100;
  const sdPercent = Math.min(100, Math.round((sdUsed / sdLimit) * 100));
  const sdExceeded = supadataStats.isLimitExceeded || sdUsed >= sdLimit;

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
                  Мониторинг квот и API
                </span>
                {isPipelineActive && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 animate-pulse">
                    <Zap className="w-2.5 h-2.5" />
                    Конвейер активен
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                {timeWindowLabel}
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

        {/* Section 1: Supadata API Gateway (Level B Subtitle Extraction) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 font-semibold text-stone-800">
                <Layers className="w-3.5 h-3.5 text-cyan-600" />
                <span>Расход Supadata API (Уровень B)</span>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
                Обход BotGuard
              </span>
            </div>
            {sdExceeded ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                <AlertTriangle className="w-3 h-3 text-amber-600" />
                Лимит исчерпан → Level C Auto-Fallback
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                Квота активна
              </span>
            )}
          </div>

          {/* Supadata Metric Card */}
          <div className="bg-gradient-to-br from-cyan-50/50 to-stone-50/70 border border-cyan-100/90 rounded-2xl p-4 flex flex-col justify-between space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-cyan-900 uppercase tracking-wider">
                    Ежемесячный лимит запросов
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-100/80 text-cyan-800 font-semibold border border-cyan-200/60">
                    {supadataStats.planName || 'Free (100/mo)'}
                  </span>
                  {supadataStats.isLiveAccount && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200" title="Прямая синхронизация с api.supadata.ai/v1/me">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live аккаунт
                    </span>
                  )}
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-stone-900 mt-1.5">
                  {sdUsed}
                  <span className="text-sm font-normal text-stone-500 ml-1.5">
                    / {sdLimit} кредитов
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-1">
                  Использовано за последние 24ч: <strong className="text-stone-700">{supadataStats.usedLast24h}</strong> кред.
                </p>
              </div>

              <div className="text-right">
                <div className="text-xs text-stone-500">Остаток на месяц:</div>
                <div className={`text-xl font-bold mt-0.5 ${sdExceeded ? 'text-amber-600' : 'text-emerald-700'}`}>
                  {sdExceeded ? '0' : supadataStats.remainingThisMonth}
                </div>
                <div className="text-[11px] text-stone-400">
                  {sdPercent}% израсходовано
                </div>
              </div>
            </div>

            {/* Supadata Progress Bar */}
            <div className="space-y-1.5 pt-1">
              <div className="w-full bg-stone-200/80 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    sdExceeded ? 'bg-amber-500' : sdPercent > 80 ? 'bg-amber-400' : 'bg-cyan-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(sdUsed > 0 ? 3 : 0, sdPercent))}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-stone-500 pt-0.5">
                <span>
                  {sdExceeded 
                    ? '⚠️ Лимит превышен: конвейер бесшовно переходит на Gemini Audio (Уровень В)' 
                    : `Доступно еще ${supadataStats.remainingThisMonth} кредитов из 100 бесплатных в месяц`}
                </span>
                <span className="font-semibold text-stone-700">
                  {sdPercent}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Gemini API Usage Statistics (Last 24 Hours) */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 font-semibold text-stone-800">
                <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                <span>Расход Gemini API (24ч)</span>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-stone-100 text-stone-600 border border-stone-200">
                usageMetadata из API
              </span>
            </div>
            {isLoadingUsage && (
              <span className="text-[11px] text-stone-400 animate-pulse">
                Обновление данных...
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Block 1: Free Tier */}
            <div className="bg-emerald-50/40 border border-emerald-200/80 rounded-2xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 uppercase tracking-wider">
                    <Activity className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Бесплатный тир</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100/80 text-emerald-800 border border-emerald-200">
                    Flash 2.5
                  </span>
                </div>

                <div className="mt-2">
                  <div className="text-2xl sm:text-3xl font-extrabold text-emerald-950">
                    {freeRequestsCount}
                    <span className="text-xs font-normal text-emerald-700 ml-1.5">
                      из {freeDailyLimit.toLocaleString('ru-RU')} зап.
                    </span>
                  </div>
                  <p className="text-xs text-emerald-700/80 mt-0.5">
                    {freeTotalTokens.toLocaleString('ru-RU')} токенов всего
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-emerald-200/60 space-y-2 text-xs">
                <div className="flex items-center justify-between text-emerald-900 text-[11px]">
                  <span>Вход (Input): <strong>{freePromptTokens.toLocaleString('ru-RU')}</strong> тк.</span>
                  <span>Выход (Output): <strong>{(freeCandidatesTokens + freeThoughtsTokens).toLocaleString('ru-RU')}</strong> тк.</span>
                </div>

                <div className="bg-white/80 border border-emerald-200/80 rounded-xl p-2 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-stone-600">Дневной лимит (RPD):</span>
                    <span className="font-semibold text-emerald-900">
                      {freeRequestsCount} из {freeDailyLimit.toLocaleString('ru-RU')} зап.
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-stone-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(freeRequestsCount > 0 ? 3 : 0, (freeRequestsCount / freeDailyLimit) * 100))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-stone-500 pt-0.5">
                    <span>Осталось до лимита:</span>
                    <span className="font-medium text-emerald-700">
                      <strong>{freeRemainingRequests.toLocaleString('ru-RU')}</strong> зап.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Block 2: Paid Tier */}
            <div className="bg-amber-50/40 border border-amber-200/80 rounded-2xl p-4 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 uppercase tracking-wider">
                    <DollarSign className="w-3.5 h-3.5 text-amber-600" />
                    <span>Платный тир ($)</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100/80 text-amber-800 border border-amber-200">
                    Тариф Gemini
                  </span>
                </div>

                <div className="mt-2">
                  <div className="text-2xl sm:text-3xl font-extrabold text-amber-950">
                    ${paidCostUsd.toFixed(4)}
                    <span className="text-xs font-normal text-amber-700 ml-1.5">USD</span>
                  </div>
                  <p className="text-xs text-amber-700/80 mt-0.5">
                    {paidTotalTokens.toLocaleString('ru-RU')} токенов ({paidRequestsCount} оп.)
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-amber-200/60 space-y-2 text-xs">
                <div className="flex items-center justify-between text-amber-900 text-[11px]">
                  <span>Вход (Input): <strong>{paidPromptTokens.toLocaleString('ru-RU')}</strong> тк.</span>
                  <span>Выход (Output): <strong>{(paidCandidatesTokens + paidThoughtsTokens).toLocaleString('ru-RU')}</strong> тк.</span>
                </div>

                <div className="bg-white/80 border border-amber-200/80 rounded-xl p-2 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-stone-600">Статус расходов:</span>
                    <span className="font-semibold text-amber-900">
                      {paidRequestsCount > 0 ? `${paidRequestsCount} платных зап.` : 'Нет платных списаний'}
                    </span>
                  </div>
                  <p className="text-[10px] text-stone-500 leading-tight">
                    Тариф: $0.075 / $0.30 за 1M Flash, $1.25 / $5.00 за 1M Pro.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


