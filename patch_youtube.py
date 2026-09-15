import re

with open('server/youtube.ts', 'r') as f:
    content = f.read()

# 1. Update fetchCaptionsViaInnertube error handling

inner_tube_repl = """
    // Call Innertube player endpoint with WEB client
    const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: {
          client: {
            hl: 'ru',
            gl: 'RU',
            clientName: 'WEB',
            clientVersion: '2.20260911.01.00',
          },
        },
        videoId,
      }),
    });

    if (!playerRes.ok) {
      const errorText = await playerRes.text();
      console.warn(`[Innertube] Player API HTTP error: ${playerRes.status} ${playerRes.statusText}`);
      console.warn(`[Innertube] Response body:`, errorText);
      throw new Error(`Innertube HTTP ${playerRes.status} ${playerRes.statusText}: ${errorText}`);
    }

    const playerData = await playerRes.json();
    const captionTracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || !Array.isArray(captionTracks) || captionTracks.length === 0) {
      const playability = playerData.playabilityStatus?.status || 'unknown';
      const reason = playerData.playabilityStatus?.reason || playerData.playabilityStatus?.messages?.[0] || 'Unknown reason';
      console.warn(`[Innertube] No captionTracks found for video ${videoId}. Playability: ${playability}, Reason: ${reason}`);
      throw new Error(`Отсутствуют субтитры. Статус: ${playability}. Причина: ${reason}`);
    }

    // Find best matching track: Russian (manual or auto) -> English -> First available
    let selectedTrack = captionTracks.find((t: any) => t.languageCode === 'ru' && !t.kind);
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((t: any) => t.languageCode === 'ru');
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((t: any) => t.languageCode === 'en');
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks[0];
    }

    if (!selectedTrack || !selectedTrack.baseUrl) {
      throw new Error('No valid track URL found');
    }

    // Fetch XML timedtext
    const captionFetchHeaders: Record<string, string> = {
      'User-Agent': headers['User-Agent'],
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
    };
    if (parsed.cookie && parsed.cookie.trim()) {
      captionFetchHeaders['Cookie'] = parsed.cookie.trim();
    }

    const xmlRes = await fetch(selectedTrack.baseUrl, { headers: captionFetchHeaders });
    if (!xmlRes.ok) {
      const trackErrText = await xmlRes.text();
      console.warn(`[Innertube] Failed to fetch track XML. HTTP ${xmlRes.status}: ${trackErrText}`);
      throw new Error(`Failed to fetch XML timedtext. HTTP ${xmlRes.status}: ${trackErrText}`);
    }
"""

old_innertube = """
    // Call Innertube player endpoint with WEB client
    const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: {
          client: {
            hl: 'ru',
            gl: 'RU',
            clientName: 'WEB',
            clientVersion: '2.20260911.01.00',
          },
        },
        videoId,
      }),
    });

    if (!playerRes.ok) {
      console.warn(`[Innertube] Player API HTTP error: ${playerRes.status}`);
      return null;
    }

    const playerData = await playerRes.json();
    const captionTracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || !Array.isArray(captionTracks) || captionTracks.length === 0) {
      console.log(`[Innertube] No captionTracks found for video ${videoId} (Playability: ${playerData.playabilityStatus?.status || 'unknown'})`);
      return null;
    }

    // Find best matching track: Russian (manual or auto) -> English -> First available
    let selectedTrack = captionTracks.find((t: any) => t.languageCode === 'ru' && !t.kind);
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((t: any) => t.languageCode === 'ru');
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((t: any) => t.languageCode === 'en');
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks[0];
    }

    if (!selectedTrack || !selectedTrack.baseUrl) {
      return null;
    }

    // Fetch XML timedtext
    const captionFetchHeaders: Record<string, string> = {
      'User-Agent': headers['User-Agent'],
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
    };
    if (parsed.cookie && parsed.cookie.trim()) {
      captionFetchHeaders['Cookie'] = parsed.cookie.trim();
    }

    const xmlRes = await fetch(selectedTrack.baseUrl, { headers: captionFetchHeaders });
    if (!xmlRes.ok) {
      return null;
    }
"""

if old_innertube.strip() in content:
    content = content.replace(old_innertube.strip(), inner_tube_repl.strip())
else:
    print("Could not find innertube logic to replace")

# 2. Update extractVideoTranscript Level B to catch detailed errors, and Level C to throw 429 specifically

level_b_c_repl = """
  // Level B: Direct Innertube Player API with YouTube Cookie session
  try {
    const innertubeResult = await fetchCaptionsViaInnertube(videoId, options?.customCookie);
    if (innertubeResult && innertubeResult.segments.length > 0) {
      console.log(`[Transcript Level B] Successfully fetched ${innertubeResult.segments.length} caption segments via Innertube for ${videoId}!`);
      return {
        text: innertubeResult.text,
        segments: innertubeResult.segments,
        source: 'subtitles',
      };
    }
  } catch (innertubeErr: any) {
    console.warn(`[Transcript Level B] Innertube failed for ${videoId}:`, innertubeErr.message || innertubeErr);
  }

  // Level C: Gemini AI Multimodal Video/Audio Comprehension (Always trigger if A and B fail, unless quota exceeded)
  if (allowGeminiFallback) {
    try {
      console.log(`[Transcript Level C] Running Gemini AI Multimodal comprehension for ${videoId}...`);
      const prompt = `Ты профессиональный транскрибатор и аналитик видео. 
Пожалуйста, внимательно проанализируй звуковую дорожку и видеоряд этого YouTube видео: ${videoUrl}
Название: "${videoTitle || 'YouTube Video'}"

Сделай полную, подробную и связную расшифровку (транскрипцию) речи из этого видео на русском языке (если язык оригинала другой, предоставь точную расшифровку и перевод).
Структурируй текст с временными метками в формате [ММ:СС] или [ЧЧ:ММ:СС] для каждой смысловой фразы или блока речи.`;

      const generatedText = await generateWithFallback([
        {
          text: prompt,
        },
      ]);

      const segments: TranscriptSegment[] = [];
      const timestampRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?:\*\*)?\s*([^[\n]+)/g;
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
            text: text.replace(/^[:\-–—\s]+/, ''),
          });
        }
      }

      return {
        text: generatedText,
        segments,
        source: 'gemini_multimodal',
      };
    } catch (geminiErr: any) {
      console.error('Gemini video analysis error:', geminiErr);
      const errMsg = geminiErr.message || String(geminiErr);
      if (errMsg.includes('429') || errMsg.includes('Quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        const error: any = new Error(`Gemini API Quota Exceeded (429): ${errMsg}`);
        error.isQuotaExceeded = true;
        throw error;
      }
      throw new Error(`Не удалось транскрибировать видео через Gemini AI: ${errMsg}`);
    }
  }

  throw new Error(
    'Субтитры недоступны на YouTube (или заблокированы). Добавьте YouTube Cookies в настройках (Уровень Б) либо запустите AI Аудио-расшифровку (Уровень В).'
  );
"""

old_level_b_c = """
  // Level B: Direct Innertube Player API with YouTube Cookie session
  try {
    const innertubeResult = await fetchCaptionsViaInnertube(videoId, options?.customCookie);
    if (innertubeResult && innertubeResult.segments.length > 0) {
      console.log(`[Transcript Level B] Successfully fetched ${innertubeResult.segments.length} caption segments via Innertube for ${videoId}!`);
      return {
        text: innertubeResult.text,
        segments: innertubeResult.segments,
        source: 'subtitles',
      };
    }
  } catch (innertubeErr) {
    console.warn(`[Transcript Level B] Innertube failed for ${videoId}:`, innertubeErr);
  }

  // Level C: Gemini AI Multimodal Video/Audio Comprehension (If explicitly requested or enabled)
  if (allowGeminiFallback) {
    try {
      console.log(`[Transcript Level C] Running Gemini AI Multimodal comprehension for ${videoId}...`);
      const prompt = `Ты профессиональный транскрибатор и аналитик видео. 
Пожалуйста, внимательно проанализируй звуковую дорожку и видеоряд этого YouTube видео: ${videoUrl}
Название: "${videoTitle || 'YouTube Video'}"

Сделай полную, подробную и связную расшифровку (транскрипцию) речи из этого видео на русском языке (если язык оригинала другой, предоставь точную расшифровку и перевод).
Структурируй текст с временными метками в формате [ММ:СС] или [ЧЧ:ММ:СС] для каждой смысловой фразы или блока речи.`;

      const generatedText = await generateWithFallback([
        {
          text: prompt,
        },
      ]);

      const segments: TranscriptSegment[] = [];
      const timestampRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?:\*\*)?\s*([^[\n]+)/g;
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
            text: text.replace(/^[:\-–—\s]+/, ''),
          });
        }
      }

      return {
        text: generatedText,
        segments,
        source: 'gemini_multimodal',
      };
    } catch (geminiErr: any) {
      console.error('Gemini video analysis error:', geminiErr);
      throw new Error(`Не удалось транскрибировать видео через Gemini AI: ${geminiErr.message}`);
    }
  }

  throw new Error(
    'Субтитры недоступны на YouTube (или заблокированы). Добавьте YouTube Cookies в настройках (Уровень Б) либо запустите AI Аудио-расшифровку (Уровень В).'
  );
"""

if old_level_b_c.strip() in content:
    content = content.replace(old_level_b_c.strip(), level_b_c_repl.strip())
else:
    print("Could not find Level B/C logic to replace")
    
with open('server/youtube.ts', 'w') as f:
    f.write(content)

