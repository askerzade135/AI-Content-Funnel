import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Sparkles, FileText, MessageSquare, Copy, Download, ExternalLink, 
  Search, Loader2, Send, Check, Play, RefreshCw, AlertTriangle, AlertCircle, CheckCircle2, 
  Plus, Layers, Film, Lightbulb, Flame, ArrowRight, Video, ChevronRight, Clock,
  History, ChevronDown, ChevronUp, Trash2
} from 'lucide-react';
import { StoredVideo, GeneratedScript, PromptTemplateDef, PromptRunRecord } from '../types';
import { PromptStatusBadge } from './PromptStatusBadge';
import { checkIfFilteredOut, extractIdeasFromFilterResult, extractFilterRejectionReason, ParsedIdea, parseViralityScoreAndReason } from '../utils/filterCheck';
import { 
  canApprove, 
  canReject, 
  canRecheckFilter, 
  canRunStage1, 
  canRunStage2,
  canFindMoreIdeas, 
  canChat, 
  isRejectedFilter, 
  VIDEO_STATUS 
} from '../utils/video-actions';
import { ConfirmModal, ConfirmModalConfig } from './ConfirmModal';
import { ConfirmPaidActionModal } from './ConfirmPaidActionModal';
import { usePaidConfirmation } from '../hooks/usePaidConfirmation';

interface VideoDetailModalProps {
  video: StoredVideo | null;
  allScripts?: GeneratedScript[];
  initialPromptFilter?: string;
  onClose: () => void;
  onToggleReviewed?: (video: StoredVideo) => void;
  onStopProcess?: (video: StoredVideo) => void;
  onReProcess: (video: StoredVideo, promptTemplate: string, customPrompt?: string) => void;
  onScriptCreated?: () => void;
  onResetStatus?: (id: string, target: 'stage1' | 'approved' | 'rejected' | 'new') => void;
  isProcessing: boolean;
  activePipelineStepMessage?: string | null;
}

export const VideoDetailModal: React.FC<VideoDetailModalProps> = ({
  video,
  allScripts = [],
  initialPromptFilter,
  onClose,
  onToggleReviewed,
  onStopProcess,
  onReProcess,
  onScriptCreated,
  onResetStatus,
  isProcessing,
  activePipelineStepMessage,
}) => {
  const {
    confirmPaidAction,
    modalState: paidModalState,
    closeModal: closePaidModal,
  } = usePaidConfirmation();
  const [currentVideo, setCurrentVideo] = useState<StoredVideo | null>(video);
  useEffect(() => {
    setCurrentVideo(video);
  }, [video]);

  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateDef[]>([]);
  const [selectedStage1Prompt, setSelectedStage1Prompt] = useState<string>('filter_screener');
  const [selectedStage2Prompt, setSelectedStage2Prompt] = useState<string>('scriptwriter_deep');

  useEffect(() => {
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setPromptTemplates(data);
          const filterP = data.find((p) => p.category === 'filter');
          if (filterP) setSelectedStage1Prompt(filterP.id);
          const scriptP = data.find((p) => p.category === 'scriptwriter');
          if (scriptP) setSelectedStage2Prompt(scriptP.id);
        }
      })
      .catch((err) => console.warn('Error fetching prompts in modal:', err));
  }, []);

  const [activeTab, setActiveTab] = useState<'ideas_and_scripts' | 'chat' | 'transcript'>('ideas_and_scripts');
  const [subView, setSubView] = useState<'ideas' | 'scripts' | 'raw_filter' | 'history'>('ideas');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSendingTg, setIsSendingTg] = useState(false);
  const [tgSentSuccess, setTgSentSuccess] = useState(false);
  
  // Interactive Chat State
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ sender: 'user' | 'gemini'; text: string }>>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Selected scenario index for this video
  const [selectedScriptIndex, setSelectedScriptIndex] = useState(0);

  // History & Run state
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());
  const [isSettingCurrentRun, setIsSettingCurrentRun] = useState<string | null>(null);
  const [isDeletingRun, setIsDeletingRun] = useState<string | null>(null);

  // Auto-switch tab and scroll to run based on active prompt filter
  useEffect(() => {
    if (!video || !initialPromptFilter || initialPromptFilter === 'all') return;

    let targetStage: 'stage1' | 'stage2' | null = null;
    let targetPromptId: string | null = null;

    if (initialPromptFilter === 'stage1') {
      targetStage = 'stage1';
    } else if (initialPromptFilter === 'stage2') {
      targetStage = 'stage2';
    } else if (initialPromptFilter.startsWith('stage1:')) {
      targetStage = 'stage1';
      targetPromptId = initialPromptFilter.replace('stage1:', '');
    } else if (initialPromptFilter.startsWith('stage2:')) {
      targetStage = 'stage2';
      targetPromptId = initialPromptFilter.replace('stage2:', '');
    }

    if (!targetStage) return;

    const runs = video.promptRuns || [];
    const currentRun = runs.find((r) => r.isCurrent) || runs[0];

    const currentMatchesFilter = (() => {
      if (!currentRun) return false;
      const isStageMatch =
        (targetStage === 'stage1' && (currentRun.stage === 'stage1' || currentRun.stage === 1)) ||
        (targetStage === 'stage2' && (currentRun.stage === 'stage2' || currentRun.stage === 2));
      if (!isStageMatch) return false;
      if (targetPromptId) {
        const pId = currentRun.promptId || currentRun.promptTemplate;
        return pId === targetPromptId;
      }
      return true;
    })();

    setActiveTab('ideas_and_scripts');

    if (currentMatchesFilter) {
      if (targetStage === 'stage1') {
        setSubView('ideas');
      } else {
        setSubView('scripts');
      }
    } else {
      const matchingRun = runs.find((r) => {
        const isStageMatch =
          (targetStage === 'stage1' && (r.stage === 'stage1' || r.stage === 1)) ||
          (targetStage === 'stage2' && (r.stage === 'stage2' || r.stage === 2));
        if (!isStageMatch) return false;
        if (targetPromptId) {
          const pId = r.promptId || r.promptTemplate;
          return pId === targetPromptId;
        }
        return true;
      });

      if (matchingRun) {
        setSubView('history');
        setExpandedRunIds((prev) => new Set([...prev, matchingRun.id]));

        setTimeout(() => {
          const el = document.getElementById(`prompt-run-${matchingRun.id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 150);
      } else {
        if (targetStage === 'stage1') {
          setSubView('ideas');
        } else {
          setSubView('scripts');
        }
      }
    }
  }, [video?.id, initialPromptFilter]);

  const toggleRunExpanded = (runId: string) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  // Idea generation & search state
  const [generatingIdeaId, setGeneratingIdeaId] = useState<string | null>(null);
  const [isFindingMoreIdeas, setIsFindingMoreIdeas] = useState(false);
  const [ideasExhaustedMessage, setIdeasExhaustedMessage] = useState<string | null>(null);
  const [localScripts, setLocalScripts] = useState<GeneratedScript[]>([]);
  const [customIdeaInput, setCustomIdeaInput] = useState('');
  const [showCustomIdeaForm, setShowCustomIdeaForm] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<ConfirmModalConfig | null>(null);

  if (!video) return null;
  const activeVideo = currentVideo && currentVideo.id === video.id ? currentVideo : video;
  if (!activeVideo) return null;

  const isBusy = isProcessing || Boolean(activePipelineStepMessage);

  const filterPrompts = promptTemplates.filter(
    (p) => p.category === 'filter' || p.category === 'general' || p.id === 'filter_screener'
  );

  const scriptwriterPrompts = promptTemplates.filter(
    (p) => p.category === 'scriptwriter' || p.category === 'general' || p.id === 'scriptwriter_deep'
  );

  // Combine parent scripts and locally generated scripts
  const combinedScripts = [
    ...localScripts,
    ...allScripts.filter((s) => s.videoIds?.includes(activeVideo.id) && !localScripts.some((ls) => ls.id === s.id)),
  ];

  const activeScript = combinedScripts.length > 0 ? (combinedScripts[selectedScriptIndex] || combinedScripts[0]) : null;
  const parsedIdeas = extractIdeasFromFilterResult(activeVideo.geminiResult);
  const isRejected = isRejectedFilter(activeVideo);
  const rejectionReason = activeVideo.filterReason || extractFilterRejectionReason(activeVideo.geminiResult);

  const handleToggleExpandRun = (runId: string) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const handleSetCurrentRun = async (runId: string) => {
    if (!activeVideo) return;
    setIsSettingCurrentRun(runId);
    try {
      const res = await fetch(`/api/videos/${activeVideo.id}/set-current-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка смены текущего прогона');
      if (data.video) {
        setCurrentVideo(data.video);
        if (onScriptCreated) onScriptCreated();
      }
    } catch (err: any) {
      alert(`Ошибка смены текущей версии: ${err.message}`);
    } finally {
      setIsSettingCurrentRun(null);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    if (!activeVideo) return;
    setConfirmConfig({
      isOpen: true,
      title: 'Удалить этот прогон из истории?',
      description: 'Запись о прогоне будет удалена. Если это был текущий прогон, активным станет предыдущий.',
      confirmText: 'Удалить',
      cancelText: 'Отмена',
      type: 'danger',
      badge: 'Удаление',
      onConfirm: async () => {
        setIsDeletingRun(runId);
        try {
          const res = await fetch(`/api/videos/${activeVideo.id}/prompt-runs/${runId}`, {
            method: 'DELETE',
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Ошибка удаления записи');
          if (data.video) {
            setCurrentVideo(data.video);
            if (onScriptCreated) onScriptCreated();
          }
        } catch (err: any) {
          alert(`Ошибка удаления записи: ${err.message}`);
        } finally {
          setIsDeletingRun(null);
        }
      },
      onCancel: () => {},
    });
  };

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
    const text = contentToSend || (activeScript ? activeScript.content : activeVideo.geminiResult || '');
    if (!text || isSendingTg) return;

    setIsSendingTg(true);
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          header: `🎬 *${headerTitle || (activeScript ? activeScript.title : activeVideo.title)}*\n📺 Канал: ${activeVideo.channelTitle}\n🔗 ${activeVideo.url}`,
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
  const executeGenerateScriptForIdea = async (ideaTitle: string, ideaText: string, ideaId?: string) => {
    if (!activeVideo || isProcessing) return;
    setGeneratingIdeaId(ideaId || 'custom');

    try {
      const res = await fetch(`/api/videos/${activeVideo.id}/generate-idea-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideaTitle,
          ideaText,
          promptTemplate: selectedStage2Prompt,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка генерации сценария');

      if (data.video) {
        setCurrentVideo(data.video);
      }
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

  const handleGenerateScriptForIdea = async (ideaTitle: string, ideaText: string, ideaId?: string) => {
    if (!activeVideo || isProcessing) return;
    await confirmPaidAction({
      actionType: 'stage2',
      videos: [activeVideo],
      title: `Написать покадровый сценарий (Этап 2)`,
      description: `Идея: «${ideaTitle}». Модель Gemini сгенерирует подробный сценарий для ролика.`,
      onConfirm: () => executeGenerateScriptForIdea(ideaTitle, ideaText, ideaId),
    });
  };

  // Find More Ideas & Scenarios from transcript
  const handleFindMoreIdeas = async () => {
    if (!activeVideo || isFindingMoreIdeas) return;
    setIsFindingMoreIdeas(true);
    setIdeasExhaustedMessage(null);

    try {
      const res = await fetch(`/api/videos/${activeVideo.id}/find-more-ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка поиска новых идей');

      if (data.exhausted) {
        setIdeasExhaustedMessage(data.message || 'По заданному фильтру в этом ролике больше нет подходящих сценариев.');
      } else {
        if (data.video) setCurrentVideo(data.video);
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
      const res = await fetch(`/api/videos/${activeVideo.id}/override-filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchedFilter: approve }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.video) setCurrentVideo(data.video);
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
      description: `Видео: «${activeVideo.title}». ${approve ? 'Видео будет перемещено в одобренные для генерации идей и сценариев.' : 'Видео будет перемещено в статус отклоненных.'}`,
      confirmText: approve ? 'Одобрить' : 'Отклонить',
      cancelText: 'Отмена',
      type: approve ? 'emerald' : 'danger',
      badge: approve ? 'Одобрение' : 'Отклонение',
      onConfirm: () => handleOverrideFilter(approve),
      onCancel: () => {},
    });
  };

  const handleRequestToggleReviewed = () => {
    const isRev = activeVideo.isReviewed;
    setConfirmConfig({
      isOpen: true,
      title: isRev ? 'Вернуть видео в работу?' : 'Отметить как обработанное?',
      description: `Видео: «${activeVideo.title}». ${isRev ? 'Статус «Обработано» будет снят.' : 'Видео будет помечено как отсмотренное/обработанное.'}`,
      confirmText: isRev ? 'Вернуть в работу' : 'Отметить',
      cancelText: 'Отмена',
      type: 'teal',
      badge: 'Статус',
      onConfirm: () => {
        if (onToggleReviewed) onToggleReviewed(activeVideo);
      },
      onCancel: () => {},
    });
  };

  const handleRequestReProcess = (template?: string) => {
    const targetTemplate = template || selectedStage1Prompt;
    confirmPaidAction({
      actionType: 'stage1',
      videos: [activeVideo],
      title: 'Запустить обработку фильтром (Этап 1)',
      description: `Видео: «${activeVideo.title}». Gemini проанализирует транскрипт с выбранным промтом.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/videos/${activeVideo.id}/run-stage1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promptTemplate: targetTemplate }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Ошибка запуска этапа 1');
          if (data.video) {
            setCurrentVideo(data.video);
            setSubView('ideas');
            if (onScriptCreated) onScriptCreated();
          }
        } catch (err: any) {
          onReProcess(activeVideo, targetTemplate);
        }
      },
    });
  };

  const handleRequestRunStage2 = () => {
    confirmPaidAction({
      actionType: 'stage2',
      videos: [activeVideo],
      title: 'Сгенерировать покадровый сценарий (Этап 2)',
      description: `Видео: «${activeVideo.title}». Модель Gemini создаст подробный покадровый сценарий по выбранному промпту.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/videos/${activeVideo.id}/run-stage2`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promptTemplate: selectedStage2Prompt }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Ошибка запуска этапа 2');
          if (data.video) {
            setCurrentVideo(data.video);
            setSubView('scripts');
            if (onScriptCreated) onScriptCreated();
          }
        } catch (err: any) {
          alert(`Ошибка генерации сценария: ${err.message}`);
        }
      },
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
      const res = await fetch(`/api/videos/${activeVideo.id}/chat`, {
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
  const filteredSegments = activeVideo.transcriptSegments?.filter((s) =>
    s.text.toLowerCase().includes(transcriptSearch.toLowerCase())
  );

  return (
    <div id="video-detail-side-panel" onClick={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-2xs transition-opacity animate-in fade-in">
      <div onClick={(e) => e.stopPropagation()} className="bg-white shadow-2xl border-l border-stone-200 w-full max-w-2xl xl:max-w-3xl h-full flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
        {/* Top bar */}
        <div className="p-4 sm:p-5 border-b border-stone-200 flex items-start justify-between gap-4 bg-stone-50/70">
          <div className="flex gap-3 min-w-0">
            <img
              src={activeVideo.thumbnail}
              alt={activeVideo.title}
              className="w-20 h-14 sm:w-28 sm:h-18 object-cover rounded-xl border border-stone-200 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-stone-500 mb-1 flex-wrap">
                <span className="font-semibold text-stone-700 truncate">{activeVideo.channelTitle}</span>
                <span>•</span>
                <span>
                  {(() => {
                    try {
                      return new Date(activeVideo.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
                    } catch {
                      return activeVideo.publishedAt;
                    }
                  })()}
                </span>
                <PromptStatusBadge video={activeVideo} />
                {activeVideo.promptRuns && activeVideo.promptRuns.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('ideas_and_scripts');
                      setSubView('history');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 transition cursor-pointer"
                    title="Открыть историю прогонов этого видео"
                  >
                    <History className="w-2.5 h-2.5 text-stone-500" />
                    <span>История ({activeVideo.promptRuns.length})</span>
                  </button>
                )}
              </div>
              <h2
                className="text-sm sm:text-base font-bold text-stone-900 line-clamp-1 leading-snug cursor-default"
                title={activeVideo.title}
              >
                {activeVideo.title}
              </h2>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <a
                  href={activeVideo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:text-rose-700 hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  Открыть на YouTube
                </a>
                {activeVideo.transcriptSource && (
                  <span className="text-[11px] text-stone-500">
                    Источник:{' '}
                    {activeVideo.transcriptSource === 'subtitles'
                      ? 'Субтитры YouTube (А)'
                      : activeVideo.transcriptSource === 'supadata'
                      ? 'Supadata API (Б)'
                      : activeVideo.transcriptSource === 'chocodata'
                      ? 'ChocoData API (Б2)'
                      : 'Gemini AI Audio (В)'}
                  </span>
                )}
                {activeVideo.queueTimestamp && (activeVideo.status === 'transcribe_queued' || activeVideo.status === 'transcribing') && (
                  <span 
                    className="inline-flex items-center gap-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 pl-2 pr-1 py-0.5 rounded-md"
                    title={`Точное время добавления в очередь: ${new Date(activeVideo.queueTimestamp).toLocaleString('ru-RU')}`}
                  >
                    <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                    <span>В очереди с: {new Date(activeVideo.queueTimestamp).toLocaleString('ru-RU')}</span>
                    {onStopProcess && (
                      <button
                        type="button"
                        onClick={() => onStopProcess(activeVideo)}
                        title="Убрать это видео из очереди"
                        className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition cursor-pointer flex items-center gap-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                        <span>Убрать</span>
                      </button>
                    )}
                  </span>
                )}
                {onToggleReviewed && (
                  <button
                    type="button"
                    onClick={handleRequestToggleReviewed}
                    disabled={isBusy}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      activeVideo.isReviewed
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                        : 'bg-stone-100 text-stone-700 border-stone-300 hover:bg-stone-200'
                    }`}
                  >
                    <CheckCircle2 className={`w-3 h-3 ${activeVideo.isReviewed ? 'text-emerald-600' : 'text-stone-400'}`} />
                    <span>{activeVideo.isReviewed ? 'Снять статус «Обработано»' : 'Отметить как обработано'}</span>
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
              {/* Requires Payment Banner */}
              {activeVideo.status === 'requires_payment' && (
                <div className="p-4 rounded-2xl bg-amber-50/90 border border-amber-300 flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-amber-950">
                        Действие требует подтверждения сметы токенов Gemini
                      </h4>
                      <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                        {activeVideo.paidActionReason || 'Для выполнения действия будет задействована модель Gemini. Ознакомьтесь со сметой и подтвердите запуск.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      const actionType = activeVideo.pendingPaidAction || (activeVideo.lastPassedStatus === 'approved' ? 'stage2' : 'stage1');
                      confirmPaidAction({
                        actionType,
                        videos: [activeVideo],
                        onConfirm: () => {
                          if (actionType === 'stage2') {
                            handleGenerateScriptForIdea('Автоматический сценарий', activeVideo.transcript || '', 'auto');
                          } else {
                            onReProcess(activeVideo, 'filter_screener');
                          }
                        },
                      });
                    }}
                    className="px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 rounded-xl shadow-xs transition shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Подтвердить и запустить ({activeVideo.pendingPaidAction === 'stage2' ? 'Этап 2' : 'Этап 1'})</span>
                  </button>
                </div>
              )}

              {/* Error Status Banner */}
              {activeVideo.status === 'error' && activeVideo.error && (
                <div className="p-4 rounded-2xl bg-rose-50/90 border border-rose-200 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs">
                    <div className="font-semibold text-rose-950 flex items-center gap-1.5">
                      <span>
                        {activeVideo.error.includes('BotGuard') || activeVideo.error.includes('проверка на бота')
                          ? 'Заблокировано YouTube (защита BotGuard)'
                          : 'Ошибка обработки видео'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-rose-200 text-rose-900 text-[10px] font-bold uppercase">
                        {activeVideo.errorStage === 'transcription' ? 'Транскрипция' : 'Ошибка'}
                      </span>
                    </div>
                    <div className="mt-2 p-3 bg-white/90 rounded-xl border border-rose-200 text-stone-800 shadow-2xs">
                      <p className="text-xs text-stone-800 leading-relaxed">
                        {activeVideo.error}
                      </p>
                      {(activeVideo.error.includes('BotGuard') || activeVideo.error.includes('проверка на бота')) && (
                        <p className="text-[11px] text-stone-500 mt-2 border-t border-rose-100 pt-2 leading-relaxed">
                          💡 <strong>Рекомендация:</strong> YouTube заблокировал прямое скачивание звука с IP сервера. Чтобы автоматически получать субтитры таких видео, добавьте API ключ в Настройки → «Шлюз субтитров Supadata».
                        </p>
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleRequestReProcess(selectedStage1Prompt)}
                        disabled={isBusy}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg text-xs transition inline-flex items-center gap-1 shadow-2xs disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                        <span>Повторить попытку</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
                        onClick={() => handleOverrideFilter(true)}
                        disabled={!canApprove(activeVideo) || isBusy}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition inline-flex items-center gap-1 shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Вернуть видео в список одобренных и разрешить генерацию сценариев"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Вернуть в одобренные (Одобрить вручную)</span>
                      </button>
                      <button
                        onClick={() => handleRequestReProcess(selectedStage1Prompt)}
                        disabled={isBusy}
                        className="px-3 py-1.5 bg-amber-200 hover:bg-amber-300 text-amber-950 font-semibold rounded-lg text-xs transition inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                        <span>Перепроверить фильтром</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : activeVideo.geminiResult ? (
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
                    <button
                      onClick={() => handleOverrideFilter(false)}
                      disabled={!canReject(activeVideo) || isBusy}
                      className="text-[11px] text-stone-500 hover:text-amber-700 underline disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      title="Переместить в список отклоненных"
                    >
                      Отклонить
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Sub-view switcher tabs */}
              <div className="flex items-center border-b border-stone-200 pb-2.5">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setSubView('ideas')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                      subView === 'ideas'
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200/80'
                    }`}
                  >
                    <Lightbulb className="w-3.5 h-3.5" />
                    <span>Банк идей (Этап 1)</span>
                    {parsedIdeas.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        subView === 'ideas' ? 'bg-sky-700 text-white' : 'bg-sky-100 text-sky-800'
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
                        : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200/80'
                    }`}
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Покадровые сценарии (Этап 2)</span>
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
                    onClick={() => setSubView('history')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                      subView === 'history'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200/80'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>История прогонов</span>
                    {activeVideo.promptRuns && activeVideo.promptRuns.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        subView === 'history' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {activeVideo.promptRuns.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubView('raw_filter')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                      subView === 'raw_filter'
                        ? 'bg-stone-800 text-white shadow-xs'
                        : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200/80'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Ответ Gemini</span>
                  </button>
                </div>
              </div>

              {/* SUBVIEW 1: IDEAS BANK */}
              {subView === 'ideas' && (
                <div className="space-y-4">
                  {/* ЗОНА НАСТРОЕК ЗАПУСКА (Этап 1) */}
                  <div className="bg-stone-50/90 border border-stone-200/90 rounded-2xl p-3.5 sm:p-4 shadow-2xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                        <div className="w-7 h-7 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0 border border-sky-200/60">
                          <Sparkles className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-stone-700 whitespace-nowrap">Промпт Этапа 1:</span>
                          <select
                            value={selectedStage1Prompt}
                            onChange={(e) => setSelectedStage1Prompt(e.target.value)}
                            className="text-xs py-1.5 px-3 bg-white border border-stone-300 rounded-xl text-stone-800 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 shadow-2xs max-w-[280px] sm:max-w-xs transition"
                          >
                            {filterPrompts.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} {p.badge ? `(${p.badge})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap shrink-0">
                        <button
                          type="button"
                          disabled={isFindingMoreIdeas || !canFindMoreIdeas(activeVideo)}
                          onClick={handleFindMoreIdeas}
                          title="Искать другие ракурсы и смыслы в транскрипте, исключая уже найденные темы"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-700 bg-white hover:bg-stone-100 border border-stone-300/80 rounded-xl transition shadow-2xs disabled:opacity-50 cursor-pointer"
                        >
                          {isFindingMoreIdeas ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                          ) : (
                            <Search className="w-3.5 h-3.5 text-stone-500" />
                          )}
                          <span>{isFindingMoreIdeas ? 'Ищем новые темы...' : 'Найти ещё идеи'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRequestReProcess(selectedStage1Prompt)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer"
                          title="Запустить анализ и генерацию банка идей с выбранным промптом"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                          <span>Запустить Этап 1</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Ideas Exhaustion Banner */}
                  {ideasExhaustedMessage && (
                    <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900 shadow-2xs">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-semibold block">Новых тем больше нет</span>
                        <p className="text-amber-800 mt-0.5 leading-relaxed">{ideasExhaustedMessage}</p>
                      </div>
                    </div>
                  )}

                  {/* ЗОНА РЕЗУЛЬТАТОВ (Банк идей) */}
                  <div className="space-y-3.5">
                    {parsedIdeas.length > 0 ? (
                      <>
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-stone-700">Банк идей</span>
                            <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[11px] font-bold">
                              {parsedIdeas.length}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3.5">
                          {parsedIdeas.map((idea, ideaIdx) => {
                            const isGeneratingThis = generatingIdeaId === idea.id;
                            const parsedVir = idea.viralityScore 
                              ? { score: idea.viralityScore, reason: idea.viralityReason }
                              : parseViralityScoreAndReason(idea.virality);
                            const score = parsedVir?.score || (idea.virality ? idea.virality.replace(/^🔥\s*/, '') : undefined);
                            const reason = parsedVir?.reason;

                            return (
                              <div
                                key={`${activeVideo.id}-idea-${idea.id || idea.number || ideaIdx}-${ideaIdx}`}
                                className="bg-white p-4 sm:p-5 rounded-2xl border border-stone-200/90 shadow-2xs hover:shadow-xs transition space-y-3.5"
                              >
                                {/* Заголовок карточки + бейдж оценки */}
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                    <span className="w-6 h-6 rounded-lg bg-sky-100/90 text-sky-800 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 border border-sky-200/60">
                                      #{idea.number}
                                    </span>
                                    <div className="space-y-1 min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="text-sm sm:text-base font-bold text-stone-900 leading-snug">
                                          {idea.title}
                                        </h4>
                                        {idea.category && (
                                          <span className="px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 text-[11px] font-medium border border-stone-200/60 whitespace-nowrap">
                                            {idea.category}
                                          </span>
                                        )}
                                      </div>

                                      {/* Обоснование оценки отдельной строкой обычным шрифтом */}
                                      {reason && (
                                        <p className="text-xs text-stone-600 leading-relaxed pt-0.5">
                                          <span className="font-semibold text-stone-700">Обоснование: </span>
                                          {reason}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  {/* Компактный бейдж только с оценкой */}
                                  {score && (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200/80 text-amber-800 text-xs font-bold shrink-0 whitespace-nowrap shadow-2xs">
                                      <Flame className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                                      <span>{score}</span>
                                    </span>
                                  )}
                                </div>

                                {/* Парадоксальный хук для спикера */}
                                {idea.hook && (
                                  <div className="p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100/80 text-xs sm:text-[13px] text-indigo-950 space-y-1.5">
                                    <span className="font-bold text-indigo-900 flex items-center gap-1.5 text-xs">
                                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                      <span>Парадоксальный хук для спикера:</span>
                                    </span>
                                    <p className="italic text-stone-800 leading-relaxed pl-2.5 border-l-2 border-indigo-400 font-normal">
                                      «{idea.hook}»
                                    </p>
                                  </div>
                                )}

                                {/* Ядро мысли */}
                                {idea.coreInsight && (
                                  <div className="text-xs sm:text-[13px] text-stone-600 leading-relaxed">
                                    <strong className="text-stone-900 font-semibold">Ядро мысли: </strong>
                                    {idea.coreInsight}
                                  </div>
                                )}

                                {/* Панель действий внизу */}
                                <div className="pt-3 border-t border-stone-100 flex items-center justify-between flex-wrap gap-2.5">
                                  <div className="text-[11px] text-stone-500 font-medium">
                                    {idea.context && <span>{idea.context}</span>}
                                  </div>

                                  <div className="flex items-center gap-2">
                                    {/* Второстепенное действие: Копировать идею */}
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(idea.rawText)}
                                      className="px-3 py-1.5 text-xs font-medium text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200/80 rounded-xl border border-stone-200/80 transition inline-flex items-center gap-1.5 cursor-pointer"
                                      title="Скопировать текст идеи"
                                    >
                                      <Copy className="w-3.5 h-3.5 text-stone-500" />
                                      <span>Копировать идею</span>
                                    </button>

                                    {/* Основное действие: Написать покадровый сценарий */}
                                    <button
                                      type="button"
                                      disabled={isGeneratingThis || isBusy}
                                      onClick={() => handleGenerateScriptForIdea(idea.title, idea.rawText, idea.id)}
                                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 active:bg-purple-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                                      title="Написать покадровый сценарий с выбранным промптом"
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
                      </>
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
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                          >
                            <Film className="w-3.5 h-3.5" />
                            <span>🎬 Открыть сценарии ({combinedScripts.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRequestReProcess(selectedStage1Prompt)}
                            disabled={isBusy}
                            className="px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                          >
                            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            <span>⚡ Сгенерировать банк идей (1 этап)</span>
                          </button>
                        </div>
                      </div>
                    ) : activeVideo.geminiResult ? (
                      <div className="bg-white p-6 rounded-2xl border border-stone-200 text-center space-y-3">
                        <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
                          {isRejected ? <AlertTriangle className="w-5 h-5" /> : <Lightbulb className="w-5 h-5" />}
                        </div>
                        <h4 className="text-sm font-semibold text-stone-800">
                          {isRejected ? 'Материал не подходит под критерии текущего фильтра' : 'Готовые блоки идей не распознаны автоматически'}
                        </h4>
                        {isRejected && rejectionReason ? (
                          <div className="p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-xl text-xs text-stone-800 text-left max-w-lg mx-auto leading-relaxed">
                            <span className="font-bold text-amber-900 block mb-1">Причина отказа:</span>
                            <p className="italic">«{rejectionReason}»</p>
                          </div>
                        ) : (
                          <p className="text-xs text-stone-500 max-w-md mx-auto">
                            Вы можете перезапустить анализ с любым промптом из библиотеки в панели настроек выше.
                          </p>
                        )}
                        <p className="text-[11px] text-stone-500 pt-1">
                          Чтобы запустить анализ с другим фильтром, выберите нужный шаблон в панели настроек выше и нажмите «Запустить Этап 1».
                        </p>
                      </div>
                    ) : (
                      <div className="py-16 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto mb-3">
                          <Sparkles className="w-6 h-6" />
                        </div>
                        <h3 className="text-sm font-semibold text-stone-800">Видео еще не обработано фильтром</h3>
                        <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto mb-4">
                          Запустите первый этап, чтобы извлечь банк жизнеспособных тем для блога.
                        </p>
                        <button
                          onClick={() => handleRequestReProcess(selectedStage1Prompt)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-xl shadow-sm transition disabled:opacity-50 cursor-pointer"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span>Запустить Этап 1 с выбранным промптом</span>
                        </button>
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
                      <div className="bg-white p-3 rounded-2xl border border-stone-200 flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-stone-700">
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

                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-stone-500 font-medium">Промпт сценария:</span>
                            <select
                              value={selectedStage2Prompt}
                              onChange={(e) => setSelectedStage2Prompt(e.target.value)}
                              className="text-xs py-1 px-2 bg-stone-50 border border-stone-300 rounded-lg text-stone-800 focus:outline-none focus:ring-1 focus:ring-purple-500 max-w-[200px]"
                            >
                              {scriptwriterPrompts.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} {p.badge ? `(${p.badge})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          <button
                            type="button"
                            onClick={() => setShowCustomIdeaForm(!showCustomIdeaForm)}
                            className="px-3 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                            title="Написать сценарий по своей кастомной теме"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{showCustomIdeaForm ? 'Скрыть кастомную тему' : 'Своя тема для сценария'}</span>
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setSubView('ideas')}
                            className="px-3 py-1.5 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                            title="Выбрать тему из банка идей для написания нового сценария"
                          >
                            <Lightbulb className="w-3.5 h-3.5 text-stone-500" />
                            <span>Банк идей (Этап 1)</span>
                          </button>
                        </div>
                      </div>

                      {/* Custom Idea Generation Form for Stage 2 */}
                      {showCustomIdeaForm && (
                        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-purple-200 shadow-2xs space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                              Своя тема / кастомный угол для сценария
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowCustomIdeaForm(false)}
                              className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer"
                            >
                              ✕ Скрыть
                            </button>
                          </div>
                          <p className="text-xs text-stone-500">
                            Введите свою тему или тезис. Gemini напишет покадровый сценарий с выбранным шаблоном «{scriptwriterPrompts.find((p) => p.id === selectedStage2Prompt)?.name || 'Покадровый сценарист'}».
                          </p>
                          <textarea
                            value={customIdeaInput}
                            onChange={(e) => setCustomIdeaInput(e.target.value)}
                            placeholder="Например: Сфокусируйся на мифе о 'хорошей девочке' и разбери стыд за проявление границ..."
                            rows={3}
                            className="w-full text-xs p-3 bg-stone-50 border border-stone-300 rounded-xl text-stone-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition"
                          />
                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={!customIdeaInput.trim() || generatingIdeaId === 'custom' || isBusy}
                              onClick={() => handleGenerateScriptForIdea('Кастомная тема', customIdeaInput, 'custom')}
                              className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                              title="Сгенерировать сценарий по заданной теме"
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
                      <div className="flex justify-center items-center gap-2 pt-1 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setSubView('ideas')}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Lightbulb className="w-3.5 h-3.5" />
                          <span>Открыть банк идей</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={handleRequestRunStage2}
                          className="px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                          <span>Сгенерировать сценарий по видео целиком</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCustomIdeaForm(!showCustomIdeaForm)}
                          className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5 border border-stone-200 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{showCustomIdeaForm ? 'Скрыть кастомную тему' : 'Своя тема для сценария'}</span>
                        </button>
                      </div>

                      {/* Custom Idea Form in empty state */}
                      {showCustomIdeaForm && (
                        <div className="bg-stone-50 p-4 sm:p-5 rounded-xl border border-purple-200 shadow-2xs space-y-3 text-left mt-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                              Своя тема / кастомный угол для сценария
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowCustomIdeaForm(false)}
                              className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer"
                            >
                              ✕ Закрыть
                            </button>
                          </div>
                          <p className="text-xs text-stone-500">
                            Введите свою тему или гипотезу, чтобы Gemini создал покадровый сценарий на её основе.
                          </p>
                          <textarea
                            value={customIdeaInput}
                            onChange={(e) => setCustomIdeaInput(e.target.value)}
                            placeholder="Например: Сфокусируйся на мифе о 'хорошей девочке' и разбери стыд за проявление границ..."
                            rows={3}
                            className="w-full text-xs p-3 bg-white border border-stone-300 rounded-xl text-stone-800 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition"
                          />
                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={!customIdeaInput.trim() || generatingIdeaId === 'custom' || isBusy}
                              onClick={() => handleGenerateScriptForIdea('Кастомная тема', customIdeaInput, 'custom')}
                              className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
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
                  )}
                </div>
              )}

              {/* SUBVIEW 3: PROMPT RUNS HISTORY */}
              {subView === 'history' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-stone-200 flex-wrap">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-amber-600" />
                      <span className="text-xs font-semibold text-stone-800">
                        История прогонов {activeVideo.promptRuns && activeVideo.promptRuns.length > 0 ? `(${activeVideo.promptRuns.length})` : ''}
                      </span>
                    </div>
                    <span className="text-[11px] text-stone-500">
                      Каждый запуск Этапа 1 или 2 сохраняется в истории. Вы можете переключать текущую версию.
                    </span>
                  </div>

                  {activeVideo.promptRuns && activeVideo.promptRuns.length > 0 ? (
                    <div className="space-y-3">
                      {[...activeVideo.promptRuns]
                        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                        .map((run) => {
                          const isExpanded = expandedRunIds.has(run.id);
                          const isSettingThis = isSettingCurrentRun === run.id;
                          const isDeletingThis = isDeletingRun === run.id;

                          return (
                            <div
                              key={run.id}
                              id={`prompt-run-${run.id}`}
                              className={`bg-white rounded-2xl border transition ${
                                run.isCurrent
                                  ? 'border-indigo-400/80 shadow-xs ring-1 ring-indigo-400/30'
                                  : 'border-stone-200 hover:border-stone-300'
                              } p-4 space-y-3`}
                            >
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <PromptStatusBadge run={run} />
                                  <span className="text-[11px] font-medium text-stone-500">
                                    {new Date(run.timestamp).toLocaleString('ru-RU', {
                                      day: 'numeric',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                    })}
                                  </span>
                                  {run.isCurrent && (
                                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-[10px]">
                                      ★ Текущая версия
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {!run.isCurrent && (
                                    <button
                                      type="button"
                                      disabled={isSettingThis || isDeletingThis}
                                      onClick={() => handleSetCurrentRun(run.id)}
                                      className="px-2.5 py-1 bg-stone-100 hover:bg-indigo-50 hover:text-indigo-700 text-stone-700 text-xs font-semibold rounded-lg border border-stone-200 transition inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                                      title="Сделать результат этого прогона активным на карточке и во вкладках видео"
                                    >
                                      {isSettingThis ? (
                                        <Loader2 className="w-3 h-3 animate-spin text-indigo-600" />
                                      ) : (
                                        <Check className="w-3 h-3 text-stone-600" />
                                      )}
                                      <span>{isSettingThis ? 'Применяем...' : 'Сделать текущим'}</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => toggleRunExpanded(run.id)}
                                    className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-600 transition cursor-pointer"
                                    title={isExpanded ? 'Свернуть' : 'Развернуть детали'}
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4" />
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    disabled={isDeletingThis || run.isCurrent}
                                    onClick={() => handleDeleteRun(run.id)}
                                    className="p-1.5 hover:bg-rose-50 text-stone-400 hover:text-rose-600 rounded-lg transition disabled:opacity-30 cursor-pointer"
                                    title={run.isCurrent ? 'Нельзя удалить активную версию (сначала переключитесь на другую)' : 'Удалить этот прогон из истории'}
                                  >
                                    {isDeletingThis ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* Details preview or expanded view */}
                              {run.error ? (
                                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                                  <span className="font-bold block text-rose-900 mb-0.5">Ошибка при выполнении:</span>
                                  <p>{run.error}</p>
                                </div>
                              ) : null}

                              {isExpanded ? (
                                <div className="space-y-3 pt-2 border-t border-stone-100">
                                  {run.stage === 1 && run.ideas && run.ideas.length > 0 && (
                                    <div className="space-y-2">
                                      <span className="text-xs font-semibold text-stone-700 block">
                                        Сгенерированные идеи ({run.ideas.length}):
                                      </span>
                                      <div className="grid grid-cols-1 gap-2">
                                        {run.ideas.map((idea, idx) => {
                                          const parsedVir = parseViralityScoreAndReason(idea.virality);
                                          const score = parsedVir?.score || (idea.virality ? idea.virality.replace(/^🔥\s*/, '') : undefined);
                                          const reason = parsedVir?.reason;

                                          return (
                                            <div key={idx} className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-1.5">
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="space-y-0.5">
                                                  <span className="font-bold text-stone-900 block">#{idea.number || idx + 1} {idea.title}</span>
                                                  {reason && (
                                                    <p className="text-[11px] text-stone-600 leading-relaxed">
                                                      <span className="font-medium text-stone-700">Обоснование: </span>{reason}
                                                    </p>
                                                  )}
                                                </div>
                                                {score && (
                                                  <span className="text-[10px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 font-bold shrink-0 whitespace-nowrap inline-flex items-center gap-1">
                                                    <Flame className="w-3 h-3 text-amber-500 fill-amber-500" />
                                                    <span>{score}</span>
                                                  </span>
                                                )}
                                              </div>
                                              {idea.hook && <p className="italic text-stone-700 bg-white/70 p-2 rounded border border-stone-200/60">«{idea.hook}»</p>}
                                              {idea.coreInsight && <p className="text-stone-600"><strong className="text-stone-700 font-medium">Суть:</strong> {idea.coreInsight}</p>}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {run.result && (
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-stone-700">
                                          Полный ответ модели:
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleCopy(run.result || '')}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg transition"
                                        >
                                          {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                          <span>Копировать</span>
                                        </button>
                                      </div>
                                      <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-800 whitespace-pre-wrap font-sans max-h-96 overflow-y-auto leading-relaxed">
                                        {run.result}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-xs text-stone-500 flex items-center justify-between">
                                  <span>
                                    {run.stage === 1
                                      ? run.ideas && run.ideas.length > 0
                                        ? `Найдено идей: ${run.ideas.length}`
                                        : run.rejectionReason
                                          ? `Отклонено: ${run.rejectionReason.slice(0, 70)}...`
                                          : 'Этап 1 завершен'
                                      : run.scripts && run.scripts.length > 0
                                        ? `Сценариев: ${run.scripts.length}`
                                        : 'Этап 2 завершен'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleRunExpanded(run.id)}
                                    className="text-indigo-600 hover:underline text-[11px] font-medium cursor-pointer"
                                  >
                                    Показать подробности
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="py-12 text-center bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
                      <History className="w-8 h-8 text-stone-400 mx-auto" />
                      <h4 className="text-sm font-semibold text-stone-800">История прогонов пуста</h4>
                      <p className="text-xs text-stone-500 max-w-sm mx-auto">
                        При каждом запуске Этапа 1 (Банк идей) или Этапа 2 (Сценарии) с любым выбранным промптом здесь будет сохраняться полная история с возможностью переключения текущей версии.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* SUBVIEW 4: RAW GEMINI OUTPUT */}
              {subView === 'raw_filter' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                    <span className="text-xs font-medium text-stone-500">
                      Сырой вывод Gemini (модель 2.5 Flash)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(activeVideo.geminiResult || '')}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 rounded-lg transition"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>Копировать</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl p-5 sm:p-6 border border-stone-200 shadow-xs text-sm text-stone-800 leading-relaxed whitespace-pre-wrap font-sans">
                    {activeVideo.geminiResult || 'Результат отсутствует.'}
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
                    onClick={() => handleCopy(activeVideo.transcript || '')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 rounded-lg transition"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>Копировать весь текст</span>
                  </button>
                  <button
                    onClick={() => handleDownload(activeVideo.transcript || '', `${activeVideo.title.slice(0, 30)}-transcript.txt`)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 rounded-lg transition"
                  >
                    <Download className="w-3 h-3" />
                    <span>.txt</span>
                  </button>
                </div>
              </div>

              {/* Transcript Display */}
              {activeVideo.transcript ? (
                activeVideo.transcriptSegments && activeVideo.transcriptSegments.length > 0 ? (
                  <div className="space-y-2 bg-white rounded-2xl p-4 border border-stone-200 shadow-2xs divide-y divide-stone-100">
                    {filteredSegments && filteredSegments.length > 0 ? (
                      filteredSegments.map((segment, idx) => (
                        <div key={idx} className="pt-2 first:pt-0 flex items-start gap-3 text-xs leading-relaxed hover:bg-stone-50 p-1.5 rounded-lg transition">
                          <a
                            href={`${activeVideo.url}&t=${segment.offset}s`}
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
                    {activeVideo.transcript}
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
      <ConfirmPaidActionModal {...paidModalState} onClose={closePaidModal} />
    </div>
  );
};
