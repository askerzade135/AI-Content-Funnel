import React, { useState } from 'react';
import { X, Radio, RefreshCw, Trash2, Plus, ExternalLink, Check, AlertCircle } from 'lucide-react';
import { TrackedChannel } from '../types';

interface ChannelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  channels: TrackedChannel[];
  onRefreshChannel: (id: string) => Promise<void>;
  onToggleSync: (id: string) => Promise<void>;
  onDeleteChannel: (id: string) => Promise<void>;
  onOpenAddModal: () => void;
}

export const ChannelsModal: React.FC<ChannelsModalProps> = ({
  isOpen,
  onClose,
  channels,
  onRefreshChannel,
  onToggleSync,
  onDeleteChannel,
  onOpenAddModal,
}) => {
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    try {
      await onRefreshChannel(id);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить этот канал из отслеживаемых?')) return;
    setDeletingId(id);
    try {
      await onDeleteChannel(id);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return 'Не проверялся';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  return (
    <div id="channels-modal" onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 bg-stone-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Отслеживаемые YouTube Каналы</h2>
              <p className="text-xs text-stone-500">Автоматическая ежедневная проверка и конвертация новых выпусков</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content list */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {channels.length === 0 ? (
            <div className="text-center py-12">
              <Radio className="w-10 h-10 text-stone-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-stone-800">Нет подключенных каналов</p>
              <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto mb-4">
                Добавьте YouTube каналы, чтобы система автоматически проверяла их каждый день на наличие свежих видео.
              </p>
              <button
                onClick={() => {
                  onClose();
                  onOpenAddModal();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 rounded-xl transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Подключить первый канал</span>
              </button>
            </div>
          ) : (
            channels.map((channel) => (
              <div
                key={channel.id}
                id={`channel-item-${channel.id}`}
                className="flex items-center justify-between p-4 rounded-xl border border-stone-200 bg-white hover:border-stone-300 transition gap-4"
              >
                {/* Channel details */}
                <div className="flex items-center gap-3 min-w-0">
                  {channel.avatarUrl ? (
                    <img
                      src={channel.avatarUrl}
                      alt={channel.title}
                      className="w-10 h-10 rounded-full object-cover border border-stone-200 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center font-bold text-sm shrink-0">
                      {channel.title.charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-bold text-stone-900 truncate">{channel.title}</h3>
                      <a
                        href={channel.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-stone-400 hover:text-red-600 transition"
                        title="Открыть на YouTube"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-stone-500 mt-0.5">
                      <span>{channel.handle || channel.id}</span>
                      <span>•</span>
                      <span>В ленте: {channel.videoCount || 0} видео</span>
                      <span>•</span>
                      <span>Проверено: {formatDate(channel.lastCheckedAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Auto Sync Toggle */}
                  <button
                    onClick={() => onToggleSync(channel.id)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium border transition flex items-center gap-1 ${
                      channel.autoSync
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        : 'bg-stone-50 text-stone-500 border-stone-200 hover:bg-stone-100'
                    }`}
                    title="Включить/выключить ежедневную автопроверку"
                  >
                    {channel.autoSync ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Автопроверка вкл.</span>
                      </>
                    ) : (
                      <span>Автопроверка выкл.</span>
                    )}
                  </button>

                  {/* Refresh Button */}
                  <button
                    onClick={() => handleRefresh(channel.id)}
                    disabled={refreshingId === channel.id}
                    className="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition"
                    title="Обновить свежие видео (RSS)"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshingId === channel.id ? 'animate-spin text-indigo-600' : ''}`} />
                  </button>

                  {/* Delete Button */}
                  <button
                    onClick={() => handleDelete(channel.id)}
                    disabled={deletingId === channel.id}
                    className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Удалить канал"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-stone-50 border-t border-stone-200 flex items-center justify-between">
          <span className="text-xs text-stone-500">
            Всего каналов: {channels.length}
          </span>
          <button
            onClick={() => {
              onClose();
              onOpenAddModal();
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 rounded-xl transition shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Добавить еще канал</span>
          </button>
        </div>
      </div>
    </div>
  );
};
