// Checks the built site in dist/ (run after `npm run build`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, resolveRepoPath } from '../lib.mjs';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(SITE);
const DIST = path.join(SITE, 'dist');
const BASE = process.env.BASE_PATH ?? '/Android-Interview-Questions/';

const htmlFiles = fs.readdirSync(DIST, { recursive: true })
  .filter(f => f.endsWith('.html') && !f.startsWith('pagefind'))
  .map(f => path.join(DIST, f));
const read = f => fs.readFileSync(f, 'utf8');
const pageFor = url => path.join(DIST, url, 'index.html');
const { topics, pages } = discover(ROOT);
const srcByPage = new Map(pages.map(p => [p.url, p.src]));

function distPath(href) {
  const clean = decodeURIComponent(href.slice(BASE.length).split(/[?#]/)[0]);
  const file = path.join(DIST, clean);
  return clean === '' || clean.endsWith('/') ? path.join(file, 'index.html') : file;
}

test('every question and topic has a page', () => {
  const missing = [...pages.map(p => p.url), ...topics.map(t => t.url)].filter(u => !fs.existsSync(pageFor(u)));
  assert.deepEqual(missing, []);
  for (const f of ['index.html', '404.html', 'pages.json', 'pagefind/pagefind.js', 'assets/inter.woff2', 'assets/jetbrains-mono.woff2']) {
    assert.ok(fs.existsSync(path.join(DIST, f)), `${f} exists`);
  }
});

test('every internal link and image points at a file that exists', () => {
  const broken = new Set();
  for (const f of htmlFiles) {
    for (const [, attr] of read(f).matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const url = attr.replace(/&amp;/g, '&');
      if (url.startsWith(BASE) && !fs.existsSync(distPath(url))) broken.add(`${path.relative(DIST, f)} → ${url}`);
      else if (/^(?!#|\/|[a-z][a-z0-9+.-]*:)/i.test(url)) {
        // Relative leftovers are fine only when upstream itself is missing the file.
        const src = srcByPage.get(path.relative(DIST, path.dirname(f)) + '/');
        const target = src && resolveRepoPath(url, src);
        if (!target || fs.existsSync(path.join(ROOT, target.path))) broken.add(`${path.relative(DIST, f)} → ${url}`);
      }
    }
  }
  assert.deepEqual([...broken].slice(0, 20), []);
});

test('upstream GitHub links to questions that exist are rewritten to site pages', () => {
  const srcs = new Set(pages.map(p => p.src));
  const leftover = new Set();
  for (const f of htmlFiles) {
    for (const [, p] of read(f).matchAll(/href="https:\/\/github\.com\/Kirchhoff-\/Android-Interview-Questions\/blob\/[^/]+\/([^"#?]+)/g)) {
      const src = decodeURIComponent(p);
      if (srcs.has(src)) leftover.add(`${path.relative(DIST, f)} → ${src}`);
    }
  }
  assert.deepEqual([...leftover], []);
});

test('Prev/Next walks each topic in the order its topic page lists', () => {
  const linksIn = html => [...html.matchAll(/<ol class="qlist">([\s\S]*?)<\/ol>/g)]
    .flatMap(([, ol]) => [...ol.matchAll(/href="([^"]+)"/g)].map(m => m[1]));
  for (const t of topics) {
    const order = linksIn(read(pageFor(t.url)));
    assert.ok(order.length > 0, `${t.name} lists questions`);
    order.forEach((href, i) => {
      const html = read(distPath(href));
      const next = html.match(/<a class="pn pn-next" href="([^"]+)"/)?.[1] ?? null;
      const prev = html.match(/<a class="pn pn-prev" href="([^"]+)"/)?.[1] ?? null;
      assert.equal(next, order[i + 1] ?? null, `next of ${href}`);
      assert.equal(prev, order[i - 1] ?? null, `prev of ${href}`);
    });
  }
});

test('topics follow the upstream wiki when it was reachable', t => {
  const info = JSON.parse(read(path.join(DIST, 'build-info.json')));
  if (info.wiki !== 'fetched') return t.skip('wiki was unavailable at build time; alphabetical fallback in use');
  // A wiki format change would silently drop topics back to alphabetical; catch that.
  const expected = topics.filter(tp => fs.existsSync(path.join(DIST, tp.url))).map(tp => tp.name);
  assert.deepEqual(info.wikiOrdered, expected);
  assert.match(read(pageFor('android/')), /<h2 class="section-title">Android components/);
});

test('home shows the two most recently added questions and every topic', () => {
  const home = read(path.join(DIST, 'index.html'));
  const recent = home.match(/<section class="recent">([\s\S]*?)<\/section>/)?.[1] ?? '';
  assert.equal([...recent.matchAll(/class="r-title"/g)].length, 2, 'two recent items (needs full git history)');
  for (const t of topics) assert.ok(home.includes(`href="${BASE}${t.url}"`), `${t.name} on home`);
});

test('pages.json lists every listed question for the 404 suggester', () => {
  const list = JSON.parse(read(path.join(DIST, 'pages.json')));
  assert.equal(list.length, pages.filter(p => p.listed).length);
});
