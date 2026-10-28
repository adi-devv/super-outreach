import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { loadAccounts } from './accounts.js';
import { ImapPool } from './pool.js';
import { buildRaw } from './mime.js';
import { dedupeKey, draftWeight, balanceDrafts } from './balancer.js';
import { planDrafts, planReplies, replyDedupeKey } from './planner.js';
import { logError, redact, setRedactions } from './log.js';

const email = z.string().email();
const draftShape = z.object({ to: z.array(email).min(1).max(50), cc: z.array(email).optional(), subject: z.string().min(1), htmlBody: z.string() });
const replyShape = z.object({ replyTo: z.object({ account: z.string().min(1), messageId: z.string().min(1) }), htmlBody: z.string(), to: z.array(email).min(1).max(50).optional(), cc: z.array(email).max(50).optional(), subject: z.string().min(1).optional(), includeSignature: z.boolean().default(true) });
const text = (result) => ({ content: [{ type: 'text', text: JSON.stringify(result) }] });

function publicAccount(account, state, drafts = 0, pendingWeight = 0) {
  return { name: account.name, email: account.email, drafts, pendingWeight, assignedThisSession: state.assignedThisSession, healthy: state.healthy, ...(state.lastError ? { lastError: redact(state.lastError) } : {}), ...(state.error ? { error: state.error } : {}) };
}

function hint(error) {
  const message = String(error?.message || error);
  if (/auth|login|credential|password/i.test(message)) return 'Check the app password and that 2-Step Verification is enabled.';
  if (/disabled|not permitted|application-specific/i.test(message)) return 'Enable IMAP; Workspace policies can block app passwords.';
  return 'Check the account, network connection, IMAP setting, and Workspace app-password policy.';
}

export function createApp({ accountStore = loadAccounts(), pool = new ImapPool(accountStore) } = {}) {
  const accounts = accountStore.accounts;
  setRedactions(accountStore.redactions?.() || accounts.map((account) => accountStore.passwordFor(account.name)));
  const server = new McpServer({ name: 'multi-gmail-drafts', version: '0.1.0' });

  async function snapshot({ includeMessages = true } = {}) {
    return Promise.all(accounts.map(async (account) => {
      try {
        const messages = includeMessages ? await pool.draftMessages(account.name) : [];
        const state = pool.state(account.name);
        return { ...account, ...state, messages, drafts: messages.length, load: messages.reduce((total, message) => total + draftWeight(message), 0) };
      } catch (error) {
        pool.markUnhealthy(account.name, error);
        const state = pool.state(account.name);
        return { ...account, ...state, messages: [], drafts: undefined, load: undefined, error: redact(error) };
      }
    }));
  }

  server.registerTool('list_accounts', { inputSchema: {} }, async () => {
    const data = await snapshot();
    return text(data.map((item) => publicAccount(item, item, item.drafts, item.load)));
  });

  server.registerTool('create_drafts', {
    inputSchema: { drafts: z.array(draftShape).min(1).max(50), account: z.string().optional(), fallback: z.boolean().default(true), dryRun: z.boolean().default(false), checkSent: z.boolean().default(false) },
  }, async ({ drafts, account: forcedAccount, fallback, dryRun, checkSent }) => {
    try {
      if (forcedAccount && !accounts.some((item) => item.name === forcedAccount)) throw new Error(`Unknown account: ${forcedAccount}`);
      const dry = dryRun || process.env.MGMCP_DRY_RUN === '1';
      const states = dry ? accounts.map((account) => ({ ...account, ...pool.state(account.name), drafts: 0, load: pool.state(account.name).assignedThisSession, messages: [] })) : await snapshot();
      const existingKeys = new Set(states.flatMap((state) => state.messages.map((message) => message.key || dedupeKey(message))));
      const plan = planDrafts(drafts, states, { forcedAccount, fallback, existingKeys });
      if (!dry && checkSent) {
        await Promise.all(plan.candidates.map(async (candidate) => {
          const checks = await Promise.all(states.filter((state) => state.healthy)
            .map((state) => pool.sentExists(state.name, candidate.draft.to[0], candidate.draft.subject).catch(() => false)));
          const found = checks.some(Boolean);
          if (found) plan.results[candidate.index] = { index: candidate.index, account: candidate.account, status: 'duplicate' };
        }));
      }
      if (!dry) {
        let pending = plan.results.filter((result) => result.status === 'planned');
        const createdWeights = new Map();
        while (pending.length) {
          const groups = new Map();
          for (const item of pending) { if (!groups.has(item.account)) groups.set(item.account, []); groups.get(item.account).push(item); }
          const requeue = (await Promise.all([...groups].map(async ([name, items]) => {
            const remaining = [];
            for (let offset = 0; offset < items.length; offset += 1) {
              const item = items[offset];
              try {
                const raw = await buildRaw(accounts.find((a) => a.name === name), item.draft);
                const appended = await pool.appendDraft(name, raw.raw);
                plan.results[item.index] = { index: item.index, account: name, status: 'created', messageId: raw.messageId, uid: appended.uid };
                createdWeights.set(name, (createdWeights.get(name) || 0) + draftWeight(item.draft));
              } catch (error) {
                pool.markUnhealthy(name, error);
                plan.results[item.index] = { index: item.index, account: name, status: error.uncertain ? 'uncertain' : 'failed', error: redact(error) };
                remaining.push(...items.slice(offset + 1));
                break;
              }
            }
            return remaining;
          }))).flat();
          if (!requeue.length) break;
          if (forcedAccount && !fallback) {
            for (const item of requeue) plan.results[item.index] = { index: item.index, account: forcedAccount, status: 'failed', error: 'Selected account failed and fallback is disabled.' };
            break;
          }
          const active = accounts.map((a) => ({ ...a, ...pool.state(a.name), load: (states.find((s) => s.name === a.name)?.load || 0) + (createdWeights.get(a.name) || 0) }));
          const reassigned = balanceDrafts(requeue.map((item) => item.draft), active);
          pending = requeue.flatMap((item, index) => reassigned[index] ? [{ ...item, account: reassigned[index] }] : []);
          for (const [index, item] of requeue.entries()) if (!reassigned[index]) plan.results[item.index] = { index: item.index, status: 'failed', error: 'No healthy account has pending capacity.' };
        }
      }
      const summary = accounts.map((item) => ({ account: item.name, created: plan.results.filter((r) => r.account === item.name && r.status === 'created').length, planned: plan.results.filter((r) => r.account === item.name && r.status === 'planned').length, duplicate: plan.results.filter((r) => r.account === item.name && r.status === 'duplicate').length, failed: plan.results.filter((r) => r.account === item.name && r.status === 'failed').length, uncertain: plan.results.filter((r) => r.account === item.name && r.status === 'uncertain').length }));
      return text({ results: plan.results.map(({ draft, weight, ...result }) => result), summary });
    } catch (error) { return text({ error: redact(error) }); }
  });

  server.registerTool('search_mail', {
    inputSchema: { account: z.string().min(1), query: z.string().optional(), folder: z.enum(['sent', 'inbox', 'all', 'drafts']).default('sent'), limit: z.number().int().min(1).max(100).default(20), sinceDays: z.number().int().positive().optional(), hasReply: z.boolean().optional() },
  }, async (input) => {
    try {
      const selected = input.account === 'all' ? accounts : [accounts.find((item) => item.name === input.account)].filter(Boolean);
      if (!selected.length) throw new Error(`Unknown account: ${input.account}`);
      const found = await Promise.all(selected.map(async (account) => (await pool.searchMail(account.name, input)).map((message) => ({ account: account.name, ...message }))));
      return text(found.flat().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, input.limit));
    } catch (error) { return text({ error: redact(error) }); }
  });

  server.registerTool('read_thread', {
    inputSchema: { account: z.string().min(1), threadId: z.string().min(1).optional(), messageId: z.string().min(1).optional(), maxChars: z.number().int().min(1).max(100000).default(6000) },
  }, async ({ account, threadId, messageId, maxChars }) => {
    try {
      if (!threadId && !messageId) throw new Error('Provide threadId or messageId.');
      if (!accounts.some((item) => item.name === account)) throw new Error(`Unknown account: ${account}`);
      const messages = await pool.readThread(account, { threadId, messageId });
      const address = accounts.find((item) => item.name === account).email.toLowerCase();
      return text(messages.map(({ uid, messageId: id, inReplyTo, references, from, to, cc, subject, date, textBody, labels }) => ({ uid, messageId: id, inReplyTo, references, from, to, cc, subject, date, direction: from.some((value) => value.toLowerCase() === address) ? 'sent' : 'received', textBody: textBody.slice(0, maxChars), labels })));
    } catch (error) { return text({ error: redact(error) }); }
  });

  server.registerTool('create_reply_drafts', {
    inputSchema: { drafts: z.array(replyShape).min(1).max(50), dryRun: z.boolean().default(false) },
  }, async ({ drafts, dryRun }) => {
    const dry = dryRun || process.env.MGMCP_DRY_RUN === '1'; const results = Array(drafts.length); const prepared = [];
    await Promise.all(drafts.map(async (draft, index) => {
      const account = accounts.find((item) => item.name === draft.replyTo.account);
      if (!account) { results[index] = { index, account: draft.replyTo.account, status: 'failed', error: 'Unknown account.' }; return; }
      try {
        const original = await pool.findMessage(account.name, draft.replyTo.messageId);
        if (!original) throw new Error('Original message was not found.');
        prepared.push({ index, account: account.name, accountEmail: account.email, original, draft });
      } catch (error) { results[index] = { index, account: account.name, status: 'failed', error: redact(error) }; }
    }));
    const existing = new Set();
    await Promise.all([...new Set(prepared.map((item) => item.account))].map(async (name) => {
      try { (await pool.replyDrafts(name)).forEach((item) => existing.add(replyDedupeKey(item))); }
      catch (error) { prepared.filter((item) => item.account === name).forEach((item) => { results[item.index] = { index: item.index, account: name, status: 'failed', error: redact(error) }; }); }
    }));
    const planned = planReplies(prepared.filter((item) => !results[item.index]), { existingKeys: existing });
    for (const item of planned) results[item.index] = item;
    if (!dry) await Promise.all(planned.filter((item) => item.status === 'planned').map(async (item) => {
      try {
        const raw = await buildRaw(accounts.find((account) => account.name === item.account), item.draft);
        const appended = await pool.appendDraft(item.account, raw.raw);
        results[item.index] = { index: item.index, account: item.account, status: 'created', messageId: raw.messageId, uid: appended?.uid, threadId: item.threadId };
      } catch (error) { results[item.index] = { index: item.index, account: item.account, status: error.uncertain ? 'uncertain' : 'failed', error: redact(error) }; }
    }));
    return text(results.map(({ draft, ...result }) => result));
  });

  server.registerTool('list_drafts', { inputSchema: { account: z.string(), query: z.string().optional(), limit: z.number().int().min(1).max(500).default(50) } }, async ({ account, query, limit }) => {
    try {
      const selected = account === 'all' ? accounts : [accounts.find((item) => item.name === account)].filter(Boolean);
      if (!selected.length) throw new Error(`Unknown account: ${account}`);
      const grouped = await Promise.all(selected.map(async (item) => ({ account: item.name, messages: await pool.draftMessages(item.name, query) })));
      const values = grouped.flatMap((item) => item.messages.map((message) => ({ account: item.account, ...message })))
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, limit);
      return text(values.map(({ key, isDraft, ...message }) => message));
    } catch (error) { return text({ error: redact(error) }); }
  });

  server.registerTool('count_drafts', { inputSchema: { account: z.string().optional() } }, async ({ account }) => {
    try {
      const selected = account ? [accounts.find((item) => item.name === account)].filter(Boolean) : accounts;
      if (!selected.length) throw new Error(`Unknown account: ${account}`);
      const values = await snapshot();
      return text(values.filter((item) => selected.some((a) => a.name === item.name)).map((item) => item.error ? { account: item.name, status: 'unknown', error: item.error } : { account: item.name, drafts: item.drafts, pendingWeight: item.load }));
    } catch (error) { return text({ error: redact(error) }); }
  });

  server.registerTool('delete_draft', { inputSchema: { account: z.string(), messageId: z.string().min(1) } }, async ({ account, messageId }) => {
    try { return text({ account, messageId, deleted: await pool.deleteToolDraft(account, messageId) }); }
    catch (error) { return text({ error: redact(error) }); }
  });

  server.registerTool('verify_account', { inputSchema: { account: z.string().optional() } }, async ({ account }) => {
    const selected = account ? [accounts.find((item) => item.name === account)].filter(Boolean) : accounts;
    if (!selected.length) return text({ error: `Unknown account: ${account}` });
    const results = await Promise.all(selected.map(async (item) => {
      try { const value = await pool.verify(item.name); return { account: item.name, ok: true, drafts: value.drafts }; }
      catch (error) { return { account: item.name, ok: false, hint: hint(error), error: redact(error) }; }
    }));
    return text(results);
  });
  return { server, pool };
}

async function main() {
  let app;
  try { app = createApp(); }
  catch (error) { logError(error, 'multi-gmail-mcp: '); process.exitCode = 1; return; }
  const stop = async () => { await app.pool.close(); process.exit(); };
  process.once('SIGINT', stop); process.stdin.once('end', stop);
  await app.server.connect(new StdioServerTransport());
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((error) => { logError(error, 'multi-gmail-mcp: '); process.exitCode = 1; });
