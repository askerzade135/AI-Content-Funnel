import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin, requireAuth } from '../server/auth.js';

// Unit-level middleware regression checks. This does not replace real Firebase login E2E.
async function request(header?: string) {
  const req: any = { headers: { authorization: header }, method: 'GET', path: '/radar/scripts' };
  let status = 200;
  let body: any;
  let next = false;
  const res: any = {
    status(code: number) { status = code; return this; },
    json(value: any) { body = value; return this; },
  };
  await requireAuth(req, res, () => { next = true; });
  return { status, body, next, user: req.user };
}

test('missing token is rejected even outside production', async () => {
  const result = await request();
  assert.equal(result.status, 401);
  assert.equal(result.body.code, 'AUTH_TOKEN_MISSING');
  assert.equal(result.next, false);
});

test('empty bearer token is rejected', async () => {
  assert.equal((await request('Bearer ')).status, 401);
});

test('invalid token is rejected; verified identity reaches the handler', async () => {
  const auth = getAuth(getFirebaseAdmin());
  const original = auth.verifyIdToken;
  try {
    auth.verifyIdToken = async () => { throw Object.assign(new Error('Invalid test signature'), { code: 'auth/invalid-id-token' }); };
    const invalid = await request('Bearer invalid-test-token');
    assert.equal(invalid.status, 401);
    assert.equal(invalid.next, false);
    auth.verifyIdToken = async () => ({ uid: 'owner-a', email: 'owner-a@example.test' } as any);
    const valid = await request('Bearer verified-by-test-double');
    assert.equal(valid.next, true);
    assert.equal(valid.user.uid, 'owner-a');
  } finally { auth.verifyIdToken = original; }
});
