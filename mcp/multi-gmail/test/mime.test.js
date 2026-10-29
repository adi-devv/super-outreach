import test from 'node:test';
import assert from 'node:assert/strict';
import { directLinks } from '../src/mime.js';

test('directLinks unwraps Gmail redirects and drops javascript: links', () => {
  const html = '<a href="https://www.google.com/url?q=https://github.com/example&amp;source=gmail&amp;ust=1793267867821000&amp;sa=E">GitHub</a> <a href="javascript:void(0);">+1 555 0100</a>';
  assert.equal(directLinks(html), '<a href="https://github.com/example">GitHub</a> +1 555 0100');
});

test('directLinks leaves direct links alone', () => {
  const html = '<a href="https://www.linkedin.com/in/example">LinkedIn</a>';
  assert.equal(directLinks(html), html);
});
