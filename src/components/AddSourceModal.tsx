import React, { useState } from 'react';
import { X, Youtube, Radio, Link, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChannelAdded: () => void;
  onVideoAdded: () => void;
}

export const AddSourceModal: React.FC<AddSourceModalProps> = ({
  isOpen,
  onClose,
  onChannelAdded,
  onVideoAdded,
}) => {
  const [tab, setTab] = useState<'channel' | 'video'>('channel');
  const [channelInput, setChannelInput] = useState('');
  const [videoInput, setVideoInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelInput.trim()) return;

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: channelInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось добавить канал');
      }

      setSuccessMessage(`Канал "${data.channel.title}" успешно подключен! Загружено ${data.newVideosAdded} видео.`);
      setChannelInput('');
      onChannelAdded();
      setTimeout(() => {
        setSuccessMessage(null);
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Ошибка подключения канала');
    } finally {
      setLoading(false);
    }
  };

  const handleAddVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoInput.trim()) return;

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/videos/add-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось добавить видео');
      }

      setSuccessMessage(`Видео "${data.video.title}" добавлено в список!`);
      setVideoInput('');
      onVideoAdded();
      setTimeout(() => {
        setSuccessMessage(null);
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Ошибка добавления видео');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="add-source-modal" onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <Youtube className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Добавить источник</h2>
              <p className="text-xs text-stone-500">YouTube канал для авто-синхронизации или отдельное видео</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-stone-200 px-6 pt-3 gap-2">
          <button
            id="tab-add-channel"
            onClick={() => { setTab('channel'); setError(null); setSuccessMessage(null); }}
            className={`pb-2.5 px-3 text-xs font-medium border-b-2 transition flex items-center gap-1.5 ${
              tab === 'channel'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-red-500" />
            <span>YouTube Канал</span>
          </button>
          <button
            id="tab-add-video"
            onClick={() => { setTab('video'); setError(null); setSuccessMessage(null); }}
            className={`pb-2.5 px-3 text-xs font-medium border-b-2 transition flex items-center gap-1.5 ${
              tab === 'video'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Link className="w-3.5 h-3.5 text-blue-500" />
            <span>Отдельное видео</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2 text-xs text-emerald-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {tab === 'channel' ? (
            <form onSubmit={handleAddChannel} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1.5">
                  Ссылка на канал или @handle
                </label>
                <input
                  id="input-channel-url"
                  type="text"
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  placeholder="например: @Veritasium, @mkbhd или https://youtube.com/@..."
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 text-xs bg-stone-50 border border-stone-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900 transition"
                />
                <p className="mt-1.5 text-[11px] text-stone-500 leading-relaxed">
                  Система автоматически загрузит все видео канала и включит его в ежедневное отслеживание новых выпусков.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100 rounded-xl transition"
                >
                  Отмена
                </button>
                <button
                  id="btn-submit-channel"
                  type="submit"
                  disabled={loading || !channelInput.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
                  <span>{loading ? 'Загрузка видео канала...' : 'Подключить канал'}</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddVideo} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1.5">
                  Ссылка на видео YouTube
                </label>
                <input
                  id="input-single-video-url"
                  type="text"
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... или https://youtu.be/..."
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 text-xs bg-stone-50 border border-stone-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900 transition"
                />
                <p className="mt-1.5 text-[11px] text-stone-500 leading-relaxed">
                  Видео будет добавлено в вашу видеотеку. Вы сможете конвертировать его в текст и передать в Gemini отдельно или в пакете.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100 rounded-xl transition"
                >
                  Отмена
                </button>
                <button
                  id="btn-submit-video"
                  type="submit"
                  disabled={loading || !videoInput.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5" />}
                  <span>{loading ? 'Добавление...' : 'Добавить видео'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
