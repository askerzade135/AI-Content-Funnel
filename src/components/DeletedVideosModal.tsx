import React, { useState } from 'react';
import { Trash2, RotateCcw, AlertTriangle, X, CheckCircle2, ShieldAlert, Eye, Film } from 'lucide-react';
import { DeletedVideoInfo } from '../types';

interface DeletedVideosModalProps {
  isOpen: boolean;
  onClose: () => void;
  deletedVideos: DeletedVideoInfo[];
  isPromptMode?: boolean; // When prompted automatically after sync/refresh
  onRestore: (videoIds: string[]) => Promise<void>;
  onIgnore: (videoIds: string[]) => Promise<void>;
}

export const DeletedVideosModal: React.FC<DeletedVideosModalProps> = ({
  isOpen,
  onClose,
  deletedVideos,
  isPromptMode = false,
  onRestore,
  onIgnore,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(deletedVideos.map((v) => v.id)));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    setSelectedIds(new Set(deletedVideos.map((v) => v.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleRestoreSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsSubmitting(true);
    try {
      await onRestore(Array.from(selectedIds));
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleIgnoreSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsSubmitting(true);
    try {
      await onIgnore(Array.from(selectedIds));
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = deletedVideos.filter((v) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return v.title.toLowerCase().includes(q) || (v.channelTitle && v.channelTitle.toLowerCase().includes(q));
  });

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                {isPromptMode ? 'Обнаружены ранее удаленные видео' : 'Ранее удаленные видео (Корзина)'}
              </h2>
              <p className="text-xs text-stone-500">
                {isPromptMode
                  ? 'При синхронизации найдены видео, которые вы удаляли ранее. Выберите действие:'
                  : `Всего в списке удаленных: ${deletedVideos.length} видео`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="p-3 bg-stone-100/70 border-b border-stone-200 flex items-center justify-between gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Поиск по названию или каналу..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1 min-w-[200px]"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 transition"
            >
              Выбрать все ({deletedVideos.length})
            </button>
            <button
              onClick={deselectAll}
              className="text-xs font-medium text-stone-500 hover:text-stone-700 px-2 py-1 rounded hover:bg-stone-200 transition"
            >
              Снять выбор
            </button>
          </div>
        </div>

        {/* Video List */}
        <div className="flex-1 overflow-y-auto p-4 divide-y divide-stone-100 space-y-2">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-stone-400 text-sm">
              {deletedVideos.length === 0 ? 'Список удаленных видео пуст' : 'Ничего не найдено по запросу'}
            </div>
          ) : (
            filtered.map((video) => {
              const isSelected = selectedIds.has(video.id);
              return (
                <div
                  key={video.id}
                  onClick={() => toggleSelect(video.id)}
                  className={`pt-2 pb-2 px-3 rounded-xl flex items-center gap-3 cursor-pointer transition ${
                    isSelected ? 'bg-indigo-50/70 border border-indigo-200' : 'hover:bg-stone-50 border border-transparent'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(video.id)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div className="w-16 h-10 rounded-md bg-stone-200 overflow-hidden shrink-0">
                    <img
                      src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
                      alt={video.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-stone-900 truncate" title={video.title}>
                      {video.title}
                    </div>
                    <div className="text-[11px] text-stone-500 flex items-center gap-2 mt-0.5">
                      {video.channelTitle && <span>{video.channelTitle}</span>}
                      {video.deletedAt && (
                        <span>• Удалено: {new Date(video.deletedAt).toLocaleDateString('ru-RU')}</span>
                      )}
                      {video.permanentlyIgnored && (
                        <span className="text-stone-400 font-medium">(Игнорируется)</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-stone-200 bg-stone-50 flex items-center justify-between gap-3">
          <div className="text-xs text-stone-600">
            Выбрано: <span className="font-bold text-stone-900">{selectedIds.size}</span> из {deletedVideos.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleIgnoreSelected}
              disabled={isSubmitting || selectedIds.size === 0}
              title="Больше не предлагать эти видео при синхронизации"
              className="px-3.5 py-2 text-xs font-semibold text-stone-700 bg-stone-200 hover:bg-stone-300 rounded-xl transition disabled:opacity-50"
            >
              Игнорировать навсегда
            </button>
            <button
              onClick={handleRestoreSelected}
              disabled={isSubmitting || selectedIds.size === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-2xs disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Восстановить в список ({selectedIds.size})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
