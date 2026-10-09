// Gate: leaving the sky for another mode takes the sky with it (the body card, the body, the Sky switch), and G from
// the sky lands in the graph with the camera brought down, and back on the globe without bouncing into the sky.
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/sky-exits.mjs [chromium|webkit]
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const sky = (page) => page.evaluate(() => {
  const { engine, ctl } = window.__earth;
  const card = document.querySelector('.sky-card');
  return {
    hash: location.hash,
    skyState: !!ctl.state.sky,
    graph: !!ctl.state.graph,
    cardShown: !!card && card.getAttribute('aria-hidden') === 'false',
    skyOn: document.body.classList.contains('sky-on'),
    skyPressed: document.querySelector('.sky-switch')?.getAttribute('aria-pressed') ?? null,
    dist: engine.rig.dist,
    flying: engine.rig.flying,
  };
});

// settled: no flight running and the pose still across two samples
const settle = async (page, ms = 60000) => {
  const t0 = Date.now();
  let prev = null;
  for (;;) {
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => { const r = window.__earth.engine.rig; return { lat: r.lat, lon: r.lon, dist: r.dist, flying: r.flying }; });
    const still = prev && Math.abs(s.lat - prev.lat) < 1e-3 && Math.abs(s.lon - prev.lon) < 1e-3 && Math.abs(s.dist - prev.dist) < 1e-3;
    if (!s.flying && still) return { ...s, timedOut: false };
    if (Date.now() - t0 > ms) return { ...s, timedOut: true };
    prev = s;
  }
};

const wait = (page, pred) => page.waitForFunction(pred, null, { timeout: 30000 }).catch(() => {});

const browser = await launch(kind, { headed: false });
try {
  // ── (a) the Red Book and Aion switches leave the sky with the sky's card and body ──
  const exits = [
    ['Red Book', '.rb-switch', () => { const s = window.__earth.ctl.state; return !s.sky && !!s.redbook; }],
    ['Aion', '.aion-switch', () => { const s = window.__earth.ctl.state; return !s.sky && !!s.history; }],
  ];
  for (const [name, sel, arrived] of exits) {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/sky/saturn' });
    await wait(page, () => window.__earth.ctl.state.sky?.body === 'saturn');
    await page.waitForSelector('.sky-card[aria-hidden="false"]', { timeout: 30000 }).catch(() => {});
    const before = await sky(page);
    check(before.skyState && before.cardShown && before.skyOn, `from #/sky/saturn the sky and Saturn's card stand`, `card shown ${before.cardShown}`);
    await page.click(sel);
    await wait(page, arrived);
    await page.waitForTimeout(1000);
    const s = await sky(page);
    check(!s.skyState && (name === 'Red Book' ? s.hash === '#/redbook' : s.hash.startsWith('#/aion')), `the ${name} switch leaves the sky`, `hash "${s.hash}", sky ${s.skyState}`);
    check(!s.cardShown, `and the body card closes`, `card shown ${s.cardShown}`);
    check(!s.skyOn, `and the body loses sky-on`);
    check(s.skyPressed === 'false', `and the Sky switch is released`, `aria-pressed ${s.skyPressed}`);
    await ctx.close();
  }

  // ── (b) G from the sky: the graph, the camera brought down, and G back to the globe ──
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/sky' });
    await wait(page, () => window.__earth.ctl.state.sky && document.body.classList.contains('sky-ready'));
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await settle(page);
    await page.keyboard.press('g');
    await wait(page, () => !!window.__earth.ctl.state.graph);
    const into = await settle(page);
    const g1 = await sky(page);
    check(g1.graph && !g1.skyState, 'G from the sky enters the graph and leaves the sky', `hash "${g1.hash}"`);
    check(g1.dist < 20, 'the camera comes down to the world distance, not the sky\'s', `dist ${g1.dist.toFixed(2)}${into.timedOut ? ' (flight still running)' : ''}`);
    await page.keyboard.press('g');
    await wait(page, () => !window.__earth.ctl.state.graph);
    await settle(page);
    const g2 = await sky(page);
    check(!g2.graph && !g2.skyState && !g2.hash.startsWith('#/sky'), 'G again returns to the globe without bouncing into the sky', `hash "${g2.hash}"`);
    check(g2.dist < 20, 'and the globe stays at the world distance', `dist ${g2.dist.toFixed(2)}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
