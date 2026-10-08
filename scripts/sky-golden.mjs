// Pin the Sun and Moon to the sidecar at named instants (tests/sky/golden/luminaries.json), so the client's
// terminator, phase and syzygy math is tested against the authority without the sidecar running in CI. Also pins a
// few birth charts, each with the window of positions the page asks for around it (tests/sky/golden/birth.json).
//   node scripts/sky-golden.mjs            write the golden file (needs the sidecar: ephemeris/run.sh)
//   node scripts/sky-golden.mjs --check    refetch and compare (ignoring generatedAt)
// Syzygy instants are found by bisection on the sidecar's own elongation, independent of the client's code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.EPHEMERIS_URL || 'http://127.0.0.1:5187';
const OUT = path.join(ROOT, 'tests/sky/golden/luminaries.json');
const OUT_BIRTH = path.join(ROOT, 'tests/sky/golden/birth.json');

/** Birth cases: a pre-1900 local time (approximate), a clean UTC instant, a summer-time offset, a wall-clock time that never existed. */
const BIRTHS = [
  { label: 'a pre-1900 local time (approximate): Kesswil, 1875-07-26 19:32', local: '1875-07-26T19:32', lat: 47.55, lon: 9.32 },
  { label: 'Greenwich at J2000.0 (UTC+0 in winter)', local: '2000-01-01T12:00', lat: 51.4769, lon: 0.0 },
  { label: 'Zürich in summer time (UTC+2)', local: '1985-07-15T10:20', lat: 47.37, lon: 8.54 },
  { label: 'a wall-clock time that did not exist (clocks skipped forward): Zürich, 2021-03-28 02:30', local: '2021-03-28T02:30', lat: 47.37, lon: 8.54 },
];
/** Must equal src/sky/sidecar.ts: the window the page asks for around a birth. */
const WINDOW_DAYS = 16;
const HELIO = 'mercury,venus,mars,jupiter,saturn,uranus,neptune,pluto,earth';

const INSTANTS = [
  ['J2000.0', '2000-01-01T12:00:00Z'],
  ['solar eclipse of 2019-07-02, greatest', '2019-07-02T19:24:00Z'],
  ['March equinox 2026', '2026-03-20T14:46:00Z'],
  ['June solstice 2026', '2026-06-21T08:24:00Z'],
  ['December solstice 2026', '2026-12-21T20:50:00Z'],
  ['a mid-span afternoon', '2033-02-14T15:20:00Z'],
  ['near the end of the span', '2038-11-15T06:30:00Z'],
];
/** where to start looking for the next new and full Moon */
const SYZYGY_FROM = ['2019-07-01T00:00:00Z', '2026-10-08T00:00:00Z', '2035-05-01T00:00:00Z'];

const get = async (p, params = {}) => {
  const u = new URL(p, URL_);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  let res;
  try { res = await fetch(u, { signal: AbortSignal.timeout(60_000) }); }
  catch (e) { throw new Error(`no ephemeris sidecar at ${URL_} (${e.cause?.code || e.message}); start ephemeris/run.sh`); }
  if (!res.ok) throw new Error(`${u.pathname} answered ${res.status}: ${await res.text()}`);
  return res.json();
};
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const snap = async (ms) => {
  const p = await get('/positions', { t: iso(ms) });
  return { iso: p.iso, elongation: p.elongation, illuminated: p.illuminated, waxing: p.waxing, gmst: p.gmst, subsolar: p.subsolar, sublunar: p.sublunar, sun: p.sun.lon, moon: p.moon.lon };
};
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const offset = async (ms, target) => wrap180((await get('/positions', { t: iso(ms) })).elongation - target);

async function crossing(from, target) {
  const step = 6 * 3_600_000;
  let a = from;
  let fa = await offset(a, target);
  for (let i = 0; i < 130; i++) {
    const b = a + step;
    const fb = await offset(b, target);
    if (fa < 0 && fb >= 0 && fb - fa < 90) {
      let lo = a;
      let hi = b;
      for (let k = 0; k < 22; k++) { // to ~1.5 s
        const mid = (lo + hi) / 2;
        if ((await offset(mid, target)) < 0) lo = mid; else hi = mid;
      }
      return Math.round((lo + hi) / 2 / 1000) * 1000;
    }
    a = b;
    fa = fb;
  }
  throw new Error(`no crossing of ${target}° within 32 days of ${iso(from)}`);
}

async function build() {
  const ping = await get('/ping');
  const instants = [];
  for (const [label, t] of INSTANTS) instants.push({ label, ...(await snap(Date.parse(t))) });
  const syzygies = [];
  for (const from of SYZYGY_FROM) {
    const f = Date.parse(from);
    const conj = await crossing(f, 0);
    const opp = await crossing(f, 180);
    syzygies.push({ after: from, conjunction: iso(conj), opposition: iso(opp) });
  }
  return {
    meta: { generatedAt: new Date().toISOString(), sidecar: `${ping.name}@${ping.version}`, kernel: ping.ephemeris?.kernel, note: 'subsolar/sublunar: lat = declination, lon = right ascension − apparent GMST; syzygies by bisection on the sidecar elongation to ~2 s' },
    instants,
    syzygies,
  };
}

const query = (p, params) => `${p}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;

async function buildBirth() {
  const ping = await get('/ping');
  const cases = [];
  for (const b of BIRTHS) {
    const chartReq = query('/chart', { local: b.local, lat: b.lat, lon: b.lon });
    const chart = await get('/chart', { local: b.local, lat: b.lat, lon: b.lon });
    const centre = Date.parse(chart.utc);
    const start = iso(centre - WINDOW_DAYS * 86_400_000);
    const pReq = { start, stepHours: 48, count: (2 * WINDOW_DAYS * 24) / 48 + 1, bodies: HELIO, frame: 'helio' };
    const mReq = { start, stepHours: 6, count: (2 * WINDOW_DAYS * 24) / 6 + 1, bodies: 'moon', frame: 'geo' };
    cases.push({
      label: b.label,
      input: { local: b.local, lat: b.lat, lon: b.lon },
      requests: { chart: chartReq, planets: query('/positions', pReq), moon: query('/positions', mReq) },
      chart,
      window: { planets: await get('/positions', pReq), moon: await get('/positions', mReq) },
    });
  }
  return { meta: { generatedAt: new Date().toISOString(), sidecar: `${ping.name}@${ping.version}`, kernel: ping.ephemeris?.kernel, note: 'chart and window exactly as the sidecar answered; the client must ask for exactly `requests`' }, cases };
}

const strip = (o) => JSON.stringify({ ...o, meta: { ...o.meta, generatedAt: '' } });
const next = await build();
const nextBirth = await buildBirth();
if (process.argv.includes('--check')) {
  const have = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (strip(have) !== strip(next)) { console.error('luminaries golden is stale: run node scripts/sky-golden.mjs'); process.exit(1); }
  const haveBirth = fs.existsSync(OUT_BIRTH) ? JSON.parse(fs.readFileSync(OUT_BIRTH, 'utf8')) : null;
  if (!haveBirth || strip(haveBirth) !== strip(nextBirth)) { console.error('birth golden is stale: run node scripts/sky-golden.mjs'); process.exit(1); }
  console.log(`Verified luminaries golden: ${next.instants.length} instants, ${next.syzygies.length} syzygy pairs; birth golden: ${nextBirth.cases.length} charts`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n');
  fs.writeFileSync(OUT_BIRTH, JSON.stringify(nextBirth, null, 1) + '\n');
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${next.instants.length} instants, ${next.syzygies.length} syzygy pairs; ${path.relative(ROOT, OUT_BIRTH)}: ${nextBirth.cases.length} charts`);
}
