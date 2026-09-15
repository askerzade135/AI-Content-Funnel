import React from 'react';
import { AlertCircle, AlertTriangle, HelpCircle, Check, X, Sparkles, Film, Trash2 } from 'lucide-react';

export interface ConfirmModalConfig {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'primary' | 'danger' | 'warning' | 'purple' | 'emerald' | 'teal';
  badge?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface ConfirmModalProps {
  config: ConfirmModalConfig | null;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ config, onClose }) => {
  if (!config || !config.isOpen) return null;

  const {
    title,
    description,
    confirmText = 'Подтвердить',
    cancelText = 'Отмена',
    type = 'primary',
    badge,
    onConfirm,
    onCancel,
  } = config;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const handleCancel = () => {
    onCancel();
    onClose();
  };

  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          icon: <Trash2 className="w-5 h-5 text-red-600" />,
          iconBg: 'bg-red-50 border-red-200',
          btnBg: 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/20',
          badgeBg: 'bg-red-100 text-red-800 border-red-200',
        };
      case 'warning':
        return {
          icon: <AlertTriangle className="w-5 h-5 text-amber-600" />,
          iconBg: 'bg-amber-50 border-amber-200',
          btnBg: 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/20',
          badgeBg: 'bg-amber-100 text-amber-800 border-amber-200',
        };
      case 'purple':
        return {
          icon: <Film className="w-5 h-5 text-purple-600" />,
          iconBg: 'bg-purple-50 border-purple-200',
          btnBg: 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-600/20',
          badgeBg: 'bg-purple-100 text-purple-800 border-purple-200',
        };
      case 'emerald':
        return {
          icon: <Sparkles className="w-5 h-5 text-emerald-600" />,
          iconBg: 'bg-emerald-50 border-emerald-200',
          btnBg: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20',
          badgeBg: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        };
      case 'teal':
        return {
          icon: <Check className="w-5 h-5 text-teal-600" />,
          iconBg: 'bg-teal-50 border-teal-200',
          btnBg: 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-600/20',
          badgeBg: 'bg-teal-100 text-teal-800 border-teal-200',
        };
      case 'primary':
      default:
        return {
          icon: <Sparkles className="w-5 h-5 text-indigo-600" />,
          iconBg: 'bg-indigo-50 border-indigo-200',
          btnBg: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20',
          badgeBg: 'bg-indigo-100 text-indigo-800 border-indigo-200',
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div
      id="confirm-modal-overlay"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        id="confirm-modal-card"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-md overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-start gap-3.5">
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${styles.iconBg}`}>
            {styles.icon}
          </div>
          <div className="flex-1 min-w-0">
            {badge && (
              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border mb-1.5 ${styles.badgeBg}`}>
                {badge}
              </span>
            )}
            <h3 className="text-sm font-bold text-stone-900 leading-snug">
              {title}
            </h3>
            <p className="text-xs text-stone-600 mt-1.5 leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        <div className="pt-3 border-t border-stone-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={handleCancel}
            className="px-3.5 py-2 text-xs font-medium text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-xl transition"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition shadow-sm ${styles.btnBg}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
