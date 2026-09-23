import React from 'react';
import { Globe2 } from 'lucide-react';
import { SiInstagram, SiTiktok, SiYoutube, SiTelegram } from 'react-icons/si';
import { GeneratedScript } from '../types';

export type PublicationPlatform = GeneratedScript['publicationPlatform'];

interface PlatformIconProps {
  platform?: PublicationPlatform;
  className?: string;
  title?: string;
}

export const PlatformIcon: React.FC<PlatformIconProps> = ({ platform, className = 'h-4 w-4', title }) => {
  const label = title || publicationPlatformLabel(platform, 'en');
  const commonProps = {
    className: `${className} shrink-0`,
    title: label,
    'aria-label': label,
  };

  if (platform === 'instagram') {
    return <SiInstagram {...commonProps} className={`${commonProps.className} text-[#E4405F]`} />;
  }

  if (platform === 'youtube') {
    return <SiYoutube {...commonProps} className={`${commonProps.className} text-[#FF0000]`} />;
  }

  if (platform === 'telegram') {
    return <SiTelegram {...commonProps} className={`${commonProps.className} text-[#26A5E4]`} />;
  }

  if (platform === 'tiktok') {
    return <SiTiktok {...commonProps} className={`${commonProps.className} text-stone-950`} />;
  }

  return <Globe2 {...commonProps} className={`${commonProps.className} text-stone-500`} strokeWidth={2} />;
};

export const publicationPlatformLabel = (platform?: PublicationPlatform, locale: 'ru' | 'en' = 'en') => {
  if (!platform) return locale === 'ru' ? 'Публикация' : 'Publication';
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'telegram') return 'Telegram';
  if (platform === 'tiktok') return 'TikTok';
  return locale === 'ru' ? 'Другое' : 'Other';
};
