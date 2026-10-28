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
  async fetchAll(range, query) { const messages = []; for await (const message of this.fetch(range, query)) messages.push(message); return messages; }
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

test('headerValue parses raw header buffers from imapflow', async () => {
  const { headerValue } = await import('../src/pool.js');
  const buf = Buffer.from(['Message-ID: <a@b.mgmcp@x>', 'X-MGMCP: 1', 'References: <a>', ' <b>', '', ''].join(String.fromCharCode(13, 10)));
  assert.equal(headerValue(buf, 'x-mgmcp'), '1');
  assert.equal(headerValue(buf, 'message-id'), '<a@b.mgmcp@x>');
  assert.equal(headerValue(buf, 'references'), '<a> <b>');
  assert.equal(headerValue(buf, 'x-none'), undefined);
});

class DeleteClient extends FakeClient {
  async search() { return [1, 2]; }
  async fetchAll() {
    return [
      { uid: 1, headers: new Map([['message-id', '<other.mgmcp@example.com>'], ['x-mgmcp', '1']]), flags: new Set(['\\Draft']) },
      { uid: 2, headers: new Map([['message-id', '<target.mgmcp@example.com>'], ['x-mgmcp', '1']]), flags: new Set(['\\Draft']) },
    ];
  }
  async messageMove(uid) { this.moved = uid; return false; }
}

test('delete requires an exact tool draft id and reports failed moves', async () => {
  const pool = new ImapPool({ accounts: [{ name: 'a', email: 'me@example.com' }], passwordFor: () => 'fake' }, DeleteClient);
  assert.equal(await pool.deleteToolDraft('a', '<target.mgmcp@example.com>'), false);
  assert.equal(pool.entry('a').client.moved, 2);
});

class SearchClient extends FakeClient {
  constructor() { super(); this.bodyFetches = 0; }
  async search(query) { return query.threadId ? [Number(query.threadId)] : Array.from({ length: 30 }, (_, index) => index + 1); }
  async *fetch(range, query) {
    if (query.source) this.bodyFetches += range.length;
    for (const uid of range) yield {
      uid, threadId: String(uid), internalDate: new Date(2026, 0, uid), labels: new Set(['\\Sent']),
      envelope: { from: [{ address: 'me@example.com' }], to: [{ address: 'them@example.com' }], subject: `Message ${uid}`, messageId: `<${uid}@example.com>`, date: new Date(2026, 0, uid) },
      ...(query.source ? { source: raw('me@example.com', `Message ${uid}`) } : {}),
    };
  }
}

test('search fetches bodies only for the returned messages', async () => {
  const pool = new ImapPool({ accounts: [{ name: 'a', email: 'me@example.com' }], passwordFor: () => 'fake' }, SearchClient);
  assert.equal((await pool.searchMail('a', { limit: 3 })).length, 3);
  assert.equal(pool.entry('a').client.bodyFetches, 3);
});

class AppendClient extends FakeClient {
  constructor() { super(); this.store = AppendClient.store; }
  async search() { return this.store.messageId ? [1] : []; }
  async fetchAll() { return [{ uid: 1, headers: new Map([['message-id', this.store.messageId]]) }]; }
  async append(_path, value) {
    this.store.calls += 1; this.store.messageId = String(value).match(/^Message-ID:\s*(.+)$/mi)[1];
    const error = new Error('lost acknowledgement'); error.code = 'ECONNRESET'; throw error;
  }
}
AppendClient.store = { calls: 0, messageId: undefined };

test('append reconciliation avoids duplicating a lost acknowledgement', async () => {
  AppendClient.store = { calls: 0, messageId: undefined };
  const pool = new ImapPool({ accounts: [{ name: 'a', email: 'me@example.com' }], passwordFor: () => 'fake' }, AppendClient);
  const result = await pool.appendDraft('a', Buffer.from('Message-ID: <one.mgmcp@example.com>\r\n\r\nhello'));
  assert.equal(result.reconciled, true);
  assert.equal(AppendClient.store.calls, 1);
});
