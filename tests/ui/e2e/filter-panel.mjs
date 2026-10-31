// The filter's place and form, in a real browser. Its button stands in the top-left cluster beside the lens and view controls (same
// height), nothing of it floats over the globe or another component; it opens as a left panel on a desk and a bottom sheet on a phone,
// clear of the reading card and the time strip; Escape and a press outside take it down; a choice adds a chip and moves the count; the
// chip takes the filter off.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5312/ node tests/ui/e2e/filter-panel.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const BTN = '.shell .sh-head .sh-filter';
const PANEL = '.filter-panel';
const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const shown = (page, sel) => page.evaluate((s) => { const p = document.querySelector(s); return !!p && !p.hidden && getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().width > 0; }, sel);
const meets = (a, b) => !!a && !!b && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
const fmt = (b) => b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` : 'none';

for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
  const phone = w < 500;
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/o/double-twin-sister-anna-margaret-1924', mobile: phone });
  await page.waitForSelector('#hud-dock', { timeout: 15000 });
  await page.waitForSelector('.reveal.on', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2200);

  // 1. the button: in the top-left cluster, the lens button's height, clear of the card and the strip; none left in the dock row
  const btn = await box(page, BTN);
  const lens = await box(page, '.shell .sh-lens');
  const reveal = await box(page, '.reveal.on');
  const strip = await box(page, '.time');
  check(!!btn, `${tag}: the Filter button stands in the shell's top-left cluster`);
  check(!!btn && !!lens && btn.y < 70 && btn.x < 420 && Math.abs(btn.y - lens.y) < 3, `${tag}: it is in line with the lens control`, `${fmt(btn)} · lens ${fmt(lens)}`);
  check(!!btn && !!lens && Math.abs(btn.h - lens.h) < 1.5, `${tag}: it is the lens control's height`, `${btn?.h} vs ${lens?.h}`);
  check((await page.locator('.dock .dock-add, .dock-chips button:has-text("Filter")').count()) === 0, `${tag}: the dock row holds no Filter button`);
  check(!!reveal, `${tag}: a reading card is open`, fmt(reveal));
  check(!meets(btn, reveal) && !meets(btn, strip), `${tag}: the button meets neither the card nor the strip`);

  // 2. open: a left panel on a desk, a sheet on a phone
  await page.locator(BTN).click();
  await page.waitForTimeout(600);
  check(await shown(page, PANEL), `${tag}: the button opens the filter panel`);
  check((await page.locator(BTN).getAttribute('aria-expanded')) === 'true', `${tag}: the button says it is open`);
  const p = await box(page, PANEL);
  const strip2 = await box(page, '.time');
  const reveal2 = await box(page, '.reveal.on');
  if (phone) {
    check(!!p && p.w >= w - 2 && Math.abs(p.y + p.h - h) <= 2, `${tag}: it is a bottom sheet`, fmt(p));
    check((await page.locator(`${PANEL} .pn-grab`).count()) === 1 && await shown(page, `${PANEL} .pn-grab`), `${tag}: the sheet has a grab handle`);
  } else {
    const btn2 = await box(page, BTN);
    check(!!p && p.x <= 2 && p.w >= 330 && p.w <= 380 && p.y >= btn2.y + btn2.h, `${tag}: it is a left panel under the cluster`, fmt(p));
    check(!!p && p.y + p.h <= strip2.y + 0.5, `${tag}: it ends above the time strip`, `panel bottom ${Math.round(p.y + p.h)} · strip ${Math.round(strip2.y)}`);
    check(!meets(p, reveal2), `${tag}: it does not cover the reading card`, `panel ${fmt(p)} · card ${fmt(reveal2)}`);
  }
  check((await page.locator(`${PANEL} .pn-head h2`).count()) === 1 && (await page.locator(`${PANEL} .pn-head .pn-close`).count()) === 1, `${tag}: it has a header with a title and a ✕`);
  check((await page.locator(`${PANEL} .pn-foot .sf-count`).count()) === 1, `${tag}: its footer holds the count line`);
  const scrolls = await page.evaluate((s) => { const b = document.querySelector(`${s} .pn-body`); return !!b && getComputedStyle(b).overflowY !== 'visible'; }, PANEL);
  check(scrolls, `${tag}: its content scrolls inside it`);

  // 3. a choice adds a chip and moves the count
  const count0 = (await page.locator(`${PANEL} .sf-count`).textContent()) ?? '';
  await page.locator(`${PANEL} .sf-pill`, { hasText: 'Antiquity' }).first().click();
  await page.waitForTimeout(800);
  const count1 = (await page.locator(`${PANEL} .sf-count`).textContent()) ?? '';
  const chips = await page.locator('.dock-chips .sh-chip:not(.scope)').allTextContents();
  check(chips.some((t) => /Antiquity/.test(t)), `${tag}: Antiquity is a chip in the row`, JSON.stringify(chips));
  check(count0 !== count1 && /\d/.test(count1), `${tag}: the count line moved`, `${count0} → ${count1}`);
  check(/1/.test((await page.locator(BTN).textContent()) ?? '') || /1/.test((await page.locator(BTN).getAttribute('aria-label')) ?? ''), `${tag}: the button carries the count of filters in force`, (await page.locator(BTN).textContent()) ?? '');
  const pAfter = await box(page, PANEL);
  check(!meets(await box(page, '.dock-chips .sh-chip'), pAfter) || phone, `${tag}: the chip does not stand under the panel`);

  // 4. Escape and a press outside
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(!(await shown(page, PANEL)), `${tag}: Escape takes the panel down`);
  check(await shown(page, '.reveal.on') || (await page.locator('.reveal.on').count()) === 1, `${tag}: and left the reading card in place`);
  await page.locator(BTN).click();
  await page.waitForTimeout(400);
  check(await shown(page, PANEL), `${tag}: the button opens it again`);
  await page.mouse.click(phone ? w / 2 : w * 0.45, phone ? 90 : 200);
  await page.waitForTimeout(400);
  check(!(await shown(page, PANEL)), `${tag}: a press outside takes it down`);
  await page.locator(BTN).click();
  await page.waitForTimeout(400);
  await page.locator(`${PANEL} .pn-close`).click();
  await page.waitForTimeout(400);
  check(!(await shown(page, PANEL)), `${tag}: the ✕ takes it down`);

  // 5. the chip removes the filter
  await page.locator('.dock-chips .sh-chip:not(.scope)').first().click();
  await page.waitForTimeout(700);
  check((await page.locator('.dock-chips .sh-chip:not(.scope)').count()) === 0, `${tag}: the chip's press takes the filter off`);
  check(await page.evaluate(() => Object.keys(window.__earth.ctl.filter ?? {}).length === 0), `${tag}: the field is whole again`);
  // (the live-sky sidecar is not running under a dev server: its refused /now is the machine's, not the page's)
  const real = logs.filter((l) => !/\/now\b|ERR_CONNECTION_REFUSED/.test(l));
  check(real.length === 0, `${tag}: no page errors`, real.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
