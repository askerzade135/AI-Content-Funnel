import React, { useState, useEffect } from 'react';
import { 
  X, Sparkles, Send, Copy, Download, Trash2, Check, AlertCircle, 
  Loader2, RefreshCw, MessageCircle, Youtube, CheckSquare, Square, 
  ChevronRight, ExternalLink, Sliders, ChevronDown, ChevronUp, RotateCcw,
  AlertTriangle, ShieldCheck, Eye, EyeOff, Layers, Search
} from 'lucide-react';
import { StoredVideo, GeneratedScript, TelegramStatus, PromptTemplateDef } from '../types';
import { PROMPT_TEMPLATES, PROMPT_DEFINITIONS, fetchPromptDefinitions } from '../prompts';
import { checkIfFilteredOut, extractFilterRejectionReason } from '../utils/filterCheck';

interface ScriptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  videos: StoredVideo[];
  preselectedVideoIds?: string[];
  onOpenPromptsModal?: () => void;
}

export const ScriptsModal: React.FC<ScriptsModalProps> = ({
  isOpen,
  onClose,
  videos,
  preselectedVideoIds = [],
  onOpenPromptsModal,
}) => {
  const [activeTab, setActiveTab] = useState<'generator' | 'history' | 'telegram'>('generator');
  
  // Selection & Prompt
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<PromptTemplateDef[]>(PROMPT_DEFINITIONS);
  const [stageFilterMode, setStageFilterMode] = useState<'all_stages' | 'single_filter' | 'single_scriptwriter' | 'all_prompts'>('all_stages');
  const [promptTemplate, setPromptTemplate] = useState<string>('filter_screener');
  const [editablePrompt, setEditablePrompt] = useState<string>(PROMPT_TEMPLATES.filter_screener || '');
  const [isPromptExpanded, setIsPromptExpanded] = useState<boolean>(false);
  const [skipTelegramIfNotMatched, setSkipTelegramIfNotMatched] = useState<boolean>(true);
  const [sendDirectlyToTg, setSendDirectlyToTg] = useState<boolean>(true);
  const [customChatId, setCustomChatId] = useState<string>('');

  // Prompt history preview in History tab
  const [expandedPromptScriptId, setExpandedPromptScriptId] = useState<string | null>(null);

  // Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [currentResult, setCurrentResult] = useState<GeneratedScript | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // History state
  const [scriptsList, setScriptsList] = useState<GeneratedScript[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingTgId, setSendingTgId] = useState<string | null>(null);
  const [tgSendSuccessId, setTgSendSuccessId] = useState<string | null>(null);

  // Telegram status
  const [tgStatus, setTgStatus] = useState<TelegramStatus | null>(null);
  const [isCheckingTg, setIsCheckingTg] = useState<boolean>(false);
  const [tgTestMessage, setTgTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Initialize selected videos
  useEffect(() => {
    if (isOpen) {
      if (preselectedVideoIds && preselectedVideoIds.length > 0) {
        setSelectedVideoIds(preselectedVideoIds);
      } else if (selectedVideoIds.length === 0 && videos.length > 0) {
        // By default select the first available transcribed video
        const firstTranscribed = videos.find((v) => v.status === 'completed' || v.status === 'transcribed');
        if (firstTranscribed) {
          setSelectedVideoIds([firstTranscribed.id]);
        }
      }
      fetchScripts();
      fetchTelegramStatus();
      fetchPromptDefinitions()
        .then((defs) => {
          setAvailableTemplates(defs);
          const currentDef = defs.find((d) => d.id === promptTemplate);
          if (currentDef && !isPromptModified) {
            setEditablePrompt(currentDef.text);
          }
        })
        .catch(console.error);
    }
  }, [isOpen, preselectedVideoIds, videos]);

  const fetchScripts = async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch('/api/scripts');
      if (res.ok) {
        const data = await res.json();
        setScriptsList(data);
      }
    } catch (err) {
      console.error('Failed to fetch scripts:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const fetchTelegramStatus = async () => {
    setIsCheckingTg(true);
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const data = await res.json();
        setTgStatus(data);
        if (data.defaultChatId && !customChatId) {
          setCustomChatId(data.defaultChatId);
        }
      }
    } catch (err) {
      console.error('Failed to fetch telegram status:', err);
    } finally {
      setIsCheckingTg(false);
    }
  };

  const handleTestTelegram = async () => {
    setIsCheckingTg(true);
    setTgTestMessage(null);
    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: customChatId }),
      });
      const data = await res.json();
      if (data.ok) {
        setTgTestMessage({
          type: 'success',
          text: `Связь установлена! Бот: @${data.bot?.username || 'Бот'}, чат/канал: ${data.chat?.title || customChatId || 'не указан'}`,
        });
      } else {
        setTgTestMessage({
          type: 'error',
          text: data.error || 'Ошибка подключения к Telegram',
        });
      }
    } catch (err: any) {
      setTgTestMessage({
        type: 'error',
        text: err.message,
      });
    } finally {
      setIsCheckingTg(false);
    }
  };

  const activeTemplateDef = availableTemplates.find((t) => t.id === promptTemplate);
  const baselineTemplateText = activeTemplateDef ? activeTemplateDef.text : PROMPT_TEMPLATES[promptTemplate] || '';

  const handleSelectTemplate = (templateId: string) => {
    setPromptTemplate(templateId);
    if (templateId === 'custom') {
      setIsPromptExpanded(true);
    } else {
      const found = availableTemplates.find((t) => t.id === templateId);
      if (found) {
        setEditablePrompt(found.text);
      } else if (PROMPT_TEMPLATES[templateId]) {
        setEditablePrompt(PROMPT_TEMPLATES[templateId]);
      }
    }
  };

  const handleResetPrompt = () => {
    if (baselineTemplateText) {
      setEditablePrompt(baselineTemplateText);
    }
  };

  const isPromptModified = 
    promptTemplate !== 'custom' && 
    Boolean(baselineTemplateText) && 
    editablePrompt !== baselineTemplateText;

  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false);
  const [savedToLibrarySuccess, setSavedToLibrarySuccess] = useState(false);

  const handleSaveToLibrary = async () => {
    if (!editablePrompt.trim()) return;
    const isNew = promptTemplate === 'custom';
    const suggestedName = isNew 
      ? 'Мой шаблон сценария' 
      : (activeTemplateDef?.name ? `${activeTemplateDef.name} (обновленный)` : 'Шаблон');
    
    const promptName = window.prompt('Название шаблона в Библиотеке промптов:', suggestedName);
    if (!promptName || !promptName.trim()) return;

    setIsSavingToLibrary(true);
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: isNew ? undefined : (activeTemplateDef?.id || undefined),
          name: promptName.trim(),
          badge: isNew ? 'Свой шаблон' : (activeTemplateDef?.badge || 'Свой'),
          description: activeTemplateDef?.description || 'Сохранено из генератора сценариев',
          text: editablePrompt.trim(),
        }),
      });

      if (!res.ok) throw new Error('Ошибка сохранения промпта');
      const saved: PromptTemplateDef = await res.json();
      const updated = await fetchPromptDefinitions();
      setAvailableTemplates(updated);
      setPromptTemplate(saved.id);
      setSavedToLibrarySuccess(true);
      setTimeout(() => setSavedToLibrarySuccess(false), 2500);
    } catch (err: any) {
      alert(err.message || 'Не удалось сохранить промпт');
    } finally {
      setIsSavingToLibrary(false);
    }
  };

  const handleGenerate = async () => {
    if (selectedVideoIds.length === 0) {
      setGenError('Выберите хотя бы одно видео для анализа');
      return;
    }

    setIsGenerating(true);
    setGenError(null);
    setCurrentResult(null);

    try {
      const res = await fetch('/api/scripts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoIds: selectedVideoIds,
          promptTemplate,
          customPrompt: editablePrompt,
          sendToTelegram: sendDirectlyToTg,
          telegramChatId: customChatId || undefined,
          skipTelegramIfNotMatched,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка при генерации сценария');

      setCurrentResult(data.script);
      setScriptsList((prev) => [data.script, ...prev.filter((s) => s.id !== data.script.id)]);
      
      if (sendDirectlyToTg && data.telegramResult?.ok) {
        setTgSendSuccessId(data.script.id);
        setTimeout(() => setTgSendSuccessId(null), 4000);
      }
    } catch (err: any) {
      setGenError(err.message || 'Ошибка генерации сценария');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendToTelegram = async (script: GeneratedScript) => {
    setSendingTgId(script.id);
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: script.content,
          header: `🎬 *${script.title}*\n📅 ${new Date().toLocaleDateString('ru-RU')}`,
          chatId: customChatId || undefined,
          scriptId: script.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Ошибка отправки в Telegram');

      setTgSendSuccessId(script.id);
      setTimeout(() => setTgSendSuccessId(null), 3000);
      
      // Update local item
      setScriptsList((prev) =>
        prev.map((s) =>
          s.id === script.id ? { ...s, telegramSent: true, telegramSentAt: new Date().toISOString() } : s
        )
      );
      if (currentResult && currentResult.id === script.id) {
        setCurrentResult((prev) => prev ? { ...prev, telegramSent: true } : null);
      }
    } catch (err: any) {
      alert(`Ошибка отправки: ${err.message}`);
    } finally {
      setSendingTgId(null);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownload = (text: string, title: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[/\\?%*:|"<>]/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDeleteScript = async (id: string) => {
    if (!confirm('Удалить этот сценарий из истории?')) return;
    try {
      await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
      setScriptsList((prev) => prev.filter((s) => s.id !== id));
      if (currentResult?.id === id) setCurrentResult(null);
    } catch (err) {
      console.error('Error deleting script:', err);
    }
  };

  const toggleVideoSelection = (id: string) => {
    setSelectedVideoIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  if (!isOpen) return null;

  return (
    <div id="scripts-modal" onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-xs">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 text-white flex items-center justify-center shadow-sm">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-stone-900">
                  Сценарии & Telegram
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-50 text-sky-700 border border-sky-200 flex items-center gap-1">
                  <Send className="w-2.5 h-2.5" />
                  Instagram + TG
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Подбор сценариев из транскриптов и прямая публикация в Telegram-канал
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tabs */}
            <div className="flex items-center bg-stone-200/70 p-1 rounded-lg text-xs font-medium text-stone-600">
              <button
                type="button"
                onClick={() => setActiveTab('generator')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  activeTab === 'generator' ? 'bg-white text-stone-900 shadow-xs' : 'hover:text-stone-900'
                }`}
              >
                Генератор
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  activeTab === 'history' ? 'bg-white text-stone-900 shadow-xs' : 'hover:text-stone-900'
                }`}
              >
                История
                {scriptsList.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-stone-100 text-stone-700 font-semibold">
                    {scriptsList.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('telegram')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'telegram' ? 'bg-white text-stone-900 shadow-xs' : 'hover:text-stone-900'
                }`}
              >
                Статус Telegram
                {tgStatus?.isConfigured && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                )}
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          {/* TAB 1: GENERATOR */}
          {activeTab === 'generator' && (
            <div className="space-y-6">
              {/* Step 1: Select Videos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Youtube className="w-4 h-4 text-red-600" />
                    1. Выберите видео для анализа ({selectedVideoIds.length} выбрано)
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedVideoIds(videos.map((v) => v.id))}
                      className="text-indigo-600 hover:underline"
                    >
                      Выбрать все ({videos.length})
                    </button>
                    <span className="text-stone-300">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedVideoIds([])}
                      className="text-stone-500 hover:underline"
                    >
                      Сбросить
                    </button>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto border border-stone-200 rounded-xl divide-y divide-stone-100 bg-stone-50/40">
                  {videos.length === 0 ? (
                    <div className="p-4 text-center text-xs text-stone-500">
                      Список видео пуст. Сначала добавьте каналы или видео.
                    </div>
                  ) : (
                    videos.map((video) => {
                      const isSelected = selectedVideoIds.includes(video.id);
                      return (
                        <div
                          key={video.id}
                          onClick={() => toggleVideoSelection(video.id)}
                          className={`p-3 flex items-center gap-3 cursor-pointer transition-colors ${
                            isSelected ? 'bg-indigo-50/60' : 'hover:bg-stone-50'
                          }`}
                        >
                          <button type="button" className="text-stone-400 hover:text-stone-600 shrink-0">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-indigo-600" />
                            ) : (
                              <Square className="w-4 h-4 text-stone-300" />
                            )}
                          </button>
                          <img
                            src={video.thumbnail}
                            alt=""
                            className="w-12 h-8 object-cover rounded shrink-0 border border-stone-200"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-xs font-medium text-stone-900 truncate">
                                {video.title}
                              </h4>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {(() => {
                                  const count = scriptsList.filter((s) => s.videoIds?.includes(video.id)).length;
                                  const isRejected = video.matchedFilter === false || checkIfFilteredOut(video.geminiResult);

                                  return (
                                    <>
                                      {count > 0 && (
                                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-semibold border border-indigo-200" title="Количество созданных сценариев">
                                          {count} {count === 1 ? 'сценарий' : 'сценария'}
                                        </span>
                                      )}
                                      {isRejected && (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-semibold border border-amber-200" title="Отклонено фильтром аккаунта">
                                          Отклонено фильтром
                                        </span>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-stone-500 mt-0.5">
                              <span>{video.channelTitle}</span>
                              <span>•</span>
                              <span>
                                {video.transcript ? `Транскрипт готов (${video.transcript.length} симв.)` : 'Транскрипт будет создан автоматически'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Step 2: Prompt Template */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider flex items-center gap-1.5">
                    <span>2. Выберите режим и шаблон промпта</span>
                    <span className="text-[10px] text-stone-400 font-normal">({availableTemplates.length} в библиотеке)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    {onOpenPromptsModal && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenPromptsModal();
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 transition"
                        title="Настроить дефолтные промпты этапов в настройках"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Настройка дефолтных промптов
                      </button>
                    )}
                  </div>
                </div>

                {/* Stage Filter Switcher (All stages vs Single stage) */}
                <div className="flex items-center gap-1.5 p-1 bg-stone-100 rounded-xl mb-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setStageFilterMode('all_stages');
                      handleSelectTemplate('instagram_editor');
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      stageFilterMode === 'all_stages'
                        ? 'bg-white text-indigo-700 shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                    }`}
                  >
                    <span>⚡ Все этапы (1 Фильтр ➔ 2 Сценарист)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStageFilterMode('single_filter');
                      handleSelectTemplate('filter_screener');
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      stageFilterMode === 'single_filter'
                        ? 'bg-white text-blue-700 shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                    }`}
                  >
                    <span>🔍 Один этап: Этап 1 (Фильтр и банк идей)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStageFilterMode('single_scriptwriter');
                      handleSelectTemplate('reels_scenario');
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      stageFilterMode === 'single_scriptwriter'
                        ? 'bg-white text-purple-700 shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                    }`}
                  >
                    <span>🎬 Один этап: Этап 2 (Сценарист)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStageFilterMode('all_prompts')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      stageFilterMode === 'all_prompts'
                        ? 'bg-white text-stone-900 shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                    }`}
                  >
                    <span>📑 Все шаблоны</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-3 max-h-60 overflow-y-auto pr-1">
                  {availableTemplates
                    .filter((template) => {
                      if (stageFilterMode === 'single_filter') {
                        return template.id === 'filter_screener' || template.badge?.includes('Этап 1') || template.badge?.includes('Фильтр');
                      }
                      if (stageFilterMode === 'single_scriptwriter') {
                        return template.id !== 'filter_screener' && !template.badge?.includes('Этап 1');
                      }
                      if (stageFilterMode === 'all_stages') {
                        return template.id === 'instagram_editor' || template.id === 'reels_scenario' || template.badge?.includes('2 этапа') || template.badge?.includes('Пайплайн');
                      }
                      return true;
                    })
                    .map((template) => {
                    const isSelected = promptTemplate === template.id;
                    return (
                      <div
                        key={template.id}
                        onClick={() => handleSelectTemplate(template.id)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-500/20 shadow-xs'
                            : 'border-stone-200 hover:border-stone-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-stone-900 truncate pr-1 flex items-center gap-1.5">
                            {template.id === 'filter_screener' ? (
                              <Search className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            ) : template.id === 'instagram_editor' ? (
                              <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            ) : template.id === 'reels_scenario' ? (
                              <MessageCircle className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                            ) : (
                              <Layers className="w-3.5 h-3.5 text-stone-500 shrink-0" />
                            )}
                            <span className="truncate">{template.name}</span>
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {template.badge && (
                              <span className="text-[9px] font-medium bg-stone-100 text-stone-600 px-1 py-0.5 rounded">
                                {template.badge}
                              </span>
                            )}
                            {isSelected && <span className="w-2 h-2 rounded-full bg-indigo-600" />}
                          </div>
                        </div>
                        <p className="text-[11px] text-stone-500 line-clamp-2 leading-relaxed">
                          {template.description || template.text.slice(0, 100) + '...'}
                        </p>
                      </div>
                    );
                  })}

                  {/* Custom prompt card */}
                  <div
                    onClick={() => handleSelectTemplate('custom')}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      promptTemplate === 'custom'
                        ? 'border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-500/20 shadow-xs'
                        : 'border-stone-200 hover:border-stone-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-stone-900 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-stone-600" />
                        Свой разовый промпт
                      </span>
                      {promptTemplate === 'custom' && <span className="w-2 h-2 rounded-full bg-indigo-600" />}
                    </div>
                    <p className="text-[11px] text-stone-500 line-clamp-2 leading-relaxed">
                      Напишите индивидуальную инструкцию или разовые критерии подбора.
                    </p>
                  </div>
                </div>

                {/* Expandable Prompt Inspector & Editor */}
                <div className="border border-stone-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 bg-stone-50 hover:bg-stone-100 transition text-left"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Sliders className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="text-xs font-semibold text-stone-800">
                        Посмотреть и редактировать полный текст промпта
                      </span>
                      <span className="text-[11px] text-stone-400 font-mono">
                        ({editablePrompt.length} симв.)
                      </span>
                      {isPromptModified && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-semibold">
                          Изменено вручную
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-stone-500 font-medium shrink-0">
                      <span>{isPromptExpanded ? 'Свернуть' : 'Раскрыть промпт'}</span>
                      {isPromptExpanded ? (
                        <ChevronUp className="w-4 h-4 text-stone-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-stone-500" />
                      )}
                    </div>
                  </button>

                  {isPromptExpanded && (
                    <div className="p-3.5 border-t border-stone-200 bg-stone-50/60 space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] text-stone-600 flex-wrap gap-2">
                        <span>Вы можете отредактировать любые критерии, правила или добавить свои темы:</span>
                        <div className="flex items-center gap-3 flex-wrap">
                          {isPromptModified && (
                            <button
                              type="button"
                              onClick={handleResetPrompt}
                              className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium hover:underline"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Сбросить к исходному
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleSaveToLibrary}
                            disabled={isSavingToLibrary}
                            className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium hover:underline disabled:opacity-50"
                            title="Сохранить отредактированный текст как шаблон в библиотеку"
                          >
                            {savedToLibrarySuccess ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span className="text-emerald-600 font-semibold">Сохранено в библиотеку!</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3 text-indigo-600" />
                                <span>Сохранить в Библиотеку</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy(editablePrompt, 'prompt-editor')}
                            className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1"
                          >
                            {copiedId === 'prompt-editor' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            {copiedId === 'prompt-editor' ? 'Скопировано' : 'Копировать'}
                          </button>
                        </div>
                      </div>

                      <textarea
                        value={editablePrompt}
                        onChange={(e) => setEditablePrompt(e.target.value)}
                        rows={10}
                        placeholder="Текст промпта для Gemini..."
                        className="w-full text-xs font-mono p-3 bg-white border border-stone-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed shadow-inner"
                      />

                      <div className="flex items-center justify-between text-[11px] text-stone-400">
                        <span>Gemini получит именно эту отредактированную инструкцию.</span>
                        <span className="font-mono">{editablePrompt.length} символов</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 3: Telegram Target & Options */}
              <div className="bg-stone-50 p-4 rounded-xl border border-stone-200 space-y-3">
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">
                  3. Опции отправки в Telegram
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">
                      Целевой канал / Чат ID:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={customChatId}
                        onChange={(e) => setCustomChatId(e.target.value)}
                        placeholder="@my_channel или -10012345678"
                        className="flex-1 px-3 py-1.5 text-xs bg-white border border-stone-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={handleTestTelegram}
                        disabled={isCheckingTg}
                        className="px-2.5 py-1.5 text-xs bg-stone-200 hover:bg-stone-300 text-stone-700 rounded-lg transition-colors shrink-0 flex items-center gap-1"
                        title="Проверить доступность бота и канала"
                      >
                        {isCheckingTg ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Тест
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-4 sm:pt-0">
                    <label className="flex items-center gap-2 text-xs text-stone-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sendDirectlyToTg}
                        onChange={(e) => setSendDirectlyToTg(e.target.checked)}
                        className="rounded border-stone-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Сразу отправить результат в Telegram</span>
                    </label>
                  </div>
                </div>

                {/* Filter Skip Checkbox */}
                <div className="pt-2 border-t border-stone-200">
                  <label className="flex items-start gap-2 text-xs text-stone-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipTelegramIfNotMatched}
                      onChange={(e) => setSkipTelegramIfNotMatched(e.target.checked)}
                      className="rounded border-stone-300 text-indigo-600 focus:ring-indigo-500 mt-0.5"
                    />
                    <div>
                      <span className="font-semibold text-stone-900">
                        Не публиковать в Telegram, если видео не подошло под фильтр темы
                      </span>
                      <p className="text-[11px] text-stone-500 mt-0.5">
                        Защита канала от мусора: если видео отклонено Gemini (сработало правило «не натягивать тему»), отправка в канал пропускается.
                      </p>
                    </div>
                  </label>
                </div>

                {tgTestMessage && (
                  <div
                    className={`mt-3 p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                      tgTestMessage.type === 'success'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-red-50 text-red-800 border border-red-200'
                    }`}
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{tgTestMessage.text}</span>
                  </div>
                )}
              </div>

              {/* Action Button */}
              {genError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{genError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating || selectedVideoIds.length === 0}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 text-white font-medium text-xs hover:from-indigo-700 hover:to-sky-700 transition-all shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Gemini анализирует транскрипты...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Сгенерировать сценарий
                      {sendDirectlyToTg && <Send className="w-3.5 h-3.5 ml-1" />}
                    </>
                  )}
                </button>
              </div>

              {/* Real-time Generated Result Display */}
              {currentResult && (
                <div className="mt-6 border border-stone-200 rounded-2xl overflow-hidden bg-stone-50">
                  <div className="p-4 bg-stone-100 border-b border-stone-200 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-stone-900">
                          {currentResult.title}
                        </h3>
                        {currentResult.matchedFilter === false || checkIfFilteredOut(currentResult.content) ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                            Отклонено фильтром
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                            <Check className="w-2.5 h-2.5 text-emerald-600" />
                            Соответствует теме
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-stone-500 mt-0.5">
                        Сгенерировано только что • Шаблон: {currentResult.promptTemplate}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(currentResult.content, currentResult.id)}
                        className="px-2.5 py-1.5 text-xs bg-white hover:bg-stone-50 border border-stone-300 text-stone-700 rounded-lg flex items-center gap-1"
                      >
                        {copiedId === currentResult.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedId === currentResult.id ? 'Скопировано' : 'Копировать'}
                      </button>

                      <button
                        onClick={() => handleDownload(currentResult.content, currentResult.title)}
                        className="px-2.5 py-1.5 text-xs bg-white hover:bg-stone-50 border border-stone-300 text-stone-700 rounded-lg flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Скачать
                      </button>

                      <button
                        onClick={() => handleSendToTelegram(currentResult)}
                        disabled={sendingTgId === currentResult.id}
                        className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg flex items-center gap-1.5 shadow-xs"
                      >
                        {sendingTgId === currentResult.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : tgSendSuccessId === currentResult.id ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                        {tgSendSuccessId === currentResult.id ? 'Отправлено в TG!' : 'В Telegram'}
                      </button>
                    </div>
                  </div>

                  {/* Filter Rejection Banner */}
                  {(currentResult.matchedFilter === false || checkIfFilteredOut(currentResult.content)) && (() => {
                    const specificReason = extractFilterRejectionReason(currentResult.content);
                    return (
                      <div className="p-3.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-900 leading-relaxed">
                          <span className="font-bold block mb-0.5">⚠️ Видео отклонено фильтром аккаунта</span>
                          {specificReason ? (
                            <p className="mt-0.5">
                              <strong>Причина: </strong>
                              <span>{specificReason}</span>
                            </p>
                          ) : (
                            <p className="mt-0.5">
                              Gemini отклонил материал: видео не соответствует критериям фильтра ниши или аккаунта.
                            </p>
                          )}
                          {skipTelegramIfNotMatched && (
                            <span className="block mt-1.5 text-[11px] font-semibold text-emerald-800">
                              ✓ Публикация в Telegram была отменена для защиты вашего канала от спама.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="p-5 text-xs text-stone-800 whitespace-pre-wrap font-sans leading-relaxed max-h-96 overflow-y-auto bg-white">
                    {currentResult.content}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                <h3 className="text-xs font-semibold text-stone-700 uppercase tracking-wider">
                  Сохранённые сценарии ({scriptsList.length})
                </h3>
                <button
                  type="button"
                  onClick={fetchScripts}
                  className="text-xs text-stone-500 hover:text-stone-800 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Обновить
                </button>
              </div>

              {isLoadingHistory ? (
                <div className="py-12 text-center text-stone-400 flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-stone-500" />
                  <span className="text-xs">Загрузка истории...</span>
                </div>
              ) : scriptsList.length === 0 ? (
                <div className="py-12 text-center text-stone-400">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 text-stone-300" />
                  <p className="text-xs">Пока нет созданных сценариев.</p>
                  <button
                    onClick={() => setActiveTab('generator')}
                    className="mt-3 text-xs text-indigo-600 hover:underline"
                  >
                    Перейти к генератору
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {scriptsList.map((script) => {
                    const isFiltered = 
                      script.matchedFilter === false || checkIfFilteredOut(script.content);

                    return (
                      <div
                        key={script.id}
                        className="border border-stone-200 rounded-xl overflow-hidden bg-white shadow-xs"
                      >
                        <div className="p-4 bg-stone-50 border-b border-stone-100 flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h4 className="text-xs font-semibold text-stone-900 truncate">
                                {script.title}
                              </h4>
                              {isFiltered ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                                  <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                                  Отклонено фильтром
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                  Одобрено
                                </span>
                              )}
                              {script.telegramSent ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-200 flex items-center gap-1">
                                  <Send className="w-2.5 h-2.5" />
                                  В Telegram ✓
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-stone-100 text-stone-600 border border-stone-200">
                                  Черновик
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-stone-500">
                              {new Date(script.createdAt).toLocaleString('ru-RU')} • Шаблон: {script.promptTemplate}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {script.customPromptUsed && (
                              <button
                                onClick={() => setExpandedPromptScriptId(expandedPromptScriptId === script.id ? null : script.id)}
                                className={`px-2 py-1 text-xs rounded-lg border transition-colors flex items-center gap-1 ${
                                  expandedPromptScriptId === script.id
                                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                    : 'text-stone-600 hover:bg-stone-100 border-stone-200'
                                }`}
                                title="Посмотреть текст промпта"
                              >
                                <Sliders className="w-3 h-3" />
                                <span>Промпт</span>
                              </button>
                            )}

                            <button
                              onClick={() => handleCopy(script.content, script.id)}
                              className="p-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-200/60 rounded-lg transition-colors"
                              title="Копировать"
                            >
                              {copiedId === script.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>

                            <button
                              onClick={() => handleDownload(script.content, script.title)}
                              className="p-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-200/60 rounded-lg transition-colors"
                              title="Скачать .txt"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => handleSendToTelegram(script)}
                              disabled={sendingTgId === script.id}
                              className="px-2.5 py-1 text-xs bg-sky-600 hover:bg-sky-700 text-white rounded-lg flex items-center gap-1 transition-colors"
                              title="Отправить в Telegram"
                            >
                              {sendingTgId === script.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Send className="w-3 h-3" />
                              )}
                              В Telegram
                            </button>

                            <button
                              onClick={() => handleDeleteScript(script.id)}
                              className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-1"
                              title="Удалить"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Prompt inspection in history */}
                        {expandedPromptScriptId === script.id && script.customPromptUsed && (
                          <div className="p-3 bg-stone-100/70 border-b border-stone-200 text-xs font-mono text-stone-700 max-h-48 overflow-y-auto leading-relaxed">
                            <div className="text-[10px] font-sans font-semibold text-stone-500 uppercase tracking-wider mb-1">
                              Промпт, использованный для генерации:
                            </div>
                            <div className="whitespace-pre-wrap">{script.customPromptUsed}</div>
                          </div>
                        )}

                        <div className="p-4 text-xs text-stone-800 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                          {script.content}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TELEGRAM DIAGNOSTICS & SETUP */}
          {activeTab === 'telegram' && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center">
                      <Send className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-stone-900">
                        Статус подключения Telegram Bot API
                      </h4>
                      <p className="text-[11px] text-stone-500">
                        Официальный бот для публикации сценариев в Telegram-канал
                      </p>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      tgStatus?.isConfigured
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {tgStatus?.isConfigured ? 'Готов к отправке' : 'Требует настройки'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-white border border-stone-200 rounded-lg">
                    <span className="text-stone-500 block text-[11px]">TELEGRAM_BOT_TOKEN</span>
                    <span className="font-medium text-stone-900">
                      {tgStatus?.hasToken ? '✓ Задан' : '✗ Не задан'}
                    </span>
                  </div>
                  <div className="p-3 bg-white border border-stone-200 rounded-lg">
                    <span className="text-stone-500 block text-[11px]">Целевой чат/канал</span>
                    <span className="font-medium text-stone-900">
                      {tgStatus?.defaultChatId || 'Не указан'}
                    </span>
                  </div>
                </div>

                {tgStatus?.botUsername && (
                  <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-900 flex items-center gap-2">
                    <Check className="w-4 h-4 text-sky-600 shrink-0" />
                    <span>
                      Бот успешно подключен: <strong>@{tgStatus.botUsername}</strong> ({tgStatus.botFirstName})
                    </span>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleTestTelegram}
                    disabled={isCheckingTg}
                    className="w-full py-2 bg-white hover:bg-stone-100 border border-stone-300 text-stone-700 font-medium text-xs rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {isCheckingTg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Проверить соединение с ботом
                  </button>
                </div>
              </div>

              {/* Setup Guide */}
              <div className="border border-stone-200 rounded-xl p-5 space-y-3 bg-white">
                <h4 className="text-xs font-semibold text-stone-900 uppercase tracking-wider">
                  Как настроить Telegram-бота за 2 минуты:
                </h4>
                <ol className="space-y-2 text-xs text-stone-600 list-decimal list-inside leading-relaxed">
                  <li>
                    Откройте в Telegram официального бота <strong>@BotFather</strong> и отправьте команду <code className="bg-stone-100 px-1 py-0.5 rounded text-stone-800">/newbot</code>.
                  </li>
                  <li>
                    Задайте имя и юзернейм для бота (например, <em>MyContentBot</em>). BotFather пришлет вам <strong>HTTP API Token</strong>.
                  </li>
                  <li>
                    Укажите этот токен в файле <code className="bg-stone-100 px-1 py-0.5 rounded text-stone-800">.env</code> в переменную <code className="font-mono text-stone-900">TELEGRAM_BOT_TOKEN</code>.
                  </li>
                  <li>
                    Добавьте созданного бота в ваш Telegram-канал в качестве <strong>Администратора</strong> с правом «Публикация сообщений» (Post Messages).
                  </li>
                  <li>
                    Укажите юзернейм канала (например, <code className="bg-stone-100 px-1 py-0.5 rounded text-stone-800">@my_channel</code>) в поле выше или в переменную <code className="font-mono text-stone-900">TELEGRAM_CHAT_ID</code>.
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
