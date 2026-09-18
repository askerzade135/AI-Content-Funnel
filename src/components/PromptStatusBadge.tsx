import React from 'react';
import { Film, Lightbulb, AlertTriangle, AlertCircle, Loader2, Clock, CheckCircle2, FileText } from 'lucide-react';
import { StoredVideo, PromptRunRecord } from '../types';
import { getPromptBadgeInfo } from '../utils/video-actions';

interface PromptStatusBadgeProps {
  video?: StoredVideo;
  run?: PromptRunRecord;
  className?: string;
  showIcon?: boolean;
}

export const PromptStatusBadge: React.FC<PromptStatusBadgeProps> = ({
  video,
  run,
  className = '',
  showIcon = true,
}) => {
  if (!video && !run) return null;

  const mockVideo: StoredVideo = video || {
    id: 'temp',
    channelId: '',
    channelTitle: '',
    title: '',
    description: '',
    publishedAt: '',
    thumbnail: '',
    url: '',
    status: (run?.status === 'error' ? 'error' : run?.status === 'rejected' ? 'new' : 'completed'),
    promptRuns: run ? [run] : [],
    addedAt: '',
  };

  const badgeInfo = getPromptBadgeInfo(mockVideo, run);

  const getColorClasses = (color: string) => {
    switch (color) {
      case 'purple':
        return 'bg-purple-100 text-purple-900 border-purple-300';
      case 'emerald':
        return 'bg-emerald-50 text-emerald-800 border-emerald-300';
      case 'amber':
        return 'bg-amber-50 text-amber-800 border-amber-300';
      case 'red':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'teal':
        return 'bg-teal-100 text-teal-900 border-teal-300';
      case 'blue':
        return 'bg-blue-50 text-blue-800 border-blue-300';
      default:
        return 'bg-stone-100 text-stone-700 border-stone-200';
    }
  };

  const renderIcon = () => {
    if (!showIcon) return null;
    switch (badgeInfo.statusType) {
      case 'has_script':
        return <Film className="w-3 h-3 text-purple-700 shrink-0" />;
      case 'approved':
        return <Lightbulb className="w-3 h-3 text-emerald-600 shrink-0" />;
      case 'rejected':
        return <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />;
      case 'error':
        return <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />;
      case 'processing':
      case 'transcribing':
        return <Loader2 className="w-3 h-3 animate-spin shrink-0 text-current" />;
      case 'queued':
      case 'requires_payment':
        return <Clock className="w-3 h-3 shrink-0 text-current" />;
      default:
        return <FileText className="w-3 h-3 shrink-0 text-current" />;
    }
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shadow-2xs whitespace-nowrap ${getColorClasses(
        badgeInfo.color
      )} ${className}`}
      title={badgeInfo.label}
    >
      {renderIcon()}
      <span className="truncate max-w-[240px]">{badgeInfo.label}</span>
    </span>
  );
};
