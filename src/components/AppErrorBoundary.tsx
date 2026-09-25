function fallbackCopy() {
  const language = typeof document !== 'undefined' ? document.documentElement.lang : 'en';
  const ru = String(language || '').toLowerCase().startsWith('ru');
  return {
    title: ru ? 'Страница не смогла восстановиться' : 'The page could not recover',
    message: ru
      ? 'Мы показываем безопасный экран вместо пустой серой страницы. Перезагрузите приложение; если ошибка повторится, откройте Diagnostics.'
      : 'A safe fallback is shown instead of a blank grey page. Reload the app; if it happens again, open Diagnostics.',
    reload: ru ? 'Перезагрузить' : 'Reload',
    details: ru ? 'Технические детали' : 'Technical details',
  };
}

function renderFatalFallback(error: unknown) {
  const root = document.getElementById('root');
  if (!root || root.dataset.fatalFallback === 'true') return;
  root.dataset.fatalFallback = 'true';
  const copy = fallbackCopy();
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  root.innerHTML = '';
  const main = document.createElement('main');
  main.className = 'min-h-screen bg-stone-50 px-5 py-12 text-stone-900';
  main.innerHTML = [
    '<div class="mx-auto max-w-lg rounded-3xl border border-stone-200 bg-white p-7 text-center shadow-sm">',
    '<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-xl">!</div>',
    '<h1 class="mt-4 text-xl font-bold"></h1>',
    '<p class="mt-2 text-sm leading-6 text-stone-500"></p>',
    '<button type="button" class="mt-6 h-11 rounded-xl bg-stone-950 px-5 text-sm font-semibold text-white"></button>',
    '<details class="mt-5 text-left"><summary class="cursor-pointer text-xs font-semibold text-stone-400"></summary><pre class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-3 text-[10px] text-stone-500"></pre></details>',
    '</div>',
  ].join('');
  const title = main.querySelector('h1');
  const body = main.querySelector('p');
  const button = main.querySelector('button');
  const summary = main.querySelector('summary');
  const pre = main.querySelector('pre');
  if (title) title.textContent = copy.title;
  if (body) body.textContent = copy.message;
  if (button) {
    button.textContent = copy.reload;
    button.addEventListener('click', () => window.location.reload());
  }
  if (summary) summary.textContent = copy.details;
  if (pre) pre.textContent = message;
  root.appendChild(main);
}

export function installGlobalCrashFallback() {
  const onError = (event: ErrorEvent) => {
    console.error('[GlobalCrashFallback] Uncaught error', event.error || event.message);
    renderFatalFallback(event.error || event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason?.code === 'NETWORK_OFFLINE' || reason?.code === 'NETWORK_UNAVAILABLE') return;
    console.error('[GlobalCrashFallback] Unhandled rejection', reason);
    renderFatalFallback(reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
