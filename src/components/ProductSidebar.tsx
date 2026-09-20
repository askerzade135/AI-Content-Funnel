import React from 'react';
import { CalendarDays, Compass, FileText, Library, Lightbulb, Plug, Radio, Settings2, Sparkles, Waypoints } from 'lucide-react';
import { ProductSection } from '../types';

interface ProductSidebarProps {
  active: ProductSection;
  onChange: (section: ProductSection) => void;
}

export const ProductSidebar: React.FC<ProductSidebarProps> = ({ active, onChange }) => {
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
    <aside className="hidden lg:flex w-56 shrink-0 border-r border-stone-200 bg-white min-h-[calc(100vh-3.5rem)] flex-col px-3 py-5 sticky top-14 self-start">
      <div className="px-3 mb-5">
        <div className="flex items-center gap-2 font-bold text-sm"><Sparkles className="w-4 h-4 text-emerald-600"/> Content Radar</div>
        <div className="text-[10px] text-stone-400 mt-1">editorial intelligence</div>
      </div>
      <nav className="space-y-1">
        {items.map(([id,label,icon]) => (
          <React.Fragment key={id}>
            {id === 'sources' && <div className="my-3 border-t border-stone-200" />}
            <button onClick={() => onChange(id)} className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition ${active === id ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}>
              {icon}<span>{label}</span>
            </button>
          </React.Fragment>
        ))}
      </nav>
    </aside>
  );
};
