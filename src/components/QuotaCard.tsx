import React from 'react';
import { 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle, 
  CornerDownRight, 
  Calendar, 
  Sparkles,
  Zap
} from 'lucide-react';
import { ProviderQuotaInfo } from '../types';

interface QuotaCardProps {
  provider: ProviderQuotaInfo;
  compact?: boolean;
}

export const QuotaCard: React.FC<QuotaCardProps> = ({ provider, compact = false }) => {
  const limit = Math.max(1, provider.limit);
  const used = Math.max(0, provider.used);
  const percent = Math.min(100, Math.round((used / limit) * 100));
  const isExceeded = provider.isLimitExceeded || used >= limit;

  // Single source of truth for quota status levels:
  // Green (< 75%), Amber (75% - 99%), Red (>= 100% or isLimitExceeded)
  const statusLevel: 'safe' | 'warning' | 'danger' = isExceeded
    ? 'danger'
    : percent >= 75
    ? 'warning'
    : 'safe';

  const statusConfig = {
    safe: {
      cardBorder: 'border-emerald-200/80',
      cardBg: 'bg-gradient-to-br from-emerald-50/30 to-stone-50/50',
      barColor: 'bg-emerald-500',
      textColor: 'text-emerald-700',
      badgeBg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />,
      statusText: 'Квота в норме',
    },
    warning: {
      cardBorder: 'border-amber-200',
      cardBg: 'bg-gradient-to-br from-amber-50/40 to-stone-50/50',
      barColor: 'bg-amber-500',
      textColor: 'text-amber-700',
      badgeBg: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />,
      statusText: 'Квота подходит к концу',
    },
    danger: {
      cardBorder: 'border-rose-200',
      cardBg: 'bg-gradient-to-br from-rose-50/40 to-stone-50/50',
      barColor: 'bg-rose-500',
      textColor: 'text-rose-700',
      badgeBg: 'bg-rose-50 text-rose-800 border-rose-200',
      icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />,
      statusText: 'Лимит исчерпан',
    },
  }[statusLevel];

  const unit = provider.unitLabel || 'запросов';

  return (
    <div
      id={`quota-card-${provider.id}`}
      className={`border rounded-2xl p-4 transition-all duration-200 flex flex-col justify-between space-y-3 shadow-2xs ${statusConfig.cardBorder} ${statusConfig.cardBg}`}
    >
      {/* Top Header: Title, Level, Reset Policy Badge */}
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-xs font-bold text-stone-900 tracking-wide">
              {provider.name}
            </h4>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200">
              {provider.levelTag}
            </span>
            {provider.planBadge && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-white/90 text-stone-600 border border-stone-200 shadow-2xs">
                {provider.planBadge}
              </span>
            )}
            {provider.isLiveAccount && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
                title="Прямая синхронизация с аккаунтом провайдера"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            )}
          </div>

          {/* Policy Badge (monthly vs never) - Always visible in all views */}
          <div
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border shadow-2xs ${
              provider.resetPolicy === 'monthly'
                ? 'bg-cyan-50/90 text-cyan-800 border-cyan-200'
                : 'bg-amber-50/90 text-amber-900 border-amber-200'
            }`}
            title={
              provider.resetPolicy === 'monthly'
                ? 'Квота обновляется в первый день каждого месяца'
                : 'Единоразовый пакет кредитов, не сгорает со временем'
            }
          >
            {provider.resetPolicy === 'monthly' ? (
              <>
                <Calendar className="w-2.5 h-2.5 text-cyan-600" />
                <span>Сброс 1-го числа</span>
              </>
            ) : (
              <>
                <Sparkles className="w-2.5 h-2.5 text-amber-600" />
                <span>Разовый пакет</span>
              </>
            )}
          </div>
        </div>

        {/* Metrics Row: Used / Limit + Remaining */}
        <div className="flex items-end justify-between gap-4 pt-1">
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-stone-900 tracking-tight">
              {used}
              <span className="text-xs font-normal text-stone-500 ml-1.5">
                / {limit} {unit}
              </span>
            </div>
            {provider.usedLast24h !== undefined && (
              <p className="text-[11px] text-stone-500 mt-0.5">
                За последние 24ч: <strong className="text-stone-700 font-semibold">{provider.usedLast24h}</strong> {unit}
              </p>
            )}
          </div>

          <div className="text-right shrink-0">
            <div className="text-[11px] text-stone-500">
              {provider.resetPolicy === 'monthly' ? 'Остаток на месяц:' : 'Остаток пакета:'}
            </div>
            <div className={`text-lg sm:text-xl font-bold ${statusConfig.textColor}`}>
              {isExceeded ? '0' : provider.remaining}
              <span className="text-xs font-normal text-stone-400 ml-1">
                ({100 - percent}%)
              </span>
            </div>
            <div className="text-[10px] text-stone-400">
              {percent}% израсходовано
            </div>
          </div>
        </div>
      </div>

      {/* Unified 3-Color Progress Bar */}
      <div className="space-y-1.5">
        <div className="w-full bg-stone-200/80 rounded-full h-2 overflow-hidden shadow-inner">
          <div
            className={`h-full rounded-full transition-all duration-300 ${statusConfig.barColor}`}
            style={{ width: `${Math.min(100, Math.max(used > 0 ? 3 : 0, percent))}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-stone-500 pt-0.5">
          <div className="flex items-center gap-1">
            {statusConfig.icon}
            <span className={`font-medium ${statusConfig.textColor}`}>
              {statusConfig.statusText}
            </span>
          </div>
          <span className="font-semibold text-stone-700">
            {percent}%
          </span>
        </div>
      </div>

      {/* Fallback Routing Footer - ALWAYS visible in all view modes with context */}
      <div 
        className="pt-2 border-t border-stone-200/60 flex items-center justify-between gap-2 text-[11px] text-stone-500"
        title={`При исчерпании квоты запросы автоматически направляются на: ${provider.fallbackTargetName}`}
      >
        <div className="flex items-center gap-1.5 truncate">
          <CornerDownRight className="w-3 h-3 text-stone-400 shrink-0" />
          <span className="truncate">
            {isExceeded ? (
              <span className="text-rose-700 font-semibold">
                ⚠️ Переход: {provider.fallbackTargetName}
              </span>
            ) : (
              <span>
                При исчерпании → <strong className="text-stone-700 font-medium">{provider.fallbackTargetName}</strong>
              </span>
            )}
          </span>
        </div>
        <span className="shrink-0 text-[10px] px-1.5 py-0.2 rounded bg-stone-100 text-stone-500 border border-stone-200">
          Авто-маршрут
        </span>
      </div>
    </div>
  );
};
