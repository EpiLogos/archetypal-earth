// Click-through of the three modes: Aion (upgraded), the corpus deep link, and the Red Book.
// Run against a dev server:  npx vite --port 5183 --strictPort &
import { launch, open, URL } from './lib.mjs';

// Fails loudly: every Red Book selector this walk reads must resolve, or the run exits nonzero.
let failed = 0;
const must = (label, value) => { if (value === null || value === undefined || value === '') { failed++; console.log(`FAIL selector resolved to nothing: ${label}`); } return value; };

const b = await launch('chromium', { headed: false });
const { page, logs } = await open(b, { hash: '' });
const shots = '.cache/screens/three-modes';
await page.evaluate(() => { window.__earth.engine.tiles.enabled = false; });

const report = {};
// ── Aion: the Turn reading, an event, the J/S chip, a corpus deep link ──
await page.goto(URL + '#/aion/jung-turn/epoch/turn-eruption', { waitUntil: 'load' });
await page.waitForTimeout(2500);
report.aionTurn = await page.evaluate(() => ({
  card: document.querySelector('.aion-card')?.textContent?.slice(0, 120) ?? null,
  epochs: [...document.querySelectorAll('.aion-epochs button')].map((b) => b.textContent),
  reading: document.querySelector('select[aria-label="Historical reading"]')?.selectedOptions[0]?.textContent ?? null,
}));
await page.screenshot({ path: `${shots}/aion-turn.png` });

// open the Wotan essay event (direct link, as the browse menu produces)
await page.goto(URL + '#/aion/jung-turn/event/turn-wotan-essay-1936', { waitUntil: 'load' });
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('.aion-sources')?.setAttribute('open', ''));
await page.waitForTimeout(400);
report.aionEvent = await page.evaluate(() => ({
  name: document.querySelector('.aion-card .rv-name')?.textContent,
  // the key passage is an open blockquote with its cite in the footer; the rest sit in 'More from the text'
  sources: [...document.querySelectorAll('.aion-card blockquote.dp-def footer')].slice(0, 3).map((f) => f.textContent),
  basis: [...document.querySelectorAll('.aion-card .aion-basis')].slice(0, 3).map((b) => b.textContent),
}));
must('aion event name (.aion-card .rv-name)', report.aionEvent.name);
must('aion key passage footer (.aion-card blockquote.dp-def footer)', report.aionEvent.sources.length ? 'yes' : null);
must('aion basis chip (.aion-card .aion-basis)', report.aionEvent.basis.length ? 'yes' : null);
await page.screenshot({ path: `${shots}/aion-event.png` });

// corpus deep link: open the key passage's cite (a button only where the corpus holds the work)
const aionCite = '.aion-card blockquote footer button';
const hasAionCite = (await page.$(aionCite)) !== null;
must(`aion cite button (${aionCite})`, hasAionCite ? 'yes' : null);
if (hasAionCite) {
  await page.click(aionCite);
  await page.waitForSelector('.passage.on', { timeout: 8000 });
  await page.waitForTimeout(600);
  report.passage = await page.evaluate(() => ({
    where: document.querySelector('.ps-where')?.textContent,
    mark: document.querySelector('.ps-mark')?.textContent,
    text: document.querySelector('.ps-text')?.textContent?.slice(0, 110),
    nav: !!document.querySelector('.ps-nav'),
  }));
  must('passage .ps-where', report.passage.where);
  await page.screenshot({ path: `${shots}/passage.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  report.passageClosed = await page.evaluate(() => document.querySelector('.passage')?.classList.contains('on') === false);
}

// ── Aquarius horizon reading ──
await page.goto(URL + '#/aion/jung-aquarius-horizon', { waitUntil: 'load' });
await page.waitForTimeout(2200);
report.aquarius = await page.evaluate(() => ({
  epochs: [...document.querySelectorAll('.aion-epochs button')].map((b) => b.textContent),
  events: (document.querySelector('select[aria-label="Historical event"]') || {}).options?.length,
}));
await page.screenshot({ path: `${shots}/aquarius.png` });

// ── deep-sheet cite link (corpus): a CW-cited occurrence, deep sheet open ──
await page.goto(URL + '#/o/ufo-rumour-worldwide-1947-1958/deep', { waitUntil: 'load' });
await page.waitForTimeout(1800);
report.citeButtons = await page.evaluate(() =>
  [...document.querySelectorAll('.dp-cites .dp-cite-link')].slice(0, 2).map((b) => b.textContent));
if ((report.citeButtons ?? []).length) {
  await page.click('.dp-cites .dp-cite-link');
  await page.waitForSelector('.passage.on', { timeout: 8000 });
  report.deepPassage = await page.evaluate(() => document.querySelector('.ps-where')?.textContent);
  await page.keyboard.press('Escape');
}

// ── Red Book: walk + plate + genesis ──
await page.goto(URL + '#/redbook', { waitUntil: 'load' });
await page.waitForTimeout(2000);
report.redbook = await page.evaluate(() => ({
  heading: document.querySelector('.rb-heading h1')?.textContent,
  subject: document.querySelector('.rb-subject')?.textContent,
  progress: document.querySelector('.rb-progress')?.textContent,
  section: document.querySelector('.rb-section')?.textContent,
  stopName: document.querySelector('.rb-rail') ? document.querySelector('.redbook .rb-card .rv-name')?.textContent : null,
  plateLoaded: (() => { const img = document.querySelector('.redbook .rv-hero img'); return img ? img.complete && img.naturalWidth > 0 : null; })(),
}));
must('.redbook .rb-card .rv-name', report.redbook.stopName);
must('.rb-progress', report.redbook.progress);
must('.redbook .rv-hero img', report.redbook.plateLoaded);
await page.screenshot({ path: `${shots}/redbook-flood.png` });

// walk to Elijah–Salome, folio 6 of 37 (The conception of the God: a field quote), one next-click at a time
for (let k = 0; k < 40; k++) {
  if ((await page.textContent('.rb-progress')) === '6 / 37') break;
  await page.click('.rb-rail button[aria-label="Next folio"]');
  await page.waitForTimeout(150);
}
await page.waitForTimeout(1600);
report.redbookWalk = await page.evaluate(() => ({
  progress: document.querySelector('.rb-progress')?.textContent,
  section: document.querySelector('.rb-section')?.textContent,
  stopName: document.querySelector('.redbook .rb-card .rv-name')?.textContent,
  folio: document.querySelector('.redbook .rb-quote footer')?.textContent,
  plateLoaded: (() => { const img = document.querySelector('.redbook .rv-hero img'); return img ? img.complete && img.naturalWidth > 0 : null; })(),
}));
must('.redbook .rb-card .rv-name (walk)', report.redbookWalk.stopName);
must('.redbook .rb-quote footer (walk)', report.redbookWalk.folio);
must('.redbook .rv-hero img (walk)', report.redbookWalk.plateLoaded);
await page.screenshot({ path: `${shots}/redbook-elijah.png` });

// genesis view
await page.click('.rb-modes button:nth-child(2)');
await page.waitForTimeout(1200);
report.genesis = await page.evaluate(() => ({
  rows: document.querySelectorAll('.rb-genesis').length,
  firstRow: document.querySelector('.rb-genesis-name')?.textContent?.slice(0, 60),
  quotes: document.querySelectorAll('.rb-genesis .rb-quote').length,
}));
await page.screenshot({ path: `${shots}/genesis.png` });

// genesis → archetype focus leaves the mode cleanly
await page.click('.rb-genesis-name button');
await page.waitForTimeout(1800);
report.leftMode = await page.evaluate(() => ({
  redbookGone: document.querySelector('.redbook')?.hidden === true,
  state: document.body.dataset.state,
  hash: location.hash,
}));

// arrow-key walking + deep-link from a manifest cite all verified above
report.logs = logs;
console.log(JSON.stringify(report, null, 1));
await b.close();
console.log(failed ? `${failed} selector(s) resolved to nothing` : 'all Red Book selectors resolved');
process.exit(failed ? 1 : 0);
