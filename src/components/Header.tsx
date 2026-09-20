import React, { useEffect, useRef, useState } from 'react';
import { Activity, History, LogOut, Menu, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { AppStats, TrackedChannel } from '../types';
import { initAuth, logout } from '../services/googleAuth';
import { User } from 'firebase/auth';

interface HeaderProps {
  stats: AppStats | null;
  isSyncing: boolean;
  selectedCount?: number;
  channels: TrackedChannel[];
  onSyncNow: () => void;
  onOpenDailyActivityModal?: () => void;
  onOpenContentRadar?: () => void;
  onOpenAddModal: () => void;
  onOpenChannelsModal: () => void;
  onOpenExportIdeasModal: () => void;
  onOpenPromptsModal: () => void;
  onOpenSettingsModal: () => void;
  onOpenLogsModal: () => void;
  onOpenDeletedVideosModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isSyncing,
  channels,
  onSyncNow,
  onOpenDailyActivityModal,
  onOpenAddModal,
  onOpenPromptsModal,
  onOpenLogsModal,
  onOpenDeletedVideosModal,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user) => setCurrentUser(user),
      () => setCurrentUser(null)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    try {
      await logout();
      setCurrentUser(null);
    } catch (err) {
      console.warn('Sign out error:', err);
    }
  };

  return (
    <header id="app-header" className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur-md">
      <div className="h-14 px-4 sm:px-5 lg:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-stone-900 text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-stone-900 truncate">Content Radar</div>
            <div className="hidden sm:block text-[10px] leading-none mt-0.5 text-stone-400">editorial intelligence</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-header-add"
            onClick={onOpenAddModal}
            className="inline-flex items-center justify-center h-9 px-3.5 text-xs font-semibold whitespace-nowrap rounded-xl bg-stone-900 text-white hover:bg-stone-800 shadow-sm transition"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="ml-1.5 hidden xs:inline">Добавить источник</span>
            <span className="ml-1.5 xs:hidden">Добавить</span>
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setIsMenuOpen((value) => !value)}
              className="h-9 flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-2 hover:bg-stone-50 transition"
              title="Аккаунт и служебные действия"
            >
              {currentUser?.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'User'}
                  className="w-6 h-6 rounded-full"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center">
                  {(currentUser?.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <Menu className="w-3.5 h-3.5 text-stone-500" />
            </button>

            {isMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-stone-200 bg-white p-2 shadow-xl z-50">
                {currentUser && (
                  <div className="px-3 py-2 border-b border-stone-100 mb-1">
                    <div className="text-xs font-semibold text-stone-800 truncate">{currentUser.displayName || 'Аккаунт'}</div>
                    <div className="text-[10px] text-stone-400 truncate mt-0.5">{currentUser.email}</div>
                  </div>
                )}

                {channels.length > 0 && (
                  <button
                    onClick={() => { setIsMenuOpen(false); onSyncNow(); }}
                    disabled={isSyncing}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    {isSyncing ? 'Синхронизация…' : 'Синхронизировать источники'}
                  </button>
                )}

                {onOpenDailyActivityModal && (
                  <button
                    onClick={() => { setIsMenuOpen(false); onOpenDailyActivityModal(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    <Activity className="w-4 h-4" />
                    Диагностика и квоты
                  </button>
                )}

                <button
                  onClick={() => { setIsMenuOpen(false); onOpenPromptsModal(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  <Sparkles className="w-4 h-4" />
                  Промпты
                </button>

                <button
                  onClick={() => { setIsMenuOpen(false); onOpenLogsModal(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  <History className="w-4 h-4" />
                  Журнал активности
                </button>

                {onOpenDeletedVideosModal && (
                  <button
                    onClick={() => { setIsMenuOpen(false); onOpenDeletedVideosModal(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Удалённый контент
                  </button>
                )}

                <div className="border-t border-stone-100 mt-1 pt-1">
                  <button
                    onClick={() => { setIsMenuOpen(false); handleSignOut(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut className="w-4 h-4" />
                    Выйти
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
