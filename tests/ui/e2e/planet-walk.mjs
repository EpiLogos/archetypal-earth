// The Astrology planet walk holds each body up close (it used to fly to the planet's distance from the Earth's own
// position, land inside the sky's exit, and drop back to the globe), shows the body's field ties as satellites, returns
// to the whole birth sky by "Back to the Earth", and a satellite opens its field node framed (not the sky's pose).
//   EARTH_HEADLESS=1 node tests/ui/e2e/planet-walk.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const SKY_EXIT = 30;

const browser = await launch('chromium');
const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/astrology/jung/moon' });
const failedReq = [];
page.on('requestfailed', (r) => failedReq.push(`${r.failure()?.errorText} ${r.url().slice(0, 90)}`));
await page.waitForFunction(() => window.__earth?.engine && document.body.classList.contains('sky-ready'), null, { timeout: 120000 });
const state = () => page.evaluate(() => {
  const e = window.__earth.engine;
  const c = e.rig.centre();
  return { hash: location.hash, stage: e.stageDist, dist: e.rig.dist, approach: e.sky?.approach ?? 0, lat: c.lat, lon: c.lon, orbits: !document.querySelector('.po')?.hidden, sats: [...document.querySelectorAll('.po-sat')].map((x) => x.textContent) };
});
const settle = async (ms = 9000) => { await page.waitForTimeout(ms); return state(); };

let s = await settle();
check(s.hash === '#/astrology/jung/moon' && s.approach > 0.95, 'the walk opens held on the Moon', `${s.hash} approach ${s.approach.toFixed(2)}`);
check(s.orbits && s.sats.length > 0, 'the Moon’s ties circle it', s.sats.join(', '));

await page.locator('.as-step', { hasText: /^Ma$/ }).click();
s = await settle();
check(s.hash === '#/astrology/jung/mars', 'stepping to Mars stays on Mars (no fall back to the globe)', s.hash);
check(s.approach > 0.95 && s.stage > SKY_EXIT, 'the camera holds Mars, far from the Earth', `approach ${s.approach.toFixed(2)}, ${Math.round(s.stage)} R⊕ from the Earth`);
const disc = await page.evaluate(() => window.__earth.engine.sky.screenDisc('mars'));
check(!!disc?.on && disc.px > 120, 'Mars fills the view', disc ? `${Math.round(disc.px)} px` : 'not drawn');

await page.locator('.po-earth').click();
s = await settle(7000);
check(s.hash === '#/astrology/jung/terra','"Back to the Earth" returns to the whole birth sky', s.hash);
check(s.approach < 0.05 && !s.orbits, 'and lets the planet go', `approach ${s.approach.toFixed(2)}`);

await page.goto(page.url().replace(/#.*$/, '#/astrology/jung/saturn'));
await page.waitForFunction(() => document.body.classList.contains('sky-ready'), null, { timeout: 120000 });
s = await settle();
check(s.sats.includes('Sol niger'), 'Saturn carries Sol niger among its satellites', s.sats.join(', '));
await page.locator('.po-sat', { hasText: 'Sol niger' }).click({ force: true });
s = await settle(10000);
check(s.hash === '#/f/sol-niger', 'a satellite opens its field node', s.hash);
check(Math.abs(s.lat - 47.4) < 6 && Math.abs(((s.lon - 8.35 + 540) % 360) - 180) < 8 && s.dist < 4, 'and the camera frames the node, not the sky’s pose', `${s.lat.toFixed(1)}, ${s.lon.toFixed(1)} at ${s.dist.toFixed(2)}`);

// a network fetch the sandbox cannot make (map tiles from NASA GIBS) is not a page error
const offline = failedReq.filter((x) => /gibs|earthdata|nasa/i.test(x));
const real = logs.filter((l) => !(/Failed to fetch/.test(l) && offline.length));
if (failedReq.length) console.log('failed requests:', [...new Set(failedReq)].slice(0, 4).join(' | '));
check(!real.length, 'no page errors', real.slice(0, 2).join(' | '));
await ctx.close();
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
