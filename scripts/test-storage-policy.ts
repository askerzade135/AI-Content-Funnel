import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const rules = fs.readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');
const lifecycle = JSON.parse(fs.readFileSync(new URL('../infra/publication-storage-lifecycle.json', import.meta.url), 'utf8'));
const deploy = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

test('publication storage rules are owner scoped and capped at 400 MB video', () => {
  assert.match(rules, /match \/publication-assets\/\{userId\}\/\{fileName\}/);
  assert.match(rules, /request\.auth\.uid == userId/);
  assert.match(rules, /request\.resource\.size <= 400 \* 1024 \* 1024/);
  assert.match(rules, /request\.resource\.contentType\.matches\('video\/\.\*'\)/);
  assert.match(rules, /allow update: if false/);
});

test('publication storage lifecycle hard deletes temporary assets after 7 days', () => {
  const rule = lifecycle.rule?.find((item: any) =>
    item?.action?.type === 'Delete' &&
    item?.condition?.age === 7 &&
    item?.condition?.matchesPrefix?.includes('publication-assets/')
  );
  assert.ok(rule);
});

test('production deploy applies and verifies lifecycle, soft delete, and Firebase Storage rules', () => {
  assert.match(deploy, /--lifecycle-file="infra\/publication-storage-lifecycle\.json"/);
  assert.match(deploy, /--clear-soft-delete/);
  assert.match(deploy, /firebase-tools@latest deploy/);
  assert.match(deploy, /--only storage/);
  assert.match(deploy, /Verify temporary publication storage policy/);
});
