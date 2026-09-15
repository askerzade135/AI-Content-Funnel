import React, { useState } from 'react';
import { X, History, Trash2, CheckCircle2, AlertCircle, Info, AlertTriangle, RefreshCw } from 'lucide-react';
import { SyncLog } from '../types';

interface LogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: SyncLog[];
  onRefreshLogs: () => Promise<void>;
  onClearLogs: () => Promise<void>;
}

export const LogsModal: React.FC<LogsModalProps> = ({
  isOpen,
  onClose,
  logs,
  onRefreshLogs,
  onClearLogs,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshLogs();
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatTimestamp = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoString;
    }
  };

  const getLogIcon = (type: SyncLog['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />;
      case 'warn':
        return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />;
      case 'info':
      default:
        return <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />;
    }
  };

  return (
    <div id="logs-modal" onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 bg-stone-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-100 text-stone-700 flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Журнал фоновой активности</h2>
              <p className="text-xs text-stone-500">Логи проверок каналов, транскрибации и взаимодействия с Gemini</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 text-stone-500 hover:text-stone-800 rounded-lg hover:bg-stone-100 transition"
              title="Обновить журнал"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Logs list */}
        <div className="p-6 overflow-y-auto flex-1 space-y-2.5 font-mono text-xs">
          {logs.length === 0 ? (
            <div className="text-center py-12 text-stone-400 font-sans">
              Журнал пуст. Здесь будут отображаться события автопроверки каналов и отправки данных в Gemini.
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex items-start gap-2.5"
              >
                {getLogIcon(log.type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-[11px] text-stone-500 mb-1">
                    <span className="font-sans font-medium text-stone-700">
                      {log.videoTitle || 'Системное событие'}
                    </span>
                    <span className="text-[10px] text-stone-400">{formatTimestamp(log.timestamp)}</span>
                  </div>
                  <p className="text-stone-800 leading-snug break-words">{log.message}</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-stone-50 border-t border-stone-200 flex items-center justify-between">
          <span className="text-xs text-stone-500 font-sans">
            Записей: {logs.length}
          </span>
          {logs.length > 0 && (
            <button
              onClick={onClearLogs}
              className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-red-600 transition font-sans"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Очистить журнал</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
