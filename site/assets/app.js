(() => {
  const { base, page } = window.SITE;
  const KEY = 'aiq:last';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  };

  // ---- menu (phone) ----
  const menuBtn = document.querySelector('[data-menu]');
  const setNav = open => {
    document.body.classList.toggle('nav-open', open);
    menuBtn?.setAttribute('aria-expanded', String(open));
  };
  menuBtn?.addEventListener('click', () => {
    setNav(!document.body.classList.contains('nav-open'));
    document.querySelector('.side [aria-current]')?.scrollIntoView({ block: 'center' });
  });
  document.querySelector('[data-scrim]')?.addEventListener('click', () => setNav(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setNav(false); });

  // ---- progress ----
  const q = document.querySelector('[data-question]');
  if (q) {
    const last = store.get();
    if (location.hash === '#resume' && last && last.url === q.dataset.url) {
      history.replaceState(null, '', location.pathname);
      requestAnimationFrame(() => window.scrollTo(0, last.scrollY || 0));
    }
    const save = () => store.set({ url: q.dataset.url, title: q.dataset.title, topic: q.dataset.topic, scrollY: Math.round(window.scrollY) });
    save();
    let t;
    window.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(save, 300); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  }
  if (page === 'home') {
    const last = store.get();
    const el = document.querySelector('[data-continue]');
    if (last && last.url && el) {
      el.href = last.url + '#resume';
      el.querySelector('.continue-title').textContent = last.title;
      el.querySelector('.continue-topic').textContent = last.topic;
      el.hidden = false;
    }
  }

  // ---- search ----
  const box = document.querySelector('[data-search]');
  const input = box.querySelector('input');
  const results = box.querySelector('.results');
  let pagefind, sel = -1, seq = 0;
  const load = async () => (pagefind ??= import(base + 'pagefind/pagefind.js').then(async pf => {
    await pf.options({ excerptLength: 18 });
    pf.init();
    return pf;
  }));
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  async function run() {
    const term = input.value.trim();
    const my = ++seq;
    if (!term) { results.hidden = true; results.innerHTML = ''; return; }
    const pf = await load();
    const res = await pf.debouncedSearch(term, {}, 120);
    if (res === null || my !== seq) return;
    const data = await Promise.all(res.results.slice(0, 8).map(r => r.data()));
    if (my !== seq) return;
    sel = -1;
    results.innerHTML = data.length
      ? data.map(d => `<a href="${esc(d.url)}"><span class="r-t">${esc(d.meta.title || '')}</span><span class="r-m">${esc((d.filters.topic || [])[0] || '')}</span><span class="r-x">${d.excerpt}</span></a>`).join('')
      : `<div class="r-empty">No matches for “${esc(term)}”</div>`;
    results.hidden = false;
  }

  input.addEventListener('focus', load, { once: true });
  input.addEventListener('input', run);
  input.addEventListener('keydown', e => {
    const items = [...results.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((a, i) => a.setAttribute('aria-selected', String(i === sel)));
      items[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const target = items[sel] || items[0];
      if (target) location.href = target.href;
    } else if (e.key === 'Escape') {
      input.blur(); results.hidden = true;
    }
  });
  document.addEventListener('click', e => { if (!box.contains(e.target)) results.hidden = true; });
  input.addEventListener('focus', () => { if (results.innerHTML) results.hidden = false; });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== input && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
      e.preventDefault(); input.focus();
    }
  });
  const preset = new URLSearchParams(location.search).get('q');
  if (preset) { input.value = preset; input.focus(); run(); }

  // ---- 404: suggest the closest question ----
  if (page === 'notfound') {
    const parts = location.pathname.split('/').filter(Boolean);
    const slug = parts.at(-1) || '';
    const words = slug.replace(/-/g, ' ');
    document.querySelector('.nf-search').href = base + '?q=' + encodeURIComponent(words);
    const grams = s => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
    const sim = (a, b) => { const A = grams(a), B = grams(b); let n = 0; A.forEach(x => B.has(x) && n++); return (2 * n) / (A.size + B.size || 1); };
    fetch(base + 'pages.json').then(r => r.json()).then(list => {
      let best = null, score = 0;
      for (const [url, title, s] of list) { const v = sim(slug, s); if (v > score) { score = v; best = { url, title }; } }
      if (best && score > 0.35) {
        const box = document.querySelector('.nf-suggest');
        const a = box.querySelector('.nf-link');
        a.href = best.url; a.textContent = best.title;
        box.hidden = false;
      }
    }).catch(() => {});
  }
})();
