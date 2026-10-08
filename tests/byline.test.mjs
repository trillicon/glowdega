// node --test tests/  — the author byline: dual license on every page, and the same credential in both builders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const CREDENTIAL = 'Licensed Cosmetologist & Esthetician';
const read = (p) => readFile(new URL('../' + p, import.meta.url), 'utf8');

test('build.py and site.js state the same dual-license credential', async () => {
  assert.match(await read('tools/build.py'), new RegExp(`AUTHOR_CREDENTIAL = '${CREDENTIAL}'`));
  assert.match(await read('functions/_lib/site.js'), new RegExp(`jobTitle: '${CREDENTIAL}'`));
});

test('every archive article and the admin template show the dual license, never esthetician alone', async () => {
  const pages = ['assets/templates/article.html', ...(await readdir(new URL('../blog/', import.meta.url))).map((f) => 'blog/' + f)];
  for (const p of pages) {
    const html = await read(p);
    if (!html.includes('Written by')) continue;
    assert.ok(html.includes('Hadiyah Daché, licensed cosmetologist &amp; esthetician'), `${p} lacks the dual-license byline`);
    assert.ok(!/Daché, licensed esthetician|"Licensed Esthetician"/.test(html), `${p} still says esthetician only`);
  }
});
