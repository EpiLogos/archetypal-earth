// The handoff's composition (audit S3 (a)) and the arrival settle (S3 (b)), as pure maths.
//
// The geometry is the canonical system view the S key composes (frames.ts systemViewLatLon), read at real moments, and the
// Sun's true direction from the Earth. The invariant is stated for the reference moment below. The limits the geometry
// imposes are pinned, not hidden: no look-at centres the pair on a desktop below ~950 R⊕ (1.6) or on a phone at all, and the
// canonical azimuth is fixed in the ecliptic, so over the year the pair leaves the frame on some dates.
import { describe, expect, it } from 'vitest';
import { dirFromLatLon, type Vec3 } from '../../src/data/geo';
import { eclipticVector, gmstDeg, obliquityDeg, sceneFromEcliptic, systemViewLatLon } from '../../src/sky/frames';
import {
  bothInFrame, FRAME_CENTRAL, handoffFocusWeight, FOCUS_HANDOFF, ndcOf, pairExtent, SETTLE, settleStep, STAGE_EDGES, SUN_DIAGRAM_DIST,
} from '../../src/sky/stages';

const FOV = 38;
/** The reference moment: the sandbox's date (2026-10-09). The invariant is measured here; the season is tested separately. */
const REF = Date.parse('2026-10-09T12:00:00Z');

/** The Sun's ecliptic longitude, degrees (Meeus, ch. 25, low precision: well within a tenth of a degree for this purpose). */
function sunLongitudeDeg(ms: number): number {
  const d = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const L = 280.46 + 0.9856474 * d;
  const g = ((357.528 + 0.9856003 * d) * Math.PI) / 180;
  return ((((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) + 360) % 360);
}

/** The canonical system view at `ms`: the camera's direction from the focus, and the Sun's direction from the Earth (scene axes). */
function canonical(ms: number): { camDir: Vec3; sunDir: Vec3 } {
  const gmst = gmstDeg(ms);
  const eps = obliquityDeg(ms);
  const ll = systemViewLatLon(250, 38, gmst, eps);
  return { camDir: dirFromLatLon(ll.lat, ll.lon), sunDir: sceneFromEcliptic(eclipticVector(sunLongitudeDeg(ms), 0, 1), gmst, eps) };
}

const ref = canonical(REF);
const within = (d: number, aspect: number) => pairExtent(d, aspect, FOV, ref.camDir, ref.sunDir);

/** The smallest |NDC| extent any look-at weight in [0,1] achieves for the pair at this distance and aspect. */
function bestPossibleExtent(d: number, aspect: number): number {
  let best = Infinity;
  for (let w = 0; w <= 1 + 1e-9; w += 0.005) best = Math.min(best, pairExtent(d, aspect, FOV, ref.camDir, ref.sunDir, Math.min(1, w)));
  return best;
}

describe('the look-at weight across the handoff', () => {
  it('is 0 in the Earth\'s own stage and the handoff\'s start, so the atlas\'s framing is unchanged there', () => {
    for (const d of [1.05, 5.4, 12, 40, STAGE_EDGES.handoff]) expect(handoffFocusWeight(d)).toBe(0);
  });

  it('reaches 1 by the end of its ramp, and is monotone in the distance', () => {
    expect(handoffFocusWeight(FOCUS_HANDOFF.to)).toBe(1);
    let prev = 0;
    for (let d = 100; d < 6000; d *= 1.02) {
      const w = handoffFocusWeight(d);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      prev = w;
    }
  });

  it('is one half at the middle of the ramp: there the look-at is the midpoint of the Earth and the Sun', () => {
    const mid = FOCUS_HANDOFF.from * Math.sqrt(FOCUS_HANDOFF.to / FOCUS_HANDOFF.from);
    expect(mid).toBeGreaterThan(1000);
    expect(mid).toBeLessThan(1050);
    expect(handoffFocusWeight(mid)).toBeCloseTo(0.5, 9);
  });

  it('depends on the distance alone: the same distance is the same weight, so the zoom is reversible', () => {
    for (const d of [700, 1000, 1400, 2500]) expect(handoffFocusWeight(d)).toBe(handoffFocusWeight(d));
  });
});

describe('the framing of the Earth and the Sun, the reference view', () => {
  it('keeps both the Earth and the Sun inside the central 70% of a desktop viewport from ~1 070 R⊕ across the rest of the handoff', () => {
    for (const aspect of [1.6, 2.2]) {
      for (let d = 1070; d <= 3000; d += 20) {
        expect(within(d, aspect), `aspect ${aspect} at ${d} R⊕`).toBeLessThanOrEqual(FRAME_CENTRAL + 1e-9);
      }
    }
  });

  it('first frames both inside that central 70% at 1 030–1 100 R⊕ (the boundary is pinned, not hoped for)', () => {
    let first: number | null = null;
    for (let d = 600; d <= 3000 && first === null; d += 5) {
      if (bothInFrame(d, 1.6, FOV, ref.camDir, ref.sunDir) && bothInFrame(d, 2.2, FOV, ref.camDir, ref.sunDir)) first = d;
    }
    expect(first).not.toBeNull();
    expect(first!).toBeGreaterThanOrEqual(1030);
    expect(first!).toBeLessThanOrEqual(1100);
  });

  it('the geometric limit: the best possible look-at first centres the pair on a desktop at ~950 R⊕; the curve gets there at ~1 070', () => {
    // the Sun is ~900 R⊕ from the Earth, so below ~950 R⊕ no look-at holds both inside 70% of a 1.6 viewport (the curve's cost
    // is the difference between the two, ~120 R⊕ of its ramp); a 2.2 viewport has more width and gets there at ~665 R⊕
    let limit: number | null = null;
    for (let d = 600; d <= 1100 && limit === null; d += 5) if (bestPossibleExtent(d, 1.6) <= FRAME_CENTRAL) limit = d;
    expect(limit).not.toBeNull();
    expect(limit!).toBeGreaterThanOrEqual(930);
    expect(limit!).toBeLessThanOrEqual(970);
    expect(limit!).toBeLessThan(FOCUS_HANDOFF.from + 400);
  });

  it('keeps the pair inside the frame (|NDC| ≤ 1, not merely the central 70%) from 1 000 R⊕ on a desktop view', () => {
    for (let d = 1000; d <= 3000; d += 25) {
      expect(within(d, 1.6), `1.6 at ${d} R⊕`).toBeLessThanOrEqual(1);
      expect(within(d, 2.2), `2.2 at ${d} R⊕`).toBeLessThanOrEqual(1);
    }
  });

  it('pins the phone\'s limit: at this view no look-at centres the pair on a 0.46 viewport anywhere in the handoff', () => {
    // the phone is narrow and the Earth–Sun line runs across it: the best any look-at does is ~0.86 at 2 800 R⊕
    for (const d of [1000, 1500, 2000, 2500, 2900]) expect(bestPossibleExtent(d, 0.46), `${d} R⊕`).toBeGreaterThan(FRAME_CENTRAL);
  });

  it('pins the seasonal limit: the canonical azimuth is fixed in the ecliptic, so on some dates the pair leaves the frame', () => {
    // the frame is the reference moment's; over the year the Earth–Sun line swings past the camera's line of sight, and at a
    // mid-year date the Earth leaves the frame at ~1 400 R⊕. Changing the canonical azimuth to follow the Sun would remove it.
    let worst = 0;
    for (let k = 0; k < 36; k++) {
      const c = canonical(REF + k * 10.15 * 86_400_000);
      for (let d = 1070; d <= 3000; d += 10) worst = Math.max(worst, pairExtent(d, 1.6, FOV, c.camDir, c.sunDir));
    }
    expect(worst).toBeGreaterThan(1);
  });

  it('the Earth itself stays on screen across the handoff on a desktop view (its own |NDC| is at most ~0.75)', () => {
    for (const aspect of [1.6, 2.2]) {
      for (let d = 1000; d <= 3000; d += 50) {
        const focus: Vec3 = ref.sunDir.map((x) => x * SUN_DIAGRAM_DIST * handoffFocusWeight(d)) as Vec3;
        const p = ndcOf([0, 0, 0], focus, ref.camDir, d, aspect, FOV);
        expect(Math.max(Math.abs(p.x), Math.abs(p.y)), `aspect ${aspect} at ${d} R⊕`).toBeLessThanOrEqual(0.76);
      }
    }
  });
});

describe('the arrival settle', () => {
  it('moves no further than the remaining angle and no faster than the cap', () => {
    for (const remaining of [0.05, 1, 10, 60, 180]) {
      for (const dt of [1 / 60, 1 / 30, 0.1]) {
        const step = settleStep(remaining, dt);
        expect(step).toBeGreaterThanOrEqual(0);
        expect(step).toBeLessThanOrEqual(remaining + 1e-12);
        expect(step).toBeLessThanOrEqual(SETTLE.maxDegPerS * dt + 1e-12);
      }
    }
    expect(settleStep(0, 0.1)).toBe(0);
    expect(settleStep(10, 0)).toBe(0);
  });

  it('settles to the canonical view within a bounded time from a long way off, never overshooting', () => {
    let remaining = 150;
    const dt = 1 / 30;
    let t = 0;
    while (remaining > SETTLE.doneDeg && t < 60) {
      const step = settleStep(remaining, dt);
      expect(step).toBeLessThanOrEqual(SETTLE.maxDegPerS * dt + 1e-12);
      remaining -= step;
      expect(remaining).toBeGreaterThanOrEqual(-1e-12);
      t += dt;
    }
    expect(remaining).toBeLessThanOrEqual(SETTLE.doneDeg);
    expect(t).toBeLessThan(20);
  });

  it('is slow and eased: a small offset is 90% gone at the 2.4 s the spec names', () => {
    let remaining = 5;
    const dt = 1 / 60;
    for (let t = 0; t < SETTLE.durationMs / 1000; t += dt) remaining -= settleStep(remaining, dt);
    expect(remaining).toBeLessThanOrEqual(0.5 + 0.02);
    expect(remaining).toBeGreaterThan(0.4);
  });
});
