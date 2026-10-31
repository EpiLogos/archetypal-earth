// H5 + S9, Aion: its Contents and its readings in the reading pane; the threads and the book on the Walk runner.
//   · the Contents trigger stands in the lens's own place (under the title); the walks and the book are no longer Options rows;
//     the reading card is gone
//   · Contents is the reading's threads (the whole reading, then the curated ones), the book's 16 chapters and the epochs
//   · a thread is walked by the pane's stepper, the plate rail and the clock's Play: the same events in the thread's order,
//     the clock at each event's year, wrapping past either end; the book is walked chapter by chapter
//   · an epoch, an event (from its dot) and a chapter read in the pane; closing the reading (✕ or Escape) stays in Aion
//   · opening an event or a chapter is noted once in the visitor's engagement log
//   · nothing overlaps (epochs, rail, ring, time, pane) on a desktop or a phone
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/aion-pane.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8'));
const history = data('history.json');
const book = data('aionbook.json');
const walks = new Map(data('walks.json').walks.map((w) => [w.id, w]));
const reading = history.readings.find((r) => r.id === 'jung-aion');
const topEpochs = reading.epochs.filter((e) => !e.parentId);
const thread = reading.threads[0];
const SHOTS = process.env.SHOTS_DIR ?? '';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };
const b = await launch('chromium');
const settle = (page, ms = 1400) => page.waitForTimeout(ms);
const hash = (page) => page.evaluate(() => location.hash);

const pane = (page) => page.evaluate(() => {
  const r = document.querySelector('section.deep:not(.passage):not(.you-sheet)');
  if (!r || r.hidden) return null;
  const q = r.getBoundingClientRect();
  const foot = r.querySelector('.pane-foot');
  return {
    mode: r.dataset.pane, x: Math.round(q.x), w: Math.round(q.width), y: Math.round(q.y), h: Math.round(q.height),
    eyebrow: r.querySelector('.dp-article:not([hidden]) .dp-eyebrow')?.textContent ?? '',
    name: r.querySelector('.dp-article:not([hidden]) .rv-name')?.textContent ?? '',
    count: r.querySelector('.pane-count')?.textContent ?? '',
    footShown: !!foot && !foot.hidden,
    items: [...r.querySelectorAll('.dp-contents-pane .dp-contents button')].map((x) => x.textContent),
    groups: [...r.querySelectorAll('.dp-contents-pane .dp-sub')].map((x) => x.textContent),
    current: r.querySelector('.dp-contents-pane [aria-current="true"]')?.textContent ?? '',
    hero: r.querySelectorAll('.dp-article:not([hidden]) figure.plate.rv-hero').length,
    quotes: r.querySelectorAll('.dp-article:not([hidden]) blockquote').length,
  };
});
const box = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
  const q = e.getBoundingClientRect();
  return { x: Math.round(q.x), r: Math.round(q.right), y: Math.round(q.y), b: Math.round(q.bottom) };
}, sel);
const rail = (page) => page.evaluate(() => {
  const e = document.querySelector('section.aion .rb-rail');
  if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
  const q = e.getBoundingClientRect();
  return { progress: e.querySelector('.rb-progress')?.textContent ?? '', x: Math.round(q.x), r: Math.round(q.right) };
});
const engaged = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]').map((e) => `${e.kind}:${e.subject.type}:${e.subject.id}`));
const clockYear = (page) => page.evaluate(() => window.__earth.model.scale.fromU(window.__earth.time.cursorU));
const pick = async (page, label) => {
  if (!(await page.locator('.dp-contents-pane li button').first().isVisible().catch(() => false))) await page.locator('.sh-contents').click();
  await settle(page, 700);
  await page.locator('.dp-contents-pane li button', { hasText: label }).first().click();
  await settle(page, 2200);
};

// ── desktop ───────────────────────────────────────────────────────────
{
  const { ctx, page, logs } = await open(b, { width: 1440, height: 900, hash: '#/aion/jung-aion' });
  await settle(page, 3000);
  ok(await page.locator('.sh-controls .sh-contents').isVisible(), 'Aion states its Contents in its own place (under the title)');
  ok(await page.locator('.sh-controls .sh-contents').textContent().then((t) => t.trim() === 'Contents'), 'the trigger is named Contents');
  ok(await page.locator('.mode-opt-group[aria-label="Walk"]').count() === 0, 'the Options carry no walk rows (the Contents do)');
  ok(await page.locator('.aion-card').count() === 0, 'the reading card is gone');
  ok(await pane(page) === null && await rail(page) === null, 'the landing reads nothing: no pane, no rail');
  ok(await page.locator('.aion-epochs button').count() === topEpochs.length, `the epochs strip stands (${topEpochs.length})`);

  // Contents
  await page.locator('.sh-contents').click();
  await settle(page);
  let p = await pane(page);
  ok(p && p.mode === 'contents' && p.w === 380, `Contents opens in the pane at 380 (${p?.mode} ${p?.w})`);
  ok(p && JSON.stringify(p.groups) === JSON.stringify(['Threads', book.title, 'Epochs']), `grouped as the threads, the book, the epochs (${p?.groups.join(' | ')})`);
  ok(p && p.items.length === 1 + reading.threads.length + book.chapters.length + topEpochs.length, `it lists the whole reading, ${reading.threads.length} threads, ${book.chapters.length} chapters and ${topEpochs.length} epochs (${p?.items.length})`);
  ok(p && p.items[0].startsWith('The whole reading, in order') && p.items[1].startsWith(thread.name), 'the whole reading first, then the curated threads in their order');
  ok(book.chapters.every((c, i) => p.items[1 + reading.threads.length + i].startsWith(c.title)), 'the chapters are the book\'s, in its order');
  await page.locator('.sh-contents').click();
  await settle(page, 2200);
  ok(await pane(page) === null, 'the trigger takes the list down again');

  // a curated thread: the pane's stepper, the rail, the keys; the same events in the thread's order
  await pick(page, thread.name);
  p = await pane(page);
  const n = thread.eventIds.length;
  const evName = (id) => reading.events.find((e) => e.id === id).name;
  const evYear = (id) => reading.events.find((e) => e.id === id).year;
  ok((await hash(page)).includes(`/thread/${thread.id}`), `a pick opens the thread (${await hash(page)})`);
  ok(p && p.mode === 'reading' && p.w === 780 && p.eyebrow === 'Event', `the first event reads in the pane (${p?.mode} ${p?.w} ${p?.eyebrow})`);
  ok(p && p.name === evName(thread.eventIds[0]) && p.footShown && p.count === `1 / ${n}`, `it stands at 1 / ${n} (${p?.name}, ${p?.count})`);
  let r = await rail(page);
  ok(r && r.progress === `1 / ${n}` && r.r <= (p?.x ?? 0) + 1, `the rail agrees and keeps to the room the pane leaves (${r?.progress}, right ${r?.r}, pane ${p?.x})`);
  const ring = await box(page, '.aion-ring');
  ok(ring && r && ring.r <= r.x + 1, `the rail stands clear of the equinox ring (ring right ${ring?.r}, rail left ${r?.x})`);
  ok(Math.abs((await clockYear(page)) - evYear(thread.eventIds[0])) < 2, `the clock stands at the first event\'s year (${Math.round(await clockYear(page))})`);
  const seen = [p.name];
  for (let k = 1; k < n; k++) {
    await page.locator('.pane-foot button[aria-label="Next historical event"]').click();
    await settle(page, 700);
    seen.push((await pane(page)).name);
  }
  ok(JSON.stringify(seen) === JSON.stringify(thread.eventIds.map(evName)), `the stepper walks the thread's ${n} events in the shipped walk's order`);
  ok(JSON.stringify(walks.get(`jung-aion/${thread.id}`).stops.map((s) => evName(s.subject.id))) === JSON.stringify(seen), 'the same stops as walks.json');
  await page.locator('.pane-foot button[aria-label="Next historical event"]').click();
  await settle(page, 900);
  p = await pane(page); r = await rail(page);
  ok(p && p.count === `1 / ${n}` && p.name === evName(thread.eventIds[0]) && r.progress === `1 / ${n}`, `past the last event comes the first (${p?.count})`);
  await page.locator('.rb-rail button[aria-label="Previous historical event"]').click();
  await settle(page, 900);
  p = await pane(page);
  ok(p && p.count === `${n} / ${n}`, `and back from the first to the last (${p?.count})`);
  ok(Math.abs((await clockYear(page)) - evYear(thread.eventIds[n - 1])) < 2, `the clock follows the walk (${Math.round(await clockYear(page))})`);
  const eng = await engaged(page);
  ok(eng.some((e) => e.startsWith('open:occurrence:')), `opening an event is noted in the engagement log (${eng.length} lines)`);

  // the whole reading, derived: every event, once
  await pick(page, 'The whole reading, in order');
  p = await pane(page);
  ok(p && p.count === `1 / ${reading.events.length}`, `the whole reading walks all ${reading.events.length} events (${p?.count})`);

  // Contents over a reading marks the thread that stands; Escape takes the list down and the reading shows again
  await page.locator('.sh-contents').click();
  await settle(page);
  p = await pane(page);
  ok(p && p.mode === 'contents' && p.current.startsWith('The whole reading'), `Contents over an event marks the thread that stands (${p?.current})`);
  await page.keyboard.press('Escape');
  await settle(page, 1400);
  p = await pane(page);
  ok(p && p.mode === 'reading', `Escape at Contents takes the list down; the event shows again (${p?.mode})`);
  await page.keyboard.press('Escape');
  await settle(page, 2200);
  ok(await pane(page) === null && (await hash(page)) === '#/aion/jung-aion', `Escape closes the reading and stays in Aion (${await hash(page)})`);
  ok(await page.locator('.sh-contents').isVisible() && await rail(page) === null, 'the Contents wait where they were, the rail is down');

  // the book: a chapter in the pane, the stepper, the arrow keys, the rail; the clock is left alone
  const yearBefore = await clockYear(page);
  await pick(page, 'Foreword');
  p = await pane(page);
  ok((await hash(page)).endsWith('/chapter/foreword') && p && p.eyebrow === 'Chapter' && p.count === `1 / ${book.chapters.length}`, `the book opens at the Foreword (${await hash(page)} ${p?.count})`);
  ok(p && p.quotes >= 1 && p.name === book.chapters[0].title, `the chapter quotes Jung from inside its pages (${p?.quotes} quotations)`);
  ok(Math.abs((await clockYear(page)) - yearBefore) < 1, 'a chapter has no year: walking the book leaves the clock alone');
  await page.locator('.pane-foot button[aria-label="Next chapter"]').click();
  await settle(page, 1600);
  p = await pane(page);
  ok((await hash(page)).endsWith('/chapter/ch-1') && p && p.name === book.chapters[1].title && p.count === `2 / ${book.chapters.length}`, `the stepper walks to chapter I (${p?.name})`);
  await page.keyboard.press('ArrowRight');
  await settle(page, 1600);
  ok((await hash(page)).endsWith('/chapter/ch-2') && (await rail(page))?.progress === `3 / ${book.chapters.length}`, 'the arrow key walks on and the rail agrees');
  await page.locator('.rb-rail button[aria-label="Previous chapter"]').click();
  await settle(page, 1600);
  ok((await pane(page))?.count === `2 / ${book.chapters.length}`, 'the rail walks back');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await settle(page, 1600);
  ok((await pane(page))?.count === `${book.chapters.length} / ${book.chapters.length}`, 'back from the Foreword comes the last chapter');
  ok((await engaged(page)).filter((e) => e.startsWith('open:work:')).length >= 1, 'opening the book is noted for the visitor\'s node');
  await page.keyboard.press('Escape');
  await settle(page, 2200);
  ok(await pane(page) === null && (await hash(page)) === '#/aion/jung-aion', 'Escape closes the chapter and stays in Aion');

  // an epoch from the strip; an event from its dot
  await page.locator('.aion-epochs button').nth(1).click();
  await settle(page, 2200);
  p = await pane(page);
  ok(p && p.eyebrow === 'Epoch' && p.name === topEpochs[1].name && !p.footShown, `an epoch reads in the pane, with no walk to step (${p?.eyebrow} / ${p?.name})`);
  ok(p && p.hero === 1, 'with its plate');
  const ep = await box(page, '.aion-epochs');
  ok(ep && ep.r <= p.x + 1, `the epochs keep to the room the pane leaves (right ${ep?.r}, pane ${p.x})`);
  await page.locator('button[aria-label="Close reading"]').click();
  await settle(page, 2200);
  ok(await pane(page) === null && (await hash(page)) === '#/aion/jung-aion', 'the pane\'s ✕ closes the epoch and stays in the mode');
  // a dot is a button over the globe; the click is the button's own (its place on the turning globe is not the test's concern)
  await page.evaluate(() => document.querySelector('.aion-dot:not([hidden])').click());
  await settle(page, 2400);
  p = await pane(page);
  ok(p && p.eyebrow === 'Event' && p.mode === 'reading' && (await hash(page)).includes('/event/'), `a dot opens its event in the pane (${p?.name})`);
  ok(p && !p.footShown && await rail(page) === null, 'an event opened by itself has no walk: no stepper, no rail');
  ok(logs.length === 0, `no console errors (${logs.slice(0, 3).join(' | ')})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'aion-desktop-event.png') });
  await page.keyboard.press('Escape');
  await settle(page, 1800);
  await page.keyboard.press('Escape');
  await settle(page, 1800);
  ok(!(await hash(page)).startsWith('#/aion'), `with nothing left to close, Escape leaves the mode (${await hash(page)})`);
  ok(await page.locator('.sh-contents').isHidden(), 'the Contents trigger goes with the lens');
  await ctx.close();
}

// ── an address names the reading: it opens in the pane ────────────────
{
  const { ctx, page, logs } = await open(b, { width: 1440, height: 900, hash: `#/aion/jung-aion/chapter/ch-5` });
  await settle(page, 3500);
  const p = await pane(page);
  ok(p && p.mode === 'reading' && p.name === book.chapters[5].title && p.count === `6 / ${book.chapters.length}`, `a chapter address opens the chapter in the pane (${p?.name} ${p?.count})`);
  ok(logs.length === 0, `no console errors (${logs.slice(0, 3).join(' | ')})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'aion-desktop-chapter.png') });
  await ctx.close();
}

// ── phone ─────────────────────────────────────────────────────────────
{
  const { ctx, page, logs } = await open(b, { width: 390, height: 844, hash: '#/aion/jung-aion', mobile: true });
  await settle(page, 3000);
  const t = await page.locator('.sh-contents').boundingBox();
  ok(t && t.height >= 44, `the Contents trigger is a full tap target (${t?.height})`);
  await page.locator('.sh-contents').click();
  await settle(page);
  let p = await pane(page);
  ok(p && p.mode === 'contents' && Math.abs(p.h - Math.round(844 * 0.52)) <= 2, `Contents is a sheet 52dvh tall (${p?.h})`);
  ok(await box(page, '.aion-epochs') === null, 'the epochs make way for the sheet (the Contents list them)');
  await page.locator('.dp-contents-pane li button', { hasText: thread.name }).first().click();
  await settle(page, 2400);
  p = await pane(page);
  const n = thread.eventIds.length;
  ok(p && p.mode === 'reading' && p.w === 390 && Math.abs(p.h - Math.round(844 * 0.86)) <= 2, `an event is a sheet 86dvh tall (${p?.w}×${p?.h})`);
  ok(p && p.footShown && p.count === `1 / ${n}`, `the pane's stepper carries the walk on a phone (${p?.count})`);
  ok(await rail(page) === null, 'the rail makes way for the sheet on a phone');
  await page.locator('.pane-foot button[aria-label="Next historical event"]').click();
  await settle(page, 1600);
  ok((await pane(page))?.count === `2 / ${n}`, 'the stepper walks on a phone');
  ok(await box(page, '.aion-ring') === null, 'the equinox ring makes way for the sheet');
  await page.locator('section.deep[aria-label="Reading"] .pane-contents-tool').click();
  await settle(page, 1600);
  p = await pane(page);
  ok(p && p.mode === 'contents' && p.current.startsWith(thread.name), `the head's Contents button opens the list over the event (${p?.mode} ${p?.current})`);
  await page.locator('.dp-contents-pane li button', { hasText: 'Foreword' }).first().click();
  await settle(page, 2200);
  p = await pane(page);
  ok(p && p.mode === 'reading' && p.eyebrow === 'Chapter' && p.count === `1 / ${book.chapters.length}`, `a pick from it opens the chapter (${p?.eyebrow} ${p?.count})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'aion-phone-chapter.png') });
  await page.locator('button[aria-label="Close reading"]').click();
  await settle(page, 2200);
  ok(await pane(page) === null && (await hash(page)) === '#/aion/jung-aion', 'the sheet\'s ✕ closes the reading and stays in Aion');
  ok(await box(page, '.aion-epochs') !== null, 'the epochs return with the sheet down');
  ok(logs.length === 0, `phone: no console errors (${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

await b.close();
console.log(fails.length ? `${fails.length} failed` : 'all ok');
process.exit(fails.length ? 1 : 0);
