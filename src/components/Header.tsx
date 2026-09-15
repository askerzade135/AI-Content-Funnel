import React, { useState, useEffect, useRef } from 'react';
import { Youtube, Sparkles, RefreshCw, Settings, History, Plus, Radio, FileSpreadsheet, LogIn, LogOut, MoreVertical, Menu, X, Activity, Trash2 } from 'lucide-react';
import { AppStats } from '../types';
import { initAuth, googleSignIn, logout } from '../services/googleAuth';
import { User } from 'firebase/auth';

interface HeaderProps {
  stats: AppStats | null;
  isSyncing: boolean;
  selectedCount?: number;
  onSyncNow: () => void;
  onOpenDailyActivityModal?: () => void;
  onOpenAddModal: () => void;
  onOpenChannelsModal: () => void;
  onOpenExportIdeasModal: () => void;
  onOpenPromptsModal: () => void;
  onOpenSettingsModal: () => void;
  onOpenLogsModal: () => void;
  onOpenDeletedVideosModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  stats,
  isSyncing,
  selectedCount = 0,
  onSyncNow,
  onOpenDailyActivityModal,
  onOpenAddModal,
  onOpenChannelsModal,
  onOpenExportIdeasModal,
  onOpenPromptsModal,
  onOpenSettingsModal,
  onOpenLogsModal,
  onOpenDeletedVideosModal,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user) => setCurrentUser(user),
      () => setCurrentUser(null)
    );
    return () => unsubscribe();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res?.user) {
        setCurrentUser(res.user);
      }
    } catch (err) {
      console.warn('Sign in error:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await logout();
      setCurrentUser(null);
    } catch (err) {
      console.warn('Sign out error:', err);
    }
  };

  return (
    <header id="app-header" className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-stone-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-600 text-white flex items-center justify-center shadow-xs">
              <Youtube className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold text-stone-900 tracking-tight">
                  YouTube → Gemini
                </h1>
                <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  <Sparkles className="w-3 h-3" />
                  AI Sync
                </span>
              </div>
            </div>
          </div>

          {/* Clean Action Toolbar */}
          <div className="flex items-center gap-2">
            {/* Sync Button */}
            <button
              id="btn-header-sync"
              onClick={onSyncNow}
              disabled={isSyncing}
              title="Проверить каналы"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 transition disabled:opacity-60 shadow-2xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-indigo-600' : 'text-stone-500'}`} />
              <span className="hidden sm:inline">{isSyncing ? 'Проверка...' : 'Синхронизация'}</span>
            </button>

            {/* Daily Activity Button */}
            {onOpenDailyActivityModal && (
              <button
                id="btn-header-daily-activity"
                type="button"
                onClick={onOpenDailyActivityModal}
                title="Дневная активность конвейера за 24 часа"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-amber-200 bg-amber-50/60 hover:bg-amber-100/70 text-amber-900 transition shadow-2xs"
              >
                <Activity className="w-3.5 h-3.5 text-amber-700" />
                <span className="hidden sm:inline">Дневная активность</span>
              </button>
            )}

            {/* Primary Add Button */}
            <button
              id="btn-header-add"
              onClick={onOpenAddModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-stone-900 text-white hover:bg-stone-800 shadow-sm transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Добавить видео</span>
            </button>

            {/* Google Auth Status / Login */}
            {currentUser ? (
              <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-stone-200">
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt={currentUser.displayName || 'User'}
                    className="w-7 h-7 rounded-full border border-emerald-300"
                    title={currentUser.email || currentUser.displayName || ''}
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center">
                    {(currentUser.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleSignOut}
                  title="Выйти из Google"
                  className="p-1 text-stone-400 hover:text-rose-600 rounded-lg transition"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                disabled={isLoggingIn}
                title="Подключить Google аккаунт"
                className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 transition disabled:opacity-60"
              >
                <LogIn className="w-3.5 h-3.5 text-blue-600" />
                <span>{isLoggingIn ? 'Вход...' : 'Войти в Google'}</span>
              </button>
            )}

            {/* More Menu Dropdown for Channels, Prompts, Logs, Settings */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-2 text-stone-600 hover:text-stone-900 rounded-xl hover:bg-stone-100 border border-stone-200 transition"
                title="Меню и настройки"
              >
                <Menu className="w-4 h-4" />
              </button>

              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-stone-200 py-2 z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400 border-b border-stone-100 mb-1">
                    Управление и настройки
                  </div>

                  <button
                    onClick={() => { setIsMenuOpen(false); onOpenChannelsModal(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 transition"
                  >
                    <Radio className="w-4 h-4 text-red-500" />
                    <span>Каналы ({stats?.channelCount || 0})</span>
                  </button>

                  <button
                    onClick={() => { setIsMenuOpen(false); onOpenPromptsModal(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 transition"
                  >
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <span>Промпты Gemini</span>
                  </button>

                  <button
                    onClick={() => { setIsMenuOpen(false); onOpenLogsModal(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 transition"
                  >
                    <History className="w-4 h-4 text-stone-500" />
                    <span>Журнал активности</span>
                  </button>

                  <button
                    onClick={() => { setIsMenuOpen(false); onOpenSettingsModal(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 transition"
                  >
                    <Settings className="w-4 h-4 text-stone-500" />
                    <span>Настройки расписания</span>
                  </button>

                  {onOpenDeletedVideosModal && (
                    <button
                      onClick={() => { setIsMenuOpen(false); onOpenDeletedVideosModal(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 transition"
                    >
                      <Trash2 className="w-4 h-4 text-stone-500" />
                      <span>Удалённые видео</span>
                    </button>
                  )}

                  {/* Mobile Google Auth inside dropdown */}
                  <div className="border-t border-stone-100 mt-1 pt-1 sm:hidden">
                    {currentUser ? (
                      <button
                        onClick={() => { setIsMenuOpen(false); handleSignOut(); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Выйти из Google</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => { setIsMenuOpen(false); handleSignIn(); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 transition"
                      >
                        <LogIn className="w-4 h-4" />
                        <span>Войти в Google</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
