import React, { useState, useEffect } from 'react';
import { 
  X, Sparkles, Check, Loader2, Plus, Copy, RotateCcw, Trash2, Search, Star, 
  AlertCircle, BookOpen, FileText, Film, Lightbulb 
} from 'lucide-react';
import { PromptTemplateDef, AppSettings } from '../types';
import { ConfirmModal, ConfirmModalConfig } from './ConfirmModal';
import { authFetch } from '../services/authFetch';

interface PromptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSettings?: AppSettings | null;
  onUpdateSettings?: (settings: Partial<AppSettings>) => Promise<void>;
  onPromptsUpdated?: () => void;
}

export const PromptsModal: React.FC<PromptsModalProps> = ({
  isOpen,
  onClose,
  currentSettings,
  onUpdateSettings,
  onPromptsUpdated,
}) => {
  const [prompts, setPrompts] = useState<PromptTemplateDef[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('filter_screener');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategoryTab, setActiveCategoryTab] = useState<'all' | 'filter' | 'scriptwriter' | 'general'>('all');
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editBadge, setEditBadge] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState<'filter' | 'scriptwriter' | 'general'>('filter');
  const [editText, setEditText] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Confirmation dialog
  const [confirmConfig, setConfirmConfig] = useState<ConfirmModalConfig | null>(null);

  // Fetch prompts list
  const fetchPrompts = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await authFetch('/api/prompts');
      if (res.ok) {
        const data: PromptTemplateDef[] = await res.json();
        setPrompts(data);
        if (data.length > 0) {
          // If current selected doesn't exist, pick first
          if (!selectedPromptId || !data.some(p => p.id === selectedPromptId)) {
            setSelectedPromptId(data[0].id);
          }
        }
      } else {
        throw new Error('Не удалось загрузить список промптов');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Ошибка сети при загрузке промптов');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchPrompts();
    }
  }, [isOpen]);

  // Sync edit form with selected prompt
  useEffect(() => {
    if (isCreatingNew) return;
    const current = prompts.find((p) => p.id === selectedPromptId);
    if (current) {
      setEditName(current.name);
      setEditBadge(current.badge || '');
      setEditDescription(current.description || '');
      setEditCategory(current.category || 'general');
      setEditText(current.text);
      setErrorMessage(null);
    }
  }, [selectedPromptId, prompts, isCreatingNew]);

  if (!isOpen) return null;

  const handleStartCreateNew = (templateToClone?: PromptTemplateDef, defaultCat?: 'filter' | 'scriptwriter' | 'general') => {
    setIsCreatingNew(true);
    if (templateToClone) {
      setEditName(`${templateToClone.name} (Копия)`);
      setEditBadge(templateToClone.badge || 'Свой шаблон');
      setEditDescription(templateToClone.description || '');
      setEditCategory(templateToClone.category || 'filter');
      setEditText(templateToClone.text);
    } else {
      setEditName('');
      setEditBadge('Свой шаблон');
      setEditDescription('');
      setEditCategory(defaultCat || (activeCategoryTab !== 'all' ? activeCategoryTab : 'filter'));
      setEditText('');
    }
    setErrorMessage(null);
  };

  const handleSavePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      setErrorMessage('Укажите название промпта');
      return;
    }
    if (!editText.trim()) {
      setErrorMessage('Текст промпта не может быть пустым');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const payload = {
        id: isCreatingNew ? undefined : selectedPromptId,
        name: editName.trim(),
        badge: editBadge.trim() || 'Промпт',
        description: editDescription.trim(),
        category: editCategory,
        text: editText.trim(),
      };

      const res = await authFetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Ошибка при сохранении промпта');
      }

      const saved: PromptTemplateDef = await res.json();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);

      await fetchPrompts();
      setIsCreatingNew(false);
      setSelectedPromptId(saved.id);
      if (onPromptsUpdated) onPromptsUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Ошибка сохранения');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = (id: string, name: string) => {
    setConfirmConfig({
      isOpen: true,
      title: `Сбросить промпт «${name}» к оригиналу?`,
      description: 'Все внесённые вами изменения будут заменены стандартным текстом системного шаблона.',
      confirmText: 'Да, сбросить к оригиналу',
      cancelText: 'Отмена',
      type: 'warning',
      onConfirm: async () => {
        setIsSaving(true);
        try {
          const res = await authFetch(`/api/prompts/${id}/reset`, { method: 'POST' });
          if (!res.ok) throw new Error('Ошибка сброса шаблона');
          await fetchPrompts();
          if (onPromptsUpdated) onPromptsUpdated();
        } catch (err: any) {
          setErrorMessage(err.message);
        } finally {
          setIsSaving(false);
        }
      },
      onCancel: () => {},
    });
  };

  const handleDeletePrompt = (id: string, name: string) => {
    if (prompts.length <= 1) {
      setErrorMessage('В библиотеке должен оставаться минимум 1 промпт. Удаление невозможно.');
      return;
    }

    setConfirmConfig({
      isOpen: true,
      title: `Удалить шаблон «${name}»?`,
      description: 'Этот промпт будет безвозвратно удален из библиотеки. В системе останется ' + (prompts.length - 1) + ' промпт(ов).',
      confirmText: 'Да, удалить шаблон',
      cancelText: 'Отмена',
      type: 'danger',
      onConfirm: async () => {
        setIsSaving(true);
        try {
          const res = await authFetch(`/api/prompts/${id}`, { method: 'DELETE' });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Ошибка удаления шаблона');
          }
          await fetchPrompts();
          const remaining = prompts.filter((p) => p.id !== id);
          if (remaining.length > 0) {
            setSelectedPromptId(remaining[0].id);
          }
          if (onPromptsUpdated) onPromptsUpdated();
        } catch (err: any) {
          setErrorMessage(err.message);
        } finally {
          setIsSaving(false);
        }
      },
      onCancel: () => {},
    });
  };

  const handleMakeDefault = async (
    promptId: string, 
    role?: 'filter' | 'scriptwriter' | 'summary' | 'knowledge' | 'global'
  ) => {
    if (!onUpdateSettings || !currentSettings) return;
    setIsSettingDefault(true);
    try {
      const updatePayload: Partial<AppSettings> = {};
      
      if (role === 'filter' || (!role && selectedPrompt?.category === 'filter')) {
        updatePayload.defaultFilterPromptTemplate = promptId;
      } else if (role === 'scriptwriter' || (!role && selectedPrompt?.category === 'scriptwriter')) {
        updatePayload.defaultScriptwriterPromptTemplate = promptId;
      } else if (role === 'summary') {
        updatePayload.defaultSummaryPromptTemplate = promptId;
        updatePayload.defaultPromptTemplate = promptId;
      } else if (role === 'knowledge') {
        updatePayload.defaultKnowledgeBasePromptTemplate = promptId;
      } else {
        updatePayload.defaultPromptTemplate = promptId;
      }

      await onUpdateSettings(updatePayload);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Ошибка обновления настроек по умолчанию');
    } finally {
      setIsSettingDefault(false);
    }
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(editText);
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 2000);
  };

  const filteredPrompts = prompts.filter((p) => {
    // Category filter
    if (activeCategoryTab !== 'all') {
      const promptCat = p.category || 'general';
      if (promptCat !== activeCategoryTab) return false;
    }

    // Search query
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.badge?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  });

  const filterPromptsCount = prompts.filter((p) => p.category === 'filter').length;
  const scriptwriterPromptsCount = prompts.filter((p) => p.category === 'scriptwriter').length;
  const generalPromptsCount = prompts.filter((p) => !p.category || p.category === 'general').length;

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);
  const isSelectedGlobalDefault = currentSettings?.defaultPromptTemplate === selectedPromptId;
  const isSelectedFilterDefault = (currentSettings?.defaultFilterPromptTemplate || 'filter_screener') === selectedPromptId;
  const isSelectedScriptwriterDefault = (currentSettings?.defaultScriptwriterPromptTemplate || 'scriptwriter_deep') === selectedPromptId;
  const isSelectedSummaryDefault = (currentSettings?.defaultSummaryPromptTemplate || currentSettings?.defaultPromptTemplate || 'summary_detailed') === selectedPromptId;
  const isSelectedKnowledgeDefault = (currentSettings?.defaultKnowledgeBasePromptTemplate || 'knowledge_base') === selectedPromptId;

  // Currently active defaults for display
  const activeFilterPrompt = prompts.find(p => p.id === (currentSettings?.defaultFilterPromptTemplate || 'filter_screener')) || prompts[0];
  const activeScriptwriterPrompt = prompts.find(p => p.id === (currentSettings?.defaultScriptwriterPromptTemplate || 'scriptwriter_deep')) || prompts[0];
  const activeSummaryPrompt = prompts.find(p => p.id === (currentSettings?.defaultSummaryPromptTemplate || currentSettings?.defaultPromptTemplate || 'summary_detailed')) || prompts[0];
  const activeKnowledgePrompt = prompts.find(p => p.id === (currentSettings?.defaultKnowledgeBasePromptTemplate || 'knowledge_base')) || prompts[0];

  return (
    <div id="prompts-library-modal" onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-5xl overflow-hidden flex flex-col h-[92vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-stone-50/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-stone-900">Библиотека промптов Gemini</h2>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {prompts.length} {prompts.length === 1 ? 'шаблон' : prompts.length < 5 ? 'шаблона' : 'шаблонов'}
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Настройка промптов для отбора идей (1 этап), сценариев Reels (2 этап), конспектов и базы знаний
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleStartCreateNew()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Создать промпт</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition"
              title="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Selected Active Prompts Overview Bar */}
        <div className="bg-amber-50/70 border-b border-amber-200/80 px-6 py-3 shrink-0 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-amber-950 uppercase tracking-wider flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
              <span>Активные промпты конвейера (по умолчанию):</span>
            </span>
            {saveSuccess && (
              <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 animate-in fade-in">
                <Check className="w-3.5 h-3.5" /> Настройки сохранены!
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 1. Stage 1: Filter */}
            <div className="bg-white p-2.5 rounded-xl border border-indigo-200 shadow-2xs flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-indigo-950 flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-indigo-600" />
                  <span>1 этап: Промпт-Фильтр (Банк идей и хуков)</span>
                </span>
                <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-1.5 py-0.5 rounded">Авто-отбор</span>
              </div>
              <select
                value={currentSettings?.defaultFilterPromptTemplate || 'filter_screener'}
                onChange={(e) => handleMakeDefault(e.target.value, 'filter')}
                className="bg-stone-50 border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                {prompts.map((p) => (
                  <option key={`filter-opt-${p.id}`} value={p.id}>
                    {p.name} {p.badge ? `(${p.badge})` : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-stone-500">
                Используется при первичной проверке видео и автоматическом формировании банка идей
              </p>
            </div>

            {/* 2. Stage 2: Scriptwriter */}
            <div className="bg-white p-2.5 rounded-xl border border-purple-200 shadow-2xs flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-purple-950 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-purple-600" />
                  <span>2 этап: Промпт-Сценарист (Reels / Shorts)</span>
                </span>
                <span className="text-[10px] text-purple-600 font-semibold bg-purple-50 px-1.5 py-0.5 rounded">Сценарии</span>
              </div>
              <select
                value={currentSettings?.defaultScriptwriterPromptTemplate || 'scriptwriter_deep'}
                onChange={(e) => handleMakeDefault(e.target.value, 'scriptwriter')}
                className="bg-stone-50 border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-800 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
              >
                {prompts.map((p) => (
                  <option key={`script-opt-${p.id}`} value={p.id}>
                    {p.name} {p.badge ? `(${p.badge})` : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-stone-500">
                Используется для написания покадровых сценариев (хронометраж, реплики спикера, B-roll)
              </p>
            </div>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-2 px-6 py-2.5 bg-stone-100/70 border-b border-stone-200 overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveCategoryTab('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition whitespace-nowrap flex items-center gap-1.5 ${
              activeCategoryTab === 'all'
                ? 'bg-white text-stone-900 font-semibold shadow-xs border border-stone-200'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/50'
            }`}
          >
            <span>Все промпты</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
              {prompts.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategoryTab('filter')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition whitespace-nowrap flex items-center gap-1.5 ${
              activeCategoryTab === 'filter'
                ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/50'
            }`}
          >
            <span>🔍 Промпт-Фильтр (1 этап: Банк идей)</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeCategoryTab === 'filter' ? 'bg-indigo-700 text-white' : 'bg-stone-200 text-stone-700'}`}>
              {filterPromptsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategoryTab('scriptwriter')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition whitespace-nowrap flex items-center gap-1.5 ${
              activeCategoryTab === 'scriptwriter'
                ? 'bg-purple-600 text-white font-semibold shadow-xs'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/50'
            }`}
          >
            <span>🎬 Промпт-Сценарист (2 этап: Reels)</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeCategoryTab === 'scriptwriter' ? 'bg-purple-700 text-white' : 'bg-stone-200 text-stone-700'}`}>
              {scriptwriterPromptsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategoryTab('general')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition whitespace-nowrap flex items-center gap-1.5 ${
              activeCategoryTab === 'general'
                ? 'bg-stone-800 text-white font-semibold shadow-xs'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/50'
            }`}
          >
            <span>📑 Конспекты & База знаний</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeCategoryTab === 'general' ? 'bg-stone-900 text-white' : 'bg-stone-200 text-stone-700'}`}>
              {generalPromptsCount}
            </span>
          </button>
        </div>

        {/* Content Area: Two Column Layout */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Column: List of Prompts */}
          <div className="w-72 sm:w-84 border-r border-stone-200 bg-stone-50 flex flex-col shrink-0">
            {/* Search */}
            <div className="p-3 border-b border-stone-200">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Поиск по промптам..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-1.5 bg-white border border-stone-200 rounded-xl text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {isLoading ? (
                <div className="p-8 text-center text-xs text-stone-500 flex flex-col items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                  <span>Загрузка библиотеки...</span>
                </div>
              ) : filteredPrompts.length === 0 ? (
                <div className="p-6 text-center text-xs text-stone-500">
                  Шаблонов не найдено
                </div>
              ) : (
                filteredPrompts.map((p) => {
                  const isSelected = !isCreatingNew && selectedPromptId === p.id;
                  const isDefaultGlobal = currentSettings?.defaultPromptTemplate === p.id;
                  const isDefaultFilter = (currentSettings?.defaultFilterPromptTemplate || 'filter_screener') === p.id;
                  const isDefaultScriptwriter = (currentSettings?.defaultScriptwriterPromptTemplate || 'scriptwriter_deep') === p.id;
                  const isDefaultSummary = (currentSettings?.defaultSummaryPromptTemplate || currentSettings?.defaultPromptTemplate || 'summary_detailed') === p.id;
                  const isDefaultKnowledge = (currentSettings?.defaultKnowledgeBasePromptTemplate || 'knowledge_base') === p.id;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setIsCreatingNew(false);
                        setSelectedPromptId(p.id);
                      }}
                      className={`w-full text-left p-2.5 rounded-xl transition border flex flex-col gap-1 ${
                        isSelected
                          ? 'bg-white border-indigo-300 shadow-xs ring-1 ring-indigo-500/20'
                          : 'bg-stone-50/50 hover:bg-white border-transparent hover:border-stone-200 text-stone-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className={`text-xs font-semibold truncate ${isSelected ? 'text-indigo-950' : 'text-stone-900'}`}>
                          {p.name}
                        </span>
                        {(isDefaultFilter || isDefaultScriptwriter || isDefaultSummary || isDefaultKnowledge || isDefaultGlobal) && (
                          <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md shrink-0" title="Используется по умолчанию">
                            <Star className="w-2.5 h-2.5 fill-emerald-600 text-emerald-600" />
                            {isDefaultFilter ? 'Фильтр' : isDefaultScriptwriter ? 'Сценарист' : isDefaultSummary ? 'Конспект' : isDefaultKnowledge ? 'База' : 'Авто'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.category === 'filter' && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            🔍 1 этап
                          </span>
                        )}
                        {p.category === 'scriptwriter' && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                            🎬 2 этап
                          </span>
                        )}
                        {p.isCustom ? (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                            Свой
                          </span>
                        ) : p.isModified ? (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                            Изменен
                          </span>
                        ) : (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200">
                            Системный
                          </span>
                        )}
                        {p.badge && (
                          <span className="text-[10px] text-stone-500 truncate">
                            • {p.badge}
                          </span>
                        )}
                      </div>

                      {p.description && (
                        <p className="text-[11px] text-stone-500 line-clamp-1 leading-snug">
                          {p.description}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Quick footer info */}
            <div className="p-3 border-t border-stone-200 bg-stone-100/70 text-[11px] text-stone-500 flex items-center justify-between">
              <span>Минимум 1 промпт в библиотеке</span>
              <button
                type="button"
                onClick={() => handleStartCreateNew(undefined, activeCategoryTab !== 'all' ? activeCategoryTab : undefined)}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                + Добавить
              </button>
            </div>
          </div>

          {/* Right Column: Editor / Details Form */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            <form onSubmit={handleSavePrompt} className="flex-1 flex flex-col overflow-hidden">
              
              {/* Form Subheader & Actions */}
              <div className="px-6 py-3 border-b border-stone-200 flex flex-wrap items-center justify-between gap-3 bg-stone-50/40 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                    {isCreatingNew ? 'Создание нового промпта' : 'Редактирование промпта'}
                  </span>
                  {!isCreatingNew && selectedPrompt && (
                    <span className="text-[11px] text-stone-400 font-mono">
                      (ID: {selectedPrompt.id})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {!isCreatingNew && selectedPrompt && (
                    <>
                      {/* Duplicate button */}
                      <button
                        type="button"
                        onClick={() => handleStartCreateNew(selectedPrompt)}
                        className="px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 border border-stone-300 rounded-lg transition"
                        title="Создать копию этого шаблона для доработки"
                      >
                        Дублировать
                      </button>

                      {/* Make default buttons */}
                      {onUpdateSettings && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMakeDefault(selectedPrompt.id, selectedPrompt.category === 'filter' ? 'filter' : selectedPrompt.category === 'scriptwriter' ? 'scriptwriter' : 'summary')}
                            disabled={isSettingDefault}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition flex items-center gap-1 text-stone-700 bg-white hover:bg-stone-50 border-stone-300 shadow-2xs"
                            title="Использовать как основной по умолчанию для этой категории"
                          >
                            <Star className={`w-3.5 h-3.5 ${isSelectedFilterDefault || isSelectedScriptwriterDefault || isSelectedSummaryDefault || isSelectedKnowledgeDefault ? 'fill-emerald-600 text-emerald-600' : 'text-stone-400'}`} />
                            <span>
                              {selectedPrompt.category === 'filter'
                                ? isSelectedFilterDefault ? 'Основной фильтр' : 'Сделать фильтром'
                                : selectedPrompt.category === 'scriptwriter'
                                ? isSelectedScriptwriterDefault ? 'Основной сценарист' : 'Сделать сценаристом'
                                : isSelectedSummaryDefault ? 'Основной конспект' : 'Сделать конспектом'}
                            </span>
                          </button>
                        </div>
                      )}

                      {/* Copy prompt text */}
                      <button
                        type="button"
                        onClick={handleCopyText}
                        className="p-1.5 text-stone-600 hover:text-stone-900 border border-stone-300 rounded-lg hover:bg-stone-50 transition"
                        title="Скопировать текст промпта"
                      >
                        {copiedSuccess ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>

                      {/* Reset to system default */}
                      {selectedPrompt.isModified && !selectedPrompt.isCustom && (
                        <button
                          type="button"
                          onClick={() => handleResetToDefault(selectedPrompt.id, selectedPrompt.name)}
                          className="px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 border border-amber-300 rounded-lg transition flex items-center gap-1"
                          title="Вернуть исходный системный текст промпта"
                        >
                          <RotateCcw className="w-3 h-3 text-amber-600" />
                          <span>Сбросить</span>
                        </button>
                      )}

                      {/* Delete prompt button */}
                      <button
                        type="button"
                        disabled={prompts.length <= 1}
                        onClick={() => handleDeletePrompt(selectedPrompt.id, selectedPrompt.name)}
                        className={`p-1.5 rounded-lg border transition ${
                          prompts.length <= 1
                            ? 'opacity-40 text-stone-400 border-stone-200 cursor-not-allowed'
                            : 'text-rose-600 hover:text-rose-800 hover:bg-rose-50 border-rose-200'
                        }`}
                        title={prompts.length <= 1 ? 'Нельзя удалить единственный оставшийся промпт' : 'Удалить этот шаблон из библиотеки'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  {isCreatingNew && (
                    <button
                      type="button"
                      onClick={() => setIsCreatingNew(false)}
                      className="px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 rounded-lg transition"
                    >
                      Отмена
                    </button>
                  )}

                  {/* Save button */}
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition disabled:opacity-50"
                  >
                    {isSaving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : saveSuccess ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : null}
                    <span>{saveSuccess ? 'Сохранено!' : 'Сохранить'}</span>
                  </button>
                </div>
              </div>

              {/* Error message */}
              {errorMessage && (
                <div className="mx-6 mt-3 p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Form Fields */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Название промпта *
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Например: Промпт-Фильтр (Блог по психологии)"
                      className="w-full text-xs bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Категория (Назначение)
                    </label>
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value as any)}
                      className="w-full text-xs bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                    >
                      <option value="filter">🔍 Этап 1: Промпт-Фильтр (Банк идей)</option>
                      <option value="scriptwriter">🎬 Этап 2: Промпт-Сценарист (Reels)</option>
                      <option value="general">📑 Конспекты / База знаний</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Метка / Бейдж
                    </label>
                    <input
                      type="text"
                      value={editBadge}
                      onChange={(e) => setEditBadge(e.target.value)}
                      placeholder="Например: 1 этап, 45-60 сек"
                      className="w-full text-xs bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Краткое описание
                    </label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Быстрый драфт тем, отсев табу, покадровая генерация..."
                      className="w-full text-xs bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex-1 flex flex-col">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-stone-700">
                      Инструкция / Текст промпта для Gemini *
                    </label>
                    <div className="flex items-center gap-2 text-[11px] text-stone-400 font-mono">
                      <span>Символов: {editText.length}</span>
                      <span>•</span>
                      <span>Строк: {editText.split('\n').length}</span>
                    </div>
                  </div>

                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={16}
                    placeholder="Введите подробную инструкцию для Gemini (роль, правила отбора, табу, структура сценария)..."
                    className="w-full text-xs font-mono bg-stone-50 border border-stone-300 rounded-xl p-3.5 text-stone-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed min-h-[320px]"
                  />
                  <p className="mt-1.5 text-[11px] text-stone-500">
                    💡 При анализе видео система передаст этот промпт в Gemini вместе с транскриптом.
                  </p>
                </div>
              </div>
            </form>
          </div>
        </div>

      </div>

      {/* Reusable Confirm Modal for Deletion / Reset */}
      <ConfirmModal config={confirmConfig} onClose={() => setConfirmConfig(null)} />
    </div>
  );
};
