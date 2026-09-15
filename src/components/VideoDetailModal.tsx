import React, { useState } from 'react';
import { 
  X, Sparkles, FileText, MessageSquare, Copy, Download, ExternalLink, 
  Search, Loader2, Send, Check, Play, RefreshCw, AlertTriangle, CheckCircle2, 
  Plus, Layers, Film, Lightbulb, Flame, ArrowRight, Video, ChevronRight, Clock
} from 'lucide-react';
import { StoredVideo, GeneratedScript } from '../types';
import { checkIfFilteredOut, extractIdeasFromFilterResult, extractFilterRejectionReason, ParsedIdea } from '../utils/filterCheck';
import { 
  canApprove, 
  canReject, 
  canRecheckFilter, 
  canRunStage1, 
  canFindMoreIdeas, 
  canChat, 
  isRejectedFilter, 
  VIDEO_STATUS 
} from '../utils/video-actions';
import { ConfirmModal, ConfirmModalConfig } from './ConfirmModal';

interface VideoDetailModalProps {
  video: StoredVideo | null;
  allScripts?: GeneratedScript[];
  onClose: () => void;
  onToggleReviewed?: (video: StoredVideo) => void;
  onReProcess: (video: StoredVideo, promptTemplate: string, customPrompt?: string) => void;
  onScriptCreated?: () => void;
  onResetStatus?: (id: string, target: 'stage1' | 'approved' | 'rejected' | 'new') => void;
  isProcessing: boolean;
}

export const VideoDetailModal: React.FC<VideoDetailModalProps> = ({
  video,
  allScripts = [],
  onClose,
  onToggleReviewed,
  onReProcess,
  onScriptCreated,
  onResetStatus,
  isProcessing,
}) => {
  const [activeTab, setActiveTab] = useState<'ideas_and_scripts' | 'chat' | 'transcript'>('ideas_and_scripts');
  const [subView, setSubView] = useState<'ideas' | 'scripts' | 'raw_filter'>('ideas');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSendingTg, setIsSendingTg] = useState(false);
  const [tgSentSuccess, setTgSentSuccess] = useState(false);
  
  // Interactive Chat State
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ sender: 'user' | 'gemini'; text: string }>>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Reprocess prompt template
  const [selectedTemplate, setSelectedTemplate] = useState('filter_screener');

  // Selected scenario index for this video
  const [selectedScriptIndex, setSelectedScriptIndex] = useState(0);

  // Idea generation & search state
  const [generatingIdeaId, setGeneratingIdeaId] = useState<string | null>(null);
  const [isFindingMoreIdeas, setIsFindingMoreIdeas] = useState(false);
  const [ideasExhaustedMessage, setIdeasExhaustedMessage] = useState<string | null>(null);
  const [localScripts, setLocalScripts] = useState<GeneratedScript[]>([]);
  const [autoSendTgOnGen, setAutoSendTgOnGen] = useState(false);
  const [customIdeaInput, setCustomIdeaInput] = useState('');
  const [showCustomIdeaForm, setShowCustomIdeaForm] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<ConfirmModalConfig | null>(null);

  if (!video) return null;

  // Combine parent scripts and locally generated scripts
  const combinedScripts = [
    ...localScripts,
    ...allScripts.filter((s) => s.videoIds?.includes(video.id) && !localScripts.some((ls) => ls.id === s.id)),
  ];

  const activeScript = combinedScripts.length > 0 ? (combinedScripts[selectedScriptIndex] || combinedScripts[0]) : null;
  const parsedIdeas = extractIdeasFromFilterResult(video.geminiResult);
  const isRejected = isRejectedFilter(video);
  const rejectionReason = video.filterReason || extractFilterRejectionReason(video.geminiResult);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (content: string, filename: string) => {
    const element = document.createElement('a');
    const file = new Blob([content], { type: 'text/plain;charset=utf-8' });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleSendToTelegram = async (contentToSend?: string, scriptId?: string, headerTitle?: string) => {
    const text = contentToSend || (activeScript ? activeScript.content : video.geminiResult || '');
    if (!text || isSendingTg) return;

    setIsSendingTg(true);
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          header: `🎬 *${headerTitle || (activeScript ? activeScript.title : video.title)}*\n📺 Канал: ${video.channelTitle}\n🔗 ${video.url}`,
          scriptId: scriptId || activeScript?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Ошибка отправки в Telegram');
      setTgSentSuccess(true);
      setTimeout(() => setTgSentSuccess(false), 3000);
    } catch (err: any) {
      alert(`Ошибка отправки в Telegram: ${err.message}`);
    } finally {
      setIsSendingTg(false);
    }
  };

  // Generate Stage 2 Script for a specific idea
  const handleGenerateScriptForIdea = async (ideaTitle: string, ideaText: string, ideaId?: string) => {
    if (!video || isProcessing) return;
    setGeneratingIdeaId(ideaId || 'custom');

    try {
      const res = await fetch(`/api/videos/${video.id}/generate-idea-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideaTitle,
          ideaText,
          sendToTelegram: autoSendTgOnGen,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка генерации сценария');

      if (data.script) {
        setLocalScripts((prev) => [data.script, ...prev]);
        setSelectedScriptIndex(0);
        setSubView('scripts');
        if (onScriptCreated) onScriptCreated();
      }
    } catch (err: any) {
      alert(`Ошибка генерации сценария: ${err.message}`);
    } finally {
      setGeneratingIdeaId(null);
    }
  };

  // Find More Ideas & Scenarios from transcript
  const handleFindMoreIdeas = async () => {
    if (!video || isFindingMoreIdeas) return;
    setIsFindingMoreIdeas(true);
    setIdeasExhaustedMessage(null);

    try {
      const res = await fetch(`/api/videos/${video.id}/find-more-ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка поиска новых идей');

      if (data.exhausted) {
        setIdeasExhaustedMessage(data.message || 'По заданному фильтру в этом ролике больше нет подходящих сценариев.');
      } else {
        if (onScriptCreated) onScriptCreated();
      }
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`);
    } finally {
      setIsFindingMoreIdeas(false);
    }
  };

  const handleOverrideFilter = async (approve: boolean) => {
    try {
      const res = await fetch(`/api/videos/${video.id}/override-filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchedFilter: approve }),
      });
      if (res.ok) {
        if (onScriptCreated) onScriptCreated();
      }
    } catch (err: any) {
      alert(`Ошибка смены статуса фильтра: ${err.message}`);
    }
  };

  const handleRequestOverrideFilter = (approve: boolean) => {
    setConfirmConfig({
      isOpen: true,
      title: approve ? 'Одобрить видео (Этап 1)?' : 'Отклонить видео?',
      description: `Видео: «${video.title}». ${approve ? 'Видео будет перемещено в одобренные для генерации идей и сценариев.' : 'Видео будет перемещено в статус отклоненных.'}`,
      confirmText: approve ? 'Одобрить' : 'Отклонить',
      cancelText: 'Отмена',
      type: approve ? 'emerald' : 'danger',
      badge: approve ? 'Одобрение' : 'Отклонение',
      onConfirm: () => handleOverrideFilter(approve),
      onCancel: () => {},
    });
  };

  const handleRequestToggleReviewed = () => {
    const isRev = video.isReviewed;
    setConfirmConfig({
      isOpen: true,
      title: isRev ? 'Вернуть видео в работу?' : 'Отметить как обработанное?',
      description: `Видео: «${video.title}». ${isRev ? 'Статус «Обработано» будет снят.' : 'Видео будет помечено как отсмотренное/обработанное.'}`,
      confirmText: isRev ? 'Вернуть в работу' : 'Отметить',
      cancelText: 'Отмена',
      type: 'teal',
      badge: 'Статус',
      onConfirm: () => {
        if (onToggleReviewed) onToggleReviewed(video);
      },
      onCancel: () => {},
    });
  };

  const handleRequestResetStatus = (target: 'stage1' | 'approved' | 'rejected' | 'new') => {
    const targetLabel = target === 'new' ? 'в статус «Не обработано»' : 'на Этап 1 (очистить сценарии)';
    setConfirmConfig({
      isOpen: true,
      title: 'Сбросить статус видео?',
      description: `Видео: «${video.title}». Статус будет сброшен ${targetLabel}.`,
      confirmText: 'Сбросить',
      cancelText: 'Отмена',
      type: 'danger',
      badge: 'Сброс',
      onConfirm: () => {
        if (onResetStatus) onResetStatus(video.id, target);
      },
      onCancel: () => {},
    });
  };

  const handleRequestReProcess = (template: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Запустить повторную обработку фильтром?',
      description: `Видео: «${video.title}». Gemini повторно проанализирует транскрипт по критериям фильтра.`,
      confirmText: 'Запустить',
      cancelText: 'Отмена',
      type: 'primary',
      badge: 'Этап 1: Фильтр',
      onConfirm: () => onReProcess(video, template),
      onCancel: () => {},
    });
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuestion.trim() || isChatLoading) return;

    const q = chatQuestion.trim();
    setChatQuestion('');
    setChatHistory((prev) => [...prev, { sender: 'user', text: q }]);
    setIsChatLoading(true);

    try {
      const res = await fetch(`/api/videos/${video.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка запроса к Gemini');

      setChatHistory((prev) => [...prev, { sender: 'gemini', text: data.answer }]);
    } catch (err: any) {
      setChatHistory((prev) => [
        ...prev,
        { sender: 'gemini', text: `❌ Ошибка: ${err.message}` },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Filtered transcript segments
  const filteredSegments = video.transcriptSegments?.filter((s) =>
    s.text.toLowerCase().includes(transcriptSearch.toLowerCase())
  );

  return (
    <div id="video-detail-side-panel" onClick={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-2xs transition-opacity animate-in fade-in">
      <div onClick={(e) => e.stopPropagation()} className="bg-white shadow-2xl border-l border-stone-200 w-full max-w-2xl xl:max-w-3xl h-full flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
        {/* Top bar */}
        <div className="p-4 sm:p-5 border-b border-stone-200 flex items-start justify-between gap-4 bg-stone-50/70">
          <div className="flex gap-3 min-w-0">
            <img
              src={video.thumbnail}
              alt={video.title}
              className="w-20 h-14 sm:w-28 sm:h-18 object-cover rounded-xl border border-stone-200 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-stone-500 mb-1">
                <span className="font-semibold text-stone-700 truncate">{video.channelTitle}</span>
                <span>•</span>
                <span>
                  {(() => {
                    try {
                      return new Date(video.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
                    } catch {
                      return video.publishedAt;
                    }
                  })()}
                </span>
                {video.isReviewed ? (
                  <span className="px-2 py-0.5 rounded-md bg-teal-100 text-teal-900 font-bold text-[10px] border border-teal-300 flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5 text-teal-700" />
                    ✅ Обработано / Просмотрено
                  </span>
                ) : isRejected ? (
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-bold text-[10px] border border-amber-300 flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-700" />
                    Отклонено фильтром
                  </span>
                ) : combinedScripts.length > 0 ? (
                  <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-900 font-bold text-[10px] border border-purple-300 flex items-center gap-1">
                    <Film className="w-2.5 h-2.5 text-purple-700" />
                    Сценарий готов ({combinedScripts.length})
                  </span>
                ) : video.matchedFilter === true || video.status === 'completed' ? (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 font-bold text-[10px] border border-emerald-300 flex items-center gap-1">
                    <Lightbulb className="w-2.5 h-2.5 text-emerald-700" />
                    Одобрено (Этап 1)
                  </span>
                ) : video.status === VIDEO_STATUS.TRANSCRIBED ? (
                  <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-semibold text-[10px]">
                    Текст готов
                  </span>
                ) : null}
              </div>
              <h2
                className="text-sm sm:text-base font-bold text-stone-900 line-clamp-1 leading-snug cursor-default"
                title={video.title}
              >
                {video.title}
              </h2>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <a
                  href={video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700 hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  Открыть на YouTube
                </a>
                {video.transcriptSource && (
                  <span className="text-[11px] text-stone-500">
                    Источник: {video.transcriptSource === 'subtitles' ? 'Субтитры YouTube' : 'Gemini AI Audio'}
                  </span>
                )}
                {video.queueTimestamp && (
                  <span 
                    className="inline-flex items-center gap-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md"
                    title={`Точное время добавления в очередь: ${new Date(video.queueTimestamp).toLocaleString('ru-RU')}`}
                  >
                    <Clock className="w-3 h-3 text-amber-600" />
                    <span>В очереди с: {new Date(video.queueTimestamp).toLocaleString('ru-RU')}</span>
                  </span>
                )}
                {onToggleReviewed && (
                  <button
                    type="button"
                    onClick={handleRequestToggleReviewed}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition ${
                      video.isReviewed
                        ? 'bg-teal-50 text-teal-800 border-teal-300 hover:bg-teal-100'
                        : 'bg-stone-100 text-stone-700 border-stone-300 hover:bg-stone-200'
                    }`}
                  >
                    <CheckCircle2 className={`w-3 h-3 ${video.isReviewed ? 'text-teal-600' : 'text-stone-400'}`} />
                    <span>{video.isReviewed ? 'Снять статус «Обработано»' : 'Отметить как обработано'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200/60 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex items-center justify-between border-b border-stone-200 px-4 sm:px-6 bg-white flex-wrap gap-2">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('ideas_and_scripts')}
              className={`py-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition ${
                activeTab === 'ideas_and_scripts'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Конвейер: Фильтр и Сценарии</span>
              {parsedIdeas.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">
                  {parsedIdeas.length} идей
                </span>
              )}
              {combinedScripts.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[10px] font-bold">
                  {combinedScripts.length} сценариев
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('chat')}
              className={`py-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition ${
                activeTab === 'chat'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
              <span>Чат с Gemini по видео</span>
            </button>

            <button
              onClick={() => setActiveTab('transcript')}
              className={`py-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition ${
                activeTab === 'transcript'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-blue-500" />
              <span>Транскрипт с таймкодами</span>
            </button>
          </div>
        </div>

        {/* Tab content area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-stone-50/40">
          {/* TAB 1: 2-STAGE PIPELINE (IDEAS & SCRIPTS) */}
          {activeTab === 'ideas_and_scripts' && (
            <div className="space-y-5">
              {/* Filter Status Banner */}
              {isRejected ? (
                <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs">
                    <div className="font-semibold text-amber-900 flex items-center gap-1.5">
                      <span>Отклонено фильтром аккаунта (Этап 1)</span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold uppercase">
                        Фильтр сработал
                      </span>
                    </div>
                    <div className="mt-2 p-3 bg-white/90 rounded-xl border border-amber-200 text-stone-800 shadow-2xs">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-amber-900 mb-1 flex items-center gap-1">
                        <span>Причина отклонения:</span>
                      </div>
                      <p className="text-xs text-stone-800 leading-relaxed">
                        {rejectionReason || 'Модель определила, что тема ролика не подходит под критерии фильтра аккаунта.'}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleRequestOverrideFilter(true)}
                        disabled={!canApprove(video)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition inline-flex items-center gap-1 shadow-2xs disabled:opacity-50"
                        title="Вернуть видео в список одобренных и разрешить генерацию сценариев"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Вернуть в одобренные (Одобрить вручную)</span>
                      </button>
                      {onResetStatus && (
                        <button
                          onClick={() => handleRequestResetStatus('new')}
                          disabled={isProcessing}
                          className="px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium rounded-lg text-xs transition inline-flex items-center gap-1 disabled:opacity-50"
                          title="Сбросить статус ролика в Не обработано"
                        >
                          <RefreshCw className="w-3 h-3 text-stone-500" />
                          <span>Сбросить статус</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleRequestReProcess('filter_screener')}
                        disabled={!canRecheckFilter(video)}
                        className="px-3 py-1.5 bg-amber-200 hover:bg-amber-300 text-amber-950 font-semibold rounded-lg text-xs transition inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
                        <span>Перепроверить фильтром</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : video.geminiResult ? (
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 flex items-center justify-between gap-3 text-xs flex-wrap">
                  <div className="flex items-center gap-2 text-emerald-900 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Видео успешно прошло первичный отбор фильтра (Этап 1)</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {parsedIdeas.length > 0 && (
                      <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-md font-bold text-[11px]">
                        Найдено идей: {parsedIdeas.length}
                      </span>
                    )}
                    {combinedScripts.length > 0 && onResetStatus && (
                      <button
                        onClick={() => handleRequestResetStatus('stage1')}
                        disabled={isProcessing}
                        className="px-2 py-1 bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200 rounded-lg text-[11px] font-medium transition disabled:opacity-50"
                        title="Очистить сгенерированные сценарии и оставить ролик на Этапе 1"
                      >
                        ↩️ Сбросить сценарии (на Этап 1)
                      </button>
                    )}
                    <button
                      onClick={() => handleRequestOverrideFilter(false)}
                      disabled={!canReject(video)}
                      className="text-[11px] text-stone-500 hover:text-amber-700 underline disabled:opacity-50"
                      title="Переместить в список отклоненных"
                    >
                      Отклонить
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Sub-view switcher tabs */}
              <div className="flex items-center justify-between border-b border-stone-200 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSubView('ideas')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                      subView === 'ideas'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
                    }`}
                  >
                    <Lightbulb className="w-3.5 h-3.5" />
                    <span>💡 Банк идей для Reels (Этап 1)</span>
                    {parsedIdeas.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        subView === 'ideas' ? 'bg-blue-700 text-white' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {parsedIdeas.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubView('scripts')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                      subView === 'scripts'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
                    }`}
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>🎬 Покадровые сценарии (Этап 2)</span>
                    {combinedScripts.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        subView === 'scripts' ? 'bg-purple-700 text-white' : 'bg-purple-100 text-purple-800'
                      }`}>
                        {combinedScripts.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubView('raw_filter')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                      subView === 'raw_filter'
                        ? 'bg-stone-800 text-white shadow-xs'
                        : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>📄 Полный ответ Gemini</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoSendTgOnGen}
                      onChange={(e) => setAutoSendTgOnGen(e.target.checked)}
                      className="rounded border-stone-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Сразу в TG при генерации</span>
                  </label>
                </div>
              </div>

              {/* SUBVIEW 1: IDEAS BANK */}
              {subView === 'ideas' && (
                <div className="space-y-4">
                  {/* Find More Ideas & Scenarios Header Bar */}
                  <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-stone-200 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-amber-500" />
                      <span className="text-xs font-semibold text-stone-800">
                        {parsedIdeas.length > 0 ? `Найдено идей в видео: ${parsedIdeas.length}` : 'Банк идей'}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isFindingMoreIdeas || !canFindMoreIdeas(video)}
                      onClick={handleFindMoreIdeas}
                      title="Искать другие ракурсы и смыслы в транскрипте, исключая уже найденные темы"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition disabled:opacity-50"
                    >
                      {isFindingMoreIdeas ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                      ) : (
                        <Search className="w-3.5 h-3.5 text-indigo-600" />
                      )}
                      <span>{isFindingMoreIdeas ? 'Ищем новые сценарии...' : '🔍 Найти еще возможные сценарии'}</span>
                    </button>
                  </div>

                  {/* Ideas Exhaustion Banner */}
                  {ideasExhaustedMessage && (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-semibold block">Новых тем больше нет</span>
                        <p className="text-amber-800 mt-0.5 leading-relaxed">{ideasExhaustedMessage}</p>
                      </div>
                    </div>
                  )}

                  {parsedIdeas.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3.5">
                      {parsedIdeas.map((idea, ideaIdx) => {
                        const isGeneratingThis = generatingIdeaId === idea.id;
                        return (
                          <div
                            key={`${video.id}-idea-${idea.id || idea.number || ideaIdx}-${ideaIdx}`}
                            className="bg-white p-4 sm:p-5 rounded-2xl border border-stone-200/90 shadow-2xs hover:shadow-xs transition space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-800 font-bold text-xs flex items-center justify-center shrink-0">
                                  #{idea.number}
                                </span>
                                <h3 className="text-sm font-bold text-stone-900 leading-snug">
                                  {idea.title}
                                </h3>
                                {idea.category && (
                                  <span className="px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 text-[10px] font-semibold">
                                    {idea.category}
                                  </span>
                                )}
                              </div>

                              {idea.virality && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold shrink-0">
                                  <Flame className="w-3 h-3 text-amber-500" />
                                  {idea.virality}
                                </span>
                              )}
                            </div>

                            {/* Hook */}
                            {idea.hook && (
                              <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs text-indigo-950">
                                <span className="font-bold block text-indigo-900 mb-0.5 flex items-center gap-1">
                                  <Sparkles className="w-3 h-3 text-indigo-600" />
                                  Парадоксальный хук для спикера:
                                </span>
                                <p className="italic font-medium leading-relaxed">
                                  «{idea.hook}»
                                </p>
                              </div>
                            )}

                            {/* Core Insight */}
                            {idea.coreInsight && (
                              <div className="text-xs text-stone-700 leading-relaxed">
                                <strong className="text-stone-900 font-semibold">Ядро мысли: </strong>
                                {idea.coreInsight}
                              </div>
                            )}

                            {/* Action Bar */}
                            <div className="pt-2 border-t border-stone-100 flex items-center justify-between flex-wrap gap-2">
                              <div className="text-[11px] text-stone-500">
                                {idea.context && <span>{idea.context}</span>}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleCopy(idea.rawText)}
                                  className="px-2.5 py-1.5 text-xs text-stone-600 hover:text-stone-900 bg-stone-50 hover:bg-stone-100 rounded-lg border border-stone-200 transition flex items-center gap-1"
                                >
                                  <Copy className="w-3 h-3" />
                                  <span>Копировать идею</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={isGeneratingThis || isProcessing}
                                  onClick={() => handleGenerateScriptForIdea(idea.title, idea.rawText, idea.id)}
                                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  {isGeneratingThis ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Film className="w-3.5 h-3.5" />
                                  )}
                                  <span>{isGeneratingThis ? 'Пишем сценарий...' : '🎬 Написать покадровый сценарий'}</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : combinedScripts.length > 0 ? (
                    <div className="bg-white p-6 rounded-2xl border border-stone-200 text-center space-y-4">
                      <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center mx-auto">
                        <Film className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-stone-900">
                          Для этого ролика создано сценариев: {combinedScripts.length}
                        </h4>
                        <p className="text-xs text-stone-500 max-w-md mx-auto">
                          Банк идей 1 этапа не найден в ответе или был перезапущен. Вы можете открыть готовые сценарии или запустить поиск новых идей.
                        </p>
                      </div>

                      <div className="flex justify-center items-center gap-3 pt-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setSubView('scripts')}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5 shadow-xs"
                        >
                          <Film className="w-3.5 h-3.5" />
                          <span>🎬 Открыть сценарии ({combinedScripts.length})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRequestReProcess('filter_screener')}
                          disabled={!canRecheckFilter(video)}
                          className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span>⚡ Сгенерировать банк идей (1 этап)</span>
                        </button>
                      </div>
                    </div>
                  ) : video.geminiResult ? (
                    <div className="bg-white p-6 rounded-2xl border border-stone-200 text-center space-y-3">
                      <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
                        {isRejected ? <AlertTriangle className="w-5 h-5" /> : <Lightbulb className="w-5 h-5" />}
                      </div>
                      <h4 className="text-sm font-semibold text-stone-800">
                        {isRejected ? 'Материал не подходит под критерии фильтра' : 'Готовые блоки идей не распознаны автоматически'}
                      </h4>
                      {isRejected && rejectionReason ? (
                        <div className="p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-xl text-xs text-stone-800 text-left max-w-lg mx-auto leading-relaxed">
                          <span className="font-bold text-amber-900 block mb-1">Причина отказа:</span>
                          <p className="italic">«{rejectionReason}»</p>
                        </div>
                      ) : (
                        <p className="text-xs text-stone-500 max-w-md mx-auto">
                          Вы можете перезапустить анализ с промптом-фильтром, просмотреть полный ответ Gemini или вручную ввести тему.
                        </p>
                      )}
                      <div className="flex justify-center items-center gap-2 pt-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleRequestReProcess('filter_screener')}
                          disabled={!canRecheckFilter(video)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                        >
                          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span>Запустить Промпт-Фильтр (Этап 1)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubView('raw_filter')}
                          className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5 border border-stone-200"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Показать полный ответ Gemini</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="py-16 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
                        <Sparkles className="w-6 h-6" />
                      </div>
                      <h3 className="text-sm font-semibold text-stone-800">Видео еще не обработано фильтром</h3>
                      <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto mb-4">
                        Запустите первый этап, чтобы расшифровать аудио и извлечь банк жизнеспособных тем для блога.
                      </p>
                      <button
                        onClick={() => handleRequestReProcess('filter_screener')}
                        disabled={!canRunStage1(video)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-sm transition disabled:opacity-50"
                      >
                        {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        <span>Запустить Промпт-Фильтр (Этап 1)</span>
                      </button>
                    </div>
                  )}

                  {/* Custom Idea Generation Form */}
                  <div className="bg-white p-4 rounded-2xl border border-stone-200">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-stone-800 flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5 text-indigo-600" />
                        Своя тема / кастомный угол для сценария
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowCustomIdeaForm(!showCustomIdeaForm)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        {showCustomIdeaForm ? 'Скрыть' : '+ Задать свою тему'}
                      </button>
                    </div>

                    {showCustomIdeaForm && (
                      <div className="mt-3 space-y-2">
                        <textarea
                          value={customIdeaInput}
                          onChange={(e) => setCustomIdeaInput(e.target.value)}
                          placeholder="Например: Сфокусируйся на мифе о 'хорошей девочке' и разбери стыд за проявление границ..."
                          rows={3}
                          className="w-full text-xs p-3 bg-stone-50 border border-stone-300 rounded-xl text-stone-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={!customIdeaInput.trim() || generatingIdeaId === 'custom'}
                            onClick={() => handleGenerateScriptForIdea('Кастомная тема', customIdeaInput, 'custom')}
                            className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {generatingIdeaId === 'custom' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Film className="w-3.5 h-3.5" />
                            )}
                            <span>Сгенерировать сценарий по этой теме</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SUBVIEW 2: GENERATED SCRIPTS (STAGE 2) */}
              {subView === 'scripts' && (
                <div className="space-y-4">
                  {combinedScripts.length > 0 ? (
                    <div className="space-y-4">
                      {/* Multi-script selector if multiple exist */}
                      {combinedScripts.length > 1 && (
                        <div className="bg-white p-3 rounded-2xl border border-stone-200">
                          <span className="text-xs font-semibold text-stone-700 block mb-2">
                            Созданные сценарии ({combinedScripts.length}):
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {combinedScripts.map((s, idx) => (
                              <button
                                key={s.id ? `script-${s.id}` : `script-idx-${idx}`}
                                type="button"
                                onClick={() => setSelectedScriptIndex(idx)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 ${
                                  selectedScriptIndex === idx
                                    ? 'bg-purple-600 text-white shadow-xs'
                                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                                }`}
                              >
                                <Film className="w-3 h-3" />
                                <span>{s.ideaTitle || s.title || `Сценарий ${idx + 1}`}</span>
                                <span className="text-[10px] opacity-75">
                                  {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Active Script Card */}
                      {activeScript && (
                        <div className="space-y-3">
                          {/* Script Action Bar */}
                          <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-stone-200">
                            <div>
                              <h3 className="text-sm font-bold text-stone-900">
                                {activeScript.title}
                              </h3>
                              <p className="text-[11px] text-stone-500">
                                Шаблон: {activeScript.promptTemplate || 'scriptwriter_deep'} • Создан {new Date(activeScript.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + new Date(activeScript.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleSendToTelegram(activeScript.content, activeScript.id, activeScript.title)}
                                disabled={isSendingTg}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-2xs transition"
                              >
                                {isSendingTg ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : tgSentSuccess ? (
                                  <Check className="w-3.5 h-3.5" />
                                ) : (
                                  <Send className="w-3.5 h-3.5" />
                                )}
                                <span>{tgSentSuccess ? 'Отправлено в TG!' : 'В Telegram'}</span>
                              </button>

                              <button
                                onClick={() => handleCopy(activeScript.content)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 rounded-lg shadow-2xs transition"
                              >
                                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                <span>Копировать</span>
                              </button>

                              <button
                                onClick={() => handleDownload(activeScript.content, `${activeScript.title.slice(0, 30)}.md`)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 rounded-lg shadow-2xs transition"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>.md</span>
                              </button>
                            </div>
                          </div>

                          {/* Script Content Viewer */}
                          <div className="bg-white rounded-2xl p-5 sm:p-6 border border-stone-200 shadow-xs text-sm text-stone-800 leading-relaxed whitespace-pre-wrap font-sans">
                            {activeScript.content}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-12 text-center bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
                      <Film className="w-8 h-8 text-purple-600 mx-auto" />
                      <h4 className="text-sm font-semibold text-stone-800">Покадровые сценарии еще не сгенерированы</h4>
                      <p className="text-xs text-stone-500 max-w-sm mx-auto">
                        Перейдите во вкладку «Банк идей» выше и выберите понравившуюся идею, чтобы Gemini написал полный покадровый сценарий с хуком, B-roll и кульминацией.
                      </p>
                      <button
                        type="button"
                        onClick={() => setSubView('ideas')}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5"
                      >
                        <Lightbulb className="w-3.5 h-3.5" />
                        <span>Открыть банк идей</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* SUBVIEW 3: RAW GEMINI OUTPUT */}
              {subView === 'raw_filter' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                    <span className="text-xs font-medium text-stone-500">
                      Сырой вывод Gemini (модель 2.5 Flash)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(video.geminiResult || '')}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 rounded-lg transition"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>Копировать</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl p-5 sm:p-6 border border-stone-200 shadow-xs text-sm text-stone-800 leading-relaxed whitespace-pre-wrap font-sans">
                    {video.geminiResult || 'Результат отсутствует.'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: INTERACTIVE CHAT */}
          {activeTab === 'chat' && (
            <div className="flex flex-col h-[480px]">
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 mb-3">
                {chatHistory.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-stone-500">
                    <MessageSquare className="w-8 h-8 text-stone-400 mb-2" />
                    <p className="text-xs font-medium text-stone-700">Задайте любой вопрос по видео</p>
                    <p className="text-[11px] text-stone-500 mt-0.5 max-w-xs">
                      Gemini использует полный транскрипт этого ролика, чтобы ответить на ваши вопросы с точностью до цитаты.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                      {[
                        'О чем кратко видео?',
                        'Какие главные аргументы спикера?',
                        'Составь список полезных советов',
                      ].map((prompt, idx) => (
                        <button
                          key={idx}
                          onClick={() => setChatQuestion(prompt)}
                          className="text-[11px] px-2.5 py-1 rounded-full bg-white border border-stone-200 hover:border-stone-400 text-stone-700 transition"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chatHistory.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                          msg.sender === 'user'
                            ? 'bg-stone-900 text-white'
                            : 'bg-white border border-stone-200 text-stone-800 shadow-2xs whitespace-pre-wrap'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-stone-200 rounded-2xl p-3 flex items-center gap-2 text-xs text-stone-500 shadow-2xs">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                      <span>Gemini изучает транскрипт...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendChat} className="flex gap-2 pt-2 border-t border-stone-200">
                <input
                  type="text"
                  value={chatQuestion}
                  onChange={(e) => setChatQuestion(e.target.value)}
                  placeholder="Спросите что-нибудь о видео..."
                  disabled={isChatLoading || !canChat(video)}
                  className="flex-1 px-3.5 py-2.5 text-xs bg-white border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition"
                />
                <button
                  type="submit"
                  disabled={isChatLoading || !chatQuestion.trim() || !canChat(video)}
                  className="px-4 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-medium transition disabled:opacity-50 flex items-center justify-center shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}

          {/* TAB 3: FULL TRANSCRIPT */}
          {activeTab === 'transcript' && (
            <div className="space-y-4">
              {/* Search in transcript & copy buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-stone-200">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={transcriptSearch}
                    onChange={(e) => setTranscriptSearch(e.target.value)}
                    placeholder="Поиск по словам в транскрипте..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopy(video.transcript || '')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 rounded-lg transition"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>Копировать весь текст</span>
                  </button>
                  <button
                    onClick={() => handleDownload(video.transcript || '', `${video.title.slice(0, 30)}-transcript.txt`)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 rounded-lg transition"
                  >
                    <Download className="w-3 h-3" />
                    <span>.txt</span>
                  </button>
                </div>
              </div>

              {/* Transcript Display */}
              {video.transcript ? (
                video.transcriptSegments && video.transcriptSegments.length > 0 ? (
                  <div className="space-y-2 bg-white rounded-2xl p-4 border border-stone-200 shadow-2xs divide-y divide-stone-100">
                    {filteredSegments && filteredSegments.length > 0 ? (
                      filteredSegments.map((segment, idx) => (
                        <div key={idx} className="pt-2 first:pt-0 flex items-start gap-3 text-xs leading-relaxed hover:bg-stone-50 p-1.5 rounded-lg transition">
                          <a
                            href={`${video.url}&t=${segment.offset}s`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded shrink-0"
                            title="Смотреть с этой секунды на YouTube"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            {segment.formattedTime}
                          </a>
                          <p className="text-stone-800 flex-1">{segment.text}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-stone-500 py-4 text-center">Фразы по вашему запросу не найдены.</p>
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl p-5 border border-stone-200 shadow-2xs whitespace-pre-wrap font-sans text-xs leading-relaxed text-stone-800">
                    {video.transcript}
                  </div>
                )
              ) : (
                <div className="py-12 text-center text-xs text-stone-500">
                  Транскрипт пока не сгенерирован. Нажмите "Запустить", чтобы перевести видео в текст и получить анализ.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmModal config={confirmConfig} onClose={() => setConfirmConfig(null)} />
    </div>
  );
};
