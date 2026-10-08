import { launch, open } from './lib.mjs';
const hash = process.argv[2] ?? '#/f/serpent';
const b = await launch('chromium');
const { page } = await open(b, { width: 1440, height: 900, dpr: 2 });
await page.waitForTimeout(6000);
const r = await page.evaluate(async (h) => {
  const { ctl, engine } = window.__earth;
  const times = {};
  const wrap = (obj, name, label) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t = performance.now(); const r = f(...a); times[label] = (times[label] ?? 0) + performance.now() - t; return r; }; };
  wrap(ctl, 'enterFocus', 'enterFocus'); wrap(ctl, 'enterThread', 'enterThread'); wrap(ctl, 'pickShowcase', 'pickShowcase'); wrap(ctl, 'emphasise', 'emphasise'); wrap(ctl, 'setLabelFor', 'setLabelFor'); wrap(ctl, 'syncDeep', 'syncDeep'); wrap(ctl, 'measureLabel', 'measureLabel'); wrap(ctl, 'frameSet', 'frameSet');
  wrap(ctl.floats, 'set', 'floats.set'); wrap(ctl.timeControl, 'setSubject', 'timeControl.setSubject'); wrap(engine, 'setEmphasis', 'engine.setEmphasis'); wrap(ctl.label, 'set', 'label.set'); wrap(ctl, 'syncShift', 'syncShift');
  const t0 = performance.now();
  location.hash = h;
  await new Promise((r) => setTimeout(r, 50));
  times.total = performance.now() - t0;
  return Object.fromEntries(Object.entries(times).map(([k, v]) => [k, +v.toFixed(1)]));
}, hash);
console.log(r);
await b.close();
