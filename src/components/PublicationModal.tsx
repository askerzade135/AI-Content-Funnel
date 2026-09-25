import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, Image as ImageIcon, Loader2, Sparkles, Upload, X } from 'lucide-react';
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
  initialPublication?: PublicationJob | null;
}

type PlatformDraft = {
  title: string;
  description: string;
  useBase: boolean;
};

type ScheduleDraft = {
  date: string;
  time: string;
};

const PLATFORMS: PublicationPlatform[] = ['youtube', 'instagram', 'tiktok'];

const platformName = (platform: PublicationPlatform) =>
  platform === 'youtube' ? 'YouTube' : platform === 'instagram' ? 'Instagram' : 'TikTok';

const toLocalParts = (value?: string): ScheduleDraft => {
  if (!value) return { date: '', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
};

const toIso = ({ date, time }: ScheduleDraft): string | undefined => {
  if (!date) return undefined;
  const parsed = new Date(`${date}T${time || '09:00'}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

export const PublicationModal: React.FC<PublicationModalProps> = ({ script, onClose, onPublished, initialPublication = null }) => {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const editing = Boolean(initialPublication);
  const initialPlatform = initialPublication?.platform || 'youtube';
  const initialSchedule = toLocalParts(initialPublication?.scheduledAt || script.scheduledAt);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selected, setSelected] = useState<PublicationPlatform[]>([initialPlatform]);
  const [activeContentTab, setActiveContentTab] = useState<'base' | PublicationPlatform>(initialPlatform);
  const [file, setFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [baseText, setBaseText] = useState('');
  const [drafts, setDrafts] = useState<Record<PublicationPlatform, PlatformDraft>>({
    youtube: {
      title: initialPublication?.platform === 'youtube' ? (initialPublication.title || script.ideaTitle || script.title) : (script.ideaTitle || script.title),
      description: initialPublication?.platform === 'youtube' ? (initialPublication.description || '') : '',
      useBase: !initialPublication?.description,
    },
    instagram: {
      title: '',
      description: initialPublication?.platform === 'instagram' ? (initialPublication.description || '') : '',
      useBase: !initialPublication?.description,
    },
    tiktok: {
      title: '',
      description: initialPublication?.platform === 'tiktok' ? (initialPublication.description || '') : '',
      useBase: !initialPublication?.description,
    },
  });
  const [sameTime, setSameTime] = useState(true);
  const [commonSchedule, setCommonSchedule] = useState<ScheduleDraft>(initialSchedule);
  const [platformSchedules, setPlatformSchedules] = useState<Record<PublicationPlatform, ScheduleDraft>>({
    youtube: initialSchedule,
    instagram: initialSchedule,
    tiktok: initialSchedule,
  });
  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'private'>(initialPublication?.privacyStatus || 'public');
  const [madeForKids, setMadeForKids] = useState(Boolean(initialPublication?.madeForKids));
  const [synthetic, setSynthetic] = useState(Boolean(initialPublication?.containsSyntheticMedia));
  const [youtubeChannel, setYoutubeChannel] = useState<YouTubeChannelIdentity | null>(null);
  const { connected: youtubeConnected, refresh: refreshYoutubeConnection, revision: youtubeRevision } = useIntegrationState('youtube');
  const [busy, setBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataRequestId, setMetadataRequestId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<PublicationJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const videoPreview = useMemo(() => file ? URL.createObjectURL(file) : '', [file]);
  const thumbnailPreview = useMemo(() => thumbnailFile ? URL.createObjectURL(thumbnailFile) : '', [thumbnailFile]);

  useEffect(() => () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
  }, [videoPreview, thumbnailPreview]);

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

  useEffect(() => {
    if (!selected.includes(activeContentTab as PublicationPlatform) && activeContentTab !== 'base') {
      setActiveContentTab(selected.length > 1 ? 'base' : selected[0]);
    }
  }, [selected, activeContentTab]);

  const togglePlatform = (platform: PublicationPlatform) => {
    if (editing) return;
    setSelected(current => {
      if (current.includes(platform)) {
        if (current.length === 1) return current;
        return current.filter(item => item !== platform);
      }
      return [...current, platform];
    });
    setError(null);
  };

  const updateDraft = (platform: PublicationPlatform, patch: Partial<PlatformDraft>) => {
    setDrafts(current => ({ ...current, [platform]: { ...current[platform], ...patch } }));
  };

  const connectYouTube = async () => {
    setConnectBusy(true);
    setError(null);
    try {
      const channel = await connectYouTubePublishing();
      if (!channel) throw new Error(tr('Канал YouTube не найден', 'YouTube channel not found'));
      setYoutubeChannel(channel);
      await refreshYoutubeConnection();
    } catch (e: any) {
      setError(e?.message || tr('Не удалось подключить YouTube', 'Could not connect YouTube'));
    } finally {
      setConnectBusy(false);
    }
  };

  const generateMetadata = async (target: 'base' | PublicationPlatform) => {
    setMetadataBusy(true);
    setError(null);
    const platform = target === 'base' ? selected[0] : target;
    const requestId = metadataRequestId || (globalThis.crypto?.randomUUID?.() || `metadata-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setMetadataRequestId(requestId);
    try {
      const response = await authFetch('/api/radar/scripts/' + script.id + '/publication-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, requestId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error || 'AI_GENERATION_FAILED'), { code: data.code });
      const text = String(data.text || '');
      if (target === 'base') setBaseText(text);
      else updateDraft(target, { description: text, useBase: false });
      setMetadataRequestId(null);
    } catch (e: any) {
      setError(e?.code === 'PRODUCT_QUOTA_EXCEEDED'
        ? tr('Лимит AI Generation исчерпан.', 'AI Generation quota is exhausted.')
        : e?.message || tr('Не удалось сгенерировать текст', 'Could not generate metadata'));
    } finally {
      setMetadataBusy(false);
    }
  };

  const visibleText = (platform: PublicationPlatform) => drafts[platform].useBase ? baseText : drafts[platform].description;

  const scheduleFor = (platform: PublicationPlatform) => sameTime ? commonSchedule : platformSchedules[platform];

  const createOrUpdateJob = async (platform: PublicationPlatform) => {
    const draft = drafts[platform];
    const payload = {
      scheduledAt: toIso(scheduleFor(platform)),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      mediaName: file?.name || initialPublication?.mediaName,
      mediaType: file?.type || initialPublication?.mediaType,
      thumbnailName: thumbnailFile?.name || initialPublication?.thumbnailName,
      thumbnailType: thumbnailFile?.type || initialPublication?.thumbnailType,
      title: platform === 'youtube' ? draft.title.trim() : undefined,
      description: visibleText(platform),
      privacyStatus: platform === 'youtube' ? privacy : undefined,
      madeForKids: platform === 'youtube' ? madeForKids : undefined,
      containsSyntheticMedia: platform === 'youtube' ? synthetic : undefined,
    };

    if (initialPublication && initialPublication.platform === platform) {
      const response = await authFetch('/api/publications/' + initialPublication.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'PUBLICATION_UPDATE_FAILED');
      return data.job as PublicationJob;
    }

    const response = await authFetch('/api/radar/scripts/' + script.id + '/publications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'PUBLICATION_CREATE_FAILED');
    return data.job as PublicationJob;
  };

  const updateJob = async (jobId: string, payload: Record<string, any>) => {
    const response = await authFetch('/api/publications/' + jobId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'PUBLICATION_UPDATE_FAILED');
    return data.job as PublicationJob;
  };

  const submit = async () => {
    setError(null);
    setSuccess(null);

    if (!editing && !file) {
      setError(tr('Добавьте видеофайл', 'Attach a video file'));
      setStep(1);
      return;
    }

    if (!editing && selected.includes('youtube') && !youtubeConnected) {
      setError(tr('Подключите YouTube перед публикацией', 'Connect YouTube before publishing'));
      setStep(1);
      return;
    }

    if (file && selected.some(platform => platform !== 'youtube')) {
      try {
        assertTemporaryPublicationMedia(file);
      } catch (validationError: any) {
        setError(validationError?.code === 'PUBLICATION_MEDIA_TOO_LARGE'
          ? tr(`Для Instagram/TikTok максимальный размер временного файла — ${MAX_TEMP_PUBLICATION_ASSET_MB} МБ.`, `Temporary Instagram/TikTok files are limited to ${MAX_TEMP_PUBLICATION_ASSET_MB} MB.`)
          : tr('Поддерживаются видеофайлы.', 'A video file is required.'));
        setStep(1);
        return;
      }
    }

    setBusy(true);
    try {
      const processed: PublicationJob[] = [];
      for (const platform of selected) {
        let job = await createOrUpdateJob(platform);

        if (platform === 'youtube' && file && !editing) {
          job = await updateJob(job.id, { status: 'uploading' });
          try {
            const draft = drafts.youtube;
            const result = await publishVideoToYouTube({
              file,
              thumbnailFile,
              title: draft.title.trim() || script.ideaTitle || script.title,
              description: visibleText('youtube'),
              privacyStatus: privacy,
              publishAt: toIso(scheduleFor('youtube')),
              madeForKids,
              containsSyntheticMedia: synthetic,
            });
            const future = Boolean(toIso(scheduleFor('youtube')) && new Date(toIso(scheduleFor('youtube'))!).getTime() > Date.now());
            job = await updateJob(job.id, {
              status: future ? 'queued' : 'processing',
              remoteId: result.videoId,
              remoteUrl: result.url,
            });
          } catch (e: any) {
            await updateJob(job.id, {
              status: 'failed',
              errorCode: e?.code || 'YOUTUBE_PUBLISH_FAILED',
              errorMessage: e?.message || String(e),
            }).catch(() => undefined);
            throw e;
          }
        }

        processed.push(job);
      }

      setJobs(current => {
        const ids = new Set(processed.map(job => job.id));
        return [...processed, ...current.filter(job => !ids.has(job.id))];
      });
      setSuccess(editing
        ? tr('Параметры публикации обновлены.', 'Publication settings updated.')
        : selected.some(platform => platform !== 'youtube')
          ? tr('YouTube отправлен на публикацию; Instagram/TikTok сохранены как план до подключения адаптеров.', 'YouTube was sent for publishing; Instagram/TikTok were saved as a plan until their adapters are connected.')
          : tr('Публикация отправлена в YouTube.', 'Publication was sent to YouTube.'));
      await onPublished();
    } catch (e: any) {
      setError(e?.message || tr('Не удалось сохранить публикацию', 'Could not save publication'));
    } finally {
      setBusy(false);
    }
  };

  const canLeaveStepOne = Boolean(selected.length && (file || initialPublication?.mediaName));
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const selectedLabel = selected.map(platformName).join(', ');

  const stepLabels = [
    tr('Платформа и медиа', 'Platform & media'),
    tr('Текст и настройки', 'Content adaptation'),
    tr('Дата и публикация', 'Schedule & publish'),
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 sm:p-4" onMouseDown={busy ? undefined : onClose}>
      <div className="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
        <header className="shrink-0 border-b border-stone-100 px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-stone-950">{editing ? tr('Изменить публикацию', 'Edit publication') : tr('Опубликовать контент', 'Publish content')}</h3>
              <p className="mt-1 text-xs text-stone-500">{tr(`Шаг ${step} из 3 — ${stepLabels[step - 1]}`, `Step ${step} of 3 — ${stepLabels[step - 1]}`)}</p>
            </div>
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl p-2 text-stone-400 hover:bg-stone-50 disabled:opacity-40"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {stepLabels.map((label, index) => {
              const number = index + 1;
              const done = step > number;
              const active = step === number;
              return (
                <button key={label} type="button" onClick={() => { if (number < step || (number === 2 && canLeaveStepOne) || (number === 3 && canLeaveStepOne)) setStep(number as 1 | 2 | 3); }} className="min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done || active ? 'bg-stone-950 text-white' : 'bg-stone-100 text-stone-400'}`}>{done ? <Check className="h-3.5 w-3.5" /> : number}</span>
                    <div className={`h-px flex-1 ${done ? 'bg-stone-800' : 'bg-stone-200'}`} />
                  </div>
                  <div className={`mt-1 truncate text-[9px] font-semibold sm:text-[10px] ${active ? 'text-stone-900' : 'text-stone-400'}`}>{label}</div>
                </button>
              );
            })}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {step === 1 && (
            <div className="space-y-5">
              <section>
                <div className="mb-2 text-xs font-bold text-stone-800">{tr(editing ? 'Платформа' : 'Выберите платформы', editing ? 'Platform' : 'Select platforms')}</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {PLATFORMS.map(platform => {
                    const chosen = selected.includes(platform);
                    const ready = platform === 'youtube';
                    return (
                      <button
                        key={platform}
                        type="button"
                        disabled={editing}
                        onClick={() => togglePlatform(platform)}
                        className={`relative rounded-2xl border p-4 text-left transition disabled:cursor-default ${chosen ? 'border-emerald-400 bg-emerald-50/50 ring-1 ring-emerald-100' : 'border-stone-200 bg-white hover:border-stone-300'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <PlatformIcon platform={platform} className="h-6 w-6" />
                          {chosen && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-950 text-white"><Check className="h-3 w-3" /></span>}
                        </div>
                        <div className="mt-3 text-sm font-bold text-stone-900">{platformName(platform)}</div>
                        <div className={`mt-2 inline-flex rounded-full px-2 py-1 text-[9px] font-bold ${ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {ready ? (youtubeConnected ? tr('ПОДКЛЮЧЕН', 'CONNECTED') : tr('ГОТОВО К API', 'API READY')) : tr('СКОРО', 'COMING SOON')}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {selected.includes('youtube') && !youtubeConnected && (
                <section className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <PlatformIcon platform="youtube" className="h-6 w-6" />
                    <div><div className="text-sm font-bold text-stone-900">YouTube</div><div className="text-xs text-stone-500">{tr('Подключение нужно только для фактической загрузки.', 'Connection is required for the actual upload.')}</div></div>
                  </div>
                  <button type="button" onClick={() => void connectYouTube()} disabled={connectBusy} className="h-10 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
                    {connectBusy ? tr('Подключение…', 'Connecting…') : tr('Подключить YouTube', 'Connect YouTube')}
                  </button>
                </section>
              )}

              <section className="grid gap-4 lg:grid-cols-2">
                <label className="block rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <span className="flex items-center gap-2 text-xs font-bold text-stone-800"><Upload className="h-4 w-4" /> {tr('Видеофайл', 'Video file')} {!editing && <span className="text-rose-500">*</span>}</span>
                  <input type="file" accept="video/*" onChange={event => setFile(event.target.files?.[0] || null)} className="mt-3 block w-full text-xs text-stone-500 file:mr-3 file:rounded-xl file:border-0 file:bg-stone-950 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white" />
                  {(file || initialPublication?.mediaName) && (
                    <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-stone-100">
                      {videoPreview ? <video src={videoPreview} muted className="h-14 w-20 rounded-lg object-cover" /> : <div className="flex h-14 w-20 items-center justify-center rounded-lg bg-stone-100"><Upload className="h-5 w-5 text-stone-400" /></div>}
                      <div className="min-w-0"><div className="truncate text-xs font-bold text-stone-800">{file?.name || initialPublication?.mediaName}</div><div className="mt-1 text-[10px] text-stone-400">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : tr('Сохранённый файл', 'Existing media')}</div></div>
                    </div>
                  )}
                </label>

                <label className="block rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <span className="flex items-center gap-2 text-xs font-bold text-stone-800"><ImageIcon className="h-4 w-4" /> {tr('Обложка / Thumbnail', 'Cover / Thumbnail')} <span className="font-normal text-stone-400">{tr('необязательно', 'optional')}</span></span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setThumbnailFile(event.target.files?.[0] || null)} className="mt-3 block w-full text-xs text-stone-500 file:mr-3 file:rounded-xl file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-stone-700" />
                  {(thumbnailPreview || script.thumbnail || initialPublication?.thumbnailName) && (
                    <div className="mt-3 flex items-center gap-3">
                      {thumbnailPreview || script.thumbnail ? <img src={thumbnailPreview || script.thumbnail} alt="" className="h-16 w-28 rounded-lg object-cover" /> : <div className="flex h-16 w-28 items-center justify-center rounded-lg bg-white"><ImageIcon className="h-5 w-5 text-stone-300" /></div>}
                      <div className="text-[10px] leading-4 text-stone-400">1280 × 720 (16:9)<br />JPG, PNG, WebP</div>
                    </div>
                  )}
                </label>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {selected.length > 1 && (
                <div className="flex gap-1 overflow-x-auto rounded-2xl bg-stone-100 p-1">
                  <button type="button" onClick={() => setActiveContentTab('base')} className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ${activeContentTab === 'base' ? 'bg-white text-stone-950 shadow-sm' : 'text-stone-500'}`}><Sparkles className="mr-1 inline h-3.5 w-3.5" /> {tr('Основа', 'Base')}</button>
                  {selected.map(platform => (
                    <button key={platform} type="button" onClick={() => setActiveContentTab(platform)} className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ${activeContentTab === platform ? 'bg-white text-stone-950 shadow-sm' : 'text-stone-500'}`}>
                      <PlatformIcon platform={platform} className="h-4 w-4" /> {platformName(platform)}
                    </button>
                  ))}
                </div>
              )}

              {(selected.length > 1 && activeContentTab === 'base') ? (
                <section className="rounded-2xl border border-stone-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div><div className="text-sm font-bold text-stone-900">{tr('Общий текст', 'Base content')}</div><div className="mt-1 text-[11px] text-stone-400">{tr('Используйте как основу и адаптируйте только нужные платформы.', 'Use this as the base and customize only the platforms that need it.')}</div></div>
                    <button type="button" onClick={() => void generateMetadata('base')} disabled={metadataBusy} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 text-[10px] font-bold text-violet-700 disabled:opacity-50">
                      {metadataBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {tr('Сгенерировать', 'Generate')}
                    </button>
                  </div>
                  <textarea value={baseText} onChange={event => setBaseText(event.target.value)} placeholder={tr('Напишите общий текст публикации или сгенерируйте его.', 'Write the common publishing copy or generate it.')} className="mt-3 min-h-40 w-full rounded-2xl border border-stone-200 p-3 text-sm leading-5 outline-none focus:border-emerald-400" />
                </section>
              ) : (() => {
                const platform = (selected.length === 1 ? selected[0] : activeContentTab) as PublicationPlatform;
                const draft = drafts[platform];
                const copy = visibleText(platform);
                return (
                  <section className="rounded-2xl border border-stone-200 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2"><PlatformIcon platform={platform} className="h-5 w-5" /><div className="text-sm font-bold text-stone-900">{platformName(platform)}</div></div>
                      {selected.length > 1 && (
                        <label className="inline-flex items-center gap-2 text-[11px] font-medium text-stone-500">
                          <input type="checkbox" checked={draft.useBase} onChange={event => updateDraft(platform, { useBase: event.target.checked })} />
                          {tr('Использовать основу', 'Use base text')}
                        </label>
                      )}
                    </div>

                    {platform === 'youtube' && (
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-stone-600">{tr('Заголовок', 'Title')}</span>
                        <input value={draft.title} maxLength={100} onChange={event => updateDraft('youtube', { title: event.target.value })} className="h-11 w-full rounded-xl border border-stone-200 px-3 text-sm outline-none focus:border-emerald-400" />
                        <div className="mt-1 text-right text-[10px] text-stone-400">{draft.title.length}/100</div>
                      </label>
                    )}

                    <label className="mt-3 block">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-stone-600">{platform === 'youtube' ? tr('Описание', 'Description') : tr('Подпись', 'Caption')}</span>
                        <button type="button" onClick={() => void generateMetadata(platform)} disabled={metadataBusy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[10px] font-bold text-violet-700 disabled:opacity-50">
                          {metadataBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {tr('Адаптировать AI', 'Adapt with AI')}
                        </button>
                      </div>
                      <textarea
                        value={copy}
                        onChange={event => updateDraft(platform, { description: event.target.value, useBase: false })}
                        placeholder={tr('Пусто по умолчанию. Напишите вручную или сгенерируйте AI.', 'Empty by default. Write it yourself or generate with AI.')}
                        className="min-h-36 w-full rounded-2xl border border-stone-200 p-3 text-sm leading-5 outline-none focus:border-emerald-400"
                      />
                    </label>

                    {platform === 'youtube' && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-stone-600">{tr('Видимость', 'Visibility')}</span>
                          <CustomSelect
                            value={privacy}
                            onChange={setPrivacy}
                            ariaLabel={tr('Видимость YouTube', 'YouTube visibility')}
                            options={[
                              { value: 'public', label: tr('Публичное', 'Public') },
                              { value: 'unlisted', label: tr('По ссылке', 'Unlisted') },
                              { value: 'private', label: tr('Приватное', 'Private') },
                            ]}
                          />
                        </label>
                        <div className="space-y-2 pt-5 text-xs text-stone-600">
                          <label className="flex items-center gap-2"><input type="checkbox" checked={madeForKids} onChange={event => setMadeForKids(event.target.checked)} /> {tr('Для детей', 'Made for kids')}</label>
                          <label className="flex items-center gap-2"><input type="checkbox" checked={synthetic} onChange={event => setSynthetic(event.target.checked)} /> {tr('Содержит AI-контент', 'Contains AI-generated content')}</label>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })()}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-stone-200 p-4">
                <div className="text-sm font-bold text-stone-900">{tr('Дата и время', 'Schedule')}</div>
                {selected.length > 1 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => setSameTime(true)} className={`rounded-xl border p-3 text-left ${sameTime ? 'border-stone-950 bg-stone-50' : 'border-stone-200'}`}>
                      <div className="text-xs font-bold">{tr('Одно время для всех', 'Same date & time for all')}</div>
                      <div className="mt-1 text-[10px] text-stone-400">{tr('Все выбранные платформы публикуются одновременно.', 'All selected platforms use one schedule.')}</div>
                    </button>
                    <button type="button" onClick={() => setSameTime(false)} className={`rounded-xl border p-3 text-left ${!sameTime ? 'border-stone-950 bg-stone-50' : 'border-stone-200'}`}>
                      <div className="text-xs font-bold">{tr('Отдельно для платформ', 'Set per platform')}</div>
                      <div className="mt-1 text-[10px] text-stone-400">{tr('Задайте своё время каждой платформе.', 'Choose an individual time for each platform.')}</div>
                    </button>
                  </div>
                )}

                {sameTime || selected.length === 1 ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label><span className="mb-1 block text-xs font-semibold text-stone-600">{tr('Дата', 'Date')}</span><div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" /><input type="date" value={commonSchedule.date} onChange={event => setCommonSchedule(current => ({ ...current, date: event.target.value }))} className="h-11 w-full rounded-xl border border-stone-200 pl-9 pr-3 text-sm" /></div></label>
                    <label><span className="mb-1 block text-xs font-semibold text-stone-600">{tr('Время', 'Time')}</span><div className="relative"><Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" /><input type="time" value={commonSchedule.time} onChange={event => setCommonSchedule(current => ({ ...current, time: event.target.value }))} className="h-11 w-full rounded-xl border border-stone-200 pl-9 pr-3 text-sm" /></div></label>
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    {selected.map(platform => (
                      <div key={platform} className="grid items-end gap-2 rounded-xl bg-stone-50 p-3 sm:grid-cols-[140px_1fr_1fr]">
                        <div className="flex h-11 items-center gap-2 text-xs font-bold"><PlatformIcon platform={platform} /> {platformName(platform)}</div>
                        <label><span className="mb-1 block text-[10px] text-stone-400">{tr('Дата', 'Date')}</span><input type="date" value={platformSchedules[platform].date} onChange={event => setPlatformSchedules(current => ({ ...current, [platform]: { ...current[platform], date: event.target.value } }))} className="h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs" /></label>
                        <label><span className="mb-1 block text-[10px] text-stone-400">{tr('Время', 'Time')}</span><input type="time" value={platformSchedules[platform].time} onChange={event => setPlatformSchedules(current => ({ ...current, [platform]: { ...current[platform], time: event.target.value } }))} className="h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs" /></label>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 text-[10px] text-stone-400">{tr('Часовой пояс', 'Time zone')}: {timezone}</div>
              </section>

              <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="text-xs font-bold text-stone-900">{editing ? tr('Изменения публикации', 'Publication changes') : tr(`Готово: ${selected.length} площадок`, `Ready for ${selected.length} platform(s)`)}</div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-16 w-24 overflow-hidden rounded-xl bg-white">
                    {thumbnailPreview || script.thumbnail ? <img src={thumbnailPreview || script.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center"><ImageIcon className="h-5 w-5 text-stone-300" /></div>}
                  </div>
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-bold text-stone-900">{script.ideaTitle || script.title}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">{selected.map(platform => <PlatformIcon key={platform} platform={platform} className="h-4 w-4" />)}<span className="text-[10px] text-stone-400">{selectedLabel}</span></div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {(error || success) && <div className="mt-4">{error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />{success}</div>}</div>}
        </main>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-stone-100 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => step === 1 ? onClose() : setStep((step - 1) as 1 | 2)} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-600 disabled:opacity-40">
            {step > 1 && <ArrowLeft className="h-3.5 w-3.5" />} {step === 1 ? tr('Отмена', 'Cancel') : tr('Назад', 'Back')}
          </button>
          {step < 3 ? (
            <button type="button" disabled={step === 1 && !canLeaveStepOne} onClick={() => setStep((step + 1) as 2 | 3)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white disabled:opacity-40">
              {tr('Далее', 'Next')} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button type="button" disabled={busy || metadataBusy} onClick={() => void submit()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-stone-950 px-4 text-xs font-semibold text-white disabled:opacity-40">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? tr('Сохранить изменения', 'Save changes') : selected.length > 1 ? tr(`Опубликовать / сохранить план (${selected.length})`, `Publish / save plan (${selected.length})`) : tr('Опубликовать', 'Publish')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};
