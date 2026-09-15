import fs from 'fs/promises';
import path from 'path';
import { PromptTemplateDef, DEFAULT_PROMPT_DEFINITIONS } from './gemini.js';

export interface TrackedChannel {
  id: string; // YouTube Channel ID (e.g. UC...)
  title: string;
  handle?: string;
  avatarUrl?: string;
  url: string;
  autoSync: boolean;
  lastCheckedAt?: string;
  createdAt: string;
  videoCount?: number;
}

export interface DeletedVideoInfo {
  id: string;
  title: string;
  channelId: string;
  channelTitle?: string;
  thumbnail?: string;
  publishedAt?: string;
  deletedAt: string;
  permanentlyIgnored?: boolean;
}

export interface StoredVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  url: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  status: 'new' | 'transcribe_queued' | 'transcribing' | 'transcribed' | 'processing_gemini' | 'completed' | 'error' | 'quota_exceeded' | 'requires_payment';
  pendingPaidAction?: 'transcription' | 'stage1' | 'filter' | 'stage2' | 'script' | 'pipeline' | string;
  paidActionReason?: string;
  lastPassedStatus?: 'new' | 'transcribed' | 'approved' | 'rejected' | 'has_script';
  errorStage?: 'transcription' | 'filter' | 'script' | string;
  transcript?: string;
  transcriptSource?: 'subtitles' | 'gemini_multimodal';
  transcriptSegments?: Array<{
    text: string;
    offset: number;
    duration: number;
    formattedTime: string;
  }>;
  geminiResult?: string;
  geminiPromptTemplate?: string;
  customPromptUsed?: string;
  matchedFilter?: boolean;
  filterReason?: string;
  rejectionCategory?: 'filter' | 'transcription' | string;
  scriptCount?: number;
  isReviewed?: boolean;
  reviewedAt?: string;
  isArchived?: boolean;
  queueTimestamp?: string;
  processedAt?: string;
  error?: string;
  forcePaidModel?: boolean;
  updatedAt: string;
}

export interface SyncLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
  videoTitle?: string;
  videoId?: string;
}

export interface AppSettings {
  dailySyncEnabled: boolean;
  intervalHours: number; // default 24
  autoProcessNewVideos: boolean; // if true, auto transcribes & sends to gemini
  autoProcessMode?: 'filter_screener' | 'transcription_only' | 'two_stage_pipeline'; // default 'filter_screener' (Stage 1 only, no scenario writing)
  defaultPromptTemplate: string;
  defaultFilterPromptTemplate?: string;
  defaultScriptwriterPromptTemplate?: string;
  customFilterPrompt?: string;
  customScriptwriterPrompt?: string;
  customPrompt: string;
  youtubeCookie?: string;
  telegramAutoSend?: boolean;
  telegramChatId?: string;
  skipTelegramIfFilteredOut?: boolean;
  lastSyncRun: string | null;
  nextSyncRun: string | null;
}

export interface GeneratedScript {
  id: string;
  createdAt: string;
  title: string;
  promptTemplate: string;
  customPrompt?: string;
  customPromptUsed?: string;
  ideaTitle?: string;
  videoIds: string[];
  videoTitles: string[];
  content: string;
  matchedFilter?: boolean;
  telegramSent?: boolean;
  telegramSentAt?: string;
  telegramMessageIds?: number[];
}

export interface AppDatabase {
  channels: TrackedChannel[];
  videos: StoredVideo[];
  deletedVideos?: DeletedVideoInfo[];
  settings: AppSettings;
  scripts: GeneratedScript[];
  promptTemplates: PromptTemplateDef[];
  logs: SyncLog[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

const USER_DEFAULT_YOUTUBE_COOKIE = `# Netscape HTTP Cookie File
# https://curl.haxx.se/rfc/cookie_spec.html
# This is a generated file! Do not edit.

.youtube.com	TRUE	/	TRUE	1813049799	LOGIN_INFO	AFmmF2swRgIhAMZqr1ww3615gI9XXKYafqYEjiNib5DHnTLE5iqa_4B0AiEAj8zylO-vk8EyUWxIgVDFKfoz3QX88ZFVH15rmOptMOs:QUQ3MjNmenlvd01hZ191TnhQOFduMlAyNUxtMXRTZHd6ZVJ6THpOVjB5bFF4Q3hjWW5zOEdreHRacVpEUE4tM1V3MjJfYjFja0ZmQ3ZYelpnMEJNVE45aG5TQ09YeFpsdDdUNUhGZlNyc0xLbkVNam5saTVvaHdabGl3bzJqdmQ4UUJtRUZENFE4S1dQRVhOR3YxbUFScWxHSzloVUpXNlR3
.youtube.com	TRUE	/	FALSE	1822326276	HSID	Ak55x-hWetMpUwko3
.youtube.com	TRUE	/	TRUE	1822326276	SSID	A95NTEIgeXy8tgODd
.youtube.com	TRUE	/	FALSE	1822326276	APISID	dks9SZwGrJPfK_8i/ApCxC7tZmZjaEazCV
.youtube.com	TRUE	/	TRUE	1822326276	SAPISID	ygJxkmWrhq_s4lGw/AfeZOWWi_lYo73Udh
.youtube.com	TRUE	/	TRUE	1822326276	__Secure-1PAPISID	ygJxkmWrhq_s4lGw/AfeZOWWi_lYo73Udh
.youtube.com	TRUE	/	TRUE	1822326276	__Secure-3PAPISID	ygJxkmWrhq_s4lGw/AfeZOWWi_lYo73Udh
.youtube.com	TRUE	/	FALSE	1822326276	SID	g.a000BwlGT9fFWof9mTbxmr5llryPxE6dHdbYQ2PZ9n1HIw0eMKrlYMx0vUEZjF-xK72CSiw0lwACgYKAQgSARMSFQHGX2MiZIiC1J5WRzOEOnHnUs3IexoVAUF8yKoEMEWI-40WpJ_-o9NtDiyd0076
.youtube.com	TRUE	/	TRUE	1822326276	__Secure-1PSID	g.a000BwlGT9fFWof9mTbxmr5llryPxE6dHdbYQ2PZ9n1HIw0eMKrlrRTLLOgylNWgPN3Onopj4QACgYKARoSARMSFQHGX2Mix-S4o98CtKDJIxU3Aige8hoVAUF8yKqDsCGD8GYkkUDRctS5pG1f0076
.youtube.com	TRUE	/	TRUE	1822326276	__Secure-3PSID	g.a000BwlGT9fFWof9mTbxmr5llryPxE6dHdbYQ2PZ9n1HIw0eMKrlPWC0pzKnzuX7xKRSDQZCZgACgYKATASARMSFQHGX2MiHvPXm1xMV-VGutCH46ctFxoVAUF8yKrv_H0t5gHhbUYu75XzMzBk0076
.youtube.com	TRUE	/	FALSE	0	wide	1
.youtube.com	TRUE	/	TRUE	1820941721	__Secure-1PSIDTS	sidts-CjEBXMw41dP-28ox-bNbf814MLQ41P0wrzfg1yRJhxMPYuhI1NXF_Zq9NlttwX5SDvmHEAA
.youtube.com	TRUE	/	TRUE	1820941721	__Secure-3PSIDTS	sidts-CjEBXMw41dP-28ox-bNbf814MLQ41P0wrzfg1yRJhxMPYuhI1NXF_Zq9NlttwX5SDvmHEAA
.youtube.com	TRUE	/	TRUE	1823966048	PREF	f6=80&f7=150&tz=Asia.Baku&f5=30000
.youtube.com	TRUE	/	FALSE	1820942051	SIDCC	AKEyXzW99zwVJenO0uCbvgmHxZXmnb7lIsmSVa6igSj9QXOLADzjIEBRzSWTZ1QNwsNiapdPLw
.youtube.com	TRUE	/	TRUE	1820942051	__Secure-1PSIDCC	AKEyXzV9KRuJ-EVW3UqH5ee7AcSd2ttyU5U55kSxSWkVqI_XmSf31rFYM27yXMQf6GXe64z2Opo
.youtube.com	TRUE	/	TRUE	1820942051	__Secure-3PSIDCC	AKEyXzVcq-v7jKdRpfkkDb7b-wGtU5YfHK-w1IbHkmzzj5K4l8G6dbLVWbDwo069HFRSPLkPE7A
.youtube.com	TRUE	/	TRUE	1804958046	VISITOR_INFO1_LIVE	duIaIIYv6aU
.youtube.com	TRUE	/	TRUE	1804958046	VISITOR_PRIVACY_METADATA	CgJBWhIEGgAgOg%3D%3D
.youtube.com	TRUE	/	TRUE	0	YSC	_g9mXeIMsFw
.youtube.com	TRUE	/	TRUE	1804880178	__Secure-YNID	21.YT=BXkpcrIq0GKCHzS3vejBZhrhpsm4pRo1-FIzCQypGH2BWsBHblmhpaikBEL8IJIbWF018BYEftVJHuR3s6fZkUGCV6pai8rrdXjh7azulQA7W3hOB93LiyWdTPt4BZ556MUWf9YNp6fRlXOVgT75sn5UCvTRic3CCK5Tb6pHYqjumUdtjXD8oJ43j-mfBPrqFwIcJnkjHViMTJdRPKZB0KMCLKROOB69NCSxoxNnwG796CLBikFjb2Z7NERh6h1hr8PtJf0OQnPjU8lKsaE9zkQs0syt9XbS8dApiF5zXClTXV4MZz_IkbXik8nmrqHNoXcCwfBDCEG67J0zAqOZOw
.youtube.com	TRUE	/	TRUE	1804880178	__Secure-ROLLOUT_TOKEN	CPDfwq_V14qDYhDw35qb27CUAxid8a3zpuyWAw%3D%3D`;

const DEFAULT_DB: AppDatabase = {
  channels: [],
  videos: [],
  deletedVideos: [],
  settings: {
    dailySyncEnabled: true,
    intervalHours: 24,
    autoProcessNewVideos: false,
    autoProcessMode: 'filter_screener',
    defaultPromptTemplate: 'two_stage_pipeline',
    defaultFilterPromptTemplate: 'filter_screener',
    defaultScriptwriterPromptTemplate: 'scriptwriter_deep',
    customPrompt: '',
    customFilterPrompt: '',
    customScriptwriterPrompt: '',
    youtubeCookie: USER_DEFAULT_YOUTUBE_COOKIE,
    telegramAutoSend: false,
    telegramChatId: '',
    lastSyncRun: null,
    nextSyncRun: null,
  },
  scripts: [],
  promptTemplates: [...DEFAULT_PROMPT_DEFINITIONS],
  logs: [
    {
      id: 'init-1',
      timestamp: new Date().toISOString(),
      type: 'info',
      message: 'Система мониторинга каналов и конвертации в Gemini инициализирована.',
    },
  ],
};

let memoryDb: AppDatabase | null = null;
let writeQueue = Promise.resolve();

export async function getDb(): Promise<AppDatabase> {
  if (memoryDb) return memoryDb;

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const content = await fs.readFile(DB_FILE, 'utf-8');
    memoryDb = JSON.parse(content);
    if (!memoryDb!.scripts) {
      memoryDb!.scripts = [];
    }
    if (!memoryDb!.deletedVideos) {
      memoryDb!.deletedVideos = [];
    }
    if (!memoryDb!.promptTemplates || memoryDb!.promptTemplates.length === 0) {
      memoryDb!.promptTemplates = [...DEFAULT_PROMPT_DEFINITIONS];
    }
    if (!memoryDb!.settings) {
      memoryDb!.settings = DEFAULT_DB.settings;
    }
    if (!memoryDb!.settings.youtubeCookie || memoryDb!.settings.youtubeCookie.trim() === '') {
      memoryDb!.settings.youtubeCookie = USER_DEFAULT_YOUTUBE_COOKIE;
    }
    // Sanitize any stuck processing statuses if no background worker is running
    if (memoryDb && memoryDb.videos) {
      for (const v of memoryDb.videos) {
        if (v.status === 'transcribing' || v.status === 'processing_gemini' || v.status === 'transcribe_queued') {
          if (v.transcript && v.transcript.trim().length > 0) {
            v.status = 'transcribed';
          } else {
            v.status = 'completed';
            v.matchedFilter = false;
            v.rejectionCategory = 'transcription';
            v.filterReason = 'Нет текста — транскрипция не дала результата';
            v.lastPassedStatus = 'rejected';
          }
        } else if (v.status === 'transcribed' && (!v.transcript || v.transcript.trim().length === 0)) {
          v.status = 'completed';
          v.matchedFilter = false;
          v.rejectionCategory = 'transcription';
          v.filterReason = 'Нет текста — транскрипция не дала результата';
          v.lastPassedStatus = 'rejected';
        }
      }
    }
    return memoryDb!;
  } catch {
    memoryDb = JSON.parse(JSON.stringify(DEFAULT_DB));
    await saveDb();
    return memoryDb!;
  }
}

export async function saveDb(): Promise<void> {
  if (!memoryDb) return;
  writeQueue = writeQueue.then(async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tempFile = `${DB_FILE}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(memoryDb, null, 2), 'utf-8');
      await fs.rename(tempFile, DB_FILE);
    } catch (err) {
      console.error('Failed to save DB to disk:', err);
    }
  });
  return writeQueue;
}

export async function addLog(type: SyncLog['type'], message: string, extra?: { videoTitle?: string; videoId?: string }) {
  const db = await getDb();
  const log: SyncLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    type,
    message,
    ...extra,
  };
  db.logs.unshift(log);
  if (db.logs.length > 200) {
    db.logs = db.logs.slice(0, 200);
  }
  await saveDb();
  return log;
}
