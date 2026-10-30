// H2: the reading pane is one frame in four states (closed, Contents, Reading, wide), and a phone's is a bottom sheet.
//   - a reading opens in the frame: ✕ first in its head, the expand tool beside it, the width the mockup's reading takes
//   - the tool widens it to the wide width and back; closing a reading resets it; Escape closes it where it stands
//   - Contents is a state of the same frame (380 wide); a pick opens a reading in it; Escape takes it down alone
//   - the dismissal stack reads `contentsOpen` from the frame
//   - on a phone the pane is a sheet: 86dvh at the bottom, the whole width, Contents 52dvh
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/pane-walk.mjs
import { launch, open } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };
const b = await launch('chromium');

const pane = (page) => page.evaluate(() => {
  const r = document.querySelector('section.deep:not(.passage):not(.you-sheet)');
  if (!r || r.hidden) return null;
  const q = r.getBoundingClientRect();
  const head = r.querySelector('.pane-head');
  const first = head?.firstElementChild;
  const tool = r.querySelector('.pane-tool');
  return {
    mode: r.dataset.pane, wide: r.dataset.wide, x: Math.round(q.x), w: Math.round(q.width), h: Math.round(q.height), y: Math.round(q.y),
    closeFirst: !!first && first.classList.contains('dp-close'), tool: !!tool && tool.offsetWidth > 0, toolName: tool?.getAttribute('aria-label') ?? '',
    toolBox: tool ? (({ x, width }) => ({ x: Math.round(x), w: Math.round(width) }))(tool.getBoundingClientRect()) : null,
    title: r.querySelector('.dp-title')?.textContent ?? '', eyebrow: r.querySelector('.dp-eyebrow')?.textContent ?? '',
    body: [...document.body.classList].filter((c) => /^(deep-open|deep-wide|pane-contents)$/.test(c)).join(' '),
  };
});
const facts = (page) => page.evaluate(() => window.__earth.ctl.dismissFacts());
const settle = (page, ms = 1400) => page.waitForTimeout(ms);

// ── desktop ───────────────────────────────────────────────────────────
{
  const { ctx, page, logs } = await open(b, { width: 1440, height: 900, hash: '#/a/self' });
  await settle(page, 3000);
  ok(await pane(page) === null, 'nothing stands before a reading is asked for');
  await page.evaluate(() => { const c = window.__earth.ctl; c.navigate({ ...c.state, deep: true }); });
  await settle(page);
  let p = await pane(page);
  ok(p && p.mode === 'reading' && p.wide === 'false', `a reading opens in the frame (data-pane=${p?.mode})`);
  ok(p && p.closeFirst, 'the ✕ is first in the pane head');
  ok(p && p.tool && /Widen/.test(p.toolName), `the head carries the expand tool (${p?.toolName})`);
  ok(p && p.w === 780 && p.x === 1440 - 780, `a reading is 780 wide at the right (${p?.w} at ${p?.x})`);
  ok(p && p.eyebrow === 'Archetype' && p.title.length > 0, `the kind of subject stands above its title (${p?.eyebrow} / ${p?.title})`);
  ok(p && p.body.includes('deep-open') && !p.body.includes('deep-wide'), `the body says a reading is open (${p?.body})`);
  const shift0 = await page.evaluate(() => window.__earth.engine.rig.tShiftX);

  await page.locator('.deep .pane-tool').click();
  await settle(page);
  p = await pane(page);
  ok(p && p.wide === 'true' && p.mode === 'reading', 'the tool widens the reading');
  ok(p && p.w === 1000, `the wide reading is 1000 wide (${p?.w})`);
  ok(p && /Narrow/.test(p.toolName) && p.body.includes('deep-wide'), `the tool now narrows it (${p?.toolName}; ${p?.body})`);
  const shift1 = await page.evaluate(() => window.__earth.engine.rig.tShiftX);
  if (shift0 !== null) ok(Math.abs(shift1) > Math.abs(shift0), `the scene gives the wider pane more room (${shift0} → ${shift1})`);
  const clock = await page.evaluate(() => { const r = document.querySelector('.time').getBoundingClientRect(); return { r: r.right, l: r.left }; });
  ok(clock.r <= 1440 - 1000 + 1, `the clock stays clear of the wide pane (right edge ${Math.round(clock.r)})`);

  await page.locator('.deep .pane-tool').click();
  await settle(page);
  p = await pane(page);
  ok(p && p.wide === 'false' && p.w === 780, 'the tool narrows it again');

  await page.locator('.deep .pane-tool').click();
  await settle(page);
  await page.keyboard.press('Escape');
  await settle(page, 2200);
  ok(await pane(page) === null, 'Escape closes a wide reading where it stands');
  ok(await page.evaluate(() => !document.body.classList.contains('deep-wide')), 'closing a reading resets the width');
  await page.evaluate(() => { const c = window.__earth.ctl; c.navigate({ ...c.state, deep: true }); });
  await settle(page);
  p = await pane(page);
  ok(p && p.wide === 'false' && p.w === 780, 'the next reading opens at the plain width');

  // Contents: a state of the same frame; the dismissal stack reads it
  await page.evaluate(() => { const c = window.__earth.ctl; c.deep.hide(); });
  await settle(page, 1600);
  ok(await pane(page) === null, 'the pane is closed before Contents');
  ok((await facts(page)).contentsOpen === false, 'contentsOpen is false with no Contents list');
  await page.evaluate(() => {
    window.__picked = 0;
    window.__earth.ctl.deep.showContents('Test contents', [{ title: 'Group', items: [{ label: 'One', onPick: () => { window.__picked++; } }, { label: 'Two', note: '3', level: 1, onPick: () => {} }] }]);
  });
  await settle(page);
  p = await pane(page);
  ok(p && p.mode === 'contents' && p.w === 380, `Contents is the same frame at 380 (${p?.mode} ${p?.w})`);
  ok(p && !p.tool, 'Contents has no expand tool');
  ok((await facts(page)).contentsOpen === true, 'the dismissal facts say Contents is open');
  await page.locator('.dp-contents-pane button', { hasText: 'One' }).click();
  ok(await page.evaluate(() => window.__picked) === 1, 'an entry answers its pick');
  await page.keyboard.press('Escape');
  await settle(page, 2200);
  ok(await pane(page) === null, 'Escape takes Contents down');
  ok((await facts(page)).contentsOpen === false, 'and the fact falls with it');

  // a reading opened from Contents takes the frame over
  await page.evaluate(() => { window.__earth.ctl.deep.showContents('Test contents', [{ items: [{ label: 'One', onPick: () => {} }] }]); });
  await settle(page);
  await page.evaluate(() => { const c = window.__earth.ctl; c.navigate({ ...c.state, deep: true }); });
  await settle(page);
  p = await pane(page);
  ok(p && p.mode === 'reading' && p.w === 780, `a reading opened over Contents is a reading (${p?.mode} ${p?.w})`);
  ok(await page.evaluate(() => !document.body.classList.contains('pane-contents')), 'Contents is gone with it');
  ok(logs.length === 0, `no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ── phone ─────────────────────────────────────────────────────────────
{
  const { ctx, page, logs } = await open(b, { width: 390, height: 844, hash: '#/a/self', mobile: true });
  await settle(page, 3000);
  await page.evaluate(() => { const c = window.__earth.ctl; c.navigate({ ...c.state, deep: true }); });
  await settle(page);
  let p = await pane(page);
  ok(p && p.w === 390, `a phone's pane is the whole width (${p?.w})`);
  ok(p && Math.abs(p.h - Math.round(844 * 0.86)) <= 2 && p.y + p.h === 844, `it is a sheet 86dvh tall at the bottom (${p?.h} at ${p?.y})`);
  ok(p && !p.tool, 'no expand tool on a phone');
  await page.evaluate(() => { window.__earth.ctl.deep.hide(); });
  await settle(page, 1600);
  await page.evaluate(() => { window.__earth.ctl.deep.showContents('Test contents', [{ items: [{ label: 'One', onPick: () => {} }] }]); });
  await settle(page);
  p = await pane(page);
  ok(p && p.mode === 'contents' && Math.abs(p.h - Math.round(844 * 0.52)) <= 2, `Contents is 52dvh (${p?.h})`);
  ok(logs.length === 0, `phone: no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

await b.close();
console.log(fails.length ? `${fails.length} failed` : 'all ok');
process.exit(fails.length ? 1 : 0);
