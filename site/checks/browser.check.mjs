// Drives the built site in headless Chrome (run after `npm run build`).
// Uses the machine's Chrome; set CHROME_PATH if it isn't in the usual place.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { serve } from '../serve.mjs';

const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => fs.existsSync(p));

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { width: 1440, height: 900 };
const QUESTION = 'kotlin/crossinline-keyword/';

let server, browser, page;
before(async () => {
  server = await serve(0);
  browser = await puppeteer.launch({ executablePath: CHROME, args: process.env.CI ? ['--no-sandbox'] : [] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(path, viewport = PHONE) {
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport(viewport);
  const res = await page.goto(server.url + path, { waitUntil: 'networkidle0' });
  return { res, errors };
}
const titles = () => page.$$eval('.results .r-t', els => els.map(e => e.textContent));

test('search shows matching questions as you type', async () => {
  const { errors } = await open('');
  await page.type('.search input', 'coroutine scope');
  await page.waitForSelector('.results a', { timeout: 10_000 });
  assert.ok((await titles()).includes('Coroutine Scope vs Coroutine Context'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('?q= opens search pre-filled', async () => {
  await open('?q=crossinline');
  await page.waitForSelector('.results a', { timeout: 10_000 });
  assert.ok((await titles()).includes('Crossinline keyword'));
  await page.close();
});

test('Continue returns to the last question at the same scroll position', async () => {
  await open('');
  assert.equal(await page.$eval('[data-continue]', e => e.hidden), true, 'hidden before reading anything');
  await page.goto(server.url + QUESTION, { waitUntil: 'networkidle0' });
  await page.evaluate(() => window.scrollTo(0, 300));
  await new Promise(r => setTimeout(r, 600)); // save is throttled
  await page.goto(server.url, { waitUntil: 'networkidle0' });
  const card = await page.$eval('[data-continue]', e => ({ hidden: e.hidden, title: e.querySelector('.continue-title').textContent }));
  assert.deepEqual(card, { hidden: false, title: 'Crossinline keyword' });
  await Promise.all([page.waitForNavigation(), page.click('[data-continue]')]);
  await new Promise(r => setTimeout(r, 300));
  const at = await page.evaluate(() => ({ path: location.pathname + location.hash, y: Math.round(scrollY) }));
  assert.ok(at.path.endsWith(QUESTION), at.path);
  assert.ok(Math.abs(at.y - 300) < 40, `scrolled to ${at.y}`);
  await page.close();
});

test('phone menu opens the topic list with the current question highlighted', async () => {
  await open(QUESTION);
  assert.equal(await page.$eval('.side', e => e.getBoundingClientRect().right <= 0), true, 'menu starts hidden');
  await page.click('[data-menu]');
  await new Promise(r => setTimeout(r, 400));
  const state = await page.evaluate(() => ({
    open: document.body.classList.contains('nav-open'),
    onScreen: document.querySelector('.side').getBoundingClientRect().left >= 0,
    current: document.querySelector('.side [aria-current="page"]')?.textContent,
  }));
  assert.deepEqual({ open: state.open, onScreen: state.onScreen }, { open: true, onScreen: true });
  assert.match(state.current ?? '', /crossinline/i); // wiki wording, e.g. "What do you know about crossinline keyword?"
  await page.close();
});

test('laptop shows the sidebar beside the answer', async () => {
  await open(QUESTION, LAPTOP);
  const layout = await page.evaluate(() => ({
    menuBtn: getComputedStyle(document.querySelector('[data-menu]')).display,
    side: document.querySelector('.side').getBoundingClientRect().left,
    main: document.querySelector('main').getBoundingClientRect().left,
  }));
  assert.equal(layout.menuBtn, 'none');
  assert.ok(layout.side >= 0 && layout.main > layout.side + 250, JSON.stringify(layout));
  await page.close();
});

test('phone pages never scroll sideways', async () => {
  for (const path of ['', 'android/', QUESTION, 'coding-challenges/fundamentals/rabin-karp-search/']) {
    await open(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `${path || 'home'} overflows by ${overflow}px`);
    await page.close();
  }
});

test('a renamed question lands on a 404 that suggests the closest match', async () => {
  const { res } = await open('kotlin/crossinline-keywords/');
  assert.equal(res.status(), 404);
  await page.waitForSelector('.nf-suggest:not([hidden])', { timeout: 5_000 });
  assert.equal(await page.$eval('.nf-link', e => e.textContent), 'Crossinline keyword');
  assert.match(await page.$eval('.nf-search', e => e.href), /\?q=crossinline%20keywords$/);
  await page.close();
});
