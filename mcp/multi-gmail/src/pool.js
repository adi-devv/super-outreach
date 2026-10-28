import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logError } from './log.js';
import { textFromHtml } from './mime.js';
import { threadHasReply } from './planner.js';

const networkCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'ETIMEOUT', 'NoConnection', 'SocketClosed', 'EPIPE']);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export { headerValue };
export function isNetworkError(error) {
  const message = String(error?.message || error);
  return networkCodes.has(error?.code) || /socket closed|not connected|connection.*closed/i.test(message);
}

export async function withRetry(operation) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation(attempt); }
    catch (error) {
      lastError = error;
      if (!isNetworkError(error) || attempt === 2) throw error;
      await delay(attempt === 0 ? 500 : 1500);
    }
  }
  throw lastError;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (Buffer.isBuffer(headers) || typeof headers === 'string') {
    const text = String(headers).replace(/\r?\n[ \t]+/g, ' ');
    const match = new RegExp(`^${name}:[ \\t]*(.*)$`, 'im').exec(text);
    return match ? match[1].trim() : undefined;
  }
  const value = headers.get?.(name) ?? headers.get?.(name.toLowerCase()) ?? headers[name] ?? headers[name.toLowerCase()];
  return Buffer.isBuffer(value) ? value.toString() : Array.isArray(value) ? String(value[0]) : value == null ? undefined : String(value);
}

function addressList(value) {
  return (value || []).map((address) => address.address || address.name).filter(Boolean);
}

function dateValue(value) { return value?.toISOString?.() || value; }
function labels(value) { return [...(value || [])]; }
function stripQuoted(text = '') { return text.replace(/^On .+wrote:\s*[\s\S]*$/mi, '').replace(/^(?:>.*(?:\r?\n|$))+/gm, '').trim(); }

async function parsed(message) {
  const value = message.source ? await simpleParser(message.source) : {};
  const headers = value.headers || new Map();
  return {
    uid: message.uid, messageId: message.envelope?.messageId || value.messageId || headerValue(message.headers, 'message-id'),
    threadId: message.threadId == null ? undefined : String(message.threadId), inReplyTo: message.envelope?.inReplyTo || value.inReplyTo || headerValue(message.headers, 'in-reply-to'),
    references: Array.isArray(value.references) ? value.references.join(' ') : value.references || headerValue(message.headers, 'references'),
    from: addressList(message.envelope?.from || value.from?.value), to: addressList(message.envelope?.to || value.to?.value),
    cc: addressList(message.envelope?.cc || value.cc?.value), replyTo: addressList(message.envelope?.replyTo || value.replyTo?.value),
    subject: message.envelope?.subject || value.subject || '', date: dateValue(message.envelope?.date || value.date || message.internalDate),
    labels: labels(message.labels), textBody: stripQuoted(value.html ? textFromHtml(value.html) : value.text || ''),
  };
}

export class ImapPool {
  constructor(accountStore, Client = ImapFlow) {
    this.accounts = accountStore.accounts;
    this.passwordFor = accountStore.passwordFor;
    this.Client = Client;
    this.entries = new Map(this.accounts.map((account) => [account.name, {
      account, client: null, folders: null, chain: Promise.resolve(), healthy: true, lastError: undefined, assignedThisSession: 0,
    }]));
  }

  entry(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unknown account: ${name}`);
    return entry;
  }

  state(name) {
    const e = this.entry(name);
    return { healthy: e.healthy, lastError: e.lastError, assignedThisSession: e.assignedThisSession };
  }

  markUnhealthy(name, error) {
    const e = this.entry(name); e.healthy = false; e.lastError = String(error?.message || error); return e;
  }

  lock(name, operation) {
    const entry = this.entry(name);
    const next = entry.chain.then(operation, operation);
    entry.chain = next.catch(() => {});
    return next;
  }

  async connect(entry) {
    if (entry.client?.usable) return entry.client;
    if (entry.client) { try { await this.logout(entry.client); } catch {} }
    const client = new this.Client({
      host: 'imap.gmail.com', port: 993, secure: true, logger: false,
      auth: { user: entry.account.email, pass: this.passwordFor(entry.account.name) },
    });
    client.on('close', () => { if (entry.client === client) { entry.client = null; entry.folders = null; } });
    client.on('error', (error) => { if (entry.client === client) { entry.client = null; entry.folders = null; entry.lastError = String(error?.message || error); } });
    await client.connect();
    entry.client = client; entry.healthy = true; entry.lastError = undefined;
    return client;
  }

  async folders(entry, client) {
    if (entry.folders) return entry.folders;
    const mailboxes = await client.list();
    const find = (specialUse) => mailboxes.find((mailbox) => mailbox.specialUse === specialUse)?.path;
    const drafts = find('\\Drafts'); const trash = find('\\Trash');
    if (!drafts || !trash) throw new Error('Could not find Drafts or Trash by special-use flag.');
    entry.folders = { drafts, trash, all: find('\\All'), sent: find('\\Sent') };
    return entry.folders;
  }

  async run(name, operation) {
    return this.lock(name, async () => withRetry(async (attempt) => {
      const entry = this.entry(name);
      if (attempt) { try { await this.logout(entry.client); } catch {} entry.client = null; entry.folders = null; }
      const client = await this.connect(entry);
      const folders = await this.folders(entry, client);
      return operation(client, folders, entry, attempt);
    }));
  }

  async logout(client) {
    if (!client) return;
    let timer;
    try {
      await Promise.race([client.logout(), new Promise((_, reject) => {
        timer = setTimeout(() => { const error = new Error('IMAP logout timed out'); error.code = 'ETIMEOUT'; reject(error); }, 2000);
      })]);
    } catch (error) {
      client.close?.();
      throw error;
    } finally { clearTimeout(timer); }
  }

  async draftMessages(name, query) {
    return this.run(name, async (client, folders) => {
      const mailbox = await client.getMailboxLock(folders.drafts);
      try {
        const range = query ? await client.search({ gmailRaw: query }) : '1:*';
        const messages = [];
        for await (const message of client.fetch(range, { uid: true, flags: true, envelope: true, headers: ['message-id', 'x-mgmcp', 'x-mgmcp-key'] })) {
          messages.push({
            uid: message.uid, messageId: message.envelope?.messageId || headerValue(message.headers, 'message-id'),
            to: addressList(message.envelope?.to), cc: addressList(message.envelope?.cc), subject: message.envelope?.subject || '',
            date: message.envelope?.date?.toISOString?.() || message.envelope?.date,
            createdByTool: headerValue(message.headers, 'x-mgmcp') === '1', key: headerValue(message.headers, 'x-mgmcp-key'), isDraft: message.flags?.has('\\Draft') === true,
          });
        }
        return messages;
      } finally { mailbox.release(); }
    });
  }

  async draftCount(name) { return (await this.draftMessages(name)).length; }

  async appendDraft(name, raw) {
    const messageId = headerValue(raw, 'message-id');
    return this.run(name, async (client, folders, entry, attempt) => {
      if (attempt) {
        try {
          const existing = await this.draftWithMessageId(client, folders, messageId);
          if (existing) return { uid: existing.uid, reconciled: true };
        } catch (error) {
          const uncertain = new Error('Draft append outcome is uncertain.'); uncertain.uncertain = true; throw uncertain;
        }
      }
      const mailbox = await client.getMailboxLock(folders.drafts);
      try {
        const result = await client.append(folders.drafts, raw, ['\\Draft', '\\Seen']);
        entry.assignedThisSession += 1;
        return result;
      } finally { mailbox.release(); }
    });
  }

  async draftWithMessageId(client, folders, messageId) {
    if (!messageId) throw new Error('Draft is missing Message-ID.');
    const mailbox = await client.getMailboxLock(folders.drafts);
    try {
      const matches = await client.search({ header: { 'message-id': messageId } }, { uid: true });
      if (matches === false) throw new Error('Draft search failed');
      if (!matches?.length) return undefined;
      const rows = await client.fetchAll(matches, { uid: true, headers: ['message-id'] }, { uid: true });
      return rows.find((message) => headerValue(message.headers, 'message-id') === messageId);
    } finally { mailbox.release(); }
  }

  async sentExists(name, firstRecipient, subject) {
    return this.run(name, async (client, folders) => {
      if (!folders.all) return false;
      const mailbox = await client.getMailboxLock(folders.all);
      try {
        const escaped = subject.replace(/"/g, '\\"');
        const matches = await client.search({ gmailRaw: `in:sent to:${firstRecipient} subject:"${escaped}"` });
        return matches.length > 0;
      } finally { mailbox.release(); }
    });
  }

  async searchMail(name, { query, folder = 'sent', limit = 20, sinceDays, hasReply } = {}) {
    return this.run(name, async (client, folders, entry) => {
      const path = folder === 'inbox' ? 'INBOX' : folders[folder];
      if (!path) throw new Error(`Could not find ${folder} by special-use flag.`);
      const mailbox = await client.getMailboxLock(path);
      let messages;
      try {
        const terms = [query, sinceDays ? `newer_than:${sinceDays}d` : ''].filter(Boolean).join(' ');
        const range = await client.search(terms ? { gmraw: terms } : { all: true }, { uid: true });
        if (range === false) throw new Error('Search failed');
        messages = [];
        for await (const message of client.fetch(range || [], { uid: true, envelope: true, internalDate: true, labels: true, threadId: true }, { uid: true })) messages.push(await parsed(message));
      } finally { mailbox.release(); }
      messages.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      const threads = new Map();
      const all = await client.getMailboxLock(folders.all || path);
      try {
        const threadFor = async (threadId) => {
          if (!threadId) return [];
          if (!threads.has(threadId)) {
            const range = await client.search({ threadId }, { uid: true }); const thread = [];
            for await (const message of client.fetch(range || [], { uid: true, envelope: true, internalDate: true, threadId: true, headers: ['message-id', 'in-reply-to', 'references'] }, { uid: true })) thread.push(await parsed(message));
            threads.set(threadId, thread);
          }
          return threads.get(threadId);
        };
        const selected = [];
        for (const message of messages) {
          const thread = hasReply === undefined ? undefined : await threadFor(message.threadId);
          if (hasReply === undefined || threadHasReply(thread, entry.account.email, message) === hasReply) selected.push(message);
          if (selected.length === limit) break;
        }
        if (hasReply === undefined) await Promise.all(selected.map((message) => threadFor(message.threadId)));
        messages = selected;
      } finally { all.release(); }
      const bodyLock = await client.getMailboxLock(path);
      try {
        const bodies = await client.fetchAll(messages.map((message) => message.uid), { uid: true, envelope: true, internalDate: true, labels: true, threadId: true, source: true }, { uid: true });
        const byUid = new Map((await Promise.all(bodies.map(parsed))).map((message) => [message.uid, message]));
        return messages.map((message) => ({ ...message, ...byUid.get(message.uid) })).map(({ uid, messageId, threadId, from, to, cc, subject, date, textBody, labels: messageLabels }) => ({ uid, messageId, threadId, from, to, cc, subject, date, snippet: textBody.slice(0, 200), labels: messageLabels, threadMessageCount: (threads.get(threadId) || []).length }));
      } finally { bodyLock.release(); }
    });
  }

  async findMessage(name, messageId) {
    return this.run(name, async (client, folders) => {
      if (!folders.all) throw new Error('Could not find All Mail by special-use flag.');
      const mailbox = await client.getMailboxLock(folders.all);
      try {
        const id = String(messageId).replace(/[<>]/g, '');
        const range = await client.search({ gmraw: `rfc822msgid:${id}` });
        const message = await client.fetchOne((range || [])[0], { uid: true, envelope: true, internalDate: true, labels: true, threadId: true, source: true });
        return message ? parsed(message) : undefined;
      } finally { mailbox.release(); }
    });
  }

  async readThread(name, { threadId, messageId } = {}) {
    return this.run(name, async (client, folders) => {
      if (!folders.all) throw new Error('Could not find All Mail by special-use flag.');
      const mailbox = await client.getMailboxLock(folders.all);
      try {
        let id = threadId;
        if (!id && messageId) {
          const found = await client.search({ gmraw: `rfc822msgid:${String(messageId).replace(/[<>]/g, '')}` });
          const message = await client.fetchOne((found || [])[0], { threadId: true });
          id = message?.threadId;
        }
        if (!id) throw new Error('Message was not found.');
        const range = await client.search({ threadId: String(id) }); const messages = [];
        for await (const message of client.fetch(range || [], { uid: true, envelope: true, internalDate: true, labels: true, threadId: true, source: true, headers: ['message-id', 'in-reply-to', 'references'] })) messages.push(await parsed(message));
        return messages.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      } finally { mailbox.release(); }
    });
  }

  async replyDrafts(name) {
    return this.run(name, async (client, folders) => {
      const mailbox = await client.getMailboxLock(folders.drafts);
      try {
        const output = [];
        for await (const message of client.fetch('1:*', { envelope: true, headers: ['in-reply-to'] })) {
          output.push({ inReplyTo: headerValue(message.headers, 'in-reply-to') || message.envelope?.inReplyTo, to: addressList(message.envelope?.to), cc: addressList(message.envelope?.cc) });
        }
        return output;
      } finally { mailbox.release(); }
    });
  }

  async deleteToolDraft(name, messageId) {
    return this.run(name, async (client, folders) => {
      const mailbox = await client.getMailboxLock(folders.drafts);
      try {
        const matches = await client.search({ header: { 'message-id': messageId } }, { uid: true });
        if (matches === false || !matches?.length) return false;
        const rows = await client.fetchAll(matches, { uid: true, flags: true, headers: ['message-id', 'x-mgmcp'] }, { uid: true });
        const draft = rows.find((message) => headerValue(message.headers, 'message-id') === messageId && messageId.includes('.mgmcp@') && headerValue(message.headers, 'x-mgmcp') === '1' && message.flags?.has('\\Draft'));
        return draft ? Boolean(await client.messageMove(draft.uid, folders.trash, { uid: true })) : false;
      } finally { mailbox.release(); }
    });
  }

  async verify(name) { return this.run(name, async (_client, folders) => ({ drafts: folders.drafts })); }

  async close() {
    await Promise.all([...this.entries.values()].map(async (entry) => { try { await this.logout(entry.client); } catch (error) { logError(error, 'IMAP close: '); } }));
  }
}
