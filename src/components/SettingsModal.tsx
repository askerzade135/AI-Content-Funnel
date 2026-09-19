import React, { useState, useEffect } from 'react';
import { X, Settings, Clock, Sparkles, Check, RefreshCw, Loader2, Send, Database, Download, ShieldCheck } from 'lucide-react';
import { AppSettings, TelegramStatus, PromptTemplateDef, StoredVideo } from '../types';
import { PROMPT_DEFINITIONS, fetchPromptDefinitions } from '../prompts';
import { authFetch } from '../services/authFetch';

interface SettingsModalProps {
  isOpen: boolean;
  embedded?: boolean;
  onClose: () => void;
  settings: AppSettings | null;
  onSaveSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  onSyncNow: () => void;
  isSyncing: boolean;
  onOpenPromptsModal?: () => void;
  videos?: StoredVideo[];
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  embedded = false,
  onClose,
  settings,
  onSaveSettings,
  onSyncNow,
  isSyncing,
  onOpenPromptsModal,
}) => {
  const [dailySyncEnabled, setDailySyncEnabled] = useState(true);
  const [intervalHours, setIntervalHours] = useState(24);
  const [autoProcessNewVideos, setAutoProcessNewVideos] = useState(false);
  const [autoProcessMode, setAutoProcessMode] = useState<'filter_screener' | 'transcription_only' | 'two_stage_pipeline'>('filter_screener');
  const [telegramAutoSend, setTelegramAutoSend] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [skipTelegramIfFilteredOut, setSkipTelegramIfFilteredOut] = useState(true);
  const [defaultPromptTemplate, setDefaultPromptTemplate] = useState<string>('two_stage_pipeline');
  const [defaultFilterPromptTemplate, setDefaultFilterPromptTemplate] = useState<string>('filter_screener');
  const [defaultScriptwriterPromptTemplate, setDefaultScriptwriterPromptTemplate] = useState<string>('scriptwriter_deep');
  const [customPrompt, setCustomPrompt] = useState('');
  const [supadataApiKey, setSupadataApiKey] = useState('');
  const [chocodataApiKey, setChocodataApiKey] = useState('');
  const [llmMode, setLlmMode] = useState<'included' | 'byok'>('included');
  const [llmProvider, setLlmProvider] = useState<'gemini' | 'groq' | 'openrouter'>('gemini');
  const [llmModel, setLlmModel] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [promptList, setPromptList] = useState<PromptTemplateDef[]>(PROMPT_DEFINITIONS);
  const [storageStatus, setStorageStatus] = useState<any>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);

  // Telegram test state
  const [tgStatus, setTgStatus] = useState<TelegramStatus | null>(null);
  const [isTestingTg, setIsTestingTg] = useState(false);
  const [tgTestMsg, setTgTestMsg] = useState<string | null>(null);

  // Ref to prevent background polling from overriding user toggle changes
  const isInitializedRef = React.useRef(false);

  useEffect(() => {
    if (isOpen) {
      if (!isInitializedRef.current && settings) {
        setDailySyncEnabled(settings.dailySyncEnabled);
        setIntervalHours(settings.intervalHours || 24);
        setAutoProcessNewVideos(settings.autoProcessNewVideos);
        setAutoProcessMode(settings.autoProcessMode || 'filter_screener');
        setTelegramAutoSend(!!settings.telegramAutoSend);
        setTelegramChatId(settings.telegramChatId || '');
        setSkipTelegramIfFilteredOut(settings.skipTelegramIfFilteredOut !== false);
        setDefaultPromptTemplate(settings.defaultPromptTemplate || 'two_stage_pipeline');
        setDefaultFilterPromptTemplate(settings.defaultFilterPromptTemplate || 'filter_screener');
        setDefaultScriptwriterPromptTemplate(settings.defaultScriptwriterPromptTemplate || 'scriptwriter_deep');
        setCustomPrompt(settings.customPrompt || '');
        setSupadataApiKey(settings.supadataApiKey || '');
        setChocodataApiKey(settings.chocodataApiKey || '');
        setLlmMode(settings.llmMode || 'included');
        setLlmProvider(settings.llmProvider || 'gemini');
        setLlmModel(settings.llmModel || '');
        setGeminiApiKey(settings.geminiApiKey || '');
        setGroqApiKey(settings.groqApiKey || '');
        setOpenrouterApiKey(settings.openrouterApiKey || '');
        isInitializedRef.current = true;
      }
    } else {
      isInitializedRef.current = false;
    }
  }, [isOpen, settings]);

  const handleToggleAutoProcess = async (newValue: boolean) => {
    setAutoProcessNewVideos(newValue);
    try {
      await onSaveSettings({ autoProcessNewVideos: newValue });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save autoProcessNewVideos:', err);
    }
  };

  const handleChangeAutoProcessMode = async (newMode: 'filter_screener' | 'transcription_only' | 'two_stage_pipeline') => {
    setAutoProcessMode(newMode);
    try {
      await onSaveSettings({ autoProcessMode: newMode });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save autoProcessMode:', err);
    }
  };

  const handleToggleDailySync = async (newValue: boolean) => {
    setDailySyncEnabled(newValue);
    try {
      await onSaveSettings({ dailySyncEnabled: newValue });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save dailySyncEnabled:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      authFetch('/api/telegram/status')
        .then((r) => r.json())
        .then((data) => setTgStatus(data))
        .catch(console.error);

      fetchPromptDefinitions()
        .then(setPromptList)
        .catch(console.error);

      authFetch('/api/admin/storage-status')
        .then(async (r) => r.ok ? await r.json() : null)
        .then(setStorageStatus)
        .catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestTg = async () => {
    setIsTestingTg(true);
    setTgTestMsg(null);
    try {
      const res = await authFetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: telegramChatId }),
      });
      const data = await res.json();
      if (data.ok) {
        setTgTestMsg(`✓ Успешно! Бот: @${data.bot?.username || 'Бот'}`);
      } else {
        setTgTestMsg(`✗ ${data.error || 'Ошибка'}`);
      }
    } catch (e: any) {
      setTgTestMsg(`✗ ${e.message}`);
    } finally {
      setIsTestingTg(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveSettings({
        dailySyncEnabled,
        intervalHours,
        autoProcessNewVideos,
        autoProcessMode,
        telegramAutoSend,
        telegramChatId,
        skipTelegramIfFilteredOut,
        defaultPromptTemplate: defaultPromptTemplate as any,
        defaultFilterPromptTemplate,
        defaultScriptwriterPromptTemplate,
        customPrompt,
        supadataApiKey,
        chocodataApiKey,
        llmMode,
        llmProvider,
        llmModel,
        geminiApiKey,
        groqApiKey,
        openrouterApiKey,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return 'Еще не запускалась';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  const filterPrompts = promptList.filter(p => p.category === 'filter');
  const scriptwriterPrompts = promptList.filter(p => p.category === 'scriptwriter');

  return (
    <div
      id="settings-modal"
      onClick={embedded ? undefined : onClose}
      className={embedded ? "w-full p-5 sm:p-7" : "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"}
    >
      <div
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        className={embedded
          ? "bg-white rounded-3xl border border-stone-200 w-full max-w-5xl mx-auto overflow-hidden flex flex-col"
          : "bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 bg-stone-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-100 text-stone-700 flex items-center justify-center">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Настройки автоматизации и AI</h2>
              <p className="text-xs text-stone-500">Расписание, AI provider, интеграции и промпты</p>
            </div>
          </div>
          {!embedded && (
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className={embedded ? "p-6 space-y-6" : "p-6 overflow-y-auto space-y-6"}>
          {/* Section 1: Daily Sync Schedule */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              Расписание и автопроверка
            </h3>

            <div className="flex items-center justify-between p-3.5 bg-stone-50 border border-stone-200 rounded-xl">
              <div>
                <span className="text-xs font-semibold text-stone-800 block">
                  Ежедневная автопроверка каналов
                </span>
                <span className="text-[11px] text-stone-500 block">
                  Автоматический опрос подключенных каналов в фоновом режиме
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={dailySyncEnabled}
                  onChange={(e) => handleToggleDailySync(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">
                  Периодичность проверки
                </label>
                <select
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(Number(e.target.value))}
                  disabled={!dailySyncEnabled}
                  className="w-full text-xs bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value={24}>Каждые 24 часа (Раз в сутки)</option>
                  <option value={12}>Каждые 12 часов</option>
                  <option value={6}>Каждые 6 часов</option>
                  <option value={1}>Каждый 1 час</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">
                  Следующий запуск
                </label>
                <div className="text-xs font-medium text-stone-700 bg-stone-100/70 border border-stone-200 rounded-xl px-3 py-2 truncate">
                  {formatDate(settings?.nextSyncRun)}
                </div>
              </div>
            </div>

            {/* Auto process new videos */}
            <div className="p-3.5 bg-indigo-50/50 border border-indigo-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-stone-900 block">
                    Сразу конвертировать новые видео в текст и слать в Gemini
                  </span>
                  <span className="text-[11px] text-stone-500 block">
                    При обнаружении новых видео автоматически запускать расшифровку и обработку
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                  <input
                    type="checkbox"
                    checked={autoProcessNewVideos}
                    onChange={(e) => handleToggleAutoProcess(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {autoProcessNewVideos && (
                <div className="pt-2.5 border-t border-indigo-100/80 space-y-2">
                  <span className="text-[11px] font-semibold text-stone-700 block">
                    Что делать с новыми видео:
                  </span>

                  <div className="space-y-1.5">
                    {/* Option 1: Filter Screener (Stage 1 only, no scenario) - What the user wants */}
                    <label
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition cursor-pointer text-left ${
                        autoProcessMode === 'filter_screener'
                          ? 'bg-white border-indigo-500 ring-1 ring-indigo-500 shadow-2xs'
                          : 'bg-white/70 border-stone-200 hover:bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="autoProcessModeRadio"
                        value="filter_screener"
                        checked={autoProcessMode === 'filter_screener'}
                        onChange={() => handleChangeAutoProcessMode('filter_screener')}
                        className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-stone-900">
                            Транскрипция + Фильтр тем (без сценария)
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                            Ваш выбор
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-500 leading-snug mt-0.5">
                          Расшифровывает видео, оценивает тему через Gemini (Этап 1) и собирает банк идей. <strong>Сценарии Reels/Shorts не пишутся</strong> — вы генерируете их вручную только для нужных идей.
                        </p>
                      </div>
                    </label>

                    {/* Option 2: Transcription Only */}
                    <label
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition cursor-pointer text-left ${
                        autoProcessMode === 'transcription_only'
                          ? 'bg-white border-indigo-500 ring-1 ring-indigo-500 shadow-2xs'
                          : 'bg-white/70 border-stone-200 hover:bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="autoProcessModeRadio"
                        value="transcription_only"
                        checked={autoProcessMode === 'transcription_only'}
                        onChange={() => handleChangeAutoProcessMode('transcription_only')}
                        className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-stone-900 block">
                          Только расшифровка субтитров в текст
                        </span>
                        <p className="text-[11px] text-stone-500 leading-snug mt-0.5">
                          Только извлекает текст видео. Gemini AI не вызывается.
                        </p>
                      </div>
                    </label>

                    {/* Option 3: Full 2-stage pipeline */}
                    <label
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition cursor-pointer text-left ${
                        autoProcessMode === 'two_stage_pipeline'
                          ? 'bg-white border-indigo-500 ring-1 ring-indigo-500 shadow-2xs'
                          : 'bg-white/70 border-stone-200 hover:bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="autoProcessModeRadio"
                        value="two_stage_pipeline"
                        checked={autoProcessMode === 'two_stage_pipeline'}
                        onChange={() => handleChangeAutoProcessMode('two_stage_pipeline')}
                        className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-stone-900 block">
                          Полный цикл (Фильтр + Написание сценария Reels)
                        </span>
                        <p className="text-[11px] text-stone-500 leading-snug mt-0.5">
                          Автоматически формирует готовый покадровый сценарий для каждого прошедшего фильтр видео.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AI Provider */}
          <div className="space-y-4 pt-2 border-t border-stone-100">
            <div>
              <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                AI
              </h3>
              <p className="text-[11px] text-stone-500 mt-1">
                AI уже включён в тариф. Radar сам выбирает подходящую модель для discovery, ranking, анализа идей и сценариев.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLlmMode('included')}
                className={`text-left p-3.5 rounded-xl border transition ${
                  llmMode === 'included'
                    ? 'bg-violet-50 border-violet-400 ring-1 ring-violet-200'
                    : 'bg-white border-stone-200 hover:bg-stone-50'
                }`}
              >
                <div className="text-xs font-bold text-stone-900">Included AI</div>
                <div className="text-[11px] text-stone-500 mt-1">Рекомендуется. Использует AI-квоту вашего тарифа.</div>
              </button>
              <button
                type="button"
                onClick={() => setLlmMode('byok')}
                className={`text-left p-3.5 rounded-xl border transition ${
                  llmMode === 'byok'
                    ? 'bg-violet-50 border-violet-400 ring-1 ring-violet-200'
                    : 'bg-white border-stone-200 hover:bg-stone-50'
                }`}
              >
                <div className="text-xs font-bold text-stone-900">Use my own provider</div>
                <div className="text-[11px] text-stone-500 mt-1">Advanced: используйте свой API key и свои лимиты.</div>
              </button>
            </div>

            {llmMode === 'byok' && (
              <div className="space-y-4 rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
                <div className="grid sm:grid-cols-3 gap-2">
                  {([
                    ['gemini', 'Google Gemini'],
                    ['groq', 'Groq'],
                    ['openrouter', 'OpenRouter'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => { setLlmProvider(id); setLlmModel(''); }}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-semibold transition ${
                        llmProvider === id
                          ? 'bg-white border-violet-400 text-violet-800 ring-1 ring-violet-200'
                          : 'bg-white border-stone-200 text-stone-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-stone-600 mb-1">Модель</label>
                  <select
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    className="w-full text-xs bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-800 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  >
                    <option value="">Auto / recommended</option>
                    {llmProvider === 'gemini' && <>
                      <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                      <option value="gemini-3.8-flash">gemini-3.8-flash</option>
                    </>}
                    {llmProvider === 'groq' && <>
                      <option value="openai/gpt-oss-20b">openai/gpt-oss-20b</option>
                      <option value="openai/gpt-oss-120b">openai/gpt-oss-120b</option>
                    </>}
                    {llmProvider === 'openrouter' && (
                      <option value="openrouter/free">openrouter/free</option>
                    )}
                  </select>
                </div>

                {llmProvider === 'gemini' && (
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">Gemini API key</label>
                    <input
                      type="password"
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className="w-full text-xs bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-800 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                )}

                {llmProvider === 'groq' && (
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">Groq API key</label>
                    <input
                      type="password"
                      value={groqApiKey}
                      onChange={(e) => setGroqApiKey(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className="w-full text-xs bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-800 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                )}

                {llmProvider === 'openrouter' && (
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">OpenRouter API key</label>
                    <input
                      type="password"
                      value={openrouterApiKey}
                      onChange={(e) => setOpenrouterApiKey(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className="w-full text-xs bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-800 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                )}

                <p className="text-[10px] text-stone-400">
                  Персональный ключ хранится на сервере и возвращается в интерфейс только в замаскированном виде.
                </p>
              </div>
            )}
          </div>

          {/* Section 2: Transcription Providers */}
          <div className="space-y-3 pt-2 border-t border-stone-100">
            <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
              Транскрипция
            </h3>
            <p className="text-[11px] text-stone-500">
              Можно использовать ключи провайдеров для своего лимита. Ключи хранятся на сервере и не возвращаются в браузер.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">Supadata API key</label>
                <input
                  type="password"
                  value={supadataApiKey}
                  onChange={(e) => setSupadataApiKey(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full text-xs bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">ChocoData API key</label>
                <input
                  type="password"
                  value={chocodataApiKey}
                  onChange={(e) => setChocodataApiKey(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full text-xs bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <p className="text-[10px] text-stone-400">
                Оставьте поле как есть, чтобы сохранить текущий ключ. Пустое поле также не удаляет сохранённый ключ.
              </p>
            </div>
          </div>

          {/* Section 2: Telegram Integration */}
          <div className="space-y-3 pt-2 border-t border-stone-100">
            <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-sky-600" />
              Интеграция с Telegram
            </h3>

            <div className="flex items-center justify-between p-3.5 bg-sky-50/50 border border-sky-100 rounded-xl">
              <div>
                <span className="text-xs font-semibold text-stone-900 block">
                  Автоматическая отправка в Telegram
                </span>
                <span className="text-[11px] text-stone-500 block">
                  Отправлять новые результаты анализа/сценарии в Telegram-канал при синхронизации
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={telegramAutoSend}
                  onChange={(e) => setTelegramAutoSend(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-600"></div>
              </label>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-stone-600 mb-1">
                Целевой канал / Чат ID
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="@my_channel или -1001234567890"
                  className="flex-1 text-xs bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={handleTestTg}
                  disabled={isTestingTg}
                  className="px-3 py-2 text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl transition shrink-0 flex items-center gap-1"
                >
                  {isTestingTg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Тест бота
                </button>
              </div>
              {tgTestMsg && (
                <p className="mt-1 text-[11px] text-stone-600 font-medium">{tgTestMsg}</p>
              )}
            </div>

            {/* Skip Telegram if Filtered Out */}
            <div className="flex items-center justify-between p-3.5 bg-stone-50 border border-stone-200 rounded-xl">
              <div>
                <span className="text-xs font-semibold text-stone-900 block">
                  Защита от нерелевантных видео (Фильтр)
                </span>
                <span className="text-[11px] text-stone-500 block">
                  Не отправлять видео в Telegram, если оно отклонено по правилу «не натягивать тему»
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipTelegramIfFilteredOut}
                  onChange={(e) => setSkipTelegramIfFilteredOut(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-600"></div>
              </label>
            </div>
          </div>

          {/* Section 3: Two-Stage Prompt Configuration */}
          <div className="space-y-4 pt-2 border-t border-stone-100">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                2-Этапный конвейер промптов
              </h3>
              {onOpenPromptsModal && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenPromptsModal();
                  }}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition"
                  title="Перейти к редактированию текста или добавлению нового шаблона"
                >
                  <Sparkles className="w-3 h-3" />
                  Библиотека & Редактор промптов
                </button>
              )}
            </div>

            {/* Stage 1: Filter Prompt */}
            <div className="p-3.5 bg-blue-50/50 border border-blue-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-blue-950">
                  🔍 Этап 1: Промпт-Фильтр (Отсев и банк идей)
                </label>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  Этап 1
                </span>
              </div>
              <p className="text-[11px] text-blue-900/80 leading-snug">
                Анализирует транскрипт видео, проверяет табу блога и выявляет список жизнеспособных идей с парадоксальными хуками.
              </p>
              <select
                value={defaultFilterPromptTemplate}
                onChange={(e) => setDefaultFilterPromptTemplate(e.target.value)}
                className="w-full text-xs bg-white border border-blue-300 rounded-xl px-3 py-2 text-stone-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
              >
                {(filterPrompts.length > 0 ? filterPrompts : promptList).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.badge ? `(${p.badge})` : ''} {p.isCustom ? '★ Свой' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Stage 2: Scriptwriter Prompt */}
            <div className="p-3.5 bg-purple-50/50 border border-purple-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-purple-950">
                  🎬 Этап 2: Промпт-Сценарист (Покадровые Reels)
                </label>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                  Этап 2
                </span>
              </div>
              <p className="text-[11px] text-purple-900/80 leading-snug">
                Генерирует готовый покадровый сценарий на 45–60 сек с хуком, B-roll, диалогами спикера, кульминацией и текстом для поста.
              </p>
              <select
                value={defaultScriptwriterPromptTemplate}
                onChange={(e) => setDefaultScriptwriterPromptTemplate(e.target.value)}
                className="w-full text-xs bg-white border border-purple-300 rounded-xl px-3 py-2 text-stone-800 focus:outline-none focus:ring-1 focus:ring-purple-500 font-medium"
              >
                {(scriptwriterPrompts.length > 0 ? scriptwriterPrompts : promptList).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.badge ? `(${p.badge})` : ''} {p.isCustom ? '★ Свой' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Storage Migration */}
          <div className="space-y-3 pt-2 border-t border-stone-100">
            <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              Хранилище данных
            </h3>

            <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-stone-900 block">Persistent storage</span>
                  <span className="text-[11px] text-stone-500 block mt-0.5">
                    {storageStatus
                      ? `Режим: ${storageStatus.mode} · Firestore: ${storageStatus.firestoreDatabaseId || 'не указан'}`
                      : 'Проверяем конфигурацию хранилища…'}
                  </span>
                  {storageStatus?.firestoreSnapshot && (
                    <span className="text-[10px] text-stone-500 block mt-1">
                      Snapshot: {storageStatus.firestoreSnapshot.exists ? 'exists' : 'missing'}
                      {' · '}
                      {storageStatus.firestoreSnapshot.readable ? 'readable ✓' : 'not readable'}
                      {' · '}
                      {storageStatus.firestoreSnapshot.chunkCount || 0} chunks
                      {' · '}
                      {Math.round((storageStatus.firestoreSnapshot.byteLength || 0) / 1024)} KB
                    </span>
                  )}
                </div>
                {storageStatus?.mode === 'firestore' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    <ShieldCheck className="w-3 h-3" /> Firestore active
                  </span>
                ) : storageStatus?.mode === 'dual' ? (
                  <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">DUAL</span>
                ) : (
                  <span className="px-2 py-1 rounded-full bg-stone-100 text-stone-700 text-[10px] font-bold">LOCAL JSON</span>
                )}
              </div>

              <p className="text-[11px] text-stone-600 leading-relaxed">
                Во время миграции используйте режим <b>dual</b>: приложение продолжит писать локальный backup и одновременно сохранять snapshot в Firestore.
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={storageBusy}
                  onClick={async () => {
                    setStorageBusy(true);
                    setStorageMessage(null);
                    try {
                      const res = await authFetch('/api/admin/migrate-storage/firestore', { method: 'POST' });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(data?.error || 'Migration failed');
                      const verifiedLabel = data.verified ? ' · Verified ✓' : ' · Verification unavailable';
                      setStorageMessage(
                        `✓ Firestore snapshot: ${data.databaseId || storageStatus?.firestoreDatabaseId || '(default)'} · ${data.chunkCount} chunks · ${Math.round((data.byteLength || 0) / 1024)} KB${verifiedLabel}`
                      );
                      const statusRes = await authFetch('/api/admin/storage-status');
                      if (statusRes.ok) setStorageStatus(await statusRes.json());
                    } catch (e: any) {
                      setStorageMessage(`✗ ${e?.message || 'Ошибка миграции'}`);
                    } finally {
                      setStorageBusy(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition disabled:opacity-50"
                >
                  {storageBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                  Migrate to Firestore
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    setStorageMessage(null);
                    try {
                      const res = await authFetch('/api/admin/export-db');
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        throw new Error(data?.error || 'Backup export failed');
                      }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'ai-content-funnel-backup.json';
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                      setStorageMessage('✓ Backup скачан');
                    } catch (e: any) {
                      setStorageMessage(`✗ ${e?.message || 'Ошибка экспорта'}`);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-stone-200 text-stone-700 text-xs font-semibold hover:bg-stone-50 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download backup
                </button>
              </div>

              {storageMessage && (
                <div
                  className={
                    'text-[11px] font-medium rounded-lg px-3 py-2 border ' +
                    (storageMessage.includes('Verified ✓')
                      ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                      : storageMessage.startsWith('✗')
                      ? 'text-rose-800 bg-rose-50 border-rose-200'
                      : 'text-stone-700 bg-white border-stone-200')
                  }
                >
                  {storageMessage}
                </div>
              )}
            </div>
          </div>

          {/* Buttons */}
          <div className="pt-4 border-t border-stone-200 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onClose();
                onSyncNow();
              }}
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Запустить проверку каналов сейчас</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 rounded-xl shadow-sm transition disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : savedSuccess ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : null}
                <span>{savedSuccess ? 'Сохранено!' : 'Сохранить настройки'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
