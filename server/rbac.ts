import { createHash, randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  type AppDatabase,
  type AdminInvite,
  PRIMARY_OWNER_EMAIL,
  type UserAccount,
  type UserRole,
  getDb,
} from './storage.js';

export interface AuthIdentity {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

export type PublicAdminInvite = Omit<AdminInvite, 'tokenHash'> & {
  status: 'active' | 'used' | 'revoked' | 'expired';
};

export const normalizeEmail = (value?: string) => String(value || '').trim().toLowerCase();
export const hashAdminInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function getInviteStatus(invite: AdminInvite, now = new Date()): PublicAdminInvite['status'] {
  if (invite.revokedAt) return 'revoked';
  if (invite.usedAt) return 'used';
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

export function publicAdminInvite(invite: AdminInvite, now = new Date()): PublicAdminInvite {
  const { tokenHash: _tokenHash, ...rest } = invite;
  return { ...rest, status: getInviteStatus(invite, now) };
}

export function resolveUserRole(db: AppDatabase, identity?: Partial<AuthIdentity> | null): UserRole {
  const email = normalizeEmail(identity?.email);
  if (email && email === normalizeEmail(PRIMARY_OWNER_EMAIL)) return 'owner';
  const account = (db.users || []).find(user =>
    (identity?.uid && user.id === identity.uid) ||
    (email && normalizeEmail(user.email) === email)
  );
  return account?.role || 'member';
}

export function upsertAuthenticatedUser(db: AppDatabase, identity: AuthIdentity, now = new Date()): UserAccount {
  if (!db.users) db.users = [];
  const email = normalizeEmail(identity.email);
  const existing = db.users.find(user =>
    user.id === identity.uid || (email && normalizeEmail(user.email) === email)
  );
  const role: UserRole = email === normalizeEmail(PRIMARY_OWNER_EMAIL) ? 'owner' : (existing?.role || 'member');

  if (existing) {
    existing.id = identity.uid;
    if (identity.email) existing.email = identity.email.trim();
    if (identity.name) existing.name = identity.name;
    if (identity.picture) existing.avatarUrl = identity.picture;
    existing.role = role;
    existing.lastLoginAt = now.toISOString();
    return existing;
  }

  const created: UserAccount = {
    id: identity.uid,
    email: identity.email?.trim() || '',
    name: identity.name,
    avatarUrl: identity.picture,
    role,
    createdAt: now.toISOString(),
    lastLoginAt: now.toISOString(),
  };
  db.users.push(created);
  return created;
}

export function createAdminInvite(
  db: AppDatabase,
  emailInput: string,
  createdBy: string,
  expiresInHours = 48,
  now = new Date()
): { invite: AdminInvite; token: string } {
  const email = normalizeEmail(emailInput);
  if (!email || !email.includes('@')) throw new Error('VALID_EMAIL_REQUIRED');
  if (!Number.isFinite(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) throw new Error('INVALID_INVITE_EXPIRY');
  if (!db.adminInvites) db.adminInvites = [];

  for (const invite of db.adminInvites) {
    if (normalizeEmail(invite.email) === email && getInviteStatus(invite, now) === 'active') {
      invite.revokedAt = now.toISOString();
      invite.revokedBy = createdBy;
    }
  }

  const token = randomBytes(32).toString('base64url');
  const invite: AdminInvite = {
    id: `admin-invite-${now.getTime()}-${randomBytes(4).toString('hex')}`,
    email,
    tokenHash: hashAdminInviteToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString(),
    createdBy,
  };
  db.adminInvites.push(invite);
  return { invite, token };
}

export function revokeAdminInvite(db: AppDatabase, inviteId: string, revokedBy: string, now = new Date()): AdminInvite {
  const invite = (db.adminInvites || []).find(item => item.id === inviteId);
  if (!invite) throw new Error('INVITE_NOT_FOUND');
  if (invite.usedAt) throw new Error('INVITE_ALREADY_USED');
  if (!invite.revokedAt) {
    invite.revokedAt = now.toISOString();
    invite.revokedBy = revokedBy;
  }
  return invite;
}

export function acceptAdminInvite(
  db: AppDatabase,
  token: string,
  identity: AuthIdentity,
  now = new Date()
): { invite: AdminInvite; account: UserAccount } {
  const tokenHash = hashAdminInviteToken(String(token || ''));
  const invite = (db.adminInvites || []).find(item => item.tokenHash === tokenHash);
  if (!invite) throw new Error('INVITE_INVALID');

  const status = getInviteStatus(invite, now);
  if (status === 'revoked') throw new Error('INVITE_REVOKED');
  if (status === 'used') throw new Error('INVITE_ALREADY_USED');
  if (status === 'expired') throw new Error('INVITE_EXPIRED');

  const signedInEmail = normalizeEmail(identity.email);
  if (!signedInEmail || signedInEmail !== normalizeEmail(invite.email)) throw new Error('INVITE_EMAIL_MISMATCH');

  const account = upsertAuthenticatedUser(db, identity, now);
  if (account.role !== 'owner') account.role = 'admin';
  invite.usedAt = now.toISOString();
  invite.usedByUserId = identity.uid;
  return { invite, account };
}

export function setManagedUserRole(db: AppDatabase, userId: string, role: Exclude<UserRole, 'owner'>): UserAccount {
  const account = (db.users || []).find(user => user.id === userId);
  if (!account) throw new Error('USER_NOT_FOUND');
  if (account.role === 'owner' || normalizeEmail(account.email) === normalizeEmail(PRIMARY_OWNER_EMAIL)) {
    throw new Error('OWNER_ROLE_IMMUTABLE');
  }
  account.role = role;
  return account;
}

function sendRoleForbidden(res: Response, code: string) {
  return res.status(403).json({ error: 'Forbidden', code });
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = await getDb();
    const role = resolveUserRole(db, req.user);
    if (role !== 'owner' && role !== 'admin') {
      sendRoleForbidden(res, 'ADMIN_REQUIRED');
      return;
    }
    if (req.user) req.user.role = role;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = await getDb();
    const role = resolveUserRole(db, req.user);
    if (role !== 'owner') {
      sendRoleForbidden(res, 'OWNER_REQUIRED');
      return;
    }
    if (req.user) req.user.role = role;
    next();
  } catch (error) {
    next(error);
  }
}
