import { useEffect, useState } from 'react';
import { authFetch } from '../services/authFetch';
import type { ProductQuotaSnapshot } from '../components/PlanQuotasWorkspace';
import { quotaState, type QuotaMetric } from '../lib/productQuota';
import { useI18n } from '../i18n';

export const QUOTA_UPDATED = 'product-quota-updated';
export function useProductQuota() {
  const [quota, setQuota] = useState<ProductQuotaSnapshot | null>(null);
  const { t } = useI18n();
  const refreshQuota = async () => {
    const response = await authFetch('/api/quotas');
    if (!response.ok) throw new Error(t('quota.unavailable'));
    const next = await response.json() as ProductQuotaSnapshot;
    window.dispatchEvent(new CustomEvent(QUOTA_UPDATED, { detail: next }));
    return next;
  };
  useEffect(() => {
    const receive = (event: Event) => setQuota((event as CustomEvent<ProductQuotaSnapshot>).detail);
    window.addEventListener(QUOTA_UPDATED, receive);
    void refreshQuota().catch(() => undefined);
    // Also observe background Interested analysis and period renewal while open.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshQuota().catch(() => undefined);
    }, 5000);
    return () => { window.removeEventListener(QUOTA_UPDATED, receive); window.clearInterval(timer); };
  }, []);
  const precheckQuota = async (metric: QuotaMetric) => {
    const fresh = await refreshQuota();
    return quotaState(fresh[metric], fresh.limits[metric]) !== 'exhausted';
  };
  const quotaError = (data: { code?: string; error?: string }, fallback: string) =>
    data.code === 'PRODUCT_QUOTA_EXCEEDED' ? t('quota.reached') : data.error || fallback;
  return { quota, refreshQuota, precheckQuota, quotaError };
}
