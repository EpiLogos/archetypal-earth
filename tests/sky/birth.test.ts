import { describe, expect, it } from 'vitest';
import sky from '../../public/data/sky.json';
import golden from './golden/birth.json';
import { SkyEphemeris } from '../../src/sky/ephemeris';
import { chartAgreement, chartMoment, chartRows, describeAspect, describeInstant, approximationNote, placeInSign, BIRTH_FRAMING, BIRTH_LIMITS } from '../../src/sky/chart';
import { dataWithWindow, chartProblems, parseBirthInput, SidecarClient, SidecarError, validateChart, WINDOW_DAYS } from '../../src/sky/sidecar';
import { findPlaces, fold, formatCoordinates, fromGazetteer, fromGeocode } from '../../src/sky/gazetteer';
import { blendPose, easeInOut, lerpAngle } from '../../src/sky/flight';
import { aspectArc, CHART_RADIUS } from '../../src/sky/chart-overlay';
import { moonPhase } from '../../src/sky/luminaries';
import type { SidecarChart, SkyData } from '../../src/types/sky';

const base = sky as unknown as SkyData;
type Case = (typeof golden.cases)[number];
const byLabel = (re: RegExp) => golden.cases.find((c) => re.test(c.label)) as Case;
const jung = byLabel(/pre-1900/);
const j2000 = byLabel(/J2000/);
const summer = byLabel(/summer time/);
const gap = byLabel(/did not exist/);
const chartOf = (c: Case) => c.chart as unknown as SidecarChart;
const windowEph = (c: Case) => new SkyEphemeris(dataWithWindow(base, { planets: c.window.planets as never, moon: c.window.moon as never, from: c.window.planets.start, to: c.window.planets.start }));

describe('the chart contract: what the page believes of the sidecar', () => {
  it('accepts every golden chart as the sidecar gave it', () => {
    for (const c of golden.cases) expect(chartProblems(c.chart), c.label).toEqual([]);
  });

  it('names each way a chart can break the contract, and refuses it', () => {
    const mut = (f: (c: Record<string, any>) => void) => { const c = structuredClone(jung.chart) as Record<string, any>; f(c); return chartProblems(c); };
    expect(mut((c) => { delete c.bodies.mars; })).toEqual(['bodies.mars: missing']);
    expect(mut((c) => { c.bodies.sun.lon = 400; }).join()).toMatch(/bodies\.sun\.lon/);
    expect(mut((c) => { c.bodies.sun.sign = 'Leo'; c.bodies.sun.signIndex = 0; }).join()).toMatch(/bodies\.sun: sign and degree disagree with lon/);
    expect(mut((c) => { c.approximateReason = null; })).toEqual(['approximateReason: an approximate chart states why']);
    expect(mut((c) => { c.zodiac = 'sidereal'; }).join()).toMatch(/tropical/);
    expect(mut((c) => { c.houses.cusps = c.houses.cusps.slice(1); }).join()).toMatch(/12 cusp/);
    expect(mut((c) => { c.aspects[0].orb = 'wide'; }).join()).toMatch(/aspects\[0\]/);
    expect(mut((c) => { c.utc = 'whenever'; }).join()).toMatch(/utc/);
    expect(() => validateChart({})).toThrow(SidecarError);
    expect(chartProblems(null)).toEqual(['the chart is not an object']);
  });
});

describe('the golden charts: time zones resolved by the sidecar, and said so', () => {
  it('resolves the wall clock to the instant, with the offset the zone had that day', () => {
    expect(chartOf(j2000).utc).toBe('2000-01-01T12:00:00Z');
    expect(chartOf(j2000).input.utcOffsetMinutes).toBe(0);
    expect(chartOf(summer).input.tz).toBe('Europe/Zurich');
    expect(chartOf(summer).input.utcOffsetMinutes).toBe(120);
    expect(chartOf(summer).utc).toBe('1985-07-15T08:20:00Z');
  });

  it('labels pre-1900 local times approximate, with the reason, and no later chart', () => {
    expect(chartOf(jung).approximate).toBe(true);
    expect(approximationNote(chartOf(jung))).toMatch(/^Approximate: Before 1900/);
    for (const c of [j2000, summer, gap]) { expect(chartOf(c).approximate).toBe(false); expect(approximationNote(chartOf(c))).toBeNull(); }
    // local mean time: the offset is 29 minutes, not an hour, and the chart's instant keeps its seconds
    expect(chartOf(jung).input.utcOffsetMinutes).toBe(29);
    expect(chartOf(jung).utc).toBe('1875-07-26T19:02:14Z');
  });

  it('carries a warning when the wall-clock time never existed, and still gives a chart', () => {
    expect(chartOf(gap).warnings.join()).toMatch(/did not exist/);
    expect(chartOf(gap).utc).toBe('2021-03-28T01:30:00Z');
  });

  it('describes how the clock became the instant', () => {
    expect(describeInstant(chartOf(summer))).toBe('1985-07-15 10:20 Europe/Zurich (UTC+2) = 1985-07-15 08:20 UTC');
    expect(describeInstant(chartOf(jung))).toContain('(UTC+0:29)');
  });

  it('puts the Sun where the sidecar\u2019s own golden J2000.0 epoch puts it (apparent, within a minute of arc)', () => {
    const epoch = base.golden.epochs.find((e) => /J2000/.test(e.label))!;
    expect(epoch.status).toBe('ok');
    const dl = Math.abs(chartOf(j2000).bodies.sun!.lon - epoch.sun!.lon);
    expect(dl).toBeLessThan(0.02);
  });
});

describe('the bodies fly to the longitudes the chart states', () => {
  it('has a window the generated sky\u2019s own interpolator reads, centred on the birth moment', () => {
    for (const c of golden.cases) {
      const eph = windowEph(c);
      const ms = chartMoment(chartOf(c));
      expect(eph.covers(ms), c.label).toBe(true);
      expect(eph.covers(ms - (WINDOW_DAYS - 0.5) * 86_400_000), c.label).toBe(true);
      expect(eph.covers(ms + (WINDOW_DAYS + 0.5) * 86_400_000), c.label).toBe(false);
      expect(eph.moonPath(ms, 96), `${c.label}: the Moon's whole ring is inside the window`).not.toBeNull();
    }
  });

  it('agrees with the chart: Sun and Moon within 0.002°, every planet within 0.01° (measured: 0.0004°, 0.0002°, ≤ 0.0066°)', () => {
    for (const c of golden.cases) {
      const worst = Object.entries(chartAgreement(chartOf(c), windowEph(c)));
      expect(worst.length, c.label).toBe(10);
      for (const [key, d] of worst) expect(d, `${c.label}: ${key}`).toBeLessThan(key === 'sun' || key === 'moon' ? 0.002 : 0.01);
    }
  });

  it('lights the sky of that moment: the Moon\u2019s phase from the window matches the sidecar\u2019s own words', () => {
    for (const c of [jung, j2000, summer]) {
      const ph = moonPhase(windowEph(c), chartMoment(chartOf(c)))!;
      expect(ph, c.label).not.toBeNull();
      // the sidecar names the phase by its own convention; the major phase and waxing/waning must agree
      expect(ph.waxing, c.label).toBe(chartOf(c).moon!.stage === 'waxing');
    }
  });
});

describe('the sidecar client asks exactly what the golden recorded, and explains every refusal', () => {
  const answers = (c: Case): Record<string, unknown> => ({ [c.requests.chart]: c.chart, [c.requests.planets]: c.window.planets, [c.requests.moon]: c.window.moon });
  const fakeFetch = (table: Record<string, unknown>, seen: string[] = []) => (async (url: string) => {
    const path = url.replace(/^http:\/\/sidecar/, '');
    seen.push(path);
    if (!(path in table)) return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(table[path]), { status: 200 });
  }) as unknown as typeof fetch;

  it('asks for the chart and the two grids in the shape the golden pins', async () => {
    const seen: string[] = [];
    const client = new SidecarClient({ base: 'http://sidecar', local: true, fetch: fakeFetch(answers(summer), seen) });
    const chart = await client.chart(summer.input);
    const win = await client.window(chartMoment(chart));
    expect(seen[0]).toBe(summer.requests.chart);
    expect(new Set(seen.slice(1))).toEqual(new Set([summer.requests.planets, summer.requests.moon]));
    expect(win.planets.count).toBe(17);
    expect(win.moon.count).toBe(129);
    expect(win.from).toBe('1985-06-29T08:20:00Z');
  });

  it('refuses without asking when the page is not served from this machine', async () => {
    let called = 0;
    const client = new SidecarClient({ base: 'http://sidecar', local: false, fetch: (async () => { called++; return new Response('{}'); }) as unknown as typeof fetch });
    await expect(client.chart(summer.input)).rejects.toMatchObject({ kind: 'not-local' });
    await expect(client.window(0)).rejects.toMatchObject({ kind: 'not-local' });
    expect(await client.available()).toBe(false);
    expect(called).toBe(0);
  });

  it('says absent when nothing answers, out-of-range for a date the kernel lacks, bad-input for a date that cannot exist', async () => {
    const down = new SidecarClient({ base: 'http://sidecar', local: true, fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    await expect(down.chart(summer.input)).rejects.toMatchObject({ kind: 'absent' });
    const status = (code: number, body: unknown) => new SidecarClient({ base: 'http://sidecar', local: true, fetch: (async () => new Response(JSON.stringify(body), { status: code })) as unknown as typeof fetch });
    await expect(status(422, { detail: { error: 'outside-ephemeris-range', message: '1400-07-26 lies outside the loaded ephemeris kernel' } }).chart(summer.input)).rejects.toMatchObject({ kind: 'out-of-range', message: expect.stringMatching(/1549–2650/) });
    await expect(status(422, { detail: 'month must be in 1..12, not 13' }).chart(summer.input)).rejects.toMatchObject({ kind: 'bad-input', message: 'month must be in 1..12, not 13' });
    await expect(status(503, { detail: { error: 'geocoder-unreachable', message: 'x' } }).geocode('Zurich')).rejects.toMatchObject({ kind: 'geocoder' });
    await expect(status(500, {}).chart(summer.input)).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('refuses a chart or a grid that does not match its contract, rather than drawing holes', async () => {
    const broken = structuredClone(summer.chart) as Record<string, any>;
    delete broken.bodies.venus;
    const client = new SidecarClient({ base: 'http://sidecar', local: true, fetch: fakeFetch({ [summer.requests.chart]: broken, [summer.requests.planets]: { ...summer.window.planets, bodies: { ...summer.window.planets.bodies, mars: { lon: [1], lat: [1], r: [1] } } }, [summer.requests.moon]: summer.window.moon }) });
    await expect(client.chart(summer.input)).rejects.toMatchObject({ kind: 'unsupported', message: expect.stringMatching(/bodies\.venus: missing/) });
    await expect(client.window(chartMoment(chartOf(summer)))).rejects.toMatchObject({ kind: 'unsupported', message: expect.stringMatching(/malformed mars column/) });
  });

  it('filters place answers that are not places', async () => {
    const results = [{ name: 'Zürich, Schweiz', lat: 47.37, lon: 8.54, source: 'OpenStreetMap Nominatim' }, { name: 'nowhere', lat: 123, lon: 0, source: 'x' }, { lat: 1, lon: 1 }];
    const client = new SidecarClient({ base: 'http://sidecar', local: true, fetch: fakeFetch({ '/geocode?q=Zurich': { results } }) });
    expect(await client.geocode('Zurich')).toHaveLength(1);
  });
});

describe('the birth form: only moments that can exist', () => {
  it('builds the linkable local moment from a date, a time and a place', () => {
    expect(parseBirthInput('1875-07-26', '19:32', 47.55, 9.32)).toEqual({ local: '1875-07-26T19:32', lat: 47.55, lon: 9.32 });
  });
  it('refuses a date that does not exist, a clock that is not a clock, and a place that is not on the Earth', () => {
    expect(parseBirthInput('2025-02-30', '12:00', 0, 0)).toBeNull();
    expect(parseBirthInput('2024-02-29', '12:00', 0, 0)).not.toBeNull();
    expect(parseBirthInput('2025-13-01', '12:00', 0, 0)).toBeNull();
    expect(parseBirthInput('2025-01-01', '24:00', 0, 0)).toBeNull();
    expect(parseBirthInput('2025-01-01', '12:60', 0, 0)).toBeNull();
    expect(parseBirthInput('2025-01-01', '12:00', 91, 0)).toBeNull();
    expect(parseBirthInput('2025-01-01', '12:00', 0, -181)).toBeNull();
    expect(parseBirthInput('2025-1-1', '12:00', 0, 0)).toBeNull();
    expect(parseBirthInput('2025-01-01', '12:00', NaN, 0)).toBeNull();
  });
});

describe('the gazetteer comes first', () => {
  const g = base.gazetteer;
  it('is sourced and sizeable, with coordinates on the Earth', () => {
    expect(g.source.ref).toMatch(/Nominatim/);
    expect(g.places.length).toBeGreaterThanOrEqual(60);
    for (const p of g.places) { expect(Math.abs(p.lat)).toBeLessThanOrEqual(90); expect(Math.abs(p.lon)).toBeLessThanOrEqual(180); }
  });
  it('matches without regard to accents or case, beginnings before middles', () => {
    expect(fold('Zürich')).toBe('zurich');
    expect(findPlaces(g.places, 'zur')[0].name).toBe('Zürich');
    expect(findPlaces(g.places, 'ZÜRICH')[0].name).toBe('Zürich');
    expect(findPlaces(g.places, 'york')[0].name).toBe('New York');
    expect(findPlaces(g.places, 'switz').map((p) => p.country).every((c) => c === 'Switzerland')).toBe(true);
    expect(findPlaces(g.places, 'qqqq')).toEqual([]);
    expect(findPlaces(g.places, '')).toEqual([]);
  });
  it('turns a choice into a named place and its source', () => {
    const z = findPlaces(g.places, 'Zürich')[0];
    expect(fromGazetteer(z)).toEqual({ name: 'Zürich, Switzerland', lat: z.lat, lon: z.lon, source: 'gazetteer' });
    expect(fromGeocode({ name: 'Bern, Verwaltungskreis Bern-Mittelland, Verwaltungsregion Bern-Mittelland, Bern, Schweiz', lat: 46.9481234, lon: 7.4474321, source: 'OpenStreetMap Nominatim' })).toEqual({ name: 'Bern, Schweiz', lat: 46.9481, lon: 7.4474, source: 'geocoder' });
    expect(formatCoordinates(-33.87, 151.21)).toBe('33.87° S, 151.21° E');
  });
});

describe('the reading is only what was given', () => {
  it('lists the ten bodies in the atlas\u2019s order, in sign and degree, retrograde marked', () => {
    const rows = chartRows(chartOf(jung), base.bodies);
    expect(rows.map((r) => r.key)).toEqual(['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']);
    expect(rows[0].place).toBe(placeInSign(chartOf(jung).bodies.sun!.lon));
    expect(rows.some((r) => r.retrograde)).toBe(true);
  });
  it('fixes its framing and its limits, and says neither predicts nor judges', () => {
    expect(BIRTH_FRAMING).toBe('the sky at that moment, read in Jung\u2019s keys');
    expect(BIRTH_LIMITS).toMatch(/no forecast/);
    expect(BIRTH_LIMITS).toMatch(/no verdict/);
  });
  it('words an aspect as geometry', () => {
    const a = chartOf(jung).aspects[0];
    expect(describeAspect(a, (k) => k)).toMatch(new RegExp(`^${a.a} ${a.type} ${a.b} · orb \\d\\.\\d°$`));
  });
});

describe('travelling between two skies', () => {
  it('sweeps the shorter way round the ecliptic, and never through the Earth', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngle(0, 180, 0.25)).toBeCloseTo(45, 9);
    const mid = blendPose([1, 0, 0], [-1, 0, 0], 0.5);
    expect(Math.hypot(...mid)).toBeCloseTo(1, 9);
    for (let t = 0; t <= 1; t += 0.05) expect(Math.hypot(...blendPose([5, 0, 1], [-3, 4, -1], t))).toBeGreaterThan(1.5);
  });
  it('starts at the start, ends at the end, and eases', () => {
    const a: [number, number, number] = [3, 4, 5];
    const b: [number, number, number] = [-6, 1, 2];
    expect(blendPose(a, b, 0)).toEqual(a);
    expect(blendPose(a, b, 1)).toEqual(b);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(-1)).toBe(0);
  });
  it('lets a body with no direction (the Earth) take the other\u2019s, scaled', () => {
    expect(blendPose([0, 0, 0], [10, 0, 0], 0.4)).toEqual([4, 0, 0]);
    expect(blendPose([10, 0, 0], [0, 0, 0], 0.4)).toEqual([6, 0, 0]);
  });
});

describe('the chart ring', () => {
  it('draws an aspect between the two natal longitudes on the ring, bowing toward the centre', () => {
    const r = CHART_RADIUS * 0.9;
    const arc = aspectArc(30, 150, r);
    expect(arc[0][0]).toBeCloseTo(Math.cos((30 * Math.PI) / 180) * r, 6);
    expect(arc[arc.length - 1][1]).toBeCloseTo(Math.sin((150 * Math.PI) / 180) * r, 6);
    for (const p of arc) expect(Math.hypot(p[0], p[1])).toBeLessThanOrEqual(r + 1e-6);
    const opp = aspectArc(0, 180, r);
    expect(Math.hypot(...opp[Math.floor(opp.length / 2)])).toBeLessThan(r * 0.2); // a straight line through the Earth
  });
});
