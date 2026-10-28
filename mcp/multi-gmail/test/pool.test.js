import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ImapPool } from '../src/pool.js';

const raw = (from, text) => Buffer.from(`From: ${from}\r\nTo: me@example.com\r\nSubject: Hello\r\nMessage-ID: <${from}@example.com>\r\nContent-Type: text/plain\r\n\r\n${text}`);

class FakeClient extends EventEmitter {
  constructor() { super(); this.usable = true; this.calls = []; this.path = ''; }
  async connect() {}
  async list() { return [{ path: 'Drafts', specialUse: '\\Drafts' }, { path: 'Trash', specialUse: '\\Trash' }, { path: 'Sent', specialUse: '\\Sent' }, { path: 'All', specialUse: '\\All' }]; }
  async getMailboxLock(path) { this.path = path; return { release() {} }; }
  async search(query) { this.calls.push(query); return query.threadId ? [1, 2] : [1]; }
  async *fetch(range, query) {
    const records = query.source ? [{ uid: 1, threadId: '42', envelope: { from: [{ address: 'me@example.com' }], to: [{ address: 'them@example.com' }], subject: 'Hello', messageId: '<me@example.com>', date: new Date('2026-01-01') }, internalDate: new Date('2026-01-01'), labels: new Set(['\\Sent']), source: raw('me@example.com', 'Sent text') }]
      : [{ uid: 1, threadId: '42', envelope: { from: [{ address: 'me@example.com' }] } }, { uid: 2, threadId: '42', envelope: { from: [{ address: 'them@example.com' }] } }];
    for (const id of range === '1:*' ? [1] : range) yield records[id - 1];
  }
  async logout() {}
}

test('search mail uses special-use folders, Gmail raw search, and thread reply filtering', async () => {
  const store = { accounts: [{ name: 'a', email: 'me@example.com' }], passwordFor: () => 'fake' };
  const pool = new ImapPool(store, FakeClient);
  const answered = await pool.searchMail('a', { folder: 'sent', query: 'project', sinceDays: 7, hasReply: true });
  assert.equal(answered.length, 1);
  assert.equal(answered[0].threadMessageCount, 2);
  assert.equal((await pool.searchMail('a', { folder: 'sent', hasReply: false })).length, 0);
  assert.ok(pool.entry('a').client.calls.some((query) => query.gmraw === 'project newer_than:7d'));
});
