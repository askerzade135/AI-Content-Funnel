import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  reauthenticateWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { showToast } from '../utils/toastEmitter';

export const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({
  prompt: 'consent',
});

let isSigningIn = false;
// OAuth tokens belong to one Firebase user and expire independently of ID tokens.
function tokenKey(kind: string): string | null {
  return auth.currentUser ? `radar_oauth:${auth.currentUser.uid}:${kind}` : null;
}
function storeToken(kind: string, token: string) {
  const key = tokenKey(kind);
  if (key) try { sessionStorage.setItem(key, JSON.stringify({ token, expiresAt: Date.now() + 50 * 60_000 })); } catch {}
}
function readToken(kind: string): string | null {
  const key = tokenKey(kind);
  if (!key) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    return value?.expiresAt > Date.now() ? value.token : null;
  } catch { return null; }
}
async function authorizeCurrentUser(provider: GoogleAuthProvider) {
  const user = auth.currentUser;
  if (!user) throw new Error('Войдите в Content Radar перед подключением интеграции');
  return reauthenticateWithPopup(user, provider);
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const token = await getAccessToken();
      if (token) {
        if (onAuthSuccess) onAuthSuccess(user, token);
      } else {
        if (onAuthSuccess) onAuthSuccess(user, '');
      }
    } else {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = auth.currentUser
      ? await authorizeCurrentUser(provider)
      : await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      storeToken('docs', credential.accessToken);
      return { user: result.user, accessToken: credential.accessToken };
    }
    return null;
  } catch (error: any) {
    const code = error?.code || 'auth-error';
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request'
    ) {
      return null;
    }

    if (code === 'auth/unauthorized-domain') {
      showToast(
        'Домен не авторизован',
        'Добавьте текущий домен в Authorized domains в консоли Firebase Authentication и JavaScript origins в Google Cloud Console.',
        code,
        'error'
      );
    } else if (code === 'auth/popup-blocked') {
      showToast(
        'Всплывающее окно заблокировано',
        'Браузер заблокировал окно входа. Пожалуйста, разрешите всплывающие окна для этого сайта.',
        code,
        'error'
      );
    } else {
      showToast('Ошибка авторизации Google', error?.message || 'Произошла ошибка при попытке входа через всплывающее окно', code, 'error');
    }
    console.warn('Google Sign in popup error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => readToken('docs');

export const logout = async () => {
  for (const kind of ['docs', 'calendar']) {
    const key = tokenKey(kind);
    if (key) try { sessionStorage.removeItem(key); } catch {}
  }
  await signOut(auth);
};

export const connectYouTube = async (): Promise<{ accessToken: string } | null> => {
  const youtubeProvider = new GoogleAuthProvider();
  youtubeProvider.addScope('https://www.googleapis.com/auth/youtube.readonly');
  youtubeProvider.setCustomParameters({
    prompt: 'consent',
    include_granted_scopes: 'true',
  });

  try {
    const result = await authorizeCurrentUser(youtubeProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) return null;
    return { accessToken: credential.accessToken };
  } catch (error: any) {
    const code = error?.code || 'youtube-auth-error';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
    showToast('Ошибка подключения YouTube', error?.message || 'Не удалось получить доступ к YouTube', code, 'error');
    throw error;
  }
};


export const connectGoogleCalendar = async (): Promise<{ accessToken: string } | null> => {
  const calendarProvider = new GoogleAuthProvider();
  calendarProvider.addScope('https://www.googleapis.com/auth/calendar.app.created');
  calendarProvider.addScope('https://www.googleapis.com/auth/calendar.calendarlist.readonly');
  calendarProvider.setCustomParameters({
    prompt: 'consent',
    include_granted_scopes: 'true',
  });

  try {
    const result = await authorizeCurrentUser(calendarProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) return null;
    storeToken('calendar', credential.accessToken);
    return { accessToken: credential.accessToken };
  } catch (error: any) {
    const code = error?.code || 'calendar-auth-error';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
    showToast('Ошибка подключения Google Calendar', error?.message || 'Не удалось получить доступ к календарю', code, 'error');
    throw error;
  }
};

export const getCalendarAccessToken = async (): Promise<string | null> => readToken('calendar');
