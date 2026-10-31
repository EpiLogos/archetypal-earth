// The phone sheet's detents (H8), in a real browser at 390×844: the Contents list opens half and a reading full; the sheet's handle is a
// 44px target that a tap steps up one height (and from full back to half) and a drag sets; the heights are a peek, half and full; the
// arrow keys move it; a new state opens at its own height; and the sheet never leaves the screen. (The compact View control is `view-control.mjs`.)
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5296/ node tests/ui/e2e/phone-detents.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const W = 390, H = 844;
const SHEET = 'section.deep:not(.passage):not(.you-sheet)';
const sheet = (page) => page.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { h: r.height, top: r.top, bottom: r.bottom, detent: e.dataset.detent, pane: e.dataset.pane }; }, SHEET);
const near = (a, share) => Math.abs(a / H - share) < 0.035;
const settle = (page) => page.waitForTimeout(900);

const { ctx, page, logs } = await open(browser, { width: W, height: H, hash: '#/redbook', mobile: true });
await page.waitForSelector('.sh-contents', { timeout: 15000 });
await page.waitForTimeout(2500);
await page.locator('.sh-contents').click();
await page.waitForSelector(`${SHEET}[data-pane="contents"]`, { timeout: 8000 });
await settle(page);
let s = await sheet(page);
check(s.detent === 'half' && near(s.h, 0.52), 'the Contents list opens half', `${s.detent} ${Math.round(s.h)}px of ${H}`);
const grab = page.locator(`${SHEET} .pane-grab`);
const gb = await grab.boundingBox();
check(!!gb && gb.height >= 44 && gb.width >= 44, 'the handle is a 44px target', gb ? `${gb.width}x${gb.height}` : 'absent');
check(!!gb && gb.y >= s.top - 1 && gb.y + gb.height <= H, 'the handle stands on the sheet', gb ? `${Math.round(gb.y)}` : '');

// a tap steps up, and from full back to half
await grab.click(); await settle(page);
s = await sheet(page);
check(s.detent === 'full' && near(s.h, 0.86), 'a tap on the handle steps to full', `${s.detent} ${Math.round(s.h)}px`);
await grab.click(); await settle(page);
s = await sheet(page);
check(s.detent === 'half' && near(s.h, 0.52), 'a tap at full steps back to half', `${s.detent} ${Math.round(s.h)}px`);

// a drag down lets it rest at a peek; a drag up, at full
const drag = async (dy) => {
  const b = await grab.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x, y + (dy * i) / 8); await page.waitForTimeout(25); }
  const mid = (await sheet(page)).h;
  await page.mouse.up();
  await settle(page);
  return mid;
};
const midDown = await drag(300);
s = await sheet(page);
check(s.detent === 'peek' && near(s.h, 0.26), 'a drag down lets the sheet rest at a peek', `${s.detent} ${Math.round(s.h)}px`);
check(midDown < 0.5 * H, 'the sheet follows the finger while it drags', `${Math.round(midDown)}px mid-drag`);
check(s.top > H * 0.6 && s.bottom <= H + 1, 'at a peek the globe is in view above it', `top ${Math.round(s.top)}`);
check((await page.locator(`${SHEET} .dp-close`).isVisible()), 'the close button stays reachable at a peek');
await drag(-520);
s = await sheet(page);
check(s.detent === 'full' && near(s.h, 0.86), 'a drag up lets it rest at full', `${s.detent} ${Math.round(s.h)}px`);
check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'no horizontal overflow at any height');

// the keys
await grab.focus();
await page.keyboard.press('ArrowDown'); await settle(page);
check((await sheet(page)).detent === 'half', 'ArrowDown on the handle steps down');
await page.keyboard.press('ArrowDown'); await settle(page);
check((await sheet(page)).detent === 'peek', 'and again, to the peek');
await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await settle(page);
check((await sheet(page)).detent === 'full', 'ArrowUp steps back up');

// a reading opens at its own height, whatever the Contents was left at
await page.locator(`${SHEET} .dp-contents-pane li button`).first().click();
await page.waitForSelector('body.pane-reading', { timeout: 8000 });
await settle(page);
s = await sheet(page);
check(s.pane === 'reading' && s.detent === 'full' && near(s.h, 0.86), 'a reading opens full', `${s.pane} ${s.detent}`);
await grab.click(); await settle(page);
check((await sheet(page)).detent === 'half', 'the reading can be brought down to half to see the globe');

const errs = logs.filter((l) => !/fonts\.(gstatic|googleapis)|\.woff2/.test(l));
check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
await ctx.close();
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
