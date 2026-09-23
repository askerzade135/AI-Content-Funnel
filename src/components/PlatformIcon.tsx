import React from 'react';
import { Globe2, Instagram, Music2, Send, Youtube } from 'lucide-react';
import { GeneratedScript } from '../types';

export type PublicationPlatform = GeneratedScript['publicationPlatform'];

interface PlatformIconProps {
  platform?: PublicationPlatform;
  className?: string;
  title?: string;
}

export const PlatformIcon: React.FC<PlatformIconProps> = ({ platform, className = 'h-4 w-4', title }) => {
  const base = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[28%] ${className}`;
  const iconClass = 'h-[68%] w-[68%]';

  if (platform === 'instagram') {
    return (
      <span
        className={`${base} bg-gradient-to-br from-fuchsia-600 via-rose-500 to-amber-400 text-white shadow-sm`}
        title={title || 'Instagram'}
        aria-label={title || 'Instagram'}
      >
        <Instagram className={iconClass} strokeWidth={2.4} />
      </span>
    );
  }

  if (platform === 'youtube') {
    return (
      <span
        className={`${base} bg-red-600 text-white shadow-sm`}
        title={title || 'YouTube'}
        aria-label={title || 'YouTube'}
      >
        <Youtube className={iconClass} fill="currentColor" strokeWidth={2.1} />
      </span>
    );
  }

  if (platform === 'telegram') {
    return (
      <span
        className={`${base} bg-sky-500 text-white shadow-sm`}
        title={title || 'Telegram'}
        aria-label={title || 'Telegram'}
      >
        <Send className={iconClass} fill="currentColor" strokeWidth={1.8} />
      </span>
    );
  }

  if (platform === 'tiktok') {
    return (
      <span
        className={`${base} bg-stone-950 text-white shadow-sm ring-1 ring-cyan-300/50`}
        title={title || 'TikTok'}
        aria-label={title || 'TikTok'}
      >
        <Music2 className={`${iconClass} drop-shadow-[1px_1px_0_rgba(34,211,238,0.9)]`} strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span
      className={`${base} border border-stone-300 bg-white text-stone-700`}
      title={title || 'Other'}
      aria-label={title || 'Other'}
    >
      <Globe2 className={iconClass} strokeWidth={2} />
    </span>
  );
};

export const publicationPlatformLabel = (platform?: PublicationPlatform, locale: 'ru' | 'en' = 'en') => {
  if (!platform) return locale === 'ru' ? 'Публикация' : 'Publication';
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'telegram') return 'Telegram';
  if (platform === 'tiktok') return 'TikTok';
  return locale === 'ru' ? 'Другое' : 'Other';
};
