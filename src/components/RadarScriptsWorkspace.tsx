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
import { ConfirmModal, type ConfirmModalConfig } from './ConfirmModal';
import { useIntegrationState } from '../hooks/useIntegrationState';

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
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { connected: calendarConnected } = useIntegrationState('calendar');
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
  const [publicationDrafts, setPublicationDrafts] = useState<Record<string, { date: string; platform: NonNullable<GeneratedScript['publicationPlatform']> }>>({});
  const [showCreateScript, setShowCreateScript] = useState(false);
  const [newScriptTitle, setNewScriptTitle] = useState('');
  const [newScriptContent, setNewScriptContent] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingPublicationId, setEditingPublicationId] = useState<string | null>(null);
  const [retainedInFilter, setRetainedInFilter] = useState<Set<string>>(() => new Set());
  const [confirmConfig, setConfirmConfig] = useState<ConfirmModalConfig | null>(null);
  const [pendingEditorTab, setPendingEditorTab] = useState<'media' | 'publication' | 'history' | null>(null);

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
      if (detail?.script.id !== script.id) await openScript(script.id);
      setEditorTab('publication');
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
    if (!isEditing) return;
    requestAnimationFrame(() => editorTextareaRef.current?.focus());
  }, [isEditing]);

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

      if (calendarConnected) {
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

      if (!calendarConnected && script.calendarEventId) calendarWarning = locale === 'ru'
        ? 'Расписание сохранено в Content Radar. Google Calendar сейчас не подключён, поэтому существующее событие не обновлено.'
        : 'Schedule saved in Content Radar. Google Calendar is not connected, so the existing event was not updated.';
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

  const hasUnsavedScriptChanges = Boolean(
    detail?.script &&
    isEditing &&
    draftContent.trim() &&
    draftContent.trim() !== detail.script.content.trim()
  );

  const requestEditorTab = (tab: 'script' | 'media' | 'publication' | 'history') => {
    if (tab === 'script' || !hasUnsavedScriptChanges) {
      setEditorTab(tab);
      return;
    }
    setPendingEditorTab(tab);
  };

  const continueTabWithoutSaving = () => {
    if (!pendingEditorTab || !detail?.script) return;
    setDraftContent(detail.script.content);
    setIsEditing(false);
    setEditorTab(pendingEditorTab);
    setPendingEditorTab(null);
  };

  const saveAndContinueTab = async () => {
    if (!pendingEditorTab || !detail?.script) return;
    const target = pendingEditorTab;
    await saveManualVersion(detail.script);
    setEditorTab(target);
    setPendingEditorTab(null);
  };

  const confirmImproveScript = (script: GeneratedScript) => {
    setConfirmConfig({
      isOpen: true,
      type: 'emerald',
      badge: locale === 'ru' ? '1 AI Generation' : '1 AI Generation',
      title: locale === 'ru' ? 'Улучшить сценарий?' : 'Improve this script?',
      description: locale === 'ru'
        ? 'Radar создаст новую версию сценария с более сильным хуком. Текущая версия сохранится и останется в истории. Используется 1 AI Generation.'
        : 'Radar will create a new version with a stronger hook. The current version stays in History. This uses 1 AI Generation.',
      confirmText: locale === 'ru' ? 'Создать новую версию' : 'Create new version',
      cancelText: locale === 'ru' ? 'Отмена' : 'Cancel',
      onConfirm: () => { void review(script, 'rewrite', 'weak_hook'); },
      onCancel: () => undefined,
    });
  };

  const confirmCreateManualScript = () => {
    if (!newScriptTitle.trim() || !newScriptContent.trim()) return;
    setConfirmConfig({
      isOpen: true,
      type: 'emerald',
      title: locale === 'ru' ? 'Создать новый сценарий?' : 'Create a new script?',
      description: locale === 'ru'
        ? 'Создаст самостоятельный сценарий вручную, без генерации AI и без привязки к идее. После создания он появится в Needs review, где его можно редактировать, версионировать и готовить к публикации.'
        : 'Creates a manual standalone script without AI generation or an Idea link. It will appear in Needs review, where you can edit, version and prepare it for publishing.',
      confirmText: locale === 'ru' ? 'Создать сценарий' : 'Create script',
      cancelText: locale === 'ru' ? 'Вернуться' : 'Back',
      onConfirm: () => { void createManualScript(); },
      onCancel: () => undefined,
    });
  };

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

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex w-fit rounded-xl border border-stone-200 bg-white p-1">
          <button type="button" onClick={() => setViewMode('board')} className={'h-9 rounded-lg px-4 text-xs font-semibold transition ' + (viewMode === 'board' ? 'bg-emerald-50 text-emerald-800 shadow-sm' : 'text-stone-500 hover:text-stone-800')}>
            {locale === 'ru' ? 'Доска' : 'Board'}
          </button>
          <button type="button" onClick={() => setViewMode('list')} className={'h-9 rounded-lg px-4 text-xs font-semibold transition ' + (viewMode === 'list' ? 'bg-emerald-50 text-emerald-800 shadow-sm' : 'text-stone-500 hover:text-stone-800')}>
            {locale === 'ru' ? 'Список' : 'List'}
          </button>
        </div>

        {viewMode === 'list' && (
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
        )}
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>}

      {loading ? (
        <div className="py-24 text-center text-sm text-stone-400">{t('scripts.loading')}</div>
      ) : viewMode === 'board' ? (
        <div className="overflow-x-auto pb-3">
          <div className="grid min-w-[1080px] grid-cols-4 gap-3">
            {boardColumns.map(column => (
              <section
                key={column.id}
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  if (draggedScriptId) void moveBoardScript(column.id, draggedScriptId);
                }}
                className={'min-h-[520px] rounded-2xl border p-3 ' + column.tone}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-stone-800">{column.label}</h3>
                  <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-stone-500">{column.items.length}</span>
                </div>
                <div className="space-y-2">
                  {column.items.map(script => renderLibraryCard(script, true))}
                  {column.items.length === 0 && (
                    <div className="rounded-xl border border-dashed border-stone-200/80 bg-white/40 px-3 py-8 text-center text-[11px] text-stone-400">
                      {locale === 'ru' ? 'Перетащите сценарий сюда' : 'Drop a script here'}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mx-auto max-w-xl rounded-3xl border border-dashed border-stone-200 bg-white p-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-stone-300" />
          <div className="mt-3 font-bold text-stone-900">{searchQuery ? t('scripts.nothingFound') : t('scripts.noScripts')}</div>
          <p className="mt-2 text-sm text-stone-500">{searchQuery ? t('scripts.trySearch') : t('scripts.generateHint')}</p>
          {!searchQuery && <button onClick={onGoIdeas} className="mt-5 h-10 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white transition hover:bg-emerald-700">{t('scripts.goIdeas')}</button>}
        </div>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(script => renderLibraryCard(script))}
        </section>
      )}

      {current && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/35 p-2 backdrop-blur-[2px] sm:p-4" onMouseDown={closeEditor}>
          <div className="flex h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-3xl border border-white/50 bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <header className="shrink-0 border-b border-stone-100 px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={'rounded-full px-2.5 py-1 font-bold ' + statusClass(current)}>{statusLabel(current)}</span>
                    <span className="font-semibold text-stone-500">{t('scripts.version')} {current.version || 1}</span>
                    <span className="text-stone-300">·</span>
                    <span className="text-stone-400">{t('scripts.updated')} {new Date(current.publishedAt || current.scheduledAt || current.exportedAt || current.createdAt).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span>
                  </div>
                  <div className="mt-3 flex min-w-0 items-center gap-2">
                    {titleEditing ? (
                      <>
                        <input autoFocus value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveTitle(current); if (event.key === 'Escape') setTitleEditing(false); }} className="h-10 min-w-0 flex-1 rounded-xl border border-stone-200 px-3 text-xl font-bold outline-none focus:border-emerald-400" />
                        <button type="button" disabled={busyId === current.id || !titleDraft.trim()} onClick={() => void saveTitle(current)} className="h-9 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40">{t('scripts.saveTitle')}</button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setTitleDraft(current.ideaTitle || current.title); setTitleEditing(true); }}
                        className="min-w-0 flex-1 truncate text-left text-2xl font-bold tracking-tight text-stone-950 transition hover:text-emerald-800 sm:text-3xl"
                        title={locale === 'ru' ? 'Нажмите, чтобы изменить название' : 'Click to edit title'}
                      >
                        {current.ideaTitle || current.title}
                      </button>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail?.opportunity?.topic && <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600">{detail.opportunity.topic}</span>}
                    {current.publicationPlatform && <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600"><PlatformIcon platform={current.publicationPlatform} />{platformLabel(current.publicationPlatform)}</span>}
                    {current.radarOpportunityId && <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"><Link2 className="h-3 w-3" /> {t('scripts.fromIdea')}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button disabled={busyId === current.id} onClick={() => void copyScript(current)} className="hidden h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 sm:inline-flex"><Copy className="h-3.5 w-3.5" /> {t('scripts.copy')}</button>
                  <button type="button" onClick={closeEditor} className="rounded-xl p-2 text-stone-400 hover:bg-stone-50"><X className="h-5 w-5" /></button>
                </div>
              </div>

              <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-stone-100">
                {([
                  ['script', locale === 'ru' ? 'Сценарий' : 'Script'],
                  ['media', locale === 'ru' ? 'Медиа' : 'Media'],
                  ['publication', locale === 'ru' ? 'Публикация' : 'Publication'],
                  ['history', locale === 'ru' ? 'История' : 'History'],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => requestEditorTab(id)} className={'shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition ' + (editorTab === id ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-stone-500 hover:text-stone-800')}>
                    {label}
                  </button>
                ))}
              </nav>
            </header>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
              <main className="min-h-0 overflow-y-auto p-4 sm:p-6">
                {current.radarOpportunityId && <ContextualQuota quota={quota} metric="scriptGenerations" onOpenQuotas={onOpenQuotas} />}

                {editorTab === 'script' && (
                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 text-base font-bold text-stone-950"><Sparkles className="h-4 w-4 text-emerald-600" /> {locale === 'ru' ? 'Сценарий' : 'Script'}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-stone-400">{current.content.length.toLocaleString()} {locale === 'ru' ? 'символов' : 'characters'}</span>
                        {!isEditing && <span className="text-[10px] font-medium text-stone-400">{locale === 'ru' ? 'Нажмите на текст, чтобы редактировать' : 'Click the text to edit'}</span>}
                      </div>
                    </div>
                    {isEditing ? (
                      <div>
                        <textarea ref={editorTextareaRef} value={draftContent} onChange={event => setDraftContent(event.target.value)} className="min-h-[56vh] w-full resize-none rounded-2xl border border-stone-200 bg-white p-5 text-[15px] leading-7 text-stone-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                        <div className="mt-3 flex justify-end gap-2">
                          <button onClick={() => { setDraftContent(current.content); setIsEditing(false); }} className="h-9 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-600">{t('scripts.cancel')}</button>
                          <button disabled={busyId === current.id || !draftContent.trim()} onClick={() => void saveManualVersion(current)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save as v{nextVersionNumber}</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setDraftContent(current.content); setIsEditing(true); }}
                        className="min-h-[56vh] w-full whitespace-pre-wrap rounded-2xl border border-stone-100 bg-stone-50/50 p-5 text-left text-[15px] leading-7 text-stone-700 transition hover:border-emerald-200 hover:bg-emerald-50/20"
                        title={locale === 'ru' ? 'Нажмите, чтобы редактировать сценарий' : 'Click to edit script'}
                      >
                        {current.content}
                      </button>
                    )}
                  </section>
                )}

                {editorTab === 'media' && (
                  <section className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_1fr]">
                      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-100">
                        {current.thumbnail ? <img src={current.thumbnail} alt="" className="aspect-video h-full w-full object-cover" /> : <div className="flex aspect-video items-center justify-center text-stone-300"><FileText className="h-9 w-9" /></div>}
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-white p-4">
                        <div className="text-sm font-bold text-stone-900">{locale === 'ru' ? 'Исходные материалы' : 'Source material'}</div>
                        {current.videoTitles?.length ? <div className="mt-3 space-y-2">{current.videoTitles.map((title, index) => <div key={index} className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">{title}</div>)}</div> : <div className="mt-3 text-xs text-stone-400">{locale === 'ru' ? 'Дополнительные медиа не прикреплены.' : 'No additional media attached.'}</div>}
                      </div>
                    </div>
                    {detail?.opportunity && (
                      <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-600">
                        <div className="font-bold text-stone-900">{detail.opportunity.coreIdea}</div>
                        {detail.opportunity.whyInteresting && <div className="mt-2">{detail.opportunity.whyInteresting}</div>}
                        {detail.opportunity.sourceUrl && <a href={detail.opportunity.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 font-semibold text-emerald-700">{t('scripts.openSource')} <ExternalLink className="h-3 w-3" /></a>}
                      </div>
                    )}
                  </section>
                )}

                {editorTab === 'publication' && (
                  <section className="h-full min-h-[620px]">
                    <PublicationModal
                      embedded
                      script={current}
                      onClose={() => setEditorTab('script')}
                      onPublished={async () => {
                        await refresh(current.id);
                        setEditorTab('publication');
                      }}
                    />
                  </section>
                )}

                {editorTab === 'history' && (
                  <section>
                    <div className="mb-4 flex flex-wrap gap-2">
                      {(detail?.versions || []).map(version => <button key={version.id} onClick={() => void openScript(version.id)} className={'rounded-lg border px-3 py-2 text-xs font-semibold ' + (version.id === current.id ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-white text-stone-600')}>v{version.version || 1}</button>)}
                    </div>
                    <div className="space-y-2">
                      {(detail?.feedback || []).map(item => <div key={item.id} className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600"><b className="text-stone-900">{item.decision}</b>{item.reason ? ' · ' + item.reason : ''}<span className="text-stone-400"> · {new Date(item.createdAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span></div>)}
                      {!detail?.feedback?.length && <div className="text-xs text-stone-400">{t('scripts.noFeedback')}</div>}
                    </div>
                  </section>
                )}
              </main>

              <aside className="min-h-0 overflow-y-auto border-t border-stone-100 bg-stone-50/60 p-4 lg:border-l lg:border-t-0 sm:p-5">
                <div className="rounded-2xl border border-stone-200 bg-white p-4">
                  <h4 className="text-sm font-bold text-stone-900">{locale === 'ru' ? 'Детали сценария' : 'Script details'}</h4>
                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">{locale === 'ru' ? 'Статус' : 'Status'}</div>
                      <CustomSelect
                        value={(current.archivedAt ? 'archived' : current.isPublished ? 'published' : current.scheduledAt ? 'scheduled' : current.isReviewed ? 'approved' : 'review') as ScriptStatusTarget}
                        onChange={value => void setScriptStatus(current, value as ScriptStatusTarget)}
                        ariaLabel={locale === 'ru' ? 'Статус сценария' : 'Script status'}
                        options={[
                          { value: 'review', label: t('scripts.needsReview') },
                          { value: 'approved', label: t('scripts.approved') },
                          { value: 'scheduled', label: t('scripts.scheduled') },
                          { value: 'published', label: t('scripts.published') },
                          { value: 'archived', label: t('scripts.archived') },
                        ]}
                      />
                    </div>
                    <div className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-2 text-xs">
                      <span className="text-stone-400">{t('scripts.version')}</span><span className="font-semibold text-stone-800">v{current.version || 1}</span>
                      <span className="text-stone-400">{locale === 'ru' ? 'Источник' : 'Source'}</span><span className="font-semibold text-stone-800">{current.radarOpportunityId ? t('scripts.fromIdea') : (locale === 'ru' ? 'Вручную' : 'Manual')}</span>
                      <span className="text-stone-400">{locale === 'ru' ? 'Платформа' : 'Platform'}</span><span className="font-semibold text-stone-800">{platformLabel(current.publicationPlatform)}</span>
                      <span className="text-stone-400">{locale === 'ru' ? 'Запланировано' : 'Scheduled'}</span><span className="font-semibold text-stone-800">{current.scheduledAt ? new Date(current.scheduledAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                      <span className="text-stone-400">{locale === 'ru' ? 'Создано' : 'Created'}</span><span className="font-semibold text-stone-800">{new Date(current.createdAt).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
                  <h4 className="text-sm font-bold text-stone-900">{locale === 'ru' ? 'AI-инструменты' : 'AI tools'}</h4>
                  <div className="mt-3 space-y-2">
                    <button disabled={generationExhausted || busyId === current.id || !current.radarOpportunityId} onClick={() => confirmImproveScript(current)} className="flex h-10 w-full items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700 disabled:opacity-40"><Sparkles className="h-4 w-4 text-emerald-600" /> {locale === 'ru' ? 'Улучшить сценарий' : 'Improve script'}</button>
                    <p className="text-[10px] leading-4 text-stone-400">{locale === 'ru' ? 'AI-действия создают новую версию и не меняют статус сценария.' : 'AI actions create a new version and do not change workflow status.'}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <button disabled={busyId === current.id} onClick={() => void copyScript(current)} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700 sm:hidden"><Copy className="h-4 w-4" /> {t('scripts.copy')}</button>
                  <button disabled={busyId === current.id} onClick={() => void lifecycle(current, current.archivedAt ? 'restore' : 'archive')} className="flex h-10 w-full items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700"><Archive className="h-4 w-4" /> {current.archivedAt ? (locale === 'ru' ? 'Восстановить' : 'Restore') : (locale === 'ru' ? 'Архивировать' : 'Archive')}</button>
                  <button disabled={busyId === current.id} onClick={() => void deleteScript(current)} className="flex h-10 w-full items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600"><Trash2 className="h-4 w-4" /> {locale === 'ru' ? 'Удалить сценарий' : 'Delete script'}</button>
                </div>
              </aside>
            </div>
          </div>
        </div>
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
                <button type="button" disabled={busyId === 'create' || !newScriptTitle.trim() || !newScriptContent.trim()} onClick={confirmCreateManualScript} className="h-10 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white disabled:opacity-40">
                  {t('scripts.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal config={confirmConfig} onClose={() => setConfirmConfig(null)} />

      {pendingEditorTab && current && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-stone-950/30 p-4" onMouseDown={() => setPendingEditorTab(null)}>
          <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <div className="text-sm font-bold text-stone-950">{locale === 'ru' ? 'Есть несохранённые изменения' : 'You have unsaved changes'}</div>
            <p className="mt-2 text-xs leading-5 text-stone-500">
              {locale === 'ru'
                ? 'Перед переходом в другой раздел можно сохранить текст как новую версию или продолжить без сохранения.'
                : 'Before switching sections, save the text as a new version or continue without saving it.'}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setPendingEditorTab(null)} className="h-10 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-600">{locale === 'ru' ? 'Отмена' : 'Cancel'}</button>
              <button type="button" onClick={continueTabWithoutSaving} className="h-10 rounded-xl border border-stone-200 px-3 text-xs font-semibold text-stone-700">{locale === 'ru' ? 'Без сохранения' : 'Continue without saving'}</button>
              <button type="button" disabled={busyId === current.id} onClick={() => void saveAndContinueTab()} className="h-10 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40">{locale === 'ru' ? 'Сохранить и продолжить' : 'Save & continue'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
