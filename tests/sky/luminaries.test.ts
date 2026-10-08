import { describe, expect, it } from 'vitest';
import sky from '../../public/data/sky.json';
import golden from './golden/luminaries.json';
import { SkyEphemeris } from '../../src/sky/ephemeris';
import { wrap180 } from '../../src/sky/frames';
import { moonPhase, nextSyzygies, phaseName, subsolarPoint, sunScene } from '../../src/sky/luminaries';
import { sunWeight } from '../../src/sky/stages';
import type { SkyData } from '../../src/types/sky';

const eph = new SkyEphemeris(sky as unknown as SkyData);
type Inst = (typeof golden.instants)[number];
const inSpan = (g: Inst) => eph.covers(Date.parse(g.iso));
const spanned = golden.instants.filter(inSpan);

describe('the terminator: the subsolar point against the sidecar at named instants', () => {
  it('has instants inside the span, at the equinox, both solstices and the eclipse', () => {
    expect(spanned.length).toBeGreaterThanOrEqual(5);
    expect(spanned.map((g) => g.label).join('|')).toMatch(/equinox.*solstice.*solstice/);
  });

  it('puts the Sun overhead where the sidecar does, to far better than display accuracy (≤ 0.01° ≈ 1.1 km; measured ≤ 0.005°)', () => {
    for (const g of spanned) {
      const p = subsolarPoint(eph, Date.parse(g.iso))!;
      expect(Math.abs(p.lat - g.subsolar.lat), `${g.label} lat`).toBeLessThan(0.01);
      expect(Math.abs(wrap180(p.lon - g.subsolar.lon)), `${g.label} lon`).toBeLessThan(0.01);
    }
  });

  it('crosses the equator at the March equinox and reaches ±23.44° at the solstices', () => {
    const lat = (label: RegExp) => subsolarPoint(eph, Date.parse(spanned.find((g) => label.test(g.label))!.iso))!.lat;
    expect(Math.abs(lat(/March equinox/))).toBeLessThan(0.05);
    expect(lat(/June solstice/)).toBeCloseTo(23.44, 1);
    expect(lat(/December solstice/)).toBeCloseTo(-23.44, 1);
  });

  it('is a unit vector in scene axes, and its sub-point is the direction itself', () => {
    for (const g of spanned) {
      const v = sunScene(eph, Date.parse(g.iso))!;
      expect(Math.hypot(...v)).toBeCloseTo(1, 12);
      const p = subsolarPoint(eph, Date.parse(g.iso))!;
      const la = (p.lat * Math.PI) / 180;
      const lo = (p.lon * Math.PI) / 180;
      expect(v[0]).toBeCloseTo(Math.cos(la) * Math.cos(lo), 9);
      expect(v[1]).toBeCloseTo(Math.sin(la), 9);
      expect(v[2]).toBeCloseTo(-Math.cos(la) * Math.sin(lo), 9);
    }
  });

  it('says nothing outside the generated span, rather than a guess', () => {
    const j2000 = golden.instants.find((g) => g.label === 'J2000.0')!;
    expect(inSpan(j2000)).toBe(false);
    expect(subsolarPoint(eph, Date.parse(j2000.iso))).toBeNull();
    expect(sunScene(eph, Date.parse(j2000.iso))).toBeNull();
    expect(moonPhase(eph, Date.parse(j2000.iso))).toBeNull();
    expect(nextSyzygies(eph, Date.parse(j2000.iso))).toEqual({ conjunction: null, opposition: null });
  });
});

describe('the Moon\u2019s phase against the sidecar', () => {
  it('matches the elongation (≤ 0.01°) and the lit fraction (≤ 0.002), and the waxing sense', () => {
    for (const g of spanned) {
      const ph = moonPhase(eph, Date.parse(g.iso))!;
      expect(Math.abs(wrap180(ph.elongation - g.elongation)), `${g.label} elongation`).toBeLessThan(0.01);
      expect(Math.abs(ph.illuminated - g.illuminated), `${g.label} lit`).toBeLessThan(0.002);
      expect(ph.waxing, g.label).toBe(g.waxing);
    }
  });

  it('is within a day of the true phase: the elongation moves ~12° a day, so 0.01° is a minute or two', () => {
    // the Moon gains ≈ 12.2° a day on the Sun; an error of 0.01° is about a minute of lunar time
    const day = 12.2;
    for (const g of spanned) {
      const ph = moonPhase(eph, Date.parse(g.iso))!;
      expect(Math.abs(wrap180(ph.elongation - g.elongation)) / day).toBeLessThan(1);
    }
  });

  it('names the eight phases from the elongation, centred on 0°, 45°, 90° … 315°', () => {
    expect(phaseName(0)).toBe('new');
    expect(phaseName(359)).toBe('new');
    expect(phaseName(45)).toBe('waxing crescent');
    expect(phaseName(90)).toBe('first quarter');
    expect(phaseName(135)).toBe('waxing gibbous');
    expect(phaseName(180)).toBe('full');
    expect(phaseName(225)).toBe('waning gibbous');
    expect(phaseName(270)).toBe('last quarter');
    expect(phaseName(335.96)).toBe('waning crescent');
  });
});

describe('the syzygies: the next conjunction and opposition of Sun and Moon', () => {
  const found = golden.syzygies.filter((s) => eph.covers(Date.parse(s.after)));

  it('has lunations to test, including the one after the eclipse of 2019 and the one now in the span', () => {
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it('finds the sidecar\u2019s own crossings to within half a minute', () => {
    for (const s of found) {
      const got = nextSyzygies(eph, Date.parse(s.after));
      expect(got.conjunction, `${s.after} conjunction`).not.toBeNull();
      expect(got.opposition, `${s.after} opposition`).not.toBeNull();
      expect(Math.abs(got.conjunction! - Date.parse(s.conjunction)), `${s.after} conjunction`).toBeLessThan(30_000);
      expect(Math.abs(got.opposition! - Date.parse(s.opposition)), `${s.after} opposition`).toBeLessThan(30_000);
    }
  });

  it('puts the new Moon of 2019-07-02 at the eclipse, and of 2026-10-10 at 15:50 UTC', () => {
    expect(new Date(nextSyzygies(eph, Date.parse('2019-07-01T00:00:00Z')).conjunction!).toISOString().slice(0, 16)).toBe('2019-07-02T19:16');
    expect(new Date(nextSyzygies(eph, Date.parse('2026-10-08T00:00:00Z')).conjunction!).toISOString().slice(0, 16)).toBe('2026-10-10T15:50');
  });

  it('the elongation at the found instants is 0° and 180°', () => {
    for (const s of found) {
      const got = nextSyzygies(eph, Date.parse(s.after));
      expect(Math.abs(wrap180(moonPhase(eph, got.conjunction!)!.elongation))).toBeLessThan(0.002);
      expect(Math.abs(wrap180(moonPhase(eph, got.opposition!)!.elongation - 180))).toBeLessThan(0.002);
    }
  });

  it('comes in order within a month, and gives null past the end of the span', () => {
    const t = Date.parse('2026-10-08T00:00:00Z');
    const got = nextSyzygies(eph, t);
    expect(got.conjunction!).toBeGreaterThan(t);
    expect(got.opposition!).toBeGreaterThan(got.conjunction!);
    expect(got.opposition! - t).toBeLessThan(31 * 86_400_000);
    expect(nextSyzygies(eph, eph.to + 1)).toEqual({ conjunction: null, opposition: null });
  });
});

describe('sunlight blends in with altitude', () => {
  it('is exactly zero near the surface, where the atlas keeps its composed key light', () => {
    for (const d of [1.2, 2, 4.4, 6, 8]) expect(sunWeight(d), `dist ${d}`).toBe(0);
  });

  it('is full from the lunar stage outward', () => {
    expect(sunWeight(40)).toBe(1);
    expect(sunWeight(600)).toBe(1);
    expect(sunWeight(9000)).toBe(1);
  });

  it('rises smoothly and monotonically between', () => {
    let prev = 0;
    for (let d = 8; d <= 40; d += 0.5) {
      const w = sunWeight(d);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(sunWeight(24)).toBeGreaterThan(0.3);
    expect(sunWeight(24)).toBeLessThan(0.7);
  });
});
