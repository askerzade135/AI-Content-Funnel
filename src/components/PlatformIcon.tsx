import React from 'react';
import { Globe2, Instagram, Music2, Send, Youtube } from 'lucide-react';
import { GeneratedScript } from '../types';

export type PublicationPlatform = GeneratedScript['publicationPlatform'];

interface PlatformIconProps {
  platform?: PublicationPlatform;
  className?: string;
}

export const PlatformIcon: React.FC<PlatformIconProps> = ({ platform, className = 'h-3.5 w-3.5' }) => {
  if (platform === 'instagram') return <Instagram className={className} aria-hidden="true" />;
  if (platform === 'youtube') return <Youtube className={className} aria-hidden="true" />;
  if (platform === 'telegram') return <Send className={className} aria-hidden="true" />;
  if (platform === 'tiktok') return <Music2 className={className} aria-hidden="true" />;
  return <Globe2 className={className} aria-hidden="true" />;
};

export const publicationPlatformLabel = (platform?: PublicationPlatform, locale: 'ru' | 'en' = 'en') => {
  if (!platform) return locale === 'ru' ? 'Публикация' : 'Publication';
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'telegram') return 'Telegram';
  if (platform === 'tiktok') return 'TikTok';
  return locale === 'ru' ? 'Другое' : 'Other';
};
