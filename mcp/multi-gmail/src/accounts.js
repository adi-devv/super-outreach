import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const accountSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  appPassword: z.string().min(1),
  displayName: z.string().min(1).optional(),
  signatureHtml: z.string().optional(),
  maxPendingWeight: z.number().positive().finite().optional(),
}).strict();
const configSchema = z.object({ accounts: z.array(accountSchema).min(1) }).strict();

export function accountsPath() {
  return process.env.MGMCP_ACCOUNTS || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'accounts.json');
}

export function loadAccounts(path = accountsPath()) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Accounts file not found: ${path}. Set MGMCP_ACCOUNTS or copy accounts.example.json.`);
    throw new Error(`Cannot read accounts file ${path}: ${error.message}`);
  }
  const { accounts } = configSchema.parse(parsed);
  const names = new Set();
  const emails = new Set();
  for (const account of accounts) {
    if (names.has(account.name)) throw new Error(`Duplicate account name: ${account.name}`);
    if (emails.has(account.email.toLowerCase())) throw new Error(`Duplicate account email: ${account.email}`);
    names.add(account.name); emails.add(account.email.toLowerCase());
  }
  const rawPasswords = accounts.map((a) => a.appPassword);
  const passwords = new Map(accounts.map((a) => [a.name, a.appPassword.replace(/\s/g, '')]));
  const publicAccounts = accounts.map(({ appPassword, ...account }, index) => ({ ...account, index }));
  return Object.freeze({
    accounts: Object.freeze(publicAccounts),
    passwordFor(name) { return passwords.get(name); },
    redactions() { return [...rawPasswords]; },
  });
}
