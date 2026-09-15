import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Copy, Check, Download, FileText, ExternalLink, 
  Lightbulb, Sparkles, Flame, Film, CheckSquare, Square, Share2, Search, Filter,
  Loader2, LogIn, CheckCircle2, AlertCircle
} from 'lucide-react';
import { StoredVideo, GeneratedScript, TrackedChannel } from '../types';
import { parseIdeasFromGeminiText } from '../utils/filterCheck';
import { createGoogleDocFromHtml, CreateDocResult } from '../services/googleDocsService';
import { initAuth, googleSignIn, logout, getAccessToken } from '../services/googleAuth';
import { User } from 'firebase/auth';

interface ExportIdeasModalProps {
  isOpen: boolean;
  onClose: () => void;
  videos: StoredVideo[];
  channels: TrackedChannel[];
  scripts?: GeneratedScript[];
  selectedVideoIds?: string[];
}

export const ExportIdeasModal: React.FC<ExportIdeasModalProps> = ({
  isOpen,
  onClose,
  videos,
  channels,
  scripts = [],
  selectedVideoIds = [],
}) => {
  const [exportScope, setExportScope] = useState<'selected' | 'approved' | 'all'>(
    selectedVideoIds.length > 0 ? 'selected' : 'approved'
  );
  const [selectedChannelId, setSelectedChannelId] = useState<string>('all');
  const [includeScripts, setIncludeScripts] = useState<boolean>(true);
  const [includeHooksOnly, setIncludeHooksOnly] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedHtml, setCopiedHtml] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Google OAuth & Direct Creation State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isCreatingDirectDoc, setIsCreatingDirectDoc] = useState<boolean>(false);
  const [createdDoc, setCreatedDoc] = useState<CreateDocResult | null>(null);
  const [createDocError, setCreateDocError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [showDirectLinkDialog, setShowDirectLinkDialog] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [docsOpenedNotice, setDocsOpenedNotice] = useState<boolean>(false);

  // Initialize Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (user) => {
        setCurrentUser(user);
      },
      () => {
        setCurrentUser(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // When modal opens with selection, auto-select 'selected' scope
  useEffect(() => {
    if (isOpen) {
      if (selectedVideoIds.length > 0) {
        setExportScope('selected');
      } else {
        setExportScope('approved');
      }
      setCopied(false);
      setCopiedHtml(false);
      setCreatedDoc(null);
      setCreateDocError(null);
    }
  }, [isOpen, selectedVideoIds]);

  // Filter videos based on scope & channel
  const targetVideos = useMemo(() => {
    return videos.filter((v) => {
      // Channel filter
      if (selectedChannelId !== 'all' && v.channelId !== selectedChannelId) {
        return false;
      }

      // Scope filter
      if (exportScope === 'selected') {
        if (!selectedVideoIds.includes(v.id)) return false;
      } else if (exportScope === 'approved') {
        // Only videos with ideas or scripts or approved status
        const hasIdeas = !!v.geminiResult;
        const isApproved = v.matchedFilter !== false;
        if (!hasIdeas || !isApproved) return false;
      }

      // Text search in title or channel
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = v.title.toLowerCase().includes(q);
        const matchChannel = v.channelTitle.toLowerCase().includes(q);
        if (!matchTitle && !matchChannel) return false;
      }

      return true;
    });
  }, [videos, exportScope, selectedChannelId, selectedVideoIds, searchQuery]);

  // Group filtered videos by Channel
  const groupedData = useMemo(() => {
    const channelMap = new Map<string, { channelTitle: string; channelUrl?: string; videos: Array<{ video: StoredVideo; ideas: ReturnType<typeof parseIdeasFromGeminiText>; videoScripts: GeneratedScript[] }> }>();

    for (const v of targetVideos) {
      const ideas = parseIdeasFromGeminiText(v.geminiResult || '');
      const videoScripts = scripts.filter((s) => s.videoIds?.includes(v.id));

      const chId = v.channelId || 'unknown';
      if (!channelMap.has(chId)) {
        const chInfo = channels.find((c) => c.id === chId);
        channelMap.set(chId, {
          channelTitle: v.channelTitle || chInfo?.title || 'YouTube Канал',
          channelUrl: chInfo?.url,
          videos: [],
        });
      }

      channelMap.get(chId)!.videos.push({
        video: v,
        ideas,
        videoScripts,
      });
    }

    return Array.from(channelMap.entries()).map(([chId, data]) => ({
      channelId: chId,
      ...data,
    }));
  }, [targetVideos, channels, scripts]);

  // Calculate statistics
  const totalChannelsCount = groupedData.length;
  const totalVideosCount = targetVideos.length;
  const totalIdeasCount = groupedData.reduce((acc, ch) => {
    return acc + ch.videos.reduce((vAcc, item) => vAcc + item.ideas.length, 0);
  }, 0);
  const totalScriptsCount = groupedData.reduce((acc, ch) => {
    return acc + ch.videos.reduce((vAcc, item) => vAcc + item.videoScripts.length, 0);
  }, 0);

  if (!isOpen) return null;

  // Generate plain text / Markdown export with fresh current date/time
  const generateMarkdown = () => {
    const now = new Date();
    let md = `# БАНК ИДЕЙ И СЦЕНАРИЕВ REELS / SHORTS\n`;
    md += `*Экспортировано: ${now.toLocaleDateString('ru-RU')} в ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}*\n`;
    md += `*Каналов: ${totalChannelsCount} | Видео: ${totalVideosCount} | Идей: ${totalIdeasCount}${includeScripts ? ` | Сценариев: ${totalScriptsCount}` : ''}*\n\n`;
    md += `---\n\n`;

    for (const ch of groupedData) {
      md += `## 📺 КАНАЛ: ${ch.channelTitle}\n`;
      if (ch.channelUrl) md += `Ссылка на канал: ${ch.channelUrl}\n\n`;

      for (const item of ch.videos) {
        md += `### 🎬 Видео: ${item.video.title}\n`;
        md += `- **Ссылка на YouTube:** ${item.video.url}\n`;
        if (item.video.publishedAt) {
          md += `- **Дата публикации:** ${new Date(item.video.publishedAt).toLocaleDateString('ru-RU')}\n`;
        }
        md += `\n`;

        if (item.ideas.length > 0) {
          md += `#### 💡 Банк идей (${item.ideas.length}):\n\n`;
          item.ideas.forEach((idea) => {
            md += `##### Идея #${idea.number}: ${idea.title}\n`;
            if (idea.category) md += `- **Категория:** ${idea.category}\n`;
            if (idea.virality) md += `- **Виральность / Оценка:** ${idea.virality}\n`;
            if (idea.hook) md += `- **🪝 Хук (0-3 сек):** «${idea.hook}»\n`;
            if (!includeHooksOnly) {
              if (idea.coreInsight) md += `- **Ядро мысли:** ${idea.coreInsight}\n`;
              if (idea.context) md += `- **Контекст / Миф:** ${idea.context}\n`;
            }
            md += `\n`;
          });
        } else if (item.video.geminiResult) {
          md += `#### 📝 Результат анализа:\n\n${item.video.geminiResult}\n\n`;
        } else {
          md += `*(Идеи еще не сгенерированы)*\n\n`;
        }

        if (includeScripts && item.videoScripts.length > 0) {
          md += `#### 🎬 Готовые покадровые сценарии (${item.videoScripts.length}):\n\n`;
          item.videoScripts.forEach((sc, scIdx) => {
            md += `##### Сценарий #${scIdx + 1}: ${sc.ideaTitle || sc.title || item.video.title}\n`;
            md += `\`\`\`\n${sc.content}\n\`\`\`\n\n`;
          });
        }

        md += `---\n\n`;
      }
    }

    return md;
  };

  const escapeHtml = (str: string) => {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Generate HTML for direct rich paste into Google Docs (optimized for Google Docs HTML parser)
  const generateGoogleDocsHtml = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('ru-RU');
    const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Банк идей и сценариев Reels / Shorts — ${dateStr}</title>
</head>
<body style="font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #1e293b; background-color: #ffffff; padding: 10px;">

<!-- Title Banner -->
<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; background-color: #f0fdf4; border: 1.5pt solid #86efac; border-radius: 8px;">
  <tr>
    <td style="padding: 16px 20px;">
      <h1 style="margin: 0 0 6px 0; font-size: 20pt; font-weight: bold; color: #065f46; font-family: Arial, sans-serif;">
        💡 БАНК ИДЕЙ И СЦЕНАРИЕВ REELS / SHORTS
      </h1>
      <p style="margin: 0; font-size: 10pt; color: #047857;">
        <strong>Сгенерировано:</strong> ${dateStr} в ${timeStr} &nbsp;|&nbsp; 
        <strong>Каналов:</strong> ${totalChannelsCount} &nbsp;|&nbsp; 
        <strong>Видео:</strong> ${totalVideosCount} &nbsp;|&nbsp; 
        <strong>Идей:</strong> ${totalIdeasCount}${includeScripts ? ` &nbsp;|&nbsp; <strong>Сценариев:</strong> ${totalScriptsCount}` : ''}
      </p>
    </td>
  </tr>
</table>

<p style="font-size: 10pt; color: #64748b; margin-bottom: 24px;">
  <em>Документ готов к работе. Скопирован со всеми цветами, плашками хуков и разметкой.</em>
</p>
`;

    for (const ch of groupedData) {
      // Channel Header Box
      html += `
<table style="width: 100%; border-collapse: collapse; margin-top: 28px; margin-bottom: 16px; background-color: #eff6ff; border-left: 6pt solid #2563eb;">
  <tr>
    <td style="padding: 12px 16px;">
      <h2 style="margin: 0; font-size: 15pt; font-weight: bold; color: #1e3a8a; font-family: Arial, sans-serif;">
        📺 КАНАЛ: ${escapeHtml(ch.channelTitle)}
      </h2>
      ${ch.channelUrl ? `<p style="margin: 4px 0 0 0; font-size: 9.5pt; color: #3b82f6;"><a href="${ch.channelUrl}" style="color: #2563eb; text-decoration: underline;">${escapeHtml(ch.channelUrl)}</a></p>` : ''}
    </td>
  </tr>
</table>
`;

      for (const item of ch.videos) {
        // Video item container
        html += `
<div style="margin-bottom: 28px; padding-bottom: 16px; border-bottom: 1pt solid #cbd5e1;">
  <h3 style="margin: 0 0 4px 0; font-size: 13pt; color: #0f172a; font-weight: bold;">
    🎬 Видео: <a href="${item.video.url}" target="_blank" style="color: #2563eb; text-decoration: underline;">${escapeHtml(item.video.title)}</a>
  </h3>
  <p style="margin: 0 0 14px 0; font-size: 9.5pt; color: #64748b;">
    <strong>Ссылка:</strong> <a href="${item.video.url}" style="color: #475569;">${item.video.url}</a>
    ${item.video.publishedAt ? ` &nbsp;•&nbsp; <strong>Дата публикации:</strong> ${new Date(item.video.publishedAt).toLocaleDateString('ru-RU')}` : ''}
  </p>
`;

        if (item.ideas.length > 0) {
          html += `
  <p style="margin: 12px 0 8px 0; font-size: 11pt; font-weight: bold; color: #047857;">
    💡 Банк виральных идей (${item.ideas.length}):
  </p>
  
  <table style="width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 16px; border: 1pt solid #e2e8f0; border-radius: 6px;">
`;

          item.ideas.forEach((idea, idx) => {
            const isEven = idx % 2 === 0;
            const bgRow = isEven ? '#ffffff' : '#f8fafc';

            html += `
    <tr style="background-color: ${bgRow};">
      <td style="padding: 12px 14px; vertical-align: top; border-bottom: 1pt solid #e2e8f0; width: 44px; text-align: center;">
        <span style="display: inline-block; background-color: #e0e7ff; color: #3730a3; font-weight: bold; font-size: 10pt; padding: 4px 8px; border-radius: 4px;">#${idea.number || idx + 1}</span>
      </td>
      <td style="padding: 12px 16px; vertical-align: top; border-bottom: 1pt solid #e2e8f0;">
        <div style="font-size: 11.5pt; font-weight: bold; color: #0f172a; margin-bottom: 6px;">
          ${escapeHtml(idea.title)}
          ${idea.category ? `&nbsp;<span style="font-size: 8.5pt; font-weight: normal; background-color: #f1f5f9; color: #475569; padding: 2px 7px; border-radius: 4px; border: 1pt solid #cbd5e1;">${escapeHtml(idea.category)}</span>` : ''}
          ${idea.virality ? `&nbsp;<span style="font-size: 8.5pt; font-weight: bold; background-color: #ffedd5; color: #9a3412; padding: 2px 7px; border-radius: 4px; border: 1pt solid #fdba74;">🔥 ${escapeHtml(idea.virality)}</span>` : ''}
        </div>
`;

            if (idea.hook) {
              html += `
        <table style="width: 100%; border-collapse: collapse; margin: 8px 0; background-color: #f5f3ff; border-left: 4pt solid #7c3aed; border-radius: 4px;">
          <tr>
            <td style="padding: 8px 12px; font-size: 10.5pt; color: #4c1d95; font-style: italic;">
              <strong>🪝 Хук (0-3 сек):</strong> «${escapeHtml(idea.hook)}»
            </td>
          </tr>
        </table>
`;
            }

            if (!includeHooksOnly) {
              if (idea.coreInsight) {
                html += `<p style="margin: 6px 0 2px 0; font-size: 10pt; color: #334155;"><strong>🎯 Ядро мысли:</strong> ${escapeHtml(idea.coreInsight)}</p>`;
              }
              if (idea.context) {
                html += `<p style="margin: 3px 0 0 0; font-size: 9.5pt; color: #64748b;"><strong>📖 Контекст / Миф:</strong> ${escapeHtml(idea.context)}</p>`;
              }
            }

            html += `
      </td>
    </tr>
`;
          });

          html += `
  </table>
`;
        } else if (item.video.geminiResult) {
          html += `
  <div style="background-color: #f8fafc; border: 1pt solid #e2e8f0; padding: 12px; border-radius: 6px; font-size: 10pt; color: #334155; white-space: pre-wrap;">
    ${escapeHtml(item.video.geminiResult)}
  </div>
`;
        }

        // Scripts section
        if (includeScripts && item.videoScripts.length > 0) {
          html += `
  <div style="margin-top: 14px; background-color: #faf5ff; border: 1.5pt solid #e9d5ff; border-radius: 6px; padding: 14px;">
    <h4 style="margin: 0 0 10px 0; font-size: 11pt; color: #6b21a8; font-weight: bold;">
      🎬 Готовые покадровые сценарии Reels (${item.videoScripts.length}):
    </h4>
`;

          item.videoScripts.forEach((sc, scIdx) => {
            html += `
    <div style="margin-bottom: 12px; background-color: #ffffff; border: 1pt solid #d8b4fe; border-radius: 6px; padding: 12px;">
      <h5 style="margin: 0 0 6px 0; font-size: 10.5pt; font-weight: bold; color: #581c87;">
        Сценарий #${scIdx + 1}: ${escapeHtml(sc.ideaTitle || sc.title || item.video.title)}
      </h5>
      <pre style="margin: 0; background-color: #f8fafc; border: 1pt solid #e2e8f0; padding: 10px; border-radius: 4px; font-family: 'Courier New', Courier, monospace; font-size: 9.5pt; line-height: 1.5; color: #1e293b; white-space: pre-wrap; word-break: break-word;">${escapeHtml(sc.content)}</pre>
    </div>
`;
          });

          html += `
  </div>
`;
        }

        html += `
</div>
`;
      }
    }

    html += `
</body>
</html>`;
    return html;
  };

  // Copy as rich HTML + text for direct Ctrl+V in Google Docs
  const handleCopyForGoogleDocs = async () => {
    const htmlContent = generateGoogleDocsHtml();
    const plainText = generateMarkdown();

    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': textBlob,
            'text/html': htmlBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 3000);
      return true;
    } catch (err) {
      console.error('Clipboard copy error:', err);
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    }
  };

  // Automatic direct creation in Google Docs via Drive API
  const handleCreateDirectGoogleDoc = async () => {
    if (!currentUser) {
      try {
        const res = await googleSignIn();
        if (!res?.user) {
          setCreateDocError('Для автоматического создания документа необходим вход в Google аккаунт.');
          return;
        }
        setCurrentUser(res.user);
      } catch (err: any) {
        setCreateDocError('Не удалось войти через Google аккаунт.');
        return;
      }
    }

    setIsCreatingDirectDoc(true);
    setCreateDocError(null);
    setDocsOpenedNotice(false);

    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString('ru-RU');
      const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const docTitle = `Банк идей и сценариев Reels — ${dateStr} ${timeStr}`;
      const htmlContent = generateGoogleDocsHtml();

      const result = await createGoogleDocFromHtml(docTitle, htmlContent);

      if (result) {
        setCreatedDoc(result);
        setShowDirectLinkDialog(true);
        window.open(result.url, '_blank');
      } else {
        setCreateDocError('Не удалось создать документ в Google Drive. Попробуйте использовать копирование в буфер обмена (Ctrl+V).');
      }
    } catch (err: any) {
      console.warn('Google Doc creation error:', err);
      setCreateDocError(err?.message || 'Ошибка создания Google Документа');
    } finally {
      setIsCreatingDirectDoc(false);
    }
  };

  // Google Sign-In helper
  const handleSignInGoogle = async () => {
    setIsLoggingIn(true);
    setCreateDocError(null);
    try {
      const res = await googleSignIn();
      if (res?.user) {
        setCurrentUser(res.user);
      }
    } catch (err: any) {
      if (
        err?.code !== 'auth/popup-closed-by-user' &&
        err?.code !== 'auth/cancelled-popup-request'
      ) {
        setCreateDocError(err?.message || 'Не удалось войти через Google аккаунт');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Open fresh Google Doc in new tab and copy formatted data into clipboard (fallback)
  const handleOpenNewGoogleDoc = async () => {
    let newWindow: Window | null = null;
    try {
      newWindow = window.open('https://docs.new', '_blank');
    } catch (err) {
      console.warn('Could not open tab immediately:', err);
    }

    await handleCopyForGoogleDocs();

    if (newWindow) {
      try {
        newWindow.focus();
      } catch (_) {
        // Ignore focus error
      }
    }
  };

  // Download .doc file
  const handleDownloadDoc = () => {
    const html = generateGoogleDocsHtml();
    const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `Bank-Idei-${nowStr}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Download .md file
  const handleDownloadMarkdown = () => {
    const md = generateMarkdown();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `Bank-Idei-${nowStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      id="export-ideas-modal"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-5xl overflow-hidden flex flex-col h-[90vh] animate-in zoom-in-95 duration-150"
      >
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-stone-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-stone-900">Экспорт банка идей в Google Docs</h2>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Прямая выгрузка в Google Drive
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Создаёт готовый документ со всеми таблицами, хуками и сценариями прямо в вашем Google Диске
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {currentUser ? (
              <div className="hidden sm:flex items-center gap-2 bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-medium">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>{currentUser.email || currentUser.displayName}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSignInGoogle}
                disabled={isLoggingIn}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white hover:bg-stone-50 border border-stone-300 rounded-xl transition shadow-2xs"
                title="Подключить аккаунт Google для автоматического создания документов"
              >
                {isLoggingIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5 text-stone-600" />}
                <span>Войти через Google</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Success / Error Notification Bar */}
        {createdDoc && (
          <div className="bg-emerald-50/90 border-b border-emerald-200 px-6 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <div className="text-xs font-bold text-emerald-900">
                  Документ успешно создан в вашем Google Drive!
                </div>
                <div className="text-[11px] text-emerald-700">
                  «{createdDoc.name}»
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(createdDoc.url);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-stone-700 border border-stone-300 hover:bg-stone-50 font-semibold text-xs rounded-xl shadow-2xs transition"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Ссылка скопирована' : 'Скопировать ссылку'}</span>
              </button>
              <a
                href={createdDoc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs hover:shadow-sm transition"
              >
                <span>Открыть в Google Docs</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        )}

        {docsOpenedNotice && !createdDoc && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <div className="text-xs font-bold text-amber-900">
                  Вкладка Google Docs открыта!
                </div>
                <div className="text-[11px] text-amber-700">
                  Отформатированный банк идей скопирован в буфер — просто нажмите <strong>Ctrl+V</strong> в документе.
                </div>
              </div>
            </div>
            <a
              href="https://docs.new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs hover:shadow-sm transition"
            >
              <span>Открыть docs.new</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        {createDocError && (
          <div className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-rose-800 shrink-0 animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{createDocError}</span>
            </div>
            <button
              type="button"
              onClick={() => setCreateDocError(null)}
              className="text-rose-500 hover:text-rose-700 p-1 rounded-lg hover:bg-rose-100 transition"
              title="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Direct Link Full Overlay Modal */}
        {showDirectLinkDialog && createdDoc && (
          <div 
            onClick={() => setShowDirectLinkDialog(false)}
            className="absolute inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          >
            <div 
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-md p-6 flex flex-col items-center text-center animate-in zoom-in-95 relative"
            >
              <button
                type="button"
                onClick={() => setShowDirectLinkDialog(false)}
                className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition"
                title="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3 shadow-xs">
                <CheckCircle2 className="w-7 h-7" />
              </div>

              <h3 className="text-base font-bold text-stone-900 mb-1">
                Google Документ успешно создан!
              </h3>
              <p className="text-xs text-stone-500 mb-4 line-clamp-2">
                «{createdDoc.name}»
              </p>

              <div className="w-full bg-stone-50 p-2.5 rounded-xl border border-stone-200 mb-4 flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdDoc.url}
                  className="bg-transparent text-xs text-stone-700 flex-1 outline-none font-mono truncate px-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(createdDoc.url);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="px-2.5 py-1 bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-lg text-xs font-semibold shrink-0 transition flex items-center gap-1"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'Скопировано' : 'Копировать'}</span>
                </button>
              </div>

              <div className="w-full flex flex-col gap-2">
                <a
                  href={createdDoc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-2"
                >
                  <span>Открыть документ в Google Docs</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Filter & Options Toolbar */}
        <div className="bg-stone-50/60 border-b border-stone-200 px-6 py-3 space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Scope selection */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-stone-700">Что экспортировать:</span>
              <div className="inline-flex bg-white p-1 rounded-xl border border-stone-200 shadow-2xs">
                {selectedVideoIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExportScope('selected')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                      exportScope === 'selected'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    Выбранные ({selectedVideoIds.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExportScope('approved')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition ${
                    exportScope === 'approved'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Все с банком идей
                </button>
                <button
                  type="button"
                  onClick={() => setExportScope('all')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition ${
                    exportScope === 'all'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Все ролики ({videos.length})
                </button>
              </div>
            </div>

            {/* Channel Filter */}
            <div className="flex items-center gap-2">
              <span className="font-medium text-stone-600">Канал:</span>
              <select
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className="bg-white border border-stone-300 rounded-lg px-2.5 py-1 text-xs font-medium text-stone-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer shadow-2xs"
              >
                <option value="all">Все каналы ({channels.length})</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Options checkboxes */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-200/60 text-xs">
            <div className="flex items-center gap-4 flex-wrap">
              <label className="inline-flex items-center gap-2 cursor-pointer text-stone-700 font-medium">
                <input
                  type="checkbox"
                  checked={includeScripts}
                  onChange={(e) => setIncludeScripts(e.target.checked)}
                  className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Включать готовые покадровые сценарии (Этап 2)</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer text-stone-700 font-medium">
                <input
                  type="checkbox"
                  checked={includeHooksOnly}
                  onChange={(e) => setIncludeHooksOnly(e.target.checked)}
                  className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Только хуки и заголовки (компактный вид)</span>
              </label>
            </div>

            {/* Summary counters badge */}
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold text-stone-600 bg-stone-100 px-3 py-1 rounded-lg">
              <span>Каналов: <strong className="text-stone-900">{totalChannelsCount}</strong></span>
              <span>•</span>
              <span>Видео: <strong className="text-stone-900">{totalVideosCount}</strong></span>
              <span>•</span>
              <span>Идей: <strong className="text-emerald-700">{totalIdeasCount}</strong></span>
              {includeScripts && (
                <>
                  <span>•</span>
                  <span>Сценариев: <strong className="text-purple-700">{totalScriptsCount}</strong></span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Live Document Preview */}
        <div className="flex-1 overflow-y-auto p-6 bg-stone-100/50">
          <div className="max-w-3xl mx-auto bg-white rounded-2xl p-6 sm:p-8 border border-stone-200 shadow-sm space-y-6">
            <div className="border-b border-stone-200 pb-4">
              <h1 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-500" />
                Банк идей и сценариев Reels / Shorts
              </h1>
              <p className="text-xs text-stone-500 mt-1">
                Экспортировано {new Date().toLocaleDateString('ru-RU')} в {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} • {totalChannelsCount} {totalChannelsCount === 1 ? 'канал' : 'канала'} • {totalVideosCount} видео • {totalIdeasCount} идей
              </p>
            </div>

            {groupedData.length === 0 ? (
              <div className="py-12 text-center text-xs text-stone-500">
                По выбранным критериям видео и идеи не найдены. Попробуйте выбрать "Все ролики" или сбросить фильтр канала.
              </div>
            ) : (
              groupedData.map((ch) => (
                <div key={ch.channelId} className="space-y-4 pt-2">
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-xl flex items-center justify-between">
                    <h2 className="text-sm font-bold text-emerald-950 flex items-center gap-2">
                      <span>📺 Канал: {ch.channelTitle}</span>
                    </h2>
                    <span className="text-xs font-semibold text-emerald-800 bg-white px-2.5 py-0.5 rounded-md border border-emerald-200">
                      {ch.videos.length} {ch.videos.length === 1 ? 'видео' : 'видео'}
                    </span>
                  </div>

                  <div className="space-y-4 pl-2 sm:pl-4">
                    {ch.videos.map(({ video, ideas, videoScripts }) => (
                      <div key={video.id} className="p-4 bg-stone-50/80 rounded-xl border border-stone-200/80 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stone-200 pb-2">
                          <div>
                            <h3 className="text-xs font-bold text-stone-900 hover:text-indigo-600 transition">
                              <a href={video.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
                                {video.title}
                                <ExternalLink className="w-3 h-3 text-stone-400" />
                              </a>
                            </h3>
                            <div className="text-[11px] text-stone-500 mt-0.5 flex items-center gap-2">
                              <span>YouTube: {video.videoId}</span>
                              {video.publishedAt && (
                                <>
                                  <span>•</span>
                                  <span>{new Date(video.publishedAt).toLocaleDateString('ru-RU')}</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {ideas.length > 0 && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-md">
                                💡 {ideas.length} {ideas.length === 1 ? 'идея' : 'идей'}
                              </span>
                            )}
                            {videoScripts.length > 0 && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 bg-purple-50 text-purple-800 border border-purple-200 rounded-md">
                                🎬 {videoScripts.length} сценар.
                              </span>
                            )}
                          </div>
                        </div>

                        {ideas.length > 0 ? (
                          <div className="space-y-2">
                            <span className="text-[11px] font-bold text-stone-700 block">
                              Банк идей:
                            </span>
                            <div className="space-y-2">
                              {ideas.map((idea, ideaIdx) => (
                                <div
                                  key={`${video.id}-idea-${idea.id || idea.number || ideaIdx}-${ideaIdx}`}
                                  className="p-3 bg-white rounded-lg border border-stone-200 text-xs space-y-1.5 shadow-2xs"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="font-bold text-stone-900 flex-1 min-w-0 break-words">
                                      #{idea.number} {idea.title}
                                    </span>
                                    {idea.virality && (
                                      <span className="text-[10px] font-semibold px-2 py-0.5 bg-orange-50 text-orange-700 border border-orange-200 rounded shrink-0 max-w-[160px] truncate" title={idea.virality}>
                                        🔥 {idea.virality}
                                      </span>
                                    )}
                                  </div>

                                  {idea.hook && (
                                    <div className="p-2 bg-indigo-50/70 border border-indigo-100 rounded-md text-[11px] text-indigo-950 italic">
                                      <strong>🪝 Хук (0-3 сек):</strong> «{idea.hook}»
                                    </div>
                                  )}

                                  {!includeHooksOnly && (
                                    <>
                                      {idea.coreInsight && (
                                        <div className="text-[11px] text-stone-700">
                                          <strong>Ядро мысли: </strong>{idea.coreInsight}
                                        </div>
                                      )}
                                      {idea.context && (
                                        <div className="text-[11px] text-stone-500">
                                          <strong>Контекст: </strong>{idea.context}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : video.geminiResult ? (
                          <div className="p-3 bg-white rounded-lg border border-stone-200 text-xs text-stone-700 whitespace-pre-wrap leading-relaxed">
                            {video.geminiResult}
                          </div>
                        ) : null}

                        {includeScripts && videoScripts.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-stone-200">
                            <span className="text-[11px] font-bold text-purple-900 block mb-2 flex items-center gap-1">
                              <Film className="w-3.5 h-3.5 text-purple-600" />
                              Готовые покадровые сценарии ({videoScripts.length}):
                            </span>
                            <div className="space-y-2">
                              {videoScripts.map((sc, scIdx) => (
                                <div
                                  key={`${video.id}-script-${sc.id || scIdx}-${scIdx}`}
                                  className="p-3 bg-purple-50/50 rounded-lg border border-purple-100 text-xs"
                                >
                                  <div className="font-bold text-purple-950 mb-1">
                                    Сценарий #{scIdx + 1}: {sc.ideaTitle || sc.title}
                                  </div>
                                  <div className="whitespace-pre-wrap text-[11px] text-stone-800 bg-white p-2.5 rounded border border-purple-200/60 max-h-40 overflow-y-auto">
                                    {sc.content}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="px-6 py-4 bg-white border-t border-stone-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-stone-600 flex items-center gap-3 flex-wrap">
            {isCreatingDirectDoc ? (
              <span className="text-emerald-700 font-semibold flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
                <span>Генерируем и форматируем документ в вашем Google Drive...</span>
              </span>
            ) : createdDoc ? (
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-emerald-700 font-semibold flex items-center gap-1.5 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Документ создан в Google Docs!</span>
                </span>
                <a
                  href={createdDoc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition shadow-xs hover:shadow-sm"
                >
                  <span>Открыть в новой вкладке</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : copiedHtml ? (
              <span className="text-emerald-700 font-semibold flex items-center gap-1.5 animate-in fade-in">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>Скопировано с разметкой! Можно вставлять (Ctrl+V) в любой Google Doc или Word.</span>
              </span>
            ) : (
              <span>Нажмите «Создать в Google Docs» для автоматического создания и открытия готового файла</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition"
              title="Скачать в формате Markdown (.md)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>.md</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadDoc}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-800 bg-stone-100 hover:bg-stone-200 border border-stone-300 rounded-xl transition"
              title="Скачать файл Word / Docs (.doc)"
            >
              <Download className="w-3.5 h-3.5 text-stone-600" />
              <span>.doc</span>
            </button>

            <button
              type="button"
              onClick={handleCopyForGoogleDocs}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-xl transition shadow-2xs"
              title="Скопировать всё с форматированием для вставки через Ctrl+V"
            >
              {copiedHtml ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedHtml ? 'Скопировано!' : 'Скопировать (Ctrl+V)'}</span>
            </button>

            <button
              type="button"
              onClick={handleCreateDirectGoogleDoc}
              disabled={isCreatingDirectDoc}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 rounded-xl shadow-md transition transform active:scale-98 cursor-pointer"
              title="Автоматически создаёт Google Документ на вашем Google Диске и сразу открывает его"
            >
              {isCreatingDirectDoc ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Создаём документ...</span>
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4" />
                  <span>Создать в Google Docs</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
