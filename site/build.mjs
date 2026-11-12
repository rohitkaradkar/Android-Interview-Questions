import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { createHighlighter } from 'shiki';
import os from 'node:os';
import { discover, resolveRepoPath, parseAddedLog, parseWiki, applyWiki } from './lib.mjs';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SITE);
const OUT = path.join(SITE, 'dist');
const BASE = process.env.BASE_PATH ?? '/Android-Interview-Questions/';
const REPO = 'https://github.com/rohitkaradkar/Android-Interview-Questions';
const SYNC_URL = `${REPO}/actions/workflows/site.yml`;

const LANGS = ['kotlin', 'java', 'xml', 'groovy', 'json', 'shell', 'yaml', 'sql', 'javascript', 'python', 'c', 'cpp', 'swift', 'html', 'css'];
const ALIASES = { kt: 'kotlin', sh: 'shell', bash: 'shell', gradle: 'groovy', js: 'javascript', py: 'python', 'c++': 'cpp' };

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const href = url => BASE + url.split('/').map(encodeURIComponent).join('/');

// ---- git history ---------------------------------------------------------

function gitAddedLog() {
  try {
    return parseAddedLog(execFileSync('git', [
      '-c', 'core.quotePath=false', 'log', '--diff-filter=A', '--name-only', '--format=@@%at', '--', '*.md',
    ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }));
  } catch {
    return [];
  }
}

const added = gitAddedLog();
const addedAt = new Map();
// Log is newest-first; keep the oldest add time so re-added files don't jump around.
for (const { src, at } of added) addedAt.set(src, at);

const { topics, pages } = discover(ROOT, addedAt);
const bySrc = new Map(pages.map(p => [p.src, p]));

// ---- wiki ordering -----------------------------------------------------------
// Upstream's wiki lists each topic progressively (basics first, grouped by theme).
// It lives in a separate git repo, so fetch it at build time; without it, topics stay alphabetical.

function wikiDir() {
  if (process.env.WIKI_DIR) return process.env.WIKI_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiq-wiki-'));
  try {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', 'https://github.com/Kirchhoff-/Android-Interview-Questions.wiki.git', dir], { stdio: 'ignore', timeout: 60_000 });
    return dir;
  } catch {
    console.warn('Wiki unavailable; topics fall back to alphabetical order.');
    return null;
  }
}

const wiki = wikiDir();
const wikiOrdered = [];
for (const t of wiki ? topics : []) {
  const file = path.join(wiki, `${t.name.replace(/ /g, '-')}.md`);
  if (fs.existsSync(file) && applyWiki(t, parseWiki(fs.readFileSync(file, 'utf8')), bySrc)) wikiOrdered.push(t.name);
}
const label = q => q.label ?? q.title;

// ---- markdown ------------------------------------------------------------

const highlighter = await createHighlighter({ themes: ['github-light', 'github-dark'], langs: LANGS });
const media = new Map(); // repo path -> published path

const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code, info) {
    const lang = ALIASES[info.trim().toLowerCase()] ?? info.trim().toLowerCase();
    if (!LANGS.includes(lang)) return '';
    return highlighter.codeToHtml(code, { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
  },
});

let current; // page being rendered; markdown-it rules read it

md.core.ruler.push('rewrite_links', state => {
  const visit = tokens => {
    for (const t of tokens) {
      if (t.children) visit(t.children);
      if (t.type === 'link_open') {
        t.attrSet('href', rewriteLink(t.attrGet('href')));
        if (/^https?:/.test(t.attrGet('href'))) t.attrSet('rel', 'noopener');
      } else if (t.type === 'image') {
        t.attrSet('src', rewriteImage(t.attrGet('src')));
        t.attrSet('loading', 'lazy');
      } else if (t.type === 'html_block' || t.type === 'html_inline') {
        t.content = t.content.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (_, a, src, b) => a + rewriteImage(src) + b);
      }
    }
  };
  visit(state.tokens);
});

function rewriteLink(link) {
  const r = resolveRepoPath(link, current.src);
  if (!r) return link;
  const target = bySrc.get(r.path);
  if (target) return href(target.url) + r.hash;
  if (fs.existsSync(path.join(ROOT, r.path)) && !/^https?:/.test(link)) return `${REPO}/blob/master/${r.path.split('/').map(encodeURIComponent).join('/')}`;
  return link;
}

function rewriteImage(src) {
  const r = resolveRepoPath(src, current.src);
  if (!r || !fs.existsSync(path.join(ROOT, r.path))) return src;
  if (!media.has(r.path)) media.set(r.path, `media/${r.path}`);
  return href(media.get(r.path));
}

// ---- templates -------------------------------------------------------------

const buildTime = new Date();
const ICON = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="7" fill="#2f6f4f"/><path d="M9 21.5c0-4 3.1-7 7-7s7 3 7 7" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="13" cy="18.5" r="1.3" fill="#fff"/><circle cx="19" cy="18.5" r="1.3" fill="#fff"/><path d="M11.5 12.5l-1.6-2.4M20.5 12.5l1.6-2.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;

function layout({ title, body, nav = '', page = 'other', extraHead = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f8f7f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131614" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-title" content="Interview Qs">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="icon" href="${BASE}assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${BASE}assets/icon-180.png">
<link rel="manifest" href="${BASE}manifest.webmanifest">
<link rel="preload" href="${BASE}assets/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${BASE}assets/style.css?v=${buildTime.getTime()}">
${extraHead}
<script>window.SITE={base:${JSON.stringify(BASE)},page:${JSON.stringify(page)}}</script>
<script defer src="${BASE}assets/app.js?v=${buildTime.getTime()}"></script>
</head>
<body class="page-${page}">
<header class="top">
  <div class="top-inner">
    ${nav ? '<button class="menu-btn" aria-label="Menu" aria-expanded="false" data-menu><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' : ''}
    <a class="brand" href="${BASE}">${ICON}<span>Interview Qs</span></a>
    <div class="search" data-search>
      <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input type="search" placeholder="Search questions" aria-label="Search questions" autocomplete="off" spellcheck="false">
      <kbd>/</kbd>
      <div class="results" hidden></div>
    </div>
  </div>
</header>
<div class="shell${nav ? ' has-nav' : ''}">
  ${nav ? `<nav class="side" aria-label="Topic">${nav}</nav><div class="scrim" data-scrim></div>` : ''}
  <main>${body}</main>
</div>
<footer class="foot">
  <a href="${SYNC_URL}">Sync now</a>
  <span aria-hidden="true">·</span>
  <a href="${REPO}">Repository</a>
  <span aria-hidden="true">·</span>
  <span>Built <time datetime="${buildTime.toISOString()}">${buildTime.toISOString().slice(0, 10)}</time></span>
</footer>
</body>
</html>`;
}

function sideNav(topic, active) {
  const item = q => `<li><a href="${href(q.url)}"${q === active ? ' aria-current="page"' : ''}>${esc(label(q))}</a></li>`;
  return `<a class="side-topic" href="${href(topic.url)}">${esc(topic.name)} <span>${topic.count}</span></a>
<ul>${topic.questions.map(item).join('')}</ul>
${topic.sections.map(s => `<h3>${esc(s.name)}</h3><ul>${s.questions.map(item).join('')}</ul>`).join('')}
<details class="side-all"><summary>All topics</summary><ul>${topics.map(t => `<li><a href="${href(t.url)}">${esc(t.name)} <span>${t.count}</span></a></li>`).join('')}</ul></details>`;
}

function questionPage(p) {
  current = p;
  let source = p.md;
  if (!/^#\s+/m.test(source)) source = `# ${p.title}\n\n${source}`;
  let html = md.render(source);
  // The first h1 is the page title; mark it for search weighting.
  html = html.replace(/<h1>/, '<h1 data-pagefind-weight="8" data-pagefind-meta="title">');
  const crumbs = [`<a href="${href(p.topic.url)}">${esc(p.topic.name)}</a>`];
  if (p.section) crumbs.push(`<span>${esc(p.section.name)}</span>`);
  const pn = (q, rel) => q
    ? `<a class="pn pn-${rel}" href="${href(q.url)}" rel="${rel}"><small>${rel === 'prev' ? '← Previous' : 'Next →'}</small><span>${esc(label(q))}</span></a>`
    : '<span></span>';
  const body = `<article class="answer" data-pagefind-body data-pagefind-filter="topic:${esc(p.topic.name)}" data-question data-url="${esc(href(p.url))}" data-title="${esc(p.title)}" data-topic="${esc(p.topic.name)}">
<nav class="crumbs" aria-label="Breadcrumb" data-pagefind-ignore>${crumbs.join('<span aria-hidden="true">›</span>')}</nav>
${html}
</article>
${p.listed ? `<nav class="prevnext" aria-label="Previous and next">${pn(p.prev, 'prev')}${pn(p.next, 'next')}</nav>` : ''}
<p class="source"><a href="${REPO}/blob/master/${p.src.split('/').map(encodeURIComponent).join('/')}">View on GitHub</a></p>`;
  return layout({ title: `${p.title} · ${p.topic.name}`, body, nav: sideNav(p.topic, p), page: 'question' });
}

function topicPage(t) {
  const list = qs => `<ol class="qlist">${qs.map(q => `<li><a href="${href(q.url)}">${esc(label(q))}</a></li>`).join('')}</ol>`;
  const body = `<div class="topic-head"><a class="back" href="${BASE}">All topics</a><h1>${esc(t.name)}</h1><p>${t.count} questions</p></div>
${t.questions.length ? list(t.questions) : ''}
${t.sections.map(s => `<h2 class="section-title">${esc(s.name)} <span>${s.questions.length}</span></h2>${list(s.questions)}`).join('')}`;
  return layout({ title: `${t.name} · Interview Qs`, body, nav: sideNav(t, null), page: 'topic' });
}

function homePage() {
  const listed = new Set(pages.filter(p => p.listed).map(p => p.src));
  const seen = new Set();
  const recent = [];
  for (const a of added) {
    if (recent.length === 2) break;
    if (!listed.has(a.src) || seen.has(a.src)) continue;
    seen.add(a.src);
    recent.push({ page: bySrc.get(a.src), at: a.at });
  }
  const fmt = at => new Date(at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const body = `<section class="hero">
  <h1>Android interview questions</h1>
  <p>${pages.filter(p => p.listed).length} answers across ${topics.length} topics, synced daily from <a href="https://github.com/Kirchhoff-/Android-Interview-Questions">Kirchhoff-/Android-Interview-Questions</a>.</p>
</section>
<a class="continue" href="#" hidden data-continue>
  <small>Continue reading</small>
  <span class="continue-title"></span>
  <span class="continue-topic"></span>
</a>
${recent.length ? `<section class="recent">
  <div class="row-head"><h2>Recently added</h2><a href="${REPO}/commits/master">See all changes →</a></div>
  <ul>${recent.map(r => `<li><a href="${href(r.page.url)}"><span class="r-title">${esc(r.page.title)}</span><span class="r-meta">${esc(r.page.topic.name)} · ${fmt(r.at)}</span></a></li>`).join('')}</ul>
</section>` : ''}
<section class="topics">
  <h2>Topics</h2>
  <ul class="topic-grid">${topics.map(t => `<li><a href="${href(t.url)}"><span class="t-name">${esc(t.name)}</span><span class="t-count">${t.count}</span></a></li>`).join('')}</ul>
</section>`;
  return layout({ title: 'Android Interview Questions', body, page: 'home' });
}

function notFoundPage() {
  const body = `<section class="notfound" data-notfound>
  <h1>That page moved or doesn’t exist</h1>
  <p>Questions sometimes get renamed upstream.</p>
  <div class="nf-suggest" hidden><p>Closest match:</p><a class="nf-link" href="${BASE}"></a></div>
  <p><a class="nf-search" href="${BASE}">Search for it</a> · <a href="${BASE}">Home</a></p>
</section>`;
  return layout({ title: 'Not found · Interview Qs', body, page: 'notfound' });
}

// ---- write -----------------------------------------------------------------

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

fs.rmSync(OUT, { recursive: true, force: true });

for (const p of pages) write(path.join(p.url, 'index.html'), questionPage(p));
for (const t of topics) write(path.join(t.url, 'index.html'), topicPage(t));
write('index.html', homePage());
write('404.html', notFoundPage());
write('pages.json', JSON.stringify(pages.filter(p => p.listed).map(p => [href(p.url), p.title, p.url.split('/').at(-2)])));
write('manifest.webmanifest', JSON.stringify({
  name: 'Android Interview Questions', short_name: 'Interview Qs', start_url: BASE, scope: BASE, display: 'standalone',
  background_color: '#f8f7f3', theme_color: '#2f6f4f',
  icons: [{ src: `${BASE}assets/icon.svg`, sizes: 'any', type: 'image/svg+xml' }, { src: `${BASE}assets/icon-180.png`, sizes: '180x180', type: 'image/png' }],
}));

for (const [from, to] of media) {
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), path.join(OUT, to));
}

fs.cpSync(path.join(SITE, 'assets'), path.join(OUT, 'assets'), { recursive: true });
write('assets/icon.svg', ICON);
const fonts = path.join(SITE, 'node_modules', '@fontsource-variable');
fs.copyFileSync(path.join(fonts, 'inter/files/inter-latin-wght-normal.woff2'), path.join(OUT, 'assets/inter.woff2'));
fs.copyFileSync(path.join(fonts, 'jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'), path.join(OUT, 'assets/jetbrains-mono.woff2'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`Built ${pages.length} pages, ${topics.length} topics, ${media.size} images → ${path.relative(ROOT, OUT)}`);
console.log(`Wiki order: ${wikiOrdered.join(', ') || 'none'}`);
