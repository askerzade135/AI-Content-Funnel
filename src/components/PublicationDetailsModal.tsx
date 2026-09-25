import React, { useState } from 'react';
import { CalendarDays, Copy, ExternalLink, FileText, Loader2, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { GeneratedScript, PublicationJob } from '../types';
import { authFetch } from '../services/authFetch';
import { PlatformIcon, publicationPlatformLabel } from './PlatformIcon';
import { useI18n } from '../i18n';

interface PublicationDetailsModalProps {
  publication: PublicationJob | null;
  script: GeneratedScript;
  onClose: () => void;
  onEdit: () => void;
  onOpenScript: () => void;
  onChanged: () => void | Promise<void>;
}

export const PublicationDetailsModal: React.FC<PublicationDetailsModalProps> = ({
  publication,
  script,
  onClose,
  onEdit,
  onOpenScript,
  onChanged,
}) => {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = publication?.platform || (script.publicationPlatform === 'youtube' || script.publicationPlatform === 'instagram' || script.publicationPlatform === 'tiktok' ? script.publicationPlatform : undefined);
  const scheduledAt = publication?.scheduledAt || script.scheduledAt;
  const dateLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
  const cover = publication?.remoteId && platform === 'youtube'
    ? `https://i.ytimg.com/vi/${publication.remoteId}/hqdefault.jpg`
    : script.thumbnail;

  const status = (() => {
    if (!publication) {
      if (script.isPublished) return tr('Опубликовано', 'Published');
      return scheduledAt ? tr('Запланировано', 'Scheduled') : tr('Черновик', 'Draft');
    }
    if (publication.status === 'published') return tr('Опубликовано', 'Published');
    if (publication.status === 'failed') return tr('Ошибка публикации', 'Publish failed');
    if (publication.status === 'uploading') return tr('Загрузка', 'Uploading');
    if (publication.status === 'processing') return tr('Обработка платформой', 'Processing on platform');
    if (publication.status === 'queued') return tr('Запланировано', 'Scheduled');
    return scheduledAt ? tr('Запланировано', 'Scheduled') : tr('Черновик', 'Draft');
  })();

  const unschedule = async () => {
    if (!publication) return onEdit();
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch('/api/publications/' + publication.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'PUBLICATION_UPDATE_FAILED');
      await onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message || tr('Не удалось убрать из расписания', 'Could not unschedule publication'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!publication) return;
    if (!window.confirm(tr('Удалить эту публикацию из плана?', 'Delete this publication from the plan?'))) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch('/api/publications/' + publication.id, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'PUBLICATION_DELETE_FAILED');
      await onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message || tr('Не удалось удалить публикацию', 'Could not delete publication'));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!publication?.remoteUrl) return;
    await navigator.clipboard.writeText(publication.remoteUrl);
    setMoreOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-3" onMouseDown={busy ? undefined : onClose}>
      <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div>
            <h3 className="text-xl font-bold text-stone-950">{tr('Публикация', 'Publication details')}</h3>
            <p className="mt-1 text-xs text-stone-400">{status}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl p-2 text-stone-400 hover:bg-stone-50"><X className="h-4 w-4" /></button>
        </header>

        <div className="p-5">
          <div className="flex gap-4">
            <div className="h-24 w-36 shrink-0 overflow-hidden rounded-2xl bg-stone-100">
              {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center"><FileText className="h-7 w-7 text-stone-300" /></div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{status}</span>
                {platform && <span className="inline-flex items-center gap-1 text-xs font-semibold text-stone-700"><PlatformIcon platform={platform} /> {publicationPlatformLabel(platform, locale)}</span>}
              </div>
              <h4 className="mt-3 line-clamp-3 text-base font-bold leading-5 text-stone-950">{publication?.title || script.ideaTitle || script.title}</h4>
              {scheduledAt && <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-stone-500"><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {new Date(scheduledAt).toLocaleString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
            <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 text-xs">
              <dt className="text-stone-400">{tr('Статус', 'Status')}</dt><dd className="font-semibold text-stone-800">{status}</dd>
              <dt className="text-stone-400">{tr('Платформа', 'Platform')}</dt><dd className="font-semibold text-stone-800">{platform ? publicationPlatformLabel(platform, locale) : '—'}</dd>
              <dt className="text-stone-400">{tr('Видимость', 'Visibility')}</dt><dd className="font-semibold capitalize text-stone-800">{publication?.platform === 'tiktok' ? (publication.tiktokPrivacyLevel || '—') : publication?.privacyStatus || '—'}</dd>
              <dt className="text-stone-400">Google Calendar</dt><dd className="font-semibold text-stone-800">{script.calendarEventId ? tr('Синхронизировано', 'Synced') : '—'}</dd>
              <dt className="text-stone-400">{tr('Создано', 'Created')}</dt><dd className="font-semibold text-stone-800">{new Date(publication?.createdAt || script.createdAt).toLocaleString(dateLocale)}</dd>
            </dl>
          </div>

          {publication?.status === 'failed' && publication.errorMessage && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{publication.errorMessage}</div>}
          {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>}

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={onEdit} className="inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white"><Pencil className="h-3.5 w-3.5" /> {tr('Изменить публикацию', 'Edit publication')}</button>
            <button type="button" onClick={onOpenScript} className="inline-flex h-10 items-center gap-2 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-700"><FileText className="h-3.5 w-3.5" /> {tr('Открыть сценарий', 'Open script')}</button>
            {publication?.remoteUrl && <a href={publication.remoteUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-700"><ExternalLink className="h-3.5 w-3.5" /> {tr('Открыть на платформе', 'Open on platform')}</a>}
            <div className="relative ml-auto">
              <button type="button" onClick={() => setMoreOpen(open => !open)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 text-stone-600"><MoreHorizontal className="h-4 w-4" /></button>
              {moreOpen && (
                <div className="absolute bottom-12 right-0 z-10 w-52 rounded-2xl border border-stone-200 bg-white p-1.5 shadow-xl">
                  <button type="button" onClick={onEdit} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-stone-700 hover:bg-stone-50"><CalendarDays className="h-3.5 w-3.5" /> {tr('Перенести', 'Reschedule')}</button>
                  <button type="button" onClick={() => void unschedule()} disabled={busy} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />} {tr('Убрать из расписания', 'Unschedule')}</button>
                  {publication?.remoteUrl && <button type="button" onClick={() => void copyLink()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-stone-700 hover:bg-stone-50"><Copy className="h-3.5 w-3.5" /> {tr('Копировать ссылку', 'Copy link')}</button>}
                  {publication && <button type="button" onClick={() => void remove()} disabled={busy} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> {tr('Удалить публикацию', 'Delete publication')}</button>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
