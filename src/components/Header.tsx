import React from 'react';
import { AppStats, TrackedChannel } from '../types';
import { BrandLockup } from './BrandLogo';

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
        <BrandLockup compact className="min-w-0" markClassName="h-8 w-8 p-1" />
      </div>
    </header>
  );
};
