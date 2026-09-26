import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, BrainCircuit, ChevronRight, CircleDollarSign,
  Database, Gauge, Loader2, RefreshCw, Search, ShieldCheck, Sparkles, Users, X, Zap
} from 'lucide-react';
import { authFetch } from '../services/authFetch';
import { useI18n } from '../i18n';
import { CustomSelect } from './CustomSelect';

type Period = '24h' | '7d' | '30d';
type AdminTab = 'overview' | 'users' | 'ai' | 'product' | 'llm' | 'infrastructure';

interface AdminUserRow {
  ownerId: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  createdAt: string;
  lastLoginAt?: string;
  lastActive?: string;
  onboardingCompleted: boolean;
  activeInPeriod: boolean;
  tokens: { input: number; output: number; total: number };
  estimatedCostUsd: number;
  analyses: number;
  discoveryRuns: number;
  feedback: { interested: number; notInterested: number; skipped: number };
  ideas: number;
  savedIdeas: number;
  outputs: number;
  scheduled: number;
  quota: {
    used: { radarAnalyses: number; scriptGenerations: number; transcripts: number; transcriptMinutes: number };
    limits: { radarAnalyses: number; scriptGenerations: number; transcripts: number; transcriptMinutes: number };
  };
}

interface AdminAnalytics {
  generatedAt: string;
  period: Period;
  periodStart: string;
  kpis: {
    totalUsers: number;
    activeUsers: number;
    newUsers: number;
    radarAnalyses: number;
    aiGenerations: number;
    estimatedCostUsd: number;
    avgCostPerActiveUserUsd: number;
  };
  ai: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    freeRequests: number;
    paidRequests: number;
    byOperation: Array<{ operation: string; requests: number; tokens: number; estimatedCostUsd: number }>;
    byModel: Array<{
      provider: string; model: string; billingPhase: string; requests: number; inputTokens: number;
      outputTokens: number; totalTokens: number; estimatedCostUsd: number; errors: number; fallbackCount: number;
    }>;
    searchRequestsThisMonth: number;
    providerQuota: Array<{
      id: string;
      category: 'llm' | 'search' | 'transcription';
      provider: string;
      tier: string;
      configured: boolean;
      unit: string;
      used: number;
      limit: number | null;
      remaining: number | null;
      tokenUsed?: number;
      tokenLimit?: number | null;
      tokenRemaining?: number | null;
      reset: string;
      source: string;
      accuracy: 'estimated' | 'unknown-limit' | 'usage-only' | string;
      note?: string;
      checkedAt?: string;
    }>;
  };
  product: {
    discoveryRuns: number;
    recommendationsFound: number;
    feedback: {
      interested: number; notInterested: number; skipped: number; total: number;
      interestedRate: number; notInterestedRate: number; skipRate: number;
    };
    ideasCreated: number;
    ideasSaved: number;
    outputsCreated: number;
    regenerations: number;
    scheduled: number;
    funnel: {
      users: number; discover: number; interestedUsers: number; ideaUsers: number; outputUsers: number; scheduledUsers: number;
    };
  };
  users: AdminUserRow[];
  llm: {
    registeredTaskCount: number;
    tasks: Array<{
      id: string; version: string; operation: string; temperature: number; maxTokens: number; taskClass: string;
      purpose: string; promptSource: string; outputContract: string; quotaMetric?: string; owner: string; fallbackPolicy: string;
    }>;
  };
}

interface StorageStatus {
  mode?: string;
  firestoreDatabaseId?: string;
  syncStatus?: {
    ok?: boolean;
    lastError?: string | null;
    lastSyncAt?: string | null;
    deferred?: boolean;
  };
  firestoreSnapshot?: {
    exists?: boolean;
    readable?: boolean;
    format?: string;
    entityCount?: number;
    legacySnapshotExists?: boolean;
    chunkCount?: number;
    updatedAt?: string;
  };
  snapshotDetails?: {
    exists?: boolean;
    readable?: boolean;
    format?: string;
    entityCount?: number;
    legacySnapshotExists?: boolean;
    chunkCount?: number;
    updatedAt?: string;
  };
}

interface InfrastructureDiagnostics {
  generatedAt: string;
  health: Array<{ id: string; state: 'healthy' | 'attention' | 'unavailable' }>;
  storage: {
    mode: string;
    databaseId?: string;
    format?: string;
    entityCount: number;
    readable: boolean;
    syncOk: boolean;
    lastSyncAt?: string | null;
    lastError?: string | null;
    legacySnapshotExists: boolean;
    chunkCount: number;
    collections: Record<string, number>;
  };
  migration: {
    state: 'verified' | 'fallback';
    format: string;
    entityCount: number;
    legacySnapshotRetained: boolean;
    safeToRetireLegacy: boolean;
    lastVerifiedAt?: string;
  };
  jobs: {
    pendingQueue: number;
    activeQueue: number;
    stuckVideos: number;
    stuckPublicationJobs: number;
    publicationFailed24h: number;
    discoveryFailed24h: number;
    radarScanFailed24h: number;
    lastDiscoveryRunAt?: string;
    lastRadarScanAt?: string;
    lastPublicationUpdateAt?: string;
  };
  providers: {
    llm: { requests24h: number; failed24h: number; paidRequests24h: number; lastUsed?: string; configured: any[] };
    search: { requests24h: number; failed24h: number; lastUsed?: string; sources: Array<{ sourceType: string; available: boolean }>; configured: any[] };
    transcription: { requests24h: number; failed24h: number; lastUsed?: string; configured: any[] };
  };
  integrations: {
    social: Array<{ platform: 'instagram' | 'tiktok'; configured: boolean; connections: number; expired: number; expiringSoon: number }>;
    googleCalendar: { observability: string; note: string };
  };
  dataIntegrity: {
    state: 'healthy' | 'attention';
    issueCount: number;
    issues: Record<string, number>;
    workflowOnlyScheduled: number;
  };
}

interface AdminWorkspaceProps {
  onOpenPromptsModal?: () => void;
  currentRole?: 'owner' | 'admin' | 'member';
}

interface AdminInviteRow {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'used' | 'revoked' | 'expired';
  usedAt?: string;
}

const number = (value: number) => new Intl.NumberFormat().format(value || 0);
const usd = (value: number) => '$' + Number(value || 0).toFixed(value >= 1 ? 2 : 4);
const pct = (value: number) => Math.round((value || 0) * 100) + '%';

export const AdminWorkspace: React.FC<AdminWorkspaceProps> = ({ onOpenPromptsModal, currentRole = 'member' }) => {
  const { locale } = useI18n();
  const [period, setPeriod] = useState<Period>('7d');
  const [tab, setTab] = useState<AdminTab>('overview');
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [storageRefreshing, setStorageRefreshing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<InfrastructureDiagnostics | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminInvites, setAdminInvites] = useState<AdminInviteRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteExpiryHours, setInviteExpiryHours] = useState(48);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;

  const loadStorageStatus = async () => {
    setStorageRefreshing(true);
    try {
      const [storageResponse, diagnosticsResponse] = await Promise.all([
        authFetch('/api/admin/storage-status'),
        authFetch('/api/admin/infrastructure-diagnostics'),
      ]);
      if (!storageResponse.ok || !diagnosticsResponse.ok) {
        throw new Error(tr('Не удалось загрузить инфраструктурную диагностику', 'Failed to load infrastructure diagnostics'));
      }
      const [storagePayload, diagnosticsPayload] = await Promise.all([
        storageResponse.json() as Promise<StorageStatus>,
        diagnosticsResponse.json() as Promise<InfrastructureDiagnostics>,
      ]);
      setStorage(storagePayload);
      setDiagnostics(diagnosticsPayload);
    } finally {
      setStorageRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      authFetch('/api/admin/analytics?period=' + period),
      authFetch('/api/admin/storage-status'),
      authFetch('/api/admin/infrastructure-diagnostics'),
    ]).then(async ([analyticsRes, storageRes, diagnosticsRes]) => {
      if (!analyticsRes.ok) throw new Error(tr('Не удалось загрузить Admin analytics', 'Failed to load Admin analytics'));
      const analytics = await analyticsRes.json() as AdminAnalytics;
      const storageData = storageRes.ok ? await storageRes.json() as StorageStatus : null;
      const diagnosticsData = diagnosticsRes.ok ? await diagnosticsRes.json() as InfrastructureDiagnostics : null;
      if (cancelled) return;
      setData(analytics);
      setStorage(storageData);
      setDiagnostics(diagnosticsData);
    }).catch((err: any) => {
      if (!cancelled) setError(err?.message || tr('Ошибка загрузки', 'Loading error'));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [period, locale]);

  const loadAdminInvites = async () => {
    if (currentRole !== 'owner') return;
    const response = await authFetch('/api/admin/admin-invites');
    if (!response.ok) throw new Error(tr('Не удалось загрузить приглашения', 'Failed to load invitations'));
    const payload = await response.json();
    setAdminInvites(payload.invites || []);
  };

  useEffect(() => {
    if (currentRole !== 'owner') return;
    void loadAdminInvites().catch(() => undefined);
  }, [currentRole]);

  const createInvite = async () => {
    setInviteBusy(true);
    setInviteError(null);
    setInviteLink('');
    try {
      const response = await authFetch('/api/admin/admin-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, expiresInHours: inviteExpiryHours }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.code || payload?.error || 'INVITE_CREATE_FAILED');
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('adminInvite', payload.token);
      setInviteLink(url.toString());
      setInviteEmail('');
      await loadAdminInvites();
    } catch (err: any) {
      setInviteError(err?.message || tr('Не удалось создать приглашение', 'Could not create invitation'));
    } finally {
      setInviteBusy(false);
    }
  };

  const revokeInvite = async (id: string) => {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const response = await authFetch(`/api/admin/admin-invites/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.code || payload?.error || 'INVITE_REVOKE_FAILED');
      await loadAdminInvites();
    } catch (err: any) {
      setInviteError(err?.message || tr('Не удалось отозвать приглашение', 'Could not revoke invitation'));
    } finally {
      setInviteBusy(false);
    }
  };

  const users = useMemo(() => {
    const q = userSearch.trim().toLocaleLowerCase();
    if (!q) return data?.users || [];
    return (data?.users || []).filter(user =>
      `${user.name} ${user.email} ${user.ownerId}`.toLocaleLowerCase().includes(q)
    );
  }, [data?.users, userSearch]);

  const tabs: Array<[AdminTab, string]> = [
    ['overview', tr('Обзор', 'Overview')],
    ['users', tr('Пользователи', 'Users')],
    ['ai', 'AI Usage'],
    ['product', tr('Продукт', 'Product Analytics')],
    ['llm', 'LLM & Prompts'],
    ['infrastructure', tr('Инфраструктура', 'Infrastructure')],
  ];

  if (loading && !data) {
    return <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-stone-200 bg-white">
      <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
    </div>;
  }

  if (error && !data) {
    return <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{error}</div>;
  }

  if (!data) return null;

  const kpis = [
    { label: tr('Всего пользователей', 'Total users'), value: number(data.kpis.totalUsers), icon: Users },
    { label: tr('Активные', 'Active users'), value: number(data.kpis.activeUsers), hint: period, icon: Activity },
    { label: 'Radar analyses', value: number(data.kpis.radarAnalyses), icon: BrainCircuit },
    { label: tr('AI outputs', 'AI outputs'), value: number(data.kpis.aiGenerations), icon: Sparkles },
    { label: tr('Оценочная AI стоимость', 'Estimated AI cost'), value: usd(data.kpis.estimatedCostUsd), icon: CircleDollarSign },
    { label: tr('Стоимость / active user', 'Cost / active user'), value: usd(data.kpis.avgCostPerActiveUserUsd), icon: Gauge },
  ];

  const funnel = [
    [tr('Активные', 'Active'), data.product.funnel.users],
    ['Discover', data.product.funnel.discover],
    ['Interested', data.product.funnel.interestedUsers],
    ['Ideas', data.product.funnel.ideaUsers],
    ['Outputs', data.product.funnel.outputUsers],
    ['Scheduled', data.product.funnel.scheduledUsers],
  ] as const;
  const funnelMax = Math.max(1, ...funnel.map(([, value]) => value));

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-stone-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-stone-950">{tr('Операционная панель', 'Product operations')}</h3>
                <p className="mt-0.5 text-xs text-stone-500">
                  {tr('Пользователи, расходы, продуктовая воронка и LLM-наблюдаемость.', 'Users, spend, product funnel and LLM observability.')}
                </p>
              </div>
            </div>
          </div>
          <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50 p-1">
            {(['24h', '7d', '30d'] as Period[]).map(value => (
              <button key={value} type="button" onClick={() => setPeriod(value)}
                className={`h-8 rounded-lg px-3 text-xs font-semibold ${period === value ? 'bg-stone-950 text-white' : 'text-stone-500 hover:bg-white'}`}>
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`h-9 shrink-0 rounded-xl border px-3 text-xs font-semibold ${tab === id ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {kpis.map(({ label, value, hint, icon: Icon }) => (
              <div key={label} className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold text-stone-500">{label}</div>
                    <div className="mt-2 text-2xl font-bold tracking-tight text-stone-950">{value}</div>
                    {hint && <div className="mt-1 text-[10px] text-stone-400">{hint}</div>}
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="h-4 w-4" /></span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-3xl border border-stone-200 bg-white p-5">
              <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-emerald-600" /><h4 className="font-bold text-stone-950">{tr('Продуктовая воронка', 'Product funnel')}</h4></div>
              <div className="mt-5 space-y-3">
                {funnel.map(([label, value]) => (
                  <div key={label}>
                    <div className="mb-1 flex items-center justify-between text-xs"><span className="font-semibold text-stone-700">{label}</span><span className="text-stone-500">{value}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, Math.round(value / funnelMax * 100))}%` }} /></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white p-5">
              <div className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-emerald-600" /><h4 className="font-bold text-stone-950">{tr('Расход по операциям', 'Spend by operation')}</h4></div>
              <div className="mt-4 space-y-2">
                {data.ai.byOperation.slice(0, 8).map(item => (
                  <div key={item.operation} className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-stone-800">{item.operation}</div>
                      <div className="mt-0.5 text-[10px] text-stone-400">{item.requests} req · {number(item.tokens)} tokens</div>
                    </div>
                    <div className="shrink-0 text-xs font-bold text-stone-900">{usd(item.estimatedCostUsd)}</div>
                  </div>
                ))}
                {!data.ai.byOperation.length && <div className="py-8 text-center text-xs text-stone-400">{tr('Пока нет AI usage за период', 'No AI usage in this period')}</div>}
              </div>
            </section>
          </div>
        </>
      )}

      {tab === 'users' && (
        <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5">
          {currentRole === 'owner' && (
            <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-stone-950">{tr('Пригласить администратора', 'Invite admin')}</div>
                  <div className="mt-1 text-[11px] leading-5 text-stone-500">
                    {tr('Ссылка одноразовая, привязана к email и автоматически истекает.', 'The link is single-use, email-bound and expires automatically.')}
                  </div>
                  <input type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="admin@example.com"
                    className="mt-3 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs outline-none focus:border-emerald-300" />
                </div>
                <label className="text-[10px] font-semibold text-stone-500">
                  {tr('Срок', 'Expiry')}
                  <CustomSelect
                    value={String(inviteExpiryHours)}
                    onChange={value => setInviteExpiryHours(Number(value))}
                    ariaLabel={tr('Срок приглашения', 'Invite expiry')}
                    className="mt-1 w-[120px]"
                    triggerClassName="!h-10 !text-xs"
                    options={[
                      { value: '24', label: '24h' },
                      { value: '48', label: '48h' },
                      { value: '72', label: '72h' },
                      { value: '168', label: '7d' },
                    ]}
                  />
                </label>
                <button type="button" disabled={inviteBusy || !inviteEmail.trim()} onClick={() => void createInvite()}
                  className="h-10 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50">
                  {inviteBusy ? tr('Создаю…', 'Creating…') : tr('Создать ссылку', 'Create link')}
                </button>
              </div>
              {inviteError && <div className="mt-3 text-xs text-rose-600">{inviteError}</div>}
              {inviteLink && (
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-emerald-100 bg-white p-3 sm:flex-row sm:items-center">
                  <input readOnly value={inviteLink} className="h-9 min-w-0 flex-1 rounded-lg bg-stone-50 px-3 text-[11px] text-stone-600" />
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(inviteLink)}
                    className="h-9 rounded-lg border border-stone-200 px-3 text-[11px] font-semibold text-stone-700 hover:bg-stone-50">
                    {tr('Копировать', 'Copy')}
                  </button>
                </div>
              )}
              {adminInvites.length > 0 && (
                <div className="mt-3 space-y-2">
                  {adminInvites.slice(0, 6).map(invite => (
                    <div key={invite.id} className="flex flex-col gap-2 rounded-xl border border-emerald-100/80 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-stone-800">{invite.email}</div>
                        <div className="mt-0.5 text-[10px] text-stone-400">{invite.status} · {tr('до', 'until')} {new Date(invite.expiresAt).toLocaleString()}</div>
                      </div>
                      {invite.status === 'active' && (
                        <button type="button" disabled={inviteBusy} onClick={() => void revokeInvite(invite.id)}
                          className="h-8 rounded-lg border border-rose-100 px-2.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                          {tr('Отозвать', 'Revoke')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="font-bold text-stone-950">{tr('Пользователи', 'Users')}</h4>
              <p className="mt-1 text-xs text-stone-500">{tr('Использование и оценочная стоимость по каждому аккаунту.', 'Usage and estimated cost per account.')}</p>
            </div>
            <label className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <input value={userSearch} onChange={event => setUserSearch(event.target.value)}
                placeholder={tr('Поиск пользователя…', 'Search users…')}
                className="h-10 w-full rounded-xl border border-stone-200 pl-9 pr-3 text-xs outline-none focus:border-emerald-300" />
            </label>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-stone-400">
                <tr><th className="px-3 py-2">User</th><th>Last active</th><th>Analyses</th><th>Outputs</th><th>Tokens</th><th>Est. cost</th><th>Quota</th><th /></tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const quotaPct = Math.round((user.quota.used.radarAnalyses / Math.max(1, user.quota.limits.radarAnalyses)) * 100);
                  return (
                    <tr key={user.ownerId} className="border-t border-stone-100 hover:bg-stone-50/70">
                      <td className="px-3 py-3"><div className="font-semibold text-stone-900">{user.name}</div><div className="mt-0.5 text-[10px] text-stone-400">{user.email || user.ownerId}</div></td>
                      <td className="text-stone-500">{user.lastActive ? new Date(user.lastActive).toLocaleString() : '—'}</td>
                      <td>{user.analyses}</td><td>{user.outputs}</td><td>{number(user.tokens.total)}</td><td>{usd(user.estimatedCostUsd)}</td>
                      <td><div className="w-24"><div className="mb-1 text-[10px] text-stone-500">{quotaPct}% Radar</div><div className="h-1.5 rounded-full bg-stone-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: Math.min(100, quotaPct) + '%' }} /></div></div></td>
                      <td className="text-right"><button type="button" onClick={() => setSelectedUser(user)} className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><ChevronRight className="h-4 w-4" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'ai' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              [tr('Всего токенов', 'Total tokens'), number(data.ai.totalTokens)],
              ['Input tokens', number(data.ai.inputTokens)],
              ['Output tokens', number(data.ai.outputTokens)],
              [tr('Оценочная стоимость', 'Estimated cost'), usd(data.ai.estimatedCostUsd)],
            ].map(([label, value]) => <div key={label} className="rounded-2xl border border-stone-200 bg-white p-4"><div className="text-[11px] font-semibold text-stone-500">{label}</div><div className="mt-2 text-xl font-bold text-stone-950">{value}</div></div>)}
          </div>

          <section className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h4 className="font-bold text-stone-950">{tr('Провайдеры транскрипции', 'Transcription providers')}</h4>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-stone-500">
                  {tr(
                    'Внутренняя инфраструктура: клиентам эти лимиты не показываются. Live означает баланс от API провайдера; Estimated — локальную оценку до получения live-данных.',
                    'Internal infrastructure: these limits are not shown to clients. Live means provider-reported balance; Estimated means local fallback until live data is observed.'
                  )}
                </p>
              </div>
              <div className="shrink-0 rounded-xl bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
                YouTube captions → Supadata → ChocoData → Gemini Audio
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.ai.providerQuota.filter(item => item.category === 'transcription').map(item => {
                const known = item.limit !== null && item.remaining !== null;
                const percent = known && item.limit ? Math.min(100, Math.round((item.used / item.limit) * 100)) : 0;
                const live = item.accuracy === 'live';
                const status = !item.configured
                  ? tr('Не настроен', 'Not configured')
                  : known && item.remaining === 0
                    ? tr('Лимит исчерпан', 'Exhausted')
                    : tr('Доступен', 'Available');
                return (
                  <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-stone-900">{item.provider}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ring-1 ${live ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-white text-stone-500 ring-stone-200'}`}>
                            {live ? 'Live' : item.accuracy === 'estimated' ? 'Estimated' : 'Unknown'}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-stone-400">{item.tier} · {item.source}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${!item.configured ? 'bg-stone-200 text-stone-500' : known && item.remaining === 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{status}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-100"><div className="text-[9px] uppercase text-stone-400">{tr('Использовано', 'Used')}</div><div className="mt-1 text-sm font-bold text-stone-900">{number(item.used)}</div></div>
                      <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-100"><div className="text-[9px] uppercase text-stone-400">{tr('Лимит', 'Limit')}</div><div className="mt-1 text-sm font-bold text-stone-900">{item.limit === null ? '—' : number(item.limit)}</div></div>
                      <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-100"><div className="text-[9px] uppercase text-stone-400">{tr('Осталось', 'Remaining')}</div><div className="mt-1 text-sm font-bold text-stone-900">{item.remaining === null ? '—' : number(item.remaining)}</div></div>
                    </div>
                    {known && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200"><div className={`h-full rounded-full ${percent >= 100 ? 'bg-rose-500' : percent >= 75 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} /></div>}
                    <div className="mt-3 text-[10px] leading-4 text-stone-400">
                      {item.reset ? `${tr('Сброс', 'Reset')}: ${item.reset}` : null}
                      {item.checkedAt ? ` · ${tr('проверено', 'checked')} ${new Date(item.checkedAt).toLocaleString()}` : ''}
                      {item.note ? <div className="mt-1 text-stone-500">{item.note}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="font-bold text-stone-950">{tr('Бесплатные лимиты и остатки', 'Free quotas & remaining')}</h4>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {tr(
                    'Usage считаем на сервере. Если провайдер не отдаёт точный баланс, остаток помечен как оценка или неизвестный — без выдуманных цифр.',
                    'Usage is counted server-side. When a provider does not expose an exact balance, remaining is explicitly marked estimated or unknown.'
                  )}
                </p>
              </div>
              <div className="shrink-0 rounded-xl bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
                Web Search / month · {number(data.ai.searchRequestsThisMonth)}
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.ai.providerQuota.filter(item => item.category !== 'transcription').map(item => {
                const known = item.limit !== null && item.remaining !== null;
                const percent = known && item.limit ? Math.min(100, Math.round((item.used / item.limit) * 100)) : 0;
                const status = !item.configured
                  ? tr('Не настроен', 'Not configured')
                  : known
                    ? item.remaining === 0 ? tr('Лимит исчерпан', 'Exhausted') : tr('Доступен', 'Available')
                    : tr('Лимит неизвестен', 'Limit unknown');
                return (
                  <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-stone-900">{item.provider}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold uppercase text-stone-500 ring-1 ring-stone-200">{item.category}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-stone-400">{item.tier} · reset: {item.reset}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${!item.configured ? 'bg-stone-200 text-stone-500' : known && item.remaining === 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{status}</span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-100">
                        <div className="text-[9px] uppercase text-stone-400">{tr('Использовано', 'Used')}</div>
                        <div className="mt-1 text-sm font-bold text-stone-900">{number(item.used)}</div>
                      </div>
                      <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-100">
                        <div className="text-[9px] uppercase text-stone-400">{tr('Лимит', 'Limit')}</div>
                        <div className="mt-1 text-sm font-bold text-stone-900">{item.limit === null ? '—' : number(item.limit)}</div>
                      </div>
                      <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-100">
                        <div className="text-[9px] uppercase text-stone-400">{tr('Осталось', 'Remaining')}</div>
                        <div className="mt-1 text-sm font-bold text-stone-900">{item.remaining === null ? '—' : number(item.remaining)}</div>
                      </div>
                    </div>

                    {item.tokenUsed !== undefined && (
                      <div className="mt-2 rounded-xl bg-white px-3 py-2 text-[10px] text-stone-500 ring-1 ring-stone-100">
                        Tokens: {number(item.tokenUsed)}
                        {item.tokenLimit !== undefined && item.tokenLimit !== null ? ` / ${number(item.tokenLimit)} · ${number(item.tokenRemaining || 0)} left` : ''}
                      </div>
                    )}

                    {known && (
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200">
                        <div className={`h-full rounded-full ${percent >= 100 ? 'bg-rose-500' : percent >= 75 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
                      </div>
                    )}

                    <div className="mt-3 text-[10px] leading-4 text-stone-400">
                      {item.source} · {item.accuracy}
                      {item.note ? <div className="mt-1 text-stone-500">{item.note}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold text-stone-950">{tr('Провайдеры и модели', 'Providers & models')}</h4><div className="text-xs text-stone-500">Free {data.ai.freeRequests} · Paid {data.ai.paidRequests}</div></div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="text-[10px] uppercase text-stone-400"><tr><th>Provider / Model</th><th>Tier</th><th>Requests</th><th>Tokens</th><th>Fallbacks</th><th>Errors</th><th>Est. cost</th></tr></thead>
                <tbody>{data.ai.byModel.map(item => <tr key={item.provider + item.model + item.billingPhase} className="border-t border-stone-100"><td className="py-3 font-semibold text-stone-800">{item.provider} · {item.model}</td><td>{item.billingPhase}</td><td>{item.requests}</td><td>{number(item.totalTokens)}</td><td>{item.fallbackCount}</td><td>{item.errors}</td><td>{usd(item.estimatedCostUsd)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'product' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-3xl border border-stone-200 bg-white p-5">
            <h4 className="font-bold text-stone-950">Discovery</h4>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              {[
                ['Runs', data.product.discoveryRuns], [tr('Найдено', 'Found'), data.product.recommendationsFound],
                ['Interested', data.product.feedback.interested], ['Not interested', data.product.feedback.notInterested],
                ['Skip', data.product.feedback.skipped], ['Interested rate', pct(data.product.feedback.interestedRate)],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-stone-50 p-3"><div className="text-[10px] text-stone-400">{label}</div><div className="mt-1 font-bold text-stone-900">{value}</div></div>)}
            </div>
          </section>
          <section className="rounded-3xl border border-stone-200 bg-white p-5">
            <h4 className="font-bold text-stone-950">Ideas → Outputs</h4>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              {[
                ['Ideas', data.product.ideasCreated], ['Saved', data.product.ideasSaved], ['Outputs', data.product.outputsCreated],
                ['Regenerations', data.product.regenerations], ['Scheduled', data.product.scheduled],
                ['Idea → Output', data.product.ideasCreated ? pct(data.product.outputsCreated / data.product.ideasCreated) : '0%'],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-stone-50 p-3"><div className="text-[10px] text-stone-400">{label}</div><div className="mt-1 font-bold text-stone-900">{value}</div></div>)}
            </div>
          </section>
        </div>
      )}

      {tab === 'llm' && (
        <div className="space-y-4">
          <section className="rounded-3xl border border-stone-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2"><BrainCircuit className="h-4 w-4 text-emerald-600" /><h4 className="font-bold text-stone-950">LLM Task Registry</h4></div>
                <p className="mt-1 text-xs text-stone-500">{tr('Версия промпта, routing, лимиты и контракт результата для каждой AI-задачи.', 'Prompt version, routing, limits and output contract for every AI task.')}</p>
              </div>
              {onOpenPromptsModal && <button type="button" onClick={onOpenPromptsModal} className="h-9 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 hover:bg-stone-50">{tr('Legacy prompt library', 'Legacy prompt library')}</button>}
            </div>
            <div className="mt-4 space-y-3">
              {data.llm.tasks.map(task => (
                <div key={task.id} className="rounded-2xl border border-stone-200 p-4">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-stone-900">{task.id}</span><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">{task.version}</span><span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] text-stone-500">{task.taskClass}</span><span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] text-stone-500">T {task.temperature} · max {task.maxTokens}</span></div>
                  <p className="mt-2 text-xs leading-5 text-stone-600">{task.purpose}</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-xl bg-stone-50 p-3"><div className="text-[10px] font-semibold uppercase text-stone-400">Prompt source</div><div className="mt-1 break-all font-mono text-[11px] text-stone-700">{task.promptSource}</div></div>
                    <div className="rounded-xl bg-stone-50 p-3"><div className="text-[10px] font-semibold uppercase text-stone-400">Output contract</div><div className="mt-1 text-[11px] leading-5 text-stone-700">{task.outputContract}</div></div>
                  </div>
                  <div className="mt-2 text-[10px] leading-4 text-stone-400">{task.fallbackPolicy}</div>
                </div>
              ))}
            </div>
          </section>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
            <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><b>{tr('Evals', 'Evals')}:</b> {tr('CI проверяет контракты и инварианты без платных LLM-вызовов. Provider eval запускается вручную и сравнивается по task + promptVersion.', 'CI checks contracts and invariants without paid LLM calls. Provider eval runs manually and is compared by task + promptVersion.')}</div></div>
          </div>
        </div>
      )}

      {tab === 'infrastructure' && (
        <div className="space-y-4">
          <section className="rounded-3xl border border-stone-200 bg-white p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-600" />
                  <h4 className="font-bold text-stone-950">{tr('Состояние системы', 'System health')}</h4>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {tr('Сводка по хранилищу, AI, поиску, транскрипции, публикации и целостности данных.', 'Storage, AI, search, transcription, publishing and data integrity at a glance.')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadStorageStatus()}
                disabled={storageRefreshing}
                className="inline-flex h-8 w-fit shrink-0 items-center gap-1.5 rounded-xl border border-stone-200 px-2.5 text-[11px] font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
              >
                <RefreshCw className={'h-3.5 w-3.5 ' + (storageRefreshing ? 'animate-spin' : '')} />
                {tr('Обновить', 'Refresh')}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
              {(diagnostics?.health || []).map(item => {
                const labels: Record<string, string> = {
                  storage: tr('Хранилище', 'Storage'),
                  ai: 'AI',
                  search: tr('Поиск', 'Search'),
                  transcription: tr('Транскрипция', 'Transcription'),
                  publishing: tr('Публикация', 'Publishing'),
                  queue: tr('Очередь', 'Queue'),
                  integrations: tr('Интеграции', 'Integrations'),
                  dataIntegrity: tr('Данные', 'Data'),
                };
                const stateClass = item.state === 'healthy'
                  ? 'bg-emerald-100 text-emerald-700'
                  : item.state === 'attention'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-stone-100 text-stone-500';
                return (
                  <div key={item.id} className="min-w-0 rounded-2xl bg-stone-50 p-3">
                    <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-stone-400">{labels[item.id] || item.id}</div>
                    <div className={'mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ' + stateClass}>
                      {item.state === 'healthy' ? tr('Исправно', 'Healthy') : item.state === 'attention' ? tr('Внимание', 'Attention') : tr('Недоступно', 'Unavailable')}
                    </div>
                  </div>
                );
              })}
            </div>
            {diagnostics?.generatedAt && <div className="mt-3 text-[10px] text-stone-400">{tr('Проверено', 'Checked')}: {new Date(diagnostics.generatedAt).toLocaleString()}</div>}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-3xl border border-stone-200 bg-white p-5">
              <div className="flex items-center gap-2"><Database className="h-4 w-4 text-emerald-600" /><h4 className="font-bold text-stone-950">{tr('Хранилище и миграция', 'Storage & migration')}</h4></div>
              <p className="mt-1 text-xs text-stone-500">{tr('Физическая схема Firestore и готовность legacy snapshot к удалению.', 'Firestore schema and legacy snapshot retirement readiness.')}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-stone-50 p-3"><div className="text-[10px] uppercase text-stone-400">Format</div><div className="mt-1 text-xs font-bold text-emerald-700">{diagnostics?.storage.format || '—'}</div></div>
                <div className="rounded-xl bg-stone-50 p-3"><div className="text-[10px] uppercase text-stone-400">{tr('Сущности', 'Entities')}</div><div className="mt-1 text-xs font-bold text-stone-900">{number(diagnostics?.storage.entityCount || 0)}</div></div>
                <div className="rounded-xl bg-stone-50 p-3"><div className="text-[10px] uppercase text-stone-400">Chunks</div><div className="mt-1 text-xs font-bold text-stone-900">{diagnostics?.storage.chunkCount ?? '—'}</div></div>
              </div>
              <div className="mt-3 space-y-2 text-xs text-stone-600">
                <div className="flex justify-between gap-3"><span>Mode</span><b className="text-stone-900">{diagnostics?.storage.mode || storage?.mode || '—'}</b></div>
                <div className="flex justify-between gap-3"><span>Firestore</span><b className="max-w-[58%] truncate text-stone-900">{diagnostics?.storage.databaseId || storage?.firestoreDatabaseId || '—'}</b></div>
                <div className="flex justify-between gap-3"><span>{tr('Миграция', 'Migration')}</span><b className={diagnostics?.migration.state === 'verified' ? 'text-emerald-700' : 'text-amber-700'}>{diagnostics?.migration.state || '—'}</b></div>
                <div className="flex justify-between gap-3"><span>{tr('Legacy fallback', 'Legacy fallback')}</span><b className="text-stone-900">{diagnostics?.migration.legacySnapshotRetained ? tr('Сохранён', 'Retained') : tr('Нет', 'No')}</b></div>
                <div className="flex justify-between gap-3"><span>{tr('Можно удалить legacy', 'Safe to retire legacy')}</span><b className={diagnostics?.migration.safeToRetireLegacy ? 'text-emerald-700' : 'text-amber-700'}>{diagnostics?.migration.safeToRetireLegacy ? tr('Да', 'Yes') : tr('Пока нет', 'Not yet')}</b></div>
              </div>
              {diagnostics?.storage.lastError && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700">{diagnostics.storage.lastError}</div>}
              <details className="mt-4 rounded-xl border border-stone-200">
                <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-stone-700">{tr('Коллекции', 'Collections')}</summary>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-stone-100 px-3 py-3 text-[11px] sm:grid-cols-3">
                  {Object.entries(diagnostics?.storage.collections || {}).map(([name, value]) => <div key={name} className="flex justify-between gap-2"><span className="truncate text-stone-500">{name}</span><b className="text-stone-900">{value}</b></div>)}
                </div>
              </details>
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white p-5">
              <div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-emerald-600" /><h4 className="font-bold text-stone-950">{tr('Очереди и фоновые задачи', 'Queues & background jobs')}</h4></div>
              <p className="mt-1 text-xs text-stone-500">{tr('Зависшие задачи и последние фоновые операции.', 'Stuck work and recent background activity.')}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  [tr('В очереди', 'Pending'), diagnostics?.jobs.pendingQueue ?? 0],
                  [tr('Активно', 'Active'), diagnostics?.jobs.activeQueue ?? 0],
                  [tr('Зависшие видео', 'Stuck videos'), diagnostics?.jobs.stuckVideos ?? 0],
                  [tr('Зависшие публикации', 'Stuck publishing'), diagnostics?.jobs.stuckPublicationJobs ?? 0],
                  [tr('Ошибки публикации 24ч', 'Publish failures 24h'), diagnostics?.jobs.publicationFailed24h ?? 0],
                  [tr('Ошибки Radar 24ч', 'Radar failures 24h'), (diagnostics?.jobs.discoveryFailed24h ?? 0) + (diagnostics?.jobs.radarScanFailed24h ?? 0)],
                ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-stone-50 p-3"><div className="text-[10px] text-stone-400">{label}</div><div className={'mt-1 text-sm font-bold ' + (Number(value) > 0 && String(label).toLowerCase().includes('ошиб') ? 'text-amber-700' : 'text-stone-900')}>{value}</div></div>)}
              </div>
              <div className="mt-4 space-y-2 text-xs text-stone-600">
                <div className="flex justify-between gap-3"><span>{tr('Последний Discovery', 'Last Discovery')}</span><b className="text-right text-stone-900">{diagnostics?.jobs.lastDiscoveryRunAt ? new Date(diagnostics.jobs.lastDiscoveryRunAt).toLocaleString() : '—'}</b></div>
                <div className="flex justify-between gap-3"><span>{tr('Последний Radar Analysis', 'Last Radar Analysis')}</span><b className="text-right text-stone-900">{diagnostics?.jobs.lastRadarScanAt ? new Date(diagnostics.jobs.lastRadarScanAt).toLocaleString() : '—'}</b></div>
                <div className="flex justify-between gap-3"><span>{tr('Последняя публикация', 'Last publication update')}</span><b className="text-right text-stone-900">{diagnostics?.jobs.lastPublicationUpdateAt ? new Date(diagnostics.jobs.lastPublicationUpdateAt).toLocaleString() : '—'}</b></div>
              </div>
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white p-5">
              <div className="flex items-center gap-2"><BrainCircuit className="h-4 w-4 text-emerald-600" /><h4 className="font-bold text-stone-950">{tr('AI, Search и Transcription', 'AI, Search & Transcription')}</h4></div>
              <p className="mt-1 text-xs text-stone-500">{tr('Фактическое использование и ошибки за последние 24 часа.', 'Actual usage and failures over the last 24 hours.')}</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ['AI', diagnostics?.providers.llm.requests24h || 0, diagnostics?.providers.llm.failed24h || 0],
                  [tr('Поиск', 'Search'), diagnostics?.providers.search.requests24h || 0, diagnostics?.providers.search.failed24h || 0],
                  [tr('Транскрипция', 'Transcript'), diagnostics?.providers.transcription.requests24h || 0, diagnostics?.providers.transcription.failed24h || 0],
                ].map(([label, requests, failed]) => <div key={String(label)} className="min-w-0 rounded-xl bg-stone-50 p-3"><div className="truncate text-[10px] text-stone-400">{label}</div><div className="mt-1 text-sm font-bold text-stone-900">{requests}</div><div className={'mt-1 text-[10px] ' + (Number(failed) ? 'text-amber-700' : 'text-emerald-700')}>{failed} {tr('ошибок', 'failed')}</div></div>)}
              </div>
              <div className="mt-4 rounded-xl border border-stone-200">
                {(diagnostics?.providers.llm.configured || []).slice(0, 8).map((item: any) => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-stone-100 px-3 py-2.5 text-xs last:border-0"><span className="min-w-0 truncate font-semibold text-stone-700">{item.provider}</span><span className={item.configured ? 'text-emerald-700' : 'text-stone-400'}>{item.configured ? tr('настроен', 'configured') : tr('нет ключа', 'not configured')}</span></div>)}
              </div>
              <div className="mt-3 text-[10px] text-stone-400">{tr('Paid AI вызовов за 24ч', 'Paid AI calls in 24h')}: {diagnostics?.providers.llm.paidRequests24h || 0}</div>
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /><h4 className="font-bold text-stone-950">{tr('Интеграции', 'Integrations')}</h4></div>
              <p className="mt-1 text-xs text-stone-500">{tr('Конфигурация OAuth и срок действия серверных social tokens.', 'OAuth configuration and server-side social token expiry.')}</p>
              <div className="mt-4 space-y-2">
                {(diagnostics?.integrations.social || []).map(item => (
                  <div key={item.platform} className="rounded-xl bg-stone-50 px-3 py-3">
                    <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold capitalize text-stone-800">{item.platform}</span><span className={item.configured ? 'text-[10px] font-semibold text-emerald-700' : 'text-[10px] font-semibold text-stone-400'}>{item.configured ? tr('настроен', 'configured') : tr('не настроен', 'not configured')}</span></div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-stone-500"><span>{tr('Подключений', 'Connections')}: {item.connections}</span><span>{tr('Истекло', 'Expired')}: {item.expired}</span><span>{tr('Истекает <7д', 'Expires <7d')}: {item.expiringSoon}</span></div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-stone-200 px-3 py-3 text-[11px] leading-5 text-stone-500">
                <b className="text-stone-700">Google Calendar:</b> {tr('OAuth хранится в браузерной сессии, поэтому сервер не может достоверно показывать его health для всех пользователей.', 'OAuth is browser-session scoped, so the server cannot reliably report global health for all users.')}
              </div>
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white p-5 lg:col-span-2">
              <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /><h4 className="font-bold text-stone-950">{tr('Целостность данных', 'Data integrity')}</h4></div>
              <p className="mt-1 text-xs text-stone-500">{tr('Ссылочная целостность основных сущностей. Workflow-only Scheduled без даты считается валидным состоянием.', 'Referential integrity across core entities. Workflow-only Scheduled without a date is valid.')}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {Object.entries(diagnostics?.dataIntegrity.issues || {}).map(([name, value]) => (
                  <div key={name} className="min-w-0 rounded-xl bg-stone-50 p-3">
                    <div className="break-words text-[10px] leading-4 text-stone-400">{name}</div>
                    <div className={'mt-1 text-sm font-bold ' + (value ? 'text-amber-700' : 'text-emerald-700')}>{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-stone-500">
                <span>{tr('Всего проблем', 'Total issues')}: <b className={diagnostics?.dataIntegrity.issueCount ? 'text-amber-700' : 'text-emerald-700'}>{diagnostics?.dataIntegrity.issueCount ?? '—'}</b></span>
                <span>{tr('Workflow-only Scheduled', 'Workflow-only Scheduled')}: <b className="text-stone-800">{diagnostics?.dataIntegrity.workflowOnlyScheduled ?? '—'}</b></span>
              </div>
            </section>
          </div>
        </div>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-[120] bg-black/25" onMouseDown={event => { if (event.currentTarget === event.target) setSelectedUser(null); }}>
          <aside className="absolute inset-y-0 right-0 w-full max-w-lg overflow-y-auto border-l border-stone-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-lg font-bold text-stone-950">{selectedUser.name}</div><div className="mt-1 text-xs text-stone-400">{selectedUser.email || selectedUser.ownerId}</div></div>
              <button type="button" onClick={() => setSelectedUser(null)} className="rounded-xl p-2 text-stone-400 hover:bg-stone-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                ['Last active', selectedUser.lastActive ? new Date(selectedUser.lastActive).toLocaleString() : '—'],
                ['Onboarding', selectedUser.onboardingCompleted ? 'complete' : 'pending'],
                ['Tokens', number(selectedUser.tokens.total)],
                ['Est. cost', usd(selectedUser.estimatedCostUsd)],
                ['Radar analyses', selectedUser.analyses],
                ['Outputs', selectedUser.outputs],
                ['Interested', selectedUser.feedback.interested],
                ['Not interested', selectedUser.feedback.notInterested],
                ['Skip', selectedUser.feedback.skipped],
                ['Ideas', selectedUser.ideas],
                ['Saved', selectedUser.savedIdeas],
                ['Scheduled', selectedUser.scheduled],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-stone-50 p-3"><div className="text-[10px] text-stone-400">{label}</div><div className="mt-1 text-xs font-bold text-stone-900">{value}</div></div>)}
            </div>
            <div className="mt-5 rounded-2xl border border-stone-200 p-4">
              <div className="text-xs font-bold text-stone-900">Quota</div>
              <div className="mt-3 space-y-3">
                {[
                  ['Radar analyses', selectedUser.quota.used.radarAnalyses, selectedUser.quota.limits.radarAnalyses],
                  ['Generations', selectedUser.quota.used.scriptGenerations, selectedUser.quota.limits.scriptGenerations],
                ].map(([label, used, limit]) => {
                  const progress = Math.min(100, Math.round(Number(used) / Math.max(1, Number(limit)) * 100));
                  return <div key={String(label)}><div className="mb-1 flex justify-between text-[10px] text-stone-500"><span>{label}</span><span>{used} / {limit}</span></div><div className="h-1.5 rounded-full bg-stone-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: progress + '%' }} /></div></div>;
                })}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
