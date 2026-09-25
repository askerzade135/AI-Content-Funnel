import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Clipboard, Copy, Download, ExternalLink, FileText, Globe2, Instagram, Link2, MoreHorizontal, Music2, Pencil, RotateCcw, Save, Search, Send, SlidersHorizontal, Sparkles, Trash2, X, Youtube } from 'lucide-react';
import { createGoogleDocFromHtml } from '../services/googleDocsService';
import { GeneratedScript, RadarScriptDetail, RadarScriptFeedbackReason } from '../types';
import { authFetch } from '../services/authFetch';
import { createContentRadarCalendarEvent, deleteContentRadarCalendarEvent } from '../services/googleCalendarService';
import { useI18n } from '../i18n';
import { PlatformIcon, publicationPlatformLabel } from './PlatformIcon';
import { ContextualQuota } from './ContextualQuota';
import { useProductQuota } from '../hooks/useProductQuota';
import { quotaState } from '../lib/productQuota';
import { PublicationModal } from './PublicationModal';
import { CustomSelect } from './CustomSelect';

interface RadarScriptsWorkspaceProps {
  onOpenQuotas?: () => void;
  onGoIdeas: () => void;
  onOpenCalendar?: () => void;
  initialSelectedId?: string;
}

type ScriptFilter = 'all' | 'review' | 'approved' | 'scheduled' | 'published' | 'archived';
type ScriptSort = 'updated' | 'newest' | 'status';
type ScriptStatusTarget = 'review' | 'approved' | 'scheduled' | 'published' | 'archived';

export const RadarScriptsWorkspace: React.FC<RadarScriptsWorkspaceProps> = ({ onOpenQuotas, onGoIdeas, onOpenCalendar, initialSelectedId }) => {
  const { locale, t } = useI18n();
  const { quota, refreshQuota, precheckQuota, quotaError } = useProductQuota();
  const reviewBusy = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const generationExhausted = quota && quotaState(quota.scriptGenerations, quota.limits.scriptGenerations) === 'exhausted';
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [filter, setFilter] = useState<ScriptFilter>('all');
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [editorTab, setEditorTab] = useState<'script' | 'media' | 'publication' | 'history'>('script');
  const [draggedScriptId, setDraggedScriptId] = useState<string | null>(null);
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
  const [publicationDrafts, setPublicationDrafts] = useState<Record<string, { date: string; platform: NonNullable<GeneratedScript['publicationPlatform']> }>>({});
  const [showCreateScript, setShowCreateScript] = useState(false);
  const [newScriptTitle, setNewScriptTitle] = useState('');
  const [newScriptContent, setNewScriptContent] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingPublicationId, setEditingPublicationId] = useState<string | null>(null);
  const [retainedInFilter, setRetainedInFilter] = useState<Set<string>>(() => new Set());
  const [publishingScript, setPublishingScript] = useState<GeneratedScript | null>(null);

  const toLocalDateTimeValue = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  const publicationDraft = (script: GeneratedScript) => publicationDrafts[script.id] || {
    date: toLocalDateTimeValue(script.scheduledAt), platform: script.publicationPlatform || 'instagram',
  };
  const clearPublicationDraft = (id: string) => setPublicationDrafts(drafts => {
    const next = { ...drafts };
    delete next[id];
    return next;
  });

  const savePublicationFromCard = async (script: GeneratedScript) => {
    const { date, platform } = publicationDraft(script);
    if (!date) {
      setError(locale === 'ru' ? 'Выберите дату и время публикации' : 'Choose publication date and time');
      return;
    }
    setBusyId(script.id);
    setError(null);
    try {
      const scheduledAt = new Date(date).toISOString();
      const res = await authFetch('/api/radar/scripts/' + script.id + '/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt, publicationPlatform: platform, publicationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Schedule failed');
      clearPublicationDraft(script.id);
      setEditingPublicationId(null);
      setRetainedInFilter(previous => {
        const next = new Set(previous);
        next.add(script.id);
        return next;
      });
      await refresh(script.id);
    } catch (e: any) {
      setError(e?.message || (locale === 'ru' ? 'Ошибка планирования публикации' : 'Could not schedule publication'));
    } finally {
      setBusyId(null);
    }
  };

  const setScriptStatus = async (script: GeneratedScript, target: ScriptStatusTarget) => {
    if (target === 'scheduled') {
      setEditingPublicationId(script.id);
      requestAnimationFrame(() => document.getElementById('publication-date-' + script.id)?.focus());
      return;
    }
    const action = target === 'review'
      ? 'review'
      : target === 'approved'
        ? 'approved'
        : target === 'published'
          ? 'published'
          : 'archive';
    await lifecycle(script, action);
    setFilter(target === 'archived' ? 'archived' : target);
  };

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
    setEditorTab('script');
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

  const createManualScript = async () => {
    const title = newScriptTitle.trim();
    const content = newScriptContent.trim();
    if (!title || !content) return;
    setBusyId('create');
    setError(null);
    try {
      const res = await authFetch('/api/radar/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Create script failed');
      setShowCreateScript(false);
      setNewScriptTitle('');
      setNewScriptContent('');
      setFilter('all');
      await refresh(data.script?.id);
    } catch (e: any) {
      setError(e?.message || (locale === 'ru' ? 'Не удалось создать сценарий' : 'Could not create script'));
    } finally {
      setBusyId(null);
    }
  };

  const saveTitle = async (script: GeneratedScript) => {
    const title = titleDraft.trim();
    if (!title) return;
    setBusyId(script.id);
    setError(null);
    try {
      const res = await authFetch('/api/radar/scripts/' + script.id + '/title', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Title update failed');
      setTitleEditing(false);
      await refresh(script.id);
    } catch (e: any) {
      setError(e?.message || (locale === 'ru' ? 'Не удалось изменить название' : 'Could not update title'));
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => { void loadScripts(); }, []);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const res = await authFetch('/api/radar/scripts');
        if (!res.ok) return;
        const latest: GeneratedScript[] = await res.json();
        setScripts(latest);
        setDetail(previous => {
          const script = latest.find(item => item.id === previous?.script.id);
          return previous && script ? { ...previous, script } : previous;
        });
      } catch { /* Retry on the next tick without interrupting edits. */ }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);


  useEffect(() => {
    if (initialSelectedId) void openScript(initialSelectedId);
  }, [initialSelectedId]);

  useEffect(() => {
    if (!detail?.script) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [detail?.script?.id]);

  const review = async (script: GeneratedScript, decision: 'approved' | 'rewrite' | 'rejected', reason?: RadarScriptFeedbackReason) => {
    if (!script.radarOpportunityId || reviewBusy.current) return;
    reviewBusy.current = true;
    setBusyId(script.id);
    setError(null);
    try {
      if (decision === 'rewrite' && !await precheckQuota('scriptGenerations')) return;
      const res = await authFetch('/api/radar/script-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: script.id, opportunityId: script.radarOpportunityId, decision, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Review failed');

      if (decision === 'rewrite') {
        const requestId = requestIds.current.get(script.id) || crypto.randomUUID();
        requestIds.current.set(script.id, requestId);
        const gen = await authFetch('/api/radar/opportunities/' + script.radarOpportunityId + '/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: script.outputFormat, requestId }) });
        const generated = await gen.json().catch(() => ({}));
        if (!gen.ok) throw new Error(quotaError(generated, 'Rewrite failed'));
        requestIds.current.delete(script.id);
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
      reviewBusy.current = false;
      void refreshQuota().catch(() => undefined);
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
      clearPublicationDraft(script.id);
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

  const lifecycle = async (script: GeneratedScript, action: 'review' | 'approved' | 'published' | 'unpublished' | 'archive' | 'restore') => {
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
      if (action === 'archive') setFilter('archived');
      if (action === 'restore') setFilter('all');
      await refresh(script.id);
    } catch (e: any) {
      setError(e?.message || 'Ошибка обновления статуса');
    } finally {
      setBusyId(null);
    }
  };

  const deleteScript = async (script: GeneratedScript) => {
    if (!window.confirm(locale === 'ru'
      ? `Удалить сценарий «${script.ideaTitle || script.title}»? Это действие нельзя отменить.`
      : `Delete “${script.ideaTitle || script.title}”? This cannot be undone.`)) return;
    setBusyId(script.id);
    setError(null);
    try {
      const res = await authFetch('/api/radar/scripts/' + script.id, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (locale === 'ru' ? 'Не удалось удалить сценарий' : 'Could not delete script'));
      setSelectedId(null);
      setDetail(null);
      clearPublicationDraft(script.id);
      await loadScripts();
    } catch (e: any) {
      setError(e?.message || (locale === 'ru' ? 'Не удалось удалить сценарий' : 'Could not delete script'));
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
    const base = groups[filter];
    const retained = scripts.filter(script => retainedInFilter.has(script.id) && !base.some(item => item.id === script.id));
    const items = [...base, ...retained].filter(script => {
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
  }, [groups, filter, searchQuery, sort, scripts, retainedInFilter]);
  const nextVersionNumber = Math.max(
    Number(current?.version || 1),
    ...(detail?.versions || []).map(version => Number(version.version || 1))
  ) + 1;
  const nextReviewScript = groups.review.find(script => script.id !== current?.id);

  function statusLabel(script: GeneratedScript) {
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

  const platformLabel = (platform?: GeneratedScript['publicationPlatform']) =>
    platform ? publicationPlatformLabel(platform, locale) : t('scripts.notScheduled');

  const tabs: Array<[ScriptFilter, string, number]> = [
    ['all', t('scripts.all'), groups.all.length],
    ['review', t('scripts.needsReview'), groups.review.length],
    ['approved', t('scripts.approved'), groups.approved.length],
    ['scheduled', t('scripts.scheduled'), groups.scheduled.length],
    ['published', t('scripts.published'), groups.published.length],
    ['archived', t('scripts.archived'), groups.archived.length],
  ];

  const matchesSearch = (script: GeneratedScript) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      script.ideaTitle,
      script.title,
      script.content,
      ...(script.videoTitles || []),
      script.publicationPlatform,
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  };

  const sortLibraryScripts = (items: GeneratedScript[]) => [...items].sort((a, b) => {
    if (sort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (sort === 'status') return statusLabel(a).localeCompare(statusLabel(b));
    const aTime = new Date(a.publishedAt || a.scheduledAt || a.exportedAt || a.createdAt).getTime();
    const bTime = new Date(b.publishedAt || b.scheduledAt || b.exportedAt || b.createdAt).getTime();
    return bTime - aTime;
  });

  const boardColumns: Array<{ id: Exclude<ScriptStatusTarget, 'archived'>; label: string; items: GeneratedScript[]; tone: string }> = [
    { id: 'review', label: t('scripts.needsReview'), items: sortLibraryScripts(groups.review.filter(matchesSearch)), tone: 'border-amber-200 bg-amber-50/70' },
    { id: 'approved', label: t('scripts.approved'), items: sortLibraryScripts(groups.approved.filter(matchesSearch)), tone: 'border-emerald-200 bg-emerald-50/60' },
    { id: 'scheduled', label: t('scripts.scheduled'), items: sortLibraryScripts(groups.scheduled.filter(matchesSearch)), tone: 'border-indigo-200 bg-indigo-50/60' },
    { id: 'published', label: t('scripts.published'), items: sortLibraryScripts(groups.published.filter(matchesSearch)), tone: 'border-violet-200 bg-violet-50/60' },
  ];

  const closeEditor = () => {
    setSelectedId(null);
    setDetail(null);
    setIsEditing(false);
    setTitleEditing(false);
    setShowSchedule(false);
  };

  const moveBoardScript = async (target: Exclude<ScriptStatusTarget, 'archived'>, scriptId: string) => {
    const script = scripts.find(item => item.id === scriptId);
    if (!script || busyId === script.id) return;
    if (target === 'scheduled' && !script.scheduledAt) {
      await openScript(script.id);
      setEditorTab('publication');
      setShowSchedule(true);
      return;
    }
    await setScriptStatus(script, target);
  };

  const renderLibraryCard = (script: GeneratedScript, compact = false) => {
    const wordCount = script.content.trim().split(/\s+/).filter(Boolean).length;
    const readingSeconds = Math.max(15, Math.round(wordCount / 2.4));
    const durationLabel = readingSeconds >= 60 ? '~ ' + Math.ceil(readingSeconds / 60) + ' min' : '~ ' + readingSeconds + ' sec';
    const metaDate = script.scheduledAt || script.publishedAt || script.exportedAt || script.createdAt;
    return (
      <article
        key={script.id}
        draggable={!script.archivedAt}
        onDragStart={() => setDraggedScriptId(script.id)}
        onDragEnd={() => setDraggedScriptId(null)}
        className={'group rounded-2xl border bg-white text-left transition hover:border-emerald-200 hover:shadow-sm ' + (compact ? 'p-3' : 'p-4')}
      >
        <button type="button" onClick={() => void openScript(script.id)} className="block w-full text-left">
          <div className="flex items-start justify-between gap-2">
            <span className={'rounded-full px-2 py-1 text-[9px] font-bold ' + statusClass(script)}>{statusLabel(script)}</span>
            <span className="shrink-0 text-[9px] text-stone-400">{new Date(metaDate).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span>
          </div>
          <div className={compact ? 'mt-2' : 'mt-3 flex gap-3'}>
            <div className={compact ? 'aspect-video w-full overflow-hidden rounded-xl bg-stone-100' : 'h-[88px] w-[88px] shrink-0 overflow-hidden rounded-xl bg-stone-100'}>
              {script.thumbnail ? <img src={script.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-stone-300"><FileText className="h-6 w-6" /></div>}
            </div>
            <div className={compact ? 'mt-2 min-w-0' : 'min-w-0 flex-1'}>
              <h3 className={compact ? 'line-clamp-3 text-xs font-bold leading-4 text-stone-950' : 'line-clamp-2 text-[15px] font-bold leading-5 text-stone-950'}>{script.ideaTitle || script.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-stone-100 px-2 py-1 text-[9px] font-medium text-stone-500">{durationLabel}</span>
                {script.publicationPlatform && <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-1 text-[9px] font-medium text-stone-600"><PlatformIcon platform={script.publicationPlatform} />{platformLabel(script.publicationPlatform)}</span>}
              </div>
            </div>
          </div>
          {!compact && <p className="mt-3 line-clamp-2 text-xs leading-5 text-stone-500">{script.content}</p>}
        </button>
      </article>
    );
  };

  return (
    <div className="mx-auto max-w-[1600px] p-4 sm:p-6 xl:p-7">
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
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
          <CustomSelect
            value={sort}
            onChange={value => setSort(value as ScriptSort)}
            ariaLabel={t('scripts.sortUpdated')}
            className="w-full sm:w-[180px]"
            options={[
              { value: 'updated', label: t('scripts.sortUpdated'), icon: <SlidersHorizontal className="h-4 w-4 text-stone-400" /> },
              { value: 'newest', label: t('scripts.sortNewest'), icon: <SlidersHorizontal className="h-4 w-4 text-stone-400" /> },
              { value: 'status', label: t('scripts.sortStatus'), icon: <SlidersHorizontal className="h-4 w-4 text-stone-400" /> },
            ]}
          />
          <button onClick={() => setShowCreateScript(true)} className="h-11 whitespace-nowrap rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700">
            + {t('scripts.newScript')}
          </button>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabs.map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => { setRetainedInFilter(new Set()); setFilter(id); }}
              className={'min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ' + (
                filter === id
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : id === 'review'
                    ? 'border-amber-100 bg-amber-50 text-amber-800'
                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
              )}
            >
              {label} <span className="ml-1 opacity-70">{count}</span>
            </button>
          ))}
        </div>

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
          {!searchQuery && <button onClick={onGoIdeas} className="mt-5 h-10 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white transition hover:bg-emerald-700">{t('scripts.goIdeas')}</button>}
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
                <div
                  key={script.id}
                  className={'w-full rounded-2xl border bg-white p-4 text-left transition hover:border-stone-300 hover:shadow-sm ' + (
                    selected ? 'border-emerald-400 bg-emerald-50/30 ring-1 ring-emerald-100' : 'border-stone-200'
                  )}
                >
                  <button type="button" onClick={() => void openScript(script.id)} className="block w-full text-left">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={'rounded-full px-2.5 py-1 text-[10px] font-bold ' + statusClass(script)}>{statusLabel(script)}</span>
                        <span className="text-[10px] font-medium text-stone-400">v{script.version || 1}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-stone-400">{new Date(metaDate).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span>
                    </div>

                    <div className="mt-3 flex gap-3">
                      <div className="h-[88px] w-[88px] shrink-0 overflow-hidden rounded-xl bg-stone-100">
                        {script.thumbnail ? (
                          <img src={script.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-stone-300"><FileText className="h-7 w-7" /></div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-[15px] font-bold leading-5 text-stone-950">{script.ideaTitle || script.title}</h3>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-medium text-stone-500">{durationLabel}</span>
                          {script.videoTitles?.[0] && <span className="max-w-[160px] truncate rounded-full bg-stone-100 px-2 py-1 text-[10px] font-medium text-stone-500">{script.videoTitles[0]}</span>}
                        </div>
                      </div>
                    </div>
                  </button>

                  <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-stone-600">
                        <CalendarDays className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-medium text-stone-400">{t('scripts.publication')}</div>
                        <div className="mt-0.5 text-[11px] font-semibold text-stone-800">
                          {script.scheduledAt ? t('scripts.scheduled') : t('scripts.notScheduled')}
                        </div>
                      </div>
                    </div>

                    {script.scheduledAt && editingPublicationId !== script.id ? (
                      <div className="mt-3 grid gap-2 border-t border-stone-200 pt-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setEditingPublicationId(script.id)}
                          className="flex h-11 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-left text-xs font-semibold text-stone-800 transition hover:border-emerald-300 hover:bg-emerald-50/30"
                        >
                          <PlatformIcon platform={script.publicationPlatform} />
                          <span className="truncate">{platformLabel(script.publicationPlatform)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingPublicationId(script.id)}
                          className="flex h-11 items-center justify-between rounded-xl border border-stone-200 bg-white px-3 text-left text-xs font-semibold text-stone-800 transition hover:border-emerald-300 hover:bg-emerald-50/30"
                        >
                          <span className="truncate">{new Date(script.scheduledAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="mt-3 grid gap-2 border-t border-stone-200 pt-3 sm:grid-cols-2">
                          <label className="min-w-0">
                            <span className="mb-1 block text-[9px] font-medium text-stone-400">{t('scripts.platformLabel')}</span>
                            <CustomSelect
                              ariaLabel={t('scripts.platformLabel')}
                              value={publicationDraft(script).platform}
                              onChange={value => setPublicationDrafts(drafts => ({ ...drafts, [script.id]: { ...publicationDraft(script), platform: value as NonNullable<GeneratedScript['publicationPlatform']> } }))}
                              triggerClassName="!h-10 !text-xs"
                              options={[
                                { value: 'instagram', label: 'Instagram', icon: <PlatformIcon platform="instagram" /> },
                                { value: 'youtube', label: 'YouTube', icon: <PlatformIcon platform="youtube" /> },
                                { value: 'tiktok', label: 'TikTok', icon: <PlatformIcon platform="tiktok" /> },
                                { value: 'telegram', label: 'Telegram', icon: <PlatformIcon platform="telegram" /> },
                                { value: 'other', label: locale === 'ru' ? 'Другое' : 'Other', icon: <PlatformIcon /> },
                              ]}
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[9px] font-medium text-stone-400">{t('scripts.dateTime')}</span>
                            <input
                              type="datetime-local"
                              id={'publication-date-' + script.id}
                              aria-label={t('scripts.dateTime')}
                              value={publicationDraft(script).date}
                              onChange={event => setPublicationDrafts(drafts => ({ ...drafts, [script.id]: { ...publicationDraft(script), date: event.target.value } }))}
                              className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs"
                            />
                          </label>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" disabled={busyId === script.id || !publicationDraft(script).date} onClick={() => void savePublicationFromCard(script)} className="h-9 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40">
                            {script.scheduledAt ? t('scripts.saveSchedule') : t('scripts.schedulePublication')}
                          </button>
                          {script.scheduledAt && (
                            <button type="button" onClick={() => { clearPublicationDraft(script.id); setEditingPublicationId(null); }} className="h-9 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600">
                              {t('scripts.cancel')}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <button type="button" onClick={() => void openScript(script.id)} className="block w-full text-left">
                    <p className="mt-3 truncate text-xs leading-5 text-stone-500">{script.content}</p>

                  <div className="mt-3 flex items-center gap-3 border-t border-stone-100 pt-3 text-[10px] text-stone-400">
                    {script.radarOpportunityId && <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> {t('scripts.fromIdea')}</span>}
                    {(script.exportedAt || script.telegramSent) && <span>{t('scripts.exported')}</span>}
                  </div>
                  </button>
                </div>
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
                        <CustomSelect
                          value={(current.archivedAt ? 'archived' : current.isPublished ? 'published' : current.scheduledAt ? 'scheduled' : current.isReviewed ? 'approved' : 'review') as ScriptStatusTarget}
                          onChange={value => void setScriptStatus(current, value as ScriptStatusTarget)}
                          ariaLabel={t('scripts.publication')}
                          className="w-[150px]"
                          triggerClassName={'!h-8 !rounded-full !border-0 !px-2.5 !text-[11px] !font-bold ' + statusClass(current)}
                          options={[
                            { value: 'review', label: t('scripts.needsReview') },
                            { value: 'approved', label: t('scripts.approved') },
                            { value: 'scheduled', label: t('scripts.scheduled') },
                            { value: 'published', label: t('scripts.published') },
                            { value: 'archived', label: t('scripts.archived') },
                          ]}
                        />
                        <span className="font-medium text-stone-500">{t('scripts.version')} {current.version || 1}</span>
                        <span className="text-stone-300">·</span>
                        <span className="text-stone-400">{t('scripts.updated')} {new Date(current.createdAt).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span>
                      </div>
                      <div className="mt-3 flex min-w-0 items-center gap-2">
                        {titleEditing ? (
                          <>
                            <input
                              autoFocus
                              value={titleDraft}
                              onChange={event => setTitleDraft(event.target.value)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') void saveTitle(current);
                                if (event.key === 'Escape') setTitleEditing(false);
                              }}
                              className="h-10 min-w-0 flex-1 rounded-xl border border-stone-200 px-3 text-lg font-bold outline-none focus:border-emerald-400"
                            />
                            <button type="button" disabled={busyId === current.id || !titleDraft.trim()} onClick={() => void saveTitle(current)} className="h-9 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40">
                              {t('scripts.saveTitle')}
                            </button>
                          </>
                        ) : (
                          <>
                            <h3 className="min-w-0 flex-1 truncate whitespace-nowrap text-2xl font-bold leading-tight tracking-tight text-stone-950" title={current.ideaTitle || current.title}>{current.ideaTitle || current.title}</h3>
                            <button
                              type="button"
                              title={t('scripts.editTitle')}
                              onClick={() => { setTitleDraft(current.ideaTitle || current.title); setTitleEditing(true); }}
                              className="shrink-0 rounded-lg p-1.5 text-stone-400 hover:bg-stone-50 hover:text-stone-700"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {detail?.opportunity?.topic && <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600">{detail.opportunity.topic}</span>}
                        {current.publicationPlatform && <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600"><PlatformIcon platform={current.publicationPlatform} />{publicationPlatformLabel(current.publicationPlatform, locale)}</span>}
                        {current.radarOpportunityId && <button onClick={() => setOpenPanel('source')} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"><Link2 className="h-3 w-3" /> From idea</button>}
                      </div>
                    </div>
                    <button title={locale === 'ru' ? 'Закрыть карточку' : 'Close details'} aria-label={locale === 'ru' ? 'Закрыть карточку' : 'Close details'} onClick={() => { setSelectedId(null); setDetail(null); }} className="rounded-xl p-2 text-stone-400 hover:bg-stone-50"><X className="h-4 w-4" /></button>
                  </div>
                </div>

                {current.radarOpportunityId && <ContextualQuota quota={quota} metric="scriptGenerations" onOpenQuotas={onOpenQuotas} />}
                <div className="flex flex-wrap gap-2 border-b border-stone-100 p-4">
                  {!current.isReviewed && (
                    <button disabled={busyId === current.id} onClick={() => void review(current, 'approved')} className="h-10 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white disabled:opacity-50">
                      <CheckCircle2 className="h-4 w-4" /> {t('scripts.approve')}
                    </button>
                  )}
                  {!current.isPublished && !current.archivedAt && (
                    <button disabled={generationExhausted || busyId === current.id || !current.radarOpportunityId} onClick={() => void review(current, 'rewrite', 'weak_hook')} className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 disabled:opacity-40">
                      <RotateCcw className="h-3.5 w-3.5" /> {t('scripts.regenerate')}
                    </button>
                  )}
                  <button disabled={busyId === current.id} onClick={() => void copyScript(current)} className="h-10 inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 disabled:opacity-40">
                    <Copy className="h-3.5 w-3.5" /> {t('scripts.copy')}
                  </button>
                  {!current.archivedAt && (
                    <button type="button" disabled={busyId === current.id} onClick={() => setPublishingScript(current)} className="h-10 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40">
                      <Send className="h-3.5 w-3.5" /> {locale === 'ru' ? 'Опубликовать' : 'Publish'}
                    </button>
                  )}
                  <details key={current.id} className="relative ml-auto">
                    <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-600">
                      <MoreHorizontal className="h-4 w-4" /> {locale === 'ru' ? 'Ещё' : 'More'} <ChevronDown className="h-3.5 w-3.5" />
                    </summary>
                    <div className="absolute right-0 top-12 z-20 w-48 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
                      <button disabled={busyId === current.id} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void downloadScript(current); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-stone-50 disabled:opacity-40">
                        <Download className="h-4 w-4" /> {t('scripts.export')}
                      </button>
                      <button disabled={busyId === current.id} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void lifecycle(current, current.archivedAt ? 'restore' : 'archive'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-stone-50 disabled:opacity-40">
                        <Archive className="h-4 w-4" /> {current.archivedAt ? (locale === 'ru' ? 'Восстановить' : 'Restore') : (locale === 'ru' ? 'Архивировать' : 'Archive')}
                      </button>
                      <button disabled={busyId === current.id} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void deleteScript(current); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 disabled:opacity-40">
                        <Trash2 className="h-4 w-4" /> {locale === 'ru' ? 'Удалить' : 'Delete'}
                      </button>
                    </div>
                  </details>
                </div>

                <div className="border-b border-emerald-100 bg-emerald-50/20 p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-base font-bold text-stone-950"><Sparkles className="h-4 w-4 text-emerald-600" /> Script</div>
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] text-stone-400">{current.content.length.toLocaleString()} characters</div>
                      {!isEditing && (
                        <button type="button" onClick={() => { setDraftContent(current.content); setIsEditing(true); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-[11px] font-semibold text-stone-600">
                          <Pencil className="h-3.5 w-3.5" /> {locale === 'ru' ? 'Редактировать' : 'Edit'}
                        </button>
                      )}
                    </div>
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
                        <button disabled={busyId === current.id || !draftContent.trim()} onClick={() => void saveManualVersion(current)} className="h-9 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save as v{nextVersionNumber}</button>
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
                            <button key={version.id} onClick={() => void openScript(version.id)} className={'rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ' + (version.id === current.id ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-white text-stone-600')}>v{version.version || 1}</button>
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

      {publishingScript && (
        <PublicationModal
          script={publishingScript}
          onClose={() => setPublishingScript(null)}
          onPublished={async () => {
            await refresh(publishingScript.id);
          }}
        />
      )}

      {showCreateScript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={() => setShowCreateScript(false)}>
          <div className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-stone-950">{t('scripts.createTitle')}</h3>
                <p className="mt-1 text-sm text-stone-500">{t('scripts.createHint')}</p>
              </div>
              <button type="button" onClick={() => setShowCreateScript(false)} className="rounded-xl p-2 text-stone-400 hover:bg-stone-50"><X className="h-4 w-4" /></button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-stone-600">{t('scripts.titleLabel')}</span>
                <input
                  autoFocus
                  value={newScriptTitle}
                  onChange={event => setNewScriptTitle(event.target.value)}
                  className="h-11 w-full rounded-xl border border-stone-200 px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-stone-600">{t('scripts.contentLabel')}</span>
                <textarea
                  value={newScriptContent}
                  onChange={event => setNewScriptContent(event.target.value)}
                  className="min-h-[260px] w-full resize-y rounded-2xl border border-stone-200 p-4 text-sm leading-6 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap justify-between gap-3">
              <button type="button" onClick={() => { setShowCreateScript(false); onGoIdeas(); }} className="h-10 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-600">
                {t('scripts.createFromIdea')}
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowCreateScript(false)} className="h-10 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-600">{t('scripts.cancel')}</button>
                <button type="button" disabled={busyId === 'create' || !newScriptTitle.trim() || !newScriptContent.trim()} onClick={() => void createManualScript()} className="h-10 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white disabled:opacity-40">
                  {t('scripts.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
