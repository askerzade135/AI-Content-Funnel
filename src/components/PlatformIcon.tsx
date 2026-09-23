import React from 'react';
import { Globe2 } from 'lucide-react';
import { SiInstagram, SiTelegram, SiTiktok, SiYoutube } from 'react-icons/si';
import { GeneratedScript } from '../types';

export type PublicationPlatform = GeneratedScript['publicationPlatform'];

interface PlatformIconProps {
  platform?: PublicationPlatform;
  className?: string;
  title?: string;
}

export const PlatformIcon: React.FC<PlatformIconProps> = ({
  platform,
  className = 'h-4 w-4',
  title,
}) => {
  const label = title || publicationPlatformLabel(platform, 'en');
  const wrapperClass = `inline-flex shrink-0 items-center justify-center ${className}`;

  if (platform === 'instagram') {
    return (
      <span className={`${wrapperClass} text-[#E4405F]`} title={label} aria-label={label}>
        <SiInstagram size="100%" />
      </span>
    );
  }

  if (platform === 'youtube') {
    return (
      <span className={`${wrapperClass} text-[#FF0000]`} title={label} aria-label={label}>
        <SiYoutube size="100%" />
      </span>
    );
  }

  if (platform === 'telegram') {
    return (
      <span className={`${wrapperClass} text-[#26A5E4]`} title={label} aria-label={label}>
        <SiTelegram size="100%" />
      </span>
    );
  }

  if (platform === 'tiktok') {
    return (
      <span className={`${wrapperClass} text-stone-950`} title={label} aria-label={label}>
        <SiTiktok size="100%" />
      </span>
    );
  }

  return (
    <span className={`${wrapperClass} text-stone-500`} title={label} aria-label={label}>
      <Globe2 className="h-full w-full" strokeWidth={2} />
    </span>
  );
};

export const publicationPlatformLabel = (
  platform?: PublicationPlatform,
  locale: 'ru' | 'en' = 'en'
) => {
  if (!platform) return locale === 'ru' ? 'Публикация' : 'Publication';
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'telegram') return 'Telegram';
  if (platform === 'tiktok') return 'TikTok';
  return locale === 'ru' ? 'Другое' : 'Other';
};
