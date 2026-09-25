import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, CheckCircle2, Clock3, ExternalLink, Image as ImageIcon, Loader2, Sparkles, Upload, X } from 'lucide-react';
import { GeneratedScript, PublicationJob, PublicationPlatform, type TikTokCreatorInfo } from '../types';
import { authFetch } from '../services/authFetch';
import { getConnectedYouTubeChannel, publishVideoToYouTube, connectYouTubePublishing, type YouTubeChannelIdentity } from '../services/youtubePublishingService';
import { PlatformIcon } from './PlatformIcon';
import { CustomSelect } from './CustomSelect';
import { useIntegrationState } from '../hooks/useIntegrationState';
import { useI18n } from '../i18n';
import { MAX_TEMP_PUBLICATION_ASSET_MB, assertTemporaryPublicationMedia } from '../utils/publicationMedia';
import { connectSocialPlatform, getTikTokCreatorInfo, uploadPublicationAsset, uploadScriptCover } from '../services/socialIntegrationService';

interface PublicationModalProps {
  script: GeneratedScript;
  onClose: () => void;
  onPublished: () => void | Promise<void>;
  initialPublication?: PublicationJob | null;
  embedded?: boolean;
  onScriptUpdated?: (script: GeneratedScript) => void;
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

export const PublicationModal: React.FC<PublicationModalProps> = ({ script, onClose, onPublished, initialPublication = null, embedded = false, onScriptUpdated }) => {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const editing = Boolean(initialPublication);
  const initialPlatform = initialPublication?.platform;
  const initialSchedule = toLocalParts(initialPublication?.scheduledAt || script.scheduledAt);

  const [selected, setSelected] = useState<PublicationPlatform[]>(initialPlatform ? [initialPlatform] : []);
  const [activeContentTab, setActiveContentTab] = useState<'base' | PublicationPlatform>(initialPlatform || 'base');
  const [file, setFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
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
  const [instagramShareToFeed, setInstagramShareToFeed] = useState(initialPublication?.instagramShareToFeed !== false);
  const [tiktokPrivacyLevel, setTikTokPrivacyLevel] = useState(initialPublication?.tiktokPrivacyLevel || 'SELF_ONLY');
  const [tiktokDisableComment, setTikTokDisableComment] = useState(Boolean(initialPublication?.tiktokDisableComment));
  const [tiktokDisableDuet, setTikTokDisableDuet] = useState(Boolean(initialPublication?.tiktokDisableDuet));
  const [tiktokDisableStitch, setTikTokDisableStitch] = useState(Boolean(initialPublication?.tiktokDisableStitch));
  const [tiktokBrandContent, setTikTokBrandContent] = useState(Boolean(initialPublication?.tiktokBrandContentToggle));
  const [tiktokBrandOrganic, setTikTokBrandOrganic] = useState(Boolean(initialPublication?.tiktokBrandOrganicToggle));
  const [tiktokCreatorInfo, setTikTokCreatorInfo] = useState<TikTokCreatorInfo | null>(null);
  const [youtubeChannel, setYoutubeChannel] = useState<YouTubeChannelIdentity | null>(null);
  const { connected: youtubeConnected, refresh: refreshYoutubeConnection, revision: youtubeRevision } = useIntegrationState('youtube');
  const { connected: instagramConnected, refresh: refreshInstagramConnection } = useIntegrationState('instagram');
  const { connected: tiktokConnected, refresh: refreshTikTokConnection, revision: tiktokRevision } = useIntegrationState('tiktok');
  const [busy, setBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState<'youtube' | 'instagram' | 'tiktok' | null>(null);
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

  const loadJobs = async () => {
    const response = await authFetch('/api/radar/scripts/' + script.id + '/publications');
    const data = response.ok ? await response.json() : { jobs: [] };
    const nextJobs = (data.jobs || []) as PublicationJob[];
    setJobs(nextJobs);

    if (!initialPublication && nextJobs.length) {
      const platforms = Array.from(new Set(nextJobs.map(job => job.platform))) as PublicationPlatform[];
      setSelected(platforms);
      setActiveContentTab(current => current === 'base' || platforms.includes(current as PublicationPlatform) ? current : (platforms[0] || 'base'));
      setDrafts(current => {
        const next = { ...current };
        for (const job of nextJobs) {
          next[job.platform] = {
            ...next[job.platform],
            title: job.platform === 'youtube' ? (job.title || next.youtube.title) : '',
            description: job.description || '',
            useBase: false,
          };
        }
        return next;
      });
      setPlatformSchedules(current => {
        const next = { ...current };
        for (const job of nextJobs) next[job.platform] = toLocalParts(job.scheduledAt);
        return next;
      });
      if (nextJobs.length === 1) setCommonSchedule(toLocalParts(nextJobs[0].scheduledAt));
    }
    return nextJobs;
  };

  useEffect(() => {
    void loadJobs().catch(() => undefined);
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
    if (!tiktokConnected) {
      setTikTokCreatorInfo(null);
      return;
    }
    let active = true;
    void getTikTokCreatorInfo()
      .then(info => {
        if (!active) return;
        setTikTokCreatorInfo(info);
        if (info.privacyLevelOptions.length && !info.privacyLevelOptions.includes(tiktokPrivacyLevel)) {
          setTikTokPrivacyLevel(info.privacyLevelOptions[0]);
        }
      })
      .catch(() => { if (active) setTikTokCreatorInfo(null); });
    return () => { active = false; };
  }, [tiktokConnected, tiktokRevision]);

  useEffect(() => {
    if (!selected.length) {
      setActiveContentTab('base');
      return;
    }
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
    setConnectBusy('youtube');
    setError(null);
    try {
      const channel = await connectYouTubePublishing();
      if (!channel) throw new Error(tr('Канал YouTube не найден', 'YouTube channel not found'));
      setYoutubeChannel(channel);
      await refreshYoutubeConnection();
    } catch (e: any) {
      setError(e?.message || tr('Не удалось подключить YouTube', 'Could not connect YouTube'));
    } finally {
      setConnectBusy(null);
    }
  };

  const connectSocial = async (platform: 'instagram' | 'tiktok') => {
    setConnectBusy(platform);
    setError(null);
    try {
      await connectSocialPlatform(platform);
      if (platform === 'instagram') await refreshInstagramConnection();
      else {
        await refreshTikTokConnection();
        const info = await getTikTokCreatorInfo();
        setTikTokCreatorInfo(info);
        if (info.privacyLevelOptions.length) setTikTokPrivacyLevel(info.privacyLevelOptions[0]);
      }
    } catch (e: any) {
      setError(e?.message || tr('Не удалось подключить платформу', 'Could not connect platform'));
    } finally {
      setConnectBusy(null);
    }
  };

  const chooseThumbnail = async (nextFile: File | null) => {
    setThumbnailFile(nextFile);
    if (!nextFile) return;
    setCoverBusy(true);
    setError(null);
    try {
      const updatedScript = await uploadScriptCover(script.id, nextFile);
      onScriptUpdated?.(updatedScript);
      setSuccess(tr('Обложка сохранена и обновлена во всех разделах.', 'Cover saved and updated across the product.'));
    } catch (e: any) {
      setError(e?.message || tr('Не удалось сохранить обложку', 'Could not save cover'));
    } finally {
      setCoverBusy(false);
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

  const createOrUpdateJob = async (platform: PublicationPlatform, mediaObjectPath?: string, thumbnailObjectPath?: string) => {
    const draft = drafts[platform];
    const payload = {
      scheduledAt: toIso(scheduleFor(platform)),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      mediaName: file?.name || initialPublication?.mediaName,
      mediaType: file?.type || initialPublication?.mediaType,
      mediaSize: file?.size || initialPublication?.mediaSize,
      mediaObjectPath: mediaObjectPath || initialPublication?.mediaObjectPath,
      thumbnailName: thumbnailFile?.name || initialPublication?.thumbnailName,
      thumbnailType: thumbnailFile?.type || initialPublication?.thumbnailType,
      thumbnailObjectPath: thumbnailObjectPath || initialPublication?.thumbnailObjectPath,
      title: platform === 'youtube' ? draft.title.trim() : undefined,
      description: visibleText(platform),
      privacyStatus: platform === 'youtube' ? privacy : undefined,
      madeForKids: platform === 'youtube' ? madeForKids : undefined,
      containsSyntheticMedia: platform === 'youtube' || platform === 'tiktok' ? synthetic : undefined,
      instagramShareToFeed: platform === 'instagram' ? instagramShareToFeed : undefined,
      tiktokPrivacyLevel: platform === 'tiktok' ? tiktokPrivacyLevel : undefined,
      tiktokDisableComment: platform === 'tiktok' ? tiktokDisableComment : undefined,
      tiktokDisableDuet: platform === 'tiktok' ? tiktokDisableDuet : undefined,
      tiktokDisableStitch: platform === 'tiktok' ? tiktokDisableStitch : undefined,
      tiktokBrandContentToggle: platform === 'tiktok' ? tiktokBrandContent : undefined,
      tiktokBrandOrganicToggle: platform === 'tiktok' ? tiktokBrandOrganic : undefined,
    };

    const existingJob = initialPublication?.platform === platform
      ? initialPublication
      : jobs.find(job => job.platform === platform);

    if (existingJob) {
      const response = await authFetch('/api/publications/' + existingJob.id, {
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
      return;
    }

    if (!editing && selected.includes('youtube') && !youtubeConnected) {
      setError(tr('Подключите YouTube перед публикацией', 'Connect YouTube before publishing'));
      return;
    }
    if (selected.includes('instagram') && !instagramConnected) {
      setError(tr('Подключите Instagram перед публикацией', 'Connect Instagram before publishing'));
      return;
    }
    if (selected.includes('tiktok') && !tiktokConnected) {
      setError(tr('Подключите TikTok перед публикацией', 'Connect TikTok before publishing'));
      return;
    }

    if (file && selected.some(platform => platform !== 'youtube')) {
      try {
        assertTemporaryPublicationMedia(file);
      } catch (validationError: any) {
        setError(validationError?.code === 'PUBLICATION_MEDIA_TOO_LARGE'
          ? tr(`Для Instagram/TikTok максимальный размер временного файла — ${MAX_TEMP_PUBLICATION_ASSET_MB} МБ.`, `Temporary Instagram/TikTok files are limited to ${MAX_TEMP_PUBLICATION_ASSET_MB} MB.`)
          : tr('Поддерживаются видеофайлы.', 'A video file is required.'));
          return;
      }
    }

    setBusy(true);
    try {
      let mediaObjectPath = initialPublication?.mediaObjectPath;
      let thumbnailObjectPath = initialPublication?.thumbnailObjectPath;
      if (file && selected.some(platform => platform === 'instagram' || platform === 'tiktok')) {
        mediaObjectPath = await uploadPublicationAsset(file, 'video');
      }
      if (thumbnailFile && selected.some(platform => platform === 'instagram' || platform === 'tiktok')) {
        thumbnailObjectPath = await uploadPublicationAsset(thumbnailFile, 'thumbnail');
      }

      const processed: PublicationJob[] = [];
      for (const platform of selected) {
        let job = await createOrUpdateJob(platform, mediaObjectPath, thumbnailObjectPath);

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

        if ((platform === 'instagram' || platform === 'tiktok') && !editing) {
          const scheduledAt = toIso(scheduleFor(platform));
          const future = Boolean(scheduledAt && new Date(scheduledAt).getTime() > Date.now());
          if (future) {
            job = await updateJob(job.id, { status: 'queued' });
          } else {
            const response = await authFetch('/api/publications/' + job.id + '/publish-social', { method: 'POST' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'SOCIAL_PUBLISH_FAILED');
            job = data.job as PublicationJob;
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
        : tr('Публикация отправлена на выбранные платформы или поставлена в расписание.', 'The publication was sent to the selected platforms or added to the schedule.'));
      await loadJobs();
      await onPublished();
    } catch (e: any) {
      setError(e?.message || tr('Не удалось сохранить публикацию', 'Could not save publication'));
    } finally {
      setBusy(false);
    }
  };

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const jobStatusLabel = (job: PublicationJob) => {
    if (job.status === 'published') return tr('Опубликовано', 'Published');
    if (job.status === 'processing') return tr('Обрабатывается платформой', 'Processing on platform');
    if (job.status === 'uploading') return tr('Загрузка видео', 'Uploading video');
    if (job.status === 'queued') return tr('Запланировано', 'Scheduled');
    if (job.status === 'failed') return tr('Ошибка публикации', 'Publish failed');
    return tr('Черновик', 'Draft');
  };

  const jobStatusClass = (job: PublicationJob) =>
    job.status === 'published'
      ? 'bg-emerald-50 text-emerald-700'
      : job.status === 'failed'
        ? 'bg-rose-50 text-rose-700'
        : job.status === 'processing' || job.status === 'uploading'
          ? 'bg-amber-50 text-amber-700'
          : job.status === 'queued'
            ? 'bg-indigo-50 text-indigo-700'
            : 'bg-stone-100 text-stone-600';

  const primaryActionLabel = (() => {
    const scheduled = selected.some(platform => Boolean(toIso(scheduleFor(platform))));
    if (busy) return tr('Публикуем…', 'Publishing…');
    if (editing) return tr('Сохранить изменения', 'Save changes');
    if (scheduled) return tr('Запланировать', 'Schedule');
    return tr('Опубликовать сейчас', 'Publish now');
  })();

  const activePlatform = selected.length === 1
    ? selected[0]
    : activeContentTab === 'base'
      ? null
      : activeContentTab as PublicationPlatform;

  return (
    <div
      className={embedded ? 'w-full' : 'fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 sm:p-4'}
      onMouseDown={!embedded && !busy ? onClose : undefined}
    >
      <div
        className={embedded
          ? 'w-full rounded-2xl border border-stone-200 bg-white'
          : 'max-h-[96vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white shadow-2xl'}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-stone-100 px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-lg font-bold text-stone-950">{editing ? tr('Настройки публикации', 'Publication settings') : tr('Публикация', 'Publication')}</h3>
            <p className="mt-1 text-[11px] text-stone-500">{tr('Платформы, медиа, текст и время — на одном экране.', 'Platforms, media, copy and schedule in one place.')}</p>
          </div>
          {!embedded && <button type="button" onClick={onClose} disabled={busy} className="rounded-xl p-2 text-stone-400 hover:bg-stone-50 disabled:opacity-40"><X className="h-4 w-4" /></button>}
        </header>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {jobs.length > 0 && (
            <section className="rounded-2xl border border-stone-200 bg-stone-50/60 p-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-stone-400">{tr('Публикации', 'Publications')}</div>
              <div className="flex flex-wrap gap-2">
                {jobs.map(job => (
                  <div key={job.id} className="flex min-w-[190px] items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2">
                    <PlatformIcon platform={job.platform} className="h-4 w-4" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-stone-800">{platformName(job.platform)}</div>
                      <div className={'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold ' + jobStatusClass(job)}>{jobStatusLabel(job)}</div>
                    </div>
                    {job.remoteUrl && <a href={job.remoteUrl} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-50 hover:text-emerald-700" title={tr('Открыть публикацию', 'Open publication')}><ExternalLink className="h-3.5 w-3.5" /></a>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs font-bold text-stone-800">{tr('Платформы', 'Platforms')}</div>
              <div className="text-[10px] text-stone-400">{tr('Можно выбрать несколько', 'Select one or more')}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(platform => {
                const chosen = selected.includes(platform);
                const connected = platform === 'youtube' ? youtubeConnected : platform === 'instagram' ? instagramConnected : tiktokConnected;
                return (
                  <button
                    key={platform}
                    type="button"
                    disabled={editing}
                    onClick={() => togglePlatform(platform)}
                    className={'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition disabled:cursor-default ' + (chosen ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300')}
                  >
                    <PlatformIcon platform={platform} className="h-4 w-4" />
                    {platformName(platform)}
                    <span className={'h-1.5 w-1.5 rounded-full ' + (connected ? 'bg-emerald-500' : 'bg-stone-300')} />
                    {chosen && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          </section>

          {selected.some(platform => {
            if (platform === 'youtube') return !youtubeConnected;
            if (platform === 'instagram') return !instagramConnected;
            return !tiktokConnected;
          }) && (
            <section className="flex flex-wrap gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              {selected.includes('youtube') && !youtubeConnected && <button type="button" onClick={() => void connectYouTube()} disabled={connectBusy !== null} className="h-9 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{connectBusy === 'youtube' ? tr('Подключение…', 'Connecting…') : tr('Подключить YouTube', 'Connect YouTube')}</button>}
              {selected.includes('instagram') && !instagramConnected && <button type="button" onClick={() => void connectSocial('instagram')} disabled={connectBusy !== null} className="h-9 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{connectBusy === 'instagram' ? tr('Подключение…', 'Connecting…') : tr('Подключить Instagram', 'Connect Instagram')}</button>}
              {selected.includes('tiktok') && !tiktokConnected && <button type="button" onClick={() => void connectSocial('tiktok')} disabled={connectBusy !== null} className="h-9 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{connectBusy === 'tiktok' ? tr('Подключение…', 'Connecting…') : tr('Подключить TikTok', 'Connect TikTok')}</button>}
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="space-y-3">
              <div className="text-xs font-bold text-stone-800">{tr('Медиа', 'Media')}</div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <label className="block rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <span className="flex items-center gap-2 text-xs font-bold text-stone-800"><Upload className="h-4 w-4" /> {tr('Видео', 'Video')} {!editing && <span className="text-rose-500">*</span>}</span>
                  <input type="file" accept="video/*" onChange={event => setFile(event.target.files?.[0] || null)} className="mt-2 block w-full text-[11px] text-stone-500 file:mr-2 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-2.5 file:py-2 file:text-[11px] file:font-semibold file:text-white" />
                  {(file || initialPublication?.mediaName) && <div className="mt-2 truncate text-[10px] text-stone-500">{file?.name || initialPublication?.mediaName}</div>}
                </label>

                <label className="block rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <span className="flex items-center gap-2 text-xs font-bold text-stone-800"><ImageIcon className="h-4 w-4" /> {tr('Обложка', 'Cover')} <span className="font-normal text-stone-400">{tr('необязательно', 'optional')}</span></span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void chooseThumbnail(event.target.files?.[0] || null)} className="mt-2 block w-full text-[11px] text-stone-500 file:mr-2 file:rounded-lg file:border-0 file:bg-white file:px-2.5 file:py-2 file:text-[11px] file:font-semibold file:text-stone-700" />
                  {(thumbnailPreview || script.thumbnail) && <img src={thumbnailPreview || script.thumbnail} alt="" className="mt-2 aspect-video w-28 rounded-lg object-cover" />}
                  {coverBusy && <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-700"><Loader2 className="h-3 w-3 animate-spin" />{tr('Сохраняем обложку…', 'Saving cover…')}</div>}
                </label>
              </div>

              <div className="rounded-xl border border-stone-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-stone-800">{tr('Дата и время', 'Schedule')}</div>
                  <div className="text-[9px] text-stone-400">{timezone}</div>
                </div>
                {selected.length > 1 && (
                  <div className="mb-2 flex gap-1 rounded-lg bg-stone-100 p-1">
                    <button type="button" onClick={() => setSameTime(true)} className={'flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold ' + (sameTime ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-500')}>{tr('Одно время', 'Same time')}</button>
                    <button type="button" onClick={() => setSameTime(false)} className={'flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold ' + (!sameTime ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-500')}>{tr('По платформам', 'Per platform')}</button>
                  </div>
                )}
                {sameTime || selected.length <= 1 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label><span className="mb-1 block text-[10px] font-semibold text-stone-500">{tr('Дата', 'Date')}</span><div className="relative"><CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" /><input type="date" value={commonSchedule.date} onChange={event => setCommonSchedule(current => ({ ...current, date: event.target.value }))} className="h-9 w-full rounded-lg border border-stone-200 pl-8 pr-2 text-xs" /></div></label>
                    <label><span className="mb-1 block text-[10px] font-semibold text-stone-500">{tr('Время', 'Time')}</span><div className="relative"><Clock3 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" /><input type="time" value={commonSchedule.time} onChange={event => setCommonSchedule(current => ({ ...current, time: event.target.value }))} className="h-9 w-full rounded-lg border border-stone-200 pl-8 pr-2 text-xs" /></div></label>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selected.map(platform => (
                      <div key={platform} className="grid grid-cols-[86px_1fr_1fr] items-end gap-2">
                        <div className="flex h-9 items-center gap-1.5 text-[10px] font-bold"><PlatformIcon platform={platform} className="h-3.5 w-3.5" />{platformName(platform)}</div>
                        <input type="date" value={platformSchedules[platform].date} onChange={event => setPlatformSchedules(current => ({ ...current, [platform]: { ...current[platform], date: event.target.value } }))} className="h-9 rounded-lg border border-stone-200 px-2 text-[10px]" />
                        <input type="time" value={platformSchedules[platform].time} onChange={event => setPlatformSchedules(current => ({ ...current, [platform]: { ...current[platform], time: event.target.value } }))} className="h-9 rounded-lg border border-stone-200 px-2 text-[10px]" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-bold text-stone-800">{tr('Текст и настройки', 'Copy & settings')}</div>
                {selected.length > 1 && <div className="flex gap-1 overflow-x-auto rounded-lg bg-stone-100 p-1">
                  <button type="button" onClick={() => setActiveContentTab('base')} className={'shrink-0 rounded-md px-2 py-1.5 text-[10px] font-semibold ' + (activeContentTab === 'base' ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-500')}>{tr('Основа', 'Base')}</button>
                  {selected.map(platform => <button key={platform} type="button" onClick={() => setActiveContentTab(platform)} className={'flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold ' + (activeContentTab === platform ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-500')}><PlatformIcon platform={platform} className="h-3.5 w-3.5" />{platformName(platform)}</button>)}
                </div>}
              </div>

              {!selected.length ? (
                <div className="flex min-h-[300px] items-center justify-center rounded-xl border border-dashed border-stone-200 bg-stone-50 px-6 text-center text-xs text-stone-400">{tr('Выберите хотя бы одну платформу.', 'Select at least one platform.')}</div>
              ) : selected.length > 1 && activeContentTab === 'base' ? (
                <div className="rounded-xl border border-stone-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-stone-800">{tr('Общий текст', 'Base content')}</div>
                    <button type="button" onClick={() => void generateMetadata('base')} disabled={metadataBusy} className="inline-flex h-8 items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[10px] font-bold text-violet-700 disabled:opacity-50">{metadataBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{tr('Сгенерировать', 'Generate')}</button>
                  </div>
                  <textarea value={baseText} onChange={event => setBaseText(event.target.value)} className="mt-2 min-h-44 w-full rounded-xl border border-stone-200 p-3 text-sm leading-5 outline-none focus:border-emerald-400" placeholder={tr('Общий текст публикации', 'Shared publication copy')} />
                </div>
              ) : activePlatform ? (() => {
                const platform = activePlatform;
                const draft = drafts[platform];
                const copy = visibleText(platform);
                return (
                  <div className="rounded-xl border border-stone-200 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-stone-800"><PlatformIcon platform={platform} className="h-4 w-4" />{platformName(platform)}</div>
                      {selected.length > 1 && <label className="inline-flex items-center gap-1.5 text-[10px] text-stone-500"><input type="checkbox" checked={draft.useBase} onChange={event => updateDraft(platform, { useBase: event.target.checked })} />{tr('Использовать основу', 'Use base')}</label>}
                    </div>

                    {platform === 'youtube' && <label className="block"><span className="mb-1 block text-[10px] font-semibold text-stone-500">{tr('Заголовок', 'Title')}</span><input value={draft.title} maxLength={100} onChange={event => updateDraft('youtube', { title: event.target.value })} className="h-9 w-full rounded-lg border border-stone-200 px-3 text-xs outline-none focus:border-emerald-400" /></label>}

                    <label className="mt-2 block">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold text-stone-500">{platform === 'youtube' ? tr('Описание', 'Description') : tr('Подпись', 'Caption')}</span>
                        <button type="button" onClick={() => void generateMetadata(platform)} disabled={metadataBusy} className="inline-flex h-7 items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 text-[9px] font-bold text-violet-700 disabled:opacity-50">{metadataBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}{tr('Адаптировать AI', 'Adapt with AI')}</button>
                      </div>
                      <textarea value={copy} onChange={event => updateDraft(platform, { description: event.target.value, useBase: false })} maxLength={platform === 'youtube' ? 5000 : 2200} className="min-h-32 w-full rounded-xl border border-stone-200 p-3 text-xs leading-5 outline-none focus:border-emerald-400" placeholder={tr('Напишите текст публикации', 'Write publication copy')} />
                    </label>

                    {platform === 'youtube' && <div className="mt-2 grid gap-2 sm:grid-cols-2"><CustomSelect value={privacy} onChange={setPrivacy} ariaLabel={tr('Видимость YouTube', 'YouTube visibility')} options={[{ value: 'public', label: tr('Публичное', 'Public') },{ value: 'unlisted', label: tr('По ссылке', 'Unlisted') },{ value: 'private', label: tr('Приватное', 'Private') }]} /><div className="space-y-1.5 text-[10px] text-stone-600"><label className="flex items-center gap-1.5"><input type="checkbox" checked={madeForKids} onChange={event => setMadeForKids(event.target.checked)} />{tr('Для детей', 'Made for kids')}</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={synthetic} onChange={event => setSynthetic(event.target.checked)} />{tr('AI-контент', 'AI-generated')}</label></div></div>}

                    {platform === 'instagram' && <label className="mt-2 flex items-center gap-2 rounded-lg bg-stone-50 p-2.5 text-[10px] text-stone-600"><input type="checkbox" checked={instagramShareToFeed} onChange={event => setInstagramShareToFeed(event.target.checked)} />{tr('Показывать Reel в основной ленте', 'Show Reel in main feed')}</label>}

                    {platform === 'tiktok' && <div className="mt-2 grid gap-2 sm:grid-cols-2"><CustomSelect value={tiktokPrivacyLevel} onChange={setTikTokPrivacyLevel} ariaLabel={tr('Приватность TikTok', 'TikTok privacy')} disabled={!tiktokCreatorInfo?.privacyLevelOptions?.length} options={(tiktokCreatorInfo?.privacyLevelOptions?.length ? tiktokCreatorInfo.privacyLevelOptions : ['SELF_ONLY']).map(value => ({ value, label: value === 'PUBLIC_TO_EVERYONE' ? tr('Все', 'Everyone') : value === 'FOLLOWER_OF_CREATOR' ? tr('Подписчики', 'Followers') : value === 'MUTUAL_FOLLOW_FRIENDS' ? tr('Друзья', 'Friends') : tr('Только я', 'Only me') }))} /><div className="grid gap-1 text-[10px] text-stone-600"><label className="flex items-center gap-1.5"><input type="checkbox" checked={tiktokDisableComment} disabled={Boolean(tiktokCreatorInfo?.commentDisabled)} onChange={event => setTikTokDisableComment(event.target.checked)} />{tr('Отключить комментарии', 'Disable comments')}</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={tiktokDisableDuet} disabled={Boolean(tiktokCreatorInfo?.duetDisabled)} onChange={event => setTikTokDisableDuet(event.target.checked)} />{tr('Отключить Duet', 'Disable Duet')}</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={tiktokDisableStitch} disabled={Boolean(tiktokCreatorInfo?.stitchDisabled)} onChange={event => setTikTokDisableStitch(event.target.checked)} />{tr('Отключить Stitch', 'Disable Stitch')}</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={synthetic} onChange={event => setSynthetic(event.target.checked)} />{tr('AI-контент', 'AI-generated')}</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={tiktokBrandContent} onChange={event => setTikTokBrandContent(event.target.checked)} />{tr('Платное партнёрство', 'Paid partnership')}</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={tiktokBrandOrganic} onChange={event => setTikTokBrandOrganic(event.target.checked)} />{tr('Продвигает мой бизнес', 'Promotes my business')}</label></div></div>}
                  </div>
                );
              })() : null}
            </section>
          </div>

          {(error || success) && <div>{error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700"><div className="font-bold">{tr('Не удалось выполнить публикацию', 'Could not complete publication')}</div><div className="mt-1">{error}</div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void submit()} disabled={busy} className="h-8 rounded-lg border border-rose-200 bg-white px-3 text-[10px] font-semibold text-rose-700">{tr('Повторить', 'Retry')}</button>{selected.includes('youtube') && !youtubeConnected && <button type="button" onClick={() => void connectYouTube()} className="h-8 rounded-lg bg-emerald-600 px-3 text-[10px] font-semibold text-white">{tr('Переподключить YouTube', 'Reconnect YouTube')}</button>}</div></div> : <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />{success}</div>}</div>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-stone-100 bg-white px-4 py-3 sm:px-5">
          {!embedded && <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-xl border border-stone-200 px-4 text-xs font-semibold text-stone-600 disabled:opacity-40">{tr('Отмена', 'Cancel')}</button>}
          <button type="button" disabled={busy || metadataBusy || coverBusy || !selected.length || (!editing && !file)} onClick={() => void submit()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {primaryActionLabel}
          </button>
        </footer>
      </div>
    </div>
  );
};
