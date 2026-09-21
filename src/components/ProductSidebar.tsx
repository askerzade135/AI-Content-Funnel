import React from 'react';
import { CalendarDays, Compass, FileText, Library, Lightbulb, Lock, Plug, Radio, Settings2, Sparkles, Waypoints } from 'lucide-react';
import { ProductSection } from '../types';

interface ProductSidebarProps {
  active: ProductSection;
  onChange: (section: ProductSection) => void;
  onboardingComplete?: boolean;
}

const LOCKED_UNTIL_TRAINED = new Set<ProductSection>(['today', 'ideas', 'scripts', 'calendar']);

export const ProductSidebar: React.FC<ProductSidebarProps> = ({ active, onChange, onboardingComplete = false }) => {
  const items: Array<[ProductSection, string, React.ReactNode]> = [
    ['today', 'Today', <Radio className="w-4 h-4" />],
    ['discover', 'Discover', <Compass className="w-4 h-4" />],
    ['ideas', 'Ideas', <Lightbulb className="w-4 h-4" />],
    ['scripts', 'Scripts', <FileText className="w-4 h-4" />],
    ['calendar', 'Calendar', <CalendarDays className="w-4 h-4" />],
    ['sources', 'Sources', <Waypoints className="w-4 h-4" />],
    ['integrations', 'Integrations', <Plug className="w-4 h-4" />],
    ['settings', 'Settings', <Settings2 className="w-4 h-4" />],
    ['library', 'Library', <Library className="w-4 h-4" />],
  ];

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
            <React.Fragment key={id}>
              {id === 'sources' && <div className="my-4 border-t border-stone-200" />}
              <button
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
            </React.Fragment>
          );
        })}
      </nav>

      <div className="mt-auto pt-6 px-2 text-[10px] text-stone-400">
        Content intelligence workspace
      </div>
    </aside>
  );
};
