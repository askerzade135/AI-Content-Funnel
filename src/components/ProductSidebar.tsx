import React from 'react';
import { CalendarDays, Compass, FileText, Lightbulb, Lock, Radio, Settings2, Sparkles } from 'lucide-react';
import { ProductSection } from '../types';

interface ProductSidebarProps {
  active: ProductSection;
  onChange: (section: ProductSection) => void;
  onboardingComplete?: boolean;
  user?: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  } | null;
  quota?: {
    used: number;
    limit: number;
    label?: string;
  } | null;
}

const LOCKED_UNTIL_TRAINED = new Set<ProductSection>(['today', 'ideas', 'scripts', 'calendar']);

export const ProductSidebar: React.FC<ProductSidebarProps> = ({
  active,
  onChange,
  onboardingComplete = false,
  user,
  quota,
}) => {
  const items: Array<[ProductSection, string, React.ReactNode]> = [
    ['today', 'Today', <Radio className="w-4 h-4" />],
    ['discover', 'Discover', <Compass className="w-4 h-4" />],
    ['ideas', 'Ideas', <Lightbulb className="w-4 h-4" />],
    ['scripts', 'Scripts', <FileText className="w-4 h-4" />],
    ['calendar', 'Calendar', <CalendarDays className="w-4 h-4" />],
  ];

  const used = Math.max(0, quota?.used || 0);
  const limit = Math.max(1, quota?.limit || 1);
  const quotaPercent = Math.min(100, (used / limit) * 100);
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Account';
  const initials = displayName.trim().slice(0, 1).toUpperCase();

  return (
    <aside className="hidden lg:flex w-[248px] xl:w-[256px] shrink-0 border-r border-stone-200 bg-white min-h-screen flex-col px-4 py-6 sticky top-0 self-start">
      <div className="px-2 mb-7">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-[15px] leading-tight text-stone-950 truncate">AI Content Funnel</div>
            <div className="text-[10px] text-stone-400 mt-1 tracking-wide">Find. Learn. Create. Grow.</div>
          </div>
        </div>
      </div>

      <nav className="space-y-1">
        {items.map(([id,label,icon]) => {
          const locked = !onboardingComplete && LOCKED_UNTIL_TRAINED.has(id);
          return (
            <button
              key={id}
              type="button"
              disabled={locked}
              aria-disabled={locked}
              title={locked ? 'Complete Taste Training to unlock' : undefined}
              onClick={() => !locked && onChange(id)}
              className={`w-full h-11 flex items-center gap-3 px-3.5 rounded-xl text-[13px] font-semibold transition ${
                locked
                  ? 'text-stone-300 cursor-not-allowed bg-transparent'
                  : active === id
                    ? 'bg-stone-950 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              <span className={`shrink-0 ${locked ? 'text-stone-300' : active === id ? 'text-emerald-400' : 'text-stone-500'}`}>{icon}</span>
              <span>{label}</span>
              {locked && <Lock className="ml-auto w-3.5 h-3.5 text-stone-300" />}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto pt-6 space-y-3">
        {quota && (
          <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-stone-900">Usage</div>
              <div className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Active</div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-stone-500">
              <span>{quota.label || 'Radar analyses'}</span>
              <span className="font-semibold text-stone-700">{used} / {limit}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
              <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${quotaPercent}%` }} />
            </div>
          </div>
        )}

        <div className="border-t border-stone-200 pt-3">
          <button
            type="button"
            onClick={() => onChange('settings')}
            className={`w-full rounded-2xl px-2.5 py-2 text-left transition ${
              active === 'settings' ? 'bg-stone-100' : 'hover:bg-stone-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700">{initials}</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-stone-900">{displayName}</div>
                <div className="mt-0.5 truncate text-[10px] text-stone-400">{user?.email || 'Account settings'}</div>
              </div>
              <Settings2 className="h-4 w-4 shrink-0 text-stone-400" />
            </div>
          </button>
        </div>
      </div>
    </aside>
  );
};
