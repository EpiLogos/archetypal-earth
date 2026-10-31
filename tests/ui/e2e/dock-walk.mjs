// The slice dock (H6), in a real browser: one place at the foot of the screen for what narrows the field. A chips row is always reserved
// (the strip never jumps when a chip comes or goes); the lens's scope is a removable chip that replaces the old "Show the whole field"
// link; the filter is a popover over its button (a sheet on a phone) that Escape and a press outside take down; the time strip stands
// below the row. Desktop and phone.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5296/ node tests/ui/e2e/dock-walk.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const popOpen = (page) => page.evaluate(() => { const p = document.querySelector('.filter-pop'); return !!p && !p.hidden && getComputedStyle(p).display !== 'none'; });
const hash = (page) => page.evaluate(() => location.hash);

for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
  const phone = w < 500;
  // 1. the Field: the row is reserved (the strip is where it will be), the filter button stands in it, no scope chip
  {
    const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/', mobile: phone });
    await page.waitForSelector('#hud-dock', { timeout: 15000 });
    await page.waitForTimeout(2000);
    check((await page.locator('#hud-dock .dock-chips').count()) === 1 && (await page.locator('#hud-dock .dock-time').count()) === 1, `${tag}: the dock holds a chips row over the time strip`);
    const row = await box(page, '.dock-chips');
    const strip = await box(page, '.dock-time');
    check(!!row && !!strip && strip.y >= row.y + row.h - 1, `${tag}: the strip stands below the chips row`, `row ${Math.round(row?.y)}+${Math.round(row?.h)} · strip ${Math.round(strip?.y)}`);
    check((await page.locator('.dock-chips .dock-add').count()) === 1, `${tag}: the filter's button stands in the row`);
    check((await page.locator('.dock-chips .sh-chip.scope').count()) === 0, `${tag}: the Field has no scope chip`);
    check((await page.locator('.sh-scope, .sh-scope-toggle').count()) === 0, `${tag}: the "Show the whole field" link is gone`);
    check(!(await popOpen(page)), `${tag}: the filter is closed at first`);
    const stripBefore = (await box(page, '.dock-time')).y;

    // 2. the filter is a popover: it opens over its button, a chip appears for a filter in force, the strip does not move
    await page.locator('.dock-add').click();
    await page.waitForTimeout(400);
    check(await popOpen(page), `${tag}: the button opens the filter popover`);
    check((await page.locator('.dock-add').getAttribute('aria-expanded')) === 'true', `${tag}: the button says it is open`);
    const pop = await box(page, '.filter-pop');
    const btn = await box(page, '.dock-add');
    if (phone) check(h - (pop.y + pop.h) <= 24 && pop.w >= w - 30, `${tag}: on a phone the popover is a sheet at the foot`, `${Math.round(pop.w)}x${Math.round(pop.h)} at ${Math.round(pop.y)}`);
    else check(pop.y + pop.h <= btn.y + 2 && Math.abs(pop.x + pop.w / 2 - (btn.x + btn.w / 2)) < 120, `${tag}: the popover stands over its button`, `pop ${Math.round(pop.y + pop.h)} · button ${Math.round(btn.y)}`);
    await page.locator('.filter-pop .sf-pill', { hasText: 'Antiquity' }).first().click();
    await page.waitForTimeout(700);
    const chipsNow = await page.locator('.dock-chips .sh-chip:not(.scope)').allTextContents();
    check(chipsNow.some((t) => /Antiquity/.test(t)), `${tag}: a filter in force is a chip in the row`, JSON.stringify(chipsNow));
    check(/e=|era/i.test(await hash(page)) || (await hash(page)).length > 2, `${tag}: the filter rides in the address`, await hash(page));
    check(Math.abs((await box(page, '.dock-time')).y - stripBefore) < 1.5 || phone, `${tag}: the strip did not move when the chip came`, `${stripBefore} → ${(await box(page, '.dock-time')).y}`);

    // 3. Escape takes the popover down before anything under it; the chip stays; its press removes the filter
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(!(await popOpen(page)), `${tag}: Escape takes the popover down`);
    check((await page.locator('.dock-chips .sh-chip:not(.scope)').count()) === 1, `${tag}: the chip stays after the popover closes`);
    await page.locator('.dock-add').click();
    await page.waitForTimeout(300);
    check(await popOpen(page), `${tag}: the button opens it again`);
    // a press outside
    await page.mouse.click(w / 2, phone ? 120 : 140);
    await page.waitForTimeout(300);
    check(!(await popOpen(page)), `${tag}: a press outside takes the popover down`);
    await page.locator('.dock-chips .sh-chip:not(.scope)').first().click();
    await page.waitForTimeout(600);
    check((await page.locator('.dock-chips .sh-chip:not(.scope)').count()) === 0, `${tag}: the chip's own press takes the filter off`);
    check(await page.evaluate(() => Object.keys(window.__earth.ctl.filter ?? {}).length === 0), `${tag}: the field is whole again`);
    check(logs.length === 0, `${tag}: no page errors in the Field`, logs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // 4. a lens's scope: Aion draws its own set; the chip names it with its count, removing it brings the rest of the field back, and the
  // chip stays as the way back
  {
    const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/aion', mobile: phone });
    await page.waitForSelector('.dock-chips .sh-chip.scope', { timeout: 20000 });
    await page.waitForTimeout(2500);
    const chip = page.locator('.dock-chips .sh-chip.scope');
    const text = (await chip.textContent()) ?? '';
    check(/^[\d,]+ in /.test(text), `${tag}: the lens's set is a chip with its count`, text);
    check((await chip.getAttribute('aria-pressed')) === 'true', `${tag}: the chip is in force`);
    const stripY = (await box(page, '.dock-time')).y;
    await chip.click();
    await page.waitForTimeout(1500);
    const off = (await page.locator('.dock-chips .sh-chip.scope').textContent()) ?? '';
    check(/^Only /.test(off) && (await page.locator('.dock-chips .sh-chip.scope').getAttribute('aria-pressed')) === 'false', `${tag}: removed, the chip stays as the way back to the lens's own set`, off);
    check(Math.abs((await box(page, '.dock-time')).y - stripY) < 1.5, `${tag}: the strip did not move when the scope came off`);
    await page.locator('.dock-chips .sh-chip.scope').click();
    await page.waitForTimeout(800);
    check(/^[\d,]+ in /.test((await page.locator('.dock-chips .sh-chip.scope').textContent()) ?? ''), `${tag}: pressed again, the lens's set is back`);
    // a filter chip stands beside the scope chip; both are in the one row
    await page.locator('.dock-add').click();
    await page.waitForTimeout(300);
    check(await popOpen(page), `${tag}: the popover opens beside the scope chip`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check((await page.locator('.dock-chips .sh-chip.scope, .dock-chips .dock-add').count()) === 2, `${tag}: the scope chip and the button share the row`);
    // H9: the Aion instrument (the equinox ring) stands over the dock, clear of the epoch names and the chips row, legible at this width
    {
      const g = await page.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, b: b.bottom, r: b.right }; };
        const tick = document.querySelector('.aion-ring-ticks text');
        const tb = tick?.getBoundingClientRect();
        const eps = [...document.querySelectorAll('.aion-epochs button')].map((e) => Math.round(e.getBoundingClientRect().y));
        return { ring: r('.aion-ring svg'), dock: r('#hud-dock'), epochs: r('.aion-epochs'), tickH: tb ? tb.height : 0, rows: new Set(eps).size, n: eps.length };
      });
      const hit = (a, b) => a && b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
      check(!!g.ring && g.ring.b <= g.dock.y + 4, `${tag}: the equinox ring stands over the dock`, `ring bottom ${Math.round(g.ring?.b)} · dock ${Math.round(g.dock.y)}`);
      check(!hit(g.ring, g.epochs), `${tag}: the ring and the epoch names do not overlap`);
      check(g.rows === 1, `${tag}: the epoch names stand in one row`, `${g.rows} rows of ${g.n}`);
      check(g.ring.w >= 100 && g.tickH >= 8, `${tag}: the ring and its sign names are legible`, `ring ${Math.round(g.ring.w)}px, sign names ${g.tickH.toFixed(1)}px high`);
    }
    // the lens's own contents is not displaced by the dock
    check((await hash(page)).startsWith('#/aion'), `${tag}: Escape closed the popover and left the mode`, await hash(page));
    check(logs.length === 0, `${tag}: no page errors in Aion`, logs.slice(0, 2).join(' | '));
    await ctx.close();
  }
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
