import React from 'react';

interface BrandMarkProps {
  className?: string;
  title?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ className = 'h-8 w-8', title = 'Content Radar' }) => (
  <svg
    viewBox="0 0 64 64"
    role="img"
    aria-label={title}
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="32" cy="32" r="24" stroke="currentColor" strokeWidth="5" opacity="0.28" />
    <circle cx="32" cy="32" r="15" stroke="currentColor" strokeWidth="5" opacity="0.58" />
    <circle cx="32" cy="32" r="5.5" fill="currentColor" />
    <path d="M32 32L50.5 13.5" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    <path d="M45 13.5H50.5V19" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface BrandLockupProps {
  compact?: boolean;
  className?: string;
  markClassName?: string;
}

export const BrandLockup: React.FC<BrandLockupProps> = ({
  compact = false,
  className = '',
  markClassName = 'h-10 w-10',
}) => (
  <div className={`flex min-w-0 items-center gap-3 ${className}`}>
    <span className="flex shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700">
      <BrandMark className={markClassName} />
    </span>
    <div className="min-w-0">
      <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-slate-950">Content Radar</div>
      {!compact && (
        <div className="mt-1 truncate text-[10px] tracking-wide text-slate-400">
          Find signals. Create what matters.
        </div>
      )}
    </div>
  </div>
);
