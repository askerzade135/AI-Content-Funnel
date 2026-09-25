import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  'data-testid'?: string;
}

interface CustomSelectProps<T extends string = string> {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  disabled = false,
  'data-testid': dataTestId,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value) || options[0];

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} data-testid={dataTestId} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 text-left text-sm text-stone-800 outline-none transition hover:border-stone-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-50 disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{selected?.label || value}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-stone-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} className="absolute z-[100] mt-1.5 max-h-64 w-full min-w-[180px] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-1.5 shadow-xl">
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
                className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-emerald-50 text-emerald-900' : 'text-stone-700 hover:bg-stone-50'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{option.label}</span>
                  {option.description && <span className="mt-0.5 block text-[10px] leading-4 text-stone-400">{option.description}</span>}
                </span>
                {active && <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
