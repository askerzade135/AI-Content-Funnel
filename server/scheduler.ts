import { getDb, saveDb, addLog, StoredVideo, PromptRunRecord, syncVideoWithCurrentRun, getSettingsForOwner, getPromptTemplatesForOwner, getDefaultOwnerId } from './storage.js';
import { fetchChannelVideos, fetchChannelDeepVideos, extractVideoTranscript } from './youtube.js';
import { getGemini, PROMPT_TEMPLATES, generateWithFallback } from './gemini.js';
import { checkIfFilteredOut, extractFilterRejectionReason } from './filterCheck.js';
import { enqueueVideos } from './queue.js';
import { refreshRadarDiscovery, runRadarScan, publishPastRadarScripts } from './radar.js';

let intervalTimer: NodeJS.Timeout | null = null;
let publicationTimer: NodeJS.Timeout | null = null;
let isSyncRunning = false;

export async function processVideoPipeline(
  videoId: string,
  promptTemplate?: string,
  customPrompt?: string,
  signal?: AbortSignal,
  options?: { isPaidAuthorized?: boolean }
): Promise<StoredVideo> {
  const db = await getDb();
  const videoIndex = db.videos.findIndex((v) => v.id === videoId);

  if (videoIndex === -1) {
    throw new Error('Видео не найдено в базе данных');
  }

  const video = db.videos[videoIndex];
  const ownerId = video.ownerId || getDefaultOwnerId();
  const userSettings = getSettingsForOwner(db, ownerId);

  if (signal?.aborted) {
    throw new Error('Операция отменена пользователем');
  }

  const isAuthorized = options?.isPaidAuthorized ?? false;

  try {
    video.error = undefined;
    video.errorStage = undefined;
    if (video.rejectionCategory === 'transcription') {
      video.transcript = undefined;
      video.rejectionCategory = undefined;
      video.filterReason = undefined;
      video.matchedFilter = undefined;
    }

    // 1. Transcription step (Skip if transcript already exists)
    if (video.transcript && video.transcript.trim().length > 0) {
      await addLog('info', `Транскрипт уже существует для видео: "${video.title}", пропускаем повторную транскрибацию.`, { videoId: video.id, videoTitle: video.title, ownerId });
    } else {
      // Check if paid authorization is granted for audio fallback
      if (!isAuthorized) {
        // Attempt FREE subtitles extraction first
        await addLog('info', `Попытка извлечения бесплатных субтитров для видео: "${video.title}"`, { videoId: video.id, ownerId });
        let freeTranscript = null;
        try {
          freeTranscript = await extractVideoTranscript(video.id, video.title, {
            allowGeminiAudioFallback: false,
            ownerId,
          });
        } catch {
          freeTranscript = null;
        }

        if (freeTranscript && freeTranscript.text && freeTranscript.text.trim().length >= 50) {
          video.transcript = freeTranscript.text;
          video.transcriptSegments = freeTranscript.segments;
          video.transcriptSource = freeTranscript.source;
          video.status = 'transcribed';
          video.lastPassedStatus = 'transcribed';
          video.updatedAt = new Date().toISOString();
          await saveDb();
          await addLog('success', `Бесплатные субтитры успешно получены для: "${video.title}"`, { videoId: video.id, ownerId });
        } else {
          // Free subtitles missing! Paid Gemini audio transcription required
          video.status = 'requires_payment';
          video.pendingPaidAction = 'transcription';
          video.paidActionReason = 'Субтитры отсутствуют. Требуется подтверждение для платной аудио-расшифровки Gemini.';
          video.queueTimestamp = undefined;
          video.updatedAt = new Date().toISOString();
          await saveDb();
          await addLog('warn', `[Пауза] Видео "${video.title}" переведено в статус «requires_payment»: субтитры отсутствуют, требуется подтверждение платной расшифровки.`, { videoId: video.id, ownerId });
          return video;
        }
      } else {
        video.status = 'transcribing';
        video.error = undefined;
        video.updatedAt = new Date().toISOString();
        await saveDb();
        await addLog('info', `Начало транскрибации видео: "${video.title}"`, { videoId: video.id, videoTitle: video.title, ownerId });

        const transcriptResult = await extractVideoTranscript(video.id, video.title, {
          allowGeminiAudioFallback: true,
          forcePaidModel: video.forcePaidModel,
          ownerId,
        });
        
        // Check if stopped/reset by user DURING transcription
        if (signal?.aborted) {
          throw new Error('Операция отменена пользователем');
        }
        const checkDb = await getDb();
        const currentVideo = checkDb.videos.find((v) => v.id === videoId);
        if (!currentVideo || currentVideo.status !== 'transcribing') {
          await addLog('warn', `Обработка видео "${video.title}" была прервана пользователем во время транскрибации.`, { ownerId });
          return video;
        }

        if (!transcriptResult || !transcriptResult.text || transcriptResult.text.trim().length < 50) {
          throw new Error('Субтитры отсутствуют. Невозможно продолжить анализ');
        }

        video.transcript = transcriptResult.text;
        video.transcriptSegments = transcriptResult.segments;
        video.transcriptSource = transcriptResult.source;
      }
    }

    if (signal?.aborted) {
      throw new Error('Операция отменена пользователем');
    }

    // 2. Gemini processing step check
    const templateKey = promptTemplate || userSettings.defaultPromptTemplate || 'two_stage_pipeline';
    const isTwoStage = templateKey === 'two_stage_pipeline' || templateKey === 'instagram_editor';

    // If payment is not authorized, pause before paid Gemini call!
    if (!isAuthorized) {
      const pendingAction = (templateKey === 'scriptwriter_deep' || (video.matchedFilter === true && isTwoStage)) ? 'stage2' : 'stage1';
      video.status = 'requires_payment';
      video.pendingPaidAction = pendingAction;
      video.paidActionReason = pendingAction === 'stage2' 
        ? 'Требуется подтверждение для генерации покадрового сценария (Этап 2 / Gemini).'
        : 'Требуется подтверждение для запуска анализа и фильтра тем (Этап 1 / Gemini).';
      video.queueTimestamp = undefined;
      video.updatedAt = new Date().toISOString();
      await saveDb();
      await addLog('info', `[Пауза] Видео "${video.title}" переведено в статус «requires_payment»: ожидает подтверждения запуска ${video.paidActionReason}.`, { videoId: video.id, ownerId });
      return video;
    }

    // Authorized: Clear pending paid status and proceed
    video.pendingPaidAction = undefined;
    video.paidActionReason = undefined;
    video.status = 'processing_gemini';
    await saveDb();
    await addLog('info', `Отправка текста в Gemini AI для обработки: "${video.title}"`, { videoId: video.id, videoTitle: video.title, ownerId });

    let finalGeminiResult = '';
    let isFilteredOut = false;

    if (isTwoStage && (!customPrompt || !customPrompt.trim())) {
      // ===== STAGE 1: PROMPT-FILTER (Скрининг и быстрый отбор тем) =====
      await addLog('info', `[Этап 1/2: Промпт-Фильтр] Скрининг и отсев темы для: "${video.title}"`, { videoId: video.id, ownerId });
      
      const filterPromptText = `${PROMPT_TEMPLATES.filter_screener}

Данные видео:
Название: ${video.title}
Ссылка: ${video.url}
Канал: ${video.channelTitle}

Транскрипт видео:
${video.transcript.slice(0, 50000)}`;

      const filterResult = await generateWithFallback(
        [{ text: filterPromptText }],
        {
          signal,
          forcePaidModel: video.forcePaidModel,
          operation: 'stage1_filter',
          ownerId,
          videoId: video.id,
          videoTitle: video.title,
        }
      );
      if (signal?.aborted) {
        throw new Error('Операция отменена пользователем');
      }
      isFilteredOut = checkIfFilteredOut(filterResult);

      if (isFilteredOut) {
        const filterReason = extractFilterRejectionReason(filterResult);
        // Topic rejected by filter, stop here (save tokens, skip stage 2)
        finalGeminiResult = `🔍 [ЭТАП 1: ФИЛЬТР ТЕМ]\n${filterResult}\n\n⚠️ Тема не прошла отбор по критериям аккаунта. Генерация покадрового сценария пропущена.`;
        await addLog('warn', `[Фильтр] Видео "${video.title}" отклонено фильтром${filterReason ? `: ${filterReason}` : ''}`, { videoId: video.id, ownerId });
      } else {
        // Topic approved, proceed to STAGE 2
        await addLog('info', `[Этап 2/2: Промпт-Сценарист] Тема одобрена. Генерация покадрового сценария Reels/Shorts для: "${video.title}"`, { videoId: video.id, ownerId });

        const scriptPromptText = `${PROMPT_TEMPLATES.scriptwriter_deep}

Данные видео:
Название: ${video.title}
Ссылка: ${video.url}
Канал: ${video.channelTitle}

Результаты отбора и тезисы из Этапа 1 (Фильтр):
${filterResult}

Полный транскрипт видео:
${video.transcript.slice(0, 50000)}`;

        const scriptResult = await generateWithFallback(
          [{ text: scriptPromptText }],
          {
            signal,
            forcePaidModel: video.forcePaidModel,
            operation: 'stage2_script',
            ownerId,
            videoId: video.id,
            videoTitle: video.title,
          }
        );
        if (signal?.aborted) {
          throw new Error('Операция отменена пользователем');
        }
        finalGeminiResult = `🔍 [ЭТАП 1: ВЕРДИКТ ФИЛЬТРА]\n${filterResult}\n\n════════════════════════════════════\n🎬 [ЭТАП 2: ПОКАДРОВЫЙ СЦЕНАРИЙ REELS/SHORTS]\n════════════════════════════════════\n${scriptResult}`;
      }
    } else {
      // Single prompt execution (custom or specific template)
      const templates = getPromptTemplatesForOwner(db, ownerId);
      const foundTemplate = templates.find((t) => t.id === templateKey);
      let baseInstruction = foundTemplate ? foundTemplate.text : (PROMPT_TEMPLATES as any)[templateKey] || PROMPT_TEMPLATES.instagram_editor;
      if (customPrompt && customPrompt.trim()) {
        baseInstruction = customPrompt.trim();
      }

      const fullPrompt = `${baseInstruction}

Данные видео:
Название: ${video.title}
Ссылка: ${video.url}
Канал: ${video.channelTitle}

Транскрипт видео:
${video.transcript.slice(0, 50000)}`;

      finalGeminiResult = await generateWithFallback(
        [{ text: fullPrompt }],
        {
          signal,
          forcePaidModel: video.forcePaidModel,
          operation: templateKey || 'single_prompt',
          ownerId,
          videoId: video.id,
          videoTitle: video.title,
        }
      );
      if (signal?.aborted) {
        throw new Error('Операция отменена пользователем');
      }
      isFilteredOut = checkIfFilteredOut(finalGeminiResult);
      if (isFilteredOut) {
        const filterReason = extractFilterRejectionReason(finalGeminiResult);
        await addLog('warn', `[Фильтр] Видео "${video.title}" отклонено фильтром${filterReason ? `: ${filterReason}` : ''}`, { videoId: video.id, ownerId });
      }
    }

    if (signal?.aborted) {
      throw new Error('Операция отменена пользователем');
    }

    const rejectionReason = isFilteredOut ? (extractFilterRejectionReason(finalGeminiResult) || undefined) : undefined;

    const templates = getPromptTemplatesForOwner(db, ownerId);
    const promptDef = templates.find((t) => t.id === templateKey);
    const promptName = promptDef
      ? promptDef.name
      : templateKey === 'filter_screener'
      ? '🔍 Промпт 1: Фильтр тем и Банк идей'
      : templateKey === 'scriptwriter_deep'
      ? '🎬 Промпт 2: Покадровый сценарист Reels/Shorts'
      : templateKey === 'two_stage_pipeline'
      ? '⚡ 2-этапный конвейер: Фильтр → Покадровый сценарий'
      : templateKey;

    const isStage1Only = templateKey === 'filter_screener';
    const isStage2 = templateKey === 'scriptwriter_deep' || templateKey === 'reels_scenario';

    video.geminiResult = finalGeminiResult || 'Ответ от Gemini получен пустым.';
    video.geminiPromptTemplate = templateKey;
    video.customPromptUsed = customPrompt;
    video.matchedFilter = !isFilteredOut;
    video.filterReason = rejectionReason;
    video.status = 'completed';
    video.lastPassedStatus = !isFilteredOut ? (isStage2 ? 'has_script' : 'approved') : 'rejected';
    video.error = undefined;
    video.errorStage = undefined;
    video.processedAt = new Date().toISOString();
    video.queueTimestamp = undefined;
    video.retryCount = 0;
    video.lastErrorAt = undefined;
    video.updatedAt = new Date().toISOString();

    if (!db.scripts) db.scripts = [];

    // ONLY create a script entry in db.scripts if the video is NOT filtered out
    // AND the prompt was a scenario/script generator (NOT just a Stage 1 filter screener)
    if (!isFilteredOut && !isStage1Only) {
      db.scripts.unshift({
        id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ownerId,
        createdAt: new Date().toISOString(),
        title: `Сценарий: ${video.title}`,
        promptTemplate: templateKey,
        customPrompt: customPrompt || undefined,
        videoIds: [video.id],
        videoTitles: [video.title],
        content: video.geminiResult,
        matchedFilter: true,
        telegramSent: false,
      });
      video.scriptCount = db.scripts.filter(s => s.ownerId === ownerId && s.videoIds && s.videoIds.includes(video.id) && s.matchedFilter !== false).length;
    } else {
      video.scriptCount = db.scripts.filter(s => s.ownerId === ownerId && s.videoIds && s.videoIds.includes(video.id) && s.matchedFilter !== false).length;
    }

    const newRun: PromptRunRecord = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ownerId,
      stage: isStage2 ? 'stage2' : 'stage1',
      promptId: templateKey,
      promptName,
      promptTemplate: templateKey,
      customPrompt: customPrompt || undefined,
      timestamp: new Date().toISOString(),
      status: isFilteredOut ? 'rejected' : (isStage2 ? 'has_script' : 'approved'),
      result: video.geminiResult,
      matchedFilter: !isFilteredOut,
      filterReason: rejectionReason,
      scriptCount: video.scriptCount,
      isCurrent: true,
    };

    if (!video.promptRuns) video.promptRuns = [];
    for (const r of video.promptRuns) {
      r.isCurrent = false;
    }
    video.promptRuns.unshift(newRun);
    syncVideoWithCurrentRun(video);

    await saveDb();

    // If Telegram auto-send is enabled in settings
    if (userSettings.telegramAutoSend && !isStage1Only && !signal?.aborted) {
      if (isFilteredOut && userSettings.skipTelegramIfFilteredOut !== false) {
        await addLog('info', `Видео "${video.title}" не подошло под критерии фильтра. Публикация в Telegram пропущена.`, { ownerId });
      } else if (!isFilteredOut) {
        try {
          const { sendTelegramMessage } = await import('./telegram.js');
          const targetChat = userSettings.telegramChatId || process.env.TELEGRAM_CHAT_ID;
          await sendTelegramMessage(video.geminiResult, {
            chatId: targetChat,
            header: `🎬 *Новый анализ видео*\n📌 *${video.title}*\n📺 Канал: ${video.channelTitle}\n🔗 ${video.url}`,
          });
          await addLog('info', `Результат анализа "${video.title}" автоматически отправлен в Telegram`, { ownerId });
        } catch (tgErr: any) {
          console.error('Telegram auto-send error:', tgErr.message);
        }
      }
    }

    if (isFilteredOut) {
      await addLog('warn', `[Фильтр] Видео отклонено (не подходит под критерии): "${video.title}"`, { videoId: video.id, videoTitle: video.title, ownerId });
    } else if (isStage1Only) {
      await addLog('success', `[Этап 1: Фильтр] Видео успешно одобрено и сформирован банк идей: "${video.title}"`, { videoId: video.id, videoTitle: video.title, ownerId });
    } else {
      await addLog('success', `[Этап 2: Сценарий] Покадровый сценарий успешно создан: "${video.title}"`, { videoId: video.id, videoTitle: video.title, ownerId });
    }
    return video;
  } catch (err: any) {
    if (signal?.aborted || err?.message === 'Операция отменена пользователем') {
      console.log(`Pipeline cancelled by user for video: ${videoId}`);
      const db = await getDb();
      const current = db.videos.find((v) => v.id === videoId);
      if (current) {
        current.status = current.transcript && current.transcript.trim().length > 0 ? 'transcribed' : 'new';
        current.error = undefined;
        current.queueTimestamp = undefined;
        current.updatedAt = new Date().toISOString();
        await saveDb();
      }
      return video;
    }
    if (err.isQuotaExceeded) {
      console.warn(`Quota exceeded for ${videoId}`);
      video.status = 'quota_exceeded' as any;
      video.error = err.message || 'Лимит токенов исчерпан (429). Требуется оплата токенами.';
      video.errorStage = 'transcription';
      video.lastPassedStatus = 'new';
    } else if (err.isBotBlock || err.name === 'YouTubeBotBlockError' || (err.message && (err.message.includes('BotGuard') || err.message.includes('проверка на бота')))) {
      console.warn(`[BotGuard] YouTube blocked audio download for ${videoId}`);
      video.status = 'error';
      video.errorStage = 'transcription';
      video.rejectionCategory = 'transcription';
      video.error = 'YouTube заблокировал скачивание аудиопотока (защита BotGuard / проверка на бота). Рекомендуется использовать ключ Supadata в Настройках.';
      video.lastPassedStatus = 'new';
    } else {
      console.error(`Pipeline error for ${videoId}:`, err);
      video.status = 'error';
      video.error = err.message || 'Ошибка обработки';
      if (!video.transcript || video.transcript.trim().length === 0) {
        video.errorStage = 'transcription';
        video.lastPassedStatus = 'new';
      } else {
        video.errorStage = 'filter';
        video.lastPassedStatus = 'transcribed';
      }
    }
    video.retryCount = (video.retryCount || 0) + 1;
    video.lastErrorAt = new Date().toISOString();
    video.updatedAt = new Date().toISOString();
    await saveDb();
    await addLog('error', `Ошибка обработки видео "${video.title}": ${err.message}`, { videoId: video.id, videoTitle: video.title, ownerId });
    throw err;
  }
}

export async function runChannelsSync(checkAll = false, targetOwnerId?: string): Promise<{ newVideosFound: number; processedCount: number; channelsChecked: number }> {
  if (isSyncRunning) {
    console.log('Sync already in progress, skipping duplicate call.');
    return { newVideosFound: 0, processedCount: 0, channelsChecked: 0 };
  }

  isSyncRunning = true;
  let newVideosCount = 0;
  let processedCount = 0;

  try {
    const db = await getDb();
    if (!db.deletedVideos) db.deletedVideos = [];
    
    // Determine list of owners to sync
    let ownersToSync: string[] = [];
    if (targetOwnerId) {
      ownersToSync = [getDefaultOwnerId(targetOwnerId)];
    } else {
      const channelOwners = new Set<string>();
      (db.channels || []).forEach((c) => {
        if (c.ownerId) channelOwners.add(c.ownerId);
      });
      if (channelOwners.size === 0) {
        channelOwners.add(getDefaultOwnerId());
      }
      ownersToSync = Array.from(channelOwners);
    }

    let totalChannelsChecked = 0;

    for (const ownerId of ownersToSync) {
      const ownerSettings = getSettingsForOwner(db, ownerId);
      const ownerChannels = (db.channels || []).filter((c) => {
        const isOwner = c.ownerId === ownerId || (!c.ownerId && ownerId === getDefaultOwnerId());
        return isOwner && (checkAll ? true : c.autoSync !== false);
      });

      if (ownerChannels.length === 0) {
        continue;
      }

      totalChannelsChecked += ownerChannels.length;
      await addLog('info', `Запущена синхронизация каналов для владельца ${ownerId} (${ownerChannels.length} каналов)...`, { ownerId });

      let newlyAddedVideoIds: string[] = [];

      for (const channel of ownerChannels) {
        try {
          const { channelTitle, videos } = await fetchChannelDeepVideos(channel.id, 500);
          if (channelTitle && channelTitle !== 'Unknown Channel' && channelTitle !== 'YouTube Channel') {
            channel.title = channelTitle;
          }
          channel.lastCheckedAt = new Date().toISOString();

          let channelNewCount = 0;
          for (const videoItem of videos) {
            // Check if already in active videos for this owner
            const existing = db.videos.find((v) => v.id === videoItem.id && (v.ownerId === ownerId || (!v.ownerId && ownerId === getDefaultOwnerId())));
            if (existing) {
              if (videoItem.publishedAt && (!existing.publishedAt || existing.publishedAt.startsWith('2026-09-12T09:47'))) {
                existing.publishedAt = videoItem.publishedAt;
              }
              continue;
            }

            // Check if video was previously deleted by this owner
            const wasDeleted = db.deletedVideos?.find((dv) => dv.id === videoItem.id && (dv.ownerId === ownerId || (!dv.ownerId && ownerId === getDefaultOwnerId())));
            if (wasDeleted) {
              continue;
            }

            newVideosCount++;
            channelNewCount++;
            const newVideo: StoredVideo = {
              id: videoItem.id,
              ownerId,
              channelId: channel.id,
              channelTitle: channel.title,
              title: videoItem.title,
              url: videoItem.url,
              description: videoItem.description,
              thumbnail: videoItem.thumbnail,
              publishedAt: videoItem.publishedAt,
              status: 'new',
              updatedAt: new Date().toISOString(),
            };
            db.videos.unshift(newVideo);
            newlyAddedVideoIds.push(newVideo.id);
            await addLog('info', `Обнаружено новое видео: "${newVideo.title}" (${channel.title})`, {
              videoId: newVideo.id,
              videoTitle: newVideo.title,
              ownerId,
            });
          }

          channel.videoCount = db.videos.filter((v) => v.channelId === channel.id && (v.ownerId === ownerId || (!v.ownerId && ownerId === getDefaultOwnerId()))).length;
          if (channelNewCount > 0) {
            await addLog('info', `Канал "${channel.title}": добавлено ${channelNewCount} новых видео.`, { ownerId });
          }
        } catch (err: any) {
          console.error(`Failed to sync channel ${channel.title}:`, err);
          await addLog('warn', `Не удалось проверить канал "${channel.title}": ${err.message}`, { ownerId });
        }
      }

      ownerSettings.lastSyncRun = new Date().toISOString();
      const intervalMs = (ownerSettings.intervalHours || 24) * 60 * 60 * 1000;
      ownerSettings.nextSyncRun = new Date(Date.now() + intervalMs).toISOString();

      // If auto-process is enabled for this owner
      if (newlyAddedVideoIds.length > 0 && ownerSettings.autoProcessNewVideos) {
        const mode = ownerSettings.autoProcessMode || 'filter_screener';
        await addLog('info', `Синхронизация завершена. Добавляем ${newlyAddedVideoIds.length} новых видео в очередь фоновой обработки (${mode}, бесплатные шаги, с паузой перед платными)...`, { ownerId });
        const { enqueued } = await enqueueVideos(newlyAddedVideoIds, mode, undefined, false, ownerId);
        processedCount += enqueued;
      }
    }

    await saveDb();

    if (newVideosCount > 0) {
      await addLog(
        'success',
        `Синхронизация завершена. Добавлено новых видео: ${newVideosCount}.`,
      );
    } else {
      await addLog('info', 'Синхронизация завершена: новых видео на каналах не обнаружено.');
    }

    return { newVideosFound: newVideosCount, processedCount, channelsChecked: totalChannelsChecked };
  } catch (err: any) {
    console.error('Channel sync cycle error:', err);
    await addLog('error', `Критическая ошибка цикла синхронизации: ${err.message}`);
    return { newVideosFound: newVideosCount, processedCount, channelsChecked: 0 };
  } finally {
    isSyncRunning = false;
  }
}

export async function runDailyRadarRefresh(targetOwnerId?: string): Promise<{ ownersProcessed: number; discoveryAdded: number; opportunitiesCreated: number; errors: number }> {
  const db = await getDb();
  const targetId = targetOwnerId ? getDefaultOwnerId(targetOwnerId) : null;
  const profiles = Object.values(db.radarProfiles || {}).filter(
    (p) => Boolean(p?.onboardingCompletedAt) && (!targetId || p.ownerId === targetId)
  );
  let ownersProcessed = 0;
  let discoveryAdded = 0;
  let opportunitiesCreated = 0;
  let errors = 0;

  for (const profile of profiles) {
    try {
      const discovery = await refreshRadarDiscovery(profile.ownerId, { perQuery: 4 });
      discoveryAdded += Number(discovery?.added || 0);

      // Deep analysis stays user-controlled: only content explicitly marked Interesting
      // is eligible for the automatic scan.
      const scan = await runRadarScan(profile.ownerId, { limit: 8, selectedOnly: true });
      opportunitiesCreated += Number(scan?.run?.opportunitiesCreated || 0);
      ownersProcessed++;
      await addLog('success', `[Radar] Daily refresh: +${discovery?.added || 0} discovery candidates, +${scan?.run?.opportunitiesCreated || 0} opportunities.`, { ownerId: profile.ownerId });
    } catch (err: any) {
      errors++;
      console.error('[Radar] Daily refresh failed for owner', profile.ownerId, err);
      await addLog('warn', `[Radar] Daily refresh failed: ${err?.message || 'unknown error'}`, { ownerId: profile.ownerId });
    }
  }

  return { ownersProcessed, discoveryAdded, opportunitiesCreated, errors };
}

export function startBackgroundScheduler(): void {
  if (publicationTimer) clearInterval(publicationTimer);
  const publishPast = () => publishPastRadarScripts().catch(error => console.error('Publication status update failed:', error));
  void publishPast();
  publicationTimer = setInterval(publishPast, 60_000);

  if (intervalTimer) clearInterval(intervalTimer);

  // Check each owner's schedule independently every 30 minutes.
  intervalTimer = setInterval(async () => {
    try {
      const db = await getDb();
      const ownerIds = new Set<string>();

      for (const [ownerId, settings] of Object.entries(db.userSettings || {})) {
        if (settings?.dailySyncEnabled) ownerIds.add(getDefaultOwnerId(ownerId));
      }

      if (db.settings?.dailySyncEnabled) {
        ownerIds.add(getDefaultOwnerId(db.settings.ownerId));
      }

      const now = Date.now();
      for (const ownerId of ownerIds) {
        const settings = getSettingsForOwner(db, ownerId);
        if (!settings.dailySyncEnabled) continue;

        const nextRun = settings.nextSyncRun ? new Date(settings.nextSyncRun).getTime() : 0;
        if (Number.isFinite(nextRun) && now < nextRun) continue;

        console.log(`Scheduled sync triggered for owner ${ownerId}.`);
        await runChannelsSync(false, ownerId);
        await runDailyRadarRefresh(ownerId);

        // Advance this owner's schedule even when they have no tracked channels.
        settings.lastSyncRun = new Date().toISOString();
        const intervalMs = (settings.intervalHours || 24) * 60 * 60 * 1000;
        settings.nextSyncRun = new Date(Date.now() + intervalMs).toISOString();
        await saveDb();
      }
    } catch (e) {
      console.error('Scheduler tick error:', e);
    }
  }, 30 * 60 * 1000); // Check every 30 minutes
}
