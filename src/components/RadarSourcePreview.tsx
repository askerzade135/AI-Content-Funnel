import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Globe2 } from 'lucide-react';
import { PlatformIcon } from './PlatformIcon';

type SourceType = 'youtube' | 'web' | 'x' | 'manual' | string;

interface RadarSourcePreviewProps {
  sourceType: SourceType;
  src?: string | null;
  url?: string;
  domain?: string;
  title?: string;
  className?: string;
  imageClassName?: string;
  compact?: boolean;
  locale?: 'ru' | 'en';
}

function domainFromUrl(value?: string) {
  if (!value) return '';
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export const RadarSourcePreview: React.FC<RadarSourcePreviewProps> = ({
  sourceType,
  src,
  url,
  domain,
  title,
  className = '',
  imageClassName = '',
  compact = false,
  locale = 'en',
}) => {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);

  const resolvedDomain = useMemo(() => domain || domainFromUrl(url), [domain, url]);
  const hasImage = Boolean(src && !broken);
  const isWeb = sourceType === 'web';
  const sourceName = sourceType === 'youtube' ? 'YouTube' : sourceType === 'web' ? 'Web' : sourceType === 'x' ? 'X' : 'Source';

  return (
    <div className={'relative h-full w-full overflow-hidden bg-stone-100 ' + className}>
      {hasImage ? (
        <img
          src={src || ''}
          alt={title || ''}
          className={'h-full w-full object-cover object-center ' + imageClassName}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : isWeb ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-stone-50 to-emerald-50/40 px-5 text-center">
          <span className={compact
            ? 'flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-500 shadow-sm'
            : 'flex h-12 w-12 items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-500 shadow-sm'}>
            <Globe2 className={compact ? 'h-4 w-4' : 'h-6 w-6'} />
          </span>
          <span className={'mt-2 max-w-full truncate font-semibold text-stone-700 ' + (compact ? 'text-[10px]' : 'text-xs')}>
            {resolvedDomain || 'Web'}
          </span>
          <span className={'mt-1 text-stone-400 ' + (compact ? 'text-[9px]' : 'text-[10px]')}>
            {locale === 'ru' ? 'Веб-статья' : 'Web article'}
          </span>
        </div>
      ) : sourceType === 'youtube' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-stone-50 to-rose-50/50">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-100 bg-white shadow-sm">
            <PlatformIcon platform="youtube" className="h-6 w-6" />
          </span>
          <span className="text-[10px] font-semibold text-stone-400">YouTube</span>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-50 text-stone-400">
          <FileText className="h-6 w-6" />
          <span className="text-[10px] font-semibold">{sourceName}</span>
        </div>
      )}
    </div>
  );
};
