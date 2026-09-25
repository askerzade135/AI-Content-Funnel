import React from 'react';

interface State { error: Error | null; }

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Unhandled render error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const language = typeof document !== 'undefined' ? document.documentElement.lang : 'en';
    const ru = String(language || '').toLowerCase().startsWith('ru');
    return (
      <main className="min-h-screen bg-stone-50 px-5 py-12 text-stone-900">
        <div className="mx-auto max-w-lg rounded-3xl border border-stone-200 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-xl">!</div>
          <h1 className="mt-4 text-xl font-bold">{ru ? 'Страница не смогла восстановиться' : 'The page could not recover'}</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            {ru ? 'Мы показываем безопасный экран вместо пустой серой страницы. Перезагрузите приложение; если ошибка повторится, откройте Diagnostics.' : 'A safe fallback is shown instead of a blank grey page. Reload the app; if it happens again, open Diagnostics.'}
          </p>
          <button type="button" onClick={() => window.location.reload()} className="mt-6 h-11 rounded-xl bg-stone-950 px-5 text-sm font-semibold text-white">
            {ru ? 'Перезагрузить' : 'Reload'}
          </button>
          <details className="mt-5 text-left">
            <summary className="cursor-pointer text-xs font-semibold text-stone-400">{ru ? 'Технические детали' : 'Technical details'}</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-3 text-[10px] text-stone-500">{this.state.error.message}</pre>
          </details>
        </div>
      </main>
    );
  }
}
