import fs from 'node:fs';
import path from 'node:path';

// Upstream decides the content; these only steer ordering and discovery.
export const TOPIC_ORDER = [
  'Android', 'Kotlin', 'Java', 'Rx', 'General', 'Testing',
  'Patterns', 'Libraries', 'Coding Challenges', 'Test Assignments',
];
const SKIP_DIRS = new Set(['site', 'node_modules', 'res', 'code']);
const UNLISTED_DIRS = new Set(['code']);

export function slugify(name) {
  return name
    .replace(/\.md$/i, '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

export function titleOf(markdown, file) {
  const m = markdown.match(/^#\s+(.+?)\s*#*\s*$/m);
  return m ? plain(m[1]) : path.basename(file, '.md');
}

// Headings sometimes carry inline markdown; titles are shown as plain text.
function plain(s) {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/<[^>]+>/g, '')
    .trim();
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });

/**
 * Walks the repo and returns { topics, pages } where every .md becomes a page.
 * `addedAt` maps repo-relative path -> first-added unix time, used to break slug ties.
 */
export function discover(root, addedAt = new Map()) {
  const pages = [];
  const topics = [];

  const topDirs = fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name))
    .map(d => d.name);

  for (const name of topDirs) {
    const topic = { name, slug: slugify(name), url: `${slugify(name)}/`, questions: [], sections: [] };
    walk(root, name, topic, [], null, pages, addedAt);
    if (topic.questions.length || topic.sections.length) topics.push(topic);
  }

  topics.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  for (const t of topics) {
    t.questions.sort(byTitle);
    t.sections.sort((a, b) => a.name.localeCompare(b.name));
    for (const s of t.sections) s.questions.sort(byTitle);
    linkOrder(t);
  }
  return { topics, pages };
}

/** Flattens a topic's visible order and wires Prev/Next to follow it. */
export function linkOrder(t) {
  t.ordered = [...t.questions, ...t.sections.flatMap(s => s.questions)];
  t.count = t.ordered.length;
  t.ordered.forEach((p, i) => {
    p.prev = t.ordered[i - 1] || null;
    p.next = t.ordered[i + 1] || null;
  });
}

const WIKI_ITEM = /^\s*(?:[-*+]\s+|\d+\.\s+)?\[(.+?)\]\((\S+?)\)/;

/**
 * Reads an upstream wiki topic page into [{ name, items: [{ label, path }] }].
 * Headings start sections; any line that opens with a link to a repo .md is an item.
 */
export function parseWiki(markdown) {
  const sections = [{ name: null, items: [] }];
  for (const line of markdown.split('\n')) {
    const h = line.match(/^#{1,4}\s+(.+?)\s*#*\s*$/);
    if (h) { sections.push({ name: plain(h[1]), items: [] }); continue; }
    const m = line.match(WIKI_ITEM);
    if (!m) continue;
    const r = resolveRepoPath(m[2], 'wiki.md');
    if (r && /\.md$/i.test(r.path)) sections.at(-1).items.push({ label: plain(m[1]), path: r.path });
  }
  return sections.filter(s => s.items.length);
}

/**
 * Reorders a topic to follow its wiki page. Questions the wiki doesn't mention
 * go to a trailing "More questions" section; wiki links to missing files are dropped.
 */
export function applyWiki(topic, sections, bySrc) {
  const mine = new Set(topic.ordered);
  const used = new Set();
  const out = [];
  for (const s of sections) {
    const questions = [];
    for (const { label, path: src } of s.items) {
      const p = bySrc.get(src);
      if (!p || !mine.has(p) || used.has(p)) continue;
      used.add(p);
      p.label = label;
      questions.push(p);
    }
    if (questions.length) out.push({ name: s.name, questions });
  }
  if (!used.size) return false;
  const rest = topic.ordered.filter(p => !used.has(p));
  topic.questions = out[0].name === null ? out.shift().questions : [];
  for (const p of topic.questions) p.section = null;
  topic.sections = out.map(s => {
    const section = { name: s.name, slug: slugify(s.name), questions: s.questions };
    for (const p of s.questions) p.section = section; // breadcrumbs follow the wiki grouping
    return section;
  });
  if (rest.length) topic.sections.push({ name: 'More questions', slug: 'more', questions: rest });
  linkOrder(topic);
  return true;
}

function rank(name) {
  const i = TOPIC_ORDER.indexOf(name);
  return i === -1 ? TOPIC_ORDER.length : i;
}

function walk(root, rel, topic, slugTrail, section, pages, addedAt, unlisted = false) {
  const abs = path.join(root, rel);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const dirSlug = [topic.slug, ...slugTrail].join('/');
  const files = entries.filter(e => e.isFile() && /\.md$/i.test(e.name));

  // Group by slug so colliding names get stable numeric suffixes (oldest keeps the bare slug).
  const groups = new Map();
  for (const f of files) {
    const s = slugify(f.name);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(f.name);
  }
  for (const [s, names] of groups) {
    names.sort((a, b) =>
      (addedAt.get(path.posix.join(rel, a)) ?? Infinity) - (addedAt.get(path.posix.join(rel, b)) ?? Infinity)
      || a.localeCompare(b));
    names.forEach((fname, i) => {
      const src = path.posix.join(rel, fname);
      const md = fs.readFileSync(path.join(root, src), 'utf8');
      const page = {
        src,
        md,
        title: titleOf(md, fname),
        url: `${dirSlug}/${i === 0 ? s : `${s}-${i + 1}`}/`,
        topic,
        section,
        listed: !unlisted,
      };
      pages.push(page);
      if (unlisted) return;
      (section ? section.questions : topic.questions).push(page);
    });
  }

  for (const d of entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))) {
    if (d.name === 'res') continue;
    const childRel = path.posix.join(rel, d.name);
    if (UNLISTED_DIRS.has(d.name)) {
      walk(root, childRel, topic, [...slugTrail, slugify(d.name)], section, pages, addedAt, true);
      continue;
    }
    let child = section;
    if (!unlisted) {
      const name = section ? `${section.name} › ${d.name}` : d.name;
      child = { name, slug: slugify(d.name), questions: [] };
      topic.sections.push(child);
    }
    walk(root, childRel, topic, [...slugTrail, slugify(d.name)], child, pages, addedAt, unlisted);
  }
  if (section && !section.questions.length && !unlisted) {
    topic.sections = topic.sections.filter(s => s !== section);
  }
}

const UPSTREAM_BLOB = /^https?:\/\/github\.com\/(?:Kirchhoff-|rohitkaradkar)\/Android-Interview-Questions\/blob\/[^/]+\/([^?#]+)(#.*)?$/i;

/**
 * Resolves a link found in `fromSrc` to a repo-relative path, or null when it
 * points outside the repo. Handles relative links and absolute upstream/fork blob links.
 */
export function resolveRepoPath(href, fromSrc) {
  if (!href) return null;
  const up = href.match(UPSTREAM_BLOB);
  if (up) return { path: safeDecode(up[1]), hash: up[2] || '' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return null;
  const [p, hash] = splitHash(href);
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromSrc), safeDecode(p)));
  if (joined.startsWith('..')) return null;
  return { path: joined.replace(/^\.\//, ''), hash };
}

function splitHash(href) {
  const i = href.indexOf('#');
  return i === -1 ? [href, ''] : [href.slice(0, i), href.slice(i)];
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Returns [{ src, at }] of .md files in the order they were first added, newest first. */
export function parseAddedLog(log) {
  const out = [];
  let at = 0;
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) at = Number(line.slice(2));
    else if (line.trim().endsWith('.md')) out.push({ src: unquote(line.trim()), at });
  }
  return out;
}

// git quotes paths with unusual characters unless core.quotePath=false; we pass that flag,
// but stay tolerant of quoted output anyway.
function unquote(p) {
  if (!p.startsWith('"')) return p;
  return Buffer.from(
    p.slice(1, -1).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, '$1'),
    'latin1',
  ).toString('utf8');
}
