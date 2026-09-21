import React from 'react';
import { Sparkles } from 'lucide-react';
import { AppStats, TrackedChannel } from '../types';

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

export const Header: React.FC<HeaderProps> = () => {
  return (
    <header id="app-header" className="lg:hidden sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur-md">
      <div className="h-14 px-4 sm:px-5 flex items-center">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-stone-900 text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-stone-900 truncate">Content Radar</div>
            <div className="hidden sm:block text-[10px] leading-none mt-0.5 text-stone-400">editorial intelligence</div>
          </div>
        </div>
      </div>
    </header>
  );
};
