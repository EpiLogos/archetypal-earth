// S12 on the sky: a held planet's tarot cards carry their credit like any other picture — for the reader in the card
// (`.plate-credit`, read by a screen reader) and in its tooltip — desk and phone.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/orbit-credit-walk.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` — ${detail}` : ''}`); };
const b = await launch('chromium');

for (const size of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const { ctx, page, logs } = await open(b, { ...size, hash: '#/astrology' });
  await page.evaluate(() => window.__earth.ctl.openBody('mars'));
  await page.waitForFunction(() => document.querySelectorAll('.po-card img').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const cards = await page.$$eval('.po-card', (els) => els.map((c) => ({
    name: c.querySelector('.po-card-name')?.textContent ?? '',
    credit: (c.querySelector('.plate-credit')?.textContent ?? '').trim(),
    title: c.getAttribute('title') ?? '',
  })));
  const bare = cards.filter((c) => !c.credit || !c.title.includes(c.credit));
  check(cards.length > 0 && bare.length === 0, `${size.name}: every card on Mars's rings carries its credit`, `${cards.length} cards, ${bare.length} bare ${bare.slice(0, 2).map((c) => c.name).join(' | ')}`);
  check(!logs.length, `${size.name}: no console errors`, logs.slice(0, 3).join(' | '));
  await ctx.close();
}
await b.close();
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
