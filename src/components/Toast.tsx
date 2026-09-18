import React, { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'error' | 'success' | 'info';
  title: string;
  message?: string;
  code?: string;
  persistent?: boolean; // If true, do not auto-dismiss; wait for user click
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  const DURATION_MS = 2800; // 2.8 seconds auto-dismiss timeout
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (toast.persistent) return; // Do not set auto-dismiss timer for persistent toasts

    const timer = setTimeout(() => {
      onDismissRef.current(toast.id);
    }, DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.persistent]);

  const isError = toast.type === 'error';
  const isSuccess = toast.type === 'success';
  const isInfo = toast.type === 'info';

  const containerClasses = isError
    ? 'bg-rose-950/95 border-rose-800 text-white'
    : isSuccess
    ? 'bg-emerald-950/95 border-emerald-800 text-white'
    : 'bg-stone-900/95 border-stone-700 text-white';

  return (
    <div
      className={`pointer-events-auto relative overflow-hidden flex items-start gap-3 p-4 rounded-xl shadow-xl border backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-3 ${containerClasses}`}
    >
      {isError && <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
      {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
      {isInfo && <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />}

      <div className="flex-1 min-w-0 pb-1">
        <div className="text-sm font-semibold tracking-tight">{toast.title}</div>
        {toast.code && (
          <div className="text-xs font-mono opacity-80 mt-0.5">Код ошибки: {toast.code}</div>
        )}
        {toast.message && <div className="text-xs opacity-90 mt-1 leading-relaxed">{toast.message}</div>}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="p-1 text-white/60 hover:text-white rounded-lg transition shrink-0 cursor-pointer"
        title="Закрыть"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Progress countdown indicator line only for non-persistent toasts */}
      {!toast.persistent && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20 overflow-hidden">
          <div
            className={`h-full ${isError ? 'bg-rose-400/80' : isSuccess ? 'bg-emerald-400/80' : 'bg-sky-400/80'}`}
            style={{
              animation: `toast-progress ${DURATION_MS}ms linear forwards`,
            }}
          />
        </div>
      )}
    </div>
  );
};
