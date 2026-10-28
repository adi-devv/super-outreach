import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadAccounts } from '../src/accounts.js';
import { ImapPool } from '../src/pool.js';
import { buildRaw } from '../src/mime.js';
import { logError, setRedactions } from '../src/log.js';

const keep = process.argv.includes('--keep');
const store = loadAccounts();
const pool = new ImapPool(store);
setRedactions(store.redactions());
try {
  for (const account of store.accounts) {
    await pool.verify(account.name);
    const id = randomUUID();
    const built = await buildRaw(account, { to: [account.email], subject: `[mgmcp selftest] ${id}`, htmlBody: '<p>Self-test</p>', key: id });
    await pool.appendDraft(account.name, built.raw);
    const found = (await pool.draftMessages(account.name)).find((message) => message.messageId === built.messageId && message.createdByTool && message.isDraft);
    if (!found) throw new Error(`Draft confirmation failed for ${account.name}`);
    process.stdout.write(`${account.name}: confirmed\n`);
    if (keep) { const rl = createInterface({ input: stdin, output: stdout }); await rl.question('Press Enter to remove self-test drafts...'); rl.close(); }
    if (!await pool.deleteToolDraft(account.name, built.messageId)) throw new Error(`Could not move self-test draft for ${account.name}`);
    if ((await pool.draftMessages(account.name)).some((message) => message.messageId === built.messageId)) throw new Error(`Draft still present for ${account.name}`);
    process.stdout.write(`${account.name}: removed\n`);
  }
} catch (error) {
  logError(error, 'selftest: ');
  process.exitCode = 1;
} finally { await pool.close(); }
