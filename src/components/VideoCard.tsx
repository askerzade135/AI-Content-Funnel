import React, { useState, useRef, useEffect } from 'react';
import { ExternalLink, Sparkles, FileText, Loader2, CheckCircle2, AlertCircle, AlertTriangle, Play, Plus, Send, RotateCcw, Lightbulb, Film, Trash2, Archive, RefreshCw, Square, X, Clock } from 'lucide-react';
import { StoredVideo } from '../types';
import { extractFilterRejectionReason } from '../utils/filterCheck';
import {
  isProcessing as checkIsProcessing,
  hasValidTranscript,
  isQueued,
  canTranscribe,
  isMissingTranscriptRejection,
  getErrorStageLabel,
  canApprove,
  canReject,
  canArchive,
  canDelete,
  isRejectedFilter,
  isRateLimited,
  canRecheckFilter,
} from '../utils/video-actions';
import { ConfirmModal, ConfirmModalConfig } from './ConfirmModal';
import { usePaidConfirmation } from '../hooks/usePaidConfirmation';
import { ConfirmPaidActionModal } from './ConfirmPaidActionModal';

interface VideoCardProps {
  video: StoredVideo;
  isSelected: boolean;
  scriptCount?: number;
  scenarioStatus?: 'reviewed' | 'has_script' | 'stage1_approved' | 'rejected' | 'unprocessed' | 'approved' | 'no_script' | 'error' | 'processing' | 'quota_exceeded';
  activePipelineStepMessage?: string;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (video: StoredVideo) => void;
  onToggleReviewed?: (video: StoredVideo) => void;
  onRunStage1?: (video: StoredVideo) => void;
  onRunStage2?: (video: StoredVideo) => void;
  onProcessSingle: (video: StoredVideo) => void;
  onRunTelegramPipelineSingle?: (video: StoredVideo) => void;
  onOverrideFilter?: (id: string, approve: boolean) => void;
  onResetStatus?: (id: string, target: 'stage1' | 'approved' | 'rejected' | 'new') => void;
  onDelete: (id: string) => void;
  onToggleArchive?: (video: StoredVideo) => void;
  onSelectChannel?: (channelId: string) => void; /* CHANGE-6 */
  onStopProcess?: (video: StoredVideo) => void;
  onTranscribe?: (video: StoredVideo) => void;
  onRetryStep?: (video: StoredVideo) => void;
}

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  isSelected,
  scriptCount = 0,
  scenarioStatus,
  activePipelineStepMessage,
  onToggleSelect,
  onOpenDetail,
  onToggleReviewed,
  onRunStage1,
  onRunStage2,
  onProcessSingle,
  onRunTelegramPipelineSingle,
  onOverrideFilter,
  onResetStatus,
  onDelete,
  onToggleArchive,
  onSelectChannel,
  onStopProcess,
  onTranscribe,
  onRetryStep,
}) => {
  const [confirmConfig, setConfirmConfig] = useState<ConfirmModalConfig | null>(null);
  const { confirmPaidAction, modalState, closeModal } = usePaidConfirmation();

  const formatRelativeDate = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      if (diffMs < 0) return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
      
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffMonths = Math.floor(diffDays / 30);
      const diffYears = Math.floor(diffDays / 365);

      if (diffMinutes < 60) return diffMinutes <= 1 ? 'Только что' : `${diffMinutes} мин. назад`;
      if (diffHours < 24) return `${diffHours} ч. назад`;
      if (diffDays === 1) return 'Вчера';
      if (diffDays < 7) return `${diffDays} дн. назад`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед. назад`;
      if (diffMonths < 12) {
        if (diffMonths === 1) return '1 месяц назад';
        if (diffMonths >= 2 && diffMonths <= 4) return `${diffMonths} месяца назад`;
        return `${diffMonths} месяцев назад`;
      }
      if (diffYears === 1) return '1 год назад';
      if (diffYears >= 2 && diffYears <= 4) return `${diffYears} года назад`;
      return `${diffYears} лет назад`;
    } catch {
      return isoString;
    }
  };

  const formatFullDate = (isoString?: string) => {
    if (!isoString) return '';
    try {
      return new Date(isoString).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return isoString;
    }
  };

  const isProcessing = checkIsProcessing(video);
  const isValidTranscript = hasValidTranscript(video);
  const isRejected = scenarioStatus === 'rejected' || isRejectedFilter(video);

  // Request confirmation handlers for paid / AI pipeline actions
  const handleRequestRunStage1 = () => {
    confirmPaidAction({
      actionType: 'stage1',
      videos: [video],
      onConfirm: () => {
        if (onRunStage1) onRunStage1(video);
        else onProcessSingle(video);
      },
    });
  };

  const handleRequestRun2StagePipeline = () => {
    confirmPaidAction({
      actionType: 'pipeline',
      videos: [video],
      onConfirm: () => {
        if (onRunStage2) onRunStage2(video);
        else onProcessSingle(video);
      },
    });
  };

  const handleRequestRunStage2 = () => {
    confirmPaidAction({
      actionType: 'stage2',
      videos: [video],
      onConfirm: () => {
        if (onRunStage2) onRunStage2(video);
      },
    });
  };

  const handleRequestTranscribe = () => {
    confirmPaidAction({
      actionType: 'transcription',
      videos: [video],
      onConfirm: () => {
        if (onTranscribe) onTranscribe(video);
      },
    });
  };

  const handleRequestToggleReviewed = () => {
    const isRev = scenarioStatus === 'reviewed' || video.isReviewed;
    setConfirmConfig({
      isOpen: true,
      title: isRev ? 'Вернуть видео в работу?' : 'Отметить как просмотренное?',
      description: `Видео: «${video.title}».`,
      confirmText: isRev ? 'Вернуть в работу' : 'Отметить',
      cancelText: 'Отмена',
      type: 'teal',
      badge: 'Статус',
      onConfirm: () => {
        if (onToggleReviewed) onToggleReviewed(video);
      },
      onCancel: () => {},
    });
  };

  const handleRequestResetStatus = () => {
    setConfirmConfig({
      isOpen: true,
      title: 'Сбросить статус видео?',
      description: `Видео: «${video.title}». Статус будет сброшен на Этап 1, сценарии очищены.`,
      confirmText: 'Сбросить',
      cancelText: 'Отмена',
      type: 'danger',
      badge: 'Сброс',
      onConfirm: () => {
        if (onResetStatus) onResetStatus(video.id, 'stage1');
      },
      onCancel: () => {},
    });
  };

  const handleRequestOverrideFilter = (approve: boolean) => {
    if (approve && !canApprove(video)) return;
    if (!approve && !canReject(video)) return;

    setConfirmConfig({
      isOpen: true,
      title: approve ? 'Одобрить видео (Этап 1)?' : 'Отклонить видео?',
      description: `Видео: «${video.title}». ${approve ? 'Видео будет перемещено в одобренные для генерации идей.' : 'Видео будет отклонено.'}`,
      confirmText: approve ? 'Одобрить' : 'Отклонить',
      cancelText: 'Отмена',
      type: approve ? 'emerald' : 'danger',
      badge: approve ? 'Одобрение' : 'Отклонение',
      onConfirm: () => {
        if (onOverrideFilter) onOverrideFilter(video.id, approve);
      },
      onCancel: () => {},
    });
  };

  const handleRequestToggleArchive = () => {
    if (!canArchive(video)) return;

    const isArch = video.isArchived;
    setConfirmConfig({
      isOpen: true,
      title: isArch ? 'Вернуть видео из архива?' : 'Архивировать видео?',
      description: isArch
        ? `Видео «${video.title}» будет возвращено из архива в основной список.`
        : `Архивировать видео «${video.title}»? Скрывает видео из основного списка без удаления. Заархивированные видео можно найти в разделе «Архив» и вернуть обратно.`,
      confirmText: isArch ? 'Вернуть из архива' : 'Архивировать',
      cancelText: 'Отмена',
      type: 'warning',
      badge: 'Архив',
      onConfirm: () => {
        if (onToggleArchive) onToggleArchive(video);
      },
      onCancel: () => {},
    });
  };

  const handleRequestDelete = () => {
    if (!canDelete(video)) return;

    setConfirmConfig({
      isOpen: true,
      title: 'Удалить видео из списка?',
      description: `Удалить видео «${video.title}» из списка? Это действие нельзя отменить.`,
      confirmText: 'Удалить',
      cancelText: 'Отмена',
      type: 'danger',
      badge: 'Удаление',
      onConfirm: () => onDelete(video.id),
      onCancel: () => {},
    });
  };

  const renderStatusBadge = () => {
    if (activePipelineStepMessage) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-sky-50 text-sky-700 border border-sky-300 shadow-2xs">
          <Loader2 className="w-3 h-3 animate-spin text-sky-600 shrink-0" />
          <span className="truncate max-w-[140px]">{activePipelineStepMessage}</span>
        </span>
      );
    }

    if (isQueued(video)) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300 shadow-2xs animate-pulse">
          <Clock className="w-3 h-3 text-amber-600" />
          В очереди на транскрипцию
        </span>
      );
    }

    if (video.status === 'transcribing') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
          <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
          Транскрибация...
        </span>
      );
    }

    if (isProcessing) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
          <Loader2 className="w-3 h-3 animate-spin text-purple-600" />
          Gemini думает...
        </span>
      );
    }

    if (video.status === 'requires_payment') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
          <Clock className="w-3 h-3 text-amber-700" />
          Требует подтверждения
        </span>
      );
    }

    if (isRateLimited(video)) {
      return (
        <div className="flex items-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              confirmPaidAction({
                actionType: 'transcription',
                videos: [video],
                onConfirm: async () => {
                  try {
                    await fetch(`/api/videos/${video.id}/force-paid-transcription`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                    });
                    window.location.reload();
                  } catch (err) {
                    console.error(err);
                    alert('Ошибка запуска платной транскрипции');
                  }
                },
              });
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow hover:scale-105 transition-transform"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            Оплатить транскрипцию
          </button>
        </div>
      );
    }

    if (video.status === 'error') {
      const stageLabel = getErrorStageLabel(video);

      return (
        <div className="group relative flex items-center">
          <span className="inline-flex cursor-help items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200 shadow-sm">
            <AlertCircle className="w-3 h-3" />
            {stageLabel}
          </span>
          <div className="absolute right-0 top-full mt-1.5 w-64 p-2.5 bg-slate-800 text-slate-100 text-[10px] rounded-md shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] whitespace-normal leading-relaxed border border-slate-700">
            <div className="font-semibold text-red-400 mb-1">Детали ошибки ({stageLabel}):</div>
            <div className="max-h-24 overflow-y-auto mb-2 select-text">{video.error || 'Неизвестная ошибка'}</div>
            {video.lastPassedStatus && (
              <div className="text-slate-300 text-[9px] mb-2">
                Успешно пройдено ранее:{' '}
                <span className="text-emerald-400 font-semibold">
                  {video.lastPassedStatus === 'transcribed'
                    ? 'Транскрипция'
                    : video.lastPassedStatus === 'approved'
                    ? '1 этап (Одобрено)'
                    : video.lastPassedStatus === 'has_script'
                    ? 'Сценарий создан'
                    : video.lastPassedStatus}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(video.error || 'Неизвестная ошибка');
                alert('Ошибка скопирована в буфер обмена!');
              }}
              className="w-full py-1 px-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-[10px] font-medium transition text-center"
            >
              📋 Копировать ошибку
            </button>
          </div>
        </div>
      );
    }

    if (scenarioStatus === 'reviewed' || video.isReviewed) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-100 text-teal-900 border border-teal-300 shadow-2xs">
          <CheckCircle2 className="w-3 h-3 text-teal-700" />
          Обработано
        </span>
      );
    }

    if (scenarioStatus === 'has_script' || (scriptCount > 0 && !isRejected)) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-900 border border-purple-300 shadow-2xs">
          <Film className="w-3 h-3 text-purple-700" />
          Сценарий готов
        </span>
      );
    }

    if ((scenarioStatus === 'stage1_approved' || scenarioStatus === 'approved') && !isRejected) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs">
          <Lightbulb className="w-3 h-3 text-emerald-600" />
          Одобрено (Этап 1)
        </span>
      );
    }

    if (isRejected) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300 shadow-2xs">
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          Отклонено фильтром
        </span>
      );
    }

    if (['transcribed', 'processing_gemini', 'completed'].includes(video.status)) {
      if (!video.transcript || video.transcript.trim().length < 50) {
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-300 shadow-2xs">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            Ошибка: нет текста
          </span>
        );
      }
      if (video.status === 'transcribed') {
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-300 shadow-2xs">
            <FileText className="w-3 h-3 text-blue-600" />
            Транскрипция готова
          </span>
        );
      }
    }

    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-stone-100 text-stone-600 border border-stone-200">
        Не обработано
      </span>
    );
  };

  return (
    <>
      <ConfirmModal config={confirmConfig} onClose={() => setConfirmConfig(null)} />
      
      <div
        id={`video-card-${video.id}`}
        className={`group relative bg-white rounded-2xl border transition-all duration-200 flex flex-col overflow-hidden shadow-2xs hover:shadow-md ${
          isSelected
            ? 'border-indigo-600 ring-2 ring-indigo-600/20 bg-indigo-50/10'
            : isRejected
            ? 'border-amber-200 bg-amber-50/10'
            : scenarioStatus === 'has_script'
            ? 'border-purple-200 bg-purple-50/10'
            : scenarioStatus === 'stage1_approved'
            ? 'border-emerald-200 bg-emerald-50/10'
            : 'border-stone-200 hover:border-stone-300'
        }`}
      >
        {/* Thumbnail area with checkbox overlay */}
        <div 
          onClick={() => onOpenDetail(video)}
          className="relative aspect-video bg-stone-100 overflow-hidden shrink-0 cursor-pointer"
          title="Открыть детали видео"
        >
          <img
            src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
            alt={video.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />

          {/* Top overlays: Selection Checkbox & Status */}
          <div 
            className="absolute inset-x-0 top-0 p-2.5 flex items-center justify-between bg-gradient-to-b from-black/60 via-black/20 to-transparent"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Custom Checkbox */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(video.id);
              }}
              className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-white/50'
                  : 'bg-black/40 text-white/80 hover:bg-black/60 backdrop-blur-xs border border-white/20'
              }`}
              title={isSelected ? 'Снять выбор' : 'Выбрать видео'}
            >
              {isSelected ? (
                <CheckCircle2 className="w-4 h-4 fill-white text-indigo-600" />
              ) : (
                <div className="w-3.5 h-3.5 rounded border border-white/70" />
              )}
            </button>

            {/* Status badge */}
            <div className="flex items-center gap-1.5">
              {renderStatusBadge()}
            </div>
          </div>

          {/* Quick Play link on YouTube overlay */}
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-2.5 right-2.5 p-1.5 rounded-lg bg-black/60 hover:bg-red-600 text-white backdrop-blur-xs transition flex items-center gap-1 text-[10px] font-medium opacity-0 group-hover:opacity-100"
            title="Открыть на YouTube"
          >
            <Play className="w-3 h-3 fill-current" />
            <span className="hidden sm:inline">Смотреть</span>
          </a>
        </div>

        {/* Card Body */}
        <div className="p-4 flex-1 flex flex-col justify-between">
          <div>
            {/* Channel and Date - CHANGE-6: Clickable channel tag */}
            <div className="flex items-center justify-between text-[11px] text-stone-500 mb-1.5 gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => onSelectChannel && onSelectChannel(video.channelId)}
                className="font-semibold text-stone-700 hover:text-indigo-600 cursor-pointer transition truncate max-w-[160px] text-left underline-offset-2 hover:underline"
                title={`Фильтровать по каналу: ${video.channelTitle}`}
              >
                {video.channelTitle}
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                {video.queueTimestamp && (
                  <span 
                    className="inline-flex items-center gap-1.5 text-[10px] font-medium text-amber-800 bg-amber-50 pl-1.5 pr-1 py-0.5 rounded-md border border-amber-200"
                    title={`Поставлено в очередь: ${new Date(video.queueTimestamp).toLocaleString('ru-RU')}`}
                  >
                    <Clock className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                    <span>Очередь: {new Date(video.queueTimestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                    {onStopProcess && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStopProcess(video);
                        }}
                        title="Убрать из очереди"
                        className="hover:bg-amber-200/80 p-0.5 rounded text-amber-700 hover:text-amber-950 transition cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                )}
                <span className="shrink-0 text-stone-400" title={formatFullDate(video.publishedAt)}>
                  {formatRelativeDate(video.publishedAt)}
                </span>
              </div>
            </div>

            {/* Video Title */}
            <h3
              onClick={() => onOpenDetail(video)}
              className="text-xs font-bold text-stone-900 line-clamp-2 leading-snug cursor-pointer hover:text-indigo-600 transition"
              title={video.title}
            >
              {video.title}
            </h3>

            {/* CHANGE-1, CHANGE-9, CHANGE-11: Theme Tag Chip, Rating Badge & Transcript Status Badge */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="inline-block px-2 py-0.5 text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md">
                #{video.channelTitle.toLowerCase().includes('hist') || video.title.toLowerCase().includes('истор') ? 'история' : video.title.toLowerCase().includes('психол') ? 'психология' : 'reels_тренд'}
              </span>

              {/* Transcript presence badge */}
              {hasValidTranscript(video) ? (
                <span 
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border shadow-2xs ${
                    video.transcriptSource === 'supadata'
                      ? 'bg-teal-50 text-teal-800 border-teal-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                  title={
                    video.transcriptSource === 'gemini_multimodal'
                      ? 'Транскрипт получен через Gemini AI Audio (Уровень В)'
                      : video.transcriptSource === 'supadata'
                      ? 'Транскрипт получен через Supadata API (Уровень Б)'
                      : 'Транскрипт получен из субтитров YouTube (Уровень А)'
                  }
                >
                  <FileText className={`w-2.5 h-2.5 ${video.transcriptSource === 'supadata' ? 'text-teal-600' : 'text-emerald-600'}`} />
                  <span>
                    {video.transcriptSource === 'gemini_multimodal'
                      ? 'AI Аудио'
                      : video.transcriptSource === 'supadata'
                      ? 'Supadata'
                      : 'Текст есть'}
                  </span>
                </span>
              ) : video.status === 'transcribing' ? (
                <span 
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 animate-pulse"
                  title="Идет получение транскрипта..."
                >
                  <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-600" />
                  <span>Транскрибация</span>
                </span>
              ) : isQueued(video) ? (
                <span 
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200"
                  title="Видео ожидает очереди на получение транскрипта"
                >
                  <Clock className="w-2.5 h-2.5 text-amber-600" />
                  <span>Ожидает текст</span>
                </span>
              ) : (
                <span 
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-800 border border-rose-200"
                  title="Транскрипт отсутствует (субтитры не найдены или отключены)"
                >
                  <AlertCircle className="w-2.5 h-2.5 text-rose-600" />
                  <span>Нет текста</span>
                </span>
              )}

              {scenarioStatus !== 'no_script' && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                  ⭐ {scenarioStatus === 'has_script' || scenarioStatus === 'approved' ? '5/5' : isRejected ? '2/5' : '4/5'}
                </span>
              )}
            </div>

            {/* Rejection Reason or Missing Transcript warning for rejected video */}
            {isRejected && (() => {
              const rawReason = video.filterReason || extractFilterRejectionReason(video.geminiResult);
              
              // Check if rejection was actually caused by missing / invalid transcript
              const missingTranscript = isMissingTranscriptRejection(video);

              const reason = missingTranscript
                ? (video.filterReason || 'Нет текста — транскрипция не дала результата')
                : (rawReason || 'Не подходит под критерии фильтра.');

              const fullReasonText = `Причина: ${reason}`;
              
              return (
                <div 
                  className={`mt-2 flex items-start gap-1.5 text-[11px] p-2 rounded-lg border cursor-pointer transition ${
                    missingTranscript 
                      ? 'text-rose-900 bg-rose-50/95 border-rose-200 hover:bg-rose-100/90' 
                      : 'text-amber-900 bg-amber-50/90 border-amber-200/80 hover:bg-amber-100/90'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDetail(video);
                  }}
                  title={fullReasonText}
                >
                  {missingTranscript ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <span 
                    className="line-clamp-2 leading-relaxed"
                    title={fullReasonText}
                  >
                    <strong className={`font-semibold ${missingTranscript ? 'text-rose-950' : 'text-amber-950'}`}>
                      {missingTranscript ? 'Нет субтитров: ' : 'Причина: '}
                    </strong>
                    <span>{reason}</span>
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Action Bottom Bar - CHANGE-10: full width buttons */}
          <div className="mt-4 pt-3 border-t border-stone-100 flex flex-col gap-2 w-full">
            {isProcessing ? (
              <div className="flex items-center gap-2 w-full">
                <button
                  type="button"
                  onClick={() => onStopProcess && onStopProcess(video)}
                  title="Прервать процесс обработки видео"
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition shadow-2xs whitespace-nowrap cursor-pointer"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-red-600 shrink-0" />
                  <Square className="w-3.5 h-3.5 text-red-600 shrink-0 fill-current ml-1" />
                  <span className="truncate">Остановить обработку</span>
                </button>
              </div>
            ) : video.status === 'transcribe_queued' ? (
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse shrink-0" />
                  <span className="truncate">Ожидает авто-транскрипции</span>
                </div>
                {onStopProcess && (
                  <button
                    type="button"
                    onClick={() => onStopProcess(video)}
                    title="Убрать видео из очереди"
                    className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition shadow-2xs whitespace-nowrap cursor-pointer flex items-center gap-1"
                  >
                    <Square className="w-3 h-3 fill-current text-rose-600" />
                    <span>Убрать</span>
                  </button>
                )}
              </div>
            ) : video.status === 'requires_payment' ? (
              <div className="flex flex-col gap-1.5 w-full">
                <button
                  type="button"
                  onClick={() => {
                    const actionType = video.pendingPaidAction || (video.lastPassedStatus === 'approved' ? 'stage2' : video.lastPassedStatus === 'transcribed' ? 'stage1' : 'transcription');
                    confirmPaidAction({
                      actionType,
                      videos: [video],
                      onConfirm: () => {
                        if (actionType === 'stage2' && onRunStage2) onRunStage2(video);
                        else if (actionType === 'stage1' && onRunStage1) onRunStage1(video);
                        else if (actionType === 'transcription' && onTranscribe) onTranscribe(video);
                        else onProcessSingle(video);
                      },
                    });
                  }}
                  title="Подтвердить платный запуск для этого видео"
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 rounded-lg transition shadow-2xs whitespace-nowrap cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-white shrink-0" />
                  <span className="truncate">Подтвердить запуск ({video.pendingPaidAction === 'transcription' ? 'Транскрипция' : video.pendingPaidAction === 'stage2' ? 'Этап 2' : 'Этап 1'})</span>
                </button>
                {video.paidActionReason && (
                  <p className="text-[10px] text-amber-800 text-center px-1 truncate" title={video.paidActionReason}>
                    {video.paidActionReason}
                  </p>
                )}
              </div>
            ) : video.status === 'error' ? (
              <div className="flex flex-col gap-2 w-full">
                <div className="flex items-center gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      if (onRetryStep) onRetryStep(video);
                      else onProcessSingle(video);
                    }}
                    title="Повторить завершившийся с ошибкой шаг"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition shadow-2xs whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-white shrink-0" />
                    <span className="truncate">Повторить шаг</span>
                  </button>

                  {video.lastPassedStatus === 'approved' && onRunStage2 && (
                    <button
                      type="button"
                      onClick={handleRequestRunStage2}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition"
                    >
                      <Film className="w-3 h-3 text-indigo-600 shrink-0" />
                      <span className="truncate">2 этап</span>
                    </button>
                  )}

                  {video.lastPassedStatus === 'transcribed' && onRunStage1 && (
                    <button
                      type="button"
                      onClick={handleRequestRunStage1}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition"
                    >
                      <Sparkles className="w-3 h-3 text-emerald-600 shrink-0" />
                      <span className="truncate">1 этап</span>
                    </button>
                  )}
                </div>
              </div>
            ) : scenarioStatus === 'reviewed' || video.isReviewed ? (
              <div className="flex items-center gap-2 w-full">
                <button
                  onClick={() => onOpenDetail(video)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition shadow-2xs"
                  title="Просмотреть детали и сценарии"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Просмотрено</span>
                </button>

                {onToggleReviewed && (
                  <button
                    type="button"
                    onClick={handleRequestToggleReviewed}
                    title="Снять отметку «Просмотрено» (вернуть в работу)"
                    className="px-3 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition"
                  >
                    Вернуть
                  </button>
                )}
              </div>
            ) : scenarioStatus === 'has_script' || (scriptCount > 0 && scenarioStatus !== 'rejected') ? (
              <div className="flex flex-col gap-2 w-full">
                <div className="flex items-center gap-2 w-full">
                  <button
                    onClick={() => onOpenDetail(video)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition shadow-2xs"
                    title="Просмотреть готовые покадровые сценарии"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Сценарии</span>
                  </button>

                  {onToggleReviewed && (
                    <button
                      type="button"
                      onClick={handleRequestToggleReviewed}
                      title="Отметить как просмотрено / снято"
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                      <span>Просмотрено</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 w-full">
                  {/* CHANGE-5: Rename + 2 этап button to clear workflow action with explanatory tooltip */}
                  {onRunStage2 && (
                    <button
                      type="button"
                      onClick={handleRequestRunStage2}
                      disabled={isProcessing || !!activePipelineStepMessage}
                      title="Запустить генерацию покадрового сценария Reels на основе одобренных идей (Этап 2)"
                      className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition disabled:opacity-50 whitespace-nowrap"
                    >
                      <Plus className="w-3 h-3 text-indigo-600 shrink-0" />
                      <span className="truncate">Ожидает сценарий</span>
                    </button>
                  )}

                  {onResetStatus && (
                    <button
                      type="button"
                      onClick={handleRequestResetStatus}
                      title="Вернуть на Этап 1 (Одобрено, очистить сценарии)"
                      className="px-3 py-2 text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition text-xs font-medium whitespace-nowrap"
                    >
                      Сброс
                    </button>
                  )}
                </div>
              </div>
            ) : scenarioStatus === 'stage1_approved' || (video.matchedFilter === true && scriptCount === 0 && !isRejected) ? (
              <div className="flex flex-col gap-2 w-full">
                <div className="flex items-center gap-2 w-full">
                  {/* Button 1: Bank of Ideas */}
                  <button
                    onClick={() => onOpenDetail(video)}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition shadow-2xs whitespace-nowrap"
                    title="Открыть банк идей и хуков, сформированных на 1 этапе"
                  >
                    <Lightbulb className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span className="truncate">Банк идей</span>
                  </button>

                  {/* Button 2: Stage 2 (Generate script) with confirmation */}
                  <button
                    type="button"
                    onClick={handleRequestRunStage2}
                    disabled={isProcessing || !!activePipelineStepMessage}
                    title="Сгенерировать покадровый сценарий Reels/Shorts"
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition shadow-2xs disabled:opacity-50 whitespace-nowrap"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-3 h-3 animate-spin text-white shrink-0" />
                    ) : (
                      <Film className="w-3 h-3 text-white shrink-0" />
                    )}
                    <span className="truncate">Сценарий</span>
                  </button>
                </div>

                {onOverrideFilter && (
                  <div className="flex items-center w-full">
                    <button
                      type="button"
                      onClick={() => handleRequestOverrideFilter(false)}
                      disabled={!canReject(video) || isProcessing}
                      title="Отклонить видео"
                      className="w-full inline-flex items-center justify-center px-3 py-2 text-stone-600 hover:text-amber-700 bg-stone-100 hover:bg-amber-50 rounded-lg transition text-xs font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="truncate">Отклонить</span>
                    </button>
                  </div>
                )}
              </div>
            ) : isRejected ? (
              <div className="flex items-center gap-2 w-full flex-wrap">
                {onOverrideFilter && (
                  <button
                    type="button"
                    onClick={() => handleRequestOverrideFilter(true)}
                    disabled={!canApprove(video) || isProcessing}
                    title="Вернуть видео в список одобренных (Этап 1)"
                    className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition shadow-2xs whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="truncate">Одобрить (1 этап)</span>
                  </button>
                )}

                {onRunStage1 && (
                  <button
                    type="button"
                    onClick={handleRequestRunStage1}
                    disabled={!canRecheckFilter(video) || !!activePipelineStepMessage}
                    title="Повторно запустить 1 этап (Фильтр тем и скрининг)"
                    className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 border border-stone-200 rounded-lg transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-stone-500 shrink-0" />
                    <span className="truncate">Перепроверить (1 этап)</span>
                  </button>
                )}
              </div>
            ) : video.status === 'transcribed' || (video.transcript && video.transcript.trim().length > 50 && video.matchedFilter === undefined) ? (
              <div className="flex items-center gap-2 w-full">
                <button
                  type="button"
                  onClick={handleRequestRunStage1}
                  disabled={isProcessing || !!activePipelineStepMessage}
                  title="Запустить фильтрацию тем и банк идей по готовой транскрипции"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition shadow-2xs whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">Фильтр</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 w-full">
                {onTranscribe && canTranscribe(video) && (
                  <button
                    type="button"
                    onClick={handleRequestTranscribe}
                    disabled={isProcessing || !!activePipelineStepMessage}
                    title="Получить текст (субтитры или расшифровка Gemini)"
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition whitespace-nowrap"
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span className="truncate">Текст</span>
                  </button>
                )}
                {/* BUTTON 1: Filter Screener with confirmation */}
                <button
                  type="button"
                  onClick={handleRequestRunStage1}
                  disabled={isProcessing || !!activePipelineStepMessage}
                  title="Фильтрация тем и поиск хуков"
                  className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-stone-800 bg-stone-100 hover:bg-emerald-50 hover:text-emerald-900 border border-stone-200 rounded-lg transition whitespace-nowrap"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-600 shrink-0" />
                      <span className="truncate">Анализ...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate">Фильтр</span>
                    </>
                  )}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 ml-auto shrink-0">
              {onToggleArchive && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleRequestToggleArchive}
                    disabled={!canArchive(video)}
                    className="text-stone-400 hover:text-stone-700 text-xs p-1 rounded transition flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={video.isArchived ? 'Вернуть из архива' : 'Архивировать'}
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>{video.isArchived ? 'Из архива' : 'Архив'}</span>
                  </button>
                  <span 
                    className="text-stone-400 hover:text-stone-600 cursor-help text-[11px]"
                    title="Скрывает видео из основного списка без удаления. Заархивированные видео можно найти в отдельном фильтре/разделе «Архив» и вернуть обратно."
                  >
                    ⓘ
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleRequestDelete}
                disabled={!canDelete(video)}
                className="text-stone-400 hover:text-red-600 text-xs p-1 rounded transition disabled:opacity-40 disabled:cursor-not-allowed"
                title="Удалить из списка"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      </div>
      <ConfirmPaidActionModal
        isOpen={modalState.isOpen}
        actionType={modalState.actionType}
        videos={modalState.videos}
        title={modalState.title}
        description={modalState.description}
        onConfirm={modalState.onConfirm}
        onClose={closeModal}
      />
    </>
  );
};
