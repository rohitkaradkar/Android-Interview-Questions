import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, titleOf, discover, resolveRepoPath, parseAddedLog, parseWiki, applyWiki } from './lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('slugify handles the punctuation upstream filenames use', () => {
  assert.equal(slugify('What launch modes do you know?.md'), 'what-launch-modes-do-you-know');
  assert.equal(slugify("What's BroadcastReceiver.md"), 'whats-broadcastreceiver');
  assert.equal(slugify('Build Type, Product Flavor, Build Variant.md'), 'build-type-product-flavor-build-variant');
  assert.equal(slugify('@JvmStatic (and friends).md'), 'jvmstatic-and-friends');
  assert.equal(slugify('Coding Challenges'), 'coding-challenges');
});

test('titleOf prefers the first h1 and falls back to the filename', () => {
  assert.equal(titleOf('intro\n# Crossinline keyword\n## Links', 'x.md'), 'Crossinline keyword');
  assert.equal(titleOf('no heading here', 'Some name.md'), 'Some name');
});

test('resolveRepoPath maps relative and upstream links into the repo', () => {
  assert.deepEqual(resolveRepoPath('./res/a.png', 'Kotlin/Q.md'), { path: 'Kotlin/res/a.png', hash: '' });
  assert.deepEqual(resolveRepoPath('../Java/Some%20Q.md#x', 'Kotlin/Q.md'), { path: 'Java/Some Q.md', hash: '#x' });
  assert.deepEqual(
    resolveRepoPath('https://github.com/Kirchhoff-/Android-Interview-Questions/blob/master/Build%20Type%2C%20X.md', 'A/B.md'),
    { path: 'Build Type, X.md', hash: '' });
  assert.equal(resolveRepoPath('https://kotlinlang.org/docs', 'A/B.md'), null);
  assert.equal(resolveRepoPath('#anchor', 'A/B.md'), null);
  assert.equal(resolveRepoPath('../../outside.md', 'A/B.md'), null);
});

test('parseAddedLog reads git log output newest first', () => {
  const log = '@@200\n\nKotlin/New.md\n@@100\n\nJava/Old.md\nJava/res/x.png\n';
  assert.deepEqual(parseAddedLog(log), [{ src: 'Kotlin/New.md', at: 200 }, { src: 'Java/Old.md', at: 100 }]);
});

test('discover: colliding slugs suffix by first-added date, code/ is unlisted, sub-sections nest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiq-'));
  const put = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
  put('Kotlin/What is X?.md', '# What is X?');
  put('Kotlin/What is X.md', '# What is X');
  put('Kotlin/code/Snippet.md', 'code');
  put('Kotlin/res/a.png', '');
  put('Coding Challenges/Fundamentals/Rabin-Karp search.md', '# Rabin-Karp');
  put('Coding Challenges/Two sum.md', '# Two sum');
  put('README.md', '# readme');
  const addedAt = new Map([['Kotlin/What is X.md', 1], ['Kotlin/What is X?.md', 2]]);
  const { topics, pages } = discover(dir, addedAt);

  assert.deepEqual(topics.map(t => t.name), ['Kotlin', 'Coding Challenges']);
  const url = src => pages.find(p => p.src === src).url;
  assert.equal(url('Kotlin/What is X.md'), 'kotlin/what-is-x/');
  assert.equal(url('Kotlin/What is X?.md'), 'kotlin/what-is-x-2/');
  assert.equal(url('Kotlin/code/Snippet.md'), 'kotlin/code/snippet/');
  assert.equal(pages.find(p => p.src === 'Kotlin/code/Snippet.md').listed, false);
  assert.equal(url('Coding Challenges/Fundamentals/Rabin-Karp search.md'), 'coding-challenges/fundamentals/rabin-karp-search/');

  const cc = topics[1];
  assert.deepEqual(cc.ordered.map(p => p.title), ['Two sum', 'Rabin-Karp']);
  assert.equal(cc.ordered[0].next.title, 'Rabin-Karp');
  assert.equal(cc.ordered[1].next, null);
});

test('discover against the real repo finds every topic and question once', () => {
  const { topics, pages } = discover(ROOT);
  assert.equal(topics[0].name, 'Android');
  assert.ok(topics.find(t => t.name === 'Coding Challenges').sections.some(s => s.name === 'Fundamentals'));
  const urls = pages.map(p => p.url);
  assert.equal(new Set(urls).size, urls.length, 'URLs are unique');
  assert.ok(urls.every(u => /^[a-z0-9/-]+\/$/.test(u)), 'URLs are clean slugs');
  assert.ok(!pages.some(p => p.src === 'README.md'));
});

test('parseWiki reads headings and bulleted, numbered, or bare link lines', () => {
  const B = 'https://github.com/Kirchhoff-/Android-Interview-Questions/blob/master/';
  const wiki = `Intro with a [doc link](https://example.com).
- not a question
[Two sum](${B}Coding%20Challenges/Two%20sum.md)
## Basics
- [What is **X**?](${B}Kotlin/What%20is%20X.md)
1. [\`Gone\`](${B}Kotlin/Gone.md)
## Empty
- [external](https://kotlinlang.org)`;
  assert.deepEqual(parseWiki(wiki), [
    { name: null, items: [{ label: 'Two sum', path: 'Coding Challenges/Two sum.md' }] },
    { name: 'Basics', items: [{ label: 'What is X?', path: 'Kotlin/What is X.md' }, { label: 'Gone', path: 'Kotlin/Gone.md' }] },
  ]);
});

test('applyWiki follows wiki order, drops dead links, keeps unlisted questions at the end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiq-'));
  const put = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
  for (const n of ['A', 'B', 'C', 'D']) put(`Kotlin/${n}.md`, `# ${n}`);
  const { topics, pages } = discover(dir);
  const bySrc = new Map(pages.map(p => [p.src, p]));
  const t = topics[0];
  const ok = applyWiki(t, [
    { name: 'Basics', items: [{ label: 'What is C?', path: 'Kotlin/C.md' }, { label: 'dead', path: 'Kotlin/Gone.md' }] },
    { name: 'Advanced', items: [{ label: 'A again', path: 'Kotlin/A.md' }, { label: 'C dup', path: 'Kotlin/C.md' }] },
  ], bySrc);
  assert.ok(ok);
  assert.deepEqual(t.sections.map(s => [s.name, s.questions.map(q => q.title)]),
    [['Basics', ['C']], ['Advanced', ['A']], ['More questions', ['B', 'D']]]);
  assert.equal(bySrc.get('Kotlin/C.md').label, 'What is C?');
  assert.equal(bySrc.get('Kotlin/C.md').section.name, 'Basics');
  assert.equal(bySrc.get('Kotlin/C.md').next.title, 'A');
  assert.equal(t.count, 4);
  assert.equal(applyWiki(t, [{ name: 'X', items: [{ label: 'n', path: 'Other/Q.md' }] }], bySrc), false);
});
