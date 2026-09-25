import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Upload, X } from 'lucide-react';
import { GeneratedScript, PublicationJob, PublicationPlatform } from '../types';
import { authFetch } from '../services/authFetch';
import { getConnectedYouTubeChannel, publishVideoToYouTube, connectYouTubePublishing, type YouTubeChannelIdentity } from '../services/youtubePublishingService';
import { PlatformIcon } from './PlatformIcon';
import { CustomSelect } from './CustomSelect';
import { useIntegrationState } from '../hooks/useIntegrationState';
import { useI18n } from '../i18n';
import { MAX_TEMP_PUBLICATION_ASSET_MB, assertTemporaryPublicationMedia } from '../utils/publicationMedia';

interface PublicationModalProps {
  script: GeneratedScript;
  onClose: () => void;
  onPublished: () => void | Promise<void>;
}

const PLATFORMS: PublicationPlatform[] = ['youtube', 'instagram', 'tiktok'];

export const PublicationModal: React.FC<PublicationModalProps> = ({ script, onClose, onPublished }) => {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const [selected, setSelected] = useState<PublicationPlatform[]>(['youtube']);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(script.ideaTitle || script.title);
  const [description, setDescription] = useState('');
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataRequestId, setMetadataRequestId] = useState<string | null>(null);
  const [publishAt, setPublishAt] = useState(script.scheduledAt ? new Date(new Date(script.scheduledAt).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'private'>('public');
  const [madeForKids, setMadeForKids] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [youtubeChannel, setYoutubeChannel] = useState<YouTubeChannelIdentity | null>(null);
  const { connected: youtubeConnected, refresh: refreshYoutubeConnection, revision: youtubeRevision } = useIntegrationState('youtube');
  const [busy, setBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [jobs, setJobs] = useState<PublicationJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void authFetch('/api/radar/scripts/' + script.id + '/publications')
      .then(async response => response.ok ? await response.json() : { jobs: [] })
      .then(data => setJobs(data.jobs || []))
      .catch(() => undefined);
  }, [script.id]);

  useEffect(() => {
    let active = true;
    if (!youtubeConnected) {
      setYoutubeChannel(null);
      return () => { active = false; };
    }
    void getConnectedYouTubeChannel()
      .then(channel => { if (active) setYoutubeChannel(channel); })
      .catch(() => { if (active) setYoutubeChannel(null); });
    return () => { active = false; };
  }, [youtubeConnected, youtubeRevision]);

  const toggle = (platform: PublicationPlatform) => {
    setSelected([platform]);
    setDescription('');
    setMetadataRequestId(null);
  };

  const primaryPlatform = selected[0] || 'youtube';
  const isYouTube = primaryPlatform === 'youtube';

  const activeJob = useMemo(() => jobs.find(job => ['draft', 'queued', 'uploading', 'processing'].includes(job.status)), [jobs]);

  const updateJob = async (jobId: string, payload: Record<string, any>) => {
    const response = await authFetch('/api/publications/' + jobId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'PUBLICATION_UPDATE_FAILED');
    setJobs(current => current.map(job => job.id === jobId ? data.job : job));
    return data.job as PublicationJob;
  };

  const createJob = async (platform: PublicationPlatform) => {
    const response = await authFetch('/api/radar/scripts/' + script.id + '/publications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        scheduledAt: publishAt ? new Date(publishAt).toISOString() : undefined,
        mediaName: file?.name,
        mediaType: file?.type,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'PUBLICATION_CREATE_FAILED');
    setJobs(current => [data.job, ...current.filter(job => job.id !== data.job.id)]);
    return data.job as PublicationJob;
  };

  const connectYouTube = async () => {
    setConnectBusy(true);
    setError(null);
    try {
      const channel = await connectYouTubePublishing();
      if (!channel) throw new Error(tr('Не удалось получить канал YouTube', 'Could not resolve YouTube channel'));
      setYoutubeChannel(channel);
      await refreshYoutubeConnection();
    } catch (e: any) {
      setError(e?.message || tr('Не удалось подключить YouTube', 'Could not connect YouTube'));
    } finally {
      setConnectBusy(false);
    }
  };

  const generateMetadata = async () => {
    setMetadataBusy(true);
    setError(null);
    const requestId = metadataRequestId || (globalThis.crypto?.randomUUID?.() || `metadata-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setMetadataRequestId(requestId);
    try {
      const response = await authFetch('/api/radar/scripts/' + script.id + '/publication-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: primaryPlatform, requestId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error || 'AI_GENERATION_FAILED'), { code: data.code });
      setDescription(String(data.text || ''));
      setMetadataRequestId(null);
    } catch (e: any) {
      setError(e?.code === 'PRODUCT_QUOTA_EXCEEDED'
        ? tr('Лимит AI Generation исчерпан.', 'AI Generation quota is exhausted.')
        : e?.message || tr('Не удалось сгенерировать текст', 'Could not generate metadata'));
    } finally {
      setMetadataBusy(false);
    }
  };

  const publish = async () => {
    setError(null);
    setSuccess(null);
    if (!selected.length) {
      setError(tr('Выберите хотя бы одну площадку', 'Choose at least one platform'));
      return;
    }
    if (!file) {
      setError(tr('Добавьте видеофайл для публикации', 'Attach a video file to publish'));
      return;
    }
    if (!isYouTube) {
      try {
        assertTemporaryPublicationMedia(file);
      } catch (validationError: any) {
        if (validationError?.code === 'PUBLICATION_MEDIA_TOO_LARGE') {
          setError(tr(
            `Для Instagram/TikTok максимальный размер временного файла — ${MAX_TEMP_PUBLICATION_ASSET_MB} МБ.`,
            `Temporary Instagram/TikTok files are limited to ${MAX_TEMP_PUBLICATION_ASSET_MB} MB.`
          ));
          return;
        }
        setError(tr('Поддерживаются видеофайлы.', 'A video file is required.'));
        return;
      }
    }
    if (!isYouTube) {
      setError(tr(
        'Instagram и TikTok уже заложены в общий flow, но их OAuth/Direct Post адаптеры ещё не подключены. Для этого запуска сейчас выберите YouTube.',
        'Instagram and TikTok are already part of the shared flow, but their OAuth/Direct Post adapters are not connected yet. Select YouTube for this run.'
      ));
      return;
    }
    if (!youtubeConnected || !youtubeChannel) {
      setError(tr('Сначала подключите YouTube', 'Connect YouTube first'));
      return;
    }

    setBusy(true);
    try {
      const job = await createJob('youtube');
      await updateJob(job.id, { status: 'uploading' });

      try {
        const result = await publishVideoToYouTube({
          file,
          title: title.trim() || script.title,
          description,
          privacyStatus: privacy,
          publishAt: publishAt ? new Date(publishAt).toISOString() : undefined,
          madeForKids,
          containsSyntheticMedia: synthetic,
        });
        const future = publishAt && new Date(publishAt).getTime() > Date.now();
        await updateJob(job.id, {
          status: future ? 'queued' : 'processing',
          remoteId: result.videoId,
          remoteUrl: result.url,
        });
        setSuccess(future
          ? tr('Видео загружено в YouTube и запланировано.', 'Video uploaded to YouTube and scheduled.')
          : tr('Видео отправлено в YouTube. Платформа обрабатывает файл.', 'Video sent to YouTube. The platform is processing it.')
        );
        await onPublished();
      } catch (e: any) {
        await updateJob(job.id, {
          status: 'failed',
          errorCode: e?.code || 'YOUTUBE_PUBLISH_FAILED',
          errorMessage: e?.message || String(e),
        }).catch(() => undefined);
        throw e;
      }
    } catch (e: any) {
      const code = e?.code || '';
      const friendly = code === 'uploadLimitExceeded' || code === 'quotaExceeded'
        ? tr('YouTube временно отклонил публикацию из-за лимита платформы. Попробуйте позже.', 'YouTube temporarily rejected the publication because of a platform limit. Try again later.')
        : e?.message;
      setError(friendly || tr('Не удалось опубликовать', 'Could not publish'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 sm:p-5" onMouseDown={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-100 bg-white px-5 py-4">
          <div>
            <h3 className="text-xl font-bold text-stone-950">{tr('Опубликовать контент', 'Publish content')}</h3>
            <p className="mt-1 text-xs text-stone-500">{tr('Один flow для YouTube, Instagram и TikTok.', 'One flow for YouTube, Instagram and TikTok.')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-stone-400 hover:bg-stone-50"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">{tr('Площадки', 'Platforms')}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {PLATFORMS.map(platform => {
                  const enabled = platform === 'youtube';
                  const isSelected = selected.includes(platform);
                  return (
                    <button key={platform} type="button" onClick={() => toggle(platform)} className={`rounded-2xl border p-3 text-left transition ${isSelected ? 'border-emerald-400 bg-emerald-50/50 ring-1 ring-emerald-100' : 'border-stone-200 bg-white'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <PlatformIcon platform={platform} className="h-5 w-5" />
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{enabled ? tr('ДОСТУПНО', 'READY') : tr('СЛЕДУЮЩИЙ АДАПТЕР', 'NEXT ADAPTER')}</span>
                      </div>
                      <div className="mt-3 text-sm font-bold capitalize text-stone-900">{platform === 'youtube' ? 'YouTube' : platform === 'instagram' ? 'Instagram' : 'TikTok'}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block rounded-2xl border-2 border-dashed border-stone-200 bg-stone-50 p-4">
              <span className="flex items-center gap-2 text-xs font-bold text-stone-700"><Upload className="h-4 w-4" /> {tr('Медиафайл', 'Media file')}</span>
              <input type="file" accept="video/*" onChange={event => setFile(event.target.files?.[0] || null)} className="mt-3 block w-full text-xs text-stone-500 file:mr-3 file:rounded-xl file:border-0 file:bg-stone-950 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white" />
              {file && <div className="mt-2 text-[11px] text-stone-500">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</div>}
              <div className="mt-2 text-[10px] leading-4 text-stone-400">
                {tr(
                  `Instagram/TikTok: временное хранение в Firebase/GCS до ${MAX_TEMP_PUBLICATION_ASSET_MB} МБ. YouTube загружается напрямую и не использует этот лимит.`,
                  `Instagram/TikTok: temporary Firebase/GCS storage up to ${MAX_TEMP_PUBLICATION_ASSET_MB} MB. YouTube uploads directly and does not use this limit.`
                )}
              </div>
            </label>

            <div className="grid gap-3">
              {isYouTube && <label><span className="mb-1 block text-xs font-semibold text-stone-600">{tr('Название', 'Title')}</span><input value={title} onChange={event => setTitle(event.target.value)} className="h-11 w-full rounded-xl border border-stone-200 px-3 text-sm outline-none focus:border-emerald-400" /></label>}
              <label>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-stone-600">{isYouTube ? tr('Описание', 'Description') : tr('Подпись', 'Caption')}</span>
                  <button type="button" onClick={() => void generateMetadata()} disabled={metadataBusy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[10px] font-bold text-violet-700 disabled:opacity-50">
                    {metadataBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} AI Generation
                  </button>
                </div>
                <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder={tr('Пусто по умолчанию. Напишите вручную или сгенерируйте AI.', 'Empty by default. Write it yourself or generate with AI.')} className="min-h-28 w-full rounded-2xl border border-stone-200 p-3 text-sm leading-5 outline-none focus:border-emerald-400" />
                <div className="mt-1 text-[10px] text-stone-400">{tr('AI добавляет текст и хэштеги только по вашему клику. После этого поле остаётся редактируемым.', 'AI adds copy and hashtags only when you click. The field remains editable afterward.')}</div>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className="mb-1 block text-xs font-semibold text-stone-600">{tr('Дата и время', 'Date & time')}</span><input type="datetime-local" value={publishAt} onChange={event => setPublishAt(event.target.value)} className="h-11 w-full rounded-xl border border-stone-200 px-3 text-sm" /></label>
                {isYouTube && <label><span className="mb-1 block text-xs font-semibold text-stone-600">{tr('Видимость YouTube', 'YouTube visibility')}</span><CustomSelect value={privacy} onChange={setPrivacy} ariaLabel={tr('Видимость YouTube', 'YouTube visibility')} options={[{ value: 'public', label: 'Public' }, { value: 'unlisted', label: 'Unlisted' }, { value: 'private', label: 'Private' }]} /></label>}
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-stone-600">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={madeForKids} onChange={event => setMadeForKids(event.target.checked)} /> {tr('Для детей', 'Made for kids')}</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={synthetic} onChange={event => setSynthetic(event.target.checked)} /> {tr('Содержит синтетический/AI-контент', 'Contains synthetic/AI content')}</label>
              </div>
            </div>
          </div>

          <aside className="space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <div className="flex items-center gap-2"><PlatformIcon platform="youtube" className="h-5 w-5" /><div className="font-bold text-stone-900">YouTube</div></div>
              {youtubeChannel ? (
                <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-stone-100">
                  <div className="flex items-center gap-2">
                    {youtubeChannel.thumbnail && <img src={youtubeChannel.thumbnail} alt="" className="h-8 w-8 rounded-full" />}
                    <div className="min-w-0"><div className="truncate text-xs font-bold text-stone-800">{youtubeChannel.title}</div><div className="text-[10px] text-emerald-700">{tr('Публикация разрешена', 'Publishing authorized')}</div></div>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={connectBusy} onClick={() => void connectYouTube()} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-stone-950 px-3 text-xs font-semibold text-white disabled:opacity-50">
                  {connectBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {tr('Подключить YouTube', 'Connect YouTube')}
                </button>
              )}
            </div>

            {activeJob && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-800">
                <div className="font-bold">{tr('Текущая публикация', 'Current publication')}</div>
                <div className="mt-1">{activeJob.platform} · {activeJob.status}</div>
                {activeJob.remoteUrl && <a href={activeJob.remoteUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold underline">{tr('Открыть', 'Open')}</a>}
              </div>
            )}

            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-[11px] leading-5 text-amber-800">
              <AlertTriangle className="mb-2 h-4 w-4" />
              {tr('Instagram и TikTok входят в эту же модель PublicationJob. Подключим их OAuth/Direct Post адаптеры отдельным проверяемым шагом, не меняя UX.', 'Instagram and TikTok use the same PublicationJob model. Their OAuth/Direct Post adapters will plug into this flow without changing the UX.')}
            </div>
          </aside>
        </div>

        {(error || success) && <div className="px-5 pb-2">{error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />{success}</div>}</div>}

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-stone-100 bg-white px-5 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-600">{tr('Отмена', 'Cancel')}</button>
          <button type="button" disabled={busy || metadataBusy || !file || !selected.length || !isYouTube} onClick={() => void publish()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white disabled:opacity-40">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {publishAt && new Date(publishAt).getTime() > Date.now() ? tr('Загрузить и запланировать', 'Upload & schedule') : tr('Опубликовать', 'Publish')}
          </button>
        </div>
      </div>
    </div>
  );
};
