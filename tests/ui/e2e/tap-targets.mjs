// Gate (mobile, MODES-RFC §7): on a phone, every visible control is at least 44×44 px (or sits in a row whose own box is).
// Lists the offenders per route. EARTH_HEADLESS=1 node tests/ui/e2e/tap-targets.mjs [hash ...]
import { chromium } from 'playwright';
const URL = process.env.EARTH_URL ?? 'http://localhost:5183/';
const hashes = process.argv.slice(2).length ? process.argv.slice(2) : ['#/', '#/a/self', '#/f/serpent', '#/t/serpent', '#/aion/jung-aion', '#/redbook', '#/redbook/genesis', '#/dynamics', '#/theory', '#/graph', '#/sky'];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (const h of hashes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('aae.landing.seen', '1'); } catch {} });
  await page.goto(URL + h, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  const small = await page.evaluate(() => {
    const out = [];
    const sel = 'button, a[href], select, input, textarea, summary, [role="button"], [role="switch"], [tabindex="0"]';
    for (const e of document.querySelectorAll(sel)) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
      let o = 1; for (let n = e; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      if (o < 0.2 || e.closest('[hidden], [inert]')) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
      if (r.width >= 43.5 && r.height >= 43.5) continue;
      const name = `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`;
      out.push(`${name} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
  bad += small.length;
  console.log(`${h}: ${small.length ? small.length + ' small' : 'all ≥ 44px'}`);
  for (const s of [...new Set(small)].slice(0, 40)) console.log(`   ${s}`);
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
