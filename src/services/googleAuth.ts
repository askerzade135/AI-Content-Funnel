import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
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
let cachedAccessToken: string | null = null;

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
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
      try {
        sessionStorage.setItem('google_access_token', credential.accessToken);
      } catch (_) {}
      return { user: result.user, accessToken: cachedAccessToken };
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

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  try {
    const stored = sessionStorage.getItem('google_access_token');
    if (stored) {
      cachedAccessToken = stored;
      return stored;
    }
  } catch (_) {}
  return null;
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  try {
    sessionStorage.removeItem('google_access_token');
  } catch (_) {}
};


export const connectYouTube = async (): Promise<{ accessToken: string } | null> => {
  const youtubeProvider = new GoogleAuthProvider();
  youtubeProvider.addScope('https://www.googleapis.com/auth/youtube.readonly');
  youtubeProvider.setCustomParameters({
    prompt: 'consent',
    include_granted_scopes: 'true',
  });

  try {
    const result = await signInWithPopup(auth, youtubeProvider);
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
