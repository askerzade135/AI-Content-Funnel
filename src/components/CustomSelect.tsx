import React, { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
}

interface CustomSelectProps<T extends string = string> {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  'data-testid'?: string;
}

type MenuPosition = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
};

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  triggerClassName = '',
  disabled = false,
  'data-testid': dataTestId,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value) || options[0];

  const updatePosition = () => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const estimatedHeight = Math.min(options.length * 48 + 16, 264);
    const spaceBelow = window.innerHeight - trigger.bottom;
    const openUp = spaceBelow < estimatedHeight + 12 && trigger.top > spaceBelow;
    setPosition(openUp
      ? { left: trigger.left, bottom: Math.max(8, window.innerHeight - trigger.top + 6), width: trigger.width }
      : { left: trigger.left, top: trigger.bottom + 6, width: trigger.width });
  };

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onViewportChange = () => updatePosition();
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  const panel = open && position && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: 'fixed',
            left: position.left,
            top: position.top,
            bottom: position.bottom,
            width: Math.max(position.width, 180),
          }}
          className="z-[120] max-h-64 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-1.5 shadow-2xl"
        >
          {options.map(option => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-emerald-50 text-emerald-900' : 'text-stone-700 hover:bg-stone-50'}`}
              >
                {option.icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center">{option.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{option.label}</span>
                  {option.description && <span className="mt-0.5 block text-[10px] leading-4 text-stone-400">{option.description}</span>}
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
              </button>
            );
          })}
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={rootRef} data-testid={dataTestId} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        className={`flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 text-left text-sm text-stone-800 outline-none transition hover:border-stone-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-50 disabled:opacity-50 ${triggerClassName}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selected?.icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center">{selected.icon}</span>}
          <span className="min-w-0 truncate">{selected?.label || value}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-stone-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {panel}
    </div>
  );
}
