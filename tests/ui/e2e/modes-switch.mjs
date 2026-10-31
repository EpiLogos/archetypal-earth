// Gate: the three modes hand over cleanly — Aion and the Red Book never both on screen (audit W3), and the
// Red Book launch, Escape and R work from the plain world (audit W2).
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/modes-switch.mjs [chromium|webkit]
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const state = (page) => page.evaluate(() => {
  const vis = (sel) => { const el = document.querySelector(sel); return !!el && !el.hidden && el.getBoundingClientRect().height > 0; };
  return {
    hash: location.hash,
    aion: vis('.aion'),
    redbook: vis('.redbook'),
    aionMode: document.body.classList.contains('aion-mode'),
    redbookMode: document.body.classList.contains('redbook-mode'),
    shiftX: window.__earth.engine.rig.tShiftX ?? 0,
  };
});

/** Enter a mode from the lens menu (the switches that used to stand beside the title are gone). */
const enter = async (page, lens) => {
  await page.click('.sh-lens');
  await page.waitForSelector('#shell-menu:not([hidden])');
  await page.click(`.sm-row[data-lens="${lens}"]`);
};

const wait = (page, pred) => page.waitForFunction(pred, null, { timeout: 20000 }).catch(() => {});

const browser = await launch(kind, { headed: false });
try {
  // ── plain world → Red Book launch, Escape, R ───────────────────────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await enter(page, 'redbook');
    await wait(page, () => location.hash === '#/redbook');
    await page.waitForTimeout(800);
    let s = await state(page);
    check(s.hash === '#/redbook' && s.redbook, 'the lens menu opens the Red Book from the plain world', `hash "${s.hash}", redbook visible ${s.redbook}`);
    check(!s.aion, 'and the Aion panel stays down');
    // the bare landing shows no folio; the walk opens on folio 1, the first entry of the Contents
    // the expected folio is read from the data: the first stop of the book
    const expected = await page.evaluate(async () => {
      const [rb, field] = await Promise.all([fetch('/data/redbook.json').then((r) => r.json()), fetch('/data/field.json').then((r) => r.json())]);
      const occ = field.occurrences.find((o) => o.id === rb.stops[0]?.id);
      return { progress: `1 / ${rb.stops.length}`, title: occ?.title ?? null };
    });
    await page.locator('.sh-contents').click();
    await page.locator('.dp-contents-pane li button').first().click();
    await page.waitForTimeout(1500);
    const landing = await page.evaluate(() => ({ name: document.querySelector('section.deep:not(.passage):not(.you-sheet) .dp-article:not([hidden]) .rv-name')?.textContent, progress: document.querySelector('.rb-progress')?.textContent }));
    check(!!expected.title && landing.progress === expected.progress && landing.name === expected.title, 'the walk opens on folio 1', `"${landing.name}", ${landing.progress}; expected "${expected.title}", ${expected.progress}`);
    // the first Escape closes the folio and stays in the Red Book; the next steps out to the plain world
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    s = await state(page);
    check(s.hash === '#/redbook' && s.redbook, 'Escape closes the folio and stays in the Red Book', `hash "${s.hash}"`);
    await page.keyboard.press('Escape');
    await wait(page, () => !location.hash.startsWith('#/redbook'));
    await page.waitForTimeout(600);
    s = await state(page);
    check(!s.redbook && ['', '#', '#/'].includes(s.hash), 'Escape then returns to the plain world', `hash "${s.hash}", redbook visible ${s.redbook}`);
    await page.keyboard.press('r');
    await wait(page, () => location.hash === '#/redbook');
    await page.waitForTimeout(600);
    s = await state(page);
    check(s.hash === '#/redbook' && s.redbook, 'R opens the Red Book', `hash "${s.hash}"`);
    await page.keyboard.press('r');
    await wait(page, () => !location.hash.startsWith('#/redbook'));
    await page.waitForTimeout(600);
    s = await state(page);
    check(!s.redbook && !s.redbookMode, 'R toggles it closed again', `hash "${s.hash}"`);
    await ctx.close();
  }

  // ── Aion → Red Book: Aion goes, the Red Book stands alone, and back ───
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    // an event selected in Aion: its card offsets the scene (the shift the Red Book must not inherit)
    await page.evaluate(() => { location.hash = '#/aion/jung-turn/event/turn-wotan-essay-1936'; });
    await wait(page, () => location.hash.startsWith('#/aion'));
    await page.waitForTimeout(1200);
    let s = await state(page);
    check(s.aion && s.aionMode, 'an Aion event opens Aion', `hash "${s.hash}"`);
    // (the event's reading stands in the pane, which gives the scene the room it asks of a reading: -0.46)
    check(Math.abs(s.shiftX + 0.46) < 1e-6, 'with a selection Aion offsets the scene', `shiftX ${s.shiftX}`);
    await enter(page, 'redbook');
    await wait(page, () => location.hash === '#/redbook');
    await page.waitForTimeout(1200);
    s = await state(page);
    check(s.redbook && !s.aion, 'entering the Red Book from Aion hides Aion', `redbook ${s.redbook}, aion ${s.aion}`);
    check(!s.aionMode && s.redbookMode, 'and the body carries only the Red Book mode', `aion-mode ${s.aionMode}, redbook-mode ${s.redbookMode}`);
    check(Math.abs(s.shiftX) < 1e-6, 'the Red Book holds no card shift from Aion', `shiftX ${s.shiftX}`);
    await enter(page, 'aion');
    await wait(page, () => location.hash.startsWith('#/aion'));
    await page.waitForTimeout(1200);
    s = await state(page);
    check(s.aion && !s.redbook && !s.redbookMode, 'Red Book → Aion leaves nothing of the Red Book behind', `aion ${s.aion}, redbook ${s.redbook}`);
    check(!logs.some((l) => /pageerror/i.test(l)), 'no page errors', logs.filter((l) => /pageerror/i.test(l)).join(' | ').slice(0, 300));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
