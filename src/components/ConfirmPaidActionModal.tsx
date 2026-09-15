import React, { useState } from 'react';
import { 
  X, AlertCircle, Coins, Loader2, FileText, Sparkles, Film, Send, 
  RotateCcw, ChevronDown, ChevronUp, CheckCircle2, Info
} from 'lucide-react';
import { StoredVideo } from '../types';
import { PaidActionType, estimateCost, getPaidActionDetails } from '../utils/video-actions';

export interface ConfirmPaidActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  actionType: PaidActionType;
  videos: StoredVideo[];
  title?: string;
  description?: string;
}

export const ConfirmPaidActionModal: React.FC<ConfirmPaidActionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  actionType,
  videos,
  title: customTitle,
  description: customDescription,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showVideoList, setShowVideoList] = useState(false);

  if (!isOpen || videos.length === 0) return null;

  const totalCount = videos.length;
  const realPaidCount = estimateCost(actionType, videos);
  const skippedCount = Math.max(0, totalCount - realPaidCount);
  const actionDetails = getPaidActionDetails(actionType, realPaidCount);

  const displayTitle = customTitle || actionDetails.title;
  const displayDescription = customDescription || actionDetails.description;

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
    } catch (err) {
      console.error('Paid action error:', err);
    } finally {
      setIsProcessing(false);
      onClose();
    }
  };

  const getActionIcon = () => {
    switch (actionType) {
      case 'transcription':
        return <FileText className="w-5 h-5 text-sky-600" />;
      case 'stage1':
      case 'filter':
      case 'find_more_ideas':
        return <Sparkles className="w-5 h-5 text-emerald-600" />;
      case 'stage2':
      case 'script':
        return <Film className="w-5 h-5 text-indigo-600" />;
      case 'pipeline':
        return <Send className="w-5 h-5 text-indigo-600" />;
      case 'retry':
        return <RotateCcw className="w-5 h-5 text-amber-600" />;
      default:
        return <Coins className="w-5 h-5 text-amber-600" />;
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-stone-200 animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 bg-stone-50/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white rounded-xl shadow-2xs border border-stone-200">
              {getActionIcon()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-stone-900 leading-tight">
                  {displayTitle}
                </h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-stone-200 text-stone-700">
                  {actionDetails.badgeText}
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                Авторизация платной операции AI / API
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-full transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-6 space-y-4 overflow-y-auto min-h-0">
          {/* Main prompt box */}
          <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200/80 text-sm text-stone-800 space-y-2">
            <div className="flex gap-2.5 items-start">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-stone-900">
                  {displayDescription}
                </p>
                <p className="text-xs text-stone-600 mt-1">
                  Запуск приведет к расходу квоты/токенов в Gemini API. Пожалуйста, подтвердите операцию.
                </p>
              </div>
            </div>
          </div>

          {/* Single video details OR batch estimation card */}
          {totalCount === 1 ? (
            <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl space-y-2 text-xs">
              <div className="font-semibold text-stone-700 uppercase tracking-wider text-[10px]">
                Информация о видео
              </div>
              <div className="font-semibold text-sm text-stone-900 line-clamp-2">
                {videos[0].title}
              </div>
              <div className="flex items-center gap-4 text-stone-500 pt-1 border-t border-stone-200/80">
                <span>Канал: <strong className="text-stone-700">{videos[0].channelTitle}</strong></span>
                {videos[0].durationSeconds && (
                  <span>Длительность: <strong className="text-stone-700">{Math.ceil(videos[0].durationSeconds / 60)} мин</strong></span>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between font-semibold text-stone-700 uppercase tracking-wider text-[10px]">
                <span>Расчет пакета обработки</span>
                <span className="text-stone-500">Всего выбрано: {totalCount}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-stone-700">
                <div className="p-3 bg-white rounded-lg border border-stone-200 shadow-2xs">
                  <div className="text-[11px] text-stone-500">Требуют платного вызова:</div>
                  <div className="text-lg font-bold text-amber-700 mt-0.5">
                    {realPaidCount} <span className="text-xs font-normal text-stone-500">видео</span>
                  </div>
                </div>

                <div className="p-3 bg-white rounded-lg border border-stone-200 shadow-2xs">
                  <div className="text-[11px] text-stone-500">Будут пропущены (уже готовы):</div>
                  <div className="text-lg font-bold text-emerald-700 mt-0.5">
                    {skippedCount} <span className="text-xs font-normal text-stone-500">видео</span>
                  </div>
                </div>
              </div>

              {/* Toggleable video list */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowVideoList(!showVideoList)}
                  className="inline-flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-900 font-medium py-1 transition"
                >
                  <span>{showVideoList ? 'Скрыть список видео' : 'Показать список видео'} ({totalCount})</span>
                  {showVideoList ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showVideoList && (
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
                    {videos.map((v) => {
                      const isCandidatePaid = estimateCost(actionType, [v]) > 0;
                      return (
                        <div key={v.id} className="p-2.5 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate flex-1 text-stone-800" title={v.title}>
                            {v.title}
                          </span>
                          <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isCandidatePaid 
                              ? 'bg-amber-50 text-amber-800 border border-amber-200' 
                              : 'bg-stone-100 text-stone-500'
                          }`}>
                            {isCandidatePaid ? 'Платный вызов' : 'Пропуск (готово)'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quota & Cost Note */}
          <div className="flex items-start gap-2 p-3 bg-stone-100/70 rounded-xl text-stone-600 text-xs">
            <Info className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" />
            <p>
              Вызов выполняется через подключенный аккаунт Google Gemini API. При превышении квоты или ошибке обработка будет безопасно приостановлена.
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-stone-50 border-t border-stone-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-300 hover:bg-stone-100 hover:text-stone-900 rounded-xl transition shadow-2xs disabled:opacity-50"
          >
            Отмена
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing || realPaidCount === 0}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white rounded-xl shadow-2xs transition disabled:opacity-50 disabled:cursor-not-allowed ${
              realPaidCount > 0 
                ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500'
                : 'bg-stone-400'
            }`}
          >
            {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            <span>Подтвердить и запустить ({realPaidCount})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
