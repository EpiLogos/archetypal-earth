import { describe, expect, it } from 'vitest';
import sky from '../../public/data/sky.json';
import type { BodyKey, SkyData } from '../../src/types/sky';
import { SkyEphemeris } from '../../src/sky/ephemeris';
import { wrap180 } from '../../src/sky/frames';

const data = sky as unknown as SkyData;
const eph = new SkyEphemeris(data);
const probe = data.golden.epochs.find((e) => e.label === 'Off-grid probe')!;
const ms = Date.parse(probe.iso);

describe('the client ephemeris is an interpolation of the sidecar grids, nothing more', () => {
  it('the probe epoch lies between grid nodes (not on one)', () => {
    const t0 = Date.parse(data.planets.start);
    const stepMs = data.planets.stepHours * 3_600_000;
    expect(((ms - t0) / stepMs) % 1).not.toBe(0);
  });

  it('planets and Earth agree with the sidecar at the off-grid probe (≤ 0.1°, r ≤ 1e-4 au)', () => {
    for (const [key, g] of Object.entries(probe.planets!) as [BodyKey, { lon: number; lat: number; r: number }][]) {
      const p = eph.helio(key, ms)!;
      expect(p, key).not.toBeNull();
      expect(Math.abs(wrap180(p.lon - g.lon)), `${key} lon`).toBeLessThan(0.1);
      expect(Math.abs(p.lat - g.lat), `${key} lat`).toBeLessThan(0.1);
      expect(Math.abs(p.r - g.r), `${key} r`).toBeLessThan(1e-4 * Math.max(1, g.r));
    }
    const e = eph.helio('earth', ms)!;
    expect(Math.abs(wrap180(e.lon - probe.earth!.lon))).toBeLessThan(0.05);
  });

  it('the Moon agrees with the sidecar at the off-grid probe (≤ 0.1° with the hourly grid)', () => {
    const m = eph.moon(ms)!;
    expect(Math.abs(wrap180(m.lon - probe.moon!.lon))).toBeLessThan(0.1);
    expect(Math.abs(m.lat - probe.moon!.lat)).toBeLessThan(0.1);
  });

  it('the Sun seen from Earth is the Earth turned around', () => {
    const s = eph.sunGeo(ms)!;
    expect(Math.abs(wrap180(s.lon - probe.sun!.lon))).toBeLessThan(0.05);
  });

  it('reproduces grid nodes exactly', () => {
    const t0 = Date.parse(data.planets.start);
    const k = 100;
    const p = eph.helio('mars', t0 + k * data.planets.stepHours * 3_600_000)!;
    expect(p.lon).toBeCloseTo(data.planets.bodies.mars!.lon[k], 6);
  });

  it('has no position outside the generated span, and says so', () => {
    expect(eph.helio('mars', Date.UTC(1900, 0, 1))).toBeNull();
    expect(eph.moon(Date.UTC(2100, 0, 1))).toBeNull();
    expect(eph.covers(Date.UTC(1900, 0, 1))).toBe(false);
    expect(eph.clamp(Date.UTC(1900, 0, 1)).inside).toBe(false);
    expect(eph.clamp(Date.UTC(2026, 0, 1)).inside).toBe(true);
  });

  it('never jumps across 360° → 0° (the Moon over a month, in 6-hour steps)', () => {
    let prev = eph.moon(ms)!.lon;
    for (let h = 6; h <= 24 * 30; h += 6) {
      const l = eph.moon(ms + h * 3_600_000)!.lon;
      expect(Math.abs(wrap180(l - prev))).toBeLessThan(5);
      prev = l;
    }
  });
});
