import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

import { getDb, saveDb, addLog, GeneratedScript, StoredVideo, getGeminiUsageStats24h, getSupadataUsageStats, PromptRunRecord, syncVideoWithCurrentRun, resolveOwnerId, getChannelsForOwner, getVideosForOwner, getScriptsForOwner, getDeletedVideosForOwner, getLogsForOwner, getSettingsForOwner, saveSettingsForOwner, getPromptTemplatesForOwner, getChocodataUsageStats, getTranscriptUsageStats, LEGACY_OWNER_ID } from './server/storage.js';
import { resolveChannelId, fetchChannelVideos, fetchChannelDeepVideos, fetchSingleVideoInfo, extractVideoId, extractVideoTranscript, fetchVideoExactPublishDate } from './server/youtube.js';
import { processVideoPipeline, runChannelsSync, startBackgroundScheduler } from './server/scheduler.js';
import { serverPendingQueue, serverActiveJobIds, startServerQueueWorker, enqueueVideos, cancelActiveJob } from './server/queue.js';
import { getGemini, PROMPT_TEMPLATES, generateWithFallback, DEFAULT_PROMPT_DEFINITIONS, PromptTemplateDef } from './server/gemini.js';
import { getTelegramEnvConfig, getTelegramBotInfo, testTelegram, sendTelegramMessage } from './server/telegram.js';
import { checkIfFilteredOut, extractFilterRejectionReason } from './server/filterCheck.js';
import { testSupadataConnection, getSupadataCombinedUsage } from './server/supadata.js';
import { testChocodataConnection } from './server/chocodata.js';
import { requireAuth } from './server/auth.js';
import { getUserQuota } from './server/quotas.js';

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Public health check route
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  // Authentication check and current user profile endpoint
  app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
      const db = await getDb();
      const effectiveOwnerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      res.json({
        authenticated: true,
        user: req.user,
        effectiveOwnerId,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Apply requireAuth middleware to protect all remaining /api/* endpoints
  app.use('/api', requireAuth);

  app.get('/api/transcript-usage', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      res.json(await getTranscriptUsageStats(ownerId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get current state / stats
  app.get('/api/stats', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const ownerVideos = getVideosForOwner(db, ownerId);
      const ownerChannels = getChannelsForOwner(db, ownerId);
      const ownerScripts = getScriptsForOwner(db, ownerId);
      const ownerSettings = getSettingsForOwner(db, ownerId);

      const completedCount = ownerVideos.filter((v) => v.status === 'completed').length;
      const pendingCount = ownerVideos.filter((v) => v.status === 'new' || v.status === 'transcribed').length;

      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      const processed24hVideos = ownerVideos.filter((v) => {
        if (v.status !== 'completed' && !v.geminiResult) return false;
        const timeStr = v.processedAt || v.updatedAt;
        if (!timeStr) return false;
        const t = new Date(timeStr).getTime();
        return !isNaN(t) && t >= oneDayAgo;
      });

      const processedVideos24h = processed24hVideos.length;
      const approvedVideos24h = processed24hVideos.filter((v) => v.matchedFilter === true).length;
      const rejectedVideos24h = processed24hVideos.filter((v) => v.matchedFilter === false).length;

      const scripts24hList = ownerScripts.filter((s) => {
        if (!s.createdAt) return false;
        const t = new Date(s.createdAt).getTime();
        return !isNaN(t) && t >= oneDayAgo;
      });
      const generatedScripts24h = scripts24hList.length;
      const telegramSentScripts24h = scripts24hList.filter((s) => s.telegramSent).length;

      const geminiUsage24h = await getGeminiUsageStats24h(ownerId);
      const supadataUsage = await getSupadataCombinedUsage(ownerId);
      const chocodataUsage = await getChocodataUsageStats(ownerId);

      res.json({
        channelCount: ownerChannels.length,
        totalVideos: ownerVideos.length,
        completedCount,
        pendingCount,
        dailyActivity: {
          processedVideos24h,
          generatedScripts24h,
          approvedVideos24h,
          rejectedVideos24h,
          telegramSentScripts24h,
          geminiUsage24h,
          supadataUsage,
          chocodataUsage,
        },
        geminiUsage24h,
        supadataUsage,
        chocodataUsage,
        dailySyncEnabled: ownerSettings.dailySyncEnabled,
        lastSyncRun: ownerSettings.lastSyncRun,
        nextSyncRun: ownerSettings.nextSyncRun,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Product quotas are user-facing and independent from provider quotas.
  app.get('/api/quotas', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      res.json(await getUserQuota(ownerId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dedicated Supadata usage stats endpoint
  app.get('/api/supadata/usage', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const stats = await getSupadataCombinedUsage(ownerId);
      const recentLogs = (db.supadataUsageLogs || []).filter((l) => l.ownerId === ownerId || (!l.ownerId && ownerId === 'legacy-account-1')).slice(-30).reverse();
      res.json({
        ...stats,
        recentLogs,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dedicated ChocoData usage stats endpoint
  app.get('/api/chocodata/usage', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const stats = await getChocodataUsageStats(ownerId);
      const recentLogs = (db.chocodataUsageLogs || []).filter((l) => l.ownerId === ownerId || (!l.ownerId && ownerId === 'legacy-account-1')).slice(-30).reverse();
      res.json({
        ...stats,
        recentLogs,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Consolidated Transcript Providers usage endpoint
  app.get('/api/transcript-providers/usage', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const supadataStats = await getSupadataCombinedUsage(ownerId);
      const chocodataStats = await getChocodataUsageStats(ownerId);

      const providers = [
        {
          id: 'supadata',
          name: 'Supadata API',
          levelTag: 'Уровень Б',
          planBadge: supadataStats.planName || 'Free (100/mo)',
          used: supadataStats.usedThisMonth,
          limit: supadataStats.monthlyLimit || 100,
          remaining: supadataStats.remainingThisMonth,
          resetPolicy: 'monthly' as const,
          usedLast24h: supadataStats.usedLast24h,
          isLimitExceeded: supadataStats.isLimitExceeded || supadataStats.usedThisMonth >= (supadataStats.monthlyLimit || 100),
          isLiveAccount: supadataStats.isLiveAccount,
          fallbackTargetName: 'ChocoData (Уровень Б2)',
          unitLabel: 'кредитов',
        },
        {
          id: 'chocodata',
          name: 'ChocoData API',
          levelTag: 'Уровень Б2',
          planBadge: 'Разовый пакет (~200)',
          used: chocodataStats.usedTotal,
          limit: chocodataStats.totalLimit || 200,
          remaining: chocodataStats.remainingTotal,
          resetPolicy: 'never' as const,
          usedLast24h: chocodataStats.usedLast24h,
          isLimitExceeded: chocodataStats.isLimitExceeded || chocodataStats.usedTotal >= (chocodataStats.totalLimit || 200),
          fallbackTargetName: 'Gemini AI Audio (Уровень В)',
          unitLabel: 'транскрипций',
        },
      ];

      res.json({ providers });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dedicated Gemini usage stats endpoint
  app.get('/api/gemini/usage', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const stats = await getGeminiUsageStats24h(ownerId);
      const recentLogs = (db.geminiUsageLogs || []).filter((l) => l.ownerId === ownerId || (!l.ownerId && ownerId === 'legacy-account-1')).slice(-50).reverse();
      res.json({
        ...stats,
        recentLogs,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Channels
  app.get('/api/channels', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      res.json(getChannelsForOwner(db, ownerId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/channels', async (req, res) => {
    try {
      const { input } = req.body;
      if (!input || typeof input !== 'string') {
        return res.status(400).json({ error: 'Укажите ссылку на канал, имя (@handle) или ID канала' });
      }

      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const channelInfo = await resolveChannelId(input);

      let channel = db.channels.find((c) => c.id === channelInfo.channelId && (c.ownerId === ownerId || (!c.ownerId && ownerId === 'legacy-account-1')));
      if (!channel) {
        channel = {
          id: channelInfo.channelId,
          ownerId,
          title: channelInfo.title,
          handle: channelInfo.handle,
          avatarUrl: channelInfo.avatarUrl,
          url: `https://www.youtube.com/channel/${channelInfo.channelId}`,
          autoSync: true,
          createdAt: new Date().toISOString(),
        };
        db.channels.push(channel);
      } else {
        channel.ownerId = ownerId;
        channel.title = channelInfo.title || channel.title;
        if (channelInfo.avatarUrl) channel.avatarUrl = channelInfo.avatarUrl;
      }

      // Automatically fetch all videos from channel (up to 500)
      const { channelTitle, videos } = await fetchChannelDeepVideos(channel.id, 500);
      if (channelTitle && channelTitle !== 'Unknown Channel' && channelTitle !== 'YouTube Channel') {
        channel.title = channelTitle;
      }
      channel.lastCheckedAt = new Date().toISOString();

      if (!db.deletedVideos) db.deletedVideos = [];
      const newVideosToAdd: StoredVideo[] = [];
      const previouslyDeletedFound: any[] = [];

      for (const v of videos) {
        if (db.videos.some((existing) => existing.id === v.id && (existing.ownerId === ownerId || (!existing.ownerId && ownerId === 'legacy-account-1')))) {
          continue;
        }

        const wasDeleted = db.deletedVideos.find((dv) => dv.id === v.id && (dv.ownerId === ownerId || (!dv.ownerId && ownerId === 'legacy-account-1')));
        if (wasDeleted) {
          if (!wasDeleted.permanentlyIgnored) {
            previouslyDeletedFound.push({
              id: v.id,
              ownerId,
              title: v.title,
              channelId: channel.id,
              channelTitle: channel.title,
              thumbnail: v.thumbnail,
              publishedAt: v.publishedAt,
              deletedAt: wasDeleted.deletedAt,
            });
          }
          continue;
        }

        newVideosToAdd.push({
          id: v.id,
          ownerId,
          channelId: channel.id,
          channelTitle: channel.title,
          title: v.title,
          url: v.url,
          description: v.description,
          thumbnail: v.thumbnail,
          publishedAt: v.publishedAt,
          status: 'new',
          updatedAt: new Date().toISOString(),
        });
      }
      db.videos = [...newVideosToAdd, ...db.videos];
      const addedCount = newVideosToAdd.length;
      channel.videoCount = db.videos.filter((v) => v.channelId === channel.id && (v.ownerId === ownerId || (!v.ownerId && ownerId === 'legacy-account-1'))).length;

      await saveDb();
      await addLog('success', `Добавлен канал "${channel.title}". Автоматически загружено видео: ${addedCount}`, { ownerId });

      res.json({
        channel,
        newVideosAdded: addedCount,
        totalVideosInFeed: videos.length,
        totalInDb: channel.videoCount,
        previouslyDeletedFound,
      });
    } catch (err: any) {
      console.error('Failed to add channel:', err);
      res.status(400).json({ error: err.message || 'Ошибка добавления канала' });
    }
  });

  app.delete('/api/channels/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const channelIndex = db.channels.findIndex((c) => c.id === id && (c.ownerId === ownerId || (!c.ownerId && ownerId === 'legacy-account-1')));
      if (channelIndex === -1) {
        return res.status(404).json({ error: 'Канал не найден' });
      }

      const removed = db.channels.splice(channelIndex, 1)[0];
      // Also remove videos associated with this channel for this owner
      const prevVideoCount = db.videos.length;
      db.videos = db.videos.filter((v) => !(v.channelId === id && (v.ownerId === ownerId || (!v.ownerId && ownerId === 'legacy-account-1'))));
      const removedVideosCount = prevVideoCount - db.videos.length;

      await saveDb();
      await addLog('info', `Канал "${removed.title}" удален из отслеживаемых (удалено видео: ${removedVideosCount})`, { ownerId });
      res.json({ success: true, removedVideosCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/channels/:id/toggle-sync', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const channel = db.channels.find((c) => c.id === id);
      if (!channel) return res.status(404).json({ error: 'Канал не найден' });

      channel.autoSync = !channel.autoSync;
      await saveDb();
      res.json(channel);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/channels/:id/refresh', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const channel = db.channels.find((c) => c.id === id);
      if (!channel) return res.status(404).json({ error: 'Канал не найден' });

      const { channelTitle, videos } = await fetchChannelDeepVideos(channel.id, 500);
      if (channelTitle && channelTitle !== 'Unknown Channel' && channelTitle !== 'YouTube Channel') {
        channel.title = channelTitle;
      }
      channel.lastCheckedAt = new Date().toISOString();

      if (!db.deletedVideos) db.deletedVideos = [];
      const newVideosToAdd: StoredVideo[] = [];
      const previouslyDeletedFound: any[] = [];

      for (const v of videos) {
        const existing = db.videos.find((existing) => existing.id === v.id);
        if (existing) {
          if (v.publishedAt && (!existing.publishedAt || existing.publishedAt.startsWith('2026-09-12T09:47'))) {
            existing.publishedAt = v.publishedAt;
          }
          continue;
        }

        const wasDeleted = db.deletedVideos.find((dv) => dv.id === v.id);
        if (wasDeleted) {
          if (!wasDeleted.permanentlyIgnored) {
            previouslyDeletedFound.push({
              id: v.id,
              title: v.title,
              channelId: channel.id,
              channelTitle: channel.title,
              thumbnail: v.thumbnail,
              publishedAt: v.publishedAt,
              deletedAt: wasDeleted.deletedAt,
            });
          }
          continue;
        }

        newVideosToAdd.push({
          id: v.id,
          channelId: channel.id,
          channelTitle: channel.title,
          title: v.title,
          url: v.url,
          description: v.description,
          thumbnail: v.thumbnail,
          publishedAt: v.publishedAt,
          status: 'new',
          updatedAt: new Date().toISOString(),
        });
      }
      db.videos = [...newVideosToAdd, ...db.videos];
      const newCount = newVideosToAdd.length;
      channel.videoCount = db.videos.filter((v) => v.channelId === channel.id).length;

      await saveDb();
      await addLog('info', `Канал "${channel.title}" обновлен. Найдено новых видео: ${newCount}`);
      res.json({
        channel,
        newCount,
        totalInFeed: videos.length,
        totalInDb: channel.videoCount,
        previouslyDeletedFound,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Deep load all videos (up to 250) from channel archive
  app.post('/api/channels/:id/load-all-videos', async (req, res) => {
    try {
      const { id } = req.params;
      const limit = parseInt(req.body?.limit as string) || 250;
      const db = await getDb();
      const channel = db.channels.find((c) => c.id === id);
      if (!channel) return res.status(404).json({ error: 'Канал не найден' });

      await addLog('info', `Запуск глубокой загрузки видеоархива для канала "${channel.title}" (до ${limit} видео)...`);
      const { channelTitle, videos } = await fetchChannelDeepVideos(channel.id, limit);

      if (channelTitle && channelTitle !== 'YouTube Channel') {
        channel.title = channelTitle;
      }
      channel.lastCheckedAt = new Date().toISOString();

      if (!db.deletedVideos) db.deletedVideos = [];
      const newVideosToAdd: StoredVideo[] = [];
      const previouslyDeletedFound: any[] = [];

      for (let idx = 0; idx < videos.length; idx++) {
        const v = videos[idx];
        const existing = db.videos.find((e) => e.id === v.id);
        if (existing) {
          // Update publishedAt if it was previously corrupted / default
          if (v.publishedAt) {
            existing.publishedAt = v.publishedAt;
          }
          continue;
        }

        const wasDeleted = db.deletedVideos.find((dv) => dv.id === v.id);
        if (wasDeleted) {
          if (!wasDeleted.permanentlyIgnored) {
            previouslyDeletedFound.push({
              id: v.id,
              title: v.title,
              channelId: channel.id,
              channelTitle: channel.title,
              thumbnail: v.thumbnail,
              publishedAt: v.publishedAt,
              deletedAt: wasDeleted.deletedAt,
            });
          }
          continue;
        }

        newVideosToAdd.push({
          id: v.id,
          channelId: channel.id,
          channelTitle: channel.title,
          title: v.title,
          url: v.url,
          description: v.description,
          thumbnail: v.thumbnail,
          publishedAt: v.publishedAt,
          status: 'new',
          updatedAt: new Date().toISOString(),
        });
      }
      db.videos = [...newVideosToAdd, ...db.videos];
      const newCount = newVideosToAdd.length;

      const totalChannelVideosInDb = db.videos.filter((v) => v.channelId === channel.id).length;
      channel.videoCount = totalChannelVideosInDb;

      await saveDb();
      await addLog('success', `Глубокая загрузка завершена для "${channel.title}". Добавлено новых видео: ${newCount}. Всего в базе по каналу: ${totalChannelVideosInDb}`);
      res.json({
        channel,
        newCount,
        totalFetched: videos.length,
        totalInDb: totalChannelVideosInDb,
        previouslyDeletedFound,
      });
    } catch (err: any) {
      console.error('Error in deep video loading:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Videos
  app.get('/api/videos', async (req, res) => {
    try {
      const db = await getDb();
      let changed = false;

      // Self-cleaning hook: verify transcript integrity
      for (const v of db.videos) {
        if (['transcribed', 'processing_gemini', 'completed'].includes(v.status)) {
          let isAiRefusal = false;
          if (v.transcript) {
            const t = v.transcript.toLowerCase();
            isAiRefusal = [
              'к сожалению',
              'как языков',
              'как ии',
              'не имею прямого доступа',
              'нет прямого доступа',
              'как текстовая модель',
              'i cannot fulfill',
              'я не могу'
            ].some(phrase => t.includes(phrase));
            
            // False positive prevention
            if (t.includes('я не могу') && !t.includes('видео')) {
              isAiRefusal = false;
            }
          }

          if (!v.transcript || v.transcript.trim().length < 50 || isAiRefusal) {
            v.status = 'error';
            v.error = 'Субтитры отсутствуют на YouTube. Не удалось получить расшифровку через открытые субтитры или Gemini Audio.';
            v.errorStage = 'transcription';
            v.rejectionCategory = 'transcription';
            v.updatedAt = new Date().toISOString();
            if (isAiRefusal) {
              v.transcript = undefined;
              v.transcriptSegments = undefined;
            }
            changed = true;
          }
        }
      }
      if (changed) {
        await saveDb();
      }
      let list = db.videos.map((v) => {
        const count = (db.scripts || []).filter((s) => s.videoIds && s.videoIds.includes(v.id)).length;
        return {
          ...v,
          scriptCount: count,
        };
      });
      const { channelId, status, search } = req.query;

      if (channelId && typeof channelId === 'string') {
        list = list.filter((v) => v.channelId === channelId);
      }
      if (status && typeof status === 'string' && status !== 'all') {
        list = list.filter((v) => v.status === status);
      }
      if (search && typeof search === 'string') {
        const q = search.toLowerCase();
        list = list.filter((v) => v.title.toLowerCase().includes(q) || v.channelTitle.toLowerCase().includes(q));
      }

      // Sort by publication/creation date descending (newest first) by default
      list.sort((a, b) => {
        const timeA = new Date(a.publishedAt || a.updatedAt || 0).getTime();
        const timeB = new Date(b.publishedAt || b.updatedAt || 0).getTime();
        return timeB - timeA;
      });

      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/videos/add-single', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'Укажите URL видео YouTube' });

      const videoId = extractVideoId(url);
      if (!videoId) {
        return res.status(400).json({ error: 'Неверный формат ссылки на видео YouTube' });
      }

      const db = await getDb();
      let existing = db.videos.find((v) => v.id === videoId);
      if (existing) {
        return res.json({ video: existing, isNew: false });
      }

      const info = await fetchSingleVideoInfo(videoId);
      const newVideo = {
        ...info,
        status: 'new' as const,
        updatedAt: new Date().toISOString(),
      };

      db.videos.unshift(newVideo);
      await saveDb();
      await addLog('info', `Добавлено индивидуальное видео: "${newVideo.title}"`, { videoId: newVideo.id, videoTitle: newVideo.title });

      res.json({ video: newVideo, isNew: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/videos/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const videoIndex = db.videos.findIndex((v) => v.id === id);
      if (videoIndex === -1) {
        return res.status(404).json({ error: 'Видео не найдено' });
      }

      const [deleted] = db.videos.splice(videoIndex, 1);
      if (!db.deletedVideos) db.deletedVideos = [];
      const existingDeletedIdx = db.deletedVideos.findIndex((dv) => dv.id === deleted.id);
      if (existingDeletedIdx === -1) {
        db.deletedVideos.push({
          id: deleted.id,
          title: deleted.title,
          channelId: deleted.channelId,
          channelTitle: deleted.channelTitle,
          thumbnail: deleted.thumbnail,
          publishedAt: deleted.publishedAt,
          deletedAt: new Date().toISOString(),
          permanentlyIgnored: false,
        });
      }

      await saveDb();
      await addLog('info', `Видео "${deleted.title}" удалено из списка`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Batch archive videos
  app.post('/api/videos/batch-archive', async (req, res) => {
    try {
      const { videoIds, isArchived = true } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'Не выбраны видео' });
      }
      const db = await getDb();
      for (const id of videoIds) {
        const v = db.videos.find((x) => x.id === id);
        if (v) {
          v.isArchived = isArchived;
          v.updatedAt = new Date().toISOString();
        }
      }
      await saveDb();
      res.json({ success: true, updatedCount: videoIds.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Batch delete videos
  app.post('/api/videos/batch-delete', async (req, res) => {
    try {
      const { videoIds } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'Не выбраны видео' });
      }
      const db = await getDb();
      if (!db.deletedVideos) db.deletedVideos = [];
      const idSet = new Set(videoIds);
      
      const toDelete = db.videos.filter((v) => idSet.has(v.id));
      for (const deleted of toDelete) {
        if (!db.deletedVideos.some((dv) => dv.id === deleted.id)) {
          db.deletedVideos.push({
            id: deleted.id,
            title: deleted.title,
            channelId: deleted.channelId,
            channelTitle: deleted.channelTitle,
            thumbnail: deleted.thumbnail,
            publishedAt: deleted.publishedAt,
            deletedAt: new Date().toISOString(),
            permanentlyIgnored: false,
          });
        }
      }

      const prevCount = db.videos.length;
      db.videos = db.videos.filter((v) => !idSet.has(v.id));
      const deletedCount = prevCount - db.videos.length;
      await saveDb();
      res.json({ success: true, deletedCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get deleted videos list
  app.get('/api/videos/deleted', async (req, res) => {
    try {
      const db = await getDb();
      res.json(db.deletedVideos || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Restore deleted videos back into database
  app.post('/api/videos/restore-deleted', async (req, res) => {
    try {
      const { videoIds } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'Не выбраны видео для восстановления' });
      }
      const db = await getDb();
      if (!db.deletedVideos) db.deletedVideos = [];

      const restored: StoredVideo[] = [];
      for (const id of videoIds) {
        const idx = db.deletedVideos.findIndex((d) => d.id === id);
        if (idx !== -1) {
          const d = db.deletedVideos[idx];
          db.deletedVideos.splice(idx, 1);
          const restoredVideo: StoredVideo = {
            id: d.id,
            title: d.title,
            channelId: d.channelId,
            channelTitle: d.channelTitle || '',
            url: `https://www.youtube.com/watch?v=${d.id}`,
            description: '',
            thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`,
            publishedAt: d.publishedAt || new Date().toISOString(),
            status: 'new',
            updatedAt: new Date().toISOString(),
          };
          db.videos.unshift(restoredVideo);
          restored.push(restoredVideo);
        }
      }

      await saveDb();
      await addLog('info', `Восстановлено ${restored.length} ранее удаленных видео`);
      res.json({ success: true, restoredCount: restored.length, restored });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Permanently ignore deleted videos so sync never prompts for them again
  app.post('/api/videos/ignore-deleted', async (req, res) => {
    try {
      const { videoIds } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'Не выбраны видео' });
      }
      const db = await getDb();
      if (!db.deletedVideos) db.deletedVideos = [];

      for (const id of videoIds) {
        const dv = db.deletedVideos.find((d) => d.id === id);
        if (dv) {
          dv.permanentlyIgnored = true;
        }
      }

      await saveDb();
      res.json({ success: true, ignoredCount: videoIds.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Retry failed step (transcription, filter screener, or scriptwriter)
  app.post('/api/videos/:id/retry-failed-step', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      const failedStage = video.errorStage || (video.transcript ? (video.matchedFilter !== undefined ? 'script' : 'filter') : 'transcription');
      video.error = undefined;
      video.errorStage = undefined;

      if (failedStage === 'transcription') {
        video.status = 'transcribing';
        video.updatedAt = new Date().toISOString();
        await saveDb();
        await addLog('info', `Повторная попытка транскрибации видео: "${video.title}"`, { videoId: video.id });

        const extracted = await extractVideoTranscript(video.id, video.title);
        video.transcript = extracted.text;
        video.transcriptSegments = extracted.segments;
        video.transcriptSource = extracted.source;
        video.status = 'transcribed';
        video.lastPassedStatus = 'transcribed';
        video.updatedAt = new Date().toISOString();
        await saveDb();
        return res.json({ success: true, retriedStage: 'transcription', video });
      } else if (failedStage === 'script') {
        // Retry script generation
        video.status = 'processing_gemini';
        video.updatedAt = new Date().toISOString();
        await saveDb();
        await addLog('info', `Повторная попытка генерации сценария для: "${video.title}"`, { videoId: video.id });

        const templateKey = 'scriptwriter_deep';
        const foundTemplate = (db.promptTemplates || []).find((t) => t.id === templateKey);
        const basePrompt = foundTemplate?.text || PROMPT_TEMPLATES.scriptwriter_deep;

        const fullPrompt = `${basePrompt}

Данные видео:
Название: ${video.title}
Ссылка: ${video.url}
Канал: ${video.channelTitle}

${video.geminiResult ? `Результаты Этапа 1:\n${video.geminiResult}\n\n` : ''}Полный транскрипт видео:
${video.transcript?.slice(0, 48000) || ''}`;

        const scriptContent = await generateWithFallback([{ text: fullPrompt }]);
        const newScript: GeneratedScript = {
          id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date().toISOString(),
          title: `Сценарий: ${video.title}`,
          promptTemplate: templateKey,
          videoIds: [video.id],
          videoTitles: [video.title],
          content: scriptContent,
          matchedFilter: true,
          telegramSent: false,
        };

        if (!db.scripts) db.scripts = [];
        db.scripts.unshift(newScript);

        video.matchedFilter = true;
        video.status = 'completed';
        video.lastPassedStatus = 'has_script';
        video.processedAt = new Date().toISOString();
        video.scriptCount = db.scripts.filter((s) => s.videoIds && s.videoIds.includes(video.id) && s.matchedFilter !== false).length;
        video.updatedAt = new Date().toISOString();
        await saveDb();
        return res.json({ success: true, retriedStage: 'script', script: newScript, video });
      } else {
        // Retry filter stage 1
        video.status = 'processing_gemini';
        video.updatedAt = new Date().toISOString();
        await saveDb();
        await addLog('info', `Повторная попытка фильтрации для: "${video.title}"`, { videoId: video.id });

        const foundTemplate = (db.promptTemplates || []).find((t) => t.id === 'filter_screener');
        const basePrompt = foundTemplate?.text || PROMPT_TEMPLATES.filter_screener;

        const fullPrompt = `${basePrompt}

Данные видео:
Название: ${video.title}
Ссылка: ${video.url}
Канал: ${video.channelTitle}

Транскрипт видео:
${video.transcript?.slice(0, 50000) || ''}`;

        const filterResult = await generateWithFallback([{ text: fullPrompt }]);
        const isFilteredOut = checkIfFilteredOut(filterResult);
        const filterReason = isFilteredOut ? (extractFilterRejectionReason(filterResult) || undefined) : undefined;

        video.geminiResult = filterResult;
        video.geminiPromptTemplate = 'filter_screener';
        video.matchedFilter = !isFilteredOut;
        video.filterReason = filterReason;
        video.status = 'completed';
        video.lastPassedStatus = !isFilteredOut ? 'approved' : 'rejected';
        video.updatedAt = new Date().toISOString();
        await saveDb();
        return res.json({ success: true, retriedStage: 'filter', isFilteredOut, video });
      }
    } catch (err: any) {
      const db = await getDb();
      const video = db.videos.find((v) => v.id === req.params.id);
      if (video) {
        video.status = 'error';
        video.error = err.message;
        video.updatedAt = new Date().toISOString();
        await saveDb();
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Get active queue state
  app.get('/api/videos/queue', (req, res) => {
    if (serverPendingQueue.length > 0 && serverActiveJobIds.size === 0) {
      startServerQueueWorker().catch((err) => console.error('Auto-restart queue worker error:', err));
    }
    res.json({
      queuedIds: serverPendingQueue.map((q) => q.videoId),
      activeIds: Array.from(serverActiveJobIds),
    });
  });

  // Batch process selected videos
  app.post('/api/videos/batch-process', async (req, res) => {
    try {
      const { videoIds, promptTemplate, customPrompt } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'Не выбраны видео для обработки' });
      }

      await enqueueVideos(videoIds, promptTemplate, customPrompt);

      res.json({
        success: true,
        message: `Запущена обработка ${videoIds.length} видео`,
        queuedIds: serverPendingQueue.map((q) => q.videoId),
        activeIds: Array.from(serverActiveJobIds),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Process single video (transcribe + gemini)
  app.post('/api/videos/:id/process', async (req, res) => {
    try {
      const { id } = req.params;
      const { promptTemplate, customPrompt, isPaidAuthorized, isAuthorized } = req.body;
      const result = await processVideoPipeline(
        id,
        promptTemplate,
        customPrompt,
        undefined,
        { isPaidAuthorized: isPaidAuthorized ?? isAuthorized ?? false }
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Explicit single-step Stage 1 (Filter Screener / Idea Bank) endpoint
  app.post('/api/videos/:id/run-stage1', requireAuth, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { promptTemplate, promptId, customPrompt } = req.body;
      const ownerId = req.user?.effectiveOwnerId;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id && (!ownerId || v.ownerId === ownerId || (!v.ownerId && ownerId === LEGACY_OWNER_ID)));
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      // Step 1: Ensure transcript
      if (!video.transcript || video.transcript.trim().length < 50) {
        video.status = 'transcribing';
        video.updatedAt = new Date().toISOString();
        await saveDb();
        try {
          const extracted = await extractVideoTranscript(video.id, video.title);
          video.transcript = extracted.text;
          video.transcriptSegments = extracted.segments;
          video.transcriptSource = extracted.source;
          video.status = 'transcribed';
          video.lastPassedStatus = 'transcribed';
          await saveDb();
        } catch (tErr: any) {
          video.status = 'error';
          video.error = tErr.message;
          video.errorStage = 'transcription';
          video.lastPassedStatus = 'new';
          video.updatedAt = new Date().toISOString();
          await saveDb();
          throw tErr;
        }
      }

      const templateKey = promptTemplate || promptId || 'filter_screener';
      const foundTemplate = (db.promptTemplates || []).find((t) => t.id === templateKey);
      const promptName = foundTemplate?.name || (templateKey === 'filter_screener' ? '🔍 Промпт 1: Фильтр тем и Банк идей' : templateKey);

      // Step 2: Run filter prompt
      video.status = 'processing_gemini';
      video.updatedAt = new Date().toISOString();
      await saveDb();
      await addLog('info', `[1 этап: Фильтр] Анализ по "${promptName}" для: "${video.title}"`, { videoId: video.id });

      let basePrompt = customPrompt?.trim() || foundTemplate?.text || (PROMPT_TEMPLATES as any)[templateKey] || PROMPT_TEMPLATES.filter_screener;

      const fullPrompt = `${basePrompt}

Данные видео:
Название: ${video.title}
Ссылка: ${video.url}
Канал: ${video.channelTitle}

Транскрипт видео:
${video.transcript.slice(0, 50000)}`;

      const filterResult = await generateWithFallback([{ text: fullPrompt }]);
      const isFilteredOut = checkIfFilteredOut(filterResult);
      const filterReason = isFilteredOut ? (extractFilterRejectionReason(filterResult) || undefined) : undefined;

      const newRun: PromptRunRecord = {
        id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        stage: 'stage1',
        promptId: templateKey,
        promptName,
        promptTemplate: templateKey,
        customPrompt: customPrompt || undefined,
        timestamp: new Date().toISOString(),
        status: isFilteredOut ? 'rejected' : 'approved',
        result: filterResult,
        matchedFilter: !isFilteredOut,
        filterReason: filterReason,
        isCurrent: true,
      };

      if (!video.promptRuns) video.promptRuns = [];
      for (const r of video.promptRuns) {
        r.isCurrent = false;
      }
      video.promptRuns.unshift(newRun);

      syncVideoWithCurrentRun(video);
      video.processedAt = new Date().toISOString();
      video.updatedAt = new Date().toISOString();

      if (isFilteredOut) {
        await addLog('warn', `[1 этап: Фильтр] ❌ Видео "${video.title}" отклонено фильтром${filterReason ? `: ${filterReason}` : ''}`, { videoId: video.id });
      } else {
        await addLog('success', `[1 этап: Фильтр] ✓ Видео "${video.title}" одобрено фильтром! Банк идей сформирован`, { videoId: video.id });
      }

      await saveDb();
      res.json({ success: true, isFilteredOut, video });
    } catch (err: any) {
      const db = await getDb();
      const video = db.videos.find((v) => v.id === req.params.id);
      if (video) {
        video.status = 'error';
        video.error = err.message;
        if (!video.errorStage) video.errorStage = 'filter';
        if (!video.lastPassedStatus) video.lastPassedStatus = video.transcript ? 'transcribed' : 'new';
        video.updatedAt = new Date().toISOString();
        await saveDb();
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Explicit Stage 2 (Generate Full Storyboard Script) endpoint
  app.post('/api/videos/:id/run-stage2', async (req, res) => {
    try {
      const { id } = req.params;
      const { promptTemplate, promptId, customPrompt, ideaText, sendToTelegram } = req.body;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      // Step 1: Ensure transcript
      if (!video.transcript || video.transcript.trim().length < 50) {
        video.status = 'transcribing';
        video.updatedAt = new Date().toISOString();
        await saveDb();
        try {
          const extracted = await extractVideoTranscript(video.id, video.title);
          video.transcript = extracted.text;
          video.transcriptSegments = extracted.segments;
          video.transcriptSource = extracted.source;
          video.status = 'transcribed';
          video.lastPassedStatus = 'transcribed';
          await saveDb();
        } catch (tErr: any) {
          video.status = 'error';
          video.error = tErr.message;
          video.errorStage = 'transcription';
          video.lastPassedStatus = 'new';
          video.updatedAt = new Date().toISOString();
          await saveDb();
          throw tErr;
        }
      }

      const templateKey = promptTemplate || promptId || 'scriptwriter_deep';
      const foundTemplate = (db.promptTemplates || []).find((t) => t.id === templateKey);
      const promptName = foundTemplate?.name || (templateKey === 'scriptwriter_deep' ? '🎬 Промпт 2: Покадровый сценарист Reels/Shorts' : templateKey);

      // Step 2: Run scriptwriter prompt
      video.status = 'processing_gemini';
      video.updatedAt = new Date().toISOString();
      await saveDb();
      await addLog('info', `[2 этап: Сценарист] Генерация по "${promptName}" для: "${video.title}"`, { videoId: video.id });

      let basePrompt = customPrompt?.trim() || foundTemplate?.text || (PROMPT_TEMPLATES as any)[templateKey] || PROMPT_TEMPLATES.scriptwriter_deep;

      // Existing scripts context to prevent duplicates
      const existingScripts = (db.scripts || []).filter((s) => s.videoIds && s.videoIds.includes(video.id));
      let previousScriptsContext = '';
      if (existingScripts.length > 0) {
        previousScriptsContext = `\n\nВНИМАНИЕ! Для этого видео уже создано ${existingScripts.length} сценариев:\n${existingScripts
          .map((s, idx) => `[Сценарий #${idx + 1}: ${s.title}]\n${s.content.slice(0, 250)}...`)
          .join('\n\n')}\n\nКРИТИЧЕСКИ ВАЖНО: Не повторяй темы, хуки и фокус уже созданных выше сценариев! Найди принципиально ДРУГОЙ неизбитый тезис, психологический миф или парадокс из транскрипта.\nЕсли в материале видео больше нет подходящих тем под фильтр блога — прямо напиши строку:\n"БОЛЬШЕ_НЕТ_СЦЕНАРИЕВ: В транскрипте данного видео исчерпаны подходящие темы по критериям блога."\n`;
      }

      const fullPrompt = `${basePrompt}
${previousScriptsContext}
Данные видео:
Название: ${video.title}
Ссылка: ${video.url}
Канал: ${video.channelTitle}

${ideaText ? `Выбранная идея / тезис для сценария:\n${ideaText}\n\n` : ''}${
        video.geminiResult && video.matchedFilter !== false
          ? `Результаты предыдущего анализа (Фильтр и банк идей):\n${video.geminiResult}\n\n`
          : ''
      }Полный транскрипт видео:
${video.transcript.slice(0, 48000)}`;

      const scriptContent = await generateWithFallback([{ text: fullPrompt }]);

      if (scriptContent.includes('БОЛЬШЕ_НЕТ_СЦЕНАРИЕВ')) {
        video.status = 'completed';
        video.lastPassedStatus = 'approved';
        video.error = undefined;
        video.errorStage = undefined;
        video.updatedAt = new Date().toISOString();
        await saveDb();
        return res.json({
          success: true,
          noMoreScripts: true,
          message: 'В транскрипте данного видео больше нет подходящих тем по заданным критериям блога.',
          video,
        });
      }

      const newScript: GeneratedScript = {
        id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        title: `Сценарий: ${ideaText ? ideaText.slice(0, 60) + '...' : video.title}`,
        promptTemplate: templateKey,
        customPrompt: customPrompt || undefined,
        videoIds: [video.id],
        videoTitles: [video.title],
        content: scriptContent,
        matchedFilter: true,
        telegramSent: false,
      };

      if (!db.scripts) db.scripts = [];
      db.scripts.unshift(newScript);

      const scriptCount = db.scripts.filter(s => s.videoIds && s.videoIds.includes(video.id) && s.matchedFilter !== false).length;

      const newRun: PromptRunRecord = {
        id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        stage: 'stage2',
        promptId: templateKey,
        promptName,
        promptTemplate: templateKey,
        customPrompt: customPrompt || undefined,
        timestamp: new Date().toISOString(),
        status: 'has_script',
        result: scriptContent,
        matchedFilter: true,
        scriptCount,
        isCurrent: true,
      };

      if (!video.promptRuns) video.promptRuns = [];
      for (const r of video.promptRuns) {
        r.isCurrent = false;
      }
      video.promptRuns.unshift(newRun);

      syncVideoWithCurrentRun(video);
      video.processedAt = new Date().toISOString();
      video.updatedAt = new Date().toISOString();

      let tgResult = null;
      if (sendToTelegram) {
        try {
          const targetChat = db.settings.telegramChatId || process.env.TELEGRAM_CHAT_ID;
          tgResult = await sendTelegramMessage(scriptContent, {
            chatId: targetChat,
            header: `🎬 *Покадровый сценарий Reels*\n📌 *${video.title}*\n📺 Канал: ${video.channelTitle}\n🔗 ${video.url}`,
          });
          if (tgResult.ok) {
            newScript.telegramSent = true;
            newScript.telegramSentAt = new Date().toISOString();
            newScript.telegramMessageIds = tgResult.messageIds;
            await addLog('success', `Сценарий успешно отправлен в Telegram канал!`);
          }
        } catch (tgErr: any) {
          console.error('Error sending Stage 2 script to Telegram:', tgErr);
        }
      }

      await saveDb();
      await addLog('success', `[2 этап: Сценарист] Сценарий для "${video.title}" успешно сгенерирован!`, { videoId: video.id });

      res.json({ success: true, script: newScript, video, telegram: tgResult });
    } catch (err: any) {
      const db = await getDb();
      const video = db.videos.find((v) => v.id === req.params.id);
      if (video) {
        video.status = 'error';
        video.error = err.message;
        video.updatedAt = new Date().toISOString();
        await saveDb();
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Set active prompt run version
  app.post('/api/videos/:id/set-current-run', async (req, res) => {
    try {
      const { id } = req.params;
      const { runId } = req.body;
      if (!runId) return res.status(400).json({ error: 'runId is required' });

      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      if (!video.promptRuns || video.promptRuns.length === 0) {
        return res.status(404).json({ error: 'История запусков пуста' });
      }

      const targetRun = video.promptRuns.find((r) => r.id === runId);
      if (!targetRun) return res.status(404).json({ error: 'Указанная версия запуска не найдена' });

      for (const r of video.promptRuns) {
        r.isCurrent = r.id === runId;
      }

      syncVideoWithCurrentRun(video);
      video.updatedAt = new Date().toISOString();
      await saveDb();

      await addLog('info', `[История] Текущая версия изменена на "${targetRun.promptName}" для "${video.title}"`, { videoId: video.id });

      res.json({ success: true, video });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a specific prompt run from history
  app.delete('/api/videos/:id/prompt-runs/:runId', async (req, res) => {
    try {
      const { id, runId } = req.params;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      if (!video.promptRuns) return res.status(404).json({ error: 'История запусков пуста' });
      const runIdx = video.promptRuns.findIndex((r) => r.id === runId);
      if (runIdx === -1) return res.status(404).json({ error: 'Запись не найдена' });

      const wasCurrent = video.promptRuns[runIdx].isCurrent;
      video.promptRuns.splice(runIdx, 1);
      if (wasCurrent && video.promptRuns.length > 0) {
        video.promptRuns[0].isCurrent = true;
      }
      syncVideoWithCurrentRun(video);
      video.updatedAt = new Date().toISOString();
      await saveDb();
      res.json({ success: true, video });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Find MORE ideas for Stage 1 (Filter Screener & Idea Bank)
  app.post('/api/videos/:id/find-more-ideas', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      if (!video.transcript || video.transcript.trim().length < 50) {
        const extracted = await extractVideoTranscript(video.id, video.title);
        video.transcript = extracted.text;
        video.transcriptSegments = extracted.segments;
        video.transcriptSource = extracted.source;
        video.status = 'transcribed';
        await saveDb();
      }

      const existingIdeas = video.geminiResult || '';
      const prompt = `Ты строгий контент-стратег и редактор блога.
Проанализируй транскрипт видео и найди ДОПОЛНИТЕЛЬНЫЕ уникальные идеи/тезисы/хуки для блога (психология, развенчание мифов, глубокие смыслы), которых ЕЩЕ НЕТ в предыдущем списке.

РАНЕЕ НАЙДЕННЫЕ ИДЕИ:
${existingIdeas.slice(0, 3000)}

ПРАВИЛА:
1. Если в транскрипте есть ДРУГИЕ жизнеспособные идеи с парадоксальными хуками — оформи их строго по формату (#1, Название, Хук, Ядро мысли, Virality score).
2. Если в транскрипте больше НЕТ подходящих тем под критерии блога (все ценное уже извлечено, либо осталась вода/хроника) — СТРОГО верни строку:
"БОЛЬШЕ_НЕТ_ИДЕЙ: Все жизнеспособные идеи из этого видео уже извлечены. Дополнительных тем, подходящих под фильтр блога, не обнаружено."
3. Не придумывай и не натягивай темы, если их нет в транскрипте!

Транскрипт видео:
${video.transcript.slice(0, 48000)}`;

      const result = await generateWithFallback([{ text: prompt }]);
      if (result.includes('БОЛЬШЕ_НЕТ_ИДЕЙ')) {
        return res.json({
          success: true,
          noMoreIdeas: true,
          message: 'Все жизнеспособные идеи из этого видео уже извлечены. Дополнительных тем по фильтру не найдено.',
          video,
        });
      }

      // Append newly found ideas to geminiResult
      video.geminiResult = (video.geminiResult ? video.geminiResult + '\n\n---\n### ➕ Дополнительные идеи:\n' : '') + result;
      video.updatedAt = new Date().toISOString();
      await saveDb();
      await addLog('success', `[Этап 1] Найдены дополнительные идеи для "${video.title}"`, { videoId: video.id });

      res.json({ success: true, noMoreIdeas: false, video });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Toggle video reviewed/processed status
  app.patch('/api/videos/:id/toggle-reviewed', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      video.isReviewed = !video.isReviewed;
      video.reviewedAt = video.isReviewed ? new Date().toISOString() : undefined;
      video.updatedAt = new Date().toISOString();
      await saveDb();

      res.json({ success: true, video });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Toggle video archive status
  app.patch('/api/videos/:id/toggle-archive', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      video.isArchived = !video.isArchived;
      video.updatedAt = new Date().toISOString();
      await saveDb();

      res.json({ success: true, video });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/videos/:id/force-paid-transcription', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) {
        return res.status(404).json({ error: 'Видео не найдено' });
      }

      video.forcePaidModel = true;
      video.status = 'transcribe_queued';
      video.error = undefined;
      await saveDb();

      // Start the pipeline in the background
      processVideoPipeline(id, db.settings.autoProcessMode || 'filter_screener').catch(e => console.error('Force paid pipeline error:', e));

      return res.json({ success: true, message: 'Запущена транскрипция через платную модель' });
    } catch (err: any) {
      console.error('Error starting force paid transcription:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Explicit single-step transcription endpoint
  app.post('/api/videos/:id/transcribe', async (req, res) => {
    try {
      const { id } = req.params;
      const { allowGeminiAudioFallback = true } = req.body || {};
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) {
        return res.status(404).json({ error: 'Видео не найдено' });
      }

      if (video.transcript && video.transcript.trim().length > 0) {
        return res.json({
          success: true,
          alreadyHadTranscript: true,
          transcriptLength: video.transcript.length,
          source: video.transcriptSource || 'subtitles',
        });
      }

      video.status = 'transcribing';
      video.error = undefined;
      video.updatedAt = new Date().toISOString();
      await saveDb();
      await addLog('info', `Транскрибация видео: "${video.title}" (Уровень ${allowGeminiAudioFallback ? 'А -> Б -> В' : 'А -> Б'})`, { videoId: video.id, videoTitle: video.title });

      const extracted = await extractVideoTranscript(video.id, video.title, {
        allowGeminiAudioFallback: Boolean(allowGeminiAudioFallback),
      });
      video.transcript = extracted.text;
      video.transcriptSegments = extracted.segments;
      video.transcriptSource = extracted.source;
      video.status = 'transcribed';
      video.lastPassedStatus = 'transcribed';
      video.error = undefined;
      video.errorStage = undefined;
      video.rejectionCategory = undefined;
      video.queueTimestamp = undefined;
      video.updatedAt = new Date().toISOString();
      await saveDb();

      const sourceLabels: Record<string, string> = {
        subtitles: 'субтитры (А)',
        supadata: 'Supadata (Б)',
        gemini_audio: 'Gemini Audio (В)',
      };
      const sourceLabel = sourceLabels[extracted.source] || extracted.source;

      await addLog(
        'success',
        `Транскрипт готов (${sourceLabel}, ${extracted.text.length} симв.): "${video.title}"`,
        { videoId: video.id, videoTitle: video.title }
      );

      res.json({
        success: true,
        alreadyHadTranscript: false,
        transcriptLength: extracted.text.length,
        source: extracted.source,
      });
    } catch (err: any) {
      const db = await getDb();
      const video = db.videos.find((v) => v.id === req.params.id);
      if (video) {
        video.status = 'error';
        video.error = err.message;
        video.queueTimestamp = undefined;
        video.updatedAt = new Date().toISOString();
        await saveDb();
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Generate deep storyboard scenario for a specific selected idea
  app.post('/api/videos/:id/generate-idea-script', async (req, res) => {
    try {
      const { id } = req.params;
      const { ideaTitle, ideaText, promptTemplate, customPrompt, sendToTelegram } = req.body;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      if (!video.transcript || video.transcript.trim().length < 50) {
        // Transcribe first
        const extracted = await extractVideoTranscript(video.id, video.title);
        video.transcript = extracted.text;
        video.transcriptSegments = extracted.segments;
        video.transcriptSource = extracted.source;
        video.status = 'transcribed';
        await saveDb();
      }

      const templateKey = promptTemplate || db.settings.defaultScriptwriterPromptTemplate || 'scriptwriter_deep';
      const foundTemplate = (db.promptTemplates || []).find((t) => t.id === templateKey);
      let baseInstruction = foundTemplate ? foundTemplate.text : (PROMPT_TEMPLATES as any)[templateKey] || PROMPT_TEMPLATES.scriptwriter_deep;
      if (customPrompt && customPrompt.trim()) {
        baseInstruction = customPrompt.trim();
      }

      const fullPrompt = `${baseInstruction}

ДАННЫЕ ВИДЕО:
Название: ${video.title}
Ссылка: ${video.url}
Канал: ${video.channelTitle}

ВЫБРАННАЯ ИДЕЯ / ТЕМА ДЛЯ СЦЕНАРИЯ:
${ideaText || ideaTitle || video.title}

КОНТЕКСТ ИЗ ТРАНСКРИПТА ВИДЕО:
${video.transcript.slice(0, 45000)}`;

      await addLog('info', `Генерация сценария для идеи "${ideaTitle || 'Идея'}" (видео "${video.title}")...`, {
        videoId: video.id,
        videoTitle: video.title,
      });

      const scriptContent = await generateWithFallback([{ text: fullPrompt }]);

      const newScriptId = `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newScript: GeneratedScript = {
        id: newScriptId,
        createdAt: new Date().toISOString(),
        title: `Сценарий: ${ideaTitle || video.title}`,
        ideaTitle: ideaTitle || undefined,
        promptTemplate: templateKey,
        customPrompt: customPrompt || undefined,
        videoIds: [video.id],
        videoTitles: [video.title],
        content: scriptContent,
        matchedFilter: true,
        telegramSent: false,
      };

      if (!db.scripts) db.scripts = [];
      db.scripts.unshift(newScript);
      video.scriptCount = (video.scriptCount || 0) + 1;

      const runRecord: PromptRunRecord = {
        id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        stage: 2,
        promptTemplate: templateKey,
        promptName: foundTemplate?.name || (templateKey === 'scriptwriter_deep' ? '🎬 Промпт 2: Покадровый сценарист Reels/Shorts' : templateKey),
        status: 'has_script',
        result: scriptContent,
        isCurrent: true,
        scriptCount: video.scriptCount,
      };

      if (!video.promptRuns) video.promptRuns = [];
      for (const r of video.promptRuns) {
        r.isCurrent = false;
      }
      video.promptRuns.unshift(runRecord);
      syncVideoWithCurrentRun(video);
      await saveDb();

      let tgResult = null;
      if (sendToTelegram) {
        try {
          const targetChat = db.settings.telegramChatId || process.env.TELEGRAM_CHAT_ID;
          tgResult = await sendTelegramMessage(scriptContent, {
            chatId: targetChat,
            header: `🎬 *Покадровый сценарий Reels*\n💡 *Идея:* ${ideaTitle || video.title}\n📺 *Видео:* ${video.title}\n🔗 ${video.url}`,
          });
          if (tgResult.ok) {
            newScript.telegramSent = true;
            newScript.telegramSentAt = new Date().toISOString();
            newScript.telegramMessageIds = tgResult.messageIds;
            await saveDb();
            await addLog('success', `Сценарий по идее "${ideaTitle || video.title}" отправлен в Telegram!`);
          }
        } catch (tgErr: any) {
          console.error('Error sending idea script to Telegram:', tgErr);
        }
      }

      await addLog('success', `Сценарий для идеи "${ideaTitle || 'Идея'}" успешно создан!`, {
        videoId: video.id,
        videoTitle: video.title,
      });

      res.json({ script: newScript, telegram: tgResult, video });
    } catch (err: any) {
      console.error('Error generating idea script:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Ask question / chat with Gemini about a specific video transcript
  app.post('/api/videos/:id/chat', async (req, res) => {
    try {
      const { id } = req.params;
      const { question } = req.body;
      if (!question || typeof question !== 'string') {
        return res.status(400).json({ error: 'Задайте вопрос' });
      }

      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      if (!video.transcript) {
        return res.status(400).json({ error: 'Сначала выполните транскрибацию этого видео' });
      }

      const prompt = `Ты консультант и ассистент по материалам видео "${video.title}".
Используй приведенный ниже транскрипт видео, чтобы точно и подробно ответить на вопрос пользователя.
Если информации в видео нет, укажи об этом.

Вопрос пользователя: "${question}"

Транскрипт видео:
${video.transcript.slice(0, 45000)}`;

      const answer = await generateWithFallback([{ text: prompt }]);

      res.json({ answer: answer || 'Нет ответа от модели' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual Filter Status Override & Pipeline State Reset
  app.post('/api/videos/:id/override-filter', async (req, res) => {
    try {
      const { id } = req.params;
      const { matchedFilter } = req.body;
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      video.matchedFilter = matchedFilter;
      video.updatedAt = new Date().toISOString();
      await saveDb();
      await addLog('info', `Статус фильтра для видео "${video.title}" изменен на: ${matchedFilter ? 'Одобрено' : 'Отклонено'} (вручную)`, { videoId: video.id, videoTitle: video.title });

      res.json({ success: true, video });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reset video pipeline status / return to Stage 1 or New
  app.post('/api/videos/:id/reset-status', async (req, res) => {
    try {
      const { id } = req.params;
      const { target } = req.body; // 'stage1' | 'approved' | 'rejected' | 'new' | 'clear_scripts'
      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      if (target === 'stage1' || target === 'clear_scripts') {
        // Return to Stage 1 (Approved, ideas kept, but clear generated scenarios)
        video.matchedFilter = true;
        video.scriptCount = 0;
        if (db.scripts) {
          db.scripts = db.scripts.filter((s) => !(s.videoIds && s.videoIds.length === 1 && s.videoIds[0] === video.id));
        }
        await addLog('info', `Видео "${video.title}" возвращено на Этап 1 (Одобрено, без сценариев)`);
      } else if (target === 'approved') {
        video.matchedFilter = true;
        await addLog('info', `Видео "${video.title}" переведено в статус Одобрено`);
      } else if (target === 'rejected') {
        video.matchedFilter = false;
        await addLog('info', `Видео "${video.title}" переведено в статус Отклонено фильтром`);
      } else if (target === 'new') {
        // Complete reset
        video.matchedFilter = undefined;
        video.geminiResult = undefined;
        video.scriptCount = 0;
        video.status = video.transcript ? 'transcribed' : 'new';
        if (db.scripts) {
          db.scripts = db.scripts.filter((s) => !(s.videoIds && s.videoIds.includes(video.id)));
        }
        await addLog('info', `Видео "${video.title}" сброшено в статус "Не обработано"`);
      }

      video.updatedAt = new Date().toISOString();
      await saveDb();
      res.json({ success: true, video });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stop/Cancel processing for a single video (DELETE & POST)
  const handleStopVideo = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      // Abort running Gemini/Pipeline job if actively executing
      cancelActiveJob(id);

      // Remove from server queue
      const qIdx = serverPendingQueue.findIndex((q) => q.videoId === id);
      if (qIdx !== -1) {
        serverPendingQueue.splice(qIdx, 1);
      }
      serverActiveJobIds.delete(id);

      const db = await getDb();
      const video = db.videos.find((v) => v.id === id);
      if (!video) return res.status(404).json({ error: 'Видео не найдено' });

      video.status = video.transcript && video.transcript.trim().length > 0 ? 'transcribed' : 'new';
      video.error = undefined;
      video.queueTimestamp = undefined;
      video.updatedAt = new Date().toISOString();
      await saveDb();
      await addLog('warn', `Обработка видео "${video.title}" прервана пользователем`);
      res.json({ success: true, video });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  app.post('/api/videos/:id/stop', handleStopVideo);
  app.delete('/api/videos/:id/stop', handleStopVideo);
  app.delete('/api/videos/:id/queue', handleStopVideo);
  app.post('/api/videos/:id/dequeue', handleStopVideo);

  // Batch stop videos
  app.post('/api/videos/batch-stop', async (req, res) => {
    try {
      const { videoIds } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'Не выбраны видео' });
      }
      const idsSet = new Set(videoIds);
      for (let i = serverPendingQueue.length - 1; i >= 0; i--) {
        if (idsSet.has(serverPendingQueue[i].videoId)) {
          serverPendingQueue.splice(i, 1);
        }
      }
      for (const id of videoIds) {
        cancelActiveJob(id);
        serverActiveJobIds.delete(id);
      }

      const db = await getDb();
      let stoppedCount = 0;
      for (const id of videoIds) {
        const video = db.videos.find((v) => v.id === id);
        if (video) {
          video.status = video.transcript && video.transcript.trim().length > 0 ? 'transcribed' : 'new';
          video.error = undefined;
          video.queueTimestamp = undefined;
          video.updatedAt = new Date().toISOString();
          stoppedCount++;
        }
      }
      await saveDb();
      await addLog('warn', `Остановлена обработка для ${stoppedCount} видео`);
      res.json({ success: true, stoppedCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear entire queue
  app.delete('/api/videos/queue', async (req, res) => {
    try {
      const allIds = Array.from(new Set([...serverPendingQueue.map((q) => q.videoId), ...serverActiveJobIds]));
      serverPendingQueue.length = 0;
      serverActiveJobIds.clear();

      const db = await getDb();
      for (const id of allIds) {
        const video = db.videos.find((v) => v.id === id);
        if (video) {
          video.status = video.transcript && video.transcript.trim().length > 0 ? 'transcribed' : 'new';
          video.error = undefined;
          video.queueTimestamp = undefined;
          video.updatedAt = new Date().toISOString();
        }
      }
      await saveDb();
      res.json({ success: true, clearedCount: allIds.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Telegram Status & diagnostics
  app.get('/api/telegram/status', async (req, res) => {
    try {
      const db = await getDb();
      const envConfig = getTelegramEnvConfig();
      const configuredChatId = db.settings.telegramChatId || envConfig.chatId || '';

      let botInfo: any = null;
      if (envConfig.botToken) {
        const info = await getTelegramBotInfo(envConfig.botToken);
        if (info.ok) botInfo = info.bot;
      }

      res.json({
        isConfigured: Boolean(envConfig.botToken && configuredChatId),
        hasToken: Boolean(envConfig.botToken),
        hasChatId: Boolean(configuredChatId),
        botUsername: botInfo?.username,
        botFirstName: botInfo?.first_name,
        defaultChatId: configuredChatId,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/telegram/test', async (req, res) => {
    try {
      const { chatId } = req.body;
      const db = await getDb();
      const targetChat = chatId || db.settings.telegramChatId || process.env.TELEGRAM_CHAT_ID;
      const result = await testTelegram(undefined, targetChat);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/telegram/send', async (req, res) => {
    try {
      const { text, header, chatId, scriptId } = req.body;
      if (!text) return res.status(400).json({ error: 'Текст сообщения не указан' });

      const db = await getDb();
      const targetChat = chatId || db.settings.telegramChatId || process.env.TELEGRAM_CHAT_ID;

      const result = await sendTelegramMessage(text, {
        chatId: targetChat,
        header,
      });

      if (result.ok && scriptId) {
        const script = (db.scripts || []).find((s) => s.id === scriptId);
        if (script) {
          script.telegramSent = true;
          script.telegramSentAt = new Date().toISOString();
          script.telegramMessageIds = result.messageIds;
          await saveDb();
        }
      }

      if (result.ok) {
        await addLog('success', `Сообщение успешно отправлено в Telegram (${targetChat})`);
      } else {
        await addLog('error', `Ошибка отправки в Telegram: ${result.error}`);
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Prompt Templates Listing & Management
  app.get('/api/prompts', requireAuth, async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      if (!db.promptTemplates || db.promptTemplates.length === 0) {
        db.promptTemplates = [...DEFAULT_PROMPT_DEFINITIONS];
        await saveDb();
      } else {
        // Sync default definitions and categories
        let updated = false;
        for (const def of DEFAULT_PROMPT_DEFINITIONS) {
          const found = db.promptTemplates.find((t) => t.id === def.id && (!t.ownerId || t.ownerId === ownerId || t.ownerId === LEGACY_OWNER_ID));
          if (!found) {
            db.promptTemplates.push({ ...def, ownerId });
            updated = true;
          } else {
            if (!found.category) {
              found.category = def.category;
              updated = true;
            }
            if (!found.isCustom && !found.isModified) {
              found.name = def.name;
              found.badge = def.badge;
              found.description = def.description;
              found.text = def.text;
              found.category = def.category;
              updated = true;
            }
          }
        }
        if (updated) await saveDb();
      }
      res.json(getPromptTemplatesForOwner(db, ownerId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create or update a prompt template
  app.post('/api/prompts', requireAuth, async (req, res) => {
    try {
      const { id, name, badge, description, text, category } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Укажите название промпта' });
      }
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Укажите текст промпта' });
      }

      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      if (!db.promptTemplates) {
        db.promptTemplates = [...DEFAULT_PROMPT_DEFINITIONS];
      }

      if (id) {
        const existing = db.promptTemplates.find((t) => t.id === id && (t.ownerId === ownerId || !t.ownerId || t.ownerId === LEGACY_OWNER_ID));
        if (existing) {
          existing.ownerId = ownerId;
          existing.name = name.trim();
          existing.badge = (badge || existing.badge || 'Промпт').trim();
          existing.description = (description || '').trim();
          existing.text = text.trim();
          if (category) existing.category = category;
          existing.isModified = !existing.isCustom;
          await saveDb();
          await addLog('info', `Обновлен шаблон промпта: "${existing.name}"`, { ownerId });
          return res.json(existing);
        }
      }

      // Create new custom prompt
      const newId = id && !id.startsWith('custom-') ? `custom-${id}` : `custom-${Date.now()}`;
      const newTemplate: PromptTemplateDef = {
        id: newId,
        ownerId,
        name: name.trim(),
        badge: (badge || 'Свой шаблон').trim(),
        description: (description || '').trim(),
        text: text.trim(),
        category: category || 'general',
        isCustom: true,
      };

      db.promptTemplates.push(newTemplate);
      await saveDb();
      await addLog('info', `Создан новый шаблон промпта: "${newTemplate.name}"`, { ownerId });
      res.json(newTemplate);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reset a modified default prompt to factory default
  app.post('/api/prompts/:id/reset', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const defaultDef = DEFAULT_PROMPT_DEFINITIONS.find((d) => d.id === id);
      if (!defaultDef) {
        return res.status(404).json({ error: 'Системный шаблон не найден' });
      }

      if (!db.promptTemplates) {
        db.promptTemplates = [...DEFAULT_PROMPT_DEFINITIONS];
      }

      const idx = db.promptTemplates.findIndex((t) => t.id === id && (t.ownerId === ownerId || !t.ownerId || t.ownerId === LEGACY_OWNER_ID));
      if (idx !== -1) {
        db.promptTemplates[idx] = { ...defaultDef, ownerId };
      } else {
        db.promptTemplates.push({ ...defaultDef, ownerId });
      }

      await saveDb();
      await addLog('info', `Шаблон "${defaultDef.name}" сброшен к исходному тексту`, { ownerId });
      res.json(defaultDef);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a prompt template
  app.delete('/api/prompts/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      if (!db.promptTemplates) {
        db.promptTemplates = [...DEFAULT_PROMPT_DEFINITIONS];
      }

      const userPrompts = getPromptTemplatesForOwner(db, ownerId);
      if (userPrompts.length <= 1) {
        return res.status(400).json({ error: 'Невозможно удалить: в системе должен оставаться минимум 1 промпт' });
      }

      const idx = db.promptTemplates.findIndex((t) => t.id === id && (t.ownerId === ownerId || t.ownerId === LEGACY_OWNER_ID));
      if (idx === -1) {
        return res.status(404).json({ error: 'Промпт не найден' });
      }

      const target = db.promptTemplates[idx];
      db.promptTemplates.splice(idx, 1);
      await saveDb();
      await addLog('info', `Удален шаблон промпта: "${target.name}"`, { ownerId });
      return res.json({ success: true, deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generated Scripts Management
  app.get('/api/scripts', async (req, res) => {
    try {
      const db = await getDb();
      res.json(db.scripts || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/scripts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const db = await getDb();
      const idx = (db.scripts || []).findIndex((s) => s.id === id);
      if (idx !== -1) {
        db.scripts.splice(idx, 1);
        await saveDb();
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generate Script / Candidate Scenarios with Gemini from 1 or more videos
  app.post('/api/scripts/generate', async (req, res) => {
    try {
      const { videoIds, promptTemplate, customPrompt, sendToTelegram, telegramChatId, skipTelegramIfNotMatched } = req.body;

      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'Выберите хотя бы одно видео для генерации сценария' });
      }

      const db = await getDb();
      const targetVideos = db.videos.filter((v) => videoIds.includes(v.id));

      if (targetVideos.length === 0) {
        return res.status(404).json({ error: 'Выбранные видео не найдены' });
      }

      await addLog('info', `Запущена генерация сценария Gemini для ${targetVideos.length} видео...`);

      // Ensure all videos have transcripts
      for (const video of targetVideos) {
        if (!video.transcript || video.transcript.trim().length < 50) {
          await addLog('info', `Получение транскрипта для: "${video.title}"`);
          const extracted = await extractVideoTranscript(video.id, video.title);
          video.transcript = extracted.text;
          video.transcriptSource = extracted.source;
          video.transcriptSegments = extracted.segments;
          video.status = 'transcribed';
          video.updatedAt = new Date().toISOString();
        }
      }
      await saveDb();

      // Build payload
      let transcriptText = '';
      if (targetVideos.length === 1) {
        const v = targetVideos[0];
        transcriptText = `Видео: "${v.title}"\nКанал: ${v.channelTitle}\nСсылка: ${v.url}\n\nТранскрипт видео:\n${v.transcript}`;
      } else {
        transcriptText = targetVideos
          .map(
            (v, i) =>
              `=== ВИДЕО #${i + 1} ===\nНазвание: "${v.title}"\nКанал: ${v.channelTitle}\nСсылка: ${v.url}\n\nТранскрипт:\n${v.transcript?.slice(0, 35000)}`
          )
          .join('\n\n' + '='.repeat(40) + '\n\n');
      }

      // Choose prompt
      let basePrompt = '';
      if (customPrompt && typeof customPrompt === 'string' && customPrompt.trim()) {
        basePrompt = customPrompt.trim();
      } else {
        const key = promptTemplate || 'instagram_editor';
        const found = (db.promptTemplates || []).find((t) => t.id === key);
        if (found) {
          basePrompt = found.text;
        } else if ((PROMPT_TEMPLATES as any)[key]) {
          basePrompt = (PROMPT_TEMPLATES as any)[key];
        } else {
          basePrompt = PROMPT_TEMPLATES.instagram_editor;
        }
      }

      const fullPrompt = `${basePrompt}\n\n${'='.repeat(40)}\nМАТЕРИАЛЫ ВИДЕО ДЛЯ АНАЛИЗА:\n${'='.repeat(40)}\n\n${transcriptText}`;

      // Generate with Gemini
      const generatedContent = await generateWithFallback([{ text: fullPrompt }]);

      // Check if video matched filter criteria
      const isFilteredOut = checkIfFilteredOut(generatedContent);

      const isStage1Screener = promptTemplate === 'filter_screener';
      let newScript: any = null;

      if (!db.scripts) db.scripts = [];

      if (!isFilteredOut && !isStage1Screener) {
        newScript = {
          id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date().toISOString(),
          title:
            targetVideos.length === 1
              ? `Сценарий: ${targetVideos[0].title}`
              : `Сценарии по ${targetVideos.length} видео (${targetVideos[0].channelTitle}...)`,
          promptTemplate: promptTemplate || 'instagram_editor',
          customPrompt: customPrompt || undefined,
          videoIds: targetVideos.map((v) => v.id),
          videoTitles: targetVideos.map((v) => v.title),
          content: generatedContent,
          matchedFilter: true,
          telegramSent: false,
        };
        db.scripts.unshift(newScript);
      }

      // Also update video objects so they reflect the latest script status
      const nowIso = new Date().toISOString();
      if (targetVideos.length === 1) {
        const v = targetVideos[0];
        v.geminiResult = generatedContent;
        v.geminiPromptTemplate = promptTemplate || 'instagram_editor';
        v.customPromptUsed = customPrompt;
        v.matchedFilter = !isFilteredOut;
        v.status = 'completed';
        v.processedAt = nowIso;
        v.scriptCount = db.scripts.filter((s) => s.videoIds && s.videoIds.includes(v.id) && s.matchedFilter !== false).length;
        v.updatedAt = nowIso;
      } else {
        for (const v of targetVideos) {
          v.status = 'completed';
          v.matchedFilter = !isFilteredOut;
          v.processedAt = nowIso;
          v.scriptCount = db.scripts.filter((s) => s.videoIds && s.videoIds.includes(v.id) && s.matchedFilter !== false).length;
          v.updatedAt = nowIso;
        }
      }

      // If sendToTelegram requested
      let telegramResult = null;
      if (sendToTelegram && !isStage1Screener) {
        if (isFilteredOut && skipTelegramIfNotMatched) {
          await addLog('info', `Видео не подошло под критерии фильтра ("${targetVideos[0]?.title || 'Видео'}"). Публикация в Telegram пропущена.`);
        } else if (!isFilteredOut) {
          const targetChat = telegramChatId || db.settings.telegramChatId || process.env.TELEGRAM_CHAT_ID;
          telegramResult = await sendTelegramMessage(generatedContent, {
            chatId: targetChat,
            header: `🎬 *${newScript?.title || targetVideos[0]?.title || 'Сценарий'}*\n📅 ${new Date().toLocaleDateString('ru-RU')}`,
          });

          if (telegramResult.ok && newScript) {
            newScript.telegramSent = true;
            (newScript as any).telegramSentAt = new Date().toISOString();
            (newScript as any).telegramMessageIds = telegramResult.messageIds;
            await addLog('success', `Сценарий успешно отправлен в Telegram (${targetChat})`);
          } else if (!telegramResult.ok) {
            await addLog('warn', `Сценарий сгенерирован, но не удалось отправить в Telegram: ${telegramResult.error}`);
          }
        }
      }

      await saveDb();
      await addLog(
        isFilteredOut ? 'info' : 'success',
        `Сценарий Gemini обработан ("${newScript.title}"). ${isFilteredOut ? '⚠️ Не подошло под фильтр' : '✓ Найдено совпадение'}`
      );

      res.json({
        script: newScript,
        isFilteredOut,
        telegramResult,
      });
    } catch (err: any) {
      console.error('Script generation failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Settings
  app.get('/api/settings', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const settings = getSettingsForOwner(db, ownerId);
      // Never return provider API keys to the browser.
      res.json({
        ...settings,
        supadataApiKey: settings.supadataApiKey ? '••••••••' : '',
        chocodataApiKey: settings.chocodataApiKey ? '••••••••' : '',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const currentSettings = getSettingsForOwner(db, ownerId);
      const {
        dailySyncEnabled,
        intervalHours,
        autoProcessNewVideos,
        autoProcessMode,
        defaultPromptTemplate,
        defaultFilterPromptTemplate,
        defaultScriptwriterPromptTemplate,
        customFilterPrompt,
        customScriptwriterPrompt,
        customPrompt,
        telegramAutoSend,
        telegramChatId,
        skipTelegramIfFilteredOut,
        supadataApiKey,
        chocodataApiKey,
      } = req.body;

      const updated = { ...currentSettings };
      if (typeof dailySyncEnabled === 'boolean') updated.dailySyncEnabled = dailySyncEnabled;
      if (typeof intervalHours === 'number' && intervalHours > 0) updated.intervalHours = intervalHours;
      if (typeof autoProcessNewVideos === 'boolean') updated.autoProcessNewVideos = autoProcessNewVideos;
      if (typeof autoProcessMode === 'string') updated.autoProcessMode = autoProcessMode as any;
      if (defaultPromptTemplate) updated.defaultPromptTemplate = defaultPromptTemplate;
      if (defaultFilterPromptTemplate) updated.defaultFilterPromptTemplate = defaultFilterPromptTemplate;
      if (defaultScriptwriterPromptTemplate) updated.defaultScriptwriterPromptTemplate = defaultScriptwriterPromptTemplate;
      if (typeof customFilterPrompt === 'string') updated.customFilterPrompt = customFilterPrompt;
      if (typeof customScriptwriterPrompt === 'string') updated.customScriptwriterPrompt = customScriptwriterPrompt;
      if (typeof customPrompt === 'string') updated.customPrompt = customPrompt;
      if (typeof telegramAutoSend === 'boolean') updated.telegramAutoSend = telegramAutoSend;
      if (typeof telegramChatId === 'string') updated.telegramChatId = telegramChatId;
      if (typeof skipTelegramIfFilteredOut === 'boolean') updated.skipTelegramIfFilteredOut = skipTelegramIfFilteredOut;
      if (typeof supadataApiKey === 'string' && supadataApiKey.trim() && supadataApiKey.trim() !== '••••••••') {
        updated.supadataApiKey = supadataApiKey.trim();
      }
      if (typeof chocodataApiKey === 'string' && chocodataApiKey.trim() && chocodataApiKey.trim() !== '••••••••') {
        updated.chocodataApiKey = chocodataApiKey.trim();
      }

      // Recalculate next sync run
      if (updated.dailySyncEnabled && !updated.nextSyncRun) {
        updated.nextSyncRun = new Date(Date.now() + (updated.intervalHours || 24) * 3600000).toISOString();
      }

      const saved = saveSettingsForOwner(db, updated, ownerId);
      await saveDb();
      await addLog('info', 'Настройки автопроверки, Telegram и шаблонов обновлены', { ownerId });
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Test Supadata API Key
  app.post('/api/settings/test-supadata', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const settings = getSettingsForOwner(db, ownerId);
      const apiKey = (req.body.apiKey || process.env.SUPADATA_API_KEY || settings.supadataApiKey || '').trim();
      const result = await testSupadataConnection(apiKey);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Test ChocoData API Key
  app.post('/api/settings/test-chocodata', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      const settings = getSettingsForOwner(db, ownerId);
      const apiKey = (req.body.apiKey || process.env.CHOCODATA_API_KEY || settings.chocodataApiKey || '').trim();
      const result = await testChocodataConnection(apiKey);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Manual Trigger: Run daily sync right now
  app.post('/api/sync/run-now', async (req, res) => {
    try {
      const result = await runChannelsSync(true);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Logs
  app.get('/api/logs', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      res.json(getLogsForOwner(db, ownerId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/videos/clean-stale-errors', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      let count = 0;
      const cleanedIds: string[] = [];
      const ownerVideos = getVideosForOwner(db, ownerId);
      for (const v of ownerVideos) {
        if (v.status === 'new' && v.errorStage === 'transcription' && !v.transcript) {
          v.errorStage = undefined;
          v.error = undefined;
          v.rejectionCategory = undefined;
          v.filterReason = undefined;
          cleanedIds.push(v.id);
          count++;
        }
      }
      await saveDb();
      await addLog('info', `[Очистка данных] Сняты зависшие флаги errorStage=transcription у ${count} новых видео: ${cleanedIds.join(', ')}`, { ownerId });
      res.json({ success: true, count, cleanedIds });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/logs/clear', async (req, res) => {
    try {
      const db = await getDb();
      const ownerId = resolveOwnerId(db, req.user?.uid, req.user?.email);
      db.logs = (db.logs || []).filter((l) => !(l.ownerId === ownerId || (!l.ownerId && ownerId === 'legacy-account-1')));
      await saveDb();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper to repair / synchronize dates for all videos
  async function syncAllVideoDates(db: any) {
    let updatedCount = 0;
    // 1. First sync from RSS for all tracked channels
    for (const channel of db.channels) {
      try {
        const { videos } = await fetchChannelVideos(channel.id);
        for (const v of videos) {
          const existing = db.videos.find((e: any) => e.id === v.id);
          if (existing && v.publishedAt && existing.publishedAt !== v.publishedAt) {
            existing.publishedAt = v.publishedAt;
            updatedCount++;
          }
        }
      } catch (err) {
        console.warn(`[DateFix] RSS sync failed for ${channel.title}:`, err);
      }
    }

    // 2. For any remaining videos that have duplicate / recent fallback timestamps, fetch exact watch page date
    const nowIso = new Date().toISOString().slice(0, 10);
    const suspicious = db.videos.filter((v: any) => {
      if (!v.publishedAt) return true;
      // If date is today or suspicious default batch
      return v.publishedAt.startsWith('2026-09-12') || v.publishedAt.startsWith(nowIso);
    });

    for (const v of suspicious) {
      try {
        const exactDate = await fetchVideoExactPublishDate(v.id);
        if (exactDate && exactDate !== v.publishedAt) {
          v.publishedAt = exactDate;
          updatedCount++;
        }
      } catch {}
    }

    if (updatedCount > 0) {
      await saveDb();
    }
    return updatedCount;
  }

  // Fix / synchronize dates for all channels
  app.post('/api/channels/fix-all-dates', async (req, res) => {
    try {
      const db = await getDb();
      const updatedCount = await syncAllVideoDates(db);
      if (updatedCount > 0) {
        await addLog('info', `Обновлены даты публикации для ${updatedCount} видео из YouTube`);
      }
      res.json({ success: true, updatedCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Prompt templates
  app.get('/api/prompt-templates', (req, res) => {
    res.json(PROMPT_TEMPLATES);
  });

  // Catch-all 404 for API routes so they return JSON errors instead of falling through to Vite's index.html
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
  });

  // Serve static assets from public folder (favicons, icons, etc.)
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start background scheduler
  startBackgroundScheduler();

  // Background check to fix and refresh legacy dates
  setTimeout(async () => {
    try {
      const db = await getDb();
      const count = await syncAllVideoDates(db);
      if (count > 0) {
        console.log(`[Startup] Synchronized ${count} video dates from YouTube.`);
      }
    } catch (e) {
      console.warn('[Startup] Date check notice:', e);
    }
  }, 2000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
