import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Sparkles, Loader2, X, CheckSquare, Send, 
  CheckCircle2, AlertTriangle, Ban, FileSpreadsheet, Archive, Trash2, 
  MoreVertical, RefreshCw, Filter, Film, Headphones, ChevronDown, RotateCcw
} from 'lucide-react';
import { PipelineStepProgress, StoredVideo } from '../types';
import {
  canTranscribe,
  canRunStage1,
  canRunStage2,
  canRunPipeline,
  canExportIdeas,
  canRecheckFilter,
  canStop,
  canRetry,
  canArchive,
  canDelete,
  PaidActionType,
} from '../utils/video-actions';
import { usePaidConfirmation } from '../hooks/usePaidConfirmation';
import { ConfirmPaidActionModal } from './ConfirmPaidActionModal';

interface BatchActionToolbarProps {
  selectedVideos: StoredVideo[];
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onSelectByStatus?: (statusFilter: 'unprocessed' | 'approved' | 'with_script' | 'has_error' | 'requires_payment') => void;
  onBatchConfirmPayment?: (videos: StoredVideo[]) => void;
  onBatchTranscribe?: (videoIds: string[]) => void;
  onBatchStage1?: (videoIds: string[]) => void;
  onBatchStage2?: (videoIds: string[]) => void;
  onBatchRetryStep?: (videoIds: string[]) => Promise<void> | void;
  onRunTelegramPipeline: (videoIds: string[], promptTemplate: string, customPrompt?: string) => void;
  onOpenExportIdeas?: (videoIds: string[]) => void;
  onBatchArchive?: (videoIds: string[], isArchived: boolean) => void;
  onBatchDelete?: (videoIds: string[]) => void;
  onBatchStop?: (videoIds: string[]) => void;
  onBatchRecheck?: (videoIds: string[]) => void;
  isProcessing: boolean;
  pipelineProgress: PipelineStepProgress | null;
  onCancelPipeline?: () => void;
  onClearPipelineProgress?: () => void;
}

export const BatchActionToolbar: React.FC<BatchActionToolbarProps> = ({
  selectedVideos,
  totalCount,
  onSelectAll,
  onClearSelection,
  onSelectByStatus,
  onBatchConfirmPayment,
  onBatchTranscribe,
  onBatchStage1,
  onBatchStage2,
  onBatchRetryStep,
  onRunTelegramPipeline,
  onOpenExportIdeas,
  onBatchArchive,
  onBatchDelete,
  onBatchStop,
  onBatchRecheck,
  isProcessing,
  pipelineProgress,
  onCancelPipeline,
  onClearPipelineProgress,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isSelectMenuOpen, setIsSelectMenuOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [popupPlacement, setPopupPlacement] = useState<{
    vertical: 'top' | 'bottom';
    horizontal: 'right' | 'left';
  }>({ vertical: 'top', horizontal: 'right' });

  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectMenuRef = useRef<HTMLDivElement>(null);

  const selectedCount = selectedVideos.length;

  const { confirmPaidAction, modalState, closeModal } = usePaidConfirmation();

  const handleBatchTranscribeClick = () => {
    const targets = actionCompatibility.canTranscribe;
    if (!onBatchTranscribe || targets.length === 0) return;
    confirmPaidAction({
      actionType: 'transcription',
      videos: targets,
      onConfirm: () => onBatchTranscribe(targets.map((v) => v.id)),
    });
  };

  const handleBatchStage1Click = () => {
    const targets = actionCompatibility.canStage1;
    if (!onBatchStage1 || targets.length === 0) return;
    confirmPaidAction({
      actionType: 'stage1',
      videos: targets,
      onConfirm: () => onBatchStage1(targets.map((v) => v.id)),
    });
  };

  const handleBatchStage2Click = () => {
    const targets = actionCompatibility.canStage2;
    if (!onBatchStage2 || targets.length === 0) return;
    confirmPaidAction({
      actionType: 'stage2',
      videos: targets,
      onConfirm: () => onBatchStage2(targets.map((v) => v.id)),
    });
  };

  const handleBatchPipelineClick = () => {
    const targets = actionCompatibility.canPipeline;
    if (targets.length === 0) return;
    confirmPaidAction({
      actionType: 'pipeline',
      videos: targets,
      onConfirm: () => onRunTelegramPipeline(targets.map((v) => v.id), 'two_stage_pipeline'),
    });
  };

  const handleBatchRecheckClick = () => {
    const targets = actionCompatibility.canRecheck;
    if (!onBatchRecheck || targets.length === 0) return;
    confirmPaidAction({
      actionType: 'stage1',
      videos: targets,
      onConfirm: () => onBatchRecheck(targets.map((v) => v.id)),
      title: 'Подтверждение перепроверки (Этап 1)',
    });
  };

  const handleBatchConfirmPaymentClick = () => {
    const targets = actionCompatibility.canConfirmPayment;
    if (targets.length === 0) return;
    const hasStage2 = targets.some((v) => v.pendingPaidAction === 'stage2' || v.lastPassedStatus === 'approved');
    const hasStage1 = targets.some((v) => v.pendingPaidAction === 'stage1' || v.lastPassedStatus === 'transcribed');
    const hasTranscribe = targets.some((v) => v.pendingPaidAction === 'transcription');
    const actionType: PaidActionType = (hasStage2 && !hasStage1 && !hasTranscribe)
      ? 'stage2'
      : (hasTranscribe && !hasStage1 && !hasStage2)
      ? 'transcription'
      : 'pipeline';

    confirmPaidAction({
      actionType,
      videos: targets,
      title: `Подтвердить и запустить (${targets.length} видео)`,
      description: `Будет выполнен авторизованный запуск Gemini AI для ${targets.length} видео со статусом ожидания подтверждения.`,
      onConfirm: () => {
        if (onBatchConfirmPayment) {
          onBatchConfirmPayment(targets);
        }
      },
    });
  };

  // Calculate smart placement for the More dropdown when opened
  useEffect(() => {
    if (isMoreOpen && moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;
      const popupHeight = 180; // approximate popup height
      const popupWidth = 260; // popup width

      const spaceAbove = rect.top;
      const spaceBelow = windowHeight - rect.bottom;
      const spaceRight = windowWidth - rect.right;
      const spaceLeft = rect.left;

      const vertical = spaceAbove >= popupHeight || spaceAbove > spaceBelow ? 'top' : 'bottom';
      const horizontal = spaceLeft >= popupWidth - 40 || spaceRight < popupWidth ? 'right' : 'left';

      setPopupPlacement({ vertical, horizontal });
    }
  }, [isMoreOpen]);

  // Close dropdowns on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
      if (selectMenuRef.current && !selectMenuRef.current.contains(event.target as Node)) {
        setIsSelectMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMoreOpen(false);
        setIsSelectMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Compute availability and counts for each batch action based on selected videos
  const actionCompatibility = useMemo(() => {
    return {
      canConfirmPayment: selectedVideos.filter((v) => v.status === 'requires_payment'),
      canTranscribe: selectedVideos.filter(canTranscribe),
      canStage1: selectedVideos.filter(canRunStage1),
      canStage2: selectedVideos.filter(canRunStage2),
      canPipeline: selectedVideos.filter(canRunPipeline),
      canExport: selectedVideos.filter(canExportIdeas),
      canRecheck: selectedVideos.filter(canRecheckFilter),
      canStop: selectedVideos.filter(canStop),
      canRetry: selectedVideos.filter(canRetry),
      canArchive: selectedVideos.filter(canArchive),
      canDelete: selectedVideos.filter(canDelete),
    };
  }, [selectedVideos]);

  // If no videos selected and no pipeline progress to show, hide toolbar
  if (selectedCount === 0 && !pipelineProgress) return null;

  const isPipelineActive = pipelineProgress !== null;
  const isPipelineFinished =
    pipelineProgress?.step === 'done' ||
    pipelineProgress?.step === 'rejected' ||
    pipelineProgress?.step === 'error';

  return (
    <div
      id="batch-action-toolbar"
      className="fixed bottom-5 inset-x-0 z-40 max-w-5xl mx-auto px-4 pointer-events-none"
    >
      <div className="bg-stone-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl p-4 border border-stone-800 pointer-events-auto flex flex-col gap-3 transition-all duration-200">
        {/* PIPELINE LIVE PROGRESS VIEW (WHEN RUNNING OR JUST FINISHED) */}
        {isPipelineActive ? (
          <div className="flex flex-col gap-3">
            {/* Pipeline Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-sky-950 border border-sky-800 text-sky-300 text-xs font-semibold">
                  <Send className="w-3.5 h-3.5 text-sky-400" />
                  Сценарий в Telegram: видео {pipelineProgress.currentVideoIndex} из {pipelineProgress.totalVideosCount}
                </span>

                <span
                  className="text-xs text-stone-300 font-medium truncate max-w-md hidden sm:inline"
                  title={pipelineProgress.videoTitle}
                >
                  «{pipelineProgress.videoTitle}»
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isPipelineFinished ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (onClearPipelineProgress) onClearPipelineProgress();
                      onClearSelection();
                    }}
                    className="text-xs text-stone-300 hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 transition cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Закрыть
                  </button>
                ) : (
                  onCancelPipeline && (
                    <button
                      type="button"
                      onClick={onCancelPipeline}
                      className="text-xs text-stone-400 hover:text-rose-300 flex items-center gap-1 px-3 py-1.5 rounded-xl bg-stone-800/80 hover:bg-stone-800 transition cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      Отмена
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Steps Timeline Badges */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 text-xs">
              {/* Step 1: Transcription */}
              <div
                className={`p-2.5 rounded-xl border flex items-center gap-2 transition ${
                  pipelineProgress.stepNumber === 1 && pipelineProgress.step === 'transcribing'
                    ? 'bg-sky-950/60 border-sky-600 text-sky-200 ring-1 ring-sky-500/50'
                    : pipelineProgress.stepNumber > 1
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                    : 'bg-stone-800/60 border-stone-700/60 text-stone-400'
                }`}
              >
                {pipelineProgress.stepNumber === 1 && pipelineProgress.step === 'transcribing' ? (
                  <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                ) : pipelineProgress.stepNumber > 1 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <span className="w-4 h-4 rounded-full border border-stone-600 flex items-center justify-center text-[10px] text-stone-400 shrink-0">1</span>
                )}
                <div className="min-w-0">
                  <div className="font-semibold truncate">1. Транскрипция</div>
                  <div className="text-[10px] text-stone-400 truncate">
                    {pipelineProgress.stepNumber > 1
                      ? 'Текст готов'
                      : pipelineProgress.stepNumber === 1
                      ? 'Получение...'
                      : 'Субтитры/Gemini'}
                  </div>
                </div>
              </div>

              {/* Step 2: Gemini Analysis */}
              <div
                className={`p-2.5 rounded-xl border flex items-center gap-2 transition ${
                  pipelineProgress.stepNumber === 2 && pipelineProgress.step === 'analyzing'
                    ? 'bg-indigo-950/60 border-indigo-600 text-indigo-200 ring-1 ring-indigo-500/50'
                    : pipelineProgress.stepNumber > 2
                    ? pipelineProgress.isFilteredOut
                      ? 'bg-amber-950/40 border-amber-800/80 text-amber-300'
                      : 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                    : 'bg-stone-800/60 border-stone-700/60 text-stone-400'
                }`}
              >
                {pipelineProgress.stepNumber === 2 && pipelineProgress.step === 'analyzing' ? (
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                ) : pipelineProgress.stepNumber > 2 ? (
                  pipelineProgress.isFilteredOut ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  )
                ) : (
                  <span className="w-4 h-4 rounded-full border border-stone-600 flex items-center justify-center text-[10px] text-stone-400 shrink-0">2</span>
                )}
                <div className="min-w-0">
                  <div className="font-semibold truncate">2. Анализ Gemini</div>
                  <div className="text-[10px] truncate">
                    {pipelineProgress.stepNumber > 2
                      ? pipelineProgress.isFilteredOut
                        ? 'Отклонено фильтром'
                        : 'Одобрено фильтром'
                      : pipelineProgress.stepNumber === 2
                      ? 'Анализируем...'
                      : 'Проверка темы'}
                  </div>
                </div>
              </div>

              {/* Step 3: Telegram Sending */}
              <div
                className={`p-2.5 rounded-xl border flex items-center gap-2 transition ${
                  pipelineProgress.stepNumber === 3 && pipelineProgress.step === 'sending_tg'
                    ? 'bg-sky-950/60 border-sky-600 text-sky-200 ring-1 ring-sky-500/50'
                    : pipelineProgress.step === 'done' && pipelineProgress.telegramSent
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                    : pipelineProgress.isFilteredOut
                    ? 'bg-stone-800/80 border-stone-700 text-stone-400'
                    : pipelineProgress.telegramError
                    ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                    : 'bg-stone-800/60 border-stone-700/60 text-stone-400'
                }`}
              >
                {pipelineProgress.stepNumber === 3 && pipelineProgress.step === 'sending_tg' ? (
                  <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                ) : pipelineProgress.step === 'done' && pipelineProgress.telegramSent ? (
                  <Send className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : pipelineProgress.isFilteredOut ? (
                  <Ban className="w-4 h-4 text-stone-400 shrink-0" />
                ) : (
                  <span className="w-4 h-4 rounded-full border border-stone-600 flex items-center justify-center text-[10px] text-stone-400 shrink-0">3</span>
                )}
                <div className="min-w-0">
                  <div className="font-semibold truncate">3. Telegram</div>
                  <div className="text-[10px] truncate">
                    {pipelineProgress.isFilteredOut
                      ? 'TG пропущен'
                      : pipelineProgress.telegramSent
                      ? 'Отправлено в канал'
                      : pipelineProgress.step === 'sending_tg'
                      ? 'Отправка...'
                      : 'Публикация'}
                  </div>
                </div>
              </div>
            </div>

            {/* Current Step Status Message */}
            <div className="px-3.5 py-2.5 rounded-xl bg-stone-950/80 border border-stone-800/80 text-xs flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0" />
              <span className="text-stone-300 flex-1 truncate">
                {pipelineProgress.stepMessage}
              </span>
            </div>
          </div>
        ) : (
          /* STANDARD ACTION TOOLBAR VIEW */
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left info & select all / smart select menu */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-800 text-stone-200 text-xs font-semibold">
                <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                Выбрано: {selectedCount} из {totalCount}
              </span>

              {/* Smart Select Menu */}
              {onSelectByStatus && (
                <div className="relative" ref={selectMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsSelectMenuOpen(!isSelectMenuOpen)}
                    className="text-xs text-stone-300 hover:text-white flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-800/70 hover:bg-stone-700 transition font-medium cursor-pointer"
                    title="Умный выбор по статусу"
                  >
                    <Filter className="w-3 h-3 text-stone-400" />
                    <span>Выбрать...</span>
                    <ChevronDown className="w-3 h-3 text-stone-400" />
                  </button>

                  {isSelectMenuOpen && (
                    <div
                      className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] transition-opacity animate-in fade-in"
                      onClick={() => setIsSelectMenuOpen(false)}
                      aria-hidden="true"
                    />
                  )}

                  {isSelectMenuOpen && (
                    <div className="absolute left-0 bottom-full mb-2.5 w-56 bg-stone-900 border border-stone-700/90 rounded-2xl shadow-2xl py-1.5 z-50 text-xs text-stone-200 animate-in fade-in">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSelectMenuOpen(false);
                          onSelectAll();
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-stone-800 flex items-center justify-between transition text-stone-200 hover:text-white cursor-pointer"
                      >
                        <span>Выбрать все в списке</span>
                        <span className="text-[10px] text-stone-400">({totalCount})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSelectMenuOpen(false);
                          onSelectByStatus('unprocessed');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-stone-800 flex items-center justify-between transition text-stone-200 hover:text-white cursor-pointer"
                      >
                        <span>Только новые / без анализа</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSelectMenuOpen(false);
                          onSelectByStatus('approved');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-stone-800 flex items-center justify-between transition text-emerald-300 hover:text-emerald-200 cursor-pointer"
                      >
                        <span>Только одобренные (1 этап)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSelectMenuOpen(false);
                          onSelectByStatus('with_script');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-stone-800 flex items-center justify-between transition text-indigo-300 hover:text-indigo-200 cursor-pointer"
                      >
                        <span>Только с готовым сценарием</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSelectMenuOpen(false);
                          onSelectByStatus('has_error');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-stone-800 flex items-center justify-between transition text-rose-300 hover:text-rose-200 cursor-pointer"
                      >
                        <span>Только с ошибками</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSelectMenuOpen(false);
                          onSelectByStatus('requires_payment');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-stone-800 flex items-center justify-between transition text-amber-300 hover:text-amber-200 cursor-pointer"
                      >
                        <span>Ожидают подтверждения</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {selectedCount < totalCount && (
                <button
                  type="button"
                  onClick={onSelectAll}
                  className="text-xs text-stone-300 hover:text-white underline transition font-medium cursor-pointer"
                >
                  Все ({totalCount})
                </button>
              )}

              <button
                type="button"
                onClick={onClearSelection}
                className="text-xs text-stone-400 hover:text-stone-200 flex items-center gap-1 transition font-medium cursor-pointer"
              >
                <X className="w-3 h-3" />
                Сброс
              </button>
            </div>

            {/* Right Actions: Smart Buttons with relevance counters & disable logic */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* ACTION 0: Подтвердить и запустить для роликов со статусом requires_payment */}
              {actionCompatibility.canConfirmPayment.length > 0 && (
                <button
                  id="btn-batch-confirm-payment"
                  type="button"
                  onClick={handleBatchConfirmPaymentClick}
                  disabled={isProcessing}
                  title={`Подтвердить платный запуск для ${actionCompatibility.canConfirmPayment.length} видео`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white transition shadow-md border border-amber-400 h-9 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                  <span>Подтвердить и запустить ({actionCompatibility.canConfirmPayment.length})</span>
                </button>
              )}

              {/* ACTION 1: Транскрибация (активна, если есть ролики без текста) */}
              {onBatchTranscribe && actionCompatibility.canTranscribe.length > 0 && (
                <button
                  id="btn-batch-transcribe"
                  type="button"
                  onClick={handleBatchTranscribeClick}
                  disabled={isProcessing}
                  title={`Транскрибировать ${actionCompatibility.canTranscribe.length} из ${selectedCount} видео без готового текста`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-sky-950/70 hover:bg-sky-900 border border-sky-800 text-sky-200 hover:text-white transition shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed h-9 cursor-pointer"
                >
                  <Headphones className="w-3.5 h-3.5 text-sky-400" />
                  <span>Текст ({actionCompatibility.canTranscribe.length})</span>
                </button>
              )}

              {/* ACTION 2: Фильтр (1 этап) */}
              {onBatchStage1 && (
                <button
                  id="btn-run-stage1-process"
                  type="button"
                  onClick={handleBatchStage1Click}
                  disabled={isProcessing || actionCompatibility.canStage1.length === 0}
                  title={
                    actionCompatibility.canStage1.length > 0
                      ? `Запустить «Фильтр» (Скрининг тем и банк идей) для ${actionCompatibility.canStage1.length} подходящих видео`
                      : 'Нет выбранных видео для фильтра (все уже отфильтрованы или в обработке)'
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition shadow-2xs h-9 ${
                    actionCompatibility.canStage1.length > 0
                      ? 'bg-stone-800 hover:bg-stone-700 border-stone-700 text-stone-200 hover:text-white cursor-pointer'
                      : 'bg-stone-800/40 border-stone-800 text-stone-500 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <Sparkles className={`w-3.5 h-3.5 ${actionCompatibility.canStage1.length > 0 ? 'text-amber-400' : 'text-stone-600'}`} />
                  <span>Фильтр ({actionCompatibility.canStage1.length})</span>
                </button>
              )}

              {/* ACTION 3: Сценарий (2 этап) */}
              {onBatchStage2 && (
                <button
                  id="btn-run-stage2-process"
                  type="button"
                  onClick={handleBatchStage2Click}
                  disabled={isProcessing || actionCompatibility.canStage2.length === 0}
                  title={
                    actionCompatibility.canStage2.length > 0
                      ? `Сгенерировать покадровые сценарии для ${actionCompatibility.canStage2.length} одобренных видео`
                      : 'Недоступно: среди выбранных нет видео со статусом «Одобрено»'
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition shadow-2xs h-9 ${
                    actionCompatibility.canStage2.length > 0
                      ? 'bg-indigo-900/80 hover:bg-indigo-800 border-indigo-700 text-indigo-100 hover:text-white cursor-pointer'
                      : 'bg-stone-800/40 border-stone-800 text-stone-500 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <Film className={`w-3.5 h-3.5 ${actionCompatibility.canStage2.length > 0 ? 'text-indigo-300' : 'text-stone-600'}`} />
                  <span>Сценарий ({actionCompatibility.canStage2.length})</span>
                </button>
              )}

              {/* ACTION 4: Авто-конвейер в TG */}
              <button
                id="btn-run-telegram-pipeline"
                type="button"
                onClick={handleBatchPipelineClick}
                disabled={isProcessing || actionCompatibility.canPipeline.length === 0}
                title={
                  actionCompatibility.canPipeline.length > 0
                    ? `Запустить полный авто-конвейер (Транскрипт ➔ Фильтр ➔ Сценарий ➔ Telegram) для ${actionCompatibility.canPipeline.length} видео`
                    : 'Нет доступных видео для конвейера'
                }
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition shadow-2xs h-9 ${
                  actionCompatibility.canPipeline.length > 0
                    ? 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500 text-white cursor-pointer'
                    : 'bg-stone-800/40 border-stone-800 text-stone-500 opacity-40 cursor-not-allowed'
                }`}
              >
                <Send className={`w-3.5 h-3.5 ${actionCompatibility.canPipeline.length > 0 ? 'text-indigo-200' : 'text-stone-600'}`} />
                <span>Авто-конвейер в TG ({actionCompatibility.canPipeline.length})</span>
              </button>

              {/* ACTION: Повторить шаг (активна ТОЛЬКО если среди выбранных есть видео с ошибкой) */}
              {onBatchRetryStep && (
                <button
                  id="btn-batch-retry-step"
                  type="button"
                  onClick={async () => {
                    if (isProcessing || isRetrying || actionCompatibility.canRetry.length === 0) return;
                    setIsRetrying(true);
                    try {
                      await onBatchRetryStep(actionCompatibility.canRetry.map((v) => v.id));
                    } finally {
                      setIsRetrying(false);
                    }
                  }}
                  disabled={isProcessing || isRetrying || actionCompatibility.canRetry.length === 0}
                  title={
                    actionCompatibility.canRetry.length > 0
                      ? `Повторить завершившийся с ошибкой шаг для ${actionCompatibility.canRetry.length} видео`
                      : 'Недоступно: среди выбранных нет видео с ошибками'
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition shadow-2xs h-9 ${
                    actionCompatibility.canRetry.length > 0 && !isProcessing && !isRetrying
                      ? 'bg-rose-950/80 hover:bg-rose-900 border-rose-700 text-rose-200 hover:text-white cursor-pointer'
                      : 'bg-stone-800/40 border-stone-800 text-stone-500 opacity-40 cursor-not-allowed'
                  }`}
                >
                  {isRetrying ? (
                    <Loader2 className="w-3.5 h-3.5 text-rose-400 animate-spin shrink-0" />
                  ) : (
                    <RotateCcw className={`w-3.5 h-3.5 ${actionCompatibility.canRetry.length > 0 ? 'text-rose-400' : 'text-stone-600'} shrink-0`} />
                  )}
                  <span>
                    {isRetrying ? 'Повторяем...' : `Повторить шаг${actionCompatibility.canRetry.length > 0 ? ` (${actionCompatibility.canRetry.length})` : ''}`}
                  </span>
                </button>
              )}

              {/* ACTION 5: Экспорт в Sheets / CSV / Docs (только для видео с идеями или сценариями) */}
              {onOpenExportIdeas && (
                <button
                  id="btn-batch-export-ideas"
                  type="button"
                  onClick={() => onOpenExportIdeas(actionCompatibility.canExport.map((v) => v.id))}
                  disabled={isProcessing || actionCompatibility.canExport.length === 0}
                  title={
                    actionCompatibility.canExport.length > 0
                      ? `Экспортировать банк идей и сценарии (${actionCompatibility.canExport.length} видео)`
                      : 'Недоступно: у выбранных видео пока нет банка идей или сценариев'
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition shadow-2xs h-9 ${
                    actionCompatibility.canExport.length > 0
                      ? 'bg-stone-800 hover:bg-stone-700 border-stone-700 text-stone-200 hover:text-white cursor-pointer'
                      : 'bg-stone-800/40 border-stone-800 text-stone-500 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <FileSpreadsheet className={`w-3.5 h-3.5 ${actionCompatibility.canExport.length > 0 ? 'text-emerald-400' : 'text-stone-600'}`} />
                  <span>Экспорт ({actionCompatibility.canExport.length})</span>
                </button>
              )}

              {/* ACTION 6: Остановить обработку (если хотя бы одно видео обрабатывается) */}
              {onBatchStop && actionCompatibility.canStop.length > 0 && (
                <button
                  id="btn-batch-stop"
                  type="button"
                  onClick={() => onBatchStop(actionCompatibility.canStop.map((v) => v.id))}
                  title={`Остановить обработку для ${actionCompatibility.canStop.length} активных видео`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-200 hover:text-white transition shadow-2xs h-9 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5 text-rose-400" />
                  <span>Остановить ({actionCompatibility.canStop.length})</span>
                </button>
              )}

              {/* MORE / OTHERS DROPDOWN MENU */}
              <div className="relative" ref={dropdownRef}>
                <button
                  ref={moreButtonRef}
                  type="button"
                  onClick={() => setIsMoreOpen(!isMoreOpen)}
                  disabled={isProcessing}
                  title="Дополнительные действия (Перепроверить, Архив, Удаление)"
                  className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border transition shadow-2xs disabled:opacity-60 cursor-pointer ${
                    isMoreOpen 
                      ? 'bg-stone-700 border-stone-500 text-white ring-2 ring-stone-500/50' 
                      : 'bg-stone-800 hover:bg-stone-700 border-stone-700 text-stone-300 hover:text-white'
                  }`}
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {/* Light backdrop overlay under the popup to block clicks through to background cards and easily close on tap */}
                {isMoreOpen && (
                  <div
                    className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] transition-opacity animate-in fade-in"
                    onClick={() => setIsMoreOpen(false)}
                    aria-hidden="true"
                  />
                )}

                {isMoreOpen && (
                  <div
                    className={`absolute z-50 w-64 bg-stone-900 border border-stone-700/90 rounded-2xl shadow-2xl py-1.5 text-xs text-stone-200 animate-in fade-in ${
                      popupPlacement.vertical === 'top' ? 'bottom-full mb-2.5' : 'top-full mt-2.5'
                    } ${
                      popupPlacement.horizontal === 'right' ? 'right-0' : 'left-0'
                    }`}
                  >
                    {/* Header in popup */}
                    <div className="px-3.5 py-1.5 border-b border-stone-800 text-[11px] font-semibold text-stone-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Действия ({selectedCount})</span>
                      <button
                        type="button"
                        onClick={() => setIsMoreOpen(false)}
                        className="text-stone-500 hover:text-stone-300 p-0.5 rounded cursor-pointer"
                        title="Закрыть меню"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Re-check filter */}
                    {onBatchRecheck && (
                      <button
                        type="button"
                        disabled={actionCompatibility.canRecheck.length === 0}
                        onClick={() => {
                          setIsMoreOpen(false);
                          handleBatchRecheckClick();
                        }}
                        className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between transition ${
                          actionCompatibility.canRecheck.length > 0
                            ? 'hover:bg-stone-800 text-stone-200 hover:text-white cursor-pointer'
                            : 'opacity-40 text-stone-500 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                          <span>Перепроверить фильтром</span>
                        </div>
                        <span className="text-[10px] text-stone-400 font-medium">({actionCompatibility.canRecheck.length})</span>
                      </button>
                    )}

                    {/* Retry failed step */}
                    {onBatchRetryStep && (
                      <button
                        type="button"
                        disabled={actionCompatibility.canRetry.length === 0 || isProcessing || isRetrying}
                        onClick={async () => {
                          setIsMoreOpen(false);
                          if (isProcessing || isRetrying || actionCompatibility.canRetry.length === 0) return;
                          setIsRetrying(true);
                          try {
                            await onBatchRetryStep(actionCompatibility.canRetry.map((v) => v.id));
                          } finally {
                            setIsRetrying(false);
                          }
                        }}
                        className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between transition ${
                          actionCompatibility.canRetry.length > 0 && !isProcessing && !isRetrying
                            ? 'hover:bg-stone-800 text-rose-300 hover:text-rose-200 cursor-pointer'
                            : 'opacity-40 text-stone-500 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                          <span>Повторить шаг</span>
                        </div>
                        <span className="text-[10px] text-rose-400 font-medium">({actionCompatibility.canRetry.length})</span>
                      </button>
                    )}

                    {/* Archive action */}
                    {onBatchArchive && (
                      <button
                        type="button"
                        disabled={actionCompatibility.canArchive.length === 0}
                        onClick={() => {
                          if (actionCompatibility.canArchive.length === 0) return;
                          setIsMoreOpen(false);
                          onBatchArchive(actionCompatibility.canArchive.map((v) => v.id), true);
                        }}
                        className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between transition ${
                          actionCompatibility.canArchive.length > 0
                            ? 'hover:bg-stone-800 text-stone-200 hover:text-white cursor-pointer'
                            : 'opacity-40 text-stone-500 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Archive className="w-3.5 h-3.5 text-amber-400" />
                          <span>В архив</span>
                        </div>
                        <span className="text-[10px] text-stone-400 font-medium">({actionCompatibility.canArchive.length})</span>
                      </button>
                    )}

                    {/* Destructive Action: Delete with distinct border separation */}
                    {onBatchDelete && (
                      <div className="mt-1 pt-1 border-t border-stone-800/90">
                        <button
                          type="button"
                          disabled={actionCompatibility.canDelete.length === 0}
                          onClick={() => {
                            if (actionCompatibility.canDelete.length === 0) return;
                            setIsMoreOpen(false);
                            onBatchDelete(actionCompatibility.canDelete.map((v) => v.id));
                          }}
                          className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between transition group ${
                            actionCompatibility.canDelete.length > 0
                              ? 'hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 cursor-pointer'
                              : 'opacity-40 text-stone-500 cursor-not-allowed'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Trash2 className="w-3.5 h-3.5 text-rose-500 group-hover:text-rose-400 transition" />
                            <span className="font-semibold">Удалить навсегда</span>
                          </div>
                          <span className="text-[10px] text-rose-400 font-medium">({actionCompatibility.canDelete.length})</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
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
    </div>
  );
};
