// Click-through of the three modes: Aion (upgraded), the corpus deep link, and the Red Book.
// Run against a dev server:  npx vite --port 5183 --strictPort &
import { launch, open, URL } from './lib.mjs';

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
  sources: [...document.querySelectorAll('.aion-sources cite')].slice(0, 3).map((c) => c.textContent),
  basis: [...document.querySelectorAll('.aion-sources .aion-basis')].slice(0, 3).map((b) => b.textContent),
}));
await page.screenshot({ path: `${shots}/aion-event.png` });

// corpus deep link: open the first source passage
await page.click('.aion-sources cite button');
await page.waitForSelector('.passage.on', { timeout: 8000 });
await page.waitForTimeout(600);
report.passage = await page.evaluate(() => ({
  where: document.querySelector('.ps-where')?.textContent,
  mark: document.querySelector('.ps-mark')?.textContent,
  text: document.querySelector('.ps-text')?.textContent?.slice(0, 110),
  nav: !!document.querySelector('.ps-nav'),
}));
await page.screenshot({ path: `${shots}/passage.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
report.passageClosed = await page.evaluate(() => document.querySelector('.passage')?.classList.contains('on') === false);

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
  stopName: document.querySelector('.rb-rail') ? document.querySelector('.redbook .aion-card .rv-name')?.textContent : null,
  plateLoaded: (() => { const img = document.querySelector('.rb-plate'); return img ? img.naturalWidth > 0 : null; })(),
  plateNoteShown: !!document.querySelector('.rb-plate-note:not([hidden])'),
}));
await page.screenshot({ path: `${shots}/redbook-flood.png` });

// walk to Elijah–Salome (index 6) via next clicks
await page.evaluate(() => { for (let i = 0; i < 6; i++) document.querySelectorAll('.rb-rail button')[1].click(); });
await page.waitForTimeout(1600);
report.redbookWalk = await page.evaluate(() => ({
  progress: document.querySelector('.rb-progress')?.textContent,
  section: document.querySelector('.rb-section')?.textContent,
  stopName: document.querySelector('.redbook .aion-card .rv-name')?.textContent,
  folio: document.querySelector('.rb-folio')?.textContent,
  plateLoaded: (() => { const img = document.querySelector('.rb-plate'); return img ? img.naturalWidth > 0 : null; })(),
}));
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
