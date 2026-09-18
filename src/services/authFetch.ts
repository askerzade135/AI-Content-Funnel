import { auth } from '../services/googleAuth';

/**
 * Helper to get the current Firebase ID Token.
 * Automatically refreshes the token if expired.
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return null;
  }
  try {
    // Force refresh if needed or get current valid token
    const token = await currentUser.getIdToken(false);
    return token;
  } catch (err) {
    console.warn('[Auth] Failed to get Firebase ID token:', err);
    return null;
  }
}

/**
 * Authenticated fetch wrapper that automatically attaches Authorization: Bearer <token>
 * to all API requests if the user is signed in.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = await getFirebaseIdToken();
  
  const headers = new Headers(init?.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const updatedInit: RequestInit = {
    ...init,
    headers,
  };

  return fetch(input, updatedInit);
}
