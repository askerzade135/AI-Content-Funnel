import { ToastMessage } from '../components/Toast';

type ToastListener = (toast: ToastMessage) => void;

class ToastEmitter {
  private listeners: ToastListener[] = [];

  public subscribe(listener: ToastListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public show(toast: Omit<ToastMessage, 'id'>) {
    const id = Math.random().toString(36).substring(2, 9);
    const fullToast: ToastMessage = { id, ...toast };
    this.listeners.forEach((listener) => listener(fullToast));
  }
}

export const toastEmitter = new ToastEmitter();

export function showToast(
  title: string,
  message?: string,
  code?: string,
  type: 'error' | 'success' | 'info' = 'error',
  persistent?: boolean
) {
  toastEmitter.show({ title, message, code, type, persistent });
}
