import React, { useState } from 'react';
import { Brain, CalendarDays, Compass, FileText, Lightbulb, Lock, LogOut, Radio, Settings2 } from 'lucide-react';
import { ProductSection } from '../types';
import { useI18n } from '../i18n';
import { BrandLockup } from './BrandLogo';

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
  onLogout?: () => void;
}

const LOCKED_UNTIL_TRAINED = new Set<ProductSection>(['today', 'ideas', 'scripts', 'calendar']);

export const ProductSidebar: React.FC<ProductSidebarProps> = ({
  active,
  onChange,
  onboardingComplete = false,
  user,
  quota,
  onLogout,
}) => {
  const [accountOpen, setAccountOpen] = useState(false);
  const { t } = useI18n();
  const items: Array<[ProductSection, string, React.ReactNode]> = [
    ['today', t('nav.today'), <Radio className="w-4 h-4" />],
    ['discover', t('nav.discover'), <Compass className="w-4 h-4" />],
    ['radar', t('nav.myRadar'), <Brain className="w-4 h-4" />],
    ['ideas', t('nav.ideas'), <Lightbulb className="w-4 h-4" />],
    ['scripts', t('nav.scripts'), <FileText className="w-4 h-4" />],
    ['calendar', t('nav.calendar'), <CalendarDays className="w-4 h-4" />],
  ];

  const used = Math.max(0, quota?.used || 0);
  const limit = Math.max(1, quota?.limit || 1);
  const quotaPercent = Math.min(100, (used / limit) * 100);
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Account';
  const initials = displayName.trim().slice(0, 1).toUpperCase();

  return (
    <aside className="hidden lg:flex w-[248px] xl:w-[256px] shrink-0 border-r border-stone-200 bg-white min-h-screen flex-col px-4 py-6 sticky top-0 self-start">
      <div className="mb-7 px-2">
        <BrandLockup markClassName="h-10 w-10 p-1.5" />
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
              title={locked ? t('nav.unlock') : undefined}
              onClick={() => !locked && onChange(id)}
              className={`w-full h-11 flex items-center gap-3 px-3.5 rounded-xl text-[13px] font-semibold transition ${
                locked
                  ? 'text-stone-300 cursor-not-allowed bg-transparent'
                  : active === id
                    ? 'border border-emerald-100 bg-emerald-50 text-slate-900 shadow-sm'
                    : 'border border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className={`shrink-0 ${locked ? 'text-stone-300' : active === id ? 'text-emerald-700' : 'text-slate-500'}`}>{icon}</span>
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
              <div className="text-xs font-bold text-stone-900">{t('nav.usage')}</div>
              <div className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{t('nav.active')}</div>
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

        <div className="relative border-t border-stone-200 pt-3">
          {accountOpen && (
            <div className="absolute bottom-[58px] left-0 right-0 z-30 rounded-2xl border border-stone-200 bg-white p-2 shadow-xl">
              <button
                type="button"
                onClick={() => { setAccountOpen(false); onChange('settings'); }}
                className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-semibold text-stone-700 hover:bg-stone-50"
              >
                <Settings2 className="h-4 w-4 text-stone-400" /> {t('nav.settings')}
              </button>
              {onLogout && (
                <>
                  <div className="my-1 border-t border-stone-100" />
                  <button
                    type="button"
                    onClick={() => { setAccountOpen(false); onLogout(); }}
                    className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-semibold text-stone-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <LogOut className="h-4 w-4" /> {t('nav.logout')}
                  </button>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setAccountOpen(value => !value)}
            aria-expanded={accountOpen}
            className={`w-full rounded-2xl px-2.5 py-2 text-left transition ${
              accountOpen || active === 'settings' ? 'bg-stone-100' : 'hover:bg-stone-50'
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
                <div className="mt-0.5 truncate text-[10px] text-stone-400">{user?.email || t('nav.accountSettings')}</div>
              </div>
              <Settings2 className="h-4 w-4 shrink-0 text-stone-400" />
            </div>
          </button>
        </div>
      </div>
    </aside>
  );
};
