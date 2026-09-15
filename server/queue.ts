import { getDb, saveDb, addLog, StoredVideo } from './storage.js';
import { extractVideoTranscript } from './youtube.js';
import { processVideoPipeline } from './scheduler.js';

export interface QueueJob {
  videoId: string;
  promptTemplate?: string;
  customPrompt?: string;
  isPaidAuthorized?: boolean;
}

export const serverPendingQueue: QueueJob[] = [];
export const serverActiveJobIds = new Set<string>();
export const activeAbortControllers = new Map<string, AbortController>();
let isServerQueueRunning = false;

export function cancelActiveJob(videoId: string): boolean {
  const controller = activeAbortControllers.get(videoId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(videoId);
    return true;
  }
  return false;
}

export async function enqueueVideos(
  videoIds: string[],
  promptTemplate?: string,
  customPrompt?: string,
  isPaidAuthorized: boolean = true
): Promise<{ enqueued: number; totalQueued: number }> {
  const db = await getDb();
  const now = new Date().toISOString();
  let count = 0;

  for (const id of videoIds) {
    const video = db.videos.find((v) => v.id === id);
    if (video) {
      video.error = undefined;
      if (video.status === 'error' || video.status === 'completed' || video.status === 'requires_payment') {
        video.status = video.transcript && video.transcript.trim().length > 0 ? 'transcribed' : 'new';
      }
      video.queueTimestamp = now;
      video.updatedAt = now;
    }

    if (!serverActiveJobIds.has(id) && !serverPendingQueue.some((q) => q.videoId === id)) {
      serverPendingQueue.push({ videoId: id, promptTemplate, customPrompt, isPaidAuthorized });
      count++;
    }
  }

  await saveDb();
  if (isServerQueueRunning && serverActiveJobIds.size === 0) {
    isServerQueueRunning = false;
  }
  // Start queue processing worker in background
  startServerQueueWorker().catch((err) => console.error('Queue worker error:', err));

  return { enqueued: count, totalQueued: serverPendingQueue.length };
}

export async function startServerQueueWorker() {
  if (isServerQueueRunning) {
    if (serverActiveJobIds.size === 0 && serverPendingQueue.length > 0) {
      isServerQueueRunning = false;
    } else {
      return;
    }
  }
  isServerQueueRunning = true;
  const concurrency = 2;

  const worker = async () => {
    while (serverPendingQueue.length > 0) {
      const job = serverPendingQueue.shift();
      if (!job) break;

      const db = await getDb();
      const video = db.videos.find((v) => v.id === job.videoId);
      if (!video) continue;

      const abortController = new AbortController();
      activeAbortControllers.set(job.videoId, abortController);
      serverActiveJobIds.add(job.videoId);
      try {
        const processMode = job.promptTemplate || db.settings.autoProcessMode || 'filter_screener';

        if (processMode === 'transcription_only') {
          if (video.rejectionCategory === 'transcription') {
            video.transcript = undefined;
            video.rejectionCategory = undefined;
            video.filterReason = undefined;
            video.matchedFilter = undefined;
          }

          let transcriptResult = null;
          if (!job.isPaidAuthorized && (!video.transcript || video.transcript.trim().length < 50)) {
            // Attempt free subtitles first
            try {
              transcriptResult = await extractVideoTranscript(video.id, video.title, {
                allowGeminiAudioFallback: false,
              });
            } catch {
              transcriptResult = null;
            }

            if (!transcriptResult || !transcriptResult.text || transcriptResult.text.trim().length < 50) {
              video.status = 'requires_payment';
              video.pendingPaidAction = 'transcription';
              video.paidActionReason = 'Субтитры отсутствуют. Требуется подтверждение платной аудио-расшифровки Gemini.';
              video.queueTimestamp = undefined;
              video.updatedAt = new Date().toISOString();
              await saveDb();
              await addLog('warn', `[Пауза очереди] Видео "${video.title}" переведено в «requires_payment»: отсутствуют бесплатные субтитры.`);
              continue;
            }
          } else {
            transcriptResult = await extractVideoTranscript(video.id, video.title, {
              allowGeminiAudioFallback: true,
              forcePaidModel: video.forcePaidModel,
            });
          }

          if (abortController.signal.aborted) {
            continue;
          }
          if (!transcriptResult || !transcriptResult.text || transcriptResult.text.trim().length < 50) {
            throw new Error('Субтитры отсутствуют. Невозможно продолжить анализ');
          }

          video.transcript = transcriptResult.text;
          video.transcriptSegments = transcriptResult.segments;
          video.transcriptSource = transcriptResult.source;
          video.status = 'transcribed';
          video.lastPassedStatus = 'transcribed';
          video.pendingPaidAction = undefined;
          video.paidActionReason = undefined;
          video.matchedFilter = undefined;
          video.filterReason = undefined;
          video.rejectionCategory = undefined;
          video.updatedAt = new Date().toISOString();
          await saveDb();
          await addLog('info', `Расшифровка завершена для: "${video.title}" (без вызова Gemini)`, { videoId: video.id });

        } else {
          await processVideoPipeline(job.videoId, processMode, job.customPrompt, abortController.signal, {
            isPaidAuthorized: job.isPaidAuthorized ?? false,
          });
        }

        // Pause between tasks to respect Gemini rate limits
        if (!abortController.signal.aborted) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (e: any) {
        if (abortController.signal.aborted || e?.message === 'Операция отменена пользователем') {
          console.log(`Job ${job.videoId} was stopped by user.`);
        } else {
          console.error(`Queue item failed: ${job.videoId}`, e.message);
          
          if (video) {
             if (e.isQuotaExceeded) {
                video.status = 'quota_exceeded' as any;
                video.error = e.message || 'Лимит токенов исчерпан (429). Требуется оплата токенами.';
             } else {
                video.status = 'error';
                video.error = e.message || 'Ошибка обработки';
             }
             if (!video.transcript || video.transcript.trim().length === 0) {
               video.errorStage = 'transcription';
               video.lastPassedStatus = 'new';
             }
             video.updatedAt = new Date().toISOString();
             getDb().then(db => {
               const v = db.videos.find(x => x.id === video.id);
               if (v) {
                 Object.assign(v, { status: video.status, error: video.error, errorStage: video.errorStage, lastPassedStatus: video.lastPassedStatus, updatedAt: video.updatedAt });
                 saveDb().catch(console.error);
               }
             }).catch(console.error);
          }
        }
      } finally {
        activeAbortControllers.delete(job.videoId);
        serverActiveJobIds.delete(job.videoId);
      }
    }
  };

  try {
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
  } finally {
    isServerQueueRunning = false;
  }
}
