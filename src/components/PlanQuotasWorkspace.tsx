import React from 'react';
import { AlertTriangle, ArrowRight, Check, Gauge, Sparkles, Zap } from 'lucide-react';
import { useI18n } from '../i18n';

export interface ProductQuotaSnapshot {
  periodStart: string;
  transcripts: number;
  transcriptMinutes: number;
  radarAnalyses: number;
  scriptGenerations: number;
  limits: {
    transcripts: number;
    transcriptMinutes: number;
    radarAnalyses: number;
    scriptGenerations: number;
  };
}

interface PlanQuotasWorkspaceProps {
  quota: ProductQuotaSnapshot | null;
}

type UsageTone = 'normal' | 'warning' | 'exhausted';

const usageTone = (used: number, limit: number): UsageTone => {
  if (limit <= 0 || used >= limit) return 'exhausted';
  if (used / limit >= 0.8) return 'warning';
  return 'normal';
};

const targetPlans = {
  free: {
    radar: 20,
    generations: 5,
    transcripts: 10,
    minutes: 60,
    storage: '1 GB',
    scheduled: 5,
  },
  pro: {
    radar: 300,
    generations: 100,
    transcripts: 100,
    minutes: 1000,
    storage: '10 GB',
    scheduled: 100,
  },
} as const;

export const PlanQuotasWorkspace: React.FC<PlanQuotasWorkspaceProps> = ({ quota }) => {
  const { locale } = useI18n();
  const ru = locale === 'ru';

  const resetAt = quota?.periodStart
    ? new Date(new Date(quota.periodStart).setUTCMonth(new Date(quota.periodStart).getUTCMonth() + 1))
    : null;

  const metrics = quota ? [
    {
      key: 'radar',
      label: 'Radar Analysis',
      used: quota.radarAnalyses,
      limit: quota.limits.radarAnalyses,
      description: ru ? 'Анализ понравившегося источника и создание структурированных идей.' : 'Analyzes liked sources and turns them into structured Ideas.',
    },
    {
      key: 'generation',
      label: ru ? 'AI Generation' : 'AI Generation',
      used: quota.scriptGenerations,
      limit: quota.limits.scriptGenerations,
      description: ru ? 'Создание и перегенерация сценариев и будущих AI-форматов.' : 'Script generation, regeneration and future AI creation actions.',
    },
    {
      key: 'transcripts',
      label: ru ? 'Транскрипции' : 'Transcriptions',
      used: quota.transcripts,
      limit: quota.limits.transcripts,
      description: ru ? 'Количество обработанных аудио/видео источников за период.' : 'Number of audio/video sources transcribed during the period.',
    },
    {
      key: 'minutes',
      label: ru ? 'Минуты транскрипции' : 'Transcript minutes',
      used: Math.round(quota.transcriptMinutes),
      limit: quota.limits.transcriptMinutes,
      description: ru ? 'Защищает тариф от очень длинных исходных видео.' : 'Protects the plan from unusually long source videos.',
    },
  ] : [];

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
            <Gauge className="h-3.5 w-3.5" />
            {ru ? 'Тариф и использование' : 'Plan & usage'}
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-stone-950">
            {ru ? 'План и квоты' : 'Plan & Quotas'}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-500">
            {ru
              ? 'Здесь собраны только продуктовые лимиты. Лимиты Gemini, Supadata и других провайдеров остаются внутренней инфраструктурой.'
              : 'Only customer-facing product limits live here. Gemini, Supadata and other provider limits remain internal infrastructure.'}
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">{ru ? 'Текущий план' : 'Current plan'}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-lg font-bold text-stone-950">Free</span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Beta</span>
          </div>
          {resetAt && (
            <div className="mt-1 text-[11px] text-stone-500">
              {ru ? 'Месячные лимиты обновятся ' : 'Monthly limits reset '}
              {resetAt.toLocaleDateString(ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' })}
            </div>
          )}
        </div>
      </div>

      {!quota ? (
        <div className="mt-6 rounded-3xl border border-stone-200 bg-white p-6 text-sm text-stone-500">
          {ru ? 'Не удалось загрузить данные квот. Обнови страницу и попробуй ещё раз.' : 'Quota data could not be loaded. Refresh the page and try again.'}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(metric => {
            const tone = usageTone(metric.used, metric.limit);
            const percent = Math.min(100, metric.limit > 0 ? (metric.used / metric.limit) * 100 : 100);
            const remaining = Math.max(0, metric.limit - metric.used);
            return (
              <section
                key={metric.key}
                className={`rounded-3xl border bg-white p-5 shadow-sm ${
                  tone === 'exhausted'
                    ? 'border-rose-200'
                    : tone === 'warning'
                      ? 'border-amber-200'
                      : 'border-stone-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-stone-950">{metric.label}</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-stone-500">{metric.description}</div>
                  </div>
                  {tone !== 'normal' && (
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                      tone === 'exhausted' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                  )}
                </div>

                <div className="mt-5 flex items-end justify-between gap-2">
                  <div>
                    <span className="text-2xl font-bold tracking-tight text-stone-950">{metric.used}</span>
                    <span className="ml-1 text-xs text-stone-400">/ {metric.limit}</span>
                  </div>
                  <div className={`text-[11px] font-semibold ${
                    tone === 'exhausted' ? 'text-rose-600' : tone === 'warning' ? 'text-amber-700' : 'text-stone-500'
                  }`}>
                    {tone === 'exhausted'
                      ? (ru ? 'Лимит исчерпан' : 'Limit reached')
                      : (ru ? `Осталось ${remaining}` : `${remaining} left`)}
                  </div>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      tone === 'exhausted' ? 'bg-rose-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-violet-600'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </section>
            );
          })}
        </div>
      )}

      <section className="mt-6 rounded-3xl border border-stone-200 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-stone-950">{ru ? 'Как квоты будут проявляться в продукте' : 'How quotas behave in the product'}</h3>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">
              {ru
                ? 'До 80% интерфейс не мешает работе. После 80% появляется мягкое предупреждение рядом с конкретным дорогим действием. На 100% блокируется только это действие — обычный просмотр, сохранение и сигналы Interested / Skip продолжают работать.'
                : 'Below 80%, quotas stay out of the way. After 80%, a soft warning appears next to the relevant costly action. At 100%, only that costly action is blocked — browsing, saving and Interested / Skip signals keep working.'}
            </p>
          </div>
        </div>
      </section>

      <div className="mt-8">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">{ru ? 'Следующая модель' : 'Target model'}</div>
          <h3 className="mt-1 text-xl font-bold text-stone-950">{ru ? 'Free и Pro' : 'Free and Pro'}</h3>
          <p className="mt-1 text-xs text-stone-500">
            {ru
              ? 'Это согласованная стартовая модель тарифов. Пока платежи не подключены, текущие beta-лимиты остаются фактическими.'
              : 'This is the agreed starting plan model. Until billing is connected, the current beta limits remain the enforced limits.'}
          </p>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {([
            ['free', ru ? 'Для знакомства с полным циклом' : 'For learning the full workflow'],
            ['pro', ru ? 'Для регулярного создания контента' : 'For consistent content creation'],
          ] as const).map(([plan, subtitle]) => {
            const values = targetPlans[plan];
            const pro = plan === 'pro';
            return (
              <section key={plan} className={`rounded-3xl border p-6 ${
                pro ? 'border-violet-200 bg-violet-50/40' : 'border-stone-200 bg-white'
              }`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xl font-bold text-stone-950">{plan === 'free' ? 'Free' : 'Pro'}</div>
                    <p className="mt-1 text-xs text-stone-500">{subtitle}</p>
                  </div>
                  {pro && <span className="rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-semibold text-white">{ru ? 'Планируется' : 'Planned'}</span>}
                </div>

                <div className="mt-5 grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
                  {[
                    `${values.radar} Radar Analysis / ${ru ? 'мес.' : 'mo'}`,
                    `${values.generations} AI Generation / ${ru ? 'мес.' : 'mo'}`,
                    `${values.transcripts} ${ru ? 'транскрипций' : 'transcriptions'} / ${ru ? 'мес.' : 'mo'}`,
                    `${values.minutes} ${ru ? 'минут транскрипции' : 'transcript minutes'}`,
                    `${values.storage} ${ru ? 'временного storage' : 'temporary storage'}`,
                    `${values.scheduled} ${ru ? 'активных публикаций' : 'active scheduled publications'}`,
                  ].map(item => (
                    <div key={item} className="flex items-start gap-2">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${pro ? 'text-violet-600' : 'text-emerald-600'}`} />
                      <span className="text-xs">{item}</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  disabled
                  className={`mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold ${
                    pro
                      ? 'bg-violet-200 text-violet-500'
                      : 'border border-stone-200 bg-stone-50 text-stone-400'
                  }`}
                >
                  {pro ? (ru ? 'Оплата появится позже' : 'Billing coming later') : (ru ? 'Текущий beta-план' : 'Current beta plan')}
                  {pro && <ArrowRight className="h-3.5 w-3.5" />}
                </button>
              </section>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2 rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-[11px] text-violet-800">
        <Sparkles className="h-4 w-4 shrink-0" />
        {ru
          ? 'Провайдерские rate limits не считаются тарифом пользователя и не отображаются здесь.'
          : 'Provider rate limits are infrastructure constraints and are not presented here as customer plan quotas.'}
      </div>
    </div>
  );
};
