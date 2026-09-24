export type QuotaMetric = 'radarAnalyses' | 'scriptGenerations';
export function quotaState(used: number, limit: number) {
  return limit <= 0 || used >= limit ? 'exhausted' : used / limit >= 0.8 ? 'warning' : 'normal';
}
export function quotaReset(periodStart: string) {
  const date = new Date(periodStart);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}
