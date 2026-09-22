import React, { useEffect, useMemo, useState } from 'react';
import { Archive, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Clipboard, Copy, Download, ExternalLink, FileText, Globe2, Instagram, Link2, MoreHorizontal, Music2, Pencil, RotateCcw, Save, Search, Send, SlidersHorizontal, Sparkles, X, Youtube } from 'lucide-react';
import { createGoogleDocFromHtml } from '../services/googleDocsService';
import { GeneratedScript, RadarScriptDetail, RadarScriptFeedbackReason } from '../types';
import { authFetch } from '../services/authFetch';
import { createContentRadarCalendarEvent, deleteContentRadarCalendarEvent } from '../services/googleCalendarService';
import { useI18n } from '../i18n';

interface RadarScriptsWorkspaceProps {
  onGoIdeas: () => void;
  onOpenCalendar?: () => void;
  initialSelectedId?: string;
}

type ScriptFilter = 'all' | 'review' | 'approved' | 'scheduled' | 'published' | 'archived';
type ScriptSort = 'updated' | 'newest' | 'status';

export const RadarScriptsWorkspace: React.FC<RadarScriptsWorkspaceProps> = ({ onGoIdeas, onOpenCalendar, initialSelectedId }) => {
  const { locale, t } = useI18n();
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [filter, setFilter] = useState<ScriptFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<ScriptSort>('updated');
  const [openPanel, setOpenPanel] = useState<'source' | 'history' | null>('source');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RadarScriptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [publicationPlatform, setPublicationPlatform] = useState<NonNullable<GeneratedScript['publicationPlatform']>>('instagram');
  const [syncGoogleCalendar, setSyncGoogleCalendar] = useState(false);

  const loadScripts = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/radar/scripts');
      if (res.ok) setScripts(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const openScript = async (id: string) => {
    setSelectedId(id);
    setError(null);
    const res = await authFetch('/api/radar/scripts/' + id + '/detail');
    if (!res.ok) {
      setError(t('scripts.loadError'));
      return;
    }
    const data = await res.json();
    setDetail(data);
    setDraftContent(data.script?.content || '');
    const scheduledDate = data.script?.scheduledAt ? new Date(data.script.scheduledAt) : null;
    if (scheduledDate && !Number.isNaN(scheduledDate.getTime())) {
      const local = new Date(scheduledDate.getTime() - scheduledDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      setScheduleAt(local);
    } else {
      setScheduleAt('');
    }
    setPublicationPlatform(data.script?.publicationPlatform || 'instagram');
    setShowSchedule(false);
    setIsEditing(false);
  };

  const refresh = async (id?: string) => {
    const res = await authFetch('/api/radar/scripts');
    if (res.ok) setScripts(await res.json());
    const target = id || selectedId;
    if (target) await openScript(target);
  };

  useEffect(() => { void loadScripts(); }, []);

  useEffect(() => {
    if (initialSelectedId) void openScript(initialSelectedId);
  }, [initialSelectedId]);

  const review = async (script: GeneratedScript, decision: 'approved' | 'rewrite' | 'rejected', reason?: RadarScriptFeedbackReason) => {
    if (!script.radarOpportunityId) return;
    setBusyId(script.id);
    setError(null);
    try {
      const res = await authFetch('/api/radar/script-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: script.id, opportunityId: script.radarOpportunityId, decision, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Review failed');

      if (decision === 'rewrite') {
        const gen = await authFetch('/api/radar/opportunities/' + script.radarOpportunityId + '/script', { method: 'POST' });
        const generated = await gen.json().catch(() => ({}));
        if (!gen.ok) throw new Error(generated.error || 'Rewrite failed');
        await refresh(generated.script?.id);
      } else if (decision === 'approved') {
        const scriptsRes = await authFetch('/api/radar/scripts');
        const latestScripts = scriptsRes.ok ? await scriptsRes.json() as GeneratedScript[] : [];
        if (scriptsRes.ok) setScripts(latestScripts);

        const next = latestScripts.find(
          item => item.id !== script.id && !item.isReviewed && !item.archivedAt
        );
        if (next) {
          setFilter('review');
          await openScript(next.id);
        } else {
          await openScript(script.id);
        }
      } else {
        await refresh(script.id);
      }
    } catch (e: any) {
      setError(e?.message || 'Ошибка review');
    } finally {
      setBusyId(null);
    }
  };

  const send = async (script: GeneratedScript) => {
    setBusyId(script.id);
    setError(null);
    try {
      const res = await authFetch('/api/radar/scripts/' + script.id + '/send-telegram', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Send failed');
      await refresh(script.id);
    } catch (e: any) {
      setError(e?.message || 'Ошибка отправки');
    } finally {
      setBusyId(null);
    }
  };

  const saveManualVersion = async (script: GeneratedScript) => {
    const content = draftContent.trim();
    if (!content || content === script.content.trim()) {
      setIsEditing(false);
      return;
    }
    setBusyId(script.id);
    setError(null);
    try {
      const res = await authFetch('/api/radar/scripts/' + script.id + '/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save version failed');
      setFilter('review');
      await refresh(data.script?.id);
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения версии');
    } finally {
      setBusyId(null);
    }
  };

  const recordExport = async (script: GeneratedScript, method: 'copy' | 'download' | 'telegram' | 'google_docs') => {
    const res = await authFetch('/api/radar/scripts/' + script.id + '/exported', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Export tracking failed');
    return data.script as GeneratedScript;
  };

  const copyScript = async (script: GeneratedScript) => {
    setBusyId(script.id);
    setError(null);
    try {
      await navigator.clipboard.writeText(script.content);
      await recordExport(script, 'copy');
      await refresh(script.id);
    } catch (e: any) {
      setError(e?.message || 'Не удалось скопировать сценарий');
    } finally {
      setBusyId(null);
    }
  };

  const downloadScript = async (script: GeneratedScript) => {
    setBusyId(script.id);
    setError(null);
    try {
      const safeTitle = (script.ideaTitle || script.title || 'script')
        .replace(/[^a-zA-Z0-9а-яА-ЯёЁ _-]+/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 80) || 'script';
      const blob = new Blob([script.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeTitle + '-v' + (script.version || 1) + '.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await recordExport(script, 'download');
      await refresh(script.id);
    } catch (e: any) {
      setError(e?.message || 'Не удалось скачать сценарий');
    } finally {
      setBusyId(null);
    }
  };

  const exportToGoogleDocs = async (script: GeneratedScript) => {
    const popup = window.open('', '_blank');
    setBusyId(script.id);
    setError(null);
    try {
      const title = script.ideaTitle || script.title || 'Script';
      const escapeHtml = (value: string) => value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      const escapedTitle = escapeHtml(title);
      const escapedContent = escapeHtml(script.content);
      const html = `<!doctype html><html><body><h1>${escapedTitle}</h1><pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapedContent}</pre></body></html>`;
      const doc = await createGoogleDocFromHtml(title, html);
      if (!doc) throw new Error('Google Docs creation cancelled');
      await recordExport(script, 'google_docs');
      if (popup && !popup.closed) {
        popup.location.href = doc.url;
      } else {
        window.location.href = doc.url;
      }
      await refresh(script.id);
    } catch (e: any) {
      if (popup && !popup.closed) popup.close();
      setError(e?.message || 'Не удалось экспортировать в Google Docs');
    } finally {
      setBusyId(null);
    }
  };

  const scheduleScript = async (script: GeneratedScript) => {
    if (!scheduleAt) {
      setError('Выберите дату и время публикации');
      return;
    }
    setBusyId(script.id);
    setError(null);
    try {
      let calendarWarning: string | null = null;
      const scheduledAt = new Date(scheduleAt).toISOString();
      const saveRes = await authFetch('/api/radar/scripts/' + script.id + '/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt, publicationPlatform }),
      });
      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saved.error || 'Schedule failed');

      if (syncGoogleCalendar) {
        try {
          const event = await createContentRadarCalendarEvent({
            title: script.ideaTitle || script.title,
            description: script.content.slice(0, 1800),
            scheduledAt,
            publicationPlatform,
          }, script.calendarId && script.calendarEventId ? { calendarId: script.calendarId, eventId: script.calendarEventId } : undefined);
          const syncRes = await authFetch('/api/radar/scripts/' + script.id + '/schedule', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              publicationPlatform,
              calendarProvider: 'google',
              calendarId: event.calendarId,
              calendarEventId: event.eventId,
            }),
          });
          if (!syncRes.ok) throw new Error('Google event created, but sync metadata could not be saved');
        } catch (calendarError: any) {
          calendarWarning = 'Расписание сохранено в Content Radar, но Google Calendar не синхронизирован: ' + (calendarError?.message || 'ошибка');
        }
      }

      if (!syncGoogleCalendar && script.calendarEventId) calendarWarning = 'Расписание сохранено. Событие Google Calendar осталось без изменений; включите синхронизацию, чтобы обновить его.';
      setShowSchedule(false);
      setFilter('scheduled');
      await refresh(script.id);
      if (calendarWarning) setError(calendarWarning);
    } catch (e: any) {
      setError(e?.message || 'Ошибка планирования публикации');
    } finally {
      setBusyId(null);
    }
  };

  const unscheduleScript = async (script: GeneratedScript) => {
    setBusyId(script.id);
    setError(null);
    try {
      const res = await authFetch('/api/radar/scripts/' + script.id + '/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unschedule failed');
      let calendarWarning: string | null = null;
      if (script.calendarId && script.calendarEventId) {
        try {
          await deleteContentRadarCalendarEvent(script.calendarId, script.calendarEventId);
          const cleared = await authFetch('/api/radar/scripts/' + script.id + '/schedule', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ calendarId: null, calendarEventId: null }),
          });
          if (!cleared.ok) throw new Error('Не удалось сохранить результат удаления');
        } catch (error: any) {
          calendarWarning = 'Расписание снято в Content Radar. Не удалось удалить событие Google Calendar; повторите Remove schedule: ' + error.message;
        }
      }
      setScheduleAt('');
      setShowSchedule(false);
      setFilter('approved');
      await refresh(script.id);
      if (calendarWarning) setError(calendarWarning);
    } catch (e: any) {
      setError(e?.message || 'Ошибка отмены публикации');
    } finally {
      setBusyId(null);
    }
  };

  const lifecycle = async (script: GeneratedScript, action: 'published' | 'unpublished' | 'archive' | 'restore') => {
    setBusyId(script.id);
    setError(null);
    try {
      const res = await authFetch('/api/radar/scripts/' + script.id + '/lifecycle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Lifecycle update failed');
      await refresh(script.id);
    } catch (e: any) {
      setError(e?.message || 'Ошибка обновления статуса');
    } finally {
      setBusyId(null);
    }
  };

  const groups = useMemo(() => ({
    all: scripts.filter(s => !s.archivedAt),
    review: scripts.filter(s => !s.isReviewed && !s.archivedAt),
    approved: scripts.filter(s => s.isReviewed && !s.scheduledAt && !s.isPublished && !s.archivedAt),
    scheduled: scripts.filter(s => Boolean(s.scheduledAt) && !s.isPublished && !s.archivedAt),
    published: scripts.filter(s => s.isPublished && !s.archivedAt),
    archived: scripts.filter(s => Boolean(s.archivedAt)),
  }), [scripts]);

  const current = detail?.script;
  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items = groups[filter].filter(script => {
      if (!query) return true;
      return [
        script.ideaTitle,
        script.title,
        script.content,
        ...(script.videoTitles || []),
        script.publicationPlatform,
      ].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
    return [...items].sort((a, b) => {
      if (sort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === 'status') return statusLabel(a).localeCompare(statusLabel(b));
      const aTime = new Date(a.publishedAt || a.scheduledAt || a.exportedAt || a.createdAt).getTime();
      const bTime = new Date(b.publishedAt || b.scheduledAt || b.exportedAt || b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [groups, filter, searchQuery, sort]);
  const nextVersionNumber = Math.max(
    Number(current?.version || 1),
    ...(detail?.versions || []).map(version => Number(version.version || 1))
  ) + 1;
  const nextReviewScript = groups.review.find(script => script.id !== current?.id);

  const statusLabel = (script: GeneratedScript) => {
    if (script.archivedAt) return t('scripts.archived').toUpperCase();
    if (script.isPublished) return t('scripts.published').toUpperCase();
    if (script.scheduledAt) return t('scripts.scheduled').toUpperCase();
    if (script.isReviewed) return t('scripts.approved').toUpperCase();
    return t('scripts.needsReview').toUpperCase();
  };

  const statusClass = (script: GeneratedScript) => {
    if (script.archivedAt) return 'bg-stone-100 text-stone-700';
    if (script.isPublished) return 'bg-violet-100 text-violet-800';
    if (script.scheduledAt) return 'bg-indigo-100 text-indigo-800';
    if (script.isReviewed) return 'bg-emerald-100 text-emerald-800';
    return 'bg-amber-100 text-amber-800';
  };

  const renderPlatformIcon = (platform?: GeneratedScript['publicationPlatform']) => {
    const className = 'h-3.5 w-3.5';
    if (platform === 'instagram') return <Instagram className={className} />;
    if (platform === 'youtube') return <Youtube className={className} />;
    if (platform === 'telegram') return <Send className={className} />;
    if (platform === 'tiktok') return <Music2 className={className} />;
    return <Globe2 className={className} />;
  };

  const platformLabel = (platform?: GeneratedScript['publicationPlatform']) => {
    if (!platform) return t('scripts.notScheduled');
    if (platform === 'instagram') return 'Instagram';
    if (platform === 'youtube') return 'YouTube';
    if (platform === 'telegram') return 'Telegram';
    if (platform === 'tiktok') return 'TikTok';
    return locale === 'ru' ? 'Другое' : 'Other';
  };

  const tabs: Array<[ScriptFilter, string, number]> = [
    ['all', t('scripts.all'), groups.all.length],
    ['review', t('scripts.needsReview'), groups.review.length],
    ['approved', t('scripts.approved'), groups.approved.length],
    ['scheduled', t('scripts.scheduled'), groups.scheduled.length],
    ['published', t('scripts.published'), groups.published.length],
  ];

  return (
    <div className="mx-auto max-w-[1600px] p-4 sm:p-6 xl:p-7">
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600">{t('scripts.workspace')}</div>
          <h2 className="mt-1 text-3xl font-bold tracking-tight text-stone-950">{t('scripts.title')}</h2>
          <p className="mt-1 text-sm text-stone-500">{t('scripts.subtitle')}</p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
          <div className="relative min-w-0 sm:w-[280px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder={t('scripts.search')}
              className="h-11 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div className="relative">
            <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <select
              value={sort}
              onChange={event => setSort(event.target.value as ScriptSort)}
              className="h-11 appearance-none rounded-xl border border-stone-200 bg-white pl-9 pr-9 text-xs font-semibold text-stone-700 outline-none"
            >
              <option value="updated">{t('scripts.sortUpdated')}</option>
              <option value="newest">{t('scripts.sortNewest')}</option>
              <option value="status">{t('scripts.sortStatus')}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          </div>
          <button onClick={onGoIdeas} className="h-11 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700">
            + {t('scripts.newScript')}
          </button>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabs.map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={'min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ' + (
                filter === id
                  ? 'border-stone-950 bg-stone-950 text-white'
                  : id === 'review'
                    ? 'border-amber-100 bg-amber-50 text-amber-800'
                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
              )}
            >
              {label} <span className="ml-1 opacity-70">{count}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFilter('archived')}
          className={'self-start rounded-xl px-3 py-2 text-xs font-semibold transition sm:self-auto ' + (filter === 'archived' ? 'bg-stone-100 text-stone-950' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800')}
        >
          {t('scripts.archivedLink')} {groups.archived.length > 0 ? `· ${groups.archived.length}` : ''} →
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>}

      {loading ? (
        <div className="py-24 text-center text-sm text-stone-400">{t('scripts.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="mx-auto max-w-xl rounded-3xl border border-dashed border-stone-200 bg-white p-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-stone-300" />
          <div className="mt-3 font-bold text-stone-900">{searchQuery ? t('scripts.nothingFound') : t('scripts.noScripts')}</div>
          <p className="mt-2 text-sm text-stone-500">
            {searchQuery ? t('scripts.trySearch') : t('scripts.generateHint')}
          </p>
          {!searchQuery && <button onClick={onGoIdeas} className="mt-5 h-10 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white">{t('scripts.goIdeas')}</button>}
        </div>
      ) : (
        <div className={current ? 'grid gap-5 xl:grid-cols-[minmax(360px,42%)_minmax(0,58%)]' : ''}>
          <section className={current ? 'space-y-2' : 'grid gap-3 md:grid-cols-2 xl:grid-cols-3'}>
            {filtered.map(script => {
              const selected = selectedId === script.id;
              const wordCount = script.content.trim().split(/\s+/).filter(Boolean).length;
              const readingSeconds = Math.max(15, Math.round(wordCount / 2.4));
              const durationLabel = readingSeconds >= 60 ? '~ ' + Math.ceil(readingSeconds / 60) + ' min' : '~ ' + readingSeconds + ' sec';
              const metaDate = script.scheduledAt || script.publishedAt || script.exportedAt || script.createdAt;
              return (
                <button
                  key={script.id}
                  onClick={() => void openScript(script.id)}
                  className={'w-full rounded-2xl border bg-white p-4 text-left transition hover:border-stone-300 hover:shadow-sm ' + (
                    selected ? 'border-emerald-400 bg-emerald-50/30 ring-1 ring-emerald-100' : 'border-stone-200'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={'rounded-full px-2.5 py-1 text-[10px] font-bold ' + statusClass(script)}>{statusLabel(script)}</span>
                      <span className="text-[10px] font-medium text-stone-400">v{script.version || 1}</span>
                    </div>
                    <span className="shrink-0 text-[10px] text-stone-400">{new Date(metaDate).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span>
                  </div>

                  <h3 className="mt-3 line-clamp-2 text-[15px] font-bold leading-5 text-stone-950">{script.ideaTitle || script.title}</h3>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-medium text-stone-500">{durationLabel}</span>
                    {script.videoTitles?.[0] && <span className="max-w-[160px] truncate rounded-full bg-stone-100 px-2 py-1 text-[10px] font-medium text-stone-500">{script.videoTitles[0]}</span>}
                  </div>

                  <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50/80 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-stone-600">
                          {renderPlatformIcon(script.publicationPlatform)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[10px] font-medium text-stone-400">{t('scripts.publication')}</div>
                          <div className="truncate text-[11px] font-semibold text-stone-800">
                            {script.scheduledAt
                              ? `${platformLabel(script.publicationPlatform)} · ${new Date(script.scheduledAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                              : t('scripts.notScheduled')}
                          </div>
                        </div>
                      </div>
                      {script.scheduledAt && (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700">{t('scripts.scheduled')}</span>
                      )}
                    </div>
                  </div>

                  <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-stone-500">{script.content}</p>

                  <div className="mt-3 flex items-center gap-3 border-t border-stone-100 pt-3 text-[10px] text-stone-400">
                    {script.radarOpportunityId && <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> {t('scripts.fromIdea')}</span>}
                    {(script.exportedAt || script.telegramSent) && <span>{t('scripts.exported')}</span>}
                    <MoreHorizontal className="ml-auto h-4 w-4" />
                  </div>
                </button>
              );
            })}
          </section>

          {current && (
            <aside className="mt-5 xl:mt-0">
              <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-[0_12px_36px_rgba(28,25,23,0.04)] xl:sticky xl:top-5">
                <div className="border-b border-stone-100 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={'rounded-full px-2.5 py-1 font-bold ' + statusClass(current)}>{statusLabel(current)}</span>
                        <span className="font-medium text-stone-500">{t('scripts.version')} {current.version || 1}</span>
                        <span className="text-stone-300">·</span>
                        <span className="text-stone-400">{t('scripts.updated')} {new Date(current.createdAt).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span>
                      </div>
                      <div className="mt-3 flex items-start gap-2">
                        <h3 className="text-2xl font-bold leading-tight tracking-tight text-stone-950">{current.ideaTitle || current.title}</h3>
                        <button type="button" onClick={() => { setDraftContent(current.content); setIsEditing(true); }} className="mt-1 rounded-lg p-1.5 text-stone-400 hover:bg-stone-50 hover:text-stone-700">
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {detail?.opportunity?.topic && <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600">{detail.opportunity.topic}</span>}
                        {current.publicationPlatform && <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600">{current.publicationPlatform}</span>}
                        {current.radarOpportunityId && <button onClick={() => setOpenPanel('source')} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"><Link2 className="h-3 w-3" /> From idea</button>}
                      </div>
                    </div>
                    <button onClick={() => { setSelectedId(null); setDetail(null); }} className="rounded-xl p-2 text-stone-400 hover:bg-stone-50"><X className="h-4 w-4" /></button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-b border-stone-100 p-4">
                  {!current.isReviewed && (
                    <button disabled={busyId === current.id} onClick={() => void review(current, 'approved')} className="h-10 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white disabled:opacity-50">
                      <CheckCircle2 className="h-4 w-4" /> {t('scripts.approve')}
                    </button>
                  )}
                  {!current.isPublished && !current.archivedAt && (
                    <button disabled={busyId === current.id || !current.radarOpportunityId} onClick={() => void review(current, 'rewrite', 'weak_hook')} className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 disabled:opacity-40">
                      <RotateCcw className="h-3.5 w-3.5" /> {t('scripts.regenerate')}
                    </button>
                  )}
                  <button disabled={busyId === current.id} onClick={() => void copyScript(current)} className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 disabled:opacity-40">
                    <Copy className="h-3.5 w-3.5" /> {t('scripts.copy')}
                  </button>
                  <button disabled={busyId === current.id} onClick={() => void downloadScript(current)} className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 disabled:opacity-40">
                    <Download className="h-3.5 w-3.5" /> {t('scripts.export')}
                  </button>
                  <button
                    disabled={busyId === current.id}
                    onClick={() => void lifecycle(current, current.archivedAt ? 'restore' : 'archive')}
                    className="ml-auto h-10 rounded-xl border border-stone-200 px-3 text-stone-500 disabled:opacity-40"
                    title={current.archivedAt ? 'Restore' : 'Archive'}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>

                <div className="border-b border-emerald-100 bg-emerald-50/35 p-4 sm:p-5">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                          <CalendarDays className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="text-sm font-bold text-stone-950">{t('scripts.publication')}</div>
                          <div className="mt-0.5 text-[11px] text-stone-500">{t('scripts.publicationHint')}</div>
                        </div>
                      </div>
                      <span className={'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ' + (current.scheduledAt ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600')}>
                        {current.scheduledAt ? t('scripts.scheduled') : t('scripts.notScheduled')}
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={!current.isReviewed || current.isPublished || Boolean(current.archivedAt)}
                        onClick={() => setShowSchedule(true)}
                        className="flex min-h-16 items-center justify-between rounded-2xl border border-stone-200 bg-white px-4 text-left disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-[10px] font-medium text-stone-400">{t('scripts.platformLabel')}</span>
                          <span className="mt-1 flex items-center gap-2 text-sm font-bold text-stone-900">
                            {renderPlatformIcon(current.publicationPlatform || publicationPlatform)}
                            {platformLabel(current.publicationPlatform || publicationPlatform)}
                          </span>
                        </span>
                        <ChevronDown className="h-4 w-4 text-stone-400" />
                      </button>

                      <button
                        type="button"
                        disabled={!current.isReviewed || current.isPublished || Boolean(current.archivedAt)}
                        onClick={() => setShowSchedule(true)}
                        className="flex min-h-16 items-center justify-between rounded-2xl border border-stone-200 bg-white px-4 text-left disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-[10px] font-medium text-stone-400">{t('scripts.dateTime')}</span>
                          <span className="mt-1 block text-sm font-bold text-stone-900">
                            {current.scheduledAt
                              ? new Date(current.scheduledAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
                              : t('scripts.notScheduled')}
                          </span>
                        </span>
                        <CalendarDays className="h-4 w-4 text-stone-400" />
                      </button>
                    </div>

                    {showSchedule && (
                      <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-xs font-bold text-stone-900">{current.scheduledAt ? t('scripts.reschedule') : t('scripts.schedulePublication')}</div>
                          <button type="button" onClick={() => setShowSchedule(false)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-50"><X className="h-3.5 w-3.5" /></button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-[10px] font-semibold text-stone-500">
                            {t('scripts.platformLabel')}
                            <select
                              value={publicationPlatform}
                              onChange={event => setPublicationPlatform(event.target.value as NonNullable<GeneratedScript['publicationPlatform']>)}
                              className="mt-1 h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs text-stone-800"
                            >
                              <option value="instagram">Instagram</option>
                              <option value="youtube">YouTube</option>
                              <option value="tiktok">TikTok</option>
                              <option value="telegram">Telegram</option>
                              <option value="other">{locale === 'ru' ? 'Другое' : 'Other'}</option>
                            </select>
                          </label>
                          <label className="text-[10px] font-semibold text-stone-500">
                            {t('scripts.dateTime')}
                            <input
                              type="datetime-local"
                              value={scheduleAt}
                              onChange={event => setScheduleAt(event.target.value)}
                              className="mt-1 h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs text-stone-800"
                            />
                          </label>
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-[11px] text-stone-600">
                          <input type="checkbox" checked={syncGoogleCalendar} onChange={event => setSyncGoogleCalendar(event.target.checked)} />
                          {t('scripts.syncGoogleCalendar')}
                        </label>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button disabled={busyId === current.id || !scheduleAt} onClick={() => void scheduleScript(current)} className="h-9 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40">{t('scripts.saveSchedule')}</button>
                          <button type="button" onClick={() => setShowSchedule(false)} className="h-9 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600">{t('scripts.cancel')}</button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {current.scheduledAt && onOpenCalendar && (
                        <button type="button" onClick={onOpenCalendar} className="h-9 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700">
                          {t('scripts.openCalendar')}
                        </button>
                      )}
                      {current.scheduledAt && !current.isPublished && (
                        <button disabled={busyId === current.id} onClick={() => void lifecycle(current, 'published')} className="h-9 rounded-xl border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-700">
                          {t('scripts.markPublished')}
                        </button>
                      )}
                      {current.isPublished && (
                        <button disabled={busyId === current.id} onClick={() => void lifecycle(current, 'unpublished')} className="h-9 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600">
                          {t('scripts.undoPublished')}
                        </button>
                      )}
                      {current.scheduledAt && (
                        <button disabled={busyId === current.id} onClick={() => void unscheduleScript(current)} className="h-9 rounded-xl px-3 text-xs font-semibold text-stone-500 hover:bg-white">
                          {t('scripts.removeSchedule')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-b border-stone-100 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-sm font-bold text-stone-900"><Sparkles className="h-4 w-4 text-emerald-600" /> Script</div>
                    <div className="text-[11px] text-stone-400">{current.content.length.toLocaleString()} characters</div>
                  </div>

                  {isEditing ? (
                    <div>
                      <textarea
                        value={draftContent}
                        onChange={event => setDraftContent(event.target.value)}
                        className="min-h-[360px] w-full resize-y rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                      <div className="mt-3 flex justify-end gap-2">
                        <button onClick={() => { setDraftContent(current.content); setIsEditing(false); }} className="h-9 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-600">{t('scripts.cancel')}</button>
                        <button disabled={busyId === current.id || !draftContent.trim()} onClick={() => void saveManualVersion(current)} className="h-9 inline-flex items-center gap-1.5 rounded-xl bg-stone-950 px-3 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save as v{nextVersionNumber}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-stone-100 bg-stone-50/60 p-4 text-sm leading-6 text-stone-700">{current.content}</div>
                  )}
                </div>

                {([
                  ['source', t('scripts.sourceTitle'), t('scripts.sourceSubtitle')],
                  ['history', t('scripts.historyTitle'), t('scripts.historySubtitle')],
                ] as const).map(([id, title, subtitle]) => (
                  <div key={id} className="border-b border-stone-100 last:border-b-0">
                    <button type="button" onClick={() => setOpenPanel(openPanel === id ? null : id)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-stone-900">{title}</div>
                        <div className="mt-0.5 text-[11px] text-stone-500">{subtitle}</div>
                      </div>
                      {openPanel === id ? <ChevronUp className="h-4 w-4 text-stone-400" /> : <ChevronDown className="h-4 w-4 text-stone-400" />}
                    </button>

                    {openPanel === id && id === 'source' && (
                      <div className="px-5 pb-5">
                        {detail?.opportunity ? (
                          <div className="rounded-2xl bg-stone-50 p-4 text-xs leading-5 text-stone-600">
                            <div className="font-semibold text-stone-900">{detail.opportunity.coreIdea}</div>
                            {detail.opportunity.whyInteresting && <div className="mt-2">{detail.opportunity.whyInteresting}</div>}
                            {detail.opportunity.angle && <div className="mt-2"><b>{t('scripts.angle')}:</b> {detail.opportunity.angle}</div>}
                            {detail.opportunity.evidence?.map((evidence, index) => <div key={index} className="mt-1">• {evidence}</div>)}
                            <a href={detail.opportunity.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 font-semibold text-emerald-700">{t('scripts.openSource')} <ExternalLink className="h-3 w-3" /></a>
                          </div>
                        ) : <div className="text-xs text-stone-400">{t('scripts.noSource')}</div>}
                      </div>
                    )}

                    {openPanel === id && id === 'history' && (
                      <div className="px-5 pb-5">
                        <div className="mb-3 flex flex-wrap gap-2">
                          {(detail?.versions || []).map(version => (
                            <button key={version.id} onClick={() => void openScript(version.id)} className={'rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ' + (version.id === current.id ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white text-stone-600')}>v{version.version || 1}</button>
                          ))}
                        </div>
                        <div className="space-y-2">
                          {(detail?.feedback || []).slice(0, 8).map(item => (
                            <div key={item.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-600">
                              <b className="text-stone-900">{item.decision}</b>{item.reason ? ' · ' + item.reason : ''}<span className="text-stone-400"> · {new Date(item.createdAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span>
                            </div>
                          ))}
                          {!detail?.feedback?.length && <div className="text-xs text-stone-400">{t('scripts.noFeedback')}</div>}
                        </div>
                      </div>
                    )}

                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
};
