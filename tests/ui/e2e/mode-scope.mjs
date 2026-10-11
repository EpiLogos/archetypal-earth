// The walk fabric and a mode's own set. A thread lists each step's period-mates (every occurrence of its subject is
// reachable from its walk); a symbol with no placed instance says it has no thread instead of offering a dead link;
// the Red Book and Aion show their own presences, dim the nearby, set the rest aside, and say so under the title,
// with the whole field one click away.
//   EARTH_HEADLESS=1 node tests/ui/e2e/mode-scope.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const drawn = (page) => page.evaluate(() => { const t = window.__earth.engine.presences.relTarget ?? null; return t ? Array.from(t).filter((v) => v >= 0.035).length : null; });

{
  const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/t/f/serpent' });
  await page.waitForTimeout(7000);
  const also = page.locator('.st-also');
  await page.evaluate(() => window.__earth.ctl.tourJump(2));
  await page.waitForTimeout(2500);
  const txt = await also.textContent().catch(() => '');
  check(await also.isVisible() && /\+\d+ from this period/.test(txt ?? ''), 'a thinned step offers its period-mates', txt ?? '');
  await also.click();
  const items = page.locator('.st-also-item');
  check(await items.count() > 0, 'they are listed', `${await items.count()} listed`);
  const name = (await items.first().locator('.st-also-name').textContent()) ?? '';
  await items.first().click();
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => ({ kind: window.__earth.ctl.state.view.kind, trail: !!window.__earth.ctl.state.trail, hash: location.hash }));
  check(s.kind === 'manifest' && s.trail, 'one opens on the walk (the trail kept)', `${name} · ${s.hash}`);
  check(!logs.length, 'thread: no page errors', logs.slice(0, 2).join(' | '));
  await ctx.close();
}
{
  const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/f/battle-with-dragon' });
  await page.waitForTimeout(5000);
  const label = await page.locator('.focus-label').textContent();
  check(/No thread/.test(label ?? '') && !/Follow the thread/.test(label ?? ''), 'a symbol with no placed instance says it has no thread', (label ?? '').replace(/\s+/g, ' ').slice(0, 140));
  check(!logs.length, 'placeless: no page errors', logs.slice(0, 2).join(' | '));
  await ctx.close();
}
for (const [hash, name] of [['#/redbook', 'the Red Book'], ['#/aion/jung-aion', 'Aion']]) {
  const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash });
  await page.waitForTimeout(8000);
  const line = (await page.locator('.sh-scope').textContent().catch(() => '')) ?? '';
  check(/ in .* · .*nearby, dimmed · Show the whole field/.test(line), `${name} names its own set`, line);
  const before = await drawn(page);
  check(before !== null && before < 2815 * 0.6, `${name} draws its set, not the whole field`, `${before} presences drawn of 2,815`);
  await page.locator('.sh-scope-toggle').click();
  await page.waitForTimeout(1500);
  const after = await drawn(page);
  const line2 = (await page.locator('.sh-scope').textContent()) ?? '';
  check(after > before && /Only this set/.test(line2), `${name}: "Show the whole field" brings the rest back, receded`, `${after} drawn`);
  check(!logs.length, `${name}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
