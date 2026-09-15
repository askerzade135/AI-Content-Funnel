import { StoredVideo, VideoStatus } from '../types';
import { checkIfFilteredOut } from './filterCheck';

/**
 * Standard video processing statuses
 */
export const VIDEO_STATUS: Record<string, VideoStatus> = {
  NEW: 'new',
  TRANSCRIBE_QUEUED: 'transcribe_queued',
  TRANSCRIBING: 'transcribing',
  TRANSCRIBED: 'transcribed',
  PROCESSING_GEMINI: 'processing_gemini',
  COMPLETED: 'completed',
  ERROR: 'error',
  QUOTA_EXCEEDED: 'quota_exceeded',
  REQUIRES_PAYMENT: 'requires_payment',
} as const;

/**
 * Higher-level scenario workflow statuses used in UI tabs and cards
 */
export const SCENARIO_STATUS = {
  REVIEWED: 'reviewed',
  HAS_SCRIPT: 'has_script',
  STAGE1_APPROVED: 'stage1_approved',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  UNPROCESSED: 'unprocessed',
  NO_SCRIPT: 'no_script',
  TRANSCRIBED: 'transcribed',
  ERROR: 'error',
  PROCESSING: 'processing',
  QUOTA_EXCEEDED: 'quota_exceeded',
  REQUIRES_PAYMENT: 'requires_payment',
} as const;

export type ScenarioStatusType = typeof SCENARIO_STATUS[keyof typeof SCENARIO_STATUS];

/**
 * Pipeline error stages
 */
export const ERROR_STAGE = {
  TRANSCRIPTION: 'transcription',
  FILTER: 'filter',
  SCRIPT: 'script',
} as const;

/**
 * Check whether a video has a valid, non-empty, genuine transcript
 * (not a placeholder refusal like "не имею прямого доступа к интернету").
 */
export function hasValidTranscript(video: StoredVideo): boolean {
  if (!video.transcript) return false;
  const text = video.transcript.trim();
  if (text.length < 50) return false;
  if (
    text.includes('не имею прямого доступа к интернету') ||
    text.includes('нет прямого доступа к интернету') ||
    text.includes('Скопируйте автосубтитры с YouTube')
  ) {
    return false;
  }
  return true;
}

/**
 * Check whether video is currently being processed by an active pipeline/worker
 */
export function isProcessing(video: StoredVideo): boolean {
  return video.status === 'transcribing' || video.status === 'processing_gemini';
}

/**
 * Check whether video is waiting in queue for automatic transcription
 */
export function isQueued(video: StoredVideo): boolean {
  return video.status === 'transcribe_queued';
}

/**
 * Check whether a video encountered an error (error status, quota exceeded, or explicit error message)
 */
export function hasError(video: StoredVideo): boolean {
  const isErrorStatus = video.status === 'error' || video.status === 'quota_exceeded';
  const hasErrorMsg = Boolean(video.error && video.error.trim().length > 0);
  const isTranscriptRejection = video.rejectionCategory === 'transcription';
  return isErrorStatus || hasErrorMsg || isTranscriptRejection;
}

/**
 * Check whether a video can be retried after a failed step.
 * Matches criteria: has error / quota exceeded / transcript rejection, and not currently in progress.
 */
export function canRetry(video: StoredVideo): boolean {
  const hasErr = hasError(video);
  const isNotCurrentlyWorking =
    video.status !== 'transcribing' &&
    video.status !== 'processing_gemini' &&
    video.status !== 'transcribe_queued';

  return hasErr && isNotCurrentlyWorking;
}

/**
 * Check whether a video needs and can undergo transcription
 * (missing or < 50 chars transcript, and not currently working or queued).
 */
export function canTranscribe(video: StoredVideo): boolean {
  if (video.status === 'requires_payment' && video.pendingPaidAction === 'transcription') {
    return true;
  }
  const hasNoText = !video.transcript || video.transcript.trim().length < 50;
  const isNotCurrentlyWorking =
    video.status !== 'transcribe_queued' && video.status !== 'transcribing';
  return hasNoText && isNotCurrentlyWorking;
}

/**
 * Check whether Stage 1 (Filter Screener) can be run on the video
 */
export function canRunStage1(video: StoredVideo): boolean {
  if (video.status === 'requires_payment' && (video.pendingPaidAction === 'stage1' || video.lastPassedStatus === 'transcribed' || !video.pendingPaidAction)) {
    return true;
  }
  const isReadyForFilter = video.status === 'transcribed' || video.status === 'new';
  const isFilterError = video.status === 'error' && video.errorStage === 'filter';
  const isNotEvaluated =
    video.matchedFilter === undefined &&
    video.status !== 'processing_gemini' &&
    video.status !== 'transcribing';
  return isReadyForFilter || isFilterError || isNotEvaluated;
}

/**
 * Check whether Stage 2 (Scriptwriter) can be run on the video
 */
export function canRunStage2(video: StoredVideo): boolean {
  if (video.status === 'requires_payment' && (video.pendingPaidAction === 'stage2' || video.lastPassedStatus === 'approved')) {
    return true;
  }
  const isApproved = video.matchedFilter === true || video.lastPassedStatus === 'approved';
  const isScriptError =
    video.status === 'error' &&
    (video.errorStage === 'script' || video.lastPassedStatus === 'approved');
  return (isApproved || isScriptError) && video.status !== 'processing_gemini';
}

/**
 * Check whether the Telegram pipeline can be triggered for the video
 */
export function canRunPipeline(video: StoredVideo): boolean {
  return video.status !== 'transcribing' && video.status !== 'processing_gemini';
}

/**
 * Check whether ideas or scripts can be exported for the video
 */
export function canExportIdeas(video: StoredVideo): boolean {
  const hasIdeas = Boolean(video.geminiResult && video.geminiResult.trim().length > 0);
  const hasScripts = Boolean(
    (video.scriptCount && video.scriptCount > 0) || video.lastPassedStatus === 'has_script'
  );
  return hasIdeas || hasScripts;
}

/**
 * Check whether the filter screening verdict can be re-checked
 */
export function canRecheckFilter(video: StoredVideo): boolean {
  if (isProcessing(video)) return false;
  const hasEverBeenEvaluated =
    video.matchedFilter !== undefined ||
    video.lastPassedStatus === 'approved' ||
    video.lastPassedStatus === 'rejected' ||
    Boolean(video.geminiResult && video.geminiResult.trim().length > 0);
  const hasTranscript = Boolean(video.transcript && video.transcript.trim().length > 0);
  return hasTranscript || hasEverBeenEvaluated;
}

/**
 * Check whether a video can be manually approved (moved to Stage 1 approved)
 */
export function canApprove(video: StoredVideo): boolean {
  if (isProcessing(video)) return false;
  return video.matchedFilter !== true;
}

/**
 * Check whether a video can be manually rejected
 */
export function canReject(video: StoredVideo): boolean {
  if (isProcessing(video)) return false;
  return video.matchedFilter !== false;
}

/**
 * Check whether a video can be archived or unarchived
 */
export function canArchive(video: StoredVideo): boolean {
  return !isProcessing(video);
}

/**
 * Check whether a video can be deleted
 */
export function canDelete(video: StoredVideo): boolean {
  return !isProcessing(video);
}

/**
 * Check whether a video is rate-limited (quota exceeded or 429 error)
 */
export function isRateLimited(video: StoredVideo): boolean {
  if (video.status === 'quota_exceeded') return true;
  if (video.status === 'error' && video.error) {
    const err = video.error.toLowerCase();
    return err.includes('quota') || err.includes('resource_exhausted') || video.error.includes('429');
  }
  return false;
}

/**
 * Check whether a video is eligible to remain or be placed in the processing queue
 */
export function isEligibleForQueue(video: StoredVideo): boolean {
  return video.status !== 'completed' && video.status !== 'error' && video.status !== 'quota_exceeded';
}

/**
 * Check whether a video was rejected by Stage 1 filter (explicitly or via AI output)
 */
export function isRejectedFilter(video: StoredVideo): boolean {
  return video.matchedFilter === false || checkIfFilteredOut(video.geminiResult);
}

/**
 * Check whether additional ideas/angles can be searched in the transcript
 */
export function canFindMoreIdeas(video: StoredVideo): boolean {
  return !isProcessing(video) && Boolean(video.transcript && video.transcript.trim().length > 0);
}

/**
 * Check whether interactive chat with Gemini is available for this video
 */
export function canChat(video: StoredVideo): boolean {
  return Boolean(video.transcript && video.transcript.trim().length > 0);
}

/**
 * Check whether an ongoing process on the video can be stopped
 */
export function canStop(video: StoredVideo): boolean {
  return (
    video.status === 'transcribing' ||
    video.status === 'processing_gemini' ||
    video.status === 'transcribe_queued'
  );
}

/**
 * Check whether a video was rejected because of a missing or invalid transcript
 */
export function isMissingTranscriptRejection(video: StoredVideo): boolean {
  if (video.rejectionCategory === 'transcription') return true;
  if (!hasValidTranscript(video)) return true;
  if (
    video.filterReason &&
    (video.filterReason.includes('Нет текста') ||
      video.filterReason.includes('транскрипция не дала результата') ||
      video.filterReason.includes('не является транскриптом') ||
      video.filterReason.includes('нет прямого доступа к интернету') ||
      video.filterReason.includes('предоставленный текст') ||
      video.filterReason.includes('техническое сообщение'))
  ) {
    return true;
  }
  return false;
}

/**
 * Get human-readable localized label for an error stage
 */
export function getErrorStageLabel(video: StoredVideo): string {
  if (video.errorStage === 'transcription') return 'Ошибка транскрипции';
  if (video.errorStage === 'filter') return 'Ошибка 1 этапа (Фильтр)';
  if (video.errorStage === 'script') return 'Ошибка 2 этапа (Сценарий)';
  return 'Ошибка';
}

/**
 * Supported paid action types in the application
 */
export type PaidActionType = 
  | 'transcription' 
  | 'stage1' 
  | 'filter' 
  | 'stage2' 
  | 'script' 
  | 'pipeline' 
  | 'retry'
  | 'find_more_ideas';

/**
 * Check if a video requires payment / authorization before continuing
 */
export function isRequiresPayment(video: StoredVideo): boolean {
  return video.status === 'requires_payment';
}

/**
 * Estimate how many videos in the given list will actually trigger a paid API call.
 * Videos that already have transcripts, evaluated filter results, or scripts
 * are ignored according to the action type.
 *
 * @param actionType The paid action being performed
 * @param videos The list of candidate videos
 * @returns Number of videos requiring paid API calls
 */
export function estimateCost(actionType: PaidActionType, videos: StoredVideo[]): number {
  if (!videos || videos.length === 0) return 0;

  return videos.filter((video) => {
    switch (actionType) {
      case 'transcription':
        // If video explicitly requires payment for transcription, or has no valid transcript
        if (video.status === 'requires_payment' && video.pendingPaidAction === 'transcription') return true;
        return !hasValidTranscript(video);

      case 'stage1':
      case 'filter':
        // If video requires payment for stage 1, or hasn't finished screening
        if (video.status === 'requires_payment' && (video.pendingPaidAction === 'stage1' || !video.pendingPaidAction)) return true;
        const hasStage1Result = Boolean(video.geminiResult && video.geminiResult.trim().length > 0) && video.matchedFilter !== undefined;
        return !hasStage1Result;

      case 'stage2':
      case 'script':
        // If video requires payment for stage 2, or has no script
        if (video.status === 'requires_payment' && video.pendingPaidAction === 'stage2') return true;
        const hasScript = (video.scriptCount !== undefined && video.scriptCount > 0) || video.lastPassedStatus === 'has_script';
        return !hasScript;

      case 'pipeline':
        // Full pipeline will trigger paid calls unless already fully reviewed with a script
        const isFinished = video.isReviewed || ((video.scriptCount ?? 0) > 0 && video.matchedFilter !== undefined);
        return !isFinished;

      case 'retry':
        // Retrying is for videos with errors or rate limits, each will trigger a paid call
        return hasError(video) || isRateLimited(video) || isRequiresPayment(video);

      case 'find_more_ideas':
        // Finding more ideas always triggers an AI query
        return true;

      default:
        return true;
    }
  }).length;
}

/**
 * Human-readable metadata for each paid action type
 */
export function getPaidActionDetails(actionType: PaidActionType, count: number) {
  switch (actionType) {
    case 'transcription':
      return {
        title: count === 1 ? 'Подтверждение транскрипции' : `Подтверждение транскрипции (${count} видео)`,
        description: count === 1 
          ? 'Для данного видео отсутствует готовый текст. Будет запущен процесс получения расшифровки (субтитры или Gemini AI).'
          : `Для ${count} видео отсутствует готовый текст. Будет запущен процесс расшифровки (субтитры или Gemini AI).`,
        badgeText: 'Транскрипция',
        badgeColor: 'sky' as const,
      };
    case 'stage1':
    case 'filter':
      return {
        title: count === 1 ? 'Подтверждение Этапа 1 (Фильтр тем)' : `Подтверждение Этапа 1 (${count} видео)`,
        description: count === 1
          ? 'Будет выполнен AI-скрининг ролика моделью Gemini: проверка соответствия теме и составление банка идей и хуков.'
          : `Будет выполнен AI-скрининг для ${count} видео моделью Gemini: проверка соответствия теме и составление банка идей и хуков.`,
        badgeText: 'Этап 1 / Фильтр',
        badgeColor: 'emerald' as const,
      };
    case 'stage2':
    case 'script':
      return {
        title: count === 1 ? 'Подтверждение Этапа 2 (Сценарий)' : `Подтверждение генерации сценариев (${count} видео)`,
        description: count === 1
          ? 'Будет сгенерирован полноценный покадровый сценарий Reels/Shorts на основе одобренных идей с помощью Gemini AI.'
          : `Будет сгенерирован покадровый сценарий Reels/Shorts для ${count} видео на основе одобренных идей с помощью Gemini AI.`,
        badgeText: 'Этап 2 / Сценарий',
        badgeColor: 'indigo' as const,
      };
    case 'pipeline':
      return {
        title: count === 1 ? 'Подтверждение авто-конвейера' : `Подтверждение авто-конвейера (${count} видео)`,
        description: count === 1
          ? 'Будет запущен сквозной цикл: Транскрипция ➔ Фильтр Gemini ➔ Сценарий ➔ Telegram.'
          : `Будет запущен сквозной цикл для ${count} видео: Транскрипция ➔ Фильтр Gemini ➔ Сценарий ➔ Telegram.`,
        badgeText: 'Авто-конвейер',
        badgeColor: 'indigo' as const,
      };
    case 'retry':
      return {
        title: count === 1 ? 'Подтверждение повтора шага' : `Подтверждение повтора шага (${count} видео)`,
        description: count === 1
          ? 'Повторный запуск шага, завершившегося с ошибкой или лимитом квоты.'
          : `Повторный запуск шагов с ошибками для ${count} видео.`,
        badgeText: 'Повтор шага',
        badgeColor: 'amber' as const,
      };
    case 'find_more_ideas':
      return {
        title: 'Поиск дополнительных идей',
        description: 'Будет выполнен запрос к Gemini AI для поиска свежих неиспользованных углов и идей из транскрипта.',
        badgeText: 'Банк идей',
        badgeColor: 'emerald' as const,
      };
    default:
      return {
        title: `Подтверждение операции (${count} видео)`,
        description: `Будет запущена платная операция для ${count} видео.`,
        badgeText: 'Платная операция',
        badgeColor: 'indigo' as const,
      };
  }
}
