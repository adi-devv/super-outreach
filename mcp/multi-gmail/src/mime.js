import { randomUUID } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import { convert } from 'html-to-text';

export function textFromHtml(html = '') {
  return convert(String(html || ''), { wordwrap: false }).replace(/\s+/g, ' ').trim();
}

export async function buildRaw(account, draft) {
  const html = /<meta\s+charset=/i.test(draft.htmlBody) ? draft.htmlBody : `<meta charset="utf-8">${draft.htmlBody}`;
  const messageId = `<${randomUUID()}.mgmcp@${account.email.split('@')[1]}>`;
  const composer = new MailComposer({
    from: { name: account.displayName || account.email, address: account.email },
    to: draft.to,
    cc: draft.cc?.length ? draft.cc : undefined,
    subject: draft.subject,
    html: `${html}${draft.includeSignature === false ? '' : account.signatureHtml || ''}`,
    text: textFromHtml(`${draft.htmlBody}${draft.includeSignature === false ? '' : account.signatureHtml || ''}`),
    messageId,
    date: new Date(),
    inReplyTo: draft.inReplyTo,
    references: draft.references,
    headers: { 'X-MGMCP': '1', 'X-MGMCP-Key': draft.key },
  });
  return { messageId, raw: await composer.compile().build() };
}
