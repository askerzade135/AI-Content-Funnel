import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppDatabase } from '../server/storage.js';
import {
  acceptAdminInvite,
  createAdminInvite,
  getInviteStatus,
  resolveUserRole,
  revokeAdminInvite,
  setManagedUserRole,
} from '../server/rbac.js';

const makeDb = (): AppDatabase => ({
  users: [
    { id: 'owner-uid', email: 'askerzade135@gmail.com', role: 'owner', createdAt: '2026-09-24T00:00:00.000Z' },
    { id: 'member-uid', email: 'member@example.com', role: 'member', createdAt: '2026-09-24T00:00:00.000Z' },
  ],
  channels: [], videos: [], deletedVideos: [], scripts: [], promptTemplates: [], logs: [],
  settings: {
    dailySyncEnabled: true, intervalHours: 24, autoProcessNewVideos: false,
    defaultPromptTemplate: 'two_stage_pipeline', customPrompt: '',
    lastSyncRun: null, nextSyncRun: null,
  },
});

test('RBAC resolves owner/admin/member and protects owner role', () => {
  const db = makeDb();
  assert.equal(resolveUserRole(db, { uid: 'owner-uid', email: 'askerzade135@gmail.com' }), 'owner');
  assert.equal(resolveUserRole(db, { uid: 'member-uid', email: 'member@example.com' }), 'member');
  db.users!.push({ id: 'admin-uid', email: 'admin@example.com', role: 'admin', createdAt: '2026-09-24T00:00:00.000Z' });
  assert.equal(resolveUserRole(db, { uid: 'admin-uid', email: 'admin@example.com' }), 'admin');
  assert.equal(setManagedUserRole(db, 'admin-uid', 'member').role, 'member');
  assert.throws(() => setManagedUserRole(db, 'owner-uid', 'member'), /OWNER_ROLE_IMMUTABLE/);
});

test('admin invite is email-bound and single-use', () => {
  const db = makeDb();
  const now = new Date('2026-09-24T12:00:00.000Z');
  const { token, invite } = createAdminInvite(db, 'Admin@Example.com', 'owner-uid', 48, now);
  assert.equal(getInviteStatus(invite, now), 'active');
  assert.throws(() => acceptAdminInvite(db, token, { uid: 'wrong', email: 'wrong@example.com' }, now), /INVITE_EMAIL_MISMATCH/);
  const accepted = acceptAdminInvite(db, token, { uid: 'admin-uid', email: 'admin@example.com' }, now);
  assert.equal(accepted.account.role, 'admin');
  assert.equal(getInviteStatus(invite, now), 'used');
  assert.throws(() => acceptAdminInvite(db, token, { uid: 'admin-uid', email: 'admin@example.com' }, now), /INVITE_ALREADY_USED/);
});

test('admin invite expiry and revoke block acceptance', () => {
  const db = makeDb();
  const start = new Date('2026-09-24T12:00:00.000Z');
  const expired = createAdminInvite(db, 'expired@example.com', 'owner-uid', 1, start);
  const later = new Date('2026-09-24T13:00:01.000Z');
  assert.equal(getInviteStatus(expired.invite, later), 'expired');
  assert.throws(() => acceptAdminInvite(db, expired.token, { uid: 'expired', email: 'expired@example.com' }, later), /INVITE_EXPIRED/);

  const revoked = createAdminInvite(db, 'revoked@example.com', 'owner-uid', 48, start);
  revokeAdminInvite(db, revoked.invite.id, 'owner-uid', start);
  assert.equal(getInviteStatus(revoked.invite, start), 'revoked');
  assert.throws(() => acceptAdminInvite(db, revoked.token, { uid: 'revoked', email: 'revoked@example.com' }, start), /INVITE_REVOKED/);
});

test('new active invite supersedes an older active invite for the same email', () => {
  const db = makeDb();
  const start = new Date('2026-09-24T12:00:00.000Z');
  const first = createAdminInvite(db, 'admin@example.com', 'owner-uid', 48, start);
  const second = createAdminInvite(db, 'admin@example.com', 'owner-uid', 48, new Date(start.getTime() + 1000));
  assert.equal(getInviteStatus(first.invite, new Date(start.getTime() + 1000)), 'revoked');
  assert.equal(getInviteStatus(second.invite, new Date(start.getTime() + 1000)), 'active');
});
