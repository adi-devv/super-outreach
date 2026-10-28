import { balanceDrafts, dedupeKey, draftWeight } from './balancer.js';

const emails = (values = []) => values.map((value) => typeof value === 'string' ? value : value?.address).filter(Boolean);

export function replySubject(subject = '') {
  const base = subject.replace(/^(?:(?:re|fwd?)\s*:\s*)+/i, '').trim();
  return `Re: ${base || 'Message'}`;
}

export function replyRecipients(original, accountEmail, draft = {}) {
  if (draft.to?.length) return { to: draft.to, cc: draft.cc || [] };
  const sent = emails(original.from).some((value) => value.toLowerCase() === accountEmail.toLowerCase());
  const replyTo = emails(original.replyTo);
  return { to: sent ? emails(original.to) : replyTo.length ? replyTo : emails(original.from), cc: draft.cc || [] };
}

export function replyReferences(references, messageId) {
  const values = String(references || '').match(/<[^>]+>/g) || [];
  if (messageId && !values.includes(messageId)) values.push(messageId);
  return values.join(' ');
}

export function replyDedupeKey({ inReplyTo, to = [], cc = [] }) {
  return `${inReplyTo}|${[...to, ...cc].map((value) => value.trim().toLowerCase()).sort().join(',')}`;
}

export function threadHasReply(messages, accountEmail, candidate) {
  const external = messages.filter((message) => !emails(message.from).some((value) => value.toLowerCase() === accountEmail.toLowerCase()));
  if (!candidate || !external.some((message) => message.inReplyTo || message.date)) return external.length > 0;
  return external.some((message) => message.inReplyTo || new Date(message.date || 0) > new Date(candidate.date || 0));
}

export function planReplies(replies, { existingKeys = new Set() } = {}) {
  const seen = new Set(existingKeys);
  return replies.map((item) => {
    const { to, cc } = replyRecipients(item.original, item.accountEmail, item.draft);
    const draft = {
      ...item.draft, to, cc, subject: item.draft.subject || replySubject(item.original.subject),
      inReplyTo: item.original.messageId, references: replyReferences(item.original.references, item.original.messageId),
    };
    draft.key = replyDedupeKey(draft);
    if (seen.has(draft.key)) return { index: item.index, account: item.account, status: 'duplicate' };
    seen.add(draft.key);
    return { index: item.index, account: item.account, status: 'planned', draft, threadId: item.original.threadId };
  });
}

export function planDrafts(drafts, accounts, { forcedAccount, fallback = true, existingKeys = new Set() } = {}) {
  const seen = new Set(existingKeys);
  const results = Array(drafts.length);
  const candidates = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = { ...drafts[index], key: dedupeKey(drafts[index]) };
    if (seen.has(draft.key)) results[index] = { index, status: 'duplicate' };
    else { seen.add(draft.key); candidates.push({ ...draft, originalIndex: index }); }
  }
  const eligible = accounts.filter((a) => a.healthy !== false);
  const targets = forcedAccount ? balanceDrafts(candidates, eligible.filter((account) => account.name === forcedAccount)) : balanceDrafts(candidates, eligible);
  for (let position = 0; position < candidates.length; position += 1) {
    const draft = candidates[position]; const account = targets[position];
    results[draft.originalIndex] = account ? { index: draft.originalIndex, account, status: 'planned', draft, weight: draftWeight(draft) } : { index: draft.originalIndex, status: 'failed', error: 'No healthy account has pending capacity.' };
  }
  return { results, candidates: results.filter((result) => result?.status === 'planned'), fallback };
}
