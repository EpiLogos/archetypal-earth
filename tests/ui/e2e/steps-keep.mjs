// What a step keeps (Pass H findings): a step inside a mode leaves what the visitor set as it stands.
//   - Texts: Escape closes a work's reading, and the next Escape steps up to the list without opening it
//   - Texts: opening a work is one line of the trail; the Contents are the works, with no counts
//   - a widened reading stays wide across the stepper in a panel lens (Theory)
//   - closing You leaves a reading that stands under it its room (`deep-open`)
//   - a Work's page carries its footer once
//   - an engagement re-ties You in the graph without snapping it back to its spawn
//   - on a phone You's forget button is a 44px target
//   - a link that names a theoretic's walk stop opens that reading; the bare Theory route opens with nothing read
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5299/ node tests/ui/e2e/steps-keep.mjs
import { launch, open } from './lib.mjs';

const fails = [];
const ok = (cond, msg, detail = '') => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}${detail ? ` — ${detail}` : ''}`); if (!cond) fails.push(msg); };
const SHEET = 'section.deep:not(.passage):not(.you-sheet)';
const b = await launch('chromium');
const hash = (page) => page.evaluate(() => location.hash);
const reading = (page) => page.evaluate(() => document.body.classList.contains('pane-reading'));
const go = (page, h) => page.evaluate((h) => { location.hash = h; }, h);
const opens = (page, id) => page.evaluate((id) => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]').filter((e) => e.kind === 'open' && e.subject.id === id).length, id);

// ── Texts: the Escape ladder, the trail, the Contents ─────────────────
{
  const { ctx, page } = await open(b, { hash: '#/texts/cw12' });
  await page.waitForTimeout(3500);
  ok(await reading(page), 'a work opens its reading', await hash(page));
  ok((await opens(page, 'cw12')) === 1, 'opening the work is one line of the trail', String(await opens(page, 'cw12')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  ok(!(await reading(page)), 'Escape closes the reading');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1300);
  ok((await hash(page)) === '#/texts' && !(await reading(page)), 'the next Escape steps up to the list and leaves the reading closed', `${await hash(page)} reading=${await reading(page)}`);

  await page.locator('.sh-contents').click();
  await page.waitForSelector(`${SHEET}[data-pane="contents"]`, { timeout: 8000 });
  await page.waitForTimeout(500);
  // a work's note is its year, never a count of its cites
  const rows = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .dp-contents li`)].map((li) => ({ pick: !!li.querySelector('button'), note: li.querySelector('.dp-cite-year')?.textContent.trim() ?? '' })), SHEET);
  ok(rows.length > 5 && rows.every((r) => r.pick), 'every work is a pick', `${rows.filter((r) => !r.pick).length} of ${rows.length} are not`);
  ok(rows.every((r) => !r.note || /^\d{4}$/.test(r.note)), 'the Contents show no counts, a year at most', rows.filter((r) => r.note && !/^\d{4}$/.test(r.note)).map((r) => r.note).join(', '));
  ok(!(await page.$(`${SHEET} .pane-foot .pane-count`)), 'the Contents carry no stepper under them');
  await ctx.close();
}

// ── a named theoretic walk stop is a request to read it ───────────────
for (const size of [{}, { width: 390, height: 844, mobile: true }]) {
  const tag = size.mobile ? 'phone' : 'desk';
  const { ctx, page } = await open(b, { ...size, hash: '#/theory/theoretics/psychoid/3' });
  await page.waitForTimeout(4500);
  const text = await page.evaluate((sel) => document.querySelector(`${sel}`)?.innerText ?? '', SHEET);
  ok((await reading(page)) && /psychoid/i.test(text), `${tag}: a link to a psychoid walk stop opens its reading`, `reading=${await reading(page)}`);
  await go(page, '#/theory');
  await page.waitForTimeout(2500);
  await ctx.close();
}
{
  const { ctx, page } = await open(b, { hash: '#/theory' });
  await page.waitForTimeout(3500);
  ok(!(await reading(page)), 'the bare Theory route opens with nothing read');
  await ctx.close();
}

// ── a widened reading across the stepper (Theory) ─────────────────────
{
  const { ctx, page } = await open(b, { hash: '#/theory' });
  await page.waitForTimeout(3500);
  const btn = page.locator('.sh-contents:not([hidden])');
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await page.waitForSelector(`${SHEET}[data-pane="contents"]`, { timeout: 8000 });
  await page.locator(`${SHEET} .dp-contents li button`).first().click();
  await page.waitForTimeout(1800);
  await page.locator(`${SHEET} .pane-tool`).click();
  await page.waitForTimeout(700);
  const wide0 = await page.evaluate((sel) => document.querySelector(sel)?.dataset.wide, SHEET);
  const nextBtn = page.locator(`${SHEET} .pane-foot button:not([disabled])`).last();
  await nextBtn.click();
  await page.waitForTimeout(1800);
  const wide1 = await page.evaluate((sel) => document.querySelector(sel)?.dataset.wide, SHEET);
  ok(wide0 === 'true' && wide1 === 'true', 'a widened reading stays wide across a step', `${wide0} → ${wide1} (${await hash(page)})`);
  await ctx.close();
}

// ── You over a reading; a Work's footer ───────────────────────────────
{
  const { ctx, page } = await open(b, { hash: '#/a/self' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const c = window.__earth.ctl; c.navigate({ ...c.state, deep: true }); });
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => document.body.classList.contains('deep-open')), 'a reading stands (deep-open)');
  await page.evaluate(() => window.__earth.ctl.you.show());
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => ({ deep: !!window.__earth.ctl.state.deep, room: document.body.classList.contains('deep-open'), you: window.__earth.ctl.you.isOpen }));
  ok(!st.you && st.deep && st.room, 'closing You leaves the reading under it its room', JSON.stringify(st));

  await go(page, '#/w/cw12/deep');
  await page.waitForTimeout(2500);
  const feet = await page.evaluate((sel) => document.querySelectorAll(`${sel} .dp-foot`).length, SHEET);
  ok(feet === 1, 'a Work page carries its footer once', String(feet));
  await ctx.close();
}

// ── You in the graph, re-tied without a snap ──────────────────────────
{
  const { ctx, page } = await open(b, { hash: '#/a/self' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__earth.ctl.engage('open', { type: 'work', id: 'cw12' }));
  await go(page, '#/graph/a/self');
  await page.waitForFunction(() => window.__earth?.ctl?.graph?.isVisible, null, { timeout: 30000 });
  await page.waitForTimeout(6000);
  const you = () => page.evaluate(() => { const v = window.__earth.ctl.graph.nodes.find((n) => n.g.kind === 'you'); return v ? { x: v.x, y: v.y } : null; });
  const a = await you();
  await page.evaluate(() => window.__earth.ctl.engage('open', { type: 'work', id: 'cw09ii' }));
  const c = await you();
  const moved = a && c ? Math.hypot(a.x - c.x, a.y - c.y) : -1;
  ok(!!a && !!c && moved < 8, 'an engagement leaves You where it stood in the graph', `${JSON.stringify(a)} → ${JSON.stringify(c)}`);
  await ctx.close();
}

// ── phone: You's forget target ────────────────────────────────────────
{
  const { ctx, page } = await open(b, { width: 390, height: 844, mobile: true, hash: '#/a/self' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const c = window.__earth.ctl; c.engage('open', { type: 'work', id: 'cw12' }); c.you.show(); });
  await page.waitForTimeout(900);
  const box = await page.evaluate(() => { const r = document.querySelector('.you-forget')?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null; });
  ok(!!box && box.w >= 44 && box.h >= 44, 'the forget button is a 44px target on a phone', JSON.stringify(box));
  await ctx.close();
}

// ── phone: a Contents row that wraps keeps clear of the next ──────────
{
  const { ctx, page } = await open(b, { width: 390, height: 844, mobile: true, hash: '#/texts' });
  await page.waitForTimeout(3500);
  await page.locator('.sh-contents').click();
  await page.waitForSelector(`${SHEET}[data-pane="contents"]`, { timeout: 8000 });
  await page.waitForTimeout(700);
  const clash = await page.evaluate((sel) => {
    const bs = [...document.querySelectorAll(`${sel} .dp-contents li > .link-quiet`)].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0);
    const out = [];
    for (let i = 1; i < bs.length; i++) if (bs[i].top < bs[i - 1].bottom - 1 && bs[i].left < bs[i - 1].right && bs[i - 1].left < bs[i].right) out.push(i);
    return { rows: bs.length, overlaps: out.length, min: Math.round(Math.min(...bs.map((r) => r.height))) };
  }, SHEET);
  ok(clash.rows > 10 && clash.overlaps === 0 && clash.min >= 44, 'Contents rows on a phone are 44px and none overlaps the next', JSON.stringify(clash));
  await ctx.close();
}

await b.close();
console.log(fails.length ? `${fails.length} failure(s)` : 'all ok');
process.exit(fails.length ? 1 : 0);
