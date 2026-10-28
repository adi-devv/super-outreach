import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceDrafts, dedupeKey } from '../src/balancer.js';
import { planDrafts } from '../src/planner.js';
import { loadAccounts } from '../src/accounts.js';
import { createApp } from '../src/index.js';
import { redact, setRedactions } from '../src/log.js';

const accounts = (extra = {}) => ['a', 'b', 'c'].map((name) => ({ name, healthy: true, load: 0, drafts: 0, ...extra[name] }));
const draft = (to, cc = []) => ({ to: Array.from({ length: to }, (_, i) => `t${i}@example.com`), cc, subject: 'Hi', htmlBody: '<p>Hi</p>' });

test('equal weights spread evenly', () => {
  const assigned = balanceDrafts(Array.from({ length: 6 }, () => draft(1)), accounts());
  assert.deepEqual(assigned, ['a', 'b', 'c', 'a', 'b', 'c']);
});

test('mixed weights finish within the largest weight', () => {
  const drafts = [draft(5), draft(4), draft(3), draft(2), draft(1), draft(1)];
  const assigned = balanceDrafts(drafts, accounts());
  const loads = new Map(['a', 'b', 'c'].map((name) => [name, 0]));
  assigned.forEach((name, index) => loads.set(name, loads.get(name) + drafts[index].to.length));
  assert.ok(Math.max(...loads.values()) - Math.min(...loads.values()) <= 5);
});

test('capacity is respected and unhealthy accounts are skipped', () => {
  const assigned = balanceDrafts([draft(2), draft(2), draft(2)], accounts({ a: { maxPendingWeight: 2 }, b: { healthy: false }, c: { maxPendingWeight: 2 } }));
  assert.deepEqual(assigned, ['a', 'c', undefined]);
});

test('dedupe key ignores recipient case and order', () => {
  assert.equal(dedupeKey({ to: ['B@EXAMPLE.COM', 'a@example.com'], cc: ['c@example.com'], subject: ' Hello ' }), dedupeKey({ to: ['a@example.com', 'b@example.com'], cc: ['C@EXAMPLE.COM'], subject: 'hello' }));
});

test('dry planning needs no pool or network', () => {
  const second = { ...draft(1), subject: 'Different' };
  const plan = planDrafts([draft(1), second], accounts());
  assert.deepEqual(plan.results.map((result) => [result.status, result.account]), [['planned', 'a'], ['planned', 'b']]);
});

test('a fake account file builds the dry-run server without connecting', () => {
  const store = loadAccounts(new URL('./fixtures/accounts.fake.json', import.meta.url));
  let touched = false;
  const pool = { state: () => ({ healthy: true, assignedThisSession: 0 }), draftMessages: () => { touched = true; throw new Error('network'); } };
  const app = createApp({ accountStore: store, pool });
  assert.ok(app.server);
  assert.equal(touched, false);
});

test('redaction covers spaced and compact app passwords', () => {
  setRedactions(['fake pass word']);
  assert.equal(redact('fake pass word / fakepassword'), '*** / ***');
});
