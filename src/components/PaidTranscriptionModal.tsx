import React, { useState } from 'react';
import { X, AlertCircle, Coins, Loader2 } from 'lucide-react';

interface PaidTranscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  videoTitle: string;
  durationSeconds?: number;
}

export function PaidTranscriptionModal({
  isOpen,
  onClose,
  onConfirm,
  videoTitle,
  durationSeconds
}: PaidTranscriptionModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const COST_PER_MINUTE = 0.0001; // Примерная стоимость
  const durationMins = durationSeconds ? Math.ceil(durationSeconds / 60) : 10; // Fallback to 10 if unknown
  const estimatedCost = (durationMins * COST_PER_MINUTE).toFixed(4);

  const handleConfirm = async () => {
    setIsProcessing(true);
    await onConfirm();
    setIsProcessing(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-amber-50">
          <div className="flex items-center gap-2 text-amber-800">
            <Coins className="w-5 h-5" />
            <h2 className="text-base font-bold">Подтверждение оплаты токенами</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex gap-3 items-start text-sm text-slate-700 bg-amber-50/50 p-4 rounded-xl border border-amber-100">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p>
              <strong>Бесплатные модели Gemini Flash и Pro не справились из-за превышения квоты.</strong>
              <br className="my-1" />
              Для продолжения аудио-транскрипции видео «<span className="font-semibold text-slate-900">{videoTitle}</span>» требуется использование платных токенов.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 font-mono text-sm">
            <div className="text-slate-500 mb-2 font-sans font-medium text-xs uppercase tracking-wider">Расчет стоимости (примерно)</div>
            <div className="grid grid-cols-2 gap-2 text-slate-600">
              <div>Длительность видео:</div>
              <div className="text-right font-medium text-slate-900">{durationSeconds ? `${durationMins} мин` : 'Неизвестно (~10 мин)'}</div>
              
              <div>Стоимость за 1 мин:</div>
              <div className="text-right font-medium text-slate-900">${COST_PER_MINUTE}</div>
              
              <div className="col-span-2 border-t border-slate-200 my-1"></div>
              
              <div className="font-bold text-slate-900">Итого к списанию:</div>
              <div className="text-right font-bold text-emerald-600">~${estimatedCost}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            disabled={isProcessing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
            Подтвердить и оплатить токенами
          </button>
        </div>
      </div>
    </div>
  );
}
