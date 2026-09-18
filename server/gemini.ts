import { GoogleGenAI } from '@google/genai';
import { addGeminiUsageLog, calculateTokenCost } from './storage.js';

let geminiClient: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY is not set in environment. Gemini features will require key.');
    }
    geminiClient = new GoogleGenAI({
      apiKey: apiKey || '',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

function extractCleanErrorMessage(err: any): string {
  if (!err) return 'Неизвестная ошибка';
  let rawMsg = '';
  if (typeof err.message === 'string') {
    try {
      const parsed = JSON.parse(err.message);
      if (parsed?.error?.message) {
        rawMsg = parsed.error.message;
      }
    } catch {
      rawMsg = err.message;
    }
  } else {
    rawMsg = String(err);
  }

  if (rawMsg.includes('Quota exceeded') || rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('429')) {
    const retryMatch = rawMsg.match(/retry in ([0-9.]+)s/i);
    const retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null;
    return `Превышен лимит запросов к модели (Rate Limit/429)${retrySeconds ? `. Рекомендуется подождать ~${retrySeconds} сек.` : '. Подождите несколько секунд.'}`;
  }

  if (rawMsg.includes('high demand') || rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE')) {
    return 'Временный пик нагрузки на серверы Google Gemini. Модели выполняют переподключение.';
  }

  return rawMsg;
}

export interface GenerateWithFallbackOptions {
  signal?: AbortSignal;
  forcePaidModel?: boolean;
  tools?: any[];
  toolConfig?: any;
  operation?: string;
  videoId?: string;
  videoTitle?: string;
}

export async function generateWithFallback(
  contents: any[],
  signalOrOptions?: AbortSignal | GenerateWithFallbackOptions,
  legacyForcePaidModel?: boolean
): Promise<string> {
  let signal: AbortSignal | undefined;
  let forcePaidModel = false;
  let tools: any[] | undefined;
  let toolConfig: any | undefined;
  let operation: string | undefined;
  let videoId: string | undefined;
  let videoTitle: string | undefined;

  if (signalOrOptions instanceof AbortSignal) {
    signal = signalOrOptions;
    forcePaidModel = legacyForcePaidModel ?? false;
  } else if (signalOrOptions && typeof signalOrOptions === 'object') {
    const opts = signalOrOptions as GenerateWithFallbackOptions;
    signal = opts.signal;
    forcePaidModel = opts.forcePaidModel ?? false;
    tools = opts.tools;
    toolConfig = opts.toolConfig;
    operation = opts.operation;
    videoId = opts.videoId;
    videoTitle = opts.videoTitle;
  }

  if (signal?.aborted) {
    throw new Error('Операция отменена пользователем');
  }
  const ai = getGemini();
  // Highly-available active models
  // If forcePaidModel is true, use Pro models; otherwise use Flash
  const candidateModels = forcePaidModel
    ? ['gemini-3.1-pro-preview', 'gemini-3.8-flash']
    : ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-pro-preview'];
  let lastError: any = null;

  const maxGlobalPasses = 2;
  for (let globalPass = 1; globalPass <= maxGlobalPasses; globalPass++) {
    for (let modelIdx = 0; modelIdx < candidateModels.length; modelIdx++) {
      if (signal?.aborted) {
        throw new Error('Операция отменена пользователем');
      }
      const model = candidateModels[modelIdx];
      const maxAttempts = 2;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) {
          throw new Error('Операция отменена пользователем');
        }
        try {
          const requestPayload: any = {
            model,
            contents,
          };
          if (tools && tools.length > 0) {
            requestPayload.tools = tools;
          }
          if (toolConfig) {
            requestPayload.toolConfig = toolConfig;
          }

          const response = await ai.models.generateContent(requestPayload);
          if (signal?.aborted) {
            throw new Error('Операция отменена пользователем');
          }
          if (response.text) {
            // Record usage metadata accurately from API response
            const usage = response.usageMetadata;
            const promptTokens = usage?.promptTokenCount || 0;
            const candidatesTokens = usage?.candidatesTokenCount || 0;
            const thoughtsTokens = (usage as any)?.thoughtsTokenCount || 0;
            const totalTokens = usage?.totalTokenCount || (promptTokens + candidatesTokens + thoughtsTokens);

            const cost = calculateTokenCost(model, forcePaidModel, promptTokens, candidatesTokens, thoughtsTokens);

            addGeminiUsageLog({
              timestamp: new Date().toISOString(),
              model,
              isPaid: forcePaidModel,
              operation: operation || 'generation',
              videoId,
              videoTitle,
              promptTokens,
              candidatesTokens,
              thoughtsTokens,
              totalTokens,
              estimatedCostUsd: cost,
            }).catch((err) => console.error('[Usage Tracking] Error logging Gemini usage:', err));

            return response.text;
          }
        } catch (err: any) {
          if (signal?.aborted || err?.message === 'Операция отменена пользователем') {
            throw new Error('Операция отменена пользователем');
          }
          lastError = err;
          const cleanMsg = extractCleanErrorMessage(err);
          const rawStr = typeof err?.message === 'string' ? err.message : String(err);
          const isHighDemand =
            err?.status === 503 ||
            cleanMsg.includes('пик нагрузки') ||
            cleanMsg.includes('UNAVAILABLE') ||
            cleanMsg.includes('503');
          const isRateLimit =
            err?.status === 429 ||
            cleanMsg.includes('Rate Limit') ||
            cleanMsg.includes('RESOURCE_EXHAUSTED') ||
            cleanMsg.includes('429');

          console.warn(
            `[Gemini] Модель ${model} (попытка ${attempt}/${maxAttempts}, проход ${globalPass}) вернула ошибку: ${cleanMsg}`
          );

          if (isRateLimit) {
            const retryMatch = rawStr.match(/retry in ([0-9.]+)s/i);
            const retrySec = retryMatch ? Math.min(parseFloat(retryMatch[1]), 15) : 5;
            const waitMs = (retrySec * 1000) + Math.floor(Math.random() * 1000);
            console.warn(`[Gemini] Лимит запросов (429). Ожидание ${Math.round(waitMs / 1000)}с перед повторной попыткой...`);
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, waitMs);
              if (signal) {
                signal.addEventListener('abort', () => {
                  clearTimeout(timer);
                  reject(new Error('Операция отменена пользователем'));
                }, { once: true });
              }
            });
          } else if (attempt < maxAttempts) {
            const delayMs = (isHighDemand ? 2000 : 1200) * attempt + Math.floor(Math.random() * 600);
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, delayMs);
              if (signal) {
                signal.addEventListener('abort', () => {
                  clearTimeout(timer);
                  reject(new Error('Операция отменена пользователем'));
                }, { once: true });
              }
            });
          }
        }
      }
    }
    // If all models failed in this pass, wait 6 seconds before global retry pass
    if (globalPass < maxGlobalPasses) {
      if (signal?.aborted) {
        throw new Error('Операция отменена пользователем');
      }
      console.warn(`[Gemini] Все модели исчерпали лимиты в проходе ${globalPass}. Ожидание 6с перед повторным проходом...`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 6000);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Операция отменена пользователем'));
          }, { once: true });
        }
      });
    }
  }

  const finalMsg = lastError ? extractCleanErrorMessage(lastError) : 'Сервер Gemini временно перегружен';
  throw new Error(`Модели Gemini временно испытывают высокую нагрузку: ${finalMsg}`);
}

export const PROMPT_TEMPLATES = {
  two_stage_pipeline: `ДВУХЭТАПНЫЙ КОНВЕЙЕР (ЭТАП 1: ФИЛЬТР ТЕМ -> ЭТАП 2: ПОКАДРОВЫЙ СЦЕНАРИЙ)`,

  filter_screener: `Ты — старший редактор и продюсер русскоязычного блога о практической психологии, эмоциональной зрелости, разборе культурно-религиозных традиций и деконструкции мифов в контексте Кавказа, Азербайджана и постсоветского пространства.

Твоя задача — проанализировать сырой транскрипт видео и найти в нем ВСЕ жизнеспособные идеи для коротких вертикальных роликов (Reels / Shorts / TikTok на 30–60 секунд).

ФИЛЬТР ТЕМ:
1. Психология и отношения: травмы привязанности, эмоциональная сепарация, личные границы, невыраженный стыд, подавленный гнев, родительские сценарии.
2. Культурно-религиозный пласт (Кавказ / СНГ / Восток): разбор формулы «так принято / что скажут люди», первоисточники vs искаженные обычаи (ислам, христианство), институт семьи, авторитет старших без токсичности, женская субъектность без лобового поучения.
3. Разоблачение мифов («Все думают X, но на самом деле Y»): бытовые суеверия, происхождение символов, псевдотрадиции, навязанные коллективные страхи.

ТАБУ: 
- Банальная мотивация («верь в себя», «просто начни»).
- Поучающий менторский тон («вы должны понять», «женщина обязана»).
- Непроверяемые абстрактные теории без логики и первоисточников.

ИНСТРУКЦИЯ К АНАЛИЗУ:
1. Выдели из текста ВСЕ автономные смысловые единицы, подходящие под фильтр (от 1 до 5 потенциальных сценариев).
2. Для каждой единицы сформулируй парадоксальный угол подачи.

ФОРМАТ ВЫВОДА:
Если в тексте нет подходящего материала, выведи одну фразу: «Материал не подходит под фильтр: [краткая причина]». Не натягивай смысл искусственно.

Если материал есть, оформи по шаблону:

### Идея [Номер]: [Емкое рабочее название]
* **Категория**: (Психология / Традиции и первоисточники / Разбор мифа)
* **Ядро мысли**: 1-2 предложения, в чем суть инсайта.
* **Парадоксальный хук (0-3 сек)**: Точная фраза, ломающая привычный стереотип мышления.
* **Контекстная привязка**: Как это резонирует с человеком из кавказской / азербайджанской / постсоветской среды.
* **Потенциал виральности**: Оценка 1–5 с обоснованием.`,

  scriptwriter_deep: `Ты — сценарист вирусных образовательных Reels/TikTok с глубокой психологической и культурологической экспертизой. 
На основе предоставленного фрагмента транскрипта (или выбранной идеи) создай законченный покадровый сценарий для вертикального видео на 45–60 секунд (хронометраж: 110–140 слов закадрового текста).

ПРАВИЛА ПОДАЧИ:
- Тон: разговорный, спокойный, доверительный, диалог на равных. Никакого менторства и белых пальто.
- Хук: первые 3 секунды должны бить точно в скрытую боль, внутренний конфликт или когнитивный диссонанс (не «Сегодня мы поговорим о...», а сразу суть парадокса).
- Визуал: кинематографичный, с понятными B-roll планами, отражающими повседневную жизнь, без пластиковых стоковых метафор.

СТРУКТУРА СЦЕНАРИЯ:

1. 🎬 Заголовок и концепция:
- Рабочее название и ключевой инсайт (1 предложение).

2. 🪝 Крючок / Хук (0–3 сек):
- Визуал и действие спикера:
- Текст на экране (крупный оверлей):
- Голос (голос в кадре / Voiceover):

3. 📖 Развитие сюжета (4–40 сек):
Разбей на 3-4 микро-блока в формате:
- [04–15 сек] | Визуал / B-roll | Текст на экране | Реплика спикера
- [15–28 сек] | Визуал / B-roll | Текст на экране | Реплика спикера
- [28–40 сек] | Визуал / B-roll | Текст на экране | Реплика спикера

4. 💡 Кульминация и переосмысление (40–50 сек):
- Главный смысловой поворот, снимающий чувство вины или разрушающий миф.

5. 🎯 Финал и Call To Action (50–60 сек):
- Открытый вопрос аудитории, запускающий личные истории в комментариях (избегать банального «А что думаете вы? Пишите внизу»).

6. 📝 Описание поста и теги:
- Текст под рилс (3–4 абзаца с раскрытием контекста).
- 5 точных нишевых хэштегов.`,

  instagram_editor: `Ты — редактор контента для русскоязычного Instagram-аккаунта о психологии, отношениях, эмоциональном интеллекте и социальных темах. Твоя задача — проанализировать транскрипты видео (ниже) и найти материал, который подходит под формат аккаунта, а затем предложить 1–3 лучших кандидата с кратким обоснованием.

Профиль аккаунта (фильтр):
Тематика: психология отношений, эмоциональная зрелость, честный диалог, паттерны привязанности, травма и её последствия, гендерные и культурные темы (в т.ч. положение женщин в патриархальных структурах), поколенческие конфликты, личностный рост вне карьерных/финансовых метрик.
Отдельная категория — мифы, которые влияют на нашу жизнь:
- Мифы о религиозных/культурных символах и их происхождении (например: закрытие лица — откуда взялась практика, что на самом деле говорят первоисточники против того, что стало "традицией"; полумесяц как символ ислама — на самом деле не исламский по происхождению символ, а заимствованный)
- Популярные бытовые/социальные мифы в среде СНГ — то, что все считают "общеизвестным фактом", но при проверке не подтверждается или имеет совсем другое происхождение (народные приметы, "так было всегда" истории, псевдонаучные объяснения поведения, мифы о браке/семье/воспитании, выдаваемые за традицию)
Формат раскрытия: "все думают X, но на самом деле Y" — с опорой на исторические/религиоведческие/научные источники, без снисходительного тона к тем, кто в миф верил

Тон и стиль:
- Разговорный, от первого лица, небодидактичный — без позиции "сверху вниз"
- Цель — не поучать, а дать человеку (часто женщине, живущей в патриархальном контексте) доступ к первоисточникам и инструменты для самостоятельных выводов
- Крючок (первые 3 секунды) строится на парадоксе или неожиданном переосмысении привычного утверждения
- Факты — только проверяемые: научные исследования, лонгитюдные исследования, академические источники (не популярные "мифы" без ссылки на источник)
- Финал — не морализаторский, оставляет пространство для размышления, а не готовый вывод

Темы, которые НЕ подходят:
- Чистый лайфстайл/мотивация без психологической/социальной глубины
- Политическая агитация без анализа
- Контент, построенный на непроверяемой статистике или "жизненных советах" без основы
- Западные темы без связи с культурным контекстом (Азербайджан/Кавказ/постсоветское пространство) — если только тема не универсальна (например, эмоциональная зрелость, привязанность)

Что делать с каждым транскриптом:
1. Определи основную мысль/тезис видео.
2. Оцени, есть ли в видео парадокс, неожиданный факт или переосмысление — потенциальный крючок.
3. Проверь, можно ли тему связать с одной из областей: отношения, эмоциональная зрелость, патриархальные структуры, культура/религия (ислам, Кавказ), поколенческий конфликт, личностный рост, разоблачение мифа (религиозного, культурного или бытового СНГ).
3а. Если видео разоблачает миф — отдельно укажи: в чём именно состоит миф и что показывает первоисточник/исследование.
4. Отметь, есть ли в видео конкретные исследования/данные, которые можно использовать (с указанием источника) или потребуется дополнительная проверка/замена на верифицированный источник.
5. Оцени по шкале 1–5: насколько сильный потенциальный хук у темы.

Формат ответа:
Для каждого отобранного видео дай:
📌 Источник: [название канала/видео]
🎯 Тема: [1 предложение]
💡 Почему подходит: [2–3 предложения — связь с профилем аккаунта]
🪝 Потенциальный хук: [конкретная фраза-парадокс или переформулировка]
🔍 Факты/источники для проверки: [что нужно проверить или заменить]
⭐ Оценка: [1–5]

Если ни одно видео не подходит под фильтр — прямо скажи об этом, не натягивай тему искусственно.`,

  reels_scenario: `На основе предоставленного транскрипта подготовь 1-2 готовых подробных сценария для Reels / Shorts / TikTok (30-60 сек) по теме видео:
Для каждого сценария укажи:
1. 🎬 Заголовок и идея ролика
2. 🪝 Крючок / Хук (0-3 сек): точный текст спикера и что происходит на экране (визуал)
3. 📖 Развитие сюжета (4-40 сек): покадрово реплики спикера (Voiceover) и подсказки для монтажа (B-roll/текст на экране)
4. 💡 Кульминация / Парадокс (40-50 сек): ключевой инсайт
5. 🎯 Финал и Call To Action (50-60 сек): вовлекающий вопрос для комментариев
6. 📝 Описание поста и 5 релевантных хэштегов`,

  summary: `Пожалуйста, проанализируй транскрипт видео и сделай структурированный конспект на русском языке:
1. 📌 Краткая суть (TL;DR) в 2-3 предложениях
2. 🔑 Ключевые тезисы и идеи (с разбивкой по пунктам)
3. 💡 Важные инсайты / цитаты
4. 🎯 Главные выводы и практические рекомендации`,

  detailed: `Сделай подробный и детальный конспект этого видео на русском языке:
- Разбей содержание на логические главы с таймкодами (если они есть)
- Детально распиши аргументацию спикера по каждому вопросу
- Выдели термины, определения, цифры и упомянутые ресурсы
- Сформируй итоговое резюме`,

  actionable: `Проанализируй данное видео и сформируй конкретный список действий и практических шагов (Action Items / Cheatsheet):
1. Что конкретно нужно сделать (пошаговый план)
2. Частые ошибки, о которых предупреждает автор
3. Полезные инструменты, ссылки или методы, упомянутые в материале`,

  knowledge_base: `Подготовь заметку для базы знаний (Obsidian / Notion / Wiki) по материалам этого видео:
- Заголовок и метаданные
- Основная концепция
- Структурированные заметки по разделам
- Вопросы и ответы (FAQ) по теме видео
- Теги для классификации`,
};

export interface PromptTemplateDef {
  id: string;
  ownerId?: string;
  name: string;
  badge: string;
  description: string;
  text: string;
  category?: 'filter' | 'scriptwriter' | 'general';
  isCustom?: boolean;
  isModified?: boolean;
}

export const DEFAULT_PROMPT_DEFINITIONS: PromptTemplateDef[] = [
  {
    id: 'two_stage_pipeline',
    name: '⚡ 2-этапный конвейер: Фильтр → Покадровый сценарий',
    badge: 'Рекомендуемый цикл',
    description: 'Полный автоматический конвейер: Этап 1 отбирает идеи и проверяет табу блога, а Этап 2 пишет глубокий покадровый сценарий для Reels.',
    category: 'general',
    text: PROMPT_TEMPLATES.two_stage_pipeline,
  },
  {
    id: 'filter_screener',
    name: '🔍 Промпт 1: Фильтр тем и Банк идей',
    badge: 'Этап 1 (Фильтр & Идеи)',
    description: 'Продюсерский скрининг: отсев по табу блога (психология, традиции Кавказа/СНГ, деконструкция мифов) и генерация 1-5 парадоксальных идей.',
    category: 'filter',
    text: PROMPT_TEMPLATES.filter_screener,
  },
  {
    id: 'instagram_editor',
    name: '📱 Промпт-Фильтр: Instagram Редактор',
    badge: 'Этап 1 (Редактор)',
    description: 'Анализ транскрипта по профилю аккаунта: поиск парадоксов, связки с культурным контекстом и фактчекинг источников.',
    category: 'filter',
    text: PROMPT_TEMPLATES.instagram_editor,
  },
  {
    id: 'scriptwriter_deep',
    name: '🎬 Промпт 2: Покадровый сценарист Reels/Shorts',
    badge: 'Этап 2 (Сценарист)',
    description: 'Покадровая режиссура 45-60 сек: хук 0-3 сек, B-roll планы, микро-блоки реплик, смысловой поворот, открытый вопрос (CTA) и готовый пост.',
    category: 'scriptwriter',
    text: PROMPT_TEMPLATES.scriptwriter_deep,
  },
  {
    id: 'reels_scenario',
    name: '🎥 Промпт-Сценарист: Базовый Reels/Shorts',
    badge: 'Этап 2 (Сценарист)',
    description: 'Сценарий короткого видео на 30-60 сек с хуком, репликами и описанием поста.',
    category: 'scriptwriter',
    text: PROMPT_TEMPLATES.reels_scenario,
  },
  {
    id: 'summary',
    name: '📌 Краткий конспект (TL;DR)',
    badge: 'Суть & Тезисы',
    description: 'Быстрое понимание ключевых мыслей видео, главных выводов и практических рекомендаций.',
    category: 'general',
    text: PROMPT_TEMPLATES.summary,
  },
  {
    id: 'detailed',
    name: '📖 Детальный разбор по главам',
    badge: 'Главы & Факты',
    description: 'Глубокий конспект по главам с аргументацией, цитатами, терминами и выводами.',
    category: 'general',
    text: PROMPT_TEMPLATES.detailed,
  },
  {
    id: 'actionable',
    name: '🎯 План действий (Шпаргалка)',
    badge: 'Чек-лист',
    description: 'Конкретный список действий и шагов к внедрению, разбор частых ошибок.',
    category: 'general',
    text: PROMPT_TEMPLATES.actionable,
  },
  {
    id: 'knowledge_base',
    name: '🧠 База знаний (Notion / Obsidian)',
    badge: 'Wiki заметка',
    description: 'Структурированная wiki-заметка с тегами, концепцией и блоком вопросов и ответов.',
    category: 'general',
    text: PROMPT_TEMPLATES.knowledge_base,
  },
];
