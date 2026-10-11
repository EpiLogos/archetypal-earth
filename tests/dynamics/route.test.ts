import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Plain ESM shared with the CLI.
import { DEFAULT_VAULT } from '../../scripts/lib/vault.mjs';
// @ts-expect-error Plain ESM shared with the CLI.
import { buildRoute, FIGURES as BUILT } from '../../scripts/dynamics-route.mjs';
import { coupledPhases, duffing, duffingEnergy, FIGURES, integrate, logisticStates, vanDerPol } from '../../src/dynamics/figures';

const ROOT = path.resolve(__dirname, '..', '..');

describe('the route through Van Eenwyk', () => {
  it('is what the curation and the vault give now, walks every concept the rail ships, and draws each stop', () => {
    const r = buildRoute({ vault: DEFAULT_VAULT });
    expect(r.errors).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'dynamics-route.json'), 'utf8'))).toEqual(r.data);
    const stops = r.data.movements.flatMap((m: { stops: { figure: string }[] }) => m.stops);
    expect(stops).toHaveLength(16);
    for (const s of stops) expect(Object.keys(FIGURES)).toContain(s.figure);
  });

  it('the generator and the client know the same figures, each captioned as drawn here', () => {
    expect([...BUILT].sort()).toEqual(Object.keys(FIGURES).sort());
    for (const f of Object.values(FIGURES)) expect(f.caption).toMatch(/drawn here|the drawing is not his/);
  });
});

describe('the systems the figures draw', () => {
  it('the logistic map doubles its period on the way to chaos, and opens a window of three inside it', () => {
    expect(logisticStates(2.9)).toHaveLength(1);
    expect(logisticStates(3.2)).toHaveLength(2);
    expect(logisticStates(3.5)).toHaveLength(4);
    expect(logisticStates(3.56)).toHaveLength(8);
    expect(logisticStates(3.7).length).toBeGreaterThan(50);
    expect(logisticStates(3.835)).toHaveLength(3);
  });

  it('a Van der Pol orbit from near rest and one from far out settle on the same cycle', () => {
    const f = vanDerPol(1.2);
    const amp = (pts: Float64Array) => { let m = 0; for (let i = pts.length / 2 - 600; i < pts.length / 2; i++) m = Math.max(m, Math.abs(pts[2 * i])); return m; };
    const inner = amp(integrate(f, 0.05, 0, 6000, 0.01));
    const outer = amp(integrate(f, 3.5, 3.5, 6000, 0.01));
    expect(inner).toBeCloseTo(2, 1);
    expect(outer).toBeCloseTo(inner, 2);
  });

  it('the Duffing loops keep their energy, and a path just above them runs both', () => {
    const pts = integrate(duffing, 0.02, Math.sqrt(2 * (0.0008 + 0.0002 - 0.00000004)), 9000, 0.01);
    const e0 = duffingEnergy(pts[0], pts[1]);
    const sides = new Set<number>();
    for (let i = 0; i < pts.length / 2; i++) { expect(Math.abs(duffingEnergy(pts[2 * i], pts[2 * i + 1]) - e0)).toBeLessThan(1e-5); if (Math.abs(pts[2 * i]) > 1) sides.add(Math.sign(pts[2 * i])); }
    expect([...sides].sort()).toEqual([-1, 1]);
  });

  it('two oscillators lock when their coupling outgrows half their difference, and drift apart when it does not', () => {
    const drift = (k: number) => { const r = coupledPhases(1.6, 2.15, () => k, 20000, 0.01); const n = r.length / 3; return Math.abs((r[3 * (n - 1) + 1] - r[3 * (n - 1)]) - (r[3 * (n - 2001) + 1] - r[3 * (n - 2001)])); };
    expect(drift(0.6)).toBeLessThan(1e-3);
    expect(drift(0.1)).toBeGreaterThan(1);
  });
});
