import fs from 'fs';
import os from 'os';
import path from 'path';
import ytdl from '@distube/ytdl-core';
import { generateWithFallback, getGemini } from './gemini.js';
import { TranscriptSegment } from './youtube.js';

export interface AudioTranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  source: 'gemini_audio_file';
}

export class YouTubeBotBlockError extends Error {
  isBotBlock: boolean = true;
  constructor(message?: string) {
    super(
      message ||
        'Не удалось скачать аудиопоток: YouTube заблокировал прямое скачивание с сервера (защита BotGuard / проверка на бота).'
    );
    this.name = 'YouTubeBotBlockError';
  }
}

function formatSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Downloads audio stream of a YouTube video to a temporary local file.
 */
async function downloadYouTubeAudio(videoId: string): Promise<{ tempFilePath: string; mimeType: string }> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const tempFilePath = path.join(os.tmpdir(), `yt_audio_${videoId}_${Date.now()}.mp4`);

  try {
    const info = await ytdl.getInfo(videoUrl, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
    });

    const audioFormat = ytdl.chooseFormat(info.formats, {
      quality: 'lowestaudio',
      filter: 'audioonly',
    });

    if (!audioFormat || !audioFormat.url) {
      throw new Error('Не найден подходящий аудиоформат');
    }

    const mimeType = audioFormat.mimeType ? audioFormat.mimeType.split(';')[0] : 'audio/mp4';

    await new Promise<void>((resolve, reject) => {
      const stream = ytdl.downloadFromInfo(info, { format: audioFormat });
      const writeStream = fs.createWriteStream(tempFilePath);

      stream.on('error', (err) => {
        writeStream.close();
        if (fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch {}
        }
        reject(err);
      });

      writeStream.on('error', (err) => {
        if (fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch {}
        }
        reject(err);
      });

      writeStream.on('finish', () => {
        resolve();
      });

      stream.pipe(writeStream);
    });

    return { tempFilePath, mimeType };
  } catch (err: any) {
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
    const msg = err?.message || String(err);
    if (
      msg.includes('Sign in to confirm you') ||
      msg.includes('bot') ||
      msg.includes('botguard') ||
      msg.includes('Status code: 403') ||
      msg.includes('LOGIN_REQUIRED')
    ) {
      throw new YouTubeBotBlockError(
        'Не удалось скачать аудиопоток: YouTube заблокировал прямое скачивание с сервера (защита BotGuard / проверка на бота).'
      );
    }
    if (msg.includes('Private video') || msg.includes('restricted')) {
      throw new Error(`Не удалось скачать аудиопоток видео: ограничение доступа YouTube (${msg})`);
    }
    throw new Error(`Не удалось скачать аудиопоток видео: ${msg}`);
  }
}

/**
 * Uploads audio to Gemini File API, generates transcript with timestamps,
 * and guarantees cleanup of both local temp file and Gemini remote file.
 */
export async function transcribeVideoAudioWithGemini(
  videoId: string,
  videoTitle?: string,
  options?: { forcePaidModel?: boolean }
): Promise<AudioTranscriptionResult> {
  const { tempFilePath, mimeType } = await downloadYouTubeAudio(videoId);
  const ai = getGemini();
  let uploadedFileName: string | null = null;

  try {
    console.log(`[Audio Pipeline] Uploading ${tempFilePath} to Gemini File API...`);
    const fileUploadResponse = await ai.files.upload({
      file: tempFilePath,
      config: {
        mimeType: mimeType || 'audio/mp4',
      },
    });

    uploadedFileName = fileUploadResponse.name;
    const fileUri = fileUploadResponse.uri;
    console.log(`[Audio Pipeline] Uploaded to Gemini: ${uploadedFileName} (${fileUri})`);

    const prompt = `Ты профессиональный стенографист и транскрибатор.
Пожалуйста, сделай точную, полную и связную текстовую расшифровку этого аудиофайла на русском языке (если в аудио другой язык, сделай расшифровку и перевод).
Разбей текст на смысловые абзацы и обязательно укажи таймкоды в формате [ММ:СС] для каждого смыслового блока.`;

    console.log('[Audio Pipeline] Transcribing through Gemini priority router...');
    const generatedText = await generateWithFallback(
      [
        {
          fileData: {
            fileUri,
            mimeType: mimeType || 'audio/mp4',
          },
        },
        {
          text: prompt,
        },
      ],
      {
        forcePaidModel: options?.forcePaidModel ?? false,
        operation: 'audio_transcription',
        videoId,
        videoTitle,
      }
    );
    if (!generatedText || generatedText.trim().length < 20) {
      throw new Error('Gemini вернул пустую расшифровку для загруженного аудиофайла.');
    }

    const segments: TranscriptSegment[] = [];
    const timestampRegex = /(?:###\s*)?\[(\d{1,2}:\d{2}(?::\d{2})?)\](?:[—\-–\s]*)(.+?)(?=(?:\[\d{1,2}:\d{2}|\n\n|$))/gs;
    let match;
    while ((match = timestampRegex.exec(generatedText)) !== null) {
      const timeStr = match[1];
      const text = match[2].trim().replace(/^\*\*|^\*|\*\*$/g, '').trim();
      if (text) {
        const parts = timeStr.split(':').map(Number);
        let seconds = 0;
        if (parts.length === 2) {
          seconds = parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
          seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        segments.push({
          offset: seconds,
          duration: 10,
          formattedTime: timeStr,
          text: text.replace(/^[:\-–—\s*]+/, ''),
        });
      }
    }

    if (segments.length === 0 && generatedText.trim().length >= 50) {
      const paragraphs = generatedText
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 20 && !p.startsWith('#'));

      paragraphs.forEach((p, idx) => {
        const offset = idx * 30;
        segments.push({
          offset,
          duration: 30,
          formattedTime: formatSeconds(offset),
          text: p,
        });
      });
    }

    return {
      text: generatedText,
      segments: segments.length > 0 ? segments : [
        {
          offset: 0,
          duration: 60,
          formattedTime: '00:00',
          text: generatedText,
        },
      ],
      source: 'gemini_audio_file',
    };
  } finally {
    // 1. Cleanup local temporary audio file
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`[Audio Pipeline] Cleaned up local file: ${tempFilePath}`);
      } catch (cleanupErr) {
        console.warn(`[Audio Pipeline] Failed to delete local temp file ${tempFilePath}:`, cleanupErr);
      }
    }

    // 2. Cleanup remote file from Gemini storage
    if (uploadedFileName) {
      try {
        await ai.files.delete({ name: uploadedFileName });
        console.log(`[Audio Pipeline] Cleaned up Gemini cloud file: ${uploadedFileName}`);
      } catch (remoteCleanupErr) {
        console.warn(`[Audio Pipeline] Failed to delete Gemini cloud file ${uploadedFileName}:`, remoteCleanupErr);
      }
    }
  }
}
