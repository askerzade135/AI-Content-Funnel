import React, { useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, Clipboard, Download, ExternalLink, FileText, Pencil, RotateCcw, Save, Send, Sparkles, X } from 'lucide-react';
import { createGoogleDocFromHtml } from '../services/googleDocsService';
import { GeneratedScript, RadarScriptDetail, RadarScriptFeedbackReason } from '../types';
import { authFetch } from '../services/authFetch';

interface RadarScriptsWorkspaceProps {
  onGoIdeas: () => void;
  initialSelectedId?: string;
}

type ScriptFilter = 'review' | 'approved' | 'exported' | 'published' | 'archived';

export const RadarScriptsWorkspace: React.FC<RadarScriptsWorkspaceProps> = ({ onGoIdeas, initialSelectedId }) => {
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [filter, setFilter] = useState<ScriptFilter>('review');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RadarScriptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');

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
      setError('Не удалось загрузить сценарий');
      return;
    }
    const data = await res.json();
    setDetail(data);
    setDraftContent(data.script?.content || '');
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
      setFilter('exported');
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
      setFilter('exported');
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
      setFilter('exported');
      await refresh(script.id);
    } catch (e: any) {
      if (popup && !popup.closed) popup.close();
      setError(e?.message || 'Не удалось экспортировать в Google Docs');
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
    review: scripts.filter(s => !s.isReviewed && !s.archivedAt),
    approved: scripts.filter(s => s.isReviewed && !s.exportedAt && !s.telegramSent && !s.isPublished && !s.archivedAt),
    exported: scripts.filter(s => (Boolean(s.exportedAt) || Boolean(s.telegramSent)) && !s.isPublished && !s.archivedAt),
    published: scripts.filter(s => s.isPublished && !s.archivedAt),
    archived: scripts.filter(s => Boolean(s.archivedAt)),
  }), [scripts]);

  const current = detail?.script;
  const filtered = groups[filter];
  const nextVersionNumber = Math.max(
    Number(current?.version || 1),
    ...(detail?.versions || []).map(version => Number(version.version || 1))
  ) + 1;
  const nextReviewScript = groups.review.find(script => script.id !== current?.id);

  const statusLabel = (script: GeneratedScript) => {
    if (script.archivedAt) return 'ARCHIVED';
    if (script.isPublished) return 'PUBLISHED';
    if (script.exportedAt || script.telegramSent) return 'EXPORTED';
    if (script.isReviewed) return 'APPROVED';
    return 'NEEDS REVIEW';
  };

  const statusClass = (script: GeneratedScript) => {
    if (script.archivedAt) return 'bg-stone-100 text-stone-700';
    if (script.isPublished) return 'bg-violet-100 text-violet-800';
    if (script.exportedAt || script.telegramSent) return 'bg-sky-100 text-sky-800';
    if (script.isReviewed) return 'bg-emerald-100 text-emerald-800';
    return 'bg-amber-100 text-amber-800';
  };

  const tabs: Array<[ScriptFilter, string, number]> = [
    ['review', 'Needs review', groups.review.length],
    ['approved', 'Approved', groups.approved.length],
    ['exported', 'Exported', groups.exported.length],
    ['published', 'Published', groups.published.length],
    ['archived', 'Archived', groups.archived.length],
  ];

  return (
    <div className="p-5 sm:p-7 max-w-[1500px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Production workspace</div>
          <h2 className="text-3xl font-bold tracking-tight mt-1">Scripts</h2>
          <p className="text-sm text-stone-500 mt-1">От идеи до опубликованного ролика — версии, feedback и история отправки.</p>
        </div>
        <div className="text-xs text-stone-500">{scripts.length} total</div>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={'px-3 py-1.5 rounded-full text-xs font-semibold border transition ' + (filter === id ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-500 border-stone-200')}
          >
            {label} · {count}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_520px] gap-5 items-start">
        <section className="space-y-3">
          {loading ? (
            <div className="py-20 text-center text-sm text-stone-400">Загружаю сценарии…</div>
          ) : filtered.length === 0 ? (
            <div className="border-2 border-dashed rounded-3xl p-12 text-center">
              <FileText className="w-8 h-8 mx-auto text-stone-400"/>
              <div className="font-bold mt-3">В этом статусе пока пусто</div>
              <button onClick={onGoIdeas} className="mt-4 px-4 py-2 rounded-xl bg-stone-900 text-white text-xs font-semibold">Перейти к идеям</button>
            </div>
          ) : filtered.map(script => (
            <button
              key={script.id}
              onClick={() => openScript(script.id)}
              className={'w-full text-left bg-white border rounded-2xl p-5 transition hover:shadow-sm ' + (selectedId === script.id ? 'border-violet-400 ring-2 ring-violet-100' : 'border-stone-200')}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={'text-[10px] font-bold px-2 py-1 rounded-full ' + statusClass(script)}>{statusLabel(script)}</span>
                  <span className="text-[10px] text-stone-400">v{script.version || 1}</span>
                </div>
                <span className="text-[10px] text-stone-400">{new Date(script.createdAt).toLocaleDateString('ru-RU')}</span>
              </div>
              <h3 className="font-bold mt-3">{script.ideaTitle || script.title}</h3>
              <p className="text-xs text-stone-500 mt-2 line-clamp-3 whitespace-pre-wrap">{script.content}</p>
            </button>
          ))}
        </section>

        <aside className="xl:sticky xl:top-24">
          {!current ? (
            <div className="bg-stone-900 text-white rounded-3xl p-8 min-h-[420px] flex flex-col justify-center">
              <Sparkles className="w-7 h-7 text-lime-300"/>
              <h3 className="text-xl font-bold mt-4">Открой сценарий</h3>
              <p className="text-sm text-stone-400 mt-2">Здесь появятся полный текст, source evidence, версии, feedback и действия.</p>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden">
              <div className="p-5 border-b border-stone-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[.16em] font-bold text-violet-600">Script detail</div>
                    <h3 className="text-xl font-bold mt-1">{current.ideaTitle || current.title}</h3>
                    <div className="text-xs text-stone-400 mt-1">
                      Version {current.version || 1} · {new Date(current.createdAt).toLocaleString('ru-RU')}
                      {current.editedManually ? ' · Manual edit' : ''}
                      {current.exportMethod ? ' · Exported via ' + current.exportMethod : ''}
                    </div>
                  </div>
                  <button onClick={() => { setSelectedId(null); setDetail(null); }} className="p-2 rounded-xl hover:bg-stone-100"><X className="w-4 h-4"/></button>
                </div>
              </div>

              <div className="p-5 max-h-[68vh] overflow-y-auto space-y-5">
                <div>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-xs font-bold">Script text</div>
                    {!isEditing ? (
                      <button
                        type="button"
                        onClick={() => { setDraftContent(current.content); setIsEditing(true); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-200 text-[11px] font-semibold text-stone-700 hover:bg-stone-50"
                      >
                        <Pencil className="w-3 h-3"/> Edit
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setDraftContent(current.content); setIsEditing(false); }}
                          className="px-2.5 py-1.5 rounded-lg border border-stone-200 text-[11px] font-semibold text-stone-600"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={busyId === current.id || !draftContent.trim()}
                          onClick={() => saveManualVersion(current)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-900 text-white text-[11px] font-semibold disabled:opacity-50"
                        >
                          <Save className="w-3 h-3"/> Save as v{nextVersionNumber}
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <textarea
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      className="w-full min-h-[360px] resize-y rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm leading-6 text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                    />
                  ) : (
                    <div className="whitespace-pre-wrap text-sm leading-6 text-stone-800">{current.content}</div>
                  )}
                </div>

                {detail?.opportunity && (
                  <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4">
                    <div className="text-[10px] uppercase tracking-wide font-bold text-stone-400">Opportunity</div>
                    <div className="font-semibold mt-1">{detail.opportunity.coreIdea}</div>
                    <div className="text-xs text-stone-500 mt-2"><b>Angle:</b> {detail.opportunity.angle}</div>
                    {detail.opportunity.evidence?.length ? (
                      <div className="text-xs text-stone-500 mt-2">
                        {detail.opportunity.evidence.map((item, index) => <div key={index}>• {item}</div>)}
                      </div>
                    ) : null}
                    <a href={detail.opportunity.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 mt-3">
                      Source <ExternalLink className="w-3 h-3"/>
                    </a>
                  </div>
                )}

                <div>
                  <div className="text-xs font-bold mb-2">Versions</div>
                  <div className="flex flex-wrap gap-2">
                    {(detail?.versions || []).map(version => (
                      <button
                        key={version.id}
                        onClick={() => openScript(version.id)}
                        className={'px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold ' + (version.id === current.id ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-200')}
                      >
                        v{version.version || 1}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold mb-2">Feedback history</div>
                  <div className="space-y-2">
                    {(detail?.feedback || []).slice(0, 6).map(item => (
                      <div key={item.id} className="text-[11px] rounded-xl bg-stone-50 border border-stone-200 px-3 py-2">
                        <span className="font-semibold">{item.decision}</span>
                        {item.reason ? ' · ' + item.reason : ''}
                        <span className="text-stone-400"> · {new Date(item.createdAt).toLocaleString('ru-RU')}</span>
                      </div>
                    ))}
                    {!detail?.feedback?.length && <div className="text-[11px] text-stone-400">Feedback пока нет.</div>}
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-stone-200 bg-stone-50 flex flex-wrap gap-2">
                {!current.isReviewed && (
                  <>
                    <button disabled={busyId === current.id} onClick={() => review(current, 'approved')} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50">Approve</button>
                    <button disabled={busyId === current.id} onClick={() => review(current, 'rewrite', 'weak_hook')} className="px-3 py-2 rounded-xl bg-amber-100 text-amber-900 text-xs font-semibold disabled:opacity-50">Rewrite · weak hook</button>
                    <button disabled={busyId === current.id} onClick={() => review(current, 'rewrite', 'wrong_tone')} className="px-3 py-2 rounded-xl bg-amber-100 text-amber-900 text-xs font-semibold disabled:opacity-50">Wrong tone</button>
                    <button disabled={busyId === current.id} onClick={() => review(current, 'rewrite', 'too_generic')} className="px-3 py-2 rounded-xl bg-amber-100 text-amber-900 text-xs font-semibold disabled:opacity-50">Too generic</button>
                  </>
                )}

                {current.isReviewed && !current.isPublished && !current.archivedAt && (
                  <>
                    <button disabled={busyId === current.id} onClick={() => copyScript(current)} className="px-3 py-2 rounded-xl bg-white border border-stone-200 text-stone-700 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                      <Clipboard className="w-3 h-3"/> Copy
                    </button>
                    <button disabled={busyId === current.id} onClick={() => downloadScript(current)} className="px-3 py-2 rounded-xl bg-white border border-stone-200 text-stone-700 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                      <Download className="w-3 h-3"/> Download .txt
                    </button>
                    <button disabled={busyId === current.id} onClick={() => exportToGoogleDocs(current)} className="px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                      <FileText className="w-3 h-3"/> Google Docs
                    </button>
                    {!current.telegramSent && (
                      <button disabled={busyId === current.id} onClick={() => send(current)} className="px-3 py-2 rounded-xl bg-sky-600 text-white text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                        <Send className="w-3 h-3"/> Telegram
                      </button>
                    )}
                  </>
                )}

                {(current.exportedAt || current.telegramSent) && !current.isPublished && (
                  <button disabled={busyId === current.id} onClick={() => lifecycle(current, 'published')} className="px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                    <CheckCircle2 className="w-3 h-3"/> Mark as published
                  </button>
                )}

                {current.isPublished && (
                  <button disabled={busyId === current.id} onClick={() => lifecycle(current, 'unpublished')} className="px-3 py-2 rounded-xl border border-violet-200 text-violet-700 text-xs font-semibold disabled:opacity-50">
                    Undo published
                  </button>
                )}

                {nextReviewScript && (
                  <button
                    disabled={busyId === current.id}
                    onClick={() => { setFilter('review'); void openScript(nextReviewScript.id); }}
                    className="px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-xs font-semibold disabled:opacity-50"
                  >
                    Next review →
                  </button>
                )}

                {!current.archivedAt ? (
                  <button disabled={busyId === current.id} onClick={() => lifecycle(current, 'archive')} className="ml-auto px-3 py-2 rounded-xl border border-stone-200 text-stone-600 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                    <Archive className="w-3 h-3"/> Archive
                  </button>
                ) : (
                  <button disabled={busyId === current.id} onClick={() => lifecycle(current, 'restore')} className="ml-auto px-3 py-2 rounded-xl border border-stone-200 text-stone-600 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                    <RotateCcw className="w-3 h-3"/> Restore
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
