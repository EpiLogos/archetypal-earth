// Gate: zooming out from the Field enters Astrology on the live sky, never a bare sky. From the Field's own views (the default
// landing, The Self, and the globe) the wheel out lands in Astrology with its Options and its orbits; zooming back in by the
// wheel returns to the Field cleanly; S toggles both ways; Escape leaves the sky. The old Names strip is gone.
//   npx vite --port 5197 --strictPort &
//   node tests/ui/e2e/zoom-out-sky.mjs [chromium|webkit]
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

// the whole Field-or-sky picture at once: the state, the shell's title and lens name, the Options, the sky's drawn bodies
const snap = (page) => page.evaluate(() => {
  const { engine, ctl } = window.__earth;
  const s = ctl.state;
  return {
    hash: location.hash,
    view: s.view.kind,
    lens: s.lens ? { id: s.lens.id, path: s.lens.path.slice() } : null,
    sky: s.sky ? { ...s.sky } : null,
    bareSky: !!s.sky && !s.lens,
    lensName: document.querySelector('.sh-lens-name')?.textContent ?? null,
    context: document.querySelector('.sh-title')?.textContent ?? null,
    options: !!document.querySelector('.sh-controls details.mode-options'),
    skyOn: document.body.classList.contains('sky-on'),
    skyVisible: !!engine.sky?.group.visible,
    bodies: engine.sky?.data.bodies.length ?? 0,
    skyLabels: document.querySelectorAll('.sky-label').length,
    oldNamesStrip: document.querySelectorAll('.sky-culture').length,
    namesSelect: document.querySelectorAll('select[aria-label="Read the names through a culture"]').length,
    dist: +engine.rig.dist.toFixed(1),
    stage: +engine.stageDist.toFixed(1),
    flying: engine.rig.flying,
  };
});

// wheel until `done` holds, in steps; the page is given a frame between steps so the gesture reads as the user's own
const wheelUntil = async (page, dy, done, max = 400) => {
  await page.mouse.move(720, 450);
  for (let i = 0; i < max; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(40);
    if (await page.evaluate(done)) return true;
  }
  return false;
};

const settle = (page) => page.waitForFunction(() => {
  const r = window.__earth.engine.rig;
  return !r.flying && !document.body.classList.contains('lens-loading');
}, null, { timeout: 30000 }).catch(() => {});

const browser = await launch(kind, { headed: false });
try {
  // ── (a) from the default landing (The Self, a focus): the wheel out enters Astrology ──
  {
    const { ctx, page } = await open(browser, { width: 1440, height: 900, hash: '#/' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    const before = await snap(page);
    check(before.view === 'focus' && !before.sky, 'the Field opens on its focus (The Self), no sky', `hash "${before.hash}"`);
    const reached = await wheelUntil(page, 140, () => !!window.__earth.ctl.state.sky);
    await settle(page);
    const out = await snap(page);
    check(reached, 'the wheel out from the focus reaches the sky');
    check(out.lens?.id === 'astrology' && out.lens.path[0] === 'sky', 'zooming out from the focus enters Astrology on the live sky', `lens ${JSON.stringify(out.lens)}`);
    check(!out.bareSky, 'and never a bare sky (a sky with no lens)');
    check(out.lensName === 'Astrology', 'the shell names Astrology', `lens name "${out.lensName}"`);
    check(out.options, 'the Options control is present');
    check(out.skyOn && out.skyVisible, 'the sky is shown, the body layer on', `sky-on ${out.skyOn}, visible ${out.skyVisible}`);
    check(out.bodies >= 10 && out.skyLabels >= 10, 'the planets and their names are loaded', `bodies ${out.bodies}, labels ${out.skyLabels}`);
    check(out.oldNamesStrip === 0 && out.namesSelect === 0, 'the old Names strip (the planet-name menu of the bare sky) is absent', `strip ${out.oldNamesStrip}, select ${out.namesSelect}`);
    check(out.view === 'world' && out.hash.startsWith('#/sky'), 'the field focus is left behind; the link is the sky', `hash "${out.hash}"`);

    // zooming back in by the wheel returns to the Field, cleanly
    const back = await wheelUntil(page, -140, () => !window.__earth.ctl.state.sky);
    await settle(page);
    await page.waitForTimeout(800);
    const field = await snap(page);
    check(back, 'the wheel back in leaves the sky');
    check(!field.sky && !field.lens, 'and the state is the Field, with no lens and no sky flag', `hash "${field.hash}"`);
    check(field.lensName === 'Field', 'the shell names the Field again', `lens name "${field.lensName}"`);
    check(!field.skyOn, 'the sky layer is no longer on');
    // the sky's exit edge is SKY_EXIT (30) in stage distance: the camera is on the Field's side of it, the user's own zoom goes on
    check(field.stage < 30, 'the camera is on the Field side of the sky’s edge', `stage ${field.stage}`);
    check(field.view === 'world' && !field.bareSky && !field.options, 'no Astrology Options remain on the Field');
    await ctx.close();
  }

  // ── (b) from the globe with no focus: zooming out enters Astrology; Escape leaves it ──
  {
    const { ctx, page } = await open(browser, { width: 1440, height: 900, hash: '#/' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'world', null, { timeout: 15000 }).catch(() => {});
    await settle(page);
    const globe = await snap(page);
    check(globe.view === 'world' && !globe.sky, 'Escape from The Self leaves the globe with no sky', `hash "${globe.hash}"`);
    await wheelUntil(page, 140, () => !!window.__earth.ctl.state.sky);
    await settle(page);
    const out = await snap(page);
    check(out.lens?.id === 'astrology' && !out.bareSky, 'zooming out from the globe enters Astrology, not a bare sky', `lens ${JSON.stringify(out.lens)}`);
    // Escape in Astrology closes its sheet only; the mode stays (the Options stand), as the mode-chrome rule says
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const esc = await snap(page);
    check(esc.lens?.id === 'astrology' && esc.options, 'Escape keeps the mode: Astrology and its Options stand', `hash "${esc.hash}"`);
    // the browser's Back returns to where the zoom began (the Self's focus), out of the sky
    await page.goBack();
    await page.waitForFunction(() => !window.__earth.ctl.state.sky, null, { timeout: 15000 }).catch(() => {});
    await settle(page);
    const back = await snap(page);
    check(!back.sky && !back.lens && back.view === 'world', 'Back leaves the sky for the Field where the zoom began (the globe)', `hash "${back.hash}"`);
    await ctx.close();
  }

  // ── (c) S toggles the sky both ways, from the Field and from a focus ──
  {
    const { ctx, page } = await open(browser, { width: 1440, height: 900, hash: '#/' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.keyboard.press('s');
    await page.waitForFunction(() => window.__earth.ctl.state.lens?.id === 'astrology', null, { timeout: 15000 }).catch(() => {});
    await settle(page);
    const on = await snap(page);
    check(on.lens?.id === 'astrology' && on.lens.path[0] === 'sky' && !on.bareSky, 'S from the focus enters Astrology on the live sky', `hash "${on.hash}"`);
    check(on.options && on.lensName === 'Astrology', 'and its Options and name stand');
    await page.keyboard.press('s');
    await page.waitForFunction(() => !window.__earth.ctl.state.sky, null, { timeout: 15000 }).catch(() => {});
    await settle(page);
    const off = await snap(page);
    check(!off.sky && !off.lens && off.lensName === 'Field', 'S again returns to the Field', `hash "${off.hash}"`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 1440, height: 900, hash: '#/' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'world', null, { timeout: 15000 }).catch(() => {});
    await page.keyboard.press('s');
    await page.waitForFunction(() => window.__earth.ctl.state.lens?.id === 'astrology', null, { timeout: 15000 }).catch(() => {});
    await settle(page);
    const on = await snap(page);
    check(on.lens?.id === 'astrology' && !on.bareSky, 'S from the globe enters Astrology too', `hash "${on.hash}"`);
    await page.keyboard.press('s');
    await page.waitForFunction(() => !window.__earth.ctl.state.sky, null, { timeout: 15000 }).catch(() => {});
    await settle(page);
    const off = await snap(page);
    check(!off.sky && !off.lens, 'and S again returns to the globe', `hash "${off.hash}"`);
    await ctx.close();
  }

  // ── (d) the sky link opens Astrology, never a bare sky (a reload on #/sky) ──
  {
    const { ctx, page } = await open(browser, { width: 1440, height: 900, hash: '#/sky' });
    await page.waitForFunction(() => window.__earth.ctl.state.lens?.id === 'astrology', null, { timeout: 30000 }).catch(() => {});
    await settle(page);
    const link = await snap(page);
    check(link.lens?.id === 'astrology' && !link.bareSky && link.lensName === 'Astrology' && link.options, 'the link #/sky opens Astrology with its Options', `lens ${JSON.stringify(link.lens)}`);
    check(link.oldNamesStrip === 0, 'and no old Names strip');
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
