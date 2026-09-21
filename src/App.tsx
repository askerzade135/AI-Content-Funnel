/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Search, Filter, Funnel, CheckSquare, Square, Sparkles, Youtube, 
  Radio, RefreshCw, Plus, AlertCircle, ArrowUpDown, ChevronDown, Loader2,
  Calendar, Film, CheckCircle2, Lightbulb, X
} from 'lucide-react';

import { StoredVideo, TrackedChannel, AppSettings, AppStats, SyncLog, GeneratedScript, PipelineStepProgress, DeletedVideoInfo, PromptTemplateDef, ProductSection } from './types';
import { authFetch } from './services/authFetch';
import { auth, initAuth, googleSignIn } from './services/googleAuth';
import { Header } from './components/Header';
import { VideoCard } from './components/VideoCard';
import { BatchActionToolbar } from './components/BatchActionToolbar';
import { VideoDetailModal } from './components/VideoDetailModal';
import { AddSourceModal } from './components/AddSourceModal';
import { ChannelsModal } from './components/ChannelsModal';
import { SettingsModal } from './components/SettingsModal';
import { LogsModal } from './components/LogsModal';
import { PromptsModal } from './components/PromptsModal';
import { ExportIdeasModal } from './components/ExportIdeasModal';
import { ConfirmModal, ConfirmModalConfig } from './components/ConfirmModal';
import { ConfirmPaidActionModal } from './components/ConfirmPaidActionModal';
import { usePaidConfirmation } from './hooks/usePaidConfirmation';
import { QueueModal } from './components/QueueModal';
import { QuotaMonitorModal } from './components/QuotaMonitorModal';
import { DeletedVideosModal } from './components/DeletedVideosModal';
import { DashboardSkeleton } from './components/DashboardSkeleton';
import { ContentRadar } from './components/ContentRadar';
import { ProductSidebar } from './components/ProductSidebar';
import { RadarWorkspace } from './components/RadarWorkspace';
import { ToastContainer, ToastMessage } from './components/Toast';
import { toastEmitter, showToast } from './utils/toastEmitter';
import { checkIfFilteredOut } from './utils/filterCheck';
import { isRateLimited, isRejectedFilter, hasValidTranscript, isMissingTranscriptRejection } from './utils/video-actions';

export default function App() {
  const [videos, setVideos] = useState<StoredVideo[]>([]);
  const [channels, setChannels] = useState<TrackedChannel[]>([]);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [stats, setStats] = useState<AppStats | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateDef[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const unsubscribe = toastEmitter.subscribe((newToast) => {
      setToasts((prev) => {
        // Prevent duplicate toast if an identical one is already on screen
        const isDuplicate = prev.some(
          (t) => t.title === newToast.title && t.message === newToast.message
        );
        if (isDuplicate) return prev;
        return [newToast, ...prev];
      });
    });
    return () => unsubscribe();
  }, []);

  const handleDismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Automatically enable native title tooltip (matching Archive button style) on any element with truncated text
  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.('.truncate, [class*="line-clamp-"]') as HTMLElement | null;
      if (!el || el.getAttribute('title')) return;
      const text = el.innerText?.trim() || el.textContent?.trim();
      if (text && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) {
        el.setAttribute('title', text);
      }
    };
    document.addEventListener('mouseover', handleMouseOver, { passive: true });
    return () => document.removeEventListener('mouseover', handleMouseOver);
  }, []);

  // Pipeline progress state for direct TG pipeline (without modal)
  const [pipelineProgress, setPipelineProgress] = useState<PipelineStepProgress | null>(null);
  const cancelPipelineRef = useRef<boolean>(false);

  // Selection & Filters (Pending UI inputs)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterPrompt, setFilterPrompt] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [rejectedSubFilter, setRejectedSubFilter] = useState<'all' | 'theme' | 'transcription' | 'error'>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'updated_desc' | 'title_asc'>('date_desc');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Applied Filters (Used for actual list filtering with debounce & loading states)
  const [appliedFilterChannel, setAppliedFilterChannel] = useState<string>('all');
  const [appliedFilterPrompt, setAppliedFilterPrompt] = useState<string>('all');
  const [appliedFilterStatus, setAppliedFilterStatus] = useState<string>('all');
  const [appliedRejectedSubFilter, setAppliedRejectedSubFilter] = useState<'all' | 'theme' | 'transcription' | 'error'>('all');
  const [appliedSortBy, setAppliedSortBy] = useState<'date_desc' | 'date_asc' | 'updated_desc' | 'title_asc'>('date_desc');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState<string>('');

  // Filter & Search states
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const previousValidListRef = useRef<StoredVideo[]>([]);
  const searchDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Modals & UI states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isChannelsModalOpen, setIsChannelsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
  const [isDailyActivityModalOpen, setIsDailyActivityModalOpen] = useState(false);
  const [isContentRadarOpen, setIsContentRadarOpen] = useState(false);
  const [productSection, setProductSection] = useState<ProductSection>('today');
  const [radarOnboardingComplete, setRadarOnboardingComplete] = useState(false);
  const [isPromptsModalOpen, setIsPromptsModalOpen] = useState(false);
  const [isExportIdeasModalOpen, setIsExportIdeasModalOpen] = useState(false);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [isDeletedModalOpen, setIsDeletedModalOpen] = useState(false);
  const [deletedVideos, setDeletedVideos] = useState<DeletedVideoInfo[]>([]);
  const [promptDeletedVideos, setPromptDeletedVideos] = useState<DeletedVideoInfo[]>([]);
  const [isPromptDeletedModalOpen, setIsPromptDeletedModalOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<ConfirmModalConfig | null>(null);
  const { confirmPaidAction, modalState: paidModalState, closeModal: closePaidModal } = usePaidConfirmation();
  const [activeDetailVideo, setActiveDetailVideo] = useState<StoredVideo | null>(null);

  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [authCurrentUser, setAuthCurrentUser] = useState<any>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [entryAttempt, setEntryAttempt] = useState(0);
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchQueueIds, setBatchQueueIds] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user) => {
        setIsInitialLoadComplete(false);
        setAuthCurrentUser(user);
        setIsAuthLoading(false);
      },
      () => {
        setAuthCurrentUser(null);
        setIsAuthLoading(false);
        setVideos([]);
        setChannels([]);
        setScripts([]);
        setPromptTemplates([]);
        setSettings(null);
        setIsInitialLoadComplete(false);
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (_) {}
      }
    );
    return () => unsubscribe();
  }, []);

  const lastQuotaErrorTimeRef = useRef<number>(0);
  const hasLoadedRef = useRef<boolean>(false);
  const seenLogIdsRef = useRef<Set<string>>(new Set());

  // Helper to safely parse JSON responses
  const safeFetchJson = async <T,>(res: Response | null, fallback: T): Promise<T> => {
    if (!res || !res.ok) return fallback;
    try {
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return fallback;
      return await res.json();
    } catch {
      return fallback;
    }
  };

  // Fetch data with in-memory caching support (avoids refetching on filter changes)
  const fetchData = useCallback(async (isInitial = false) => {
    const requestUid = auth.currentUser?.uid;
    if (!requestUid) return;
    try {
      if (isInitial && !hasLoadedRef.current) {
        setIsLoading(true);
      }
      const [videosRes, channelsRes, statsRes, settingsRes, logsRes, scriptsRes, queueRes, promptsRes] = await Promise.all([
        authFetch('/api/videos').catch(() => null),
        authFetch('/api/channels').catch(() => null),
        authFetch('/api/stats').catch(() => null),
        authFetch('/api/settings').catch(() => null),
        authFetch('/api/logs').catch(() => null),
        authFetch('/api/scripts').catch(() => null),
        authFetch('/api/videos/queue').catch(() => null),
        authFetch('/api/prompts').catch(() => null),
      ]);

      const [videosData, channelsData, statsData, settingsData, logsData, scriptsData, queueData, promptsData] = await Promise.all([
        safeFetchJson<StoredVideo[] | null>(videosRes, null),
        safeFetchJson<TrackedChannel[] | null>(channelsRes, null),
        safeFetchJson<any | null>(statsRes, null),
        safeFetchJson<AppSettings | null>(settingsRes, null),
        safeFetchJson<SyncLog[] | null>(logsRes, null),
        safeFetchJson<GeneratedScript[] | null>(scriptsRes, null),
        safeFetchJson<any | null>(queueRes, null),
        safeFetchJson<PromptTemplateDef[] | null>(promptsRes, null),
      ]);

      if (auth.currentUser?.uid !== requestUid) return;
      if (videosData && Array.isArray(videosData)) setVideos(videosData);
      if (channelsData && Array.isArray(channelsData)) setChannels(channelsData);
      if (statsData) setStats(statsData);
      if (settingsData) setSettings(settingsData);
      if (promptsData && Array.isArray(promptsData)) setPromptTemplates(promptsData);
      if (logsData && Array.isArray(logsData)) {
        setLogs(logsData);

        // Check for new background sync logs to display persistent toasts without timeout
        if (hasLoadedRef.current) {
          const newLogs = logsData.filter((log) => !seenLogIdsRef.current.has(log.id));
          for (const log of newLogs) {
            seenLogIdsRef.current.add(log.id);

            // Trigger persistent toast for sync events
            if (log.message.startsWith('Синхронизация завершена')) {
              if (log.message.includes('новых видео на каналах не обнаружено')) {
                showToast(
                  'Синхронизация завершена',
                  'Новых видео на каналах не обнаружено.',
                  undefined,
                  'info',
                  true // persistent: ждет закрытия пользователем
                );
              } else if (log.type === 'success' || log.message.includes('Добавлено новых видео')) {
                showToast(
                  'Синхронизация завершена',
                  log.message,
                  undefined,
                  'success',
                  true // persistent: ждет закрытия пользователем
                );
              }
            }
          }
        } else {
          // On initial load, record existing log IDs so we do not show past logs
          logsData.forEach((log) => seenLogIdsRef.current.add(log.id));
        }
      }
      if (scriptsData && Array.isArray(scriptsData)) setScripts(scriptsData);

      if (queueRes && queueRes.ok) {
        const qData = await queueRes.json().catch(() => null);
        if (qData) {
          const combined = Array.from(new Set([...(qData.activeIds || []), ...(qData.queuedIds || [])]));
          setBatchQueueIds(combined);
        }
      }
      hasLoadedRef.current = true;
    } catch (err) {
      console.error('Error fetching app data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const hasActiveOrQueued = videos.some((v) => v.status === 'transcribing' || v.status === 'processing_gemini') || batchQueueIds.length > 0;

  // Resolve the entry screen only after Firebase has restored this user's session.
  useEffect(() => {
    if (isAuthLoading || !authCurrentUser) return;
    let cancelled = false;
    setEntryError(null);
    setIsInitialLoadComplete(false);
    const enter = async () => {
      try {
        const response = await authFetch('/api/radar/profile');
        if (!response.ok) throw new Error('Не удалось загрузить профиль. Повторите попытку.');
        const profile = await response.json();
        if (cancelled) return;
        const onboardingComplete = Boolean(profile.onboardingCompletedAt);
        setRadarOnboardingComplete(onboardingComplete);
        setProductSection(onboardingComplete ? 'today' : 'discover');
        await fetchData(true);
        if (!cancelled) setIsInitialLoadComplete(true);
      } catch (error: any) {
        if (!cancelled) setEntryError(error.message || 'Ошибка загрузки профиля');
      }
    };
    void enter();
    return () => { cancelled = true; };
  }, [isAuthLoading, authCurrentUser?.uid, entryAttempt, fetchData]);

  const handleProductSectionChange = useCallback((section: ProductSection) => {
    const locked = !radarOnboardingComplete && (section === 'today' || section === 'ideas' || section === 'scripts' || section === 'calendar');
    if (locked) return;
    setProductSection(section);
  }, [radarOnboardingComplete]);

  // 2. Polling and background sync once initial load is complete
  useEffect(() => {
    if (!isInitialLoadComplete || !authCurrentUser) return;

    const intervalTime = hasActiveOrQueued ? 2500 : 10000;
    const interval = setInterval(() => {
      fetchData(false);
    }, intervalTime);

    return () => clearInterval(interval);
  }, [isInitialLoadComplete, authCurrentUser?.uid, fetchData, hasActiveOrQueued]);

  // Keep activeDetailVideo in sync with updated video data
  useEffect(() => {
    if (activeDetailVideo) {
      const updated = videos.find((v) => v.id === activeDetailVideo.id);
      if (updated && (updated.status !== activeDetailVideo.status || updated.geminiResult !== activeDetailVideo.geminiResult)) {
        setActiveDetailVideo(updated);
      }
    }
  }, [videos, activeDetailVideo]);

  // Handle batch queue logic and check for quota errors
  useEffect(() => {
    if (batchQueueIds.length > 0) {
      const quotaFailedVideo = videos.find(v => 
        batchQueueIds.includes(v.id) && isRateLimited(v)
      );
      
      if (quotaFailedVideo && Date.now() - lastQuotaErrorTimeRef.current > 15000) {
        lastQuotaErrorTimeRef.current = Date.now();
        showToast('Квота API исчерпана', 'Фоновая обработка столкнулась с лимитом квоты. Вы можете повторить из окна очереди.', undefined, 'error');
      }
    }
  }, [videos, batchQueueIds]);

  // Helper to determine scenario and filter rejection status for a video
  const getVideoScenarioStatus = useCallback(
    (video: StoredVideo): 'reviewed' | 'has_script' | 'approved' | 'rejected' | 'no_script' | 'transcribed' | 'error' | 'processing' | 'quota_exceeded' | 'requires_payment' => {
      if (video.status === 'requires_payment') return 'requires_payment';
      if (video.status === 'error') return 'error';
      if (video.status === 'quota_exceeded') return 'quota_exceeded';

      // 0. Explicit user review status
      if (video.isReviewed) {
        return 'reviewed';
      }

      // 1. Check for rejection: if explicitly rejected by filter or geminiResult filtered out
      const isDirectlyRejected = isRejectedFilter(video);
      if (isDirectlyRejected) {
        return 'rejected';
      }

      // 2. Check for real scripts (Stage 2)
      const videoScripts = scripts.filter(
        (s) => s.videoIds?.includes(video.id) && s.matchedFilter !== false && s.promptTemplate !== 'filter_screener'
      );
      if (videoScripts.length > 0 || (video.scriptCount && video.scriptCount > 0 && video.matchedFilter !== false)) {
        return 'has_script';
      }

      // 4. Check for transcribed status (transcript ready, but no geminiResult yet)
      if (video.status === 'transcribed' || (video.transcript && !video.geminiResult)) {
        return 'transcribed';
      }

      // 3. Check for Stage 1 Approved (Screened by filter and passed)
      if (video.matchedFilter === true || (video.geminiResult && !checkIfFilteredOut(video.geminiResult))) {
        return 'approved';
      }

      return 'no_script';
    },
    [scripts]
  );

  // Debounce search query with isSearching spinner (300ms)
  useEffect(() => {
    if (searchQuery === appliedSearchQuery) {
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    if (searchDebounceTimerRef.current) clearTimeout(searchDebounceTimerRef.current);

    searchDebounceTimerRef.current = setTimeout(() => {
      setAppliedSearchQuery(searchQuery);
      setIsSearching(false);
    }, 300);

    return () => {
      if (searchDebounceTimerRef.current) clearTimeout(searchDebounceTimerRef.current);
    };
  }, [searchQuery, appliedSearchQuery]);

  // Sync dropdowns and tabs immediately
  useEffect(() => {
    setAppliedFilterChannel(filterChannel);
  }, [filterChannel]);

  useEffect(() => {
    setAppliedFilterPrompt(filterPrompt);
  }, [filterPrompt]);

  useEffect(() => {
    setAppliedFilterStatus(filterStatus);
  }, [filterStatus]);

  useEffect(() => {
    setAppliedRejectedSubFilter(rejectedSubFilter);
  }, [rejectedSubFilter]);

  useEffect(() => {
    setAppliedSortBy(sortBy);
  }, [sortBy]);

  // Resolve stage 1 & 2 templates and names dynamically from prompt settings
  const stage1Template = useMemo(() => {
    const targetId = settings?.defaultFilterPromptTemplate || 'filter_screener';
    return (
      promptTemplates.find((t) => t.id === targetId) ||
      promptTemplates.find((t) => t.id === 'filter_screener') ||
      promptTemplates.find((t) => t.category === 'filter')
    );
  }, [promptTemplates, settings?.defaultFilterPromptTemplate]);

  const stage2Template = useMemo(() => {
    const targetId = settings?.defaultScriptwriterPromptTemplate || 'scriptwriter_deep';
    return (
      promptTemplates.find((t) => t.id === targetId) ||
      promptTemplates.find((t) => t.id === 'scriptwriter_deep') ||
      promptTemplates.find((t) => t.category === 'scriptwriter')
    );
  }, [promptTemplates, settings?.defaultScriptwriterPromptTemplate]);

  const stage1Name = stage1Template?.name || 'Фильтр тем и Банк идей';
  const stage2Name = stage2Template?.name || 'Покадровый сценарист Reels/Shorts';

  // Helper to check which stage a video's run belongs to
  const checkVideoStage = useCallback((video: StoredVideo): 'stage1' | 'stage2' | null => {
    if (video.promptRuns && video.promptRuns.length > 0) {
      const currentRun = video.promptRuns.find((r) => r.isCurrent) || video.promptRuns[0];
      if (currentRun) {
        if (currentRun.stage === 'stage1' || currentRun.stage === 1) return 'stage1';
        if (currentRun.stage === 'stage2' || currentRun.stage === 2) return 'stage2';

        const pId = currentRun.promptId || currentRun.promptTemplate;
        if (pId) {
          const tmpl = promptTemplates.find((t) => t.id === pId);
          if (tmpl?.category === 'filter') return 'stage1';
          if (tmpl?.category === 'scriptwriter') return 'stage2';
          if (pId === stage1Template?.id || pId === 'filter_screener' || pId === 'instagram_editor') return 'stage1';
          if (pId === stage2Template?.id || pId === 'scriptwriter_deep' || pId === 'reels_scenario') return 'stage2';
        }
      }
    }

    // Fallbacks for older video entries or videos processed before promptRuns was saved
    if ((video.scriptCount && video.scriptCount > 0) || video.lastPassedStatus === 'has_script') {
      return 'stage2';
    }
    if (video.geminiPromptTemplate) {
      const tmpl = promptTemplates.find((t) => t.id === video.geminiPromptTemplate);
      if (tmpl?.category === 'filter') return 'stage1';
      if (tmpl?.category === 'scriptwriter') return 'stage2';
      if (video.geminiPromptTemplate === stage1Template?.id || video.geminiPromptTemplate === 'filter_screener' || video.geminiPromptTemplate === 'instagram_editor') return 'stage1';
      if (video.geminiPromptTemplate === stage2Template?.id || video.geminiPromptTemplate === 'scriptwriter_deep' || video.geminiPromptTemplate === 'reels_scenario') return 'stage2';
    }
    if (video.matchedFilter !== undefined || video.geminiResult || video.lastPassedStatus === 'approved' || video.lastPassedStatus === 'rejected') {
      return 'stage1';
    }

    return null;
  }, [promptTemplates, stage1Template?.id, stage2Template?.id]);

  // Helper to check if a video matches a specific prompt template ID or stage filter key
  const matchesPromptFilter = useCallback((video: StoredVideo, filterKey: string): boolean => {
    if (!filterKey || filterKey === 'all') return true;

    if (filterKey === 'stage1') {
      return checkVideoStage(video) === 'stage1';
    }
    if (filterKey === 'stage2') {
      return checkVideoStage(video) === 'stage2';
    }

    if (filterKey.startsWith('stage1:')) {
      const targetPromptId = filterKey.replace('stage1:', '');
      if (targetPromptId === 'all') {
        return checkVideoStage(video) === 'stage1';
      }
      // Check current or any matching run
      if (video.promptRuns && video.promptRuns.length > 0) {
        return video.promptRuns.some((r) => {
          const isStage1 = r.stage === 'stage1' || r.stage === 1 || !r.stage;
          const pId = r.promptId || r.promptTemplate;
          return isStage1 && pId === targetPromptId;
        });
      }
      return video.geminiPromptTemplate === targetPromptId && checkVideoStage(video) === 'stage1';
    }

    if (filterKey.startsWith('stage2:')) {
      const targetPromptId = filterKey.replace('stage2:', '');
      if (targetPromptId === 'all') {
        return checkVideoStage(video) === 'stage2';
      }
      // Check current or any matching run
      if (video.promptRuns && video.promptRuns.length > 0) {
        return video.promptRuns.some((r) => {
          const isStage2 = r.stage === 'stage2' || r.stage === 2;
          const pId = r.promptId || r.promptTemplate;
          return isStage2 && pId === targetPromptId;
        });
      }
      return video.geminiPromptTemplate === targetPromptId && checkVideoStage(video) === 'stage2';
    }

    return true;
  }, [checkVideoStage]);

  // List of templates for Stage 1 and Stage 2 strictly derived from promptTemplates
  const stage1PromptTemplates = useMemo(() => {
    return promptTemplates.filter((p) => p.category === 'filter');
  }, [promptTemplates]);

  const stage2PromptTemplates = useMemo(() => {
    return promptTemplates.filter((p) => p.category === 'scriptwriter');
  }, [promptTemplates]);

  // Counts for Stage 1, Stage 2 and individual prompt templates filtered by channel
  const { stage1Count, stage2Count, totalProcessedCount, promptSpecificCounts } = useMemo(() => {
    const targetVideos = filterChannel === 'all'
      ? videos.filter((v) => !v.isArchived)
      : videos.filter((v) => !v.isArchived && v.channelId === filterChannel);

    let s1 = 0;
    let s2 = 0;
    const specificCounts: Record<string, number> = {};

    for (const v of targetVideos) {
      const stage = checkVideoStage(v);
      if (stage === 'stage1') s1++;
      else if (stage === 'stage2') s2++;

      // Count for each stage 1 template
      for (const t of stage1PromptTemplates) {
        const key = `stage1:${t.id}`;
        if (matchesPromptFilter(v, key)) {
          specificCounts[key] = (specificCounts[key] || 0) + 1;
        }
      }

      // Count for each stage 2 template
      for (const t of stage2PromptTemplates) {
        const key = `stage2:${t.id}`;
        if (matchesPromptFilter(v, key)) {
          specificCounts[key] = (specificCounts[key] || 0) + 1;
        }
      }
    }

    return {
      stage1Count: s1,
      stage2Count: s2,
      totalProcessedCount: s1 + s2,
      promptSpecificCounts: specificCounts,
    };
  }, [videos, filterChannel, checkVideoStage, stage1PromptTemplates, stage2PromptTemplates, matchesPromptFilter]);

  // Filtered and sorted videos calculation (pure function returning { data, error })
  const filteredVideosResult = useMemo(() => {
    try {
      const list = videos.filter((video) => {
        if (appliedFilterChannel !== 'all' && video.channelId !== appliedFilterChannel) {
          return false;
        }

        if (appliedFilterPrompt !== 'all') {
          if (!matchesPromptFilter(video, appliedFilterPrompt)) return false;
        }

        if (appliedFilterStatus === 'archive') {
          if (!video.isArchived) return false;
        } else {
          if (video.isArchived) return false;
          if (appliedFilterStatus !== 'all') {
            const vStatus = getVideoScenarioStatus(video);
            if (appliedFilterStatus === 'requires_payment') {
              if (video.status !== 'requires_payment') return false;
            } else if (appliedFilterStatus === 'reviewed') {
              if (vStatus !== 'reviewed') return false;
            } else if (appliedFilterStatus === 'has_script') {
              if (vStatus !== 'has_script') return false;
            } else if (appliedFilterStatus === 'approved') {
              if (vStatus !== 'approved') return false;
            } else if (appliedFilterStatus === 'rejected') {
              const isError = video.status === 'error';
              const isRejectedStatus = vStatus === 'rejected';
              if (!isRejectedStatus && !isError) return false;

              const isTransTranscription = !isError && isMissingTranscriptRejection(video);
              const isTheme = !isError && !isTransTranscription;

              if (appliedRejectedSubFilter === 'transcription' && !isTransTranscription) return false;
              if (appliedRejectedSubFilter === 'theme' && !isTheme) return false;
              if (appliedRejectedSubFilter === 'error' && !isError) return false;
            } else if (appliedFilterStatus === 'transcribed') {
              if (vStatus !== 'transcribed') return false;
            } else if (appliedFilterStatus === 'no_script') {
              if (vStatus !== 'no_script') return false;
            } else if (appliedFilterStatus === 'new') {
              if (video.status !== 'new') return false;
            } else if (appliedFilterStatus === 'completed') {
              if (video.status !== 'completed') return false;
            } else if (video.status !== appliedFilterStatus) {
              return false;
            }
          }
        }

        if (appliedSearchQuery.trim()) {
          const q = appliedSearchQuery.toLowerCase();
          const matchTitle = video.title.toLowerCase().includes(q);
          const matchChannel = video.channelTitle.toLowerCase().includes(q);
          if (!matchTitle && !matchChannel) return false;
        }
        return true;
      });

      // Sort videos by selected sort order (default: creation / published date descending)
      const sorted = [...list].sort((a, b) => {
        if (appliedSortBy === 'date_desc') {
          const timeA = new Date(a.publishedAt || a.updatedAt || 0).getTime();
          const timeB = new Date(b.publishedAt || b.updatedAt || 0).getTime();
          return timeB - timeA;
        }
        if (appliedSortBy === 'date_asc') {
          const timeA = new Date(a.publishedAt || a.updatedAt || 0).getTime();
          const timeB = new Date(b.publishedAt || b.updatedAt || 0).getTime();
          return timeA - timeB;
        }
        if (appliedSortBy === 'updated_desc') {
          const timeA = new Date(a.updatedAt || 0).getTime();
          const timeB = new Date(b.updatedAt || 0).getTime();
          return timeB - timeA;
        }
        if (appliedSortBy === 'title_asc') {
          return (a.title || '').localeCompare(b.title || '');
        }
        return 0;
      });

      previousValidListRef.current = sorted;
      return { data: sorted, error: null };
    } catch (err: any) {
      console.error('[Фильтрация] Ошибка вычисления списка видео:', err);
      return {
        data: previousValidListRef.current,
        error: err?.message || 'Не удалось применить фильтр. Показан предыдущий список видео.'
      };
    }
  }, [videos, appliedFilterChannel, appliedFilterPrompt, appliedFilterStatus, appliedRejectedSubFilter, appliedSearchQuery, appliedSortBy, getVideoScenarioStatus, matchesPromptFilter]);

  const filteredVideos = filteredVideosResult.data;

  // Sync filter error to state safely without causing re-renders during calculation
  useEffect(() => {
    setFilterError(filteredVideosResult.error);
  }, [filteredVideosResult.error]);

  // Subtask D: Progressive chunked rendering for high performance
  const CHUNK_SIZE = 24;
  const [visibleCount, setVisibleCount] = useState<number>(CHUNK_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset visibleCount when filtering, sorting or searching
  useEffect(() => {
    setVisibleCount(CHUNK_SIZE);
  }, [appliedFilterChannel, appliedFilterStatus, appliedRejectedSubFilter, appliedSearchQuery, appliedSortBy]);

  // Auto-load next batch as user scrolls near bottom
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => {
            if (prev < filteredVideos.length) {
              return Math.min(prev + CHUNK_SIZE, filteredVideos.length);
            }
            return prev;
          });
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [filteredVideos.length]);

  const visibleVideos = useMemo(() => {
    return filteredVideos.slice(0, visibleCount);
  }, [filteredVideos, visibleCount]);

  // Subtask B: Dropdown state for "Ещё" rare filters
  const [isMoreFilterOpen, setIsMoreFilterOpen] = useState(false);
  const moreFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreFilterRef.current && !moreFilterRef.current.contains(e.target as Node)) {
        setIsMoreFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Toggle selection
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    const allFilteredIds = filteredVideos.map((v) => v.id);
    setSelectedIds(new Set(allFilteredIds));
  };

  const handleSelectUnprocessedOnly = () => {
    const unprocessed = filteredVideos.filter((v) => v.status === 'new' || v.status === 'transcribed');
    setSelectedIds(new Set(unprocessed.map((v) => v.id)));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleSelectByStatus = (statusFilter: 'unprocessed' | 'approved' | 'with_script' | 'has_error' | 'requires_payment') => {
    let matched: StoredVideo[] = [];
    if (statusFilter === 'unprocessed') {
      matched = filteredVideos.filter((v) => v.status === 'new' || v.status === 'transcribed' || (v.matchedFilter === undefined && v.status !== 'processing_gemini'));
    } else if (statusFilter === 'approved') {
      matched = filteredVideos.filter((v) => v.matchedFilter === true || v.lastPassedStatus === 'approved');
    } else if (statusFilter === 'with_script') {
      matched = filteredVideos.filter((v) => (v.scriptCount && v.scriptCount > 0) || v.lastPassedStatus === 'has_script');
    } else if (statusFilter === 'has_error') {
      matched = filteredVideos.filter((v) => v.status === 'error');
    } else if (statusFilter === 'requires_payment') {
      matched = filteredVideos.filter((v) => v.status === 'requires_payment');
    }
    setSelectedIds(new Set(matched.map((v) => v.id)));
  };

  // Batch Stage 1 Process (Filter Screener) - triggered directly after usePaidConfirmation in BatchActionToolbar
  const handleBatchStage1 = async (targetIds: string[]) => {
    if (targetIds.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const res = await fetch('/api/videos/batch-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoIds: targetIds,
          promptTemplate: 'filter_screener',
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const newQueue = Array.from(new Set([...(data.activeIds || []), ...(data.queuedIds || targetIds)]));
        setBatchQueueIds(newQueue);
        handleClearSelection();
        await fetchData();
        showToast('1 этап запущен', `В очередь фильтрации добавлено: ${targetIds.length} видео`, undefined, 'success');
      }
    } catch (err) {
      console.error('Batch stage 1 error:', err);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Batch Stage 2 Process (Script Generation) - triggered directly after usePaidConfirmation in BatchActionToolbar
  const handleBatchStage2 = async (targetIds: string[]) => {
    if (targetIds.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const res = await fetch('/api/videos/batch-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoIds: targetIds,
          promptTemplate: settings?.defaultScriptwriterPromptTemplate || 'scriptwriter_deep',
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const newQueue = Array.from(new Set([...(data.activeIds || []), ...(data.queuedIds || targetIds)]));
        setBatchQueueIds(newQueue);
        handleClearSelection();
        await fetchData();
        showToast('2 этап запущен', `В очередь генерации сценариев добавлено: ${targetIds.length} видео`, undefined, 'success');
      }
    } catch (err) {
      console.error('Batch stage 2 error:', err);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Batch Transcribe - triggered directly after usePaidConfirmation in BatchActionToolbar
  const handleBatchTranscribe = async (targetIds: string[]) => {
    if (targetIds.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const res = await fetch('/api/videos/batch-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoIds: targetIds,
          promptTemplate: 'transcription_only',
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const newQueue = Array.from(new Set([...(data.activeIds || []), ...(data.queuedIds || targetIds)]));
        setBatchQueueIds(newQueue);
        handleClearSelection();
        await fetchData();
        showToast('Транскрибация запущена', `В очередь транскрибации добавлено: ${targetIds.length} видео`, undefined, 'success');
      }
    } catch (err) {
      console.error('Batch transcribe error:', err);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Batch Confirm & Run for videos in requires_payment status
  const handleBatchConfirmPayment = async (videosToConfirm: StoredVideo[]) => {
    if (!videosToConfirm || videosToConfirm.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const stage2Videos = videosToConfirm.filter(
        (v) => v.pendingPaidAction === 'stage2' || v.lastPassedStatus === 'approved'
      );
      const stage1Videos = videosToConfirm.filter(
        (v) => !stage2Videos.includes(v) && (v.pendingPaidAction === 'stage1' || v.lastPassedStatus === 'transcribed' || !v.pendingPaidAction)
      );
      const transcribeVideos = videosToConfirm.filter(
        (v) => v.pendingPaidAction === 'transcription' && !hasValidTranscript(v)
      );

      const promises: Promise<any>[] = [];

      if (stage2Videos.length > 0) {
        promises.push(
          fetch('/api/videos/batch-process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoIds: stage2Videos.map((v) => v.id),
              promptTemplate: settings?.defaultScriptwriterPromptTemplate || 'scriptwriter_deep',
            }),
          })
        );
      }

      if (stage1Videos.length > 0) {
        promises.push(
          fetch('/api/videos/batch-process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoIds: stage1Videos.map((v) => v.id),
              promptTemplate: 'filter_screener',
            }),
          })
        );
      }

      if (transcribeVideos.length > 0) {
        promises.push(
          fetch('/api/videos/batch-process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoIds: transcribeVideos.map((v) => v.id),
              promptTemplate: 'transcription_only',
            }),
          })
        );
      }

      await Promise.all(promises);
      handleClearSelection();
      await fetchData();
      showToast(
        'Запуск подтвержден',
        `Успешно запущено ${videosToConfirm.length} видео из списка ожидания оплаты`,
        undefined,
        'success'
      );
    } catch (err) {
      console.error('Error confirming batch payment:', err);
      showToast('Ошибка запуска', 'Не удалось запустить видео', undefined, 'error');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleConfirmAllPendingPayment = () => {
    const pendingVideos = videos.filter((v) => !v.isArchived && v.status === 'requires_payment');
    if (pendingVideos.length === 0) return;

    confirmPaidAction({
      actionType: 'pipeline',
      videos: pendingVideos,
      title: `Подтвердить запуск для всех ${pendingVideos.length} видео?`,
      description: `Будет выполнен авторизованный запуск Gemini AI для всех ${pendingVideos.length} видео со статусом ожидания оплаты.`,
      onConfirm: () => handleBatchConfirmPayment(pendingVideos),
    });
  };

  // Run batch process
  const handleProcessBatch = async (promptTemplate: string, customPrompt?: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setIsBatchProcessing(true);
    try {
      const res = await fetch('/api/videos/batch-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoIds: ids,
          promptTemplate,
          customPrompt,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const newQueue = Array.from(new Set([...(data.activeIds || []), ...(data.queuedIds || ids)]));
        setBatchQueueIds(newQueue);
        handleClearSelection();
        await fetchData();
        showToast('Очередь запущена', `Добавлено в очередь обработки: ${ids.length} видео`, undefined, 'success');
      }
    } catch (err) {
      console.error('Batch process error:', err);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Stop/cancel processing for all selected videos
  const handleBatchStop = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    try {
      cancelPipelineRef.current = true;
      setPipelineProgress(null);

      const res = await fetch('/api/videos/batch-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds: ids }),
      });

      if (res.ok) {
        await fetchData();
        showToast('Успешно', `Обработка выбранных видео (${ids.length}) остановлена`, undefined, 'success');
        handleClearSelection();
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast('Ошибка', errData.error || 'Не удалось остановить обработку', undefined, 'error');
        await fetchData();
      }
    } catch (err) {
      console.error('Batch stop error:', err);
      showToast('Ошибка', 'Не удалось остановить обработку', undefined, 'error');
      await fetchData();
    }
  };

  const handleClearAllQueue = async () => {
    try {
      cancelPipelineRef.current = true;
      setPipelineProgress(null);
      setBatchQueueIds([]);
      await fetch('/api/videos/queue', { method: 'DELETE' }).catch(() => null);
      await fetchData();
      showToast('Успешно', 'Очередь обработки очищена', undefined, 'success');
    } catch (err) {
      console.error('Clear all queue error:', err);
      showToast('Ошибка', 'Не удалось очистить очередь', undefined, 'error');
      await fetchData();
    }
  };

  const checkApiQuotaError = async (res: Response, fallbackError: string) => {
    if (res.ok) return false;
    const errData = await res.json().catch(() => ({}));
    const errMsg = (errData.error || '').toLowerCase();
    if (res.status === 429 || errMsg.includes('quota') || errMsg.includes('resource_exhausted') || errMsg.includes('429')) {
      handleClearAllQueue();
      showToast('Квота API исчерпана', 'Обработка остановлена. Пожалуйста, подождите и сбросьте состояние.', undefined, 'error');
      return true;
    }
    showToast('Ошибка', errData.error || fallbackError, undefined, 'error');
    return true;
  };

  // Transcribe single video only
  const handleTranscribeSingle = async (video: StoredVideo) => {
    try {
      setVideos((prev) =>
        prev.map((v) => (v.id === video.id ? { ...v, status: 'transcribing' } : v))
      );
      const res = await fetch(`/api/videos/${video.id}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await fetchData();
        showToast('Успешно', `Транскрипция видео "${video.title}" готова`, undefined, 'success');
      } else {
        await checkApiQuotaError(res, 'Не удалось получить транскрипт');
        await fetchData();
      }
    } catch (err) {
      console.error('Transcribe error:', err);
      showToast('Ошибка', 'Не удалось получить транскрипт', undefined, 'error');
      await fetchData();
    }
  };

  // Run Stage 1 (Filter Screener & Idea Bank) for a single video
  const handleRunStage1 = async (video: StoredVideo) => {
    try {
      setVideos((prev) =>
        prev.map((v) => (v.id === video.id ? { ...v, status: 'processing_gemini' } : v))
      );
      const res = await authFetch(`/api/videos/${video.id}/run-stage1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.video) {
          setVideos((prev) => prev.map((v) => (v.id === video.id ? data.video : v)));
          if (activeDetailVideo?.id === video.id) {
            setActiveDetailVideo(data.video);
          }
        }
      } else {
        await checkApiQuotaError(res, 'Ошибка выполнения этапа 1');
      }
      await fetchData();
    } catch (err) {
      console.error('Single stage1 error:', err);
      await fetchData();
    }
  };

  // Run Stage 2 (Generate Full Script) for a single video
  const handleRunStage2 = async (video: StoredVideo, ideaText?: string) => {
    try {
      setVideos((prev) =>
        prev.map((v) => (v.id === video.id ? { ...v, status: 'processing_gemini' } : v))
      );
      const res = await fetch(`/api/videos/${video.id}/run-stage2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideaText,
          promptTemplate: 'scriptwriter_deep',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.video) {
          setVideos((prev) => prev.map((v) => (v.id === video.id ? data.video : v)));
          if (activeDetailVideo?.id === video.id) {
            setActiveDetailVideo(data.video);
          }
        }
      } else {
        await checkApiQuotaError(res, 'Ошибка выполнения этапа 2');
      }
      await fetchData();
    } catch (err) {
      console.error('Single stage2 error:', err);
      await fetchData();
    }
  };

  // Toggle video reviewed / processed status
  const handleToggleReviewed = async (video: StoredVideo) => {
    try {
      const res = await fetch(`/api/videos/${video.id}/toggle-reviewed`, {
        method: 'PATCH',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.video) {
          setVideos((prev) => prev.map((v) => (v.id === video.id ? data.video : v)));
          if (activeDetailVideo?.id === video.id) {
            setActiveDetailVideo(data.video);
          }
        }
      }
      fetchData();
    } catch (err) {
      console.error('Toggle reviewed error:', err);
    }
  };

  // Fetch deleted videos
  const fetchDeletedVideos = useCallback(async () => {
    try {
      const res = await fetch('/api/videos/deleted');
      if (res.ok) {
        const data = await res.json();
        setDeletedVideos(data.deletedVideos || []);
      }
    } catch (err) {
      console.error('Error fetching deleted videos:', err);
    }
  }, []);

  // Restore deleted videos
  const handleRestoreDeletedVideos = async (videoIds: string[]) => {
    try {
      const res = await fetch('/api/videos/restore-deleted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast('Восстановлено', data.message || `Восстановлено видео: ${videoIds.length}`, undefined, 'success');
        await fetchDeletedVideos();
        await fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('Ошибка восстановления', err.error || 'Сбой', undefined, 'error');
      }
    } catch (err: any) {
      console.error('Restore error:', err);
      showToast('Ошибка восстановления', err.message || 'Сбой соединения', undefined, 'error');
    }
  };

  // Permanently ignore deleted videos
  const handleIgnoreDeletedVideos = async (videoIds: string[]) => {
    try {
      const res = await fetch('/api/videos/ignore-deleted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast('Игнорируется', data.message || 'Видео добавлены в постоянный черный список', undefined, 'info');
        await fetchDeletedVideos();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('Ошибка', err.error || 'Сбой', undefined, 'error');
      }
    } catch (err: any) {
      console.error('Ignore error:', err);
      showToast('Ошибка', err.message || 'Сбой', undefined, 'error');
    }
  };

  // Retry failed step
  const handleRetryStep = async (video: StoredVideo) => {
    try {
      const res = await fetch(`/api/videos/${video.id}/retry-failed-step`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        showToast('Шаг запущен повторно', data.message || `Повторный запуск для «${video.title}»`, undefined, 'info');
        await fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('Ошибка перезапуска', err.error || 'Не удалось повторить шаг', undefined, 'error');
      }
    } catch (err: any) {
      console.error('Retry step error:', err);
      showToast('Ошибка', err.message || 'Сбой соединения', undefined, 'error');
    }
  };

  // Batch retry failed steps for multiple videos
  const handleBatchRetryStep = async (targetIds: string[]) => {
    const ids = targetIds && targetIds.length > 0 ? targetIds : Array.from(selectedIds);
    if (ids.length === 0) return;

    setIsBatchProcessing(true);
    try {
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const res = await fetch(`/api/videos/${id}/retry-failed-step`, {
            method: 'POST',
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${res.status}`);
          }
          return res.json();
        })
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (succeeded > 0) {
        showToast(
          'Шаги запущены повторно',
          `Успешно отправлено на повтор: ${succeeded} из ${ids.length} видео`,
          undefined,
          'info'
        );
      }
      if (failed > 0 && succeeded === 0) {
        showToast('Ошибка повтора', `Не удалось повторить шаг для ${failed} видео`, undefined, 'error');
      }

      // Reset selection state after batch retry as required
      setSelectedIds(new Set());
      await fetchData();
    } catch (err: any) {
      console.error('Batch retry step error:', err);
      showToast('Ошибка', err.message || 'Сбой при повторе шагов', undefined, 'error');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Process single video
  const handleProcessSingle = async (video: StoredVideo, promptTemplate = 'summary', customPrompt?: string) => {
    try {
      setVideos((prev) =>
        prev.map((v) => (v.id === video.id ? { ...v, status: 'transcribing' } : v))
      );
      const res = await fetch(`/api/videos/${video.id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptTemplate, customPrompt }),
      });
      if (res.ok) {
        const updated = await res.json();
        setVideos((prev) => prev.map((v) => (v.id === video.id ? updated : v)));
        if (activeDetailVideo?.id === video.id) {
          setActiveDetailVideo(updated);
        }
      } else {
        await checkApiQuotaError(res, 'Не удалось обработать видео');
      }
      fetchData();
    } catch (err) {
      console.error('Single process error:', err);
      fetchData();
    }
  };

  // Retry rate-limited videos
  const handleRetryRateLimited = async (videoIds: string[]) => {
    if (videoIds.length === 0) return;
    try {
      for (const id of videoIds) {
        await fetch(`/api/videos/${id}/reset-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: 'new' }),
        });
      }
      const res = await fetch('/api/videos/batch-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoIds,
          promptTemplate: 'two_stage_pipeline',
        }),
      });
      if (res.ok) {
        setBatchQueueIds((prev) => Array.from(new Set([...prev, ...videoIds])));
        showToast('Очередь повтора запущена', `Видео (${videoIds.length}) успешно добавлены в очередь повтора.`, undefined, 'success');
        await fetchData();
      }
    } catch (err) {
      console.error('Retry rate limited error:', err);
      showToast('Ошибка', 'Не удалось запустить очередь повтора', undefined, 'error');
      await fetchData();
    }
  };

  // Stop/cancel processing for a single video
  const handleStopProcess = async (video: StoredVideo) => {
    try {
      const res = await fetch(`/api/videos/${video.id}/stop`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.video) {
          setVideos((prev) => prev.map((v) => (v.id === video.id ? data.video : v)));
          if (activeDetailVideo?.id === video.id) {
            setActiveDetailVideo(data.video);
          }
        }
        setBatchQueueIds((prev) => prev.filter((id) => id !== video.id));
        showToast('Успешно', `Обработка видео "${video.title}" успешно отменена`, undefined, 'success');
      }
      await fetchData();
    } catch (err) {
      console.error('Error stopping video process:', err);
      showToast('Ошибка', 'Не удалось остановить обработку видео', undefined, 'error');
      await fetchData();
    }
  };

  // Direct Telegram Pipeline: Step 1 Transcription -> Step 2 Gemini Analysis -> Step 3 Telegram Sending (Without Opening Modal)
  const handleRunTelegramPipeline = async (
    videoIds: string[],
    promptTemplate = 'instagram_editor',
    customPrompt?: string
  ) => {
    if (videoIds.length === 0) return;
    cancelPipelineRef.current = false;

    const targetVideos = videoIds
      .map((id) => videos.find((v) => v.id === id))
      .filter((v): v is StoredVideo => !!v);

    if (targetVideos.length === 0) return;

    let sentCount = 0;
    let rejectedCount = 0;

    for (let index = 0; index < targetVideos.length; index++) {
      if (cancelPipelineRef.current) break;
      const currentVideo = targetVideos[index];
      const videoNum = index + 1;
      const totalNum = targetVideos.length;

      // ----------------------------------------------------
      // ШАГ 1: Транскрипция (субтитры или Gemini)
      // ----------------------------------------------------
      setPipelineProgress({
        videoId: currentVideo.id,
        videoTitle: currentVideo.title,
        step: 'transcribing',
        stepNumber: 1,
        stepMessage: `Шаг 1/3: Получение транскрипции видео...`,
        currentVideoIndex: videoNum,
        totalVideosCount: totalNum,
      });

      setVideos((prev) =>
        prev.map((v) => (v.id === currentVideo.id ? { ...v, status: 'transcribing' } : v))
      );

      let hasTranscript = Boolean(currentVideo.transcript && currentVideo.transcript.length > 50);

      if (!hasTranscript) {
        try {
          const transRes = await fetch(`/api/videos/${currentVideo.id}/transcribe`, {
            method: 'POST',
          });
          if (transRes.ok) {
            const transData = await transRes.json();
            hasTranscript = true;
            setPipelineProgress((prev) =>
              prev
                ? {
                    ...prev,
                    transcriptLength: transData.transcriptLength,
                    stepMessage: `Шаг 1/3: Транскрипт готов (${transData.transcriptLength} симв., ${
                      transData.source === 'subtitles' ? 'субтитры' : 'Gemini AI'
                    })`,
                  }
                : null
            );
            await fetchData();
          } else {
            const errData = await transRes.json().catch(() => ({}));
            throw new Error(errData.error || 'Не удалось расшифровать видео');
          }
        } catch (err: any) {
          console.error('Pipeline transcription error:', err);
          setPipelineProgress({
            videoId: currentVideo.id,
            videoTitle: currentVideo.title,
            step: 'error',
            stepNumber: 1,
            stepMessage: `Ошибка расшифровки: ${err.message || 'Сбой'}`,
            currentVideoIndex: videoNum,
            totalVideosCount: totalNum,
            error: err.message,
          });
          await fetchData();
          continue;
        }
      } else {
        setPipelineProgress((prev) =>
          prev
            ? {
                ...prev,
                transcriptLength: currentVideo.transcript?.length || 0,
                stepMessage: `Шаг 1/3: Транскрипт уже готов (${currentVideo.transcript?.length || 0} симв.)`,
              }
            : null
        );
      }

      if (cancelPipelineRef.current) break;
      await new Promise((r) => setTimeout(r, 600));

      // ----------------------------------------------------
      // ШАГ 2: Анализ контента и проверка фильтра в Gemini AI
      // ----------------------------------------------------
      setPipelineProgress({
        videoId: currentVideo.id,
        videoTitle: currentVideo.title,
        step: 'analyzing',
        stepNumber: 2,
        stepMessage: `Шаг 2/3: Анализ контента и проверка фильтра в Gemini AI...`,
        currentVideoIndex: videoNum,
        totalVideosCount: totalNum,
      });

      setVideos((prev) =>
        prev.map((v) => (v.id === currentVideo.id ? { ...v, status: 'processing_gemini' } : v))
      );

      let generatedScript: GeneratedScript | null = null;
      let isFilteredOut = false;

      try {
        const genRes = await fetch('/api/scripts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoIds: [currentVideo.id],
            promptTemplate,
            customPrompt,
            sendToTelegram: false,
          }),
        });

        if (!genRes.ok) {
          const errData = await genRes.json().catch(() => ({}));
          throw new Error(errData.error || 'Ошибка при анализе Gemini');
        }

        const genData = await genRes.json();
        generatedScript = genData.script;
        isFilteredOut = Boolean(genData.isFilteredOut);

        setPipelineProgress((prev) =>
          prev
            ? {
                ...prev,
                isFilteredOut,
                scriptId: generatedScript?.id,
                stepMessage: isFilteredOut
                  ? `Шаг 2/3: Отклонено фильтром (видео не подходит под критерии)`
                  : `Шаг 2/3: Одобрено фильтром! Сценарий готов`,
              }
            : null
        );

        await fetchData();
      } catch (err: any) {
        console.error('Pipeline Gemini error:', err);
        setPipelineProgress({
          videoId: currentVideo.id,
          videoTitle: currentVideo.title,
          step: 'error',
          stepNumber: 2,
          stepMessage: `Ошибка Gemini: ${err.message || 'Сбой анализа'}`,
          currentVideoIndex: videoNum,
          totalVideosCount: totalNum,
          error: err.message,
        });
        await fetchData();
        continue;
      }

      if (cancelPipelineRef.current) break;
      await new Promise((r) => setTimeout(r, 800));

      // ----------------------------------------------------
      // ШАГ 3: Отправка в Telegram (если одобрено фильтром)
      // ----------------------------------------------------
      if (isFilteredOut) {
        rejectedCount++;
        setPipelineProgress({
          videoId: currentVideo.id,
          videoTitle: currentVideo.title,
          step: 'rejected',
          stepNumber: 3,
          stepMessage: `Шаг 3/3: Публикация в TG пропущена — видео отклонено фильтром`,
          currentVideoIndex: videoNum,
          totalVideosCount: totalNum,
          isFilteredOut: true,
          scriptId: generatedScript?.id,
        });
      } else {
        setPipelineProgress({
          videoId: currentVideo.id,
          videoTitle: currentVideo.title,
          step: 'sending_tg',
          stepNumber: 3,
          stepMessage: `Шаг 3/3: Отправка готового сценария в Telegram канал...`,
          currentVideoIndex: videoNum,
          totalVideosCount: totalNum,
          isFilteredOut: false,
          scriptId: generatedScript?.id,
        });

        try {
          const header = `🎬 *${generatedScript?.title || currentVideo.title}*\n📅 ${new Date().toLocaleDateString('ru-RU')}`;
          const tgRes = await fetch('/api/telegram/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: generatedScript?.content || '',
              header,
              scriptId: generatedScript?.id,
            }),
          });

          if (tgRes.ok) {
            sentCount++;
            setPipelineProgress({
              videoId: currentVideo.id,
              videoTitle: currentVideo.title,
              step: 'done',
              stepNumber: 3,
              stepMessage: `Успешно отправлено в Telegram!`,
              currentVideoIndex: videoNum,
              totalVideosCount: totalNum,
              isFilteredOut: false,
              telegramSent: true,
              scriptId: generatedScript?.id,
            });
          } else {
            const tgData = await tgRes.json().catch(() => ({}));
            const errMsg = tgData.error || 'Ошибка отправки в Telegram';
            setPipelineProgress({
              videoId: currentVideo.id,
              videoTitle: currentVideo.title,
              step: 'done',
              stepNumber: 3,
              stepMessage: `Сценарий готов, но TG сообщил: ${errMsg}`,
              currentVideoIndex: videoNum,
              totalVideosCount: totalNum,
              isFilteredOut: false,
              telegramSent: false,
              telegramError: errMsg,
              scriptId: generatedScript?.id,
            });
          }
        } catch (err: any) {
          setPipelineProgress({
            videoId: currentVideo.id,
            videoTitle: currentVideo.title,
            step: 'done',
            stepNumber: 3,
            stepMessage: `Сценарий готов, но Telegram недоступен: ${err.message}`,
            currentVideoIndex: videoNum,
            totalVideosCount: totalNum,
            isFilteredOut: false,
            telegramSent: false,
            telegramError: err.message,
            scriptId: generatedScript?.id,
          });
        }
      }

      await fetchData();

      if (index < targetVideos.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    if (targetVideos.length > 1 && !cancelPipelineRef.current) {
      setPipelineProgress((prev) =>
        prev
          ? {
              ...prev,
              step: 'done',
              stepMessage: `Обработка завершена! Видео: ${targetVideos.length} | В Telegram: ${sentCount} | Отклонено фильтром: ${rejectedCount}`,
            }
          : null
      );
    }
  };

  const handleRunTelegramPipelineSingle = (video: StoredVideo) => {
    handleRunTelegramPipeline([video.id], settings?.defaultPromptTemplate || 'instagram_editor');
  };

  // Override filter status manually (Approve or Reject)
  const handleOverrideFilter = async (id: string, approve: boolean) => {
    try {
      const res = await fetch(`/api/videos/${id}/override-filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchedFilter: approve }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err: any) {
      console.error('Error overriding filter:', err);
    }
  };

  // Reset video status (e.g. return to Stage 1, reset to new, etc.)
  const handleResetStatus = async (id: string, target: 'stage1' | 'approved' | 'rejected' | 'new') => {
    try {
      const res = await fetch(`/api/videos/${id}/reset-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err: any) {
      console.error('Error resetting status:', err);
    }
  };

  // Delete video
  const handleDeleteVideo = async (id: string) => {
    try {
      await fetch(`/api/videos/${id}`, { method: 'DELETE' });
      setVideos((prev) => prev.filter((v) => v.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (activeDetailVideo?.id === id) {
        setActiveDetailVideo(null);
      }
    } catch (err) {
      console.error('Delete video error:', err);
    }
  };

  const handleToggleArchive = async (video: StoredVideo) => {
    try {
      const res = await fetch(`/api/videos/${video.id}/toggle-archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err: any) {
      console.error('Error toggling archive:', err);
    }
  };

  const handleBatchArchive = async (targetIds?: string[], isArchived: boolean = true) => {
    const ids = targetIds && targetIds.length > 0 ? targetIds : Array.from(selectedIds);
    if (ids.length === 0) return;
    setConfirmConfig({
      isOpen: true,
      title: isArchived ? `Архивировать выбранные видео (${ids.length})?` : `Вернуть из архива (${ids.length})?`,
      description: isArchived
        ? `Скрывает видео из основного списка без удаления. Заархивированные видео можно найти в отдельном фильтре/разделе «Архив» и вернуть обратно.`
        : `Видео будут возвращены из архива в основной список.`,
      confirmText: isArchived ? 'Архивировать' : 'Вернуть',
      cancelText: 'Отмена',
      type: 'warning',
      badge: 'Архив',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/videos/batch-archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoIds: ids, isArchived }),
          });
          if (res.ok) {
            setSelectedIds(new Set());
            await fetchData();
          }
        } catch (err) {
          console.error('Batch archive error:', err);
        }
      },
      onCancel: () => {},
    });
  };

  const handleBatchDelete = async (targetIds?: string[]) => {
    const ids = targetIds && targetIds.length > 0 ? targetIds : Array.from(selectedIds);
    if (ids.length === 0) return;
    setConfirmConfig({
      isOpen: true,
      title: `Удалить выбранные видео (${ids.length})?`,
      description: `Вы действительно хотите удалить выбранные видео из списка? Это действие нельзя отменить.`,
      confirmText: 'Удалить навсегда',
      cancelText: 'Отмена',
      type: 'danger',
      badge: 'Удаление',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/videos/batch-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoIds: ids }),
          });
          if (res.ok) {
            setSelectedIds(new Set());
            await fetchData();
          }
        } catch (err) {
          console.error('Batch delete error:', err);
        }
      },
      onCancel: () => {},
    });
  };

  const handleConfirmBatchExport = (targetIds?: string[]) => {
    const ids = targetIds && targetIds.length > 0 ? targetIds : Array.from(selectedIds);
    if (ids.length === 0) return;
    setConfirmConfig({
      isOpen: true,
      title: `Экспортировать банк идей (${ids.length} видео)?`,
      description: `Будет сформирован экспорт банка идей и сценариев для выбранных видео.`,
      confirmText: 'Экспортировать',
      cancelText: 'Отмена',
      type: 'emerald',
      badge: 'Экспорт',
      onConfirm: () => {
        setIsExportIdeasModalOpen(true);
      },
      onCancel: () => {},
    });
  };

  const handleBatchRecheckFilter = (targetIds: string[]) => {
    if (targetIds.length === 0) return;
    setConfirmConfig({
      isOpen: true,
      title: `Перепроверить фильтром ${targetIds.length} видео?`,
      description: `Ранее полученные вердикты будут пересмотрены моделью Gemini заново.`,
      confirmText: 'Перепроверить',
      cancelText: 'Отмена',
      type: 'primary',
      badge: 'Перепроверка',
      onConfirm: async () => {
        setIsBatchProcessing(true);
        try {
          const res = await fetch('/api/videos/batch-process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoIds: targetIds,
              promptTemplate: 'filter_screener',
            }),
          });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const newQueue = Array.from(new Set([...(data.activeIds || []), ...(data.queuedIds || targetIds)]));
            setBatchQueueIds(newQueue);
            handleClearSelection();
            await fetchData();
            showToast('Перепроверка запущена', `В очередь добавлено: ${targetIds.length} видео`, undefined, 'success');
          }
        } catch (err) {
          console.error('Batch recheck error:', err);
        } finally {
          setIsBatchProcessing(false);
        }
      },
      onCancel: () => {},
    });
  };

  const handleConfirmBatchProcess = (promptTemplate: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const isStage2 = promptTemplate !== 'filter_screener';
    setConfirmConfig({
      isOpen: true,
      title: isStage2 ? `Запустить 2-этапный конвейер для ${ids.length} видео?` : `Запустить проверку фильтром для ${ids.length} видео?`,
      description: isStage2
        ? `Будет выполнен полный цикл (Этап 1 + Этап 2) для выбранных видео.`
        : `Будет выполнен скрининг тем и проверка по фильтру Gemini для выбранных видео.`,
      confirmText: 'Запустить',
      cancelText: 'Отмена',
      type: 'primary',
      badge: isStage2 ? 'Конвейер' : 'Этап 1',
      onConfirm: () => {
        handleProcessBatch(promptTemplate);
      },
      onCancel: () => {},
    });
  };

  // Run sync now
  const handleSyncNow = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await authFetch('/api/sync/run-now', { method: 'POST' });
      if (!res.ok) {
        throw new Error('Ошибка при выполнении синхронизации');
      }
      const data = await res.json();
      await fetchData();

      if (!channels || channels.length === 0) {
        showToast('Синхронизация', 'Нет подключенных каналов для синхронизации', undefined, 'info', true);
      }
    } catch (err: any) {
      console.error('Sync now error:', err);
      showToast(`Ошибка синхронизации: ${err.message || 'Сбой соединения'}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Channel actions
  const handleRefreshChannel = async (id: string) => {
    await fetch(`/api/channels/${id}/refresh`, { method: 'POST' });
    await fetchData();
  };

  const handleToggleChannelSync = async (id: string) => {
    await fetch(`/api/channels/${id}/toggle-sync`, { method: 'POST' });
    await fetchData();
  };

  const handleDeleteChannel = async (id: string) => {
    await fetch(`/api/channels/${id}`, { method: 'DELETE' });
    await fetchData();
  };

  // Settings action
  const handleSaveSettings = async (newSettings: Partial<AppSettings>) => {
    const res = await authFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings),
    });
    if (res.ok) {
      setSettings(await res.json());
      fetchData();
    }
  };

  const handleClearLogs = async () => {
    await fetch('/api/logs/clear', { method: 'POST' });
    setLogs([]);
  };

  if (!isAuthLoading && !authCurrentUser) {
    return <main className="min-h-screen flex items-center justify-center bg-stone-50 p-6">
      <div className="max-w-md rounded-3xl border bg-white p-8 text-center">
        <h1 className="text-2xl font-bold">Content Radar</h1>
        <p className="mt-3 text-stone-600">Войдите, чтобы находить идеи и готовить публикации.</p>
        <button disabled={loginBusy} className="mt-6 rounded-xl bg-stone-900 px-5 py-3 text-white disabled:opacity-50" onClick={async () => {
          setLoginBusy(true);
          setEntryError(null);
          try {
            const result = await googleSignIn();
            if (result?.user) {
              setAuthCurrentUser(result.user);
              setIsAuthLoading(false);
            }
          }
          catch (error: any) { setEntryError(error.message || 'Не удалось войти'); }
          finally { setLoginBusy(false); }
        }}>{loginBusy ? 'Вход…' : 'Войти через Google'}</button>
        {entryError && <p role="alert" className="mt-4 text-sm text-rose-600">{entryError}</p>}
      </div>
    </main>;
  }
  if (authCurrentUser && entryError && !isInitialLoadComplete) {
    return <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p role="alert">{entryError}</p>
      <button onClick={() => setEntryAttempt(value => value + 1)}>Повторить загрузку</button>
    </main>;
  }

  return (
    <div className="min-h-screen bg-stone-50/50 text-stone-900 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {isAuthLoading || !isInitialLoadComplete ? (
        <DashboardSkeleton />
      ) : (
      <>
        {/* Header */}
      <Header
        stats={stats}
        isSyncing={isSyncing}
        selectedCount={selectedIds.size}
        channels={channels}
        onSyncNow={handleSyncNow}
        onOpenDailyActivityModal={() => setIsDailyActivityModalOpen(true)}
        onOpenContentRadar={() => handleProductSectionChange('today')}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        onOpenChannelsModal={() => setIsChannelsModalOpen(true)}
        onOpenExportIdeasModal={() => setIsExportIdeasModalOpen(true)}
        onOpenPromptsModal={() => setIsPromptsModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onOpenLogsModal={() => setIsLogsModalOpen(true)}
        onOpenDeletedVideosModal={() => {
          fetchDeletedVideos();
          setIsDeletedModalOpen(true);
        }}
      />

      <div className="flex flex-1">
        <ProductSidebar active={productSection} onChange={handleProductSectionChange} onboardingComplete={radarOnboardingComplete} />
        <div className="flex-1 min-w-0">
          <div className="lg:hidden px-4 pt-3 flex gap-2 overflow-x-auto">
            {(['today','discover','ideas','scripts','calendar','sources','integrations','settings','library'] as ProductSection[]).map(section => {
              const locked = !radarOnboardingComplete && (section === 'today' || section === 'ideas' || section === 'scripts' || section === 'calendar');
              return (
                <button
                  key={section}
                  disabled={locked}
                  title={locked ? 'Complete Taste Training to unlock' : undefined}
                  onClick={() => handleProductSectionChange(section)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap ${
                    locked
                      ? 'bg-stone-100 text-stone-300 cursor-not-allowed'
                      : productSection === section
                        ? 'bg-stone-900 text-white'
                        : 'bg-white border border-stone-200'
                  }`}
                >
                  {section[0].toUpperCase() + section.slice(1)}{locked ? ' · Locked' : ''}
                </button>
              );
            })}
          </div>
          {productSection !== 'library' ? (
            <RadarWorkspace
              key={authCurrentUser?.uid}
              section={productSection}
              videos={videos}
              channels={channels}
              onNavigate={handleProductSectionChange}
              onRefresh={() => fetchData(false)}
              onOnboardingCompleted={() => setRadarOnboardingComplete(true)}
              onOpenSettings={() => setIsSettingsModalOpen(true)}
              onOpenAddSource={() => setIsAddModalOpen(true)}
              settings={settings}
              onSaveSettings={handleSaveSettings}
              onSyncNow={handleSyncNow}
              isSyncing={isSyncing}
              onOpenPromptsModal={() => setIsPromptsModalOpen(true)}
            />
          ) : (
            <>
      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Intro / Quick Status Banner when no channels or empty */}
        {channels.length === 0 && !isLoading && (
          <div className="bg-gradient-to-r from-stone-900 to-stone-800 text-white rounded-3xl p-6 sm:p-8 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6 flex-wrap">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-xs font-medium text-stone-200">
                <Funnel className="w-3 h-3 text-amber-400" />
                AI Content Funnel: автоматический конвейер
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                Подключите свои каналы для автоматической расшифровки
              </h2>
              <p className="text-xs sm:text-sm text-stone-300 leading-relaxed">
                Вы можете выбрать все старые видео или отдельные ролики для конвертации в текст и передачи в Gemini. 
                Каждый день система сама проверяет каналы на новые видео и автоматически формирует конспекты.
              </p>
            </div>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-5 py-2.5 rounded-xl bg-white text-stone-900 font-semibold text-xs hover:bg-stone-100 transition shadow-sm flex items-center gap-2 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Подключить YouTube канал</span>
            </button>
          </div>
        )}

        {/* CHANGE-3: Mini Metrics & Dashboard Overview Bar with dynamic "Ожидают подтверждения" card */}
        {channels.length > 0 && (() => {
          const pendingPaymentCount = videos.filter((v) => !v.isArchived && v.status === 'requires_payment').length;
          return (
            <div className={`grid grid-cols-2 ${pendingPaymentCount > 0 ? 'sm:grid-cols-3 lg:grid-cols-6' : 'sm:grid-cols-5'} gap-3`}>
              {/* Card 1: Всего видео */}
              <div 
                onClick={() => {
                  setFilterStatus('all');
                  setRejectedSubFilter('all');
                }}
                className="bg-white border border-stone-200/80 p-4 rounded-2xl shadow-2xs flex items-center justify-between transition-all duration-200 group cursor-pointer hover:border-stone-300 hover:shadow-sm hover:-translate-y-0.5"
                title="Показать все видео"
              >
                <div>
                  <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider group-hover:text-stone-900 transition">Всего видео</div>
                  <div className="text-lg font-bold text-stone-900 mt-0.5">{videos.length}</div>
                </div>
                <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center text-stone-700 group-hover:scale-105 transition">
                  <Film className="w-4 h-4" />
                </div>
              </div>

              {/* Card 2: Сценариев готовы */}
              <div 
                onClick={() => {
                  setFilterStatus('has_script');
                  setRejectedSubFilter('all');
                }}
                className="bg-white border border-stone-200/80 p-4 rounded-2xl shadow-2xs flex items-center justify-between transition-all duration-200 group cursor-pointer hover:border-purple-300 hover:shadow-sm hover:-translate-y-0.5"
                title="Показать видео с готовыми сценариями"
              >
                <div>
                  <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider group-hover:text-purple-700 transition">Сценариев готовы</div>
                  <div className="text-lg font-bold text-purple-700 mt-0.5">
                    {videos.filter((v) => getVideoScenarioStatus(v) === 'has_script').length}
                  </div>
                </div>
                <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center text-purple-700 group-hover:scale-105 transition">
                  <Sparkles className="w-4 h-4" />
                </div>
              </div>

              {/* Card 3: Одобрено */}
              <div 
                onClick={() => {
                  setFilterStatus('approved');
                  setRejectedSubFilter('all');
                }}
                className="bg-white border border-stone-200/80 p-4 rounded-2xl shadow-2xs flex items-center justify-between transition-all duration-200 group cursor-pointer hover:border-emerald-300 hover:shadow-sm hover:-translate-y-0.5"
                title="Показать одобренные видео (Этап 1)"
              >
                <div>
                  <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider group-hover:text-emerald-700 transition">Одобрено</div>
                  <div className="text-lg font-bold text-emerald-700 mt-0.5">
                    {videos.filter((v) => !v.isArchived && getVideoScenarioStatus(v) === 'approved').length}
                  </div>
                </div>
                <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700 group-hover:scale-105 transition">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>

              {/* Dynamic Card: Ожидают оплаты */}
              {pendingPaymentCount > 0 && (
                <div 
                  onClick={() => {
                    setFilterStatus('requires_payment');
                    setRejectedSubFilter('all');
                  }}
                  className="bg-amber-50/80 border border-amber-300/90 p-4 rounded-2xl shadow-2xs flex items-center justify-between transition-all duration-200 group col-span-2 sm:col-span-1 cursor-pointer hover:border-amber-400 hover:bg-amber-100/70 hover:shadow-sm hover:-translate-y-0.5"
                  title="Показать видео, ожидающие подтверждения оплаты"
                >
                  <div>
                    <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider group-hover:text-amber-900 transition">
                      Ожидают оплаты
                    </div>
                    <div className="text-lg font-bold text-amber-700 mt-0.5 flex items-center gap-1.5">
                      <span>{pendingPaymentCount}</span>
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                    </div>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 group-hover:scale-105 transition">
                    <Sparkles className="w-4 h-4" />
                  </div>
                </div>
              )}

              {/* Card 4: Каналов в работе */}
              <div 
                onClick={() => setIsChannelsModalOpen(true)}
                className="bg-white border border-stone-200/80 p-4 rounded-2xl shadow-2xs flex items-center justify-between transition-all duration-200 group cursor-pointer hover:border-red-300 hover:shadow-sm hover:-translate-y-0.5"
                title="Управление отслеживаемыми каналами"
              >
                <div>
                  <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider group-hover:text-red-600 transition">Каналов в работе</div>
                  <div className="text-lg font-bold text-red-600 mt-0.5">{channels.length}</div>
                </div>
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center text-red-600 group-hover:scale-105 transition">
                  <Radio className="w-4 h-4" />
                </div>
              </div>

              {/* Card 5: В обработке */}
              <div 
                onClick={() => setIsQueueModalOpen(true)}
                className="bg-white border border-stone-200/80 p-4 rounded-2xl shadow-2xs flex items-center justify-between col-span-2 sm:col-span-1 transition-all duration-200 group cursor-pointer hover:border-sky-300 hover:shadow-sm hover:-translate-y-0.5"
                title="Очередь и монитор обработки видео"
              >
                <div>
                  <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider group-hover:text-sky-600 transition">В обработке</div>
                  <div className="text-sm sm:text-base font-bold text-sky-600 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>{videos.filter((v) => v.status === 'transcribing' || v.status === 'processing_gemini').length}</span>
                    {(() => {
                      const activeIds = new Set(videos.filter((v) => v.status === 'transcribing' || v.status === 'processing_gemini').map((v) => v.id));
                      const queuedCount = batchQueueIds.filter((id) => !activeIds.has(id)).map((id) => videos.find((v) => v.id === id)).filter((v) => !!v && v.status !== 'completed').length;
                      return queuedCount > 0 ? (
                        <span className="text-[11px] font-normal text-stone-500">
                          (очередь: {queuedCount})
                        </span>
                      ) : null;
                    })()}
                  </div>
                </div>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center relative group-hover:scale-105 transition ${videos.filter((v) => v.status === 'transcribing' || v.status === 'processing_gemini').length > 0 || batchQueueIds.length > 0 ? 'bg-sky-50 text-sky-600' : 'bg-stone-100 text-stone-400'}`}>
                  {videos.filter((v) => v.status === 'transcribing' || v.status === 'processing_gemini').length > 0 || batchQueueIds.length > 0 ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-ping absolute" />
                      <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                    </>
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-stone-400" />
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Requires Payment Warning / Confirmation Banner */}
        {(() => {
          const pendingVideos = videos.filter((v) => !v.isArchived && v.status === 'requires_payment');
          if (pendingVideos.length === 0) return null;
          return (
            <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border border-amber-300 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-amber-950 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-sm flex items-center gap-2">
                    <span>Ожидают подтверждения платного запуска: {pendingVideos.length} видео</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-900 border border-amber-300">
                      Расход Gemini API
                    </span>
                  </div>
                  <div className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                    Новые видео остановлены фоновым планировщиком перед платным этапом (фильтр или сценарий). Вы можете подтвердить запуск поштучно в карточках или подтвердить всю группу со сметой расходов.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus('requires_payment');
                    setRejectedSubFilter('all');
                  }}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-amber-300 text-amber-900 hover:bg-amber-100/70 transition shadow-2xs cursor-pointer"
                >
                  Показать в списке ({pendingVideos.length})
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAllPendingPayment}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Подтвердить все ({pendingVideos.length})</span>
                </button>
              </div>
            </div>
          );
        })()}

        {/* Quota / Rate Limit Warning Banner */}
        {videos.some(v => v.status === 'error' && v.error && (v.error.toLowerCase().includes('quota') || v.error.toLowerCase().includes('resource_exhausted') || v.error.includes('429'))) && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-red-900 shadow-sm mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-sm">⚠️ Лимит бесплатных запросов Gemini (Rate Limit / Quota Exceeded)</div>
                <div className="text-xs text-red-700 mt-0.5 leading-relaxed">
                  API квота временно исчерпана. Фоновая очередь полностью остановлена, автоматические перезапуски заблокированы. Вы можете очистить ошибки и сбросить очередь в исходное состояние.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
              <button
                type="button"
                onClick={async () => {
                  setBatchQueueIds([]);
                  const errorIds = videos.filter(v => v.status === 'error').map(v => v.id);
                  if (errorIds.length > 0) {
                    await fetch('/api/videos/batch-stop', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ videoIds: errorIds }),
                    });
                  }
                  await fetchData();
                  showToast('Очередь и ошибки сброшены', 'Все зависшие в ошибках видео возвращены в исходное состояние.', undefined, 'success');
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition shadow-xs whitespace-nowrap cursor-pointer"
              >
                Очистить очередь и сбросить ошибки
              </button>
            </div>
          </div>
        )}

        {/* Filter Controls: Sticky Header & Restructured Tabs */}
        <div className="sticky top-16 z-20 bg-white/95 backdrop-blur-md rounded-2xl border border-stone-200/90 p-3.5 sm:p-4 shadow-xs space-y-3">
          {/* Row 1: Search Input (left, ~40%), Channel dropdown, Sort dropdown (right) */}
          <div className="flex flex-col lg:flex-row w-full gap-4 items-start lg:items-center">
            <div className="flex-grow w-full min-w-[250px] lg:min-w-[400px] relative">
              {isSearching ? (
                <Loader2 className="w-4 h-4 text-amber-600 absolute left-3.5 top-2.5 animate-spin" />
              ) : (
                <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-2.5" />
              )}
              <input
                id="search-videos-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по названию видео или каналу..."
                className="w-full pl-9 pr-4 py-1.5 text-xs bg-stone-50 border border-stone-300/80 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2 text-xs text-stone-400 hover:text-stone-700 transition cursor-pointer"
                >
                  Очистить
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row flex-wrap items-center gap-3 shrink-0">
              <div className="relative min-w-[150px] w-full sm:w-auto">
                <select
                  value={filterChannel}
                  onChange={(e) => setFilterChannel(e.target.value)}
                  className="w-full text-xs bg-stone-50 border border-stone-300/80 rounded-xl px-3 py-1.5 pr-8 text-stone-800 focus:outline-none appearance-none transition cursor-pointer"
                >
                  <option value="all">Все каналы ({channels.length})</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-stone-500 absolute right-2.5 top-2.5 pointer-events-none" />
              </div>

              {(stage1PromptTemplates.length > 0 || stage2PromptTemplates.length > 0) && (
                <div className="relative min-w-[180px] max-w-[320px] w-full sm:w-auto">
                  <select
                    value={filterPrompt}
                    onChange={(e) => setFilterPrompt(e.target.value)}
                    className={`w-full text-xs border rounded-xl px-3 py-1.5 pr-8 text-stone-800 focus:outline-none appearance-none transition cursor-pointer truncate ${
                      filterPrompt !== 'all'
                        ? 'bg-indigo-50/80 border-indigo-300 text-indigo-950 font-semibold shadow-2xs'
                        : 'bg-stone-50 border-stone-300/80'
                    }`}
                  >
                    <option value="all">Все промпты ({totalProcessedCount})</option>

                    {stage1PromptTemplates.length > 0 && (
                      <optgroup label="Этап 1: Фильтр тем и Банк идей">
                        <option value="stage1">Все промпты Этапа 1 ({stage1Count})</option>
                        {stage1PromptTemplates.map((t) => {
                          const count = promptSpecificCounts[`stage1:${t.id}`] || 0;
                          return (
                            <option key={`stage1:${t.id}`} value={`stage1:${t.id}`}>
                              {t.name} ({count})
                            </option>
                          );
                        })}
                      </optgroup>
                    )}

                    {stage2PromptTemplates.length > 0 && (
                      <optgroup label="Этап 2: Покадровые сценарии Reels">
                        <option value="stage2">Все промпты Этапа 2 ({stage2Count})</option>
                        {stage2PromptTemplates.map((t) => {
                          const count = promptSpecificCounts[`stage2:${t.id}`] || 0;
                          return (
                            <option key={`stage2:${t.id}`} value={`stage2:${t.id}`}>
                              {t.name} ({count})
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                  <ChevronDown className={`w-3.5 h-3.5 absolute right-2.5 top-2.5 pointer-events-none ${filterPrompt !== 'all' ? 'text-indigo-600' : 'text-stone-500'}`} />
                </div>
              )}

              <div className="relative min-w-[160px] w-full sm:w-auto">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="w-full text-xs bg-stone-50 border border-stone-300/80 rounded-xl px-3 py-1.5 pr-8 text-stone-800 focus:outline-none appearance-none font-medium transition cursor-pointer"
                >
                  <option value="date_desc">📅 Сначала новые (по дате)</option>
                  <option value="date_asc">📅 Сначала старые</option>
                  <option value="updated_desc">🔄 Недавно обновлённые</option>
                  <option value="title_asc">🔤 По названию (А-Я)</option>
                </select>
                <ArrowUpDown className="w-3.5 h-3.5 text-stone-500 absolute right-2.5 top-2.5 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Row 2: Frequent tabs + "Ещё" dropdown */}
          {(() => {
            const channelVideos = videos.filter((v) => {
              if (filterChannel !== 'all' && v.channelId !== filterChannel) return false;
              if (filterPrompt !== 'all' && !matchesPromptFilter(v, filterPrompt)) return false;
              return true;
            });
            const activeChannelVideos = channelVideos.filter((v) => !v.isArchived);
            const requiresPaymentCount = activeChannelVideos.filter((v) => v.status === 'requires_payment').length;
            const reviewedCount = activeChannelVideos.filter((v) => getVideoScenarioStatus(v) === 'reviewed').length;
            const hasScriptCount = activeChannelVideos.filter((v) => getVideoScenarioStatus(v) === 'has_script').length;
            const approvedCount = activeChannelVideos.filter((v) => getVideoScenarioStatus(v) === 'approved').length;
            const rejectedCount = activeChannelVideos.filter((v) => getVideoScenarioStatus(v) === 'rejected' || v.status === 'error').length;
            const transcribedCount = activeChannelVideos.filter((v) => getVideoScenarioStatus(v) === 'transcribed').length;
            const noScriptCount = activeChannelVideos.filter((v) => getVideoScenarioStatus(v) === 'no_script').length;
            const archiveCount = channelVideos.filter((v) => v.isArchived).length;

            // Frequent tabs shown directly in the primary row
            const frequentTabs = [
              { id: 'all', label: 'Все', count: activeChannelVideos.length, activeColor: 'bg-stone-900 text-white' },
              { id: 'no_script', label: 'Не обработано', count: noScriptCount, activeColor: 'bg-stone-800 text-white' },
              { id: 'approved', label: 'Одобрено', count: approvedCount, activeColor: 'bg-emerald-600 text-white' },
              { id: 'has_script', label: 'Сценарий готов', count: hasScriptCount, activeColor: 'bg-purple-600 text-white' },
              { id: 'rejected', label: 'Отклонено', count: rejectedCount, activeColor: 'bg-amber-800 text-white' },
            ];

            // If pending payment exists, elevate to frequent row
            if (requiresPaymentCount > 0) {
              frequentTabs.splice(1, 0, {
                id: 'requires_payment',
                label: 'Ожидают оплаты',
                count: requiresPaymentCount,
                activeColor: 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-xs'
              });
            }

            // Rare tabs tucked inside "Ещё" dropdown
            const rareTabs = [
              { id: 'transcribed', label: 'Транскрипция готова', count: transcribedCount },
              { id: 'reviewed', label: 'Обработано', count: reviewedCount },
              ...(requiresPaymentCount === 0 ? [{ id: 'requires_payment', label: 'Ожидают оплаты', count: 0 }] : []),
              { id: 'archive', label: 'Архив', count: archiveCount },
            ];

            const isRareTabActive = rareTabs.some((t) => t.id === filterStatus);
            const activeRareTab = rareTabs.find((t) => t.id === filterStatus);

            return (
              <div className="flex flex-col gap-2 w-full">
                <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-stone-100 text-xs">
                  {frequentTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        if (filterStatus === tab.id && rejectedSubFilter === 'all') return;
                        setFilterStatus(tab.id);
                        setRejectedSubFilter('all');
                      }}
                      className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                        filterStatus === tab.id
                          ? tab.activeColor
                          : tab.id === 'requires_payment' && requiresPaymentCount > 0
                          ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 font-semibold'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200/80'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        filterStatus === tab.id ? 'bg-white/20 text-white' : 'bg-black/5 text-stone-700'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}

                  {/* "Ещё" Dropdown Menu */}
                  <div className="relative" ref={moreFilterRef}>
                    <button
                      type="button"
                      onClick={() => setIsMoreFilterOpen(!isMoreFilterOpen)}
                      className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                        isRareTabActive
                          ? 'bg-stone-900 text-white'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200/80'
                      }`}
                    >
                      <span>{isRareTabActive && activeRareTab ? activeRareTab.label : 'Ещё'}</span>
                      {isRareTabActive && activeRareTab ? (
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white">
                          {activeRareTab.count}
                        </span>
                      ) : null}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isMoreFilterOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isMoreFilterOpen && (
                      <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-52 bg-white border border-stone-200 rounded-xl shadow-lg p-1 z-30 flex flex-col gap-0.5">
                        {rareTabs.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                              setFilterStatus(tab.id);
                              setRejectedSubFilter('all');
                              setIsMoreFilterOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-left rounded-lg text-xs font-semibold flex items-center justify-between transition cursor-pointer ${
                              filterStatus === tab.id
                                ? 'bg-stone-900 text-white'
                                : 'text-stone-700 hover:bg-stone-100'
                            }`}
                          >
                            <span>{tab.label}</span>
                            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                              filterStatus === tab.id ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'
                            }`}>
                              {tab.count}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Compact sub-filter for rejection causes */}
                {filterStatus === 'rejected' && (() => {
                  const rejectedVideosList = activeChannelVideos.filter(
                    (v) => getVideoScenarioStatus(v) === 'rejected' || v.status === 'error'
                  );
                  const themeCount = rejectedVideosList.filter(
                    (v) => v.status !== 'error' && !isMissingTranscriptRejection(v)
                  ).length;
                  const transcriptionCount = rejectedVideosList.filter(
                    (v) => v.status !== 'error' && isMissingTranscriptRejection(v)
                  ).length;
                  const errorCount = rejectedVideosList.filter((v) => v.status === 'error').length;

                  return (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-stone-100 text-xs text-stone-600">
                      <span className="text-[11px] font-medium text-stone-400 mr-1">Причина отказа:</span>
                      {[
                        { id: 'all', label: 'Все причины', count: rejectedVideosList.length },
                        { id: 'theme', label: 'Не по теме', count: themeCount },
                        { id: 'transcription', label: 'Нет текста', count: transcriptionCount },
                        { id: 'error', label: 'Ошибки', count: errorCount },
                      ].map((sub) => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => {
                            if (rejectedSubFilter === sub.id) return;
                            setRejectedSubFilter(sub.id as any);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5 cursor-pointer ${
                            rejectedSubFilter === sub.id
                              ? 'bg-amber-800 text-white shadow-2xs'
                              : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                          }`}
                        >
                          <span>{sub.label}</span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${
                            rejectedSubFilter === sub.id ? 'bg-white/20 text-white' : 'bg-stone-200 text-stone-600'
                          }`}>
                            {sub.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>

        {/* Compact Filter Error Banner if error occurred */}
        {filterError && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-900 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <div className="text-xs">
                <span className="font-bold">Ошибка фильтрации: </span>
                <span className="text-rose-700">{filterError}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setFilterStatus('all');
                setRejectedSubFilter('all');
                setFilterChannel('all');
                setFilterPrompt('all');
                setSearchQuery('');
                setSortBy('date_desc');
                setFilterError(null);
              }}
              className="px-3 py-1.5 text-xs font-semibold text-rose-800 bg-rose-100 hover:bg-rose-200 rounded-xl transition cursor-pointer shrink-0"
            >
              Сбросить фильтры
            </button>
          </div>
        )}

        {/* Video Grid or Empty State */}
        {isLoading ? (
          <div className="py-24 text-center">
            <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-stone-600">Загрузка видеотеки...</p>
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-stone-300 p-10 text-center max-w-lg mx-auto my-12">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 text-stone-400 flex items-center justify-center mx-auto mb-3">
              <Youtube className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-stone-800">Видео не найдены</h3>
            <p className="text-xs text-stone-500 mt-1 mb-4 leading-relaxed">
              {appliedSearchQuery || appliedFilterChannel !== 'all' || appliedFilterPrompt !== 'all' || appliedFilterStatus !== 'all'
                ? 'Попробуйте сбросить поисковые фильтры.'
                : 'Подключите YouTube канал или добавьте видео по ссылке, чтобы начать.'}
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {(appliedSearchQuery || appliedFilterChannel !== 'all' || appliedFilterPrompt !== 'all' || appliedFilterStatus !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus('all');
                    setRejectedSubFilter('all');
                    setFilterChannel('all');
                    setFilterPrompt('all');
                    setSearchQuery('');
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Сбросить фильтры</span>
                </button>
              )}
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 rounded-xl transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить видео или канал</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
              {visibleVideos.map((video) => {
                const scriptCount = scripts.filter((s) => s.videoIds?.includes(video.id)).length;
                const scenarioStatus = getVideoScenarioStatus(video);

                return (
                  <VideoCard
                    key={video.id}
                    video={video}
                    isSelected={selectedIds.has(video.id)}
                    scriptCount={scriptCount}
                    scenarioStatus={scenarioStatus}
                    activePipelineStepMessage={
                      pipelineProgress?.videoId === video.id ? pipelineProgress.stepMessage : undefined
                    }
                    onToggleSelect={handleToggleSelect}
                    onOpenDetail={(v) => setActiveDetailVideo(v)}
                    onToggleReviewed={handleToggleReviewed}
                    onRunStage1={handleRunStage1}
                    onRunStage2={handleRunStage2}
                    onProcessSingle={(v) => handleProcessSingle(v)}
                    onRunTelegramPipelineSingle={handleRunTelegramPipelineSingle}
                    onOverrideFilter={handleOverrideFilter}
                    onResetStatus={handleResetStatus}
                    onDelete={handleDeleteVideo}
                    onToggleArchive={handleToggleArchive}
                    onSelectChannel={(channelId) => {
                      setFilterChannel(channelId);
                    }}
                    onStopProcess={handleStopProcess}
                    onTranscribe={handleTranscribeSingle}
                    onRetryStep={handleRetryStep}
                  />
                );
              })}
            </div>

            {/* Subtask D: Progressive chunk loading sentinel & counter (No 'show all' button to keep 60fps) */}
            <div ref={sentinelRef} className="py-8 flex flex-col items-center justify-center gap-2 text-xs">
              {visibleCount < filteredVideos.length ? (
                <div className="flex items-center gap-2 text-stone-600 bg-white px-4 py-2 rounded-xl border border-stone-200/80 shadow-2xs">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-500" />
                  <span>Показано {visibleVideos.length} из {filteredVideos.length} видео</span>
                </div>
              ) : filteredVideos.length > CHUNK_SIZE ? (
                <span className="text-stone-400 font-medium">
                  Все {filteredVideos.length} видео показаны
                </span>
              ) : null}
            </div>
          </>
        )}
      </main>
            </>
          )}
        </div>
      </div>

      {/* Floating Bottom Toolbar for Batch Actions */}
      {productSection === 'library' && <BatchActionToolbar
        selectedVideos={filteredVideos.filter((v) => selectedIds.has(v.id))}
        totalCount={filteredVideos.length}
        onSelectAll={handleSelectAllFiltered}
        onClearSelection={handleClearSelection}
        onSelectByStatus={handleSelectByStatus}
        onBatchTranscribe={handleBatchTranscribe}
        onBatchStage1={handleBatchStage1}
        onBatchStage2={handleBatchStage2}
        onBatchConfirmPayment={handleBatchConfirmPayment}
        onBatchRetryStep={handleBatchRetryStep}
        onRunTelegramPipeline={(targetIds, template, customPrompt) => {
          handleRunTelegramPipeline(targetIds, template, customPrompt);
        }}
        onOpenExportIdeas={(targetIds) => handleConfirmBatchExport(targetIds)}
        onBatchArchive={(targetIds, isArchived) => handleBatchArchive(targetIds, isArchived)}
        onBatchDelete={(targetIds) => handleBatchDelete(targetIds)}
        onBatchStop={(targetIds) => {
          if (targetIds && targetIds.length > 0) {
            handleBatchStop();
          }
        }}
        onBatchRecheck={handleBatchRecheckFilter}
        isProcessing={isBatchProcessing}
        pipelineProgress={pipelineProgress}
        onCancelPipeline={() => {
          cancelPipelineRef.current = true;
          setPipelineProgress((prev) =>
            prev ? { ...prev, stepMessage: 'Отменено пользователем' } : null
          );
        }}
        onClearPipelineProgress={() => setPipelineProgress(null)}
      />}

      <ConfirmModal config={confirmConfig} onClose={() => setConfirmConfig(null)} />
      <ConfirmPaidActionModal {...paidModalState} onClose={closePaidModal} />

      {/* Video Detail Modal */}
      <VideoDetailModal
        video={activeDetailVideo}
        allScripts={scripts}
        initialPromptFilter={appliedFilterPrompt}
        onClose={() => setActiveDetailVideo(null)}
        onToggleReviewed={handleToggleReviewed}
        onStopProcess={handleStopProcess}
        onReProcess={(v, t, c) => handleProcessSingle(v, t, c)}
        onScriptCreated={fetchData}
        onResetStatus={handleResetStatus}
        isProcessing={activeDetailVideo?.status === 'transcribing' || activeDetailVideo?.status === 'processing_gemini'}
        activePipelineStepMessage={pipelineProgress?.stepMessage}
      />

      <ContentRadar
        isOpen={isContentRadarOpen}
        onClose={() => setIsContentRadarOpen(false)}
        videos={videos}
        channels={channels}
        onRefresh={() => fetchData(false)}
      />

      {/* Quota & API Monitor Modal */}
      <QuotaMonitorModal
        isOpen={isDailyActivityModalOpen}
        onClose={() => setIsDailyActivityModalOpen(false)}
        serverDailyActivity={stats?.dailyActivity}
        activeProcessingCount={videos.filter((v) => v.status === 'transcribing' || v.status === 'processing_gemini').length}
        batchQueueCount={batchQueueIds.length}
      />

      {/* Export Ideas to Google Docs Modal */}
      <ExportIdeasModal
        isOpen={isExportIdeasModalOpen}
        onClose={() => setIsExportIdeasModalOpen(false)}
        videos={videos}
        channels={channels}
        scripts={scripts}
        selectedVideoIds={Array.from(selectedIds)}
      />

      {/* Prompts Library Modal */}
      <PromptsModal
        isOpen={isPromptsModalOpen}
        onClose={() => {
          setIsPromptsModalOpen(false);
          fetchData();
        }}
        currentSettings={settings || undefined}
        onUpdateSettings={handleSaveSettings}
        onPromptsUpdated={fetchData}
      />

      {/* Add Source Modal */}
      <AddSourceModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onChannelAdded={fetchData}
        onVideoAdded={fetchData}
      />

      {/* Channels Modal */}
      <ChannelsModal
        isOpen={isChannelsModalOpen}
        onClose={() => setIsChannelsModalOpen(false)}
        channels={channels}
        onRefreshChannel={handleRefreshChannel}
        onToggleSync={handleToggleChannelSync}
        onDeleteChannel={handleDeleteChannel}
        onOpenAddModal={() => setIsAddModalOpen(true)}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        onSyncNow={handleSyncNow}
        isSyncing={isSyncing}
        onOpenPromptsModal={() => setIsPromptsModalOpen(true)}
        videos={videos}
      />

      {/* Logs Modal */}
      <LogsModal
        isOpen={isLogsModalOpen}
        onClose={() => setIsLogsModalOpen(false)}
        logs={logs}
        onRefreshLogs={fetchData}
        onClearLogs={handleClearLogs}
      />

      {/* Queue Modal */}
      <QueueModal
        isOpen={isQueueModalOpen}
        onClose={() => setIsQueueModalOpen(false)}
        videos={videos}
        batchQueueIds={batchQueueIds}
        onStopProcess={handleStopProcess}
        onClearAllQueue={handleClearAllQueue}
        onRetryRateLimited={handleRetryRateLimited}
      />

      {/* Deleted Videos (Blacklist / History) Modal */}
      <DeletedVideosModal
        isOpen={isDeletedModalOpen}
        onClose={() => setIsDeletedModalOpen(false)}
        deletedVideos={deletedVideos}
        onRestore={handleRestoreDeletedVideos}
        onIgnore={handleIgnoreDeletedVideos}
      />

      {/* Prompt Detected Previously Deleted Videos Modal */}
      <DeletedVideosModal
        isOpen={isPromptDeletedModalOpen}
        onClose={() => setIsPromptDeletedModalOpen(false)}
        deletedVideos={promptDeletedVideos}
        onRestore={handleRestoreDeletedVideos}
        onIgnore={handleIgnoreDeletedVideos}
        isPromptMode={true}
      />

      {/* Global Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
      </>
      )}
    </div>
  );
}
