import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps, getApp, App, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

// Extend Express Request type with authenticated user payload
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email?: string;
        name?: string;
        picture?: string;
        role?: string;
      };
    }
  }
}

let firebaseAdminApp: App | null = null;

/**
 * Lazily initialize Firebase Admin SDK using available project configuration
 */
export function getFirebaseAdmin(): App {
  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0 && existingApps[0]) {
    firebaseAdminApp = existingApps[0];
    return firebaseAdminApp;
  }

  try {
    let projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

    if (!projectId) {
      try {
        const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
        if (fs.existsSync(configPath)) {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          projectId = cfg.projectId;
        }
      } catch {
        // ignore
      }
    }

    if (!projectId) {
      projectId = 'still-bond-mghtt';
    }

    const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (saKey) {
      try {
        const sa = typeof saKey === 'string' ? JSON.parse(saKey) : saKey;
        firebaseAdminApp = initializeApp({
          credential: cert(sa),
          projectId: sa.project_id || projectId,
        });
        console.log(`[Firebase Admin] Initialized with Service Account for projectId='${sa.project_id || projectId}'`);
        return firebaseAdminApp;
      } catch (saErr: any) {
        console.warn('[Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', saErr?.message || saErr);
      }
    }

    firebaseAdminApp = initializeApp({
      projectId,
    });
    console.log(`[Firebase Admin] Initialized Firebase Admin SDK for projectId='${projectId}'`);
    return firebaseAdminApp;
  } catch (err) {
    console.error('[Firebase Admin] Initialization failed:', err);
    throw err;
  }
}

/**
 * Express middleware to authenticate requests with Firebase ID tokens.
 * Extracts Bearer token from 'Authorization' header, verifies it, and attaches decoded user to req.user.
 * Rejects requests without valid token with HTTP 401 Unauthorized.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn(`[Auth Warning] 401 Unauthorized (Missing Bearer) for ${req.method} ${req.path}`);
    res.status(401).json({
      error: 'Unauthorized: missing or invalid Authorization header. Expected Bearer token.',
      code: 'AUTH_TOKEN_MISSING',
    });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1]?.trim();
  if (!idToken) {
    console.warn(`[Auth Warning] 401 Unauthorized (Empty Token) for ${req.method} ${req.path}`);
    res.status(401).json({
      error: 'Unauthorized: token is empty.',
      code: 'AUTH_TOKEN_EMPTY',
    });
    return;
  }

  try {
    const adminApp = getFirebaseAdmin();
    const auth = getAuth(adminApp);

    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
      picture: decodedToken.picture,
    };
    console.log(`[Auth Success] User authenticated: uid=${req.user.uid}, email=${req.user.email} for ${req.method} ${req.path}`);
    next();
  } catch (error: any) {
    // Check specific Firebase Auth error codes
    const errCode = error?.code || 'AUTH_TOKEN_INVALID';
    console.warn(`[Auth Middleware] Token verification failed: ${error?.message || error} (code: ${errCode}) for ${req.method} ${req.path}`);
    
    res.status(401).json({
      error: 'Unauthorized: invalid or expired Firebase ID token.',
      code: errCode,
      message: error?.message || 'Token verification failed',
    });
  }
}
