import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Brain,
  Check,
  CheckCircle2,
  Link2,
  Loader2,
  Plus,
  Radio,
  Sparkles,
  X,
  Youtube,
} from 'lucide-react';
import { authFetch } from '../services/authFetch';
import { useI18n } from '../i18n';

interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChannelAdded: () => void;
  onVideoAdded: () => void;
}

function extractYouTubeVideoId(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) return url.pathname.split('/').filter(Boolean)[0] || null;
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] || null;
      return url.searchParams.get('v');
    }
  } catch {}
  return /^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : null;
}

export const AddSourceModal: React.FC<AddSourceModalProps> = ({
  isOpen,
  onClose,
  onChannelAdded,
  onVideoAdded,
}) => {
  const { locale } = useI18n();
  const tr = (ru: string, en: string) => locale === 'ru' ? ru : en;

  const [mode, setMode] = useState<'video' | 'channel'>('video');
  const [channelInput, setChannelInput] = useState('');
  const [videoInput, setVideoInput] = useState('');
  const [learnFromThis, setLearnFromThis] = useState(true);
  const [analyzeForIdeas, setAnalyzeForIdeas] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const videoId = useMemo(() => extractYouTubeVideoId(videoInput), [videoInput]);
  const videoThumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;

  if (!isOpen) return null;

  const resetFeedback = () => {
    setError(null);
    setSuccessMessage(null);
  };

  const closeAfterSuccess = () => {
    window.setTimeout(() => {
      setSuccessMessage(null);
      onClose();
    }, 1100);
  };

  const handleAddVideo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!videoInput.trim() || (!learnFromThis && !analyzeForIdeas)) return;

    setLoading(true);
    resetFeedback();
    try {
      const response = await authFetch('/api/radar/references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: videoInput.trim(),
          intent: 'more_like_this',
          learnFromThis,
          analyzeForIdeas,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr('Не удалось добавить видео', 'Could not add video'));

      const title = data?.reference?.title ? ` “${data.reference.title}”` : '';
      setSuccessMessage(
        analyzeForIdeas
          ? tr(`Видео${title} добавлено. Анализ идей поставлен в очередь.`, `Video${title} added. Idea analysis is queued.`)
          : tr(`Видео${title} добавлено в Radar.`, `Video${title} added to Radar.`)
      );
      setVideoInput('');
      onVideoAdded();
      closeAfterSuccess();
    } catch (err: any) {
      setError(err?.message || tr('Ошибка добавления видео', 'Could not add video'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddChannel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!channelInput.trim()) return;

    setLoading(true);
    resetFeedback();
    try {
      const response = await authFetch('/api/radar/references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: channelInput.trim(),
          intent: 'more_like_this',
          learnFromThis: true,
          analyzeForIdeas: false,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr('Не удалось добавить канал', 'Could not add channel'));

      const title = data?.reference?.title ? ` “${data.reference.title}”` : '';
      setSuccessMessage(tr(`Канал${title} добавлен как источник Discovery.`, `Channel${title} added as a Discovery source.`));
      setChannelInput('');
      onChannelAdded();
      closeAfterSuccess();
    } catch (err: any) {
      setError(err?.message || tr('Ошибка добавления канала', 'Could not add channel'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      id="add-source-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-source-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !loading) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm sm:p-5"
    >
      <div className="max-h-[calc(100vh-24px)] w-full max-w-[680px] overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Plus className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="add-source-title" className="text-base font-bold text-slate-950">
                {tr('Добавить источник', 'Add source')}
              </h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">
                {tr(
                  'Дайте Radar больше контекста или добавьте контент для анализа идей.',
                  'Give Radar more context or add content for idea analysis.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            aria-label={tr('Закрыть', 'Close')}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={mode === 'video'}
              onClick={() => { setMode('video'); resetFeedback(); }}
              className={`rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${mode === 'video'
                ? 'border-emerald-300 bg-emerald-50/70 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${mode === 'video' ? 'bg-white text-rose-500' : 'bg-slate-100 text-slate-500'}`}>
                  <Youtube className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-bold text-slate-900">YouTube video</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {tr('Reference или анализ идей', 'Reference or idea analysis')}
                  </div>
                </div>
              </div>
            </button>

            <button
              type="button"
              aria-pressed={mode === 'channel'}
              onClick={() => { setMode('channel'); resetFeedback(); }}
              className={`rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${mode === 'channel'
                ? 'border-emerald-300 bg-emerald-50/70 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${mode === 'channel' ? 'bg-white text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  <Radio className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-bold text-slate-900">YouTube channel</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {tr('Источник для Discovery', 'Discovery source')}
                  </div>
                </div>
              </div>
            </button>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {mode === 'video' ? (
            <form onSubmit={handleAddVideo} className="mt-5 space-y-5">
              <div>
                <label htmlFor="input-single-video-url" className="mb-1.5 block text-xs font-semibold text-slate-700">
                  {tr('Ссылка на YouTube видео', 'YouTube video URL')}
                </label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="input-single-video-url"
                    type="text"
                    value={videoInput}
                    onChange={(event) => { setVideoInput(event.target.value); resetFeedback(); }}
                    placeholder="https://youtube.com/watch?v=... or https://youtu.be/..."
                    disabled={loading}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
              </div>

              {videoThumbnail && (
                <div className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <img src={videoThumbnail} alt="" className="h-20 w-36 shrink-0 rounded-xl object-cover" />
                  <div className="min-w-0 py-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                      <Youtube className="h-3.5 w-3.5 text-rose-500" />
                      YouTube
                    </div>
                    <p className="mt-2 text-[11px] leading-4 text-slate-500">
                      {tr('Radar проверит метаданные видео после добавления.', 'Radar will resolve the video metadata after you add it.')}
                    </p>
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-bold text-slate-900">
                  {tr('Что Radar должен сделать?', 'What should Radar do with this?')}
                </div>
                <div className="mt-3 grid gap-3">
                  <button
                    type="button"
                    aria-pressed={learnFromThis}
                    onClick={() => setLearnFromThis(value => !value)}
                    className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${learnFromThis ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${learnFromThis ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'}`}>
                      {learnFromThis && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span>
                      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        <Brain className="h-3.5 w-3.5 text-emerald-700" />
                        {tr('Обучить Radar на этом', 'Learn from this')}
                      </span>
                      <span className="mt-1 block text-[11px] leading-4 text-slate-500">
                        {tr(
                          'Использовать видео как явный reference-сигнал для персонализации Discovery.',
                          'Use the video as an explicit reference signal for Discovery personalization.'
                        )}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={analyzeForIdeas}
                    onClick={() => setAnalyzeForIdeas(value => !value)}
                    className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${analyzeForIdeas ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${analyzeForIdeas ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'}`}>
                      {analyzeForIdeas && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-900">
                        <span className="inline-flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-emerald-700" />
                          {tr('Проанализировать для идей', 'Analyze for ideas')}
                        </span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                          {tr('1 Radar Analysis', 'Uses 1 Radar Analysis')}
                        </span>
                      </span>
                      <span className="mt-1 block text-[11px] leading-4 text-slate-500">
                        {tr(
                          'Поставить это видео в очередь Radar Analysis и создать персонализированные Ideas.',
                          'Queue this video for Radar Analysis and create personalized Ideas.'
                        )}
                      </span>
                    </span>
                  </button>
                </div>
              </div>

              {!learnFromThis && !analyzeForIdeas && (
                <div className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  {tr('Выберите хотя бы одно действие.', 'Choose at least one action.')}
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={loading}
                  onClick={onClose}
                  className="h-10 rounded-xl px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
                >
                  {tr('Отмена', 'Cancel')}
                </button>
                <button
                  id="btn-submit-video"
                  type="submit"
                  disabled={loading || !videoInput.trim() || (!learnFromThis && !analyzeForIdeas)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {loading ? tr('Добавляем…', 'Adding…') : tr('Добавить в Radar', 'Add to Radar')}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddChannel} className="mt-5 space-y-5">
              <div>
                <label htmlFor="input-channel-url" className="mb-1.5 block text-xs font-semibold text-slate-700">
                  {tr('Ссылка на канал или @handle', 'Channel URL or @handle')}
                </label>
                <div className="relative">
                  <Youtube className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-rose-500" />
                  <input
                    id="input-channel-url"
                    type="text"
                    value={channelInput}
                    onChange={(event) => { setChannelInput(event.target.value); resetFeedback(); }}
                    placeholder="@Veritasium or https://youtube.com/@..."
                    disabled={loading}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
                    <Radio className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      {tr('Использовать как источник Discovery', 'Use as a Discovery source')}
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                      {tr(
                        'Radar возьмёт выборку видео канала в candidate pool. В рекомендации попадут только материалы, прошедшие ваши активные темы, quality gate и ranking.',
                        'Radar will add a sample of channel videos to the candidate pool. Only content that passes your active topics, quality gate and ranking can reach recommendations.'
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] leading-4 text-slate-500">
                {tr(
                  'Новые видео канала не отправляются автоматически в LLM. Автопроверка канала будет добавлена отдельно, когда будет подключён безопасный background workflow.',
                  'New channel videos are not automatically sent to an LLM. Automatic channel checking will be added separately with a safe background workflow.'
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={loading}
                  onClick={onClose}
                  className="h-10 rounded-xl px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
                >
                  {tr('Отмена', 'Cancel')}
                </button>
                <button
                  id="btn-submit-channel"
                  type="submit"
                  disabled={loading || !channelInput.trim()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {loading ? tr('Добавляем…', 'Adding…') : tr('Добавить источник', 'Add source')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
