export interface TelegramConfig {
  botToken?: string;
  chatId?: string;
  isConfigured: boolean;
}

export function getTelegramEnvConfig(): TelegramConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return {
    botToken,
    chatId,
    isConfigured: Boolean(botToken && chatId),
  };
}

export async function getTelegramBotInfo(customToken?: string): Promise<{
  ok: boolean;
  bot?: { id: number; is_bot: boolean; first_name: string; username?: string };
  error?: string;
}> {
  const token = (customToken || process.env.TELEGRAM_BOT_TOKEN)?.trim();
  if (!token) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as any;
    if (!data.ok) {
      return { ok: false, error: data.description || 'Не удалось получить информацию о боте' };
    }
    return { ok: true, bot: data.result };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function testTelegram(customToken?: string, customChatId?: string): Promise<{
  ok: boolean;
  bot?: any;
  chat?: any;
  error?: string;
}> {
  const token = (customToken || process.env.TELEGRAM_BOT_TOKEN)?.trim();
  const chatId = (customChatId || process.env.TELEGRAM_CHAT_ID)?.trim();

  if (!token) {
    return { ok: false, error: 'Токен бота не настроен (TELEGRAM_BOT_TOKEN)' };
  }

  const botCheck = await getTelegramBotInfo(token);
  if (!botCheck.ok) {
    return { ok: false, error: botCheck.error };
  }

  if (!chatId) {
    return {
      ok: true,
      bot: botCheck.bot,
      error: 'Бот валиден, но TELEGRAM_CHAT_ID пока не указан. Укажите @channel_name или chat_id для отправки.',
    };
  }

  try {
    const chatRes = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
    const chatData = (await chatRes.json()) as any;
    if (!chatData.ok) {
      return {
        ok: false,
        bot: botCheck.bot,
        error: `Бот найден (@${botCheck.bot?.username}), но не удалось найти чат/канал "${chatId}": ${chatData.description}. Убедитесь, что бот добавлен в канал администратором с правом публикации сообщений.`,
      };
    }

    return {
      ok: true,
      bot: botCheck.bot,
      chat: {
        id: chatData.result.id,
        title: chatData.result.title || chatData.result.username || chatData.result.first_name,
        type: chatData.result.type,
      },
    };
  } catch (err: any) {
    return { ok: false, bot: botCheck.bot, error: err.message };
  }
}

// Split large text to fit into Telegram's 4096 character limit
export function splitMessage(text: string, maxLength = 3900): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find best split point: double newline, single newline, or space
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

export async function sendTelegramMessage(
  text: string,
  options?: {
    chatId?: string;
    token?: string;
    silent?: boolean;
    header?: string;
  }
): Promise<{
  ok: boolean;
  sentCount: number;
  messageIds: number[];
  error?: string;
}> {
  const token = (options?.token || process.env.TELEGRAM_BOT_TOKEN)?.trim();
  const chatId = (options?.chatId || process.env.TELEGRAM_CHAT_ID)?.trim();

  if (!token) {
    return { ok: false, sentCount: 0, messageIds: [], error: 'Не задан TELEGRAM_BOT_TOKEN' };
  }
  if (!chatId) {
    return { ok: false, sentCount: 0, messageIds: [], error: 'Не задан TELEGRAM_CHAT_ID (целевой канал или чат)' };
  }

  const fullText = options?.header ? `${options.header}\n\n${text}` : text;
  const chunks = splitMessage(fullText);
  const messageIds: number[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks.length > 1 ? `[Часть ${i + 1}/${chunks.length}]\n\n${chunks[i]}` : chunks[i];

    // Attempt 1: With Markdown formatting
    let res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
        disable_notification: options?.silent ?? false,
      }),
    });

    let data = (await res.json()) as any;

    // Attempt 2: If markdown entity parsing fails, fallback to plain text
    if (!data.ok) {
      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          disable_web_page_preview: false,
          disable_notification: options?.silent ?? false,
        }),
      });
      data = (await res.json()) as any;
    }

    if (!data.ok) {
      return {
        ok: false,
        sentCount: messageIds.length,
        messageIds,
        error: data.description || `Ошибка отправки в Telegram: ${res.statusText}`,
      };
    }

    if (data.result?.message_id) {
      messageIds.push(data.result.message_id);
    }

    // Small delay between multiple parts
    if (chunks.length > 1 && i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return { ok: true, sentCount: messageIds.length, messageIds };
}
