/**
 * Helper to determine whether Gemini's analysis rejected the video
 * based on the account/profile criteria filter.
 */
export function checkIfFilteredOut(text?: string | null): boolean {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase().trim();

  // 1. Direct match with prompt requirement:
  if (
    lower.startsWith('материал не подходит под фильтр') ||
    lower.includes('материал не подходит под фильтр:') ||
    lower.includes('«материал не подходит под фильтр') ||
    lower.includes('вердикт: отклонено') ||
    lower.includes('вердикт: не подходит')
  ) {
    return true;
  }

  // 2. If it contains concrete generated ideas, it PASSED the filter
  const hasIdeas =
    /###\s*идея\s*\d+/i.test(text) ||
    /\*\*идея\s*\d+\*\*/i.test(text) ||
    (/\*\*парадоксальный хук/i.test(text) && /\*\*ядро мысли/i.test(text)) ||
    (/\bпотенциал виральности\b/i.test(text) && /\bядро мысли\b/i.test(text));

  if (hasIdeas && !lower.startsWith('материал не подходит')) {
    return false;
  }

  // 3. Rejection patterns
  const rejectionPatterns = [
    /не подходит (для|под|по|к)/i,
    /не подходит\b/i,
    /не соответств(ует|уют|овал|овало|ующий)/i,
    /не прош(ел|ла|ло|ли) (проверк|фильтр|критери)/i,
    /не проходит (проверк|фильтр|критери)/i,
    /не пройдена проверка/i,
    /вне зоны (вашей|нашей)?\s*экспертной ниши/i,
    /отсутств(ует|уют) связь с профилем/i,
    /не укладывается в (профиль|формат|концепци|рамк)/i,
    /не рекомендован(о|а|ы)?/i,
    /ни одно(го)? видео не подход(ит|ят)/i,
    /нецелесообразно натягивать/i,
    /слишком сильн(ого|ое|ая|ым)? [«"]?натягивани/i,
    /отклонен(о|а|ы)\b/i,
    /вердикт[:\s]+[^\n]*не подходит/i,
    /анализ материала[:\s]+[^\n]*не подходит/i,
    /не отвечает критериям/i,
    /неактуально для (профиля|аккаунта)/i,
    /материал не подходит/i,
    /ролик не подходит/i,
    /видео не подходит/i,
  ];

  const hasRejectionPhrase = rejectionPatterns.some((pattern) => pattern.test(lower));
  if (!hasRejectionPhrase) {
    return false;
  }

  // Check for false positives
  const hasStrongApproval =
    /(отлично подходит|идеально подходит|прекрасно подходит|великолепно подходит)/i.test(lower) ||
    (/(почему подходит|💡 почему подходит)/i.test(lower) && /(потенциальный хук|оценка:\s*[3-5])/i.test(lower));

  if (hasStrongApproval) {
    return false;
  }

  return true;
}

/**
 * Extracts the explicit reason why Gemini rejected a video during filter screening.
 * e.g. from «Материал не подходит под фильтр: [краткая причина]» or similar phrasing.
 */
export function extractFilterRejectionReason(text?: string | null): string | null {
  if (!text || typeof text !== 'string') return null;

  const clean = text.trim();

  // Pattern 1: Exact prompt format: «Материал не подходит под фильтр: [причина]» or without quotes
  const promptMatch = clean.match(/(?:«|")?материал не подходит под фильтр[:\s–—\-]+([^»"\n\r]+(?:\n(?![#\*\s]*[⚠️\=🎬🔍])[^\n\r]+)*)/i);
  if (promptMatch && promptMatch[1]) {
    const reason = promptMatch[1].replace(/[»"]+$/, '').trim();
    if (reason && reason.length > 2) return reason;
  }

  // Pattern 2: "Причина: [причина]" or "Причина отклонения: [причина]"
  const reasonMatch = clean.match(/(?:причина(?:[^\n:]*)?[:\s–—\-]+|почему не подходит[:\s–—\-]+)([^»"\n\r]+)/i);
  if (reasonMatch && reasonMatch[1]) {
    const reason = reasonMatch[1].replace(/[»"]+$/, '').trim();
    if (reason && reason.length > 3) return reason;
  }

  // Pattern 3: "Материал / ролик / видео / тема не подходит: [причина]"
  const generalMatch = clean.match(/(?:«|")?(?:материал|ролик|видео|тема|контент)\s+не\s+подходит(?:\s+под\s+фильтр|\s+для\s+[^\n:]*)?[:\s–—\-]+([^»"\n\r]+)/i);
  if (generalMatch && generalMatch[1]) {
    const reason = generalMatch[1].replace(/[»"]+$/, '').trim();
    if (reason && reason.length > 2) return reason;
  }

  // Pattern 4: Markdown analysis section: "### Анализ материала\nВидео ... **не подходит** ..."
  const analysisMatch = clean.match(/(?:###\s*анализ материала[^\n]*\n+)([\s\S]*?)(?=(?:###|$))/i);
  if (analysisMatch && analysisMatch[1]) {
    const section = analysisMatch[1].trim();
    if (section.length > 10 && /не подходит/i.test(section)) {
      const firstLine = section.split('\n').filter((l) => l.trim().length > 0)[0];
      if (firstLine) {
        return firstLine.replace(/[\*\_#]/g, '').trim();
      }
    }
  }

  // Pattern 5: Any line containing rejection keywords with explanatory text after a colon or dash
  const lines = clean.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('🔍') && !l.startsWith('⚠️') && !l.startsWith('═'));
  for (const line of lines) {
    if (/не подходит|не соответствует/i.test(line)) {
      const stripped = line.replace(/^[«"'\s]+|[»"'\s]+$/g, '').replace(/^(?:🔍|⚠️|\*|#|-)\s*/g, '');
      const colonIdx = stripped.indexOf(':');
      if (colonIdx !== -1 && colonIdx < stripped.length - 3) {
        return stripped.slice(colonIdx + 1).replace(/^[«"\s]+|[»"\s]+$/g, '').trim();
      }
      if (stripped.length > 15 && stripped.length < 300) {
        return stripped;
      }
    }
  }

  return null;
}

/**
 * Extracts individual parsed ideas from Stage 1 Filter output.
 */
export function extractIdeasFromFilterResult(text?: string | null): Array<{
  id: string;
  title: string;
  category?: string;
  coreInsight?: string;
  hook?: string;
  context?: string;
  virality?: string;
  rawText: string;
}> {
  if (!text || typeof text !== 'string') return [];
  if (checkIfFilteredOut(text)) return [];

  const ideas: Array<{
    id: string;
    title: string;
    category?: string;
    coreInsight?: string;
    hook?: string;
    context?: string;
    virality?: string;
    rawText: string;
  }> = [];

  // Pattern 1: Match blocks starting with ### Идея [Номер] or **Идея [Номер]** or Идея [Номер]:
  const ideaRegex = /(?:###\s*|\*\*\s*|^|\n)(?:Идея|IDEA|Тема|Концепт|Ракурс|Смысловой блок)\s*(\d+)[:\.\s\-–—\*\#]*([^\n]+)([\s\S]*?)(?=(?:(?:###\s*|\*\*\s*|\n)(?:Идея|IDEA|Тема|Концепт|Ракурс|Смысловой блок)\s*\d+[:\.\s\-–—\*\#])|$)/gi;
  let match;
  let idx = 1;

  while ((match = ideaRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10) || idx;
    let title = match[2].replace(/[\*\_#:]/g, '').trim();
    const body = match[3].trim();

    if (!title && body) {
      const firstLine = body.split('\n')[0];
      title = firstLine.replace(/[\*\_#:]/g, '').trim();
    }

    const categoryMatch = body.match(/\*\*(?:Категория[^\*]*)\*\*[:\s]*([^\n]+)/i) ||
                          body.match(/(?:Категория)[:\s]+([^\n]+)/i);
    const coreMatch = body.match(/\*\*(?:Ядро мысли|Суть|Психологический механизм[^\*]*)\*\*[:\s]*([^\n]+(?:\n(?!\*|\#)[^\n]+)*)/i) ||
                      body.match(/(?:Ядро мысли|Суть)[:\s]+([^\n]+(?:\n(?!\*|\#)[^\n]+)*)/i);
    const hookMatch = body.match(/\*\*(?:Парадоксальный хук|Хук для спикера|Потенциальный хук|Хук[^\*]*)\*\*[:\s]*([^\n]+(?:\n(?!\*|\#)[^\n]+)*)/i) ||
                      body.match(/(?:Парадоксальный хук|Потенциальный хук|Хук)[:\s]+([^\n]+(?:\n(?!\*|\#)[^\n]+)*)/i);
    const contextMatch = body.match(/\*\*(?:Контекстная привязка|Контекст|Разбор традиции|Таймкод[^\*]*)\*\*[:\s]*([^\n]+(?:\n(?!\*|\#)[^\n]+)*)/i) ||
                         body.match(/(?:Контекст|Таймкод)[:\s]+([^\n]+)/i);
    const viralityMatch = body.match(/\*\*(?:Потенциал виральности|Потенциал|Оценка виральности|Оценка[^\*]*)\*\*[:\s]*([^\n]+)/i) ||
                          body.match(/(?:Потенциал виральности|Потенциал|Оценка)[:\s]+([^\n]+)/i);

    ideas.push({
      id: `idea-${num}-${idx}`,
      title: title || `Идея ${num}`,
      category: categoryMatch ? categoryMatch[1].replace(/[\*\_]/g, '').trim() : undefined,
      coreInsight: coreMatch ? coreMatch[1].replace(/[\*\_]/g, '').trim() : undefined,
      hook: hookMatch ? hookMatch[1].replace(/[\*\_]/g, '').trim() : undefined,
      context: contextMatch ? contextMatch[1].replace(/[\*\_]/g, '').trim() : undefined,
      virality: viralityMatch ? viralityMatch[1].replace(/[\*\_]/g, '').trim() : undefined,
      rawText: `Идея ${num}: ${title}\n${body}`,
    });
    idx++;
  }

  if (ideas.length > 0) {
    return ideas;
  }

  // Pattern 2: Legacy format with "Анализ видео: [Название]" and "Потенциальный хук" / "Почему подходит"
  const analysisTitleMatch = text.match(/###\s*Анализ видео[:\s]+([^\n]+)/i) ||
                             text.match(/\*\*Тема[:\s]+\*\*([^\n]+)/i) ||
                             text.match(/(?:^|\n)\*\*Тема\*\*[:\s]*([^\n]+)/i);
  const hookMatch = text.match(/\*\*Потенциальный хук[^\*]*\*\*[:\s]*([^\n]+(?:\n(?!\*|\#)[^\n]+)*)/i) ||
                    text.match(/Потенциальный хук[:\s]+([^\n]+)/i) ||
                    text.match(/«([^»]{15,150})»/);
  const coreMatch = text.match(/\*\*Почему подходит[^\*]*\*\*[:\s]*([^\n]+(?:\n(?!\*|\#)[^\n]+)*)/i) ||
                    text.match(/(?:Почему подходит)[:\s]+([^\n]+(?:\n(?!\*|\#)[^\n]+)*)/i);
  const viralityMatch = text.match(/\*\*Оценка[^\*]*\*\*[:\s]*([^\n]+)/i);
  const reelsMatch = text.match(/###\s*Как это подать в Reels[^\n]*([\s\S]*?)(?=(?:###|$))/i);

  if (analysisTitleMatch || hookMatch || reelsMatch) {
    const title = analysisTitleMatch ? analysisTitleMatch[1].replace(/[\*\_#:]/g, '').trim() : 'Ключевая идея анализа';
    const cleanReels = reelsMatch ? reelsMatch[1].trim() : undefined;
    const context = cleanReels ? `Рекомендации для Reels:\n${cleanReels}` : undefined;

    ideas.push({
      id: 'idea-legacy-1',
      title: title,
      category: 'Основной концепт',
      coreInsight: coreMatch ? coreMatch[1].replace(/[\*\_]/g, '').trim() : undefined,
      hook: hookMatch ? (typeof hookMatch[1] === 'string' ? hookMatch[1].replace(/[\*\_]/g, '').trim() : undefined) : undefined,
      context: context,
      virality: viralityMatch ? viralityMatch[1].replace(/[\*\_]/g, '').trim() : '5/5',
      rawText: text,
    });
    return ideas;
  }

  return ideas;
}
