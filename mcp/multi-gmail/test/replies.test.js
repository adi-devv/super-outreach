import test from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { buildRaw } from '../src/mime.js';
import { planReplies, replyDedupeKey, replyRecipients, replyReferences, replySubject, threadHasReply } from '../src/planner.js';

const account = { name: 'a', email: 'me@example.com' };

test('reply subjects have one Re prefix and remove forwarded prefixes', () => {
  assert.equal(replySubject('Re: hello'), 'Re: hello');
  assert.equal(replySubject('RE: Re: hello'), 'Re: hello');
  assert.equal(replySubject('Fwd: RE: hello'), 'Re: hello');
});

test('reply recipient defaults distinguish received and sent originals', () => {
  assert.deepEqual(replyRecipients({ from: ['them@example.com'], replyTo: ['reply@example.com'], to: ['me@example.com'] }, account.email), { to: ['reply@example.com'], cc: [] });
  assert.deepEqual(replyRecipients({ from: ['me@example.com'], to: ['them@example.com'] }, account.email), { to: ['them@example.com'], cc: [] });
});

test('reply references retain the chain and append the original id once', () => {
  assert.equal(replyReferences('<first@example.com> <second@example.com>', '<second@example.com>'), '<first@example.com> <second@example.com>');
  assert.equal(replyReferences('<first@example.com>', '<second@example.com>'), '<first@example.com> <second@example.com>');
});

test('reply planning dedupes by in-reply-to and recipients', () => {
  const original = { messageId: '<original@example.com>', subject: 'Hello', from: ['them@example.com'], to: ['me@example.com'] };
  const replies = [
    { index: 0, account: 'a', accountEmail: account.email, original, draft: { htmlBody: '<p>A</p>' } },
    { index: 1, account: 'a', accountEmail: account.email, original, draft: { htmlBody: '<p>B</p>' } },
  ];
  assert.deepEqual(planReplies(replies).map((item) => item.status), ['planned', 'duplicate']);
  assert.notEqual(replyDedupeKey({ inReplyTo: '<one>', to: ['a@example.com'] }), replyDedupeKey({ inReplyTo: '<two>', to: ['a@example.com'] }));
});

test('thread reply classification is pure and based on the account sender', () => {
  assert.equal(threadHasReply([{ from: ['me@example.com'] }, { from: ['them@example.com'] }], account.email), true);
  assert.equal(threadHasReply([{ from: ['me@example.com'] }], account.email), false);
});

test('reply draft MIME has conversation headers', async () => {
  const built = await buildRaw(account, {
    to: ['them@example.com'], subject: 'Re: Hello', htmlBody: '<p>Hello</p>', key: 'key',
    inReplyTo: '<original@example.com>', references: '<first@example.com> <original@example.com>', includeSignature: false,
  });
  const parsed = await simpleParser(built.raw);
  assert.equal(parsed.inReplyTo, '<original@example.com>');
  assert.deepEqual(parsed.references, ['<first@example.com>', '<original@example.com>']);
});
