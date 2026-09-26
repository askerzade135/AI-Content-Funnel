import React from 'react';
import { useI18n } from '../i18n';
import { quotaReset, quotaState, type QuotaMetric } from '../lib/productQuota';
import type { ProductQuotaSnapshot } from './PlanQuotasWorkspace';

export function ContextualQuota({ quota, metric, onOpenQuotas, preserveInterest = false }: {
  quota: ProductQuotaSnapshot | null;
  metric: QuotaMetric;
  onOpenQuotas?: () => void;
  preserveInterest?: boolean;
}) {
  const { locale, t } = useI18n();
  if (!quota) return null;
  const state = quotaState(quota[metric], quota.limits[metric]);
  if (state === 'normal') return null;
  const remaining = Math.max(0, quota.limits[metric] - quota[metric]);
  const reset = new Date(quotaReset(quota.periodStart)).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US', { timeZone: 'UTC' });
  return <div role="status" data-testid={`quota-${metric}`} className={`mt-2 min-w-0 w-full break-words rounded-xl p-3 text-xs leading-relaxed ${state === 'exhausted' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>
    <strong>{metric === 'radarAnalyses' ? 'Radar Analysis' : 'AI Generation'}: </strong>
    {state === 'warning' ? `${t('quota.remaining')} ${remaining}.` : <>
      {t('quota.reached')} {t('quota.reset')} {reset} (UTC). {t('quota.upgrade')}
      {preserveInterest && <span className="block">{t('quota.interestSaved')}</span>}
      {onOpenQuotas && <button type="button" onClick={onOpenQuotas} className="mt-1 block max-w-full text-left font-semibold underline">{t('nav.planQuotas')}</button>}
    </>}
  </div>;
}
