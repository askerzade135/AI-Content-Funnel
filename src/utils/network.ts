function networkMessage(): string {
  const language = typeof document !== 'undefined'
    ? document.documentElement.lang
    : typeof navigator !== 'undefined'
      ? navigator.language
      : 'en';
  return String(language || '').toLowerCase().startsWith('ru')
    ? 'Нет подключения к интернету'
    : 'No internet connection';
}

export class NetworkUnavailableError extends Error {
  code = 'NETWORK_OFFLINE';
  constructor(message = networkMessage()) {
    super(message);
    this.name = 'NetworkUnavailableError';
  }
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function normalizeNetworkError(error: unknown): Error {
  if (error instanceof NetworkUnavailableError) return error;
  if (isBrowserOffline()) return new NetworkUnavailableError();
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message || '')) {
    const normalized: any = new Error(networkMessage());
    normalized.code = 'NETWORK_UNAVAILABLE';
    normalized.cause = error;
    return normalized;
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function isNetworkError(error: unknown): boolean {
  const normalized: any = normalizeNetworkError(error);
  return normalized?.code === 'NETWORK_OFFLINE' || normalized?.code === 'NETWORK_UNAVAILABLE';
}
