import React, { useState, useEffect, useCallback } from 'react';
import { 
  Gauge, 
  Layers, 
  DollarSign, 
  Cpu, 
  Activity, 
  X, 
  RefreshCw, 
  Zap, 
  ShieldCheck,
  CreditCard,
  Loader2
} from 'lucide-react';
import { 
  DailyActivityStats, 
  GeminiUsageSummary, 
  SupadataUsageSummary, 
  ChocodataUsageSummary,
  ProviderQuotaInfo 
} from '../types';
import { QuotaCard } from './QuotaCard';

export interface QuotaMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverDailyActivity?: DailyActivityStats;
  activeProcessingCount?: number;
  batchQueueCount?: number;
}

export const QuotaMonitorModal: React.FC<QuotaMonitorModalProps> = ({
  isOpen,
  onClose,
  serverDailyActivity,
  activeProcessingCount = 0,
  batchQueueCount = 0,
}) => {
  // Top-level Segmented Control: 'free' (default) vs 'paid'
  const [quotaType, setQuotaType] = useState<'free' | 'paid'>('free');
  
  const [providersData, setProvidersData] = useState<ProviderQuotaInfo[]>([]);
  const [liveUsage, setLiveUsage] = useState<GeminiUsageSummary | null>(null);
  const [quotaOverview, setQuotaOverview] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

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

  // Fetch live quota and usage data
  const fetchUsageData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [providersRes, geminiData, supadataData, chocodataData, quotaData] = await Promise.all([
        fetch('/api/transcript-providers/usage').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/gemini/usage').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/supadata/usage').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/chocodata/usage').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/quota-overview').then((r) => (r.ok ? r.json() : null)),
      ]);

      if (geminiData) setLiveUsage(geminiData);
      if (quotaData) setQuotaOverview(quotaData);

      if (providersRes?.providers && Array.isArray(providersRes.providers) && providersRes.providers.length > 0) {
        setProvidersData(providersRes.providers);
      } else {
        // Fallback synthesis if unified endpoint isn't ready
        const list: ProviderQuotaInfo[] = [];
        const sd: SupadataUsageSummary = supadataData || serverDailyActivity?.supadataUsage || {
          usedThisMonth: 0,
          monthlyLimit: 100,
          remainingThisMonth: 100,
          isLimitExceeded: false,
          usedLast24h: 0,
        };
        list.push({
          id: 'supadata',
          name: 'Supadata API',
          levelTag: 'Уровень Б',
          planBadge: sd.planName || 'Free (100/mo)',
          used: sd.usedThisMonth,
          limit: sd.monthlyLimit || 100,
          remaining: sd.remainingThisMonth,
          resetPolicy: 'monthly',
          usedLast24h: sd.usedLast24h,
          isLimitExceeded: sd.isLimitExceeded || sd.usedThisMonth >= (sd.monthlyLimit || 100),
          isLiveAccount: sd.isLiveAccount,
          fallbackTargetName: 'ChocoData (Уровень Б2)',
          unitLabel: 'кредитов',
        });

        const cd: ChocodataUsageSummary = chocodataData || serverDailyActivity?.chocodataUsage || {
          usedTotal: 0,
          totalLimit: 200,
          remainingTotal: 200,
          isLimitExceeded: false,
          usedLast24h: 0,
          quotaPolicy: 'never',
        };
        list.push({
          id: 'chocodata',
          name: 'ChocoData API',
          levelTag: 'Уровень Б2',
          planBadge: 'Разовый пакет (~200)',
          used: cd.usedTotal,
          limit: cd.totalLimit || 200,
          remaining: cd.remainingTotal,
          resetPolicy: 'never',
          usedLast24h: cd.usedLast24h,
          isLimitExceeded: cd.isLimitExceeded || cd.usedTotal >= (cd.totalLimit || 200),
          fallbackTargetName: 'Gemini AI Audio (Уровень В)',
          unitLabel: 'транскрипций',
        });

        setProvidersData(list);
      }
    } catch (err) {
      console.warn('Could not fetch usage metrics:', err);
    } finally {
      setIsLoading(false);
    }
  }, [serverDailyActivity]);

  // Fetch live quota and usage data when modal opens
  useEffect(() => {
    if (!isOpen) return;
    fetchUsageData();
  }, [isOpen, fetchUsageData]);

  if (!isOpen) return null;

  const isPipelineActive = activeProcessingCount > 0 || batchQueueCount > 0;

  // Active Gemini usage summary (from live endpoint or serverDailyActivity)
  const usageStats = liveUsage || serverDailyActivity?.geminiUsage24h;

  const freeRequestsCount = usageStats?.freeTier?.requestsCount ?? 0;
  const freePromptTokens = usageStats?.freeTier?.promptTokens ?? 0;
  const freeCandidatesTokens = usageStats?.freeTier?.candidatesTokens ?? 0;
  const freeThoughtsTokens = usageStats?.freeTier?.thoughtsTokens ?? 0;
  const freeTotalTokens = usageStats?.freeTier?.totalTokens ?? 0;
  const freeDailyLimit = usageStats?.freeTier?.dailyLimitRequests ?? 1500;
  const freeRemainingRequests = usageStats?.freeTier?.remainingRequests ?? Math.max(0, 1500 - freeRequestsCount);
  const freePercent = Math.min(100, Math.round((freeRequestsCount / freeDailyLimit) * 100));

  const paidRequestsCount = usageStats?.paidTier?.requestsCount ?? 0;
  const paidPromptTokens = usageStats?.paidTier?.promptTokens ?? 0;
  const paidCandidatesTokens = usageStats?.paidTier?.candidatesTokens ?? 0;
  const paidThoughtsTokens = usageStats?.paidTier?.thoughtsTokens ?? 0;
  const paidTotalTokens = usageStats?.paidTier?.totalTokens ?? 0;
  const paidCostUsd = usageStats?.paidTier?.estimatedCostUsd ?? 0;

  return (
    <div 
      id="quota-monitor-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div 
        id="quota-monitor-modal" 
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-w-2xl w-full min-h-[520px] animate-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200/70 flex items-center justify-center text-amber-700 shrink-0 shadow-2xs">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-stone-900">Мониторинг квот и API</h3>
                {isPipelineActive && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 animate-pulse">
                    <Zap className="w-2.5 h-2.5" />
                    Конвейер активен ({activeProcessingCount + batchQueueCount})
                  </span>
                )}
                {isLoading && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    Обновление...
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                Текущие остатки бесплатных лимитов и тарифицируемый расход
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              id="btn-refresh-quota-modal"
              type="button"
              onClick={fetchUsageData}
              disabled={isLoading}
              className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-xl transition cursor-pointer disabled:opacity-50"
              title="Обновить данные"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-stone-700' : ''}`} />
            </button>
            <button
              id="btn-close-quota-modal"
              type="button"
              onClick={onClose}
              className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-xl transition cursor-pointer"
              title="Закрыть (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Top-Level Segmented Control: Free Quotas vs Paid API */}
        <div className="grid grid-cols-2 p-1 bg-stone-100 rounded-2xl border border-stone-200/80 gap-1 text-xs">
          <button
            type="button"
            id="segment-free-quotas"
            onClick={() => setQuotaType('free')}
            className={`py-2 px-3 rounded-xl font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
              quotaType === 'free'
                ? 'bg-white text-stone-900 shadow-sm border border-stone-200/60'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/40'
            }`}
          >
            <ShieldCheck className={`w-4 h-4 ${quotaType === 'free' ? 'text-emerald-600' : 'text-stone-400'}`} />
            <span>Бесплатные квоты</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${
              quotaType === 'free' ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'bg-stone-200 text-stone-500'
            }`}>
              {providersData.length + 1}
            </span>
          </button>

          <button
            type="button"
            id="segment-paid-api"
            onClick={() => setQuotaType('paid')}
            className={`py-2 px-3 rounded-xl font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
              quotaType === 'paid'
                ? 'bg-white text-stone-900 shadow-sm border border-stone-200/60'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/40'
            }`}
          >
            <CreditCard className={`w-4 h-4 ${quotaType === 'paid' ? 'text-amber-600' : 'text-stone-400'}`} />
            <span>Платные API ($)</span>
            {paidCostUsd > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-amber-50 text-amber-700 font-semibold">
                ${paidCostUsd.toFixed(2)}
              </span>
            )}
          </button>
        </div>

        {/* STATE 1: Бесплатные квоты (Шлюзы субтитров + Free Tier Gemini) */}
        {quotaType === 'free' && (
          <div className="flex-1 flex flex-col justify-between gap-3.5 animate-in fade-in duration-150">
            {quotaOverview && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    ['Транскрипции', quotaOverview.product?.transcripts, quotaOverview.product?.limits?.transcripts],
                    ['Минуты', Math.round(quotaOverview.product?.transcriptMinutes || 0), quotaOverview.product?.limits?.transcriptMinutes],
                    ['Radar-анализы', quotaOverview.product?.radarAnalyses, quotaOverview.product?.limits?.radarAnalyses],
                    ['Сценарии', quotaOverview.product?.scriptGenerations, quotaOverview.product?.limits?.scriptGenerations],
                  ].map(([label, used, limit]) => {
                    const safeLimit = Number(limit || 0);
                    const safeUsed = Number(used || 0);
                    const percent = safeLimit > 0 ? Math.min(100, Math.round((safeUsed / safeLimit) * 100)) : 0;
                    return (
                      <div key={String(label)} className="bg-stone-50 border border-stone-200 rounded-xl p-3">
                        <div className="text-[10px] uppercase tracking-wide font-bold text-stone-500">{label}</div>
                        <div className="mt-1 text-xl font-extrabold text-stone-900">
                          {safeUsed}
                          <span className="text-xs font-normal text-stone-500"> / {safeLimit}</span>
                        </div>
                        <div className="mt-2 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${percent >= 100 ? 'bg-rose-500' : percent >= 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="border border-sky-200 bg-sky-50/40 rounded-2xl p-3.5">
                    <div className="text-xs font-bold text-sky-950 uppercase tracking-wider mb-2">Личные API (BYOK)</div>
                    {['supadata', 'chocodata'].map((id) => {
                      const q = quotaOverview.providers?.[id]?.byok;
                      const title = id === 'supadata' ? 'Supadata' : 'ChocoData';
                      return (
                        <div key={id} className="flex items-center justify-between py-1.5 text-xs">
                          <span className="font-medium text-stone-700">{title}</span>
                          {!q?.configured ? (
                            <span className="text-stone-400">не подключён</span>
                          ) : q?.remaining !== null && q?.remaining !== undefined && q?.limit !== null ? (
                            <span className={q.available ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                              {q.remaining} из {q.limit} осталось
                            </span>
                          ) : (
                            <span className={q?.available ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                              {q?.available ? 'доступен' : 'лимит исчерпан'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="border border-stone-200 bg-stone-50/70 rounded-2xl p-3.5">
                    <div className="text-xs font-bold text-stone-900 uppercase tracking-wider mb-2">Системные провайдеры</div>
                    {['supadata', 'chocodata'].map((id) => {
                      const q = quotaOverview.providers?.[id]?.platform;
                      const title = id === 'supadata' ? 'Supadata' : 'ChocoData';
                      return (
                        <div key={id} className="flex items-center justify-between py-1.5 text-xs">
                          <span className="font-medium text-stone-700">{title}</span>
                          <span className={!q?.configured ? 'text-stone-400' : q?.available ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                            {!q?.configured ? 'не настроен' : q?.available ? 'доступен' : 'недоступен'}
                          </span>
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between py-1.5 text-xs">
                      <span className="font-medium text-stone-700">Gemini fallback</span>
                      <span className="font-semibold text-emerald-700">доступен</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Section A: Шлюзы субтитров YouTube */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-teal-600" />
                  <span className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                    Шлюзы субтитров YouTube
                  </span>
                  <span className="text-[10px] text-stone-500 font-normal">
                    (Уровни Б, Б2)
                  </span>
                </div>
                {isLoading && (
                  <span className="text-[10px] text-stone-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin text-teal-600" />
                    обновление...
                  </span>
                )}
              </div>

              {/* Providers Cards in compact grid */}
              {isLoading && providersData.length === 0 ? (
                <div className="p-4 border border-dashed border-stone-200 rounded-2xl flex items-center justify-center gap-2 text-xs text-stone-500 bg-stone-50/50">
                  <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                  <span>Загрузка данных по шлюзам субтитров...</span>
                </div>
              ) : providersData.length === 0 ? (
                <div className="p-4 border border-dashed border-stone-200 rounded-2xl flex items-center justify-between gap-2 text-xs text-stone-500 bg-stone-50/50">
                  <span>Не удалось получить данные о шлюзах</span>
                  <button
                    type="button"
                    onClick={fetchUsageData}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition cursor-pointer shadow-2xs"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Повторить
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {providersData.map((provider) => (
                    <QuotaCard 
                      key={provider.id} 
                      provider={provider} 
                      compact={true} 
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Section B: Бесплатный тир Gemini (RPD) */}
            <div className="bg-gradient-to-br from-emerald-50/40 to-stone-50/50 border border-emerald-200/80 rounded-2xl p-3.5 space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-950 uppercase tracking-wider">
                    <Activity className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Gemini Flash 2.5 — Бесплатный тир</span>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">
                    RPD лимит
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-emerald-800">
                  {freeRemainingRequests.toLocaleString('ru-RU')} зап. осталось
                </span>
              </div>

              {/* Progress and Numbers */}
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between text-xs">
                  <div className="text-xl sm:text-2xl font-extrabold text-stone-900 tracking-tight">
                    {freeRequestsCount}
                    <span className="text-xs font-normal text-stone-500 ml-1.5">
                      из {freeDailyLimit.toLocaleString('ru-RU')} зап./день
                    </span>
                  </div>
                  <span className="font-bold text-emerald-700 text-xs">
                    {freePercent}% израсходовано
                  </span>
                </div>

                <div className="w-full bg-stone-200/80 rounded-full h-2 overflow-hidden shadow-inner">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      freePercent >= 90 ? 'bg-rose-500' : freePercent >= 75 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(freeRequestsCount > 0 ? 3 : 0, freePercent))}%` }}
                  />
                </div>
              </div>

              {/* Tokens breakdown footer */}
              <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between text-[11px] text-stone-600 flex-wrap gap-2">
                <span>
                  Всего за 24ч: <strong className="text-stone-900 font-semibold">{freeTotalTokens.toLocaleString('ru-RU')}</strong> тк.
                </span>
                <span className="text-stone-500">
                  Вход: <strong>{freePromptTokens.toLocaleString('ru-RU')}</strong> · Выход: <strong>{(freeCandidatesTokens + freeThoughtsTokens).toLocaleString('ru-RU')}</strong>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* STATE 2: Платные API ($) */}
        {quotaType === 'paid' && (
          <div className="flex-1 flex flex-col justify-between animate-in fade-in duration-150">
            <div className="bg-gradient-to-br from-amber-50/40 to-stone-50/50 border border-amber-200/80 rounded-2xl p-4 sm:p-5 flex-1 flex flex-col justify-between shadow-2xs">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950 uppercase tracking-wider">
                    <DollarSign className="w-4 h-4 text-amber-600" />
                    <span>Расход Gemini API</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                    Тарифный биллинг
                  </span>
                </div>

                {/* Total Cost Display */}
                <div className="flex items-baseline justify-between pt-1">
                  <div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-stone-900 tracking-tight">
                      ${paidCostUsd.toFixed(4)}
                      <span className="text-sm font-normal text-stone-500 ml-1.5">USD</span>
                    </div>
                    <p className="text-xs text-stone-500 mt-1">
                      {paidRequestsCount > 0 
                        ? `${paidRequestsCount} платных запросов (${paidTotalTokens.toLocaleString('ru-RU')} токенов)`
                        : 'Платные списания отсутствуют (активен Free Tier)'}
                    </p>
                  </div>

                  <div className="text-right text-xs">
                    <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl font-semibold border shadow-2xs ${
                      paidCostUsd > 0
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    }`}>
                      {paidCostUsd > 0 ? 'Платный расход' : 'Без списаний ($0.00)'}
                    </span>
                  </div>
                </div>

                {/* Tokens Detail Grid */}
                <div className="pt-3 border-t border-amber-200/60 grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="bg-white/80 border border-amber-200/70 rounded-xl p-3 shadow-2xs">
                    <div className="text-[10px] text-stone-500 font-medium">Входные токены (Prompt)</div>
                    <div className="text-sm font-bold text-stone-900 mt-1">
                      {paidPromptTokens.toLocaleString('ru-RU')}
                    </div>
                  </div>

                  <div className="bg-white/80 border border-amber-200/70 rounded-xl p-3 shadow-2xs">
                    <div className="text-[10px] text-stone-500 font-medium">Выходные токены (Candidates)</div>
                    <div className="text-sm font-bold text-stone-900 mt-1">
                      {paidCandidatesTokens.toLocaleString('ru-RU')}
                    </div>
                  </div>

                  <div className="bg-white/80 border border-amber-200/70 rounded-xl p-3 shadow-2xs col-span-2 sm:col-span-1">
                    <div className="text-[10px] text-stone-500 font-medium">Мыслительные (Thinking)</div>
                    <div className="text-sm font-bold text-stone-900 mt-1">
                      {paidThoughtsTokens.toLocaleString('ru-RU')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tariff Reference Table */}
              <div className="pt-3 border-t border-amber-200/60 text-[11px] text-stone-500 space-y-1 mt-4">
                <div className="font-semibold text-stone-700">Официальные тарифы Google AI:</div>
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span>• <strong>Gemini 2.5 Flash</strong>: $0.075 / 1M вход, $0.300 / 1M выход</span>
                  <span>• <strong>Gemini 2.5 Pro</strong>: $1.250 / 1M вход, $5.000 / 1M выход</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Backward-compatible alias for any legacy imports
export const DailyActivityModal = QuotaMonitorModal;
