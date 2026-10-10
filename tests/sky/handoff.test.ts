// The handoff's composition (audit S3 (a)) and the arrival settle (S3 (b)), as pure maths.
//
// The geometry is the canonical system view the S key composes (stages.ts systemViewLongitude: the azimuth follows the Sun;
// frames.ts systemViewLatLon), read at real moments, and the Sun's true direction from the Earth. The invariant is stated for
// the reference moment below and then asserted across the whole year. The limits the geometry imposes are pinned, not hidden:
// no azimuth that varies smoothly with the Sun brings the pair inside the central 70% of a desktop view on the December–April
// dates (it stays inside the frame, within |NDC| 0.9), and a phone is centred only at the very end of the handoff.
import { describe, expect, it } from 'vitest';
import { dirFromLatLon, type Vec3 } from '../../src/data/geo';
import { eclipticVector, gmstDeg, obliquityDeg, sceneFromEcliptic, systemViewLatLon } from '../../src/sky/frames';
import {
  bothInFrame, FRAME_CENTRAL, handoffFocusWeight, FOCUS_HANDOFF, ndcOf, pairExtent, SETTLE, settleStep, STAGE_EDGES, SUN_DIAGRAM_DIST, SYSTEM_VIEW_ELEVATION, systemViewLongitude,
} from '../../src/sky/stages';

const FOV = 38;
/** The reference moment: the sandbox's date (2026-10-09). The invariant is measured here; the year is asserted separately. */
const REF = Date.parse('2026-10-09T12:00:00Z');

/** The Sun's ecliptic longitude, degrees (Meeus, ch. 25, low precision: well within a tenth of a degree for this purpose). */
function sunLongitudeDeg(ms: number): number {
  const d = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const L = 280.46 + 0.9856474 * d;
  const g = ((357.528 + 0.9856003 * d) * Math.PI) / 180;
  return ((((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) + 360) % 360);
}

/** The canonical system view at `ms`: the camera's direction from the focus, and the Sun's direction from the Earth (scene axes). */
function canonical(ms: number, longitude = systemViewLongitude(sunLongitudeDeg(ms))): { camDir: Vec3; sunDir: Vec3 } {
  const gmst = gmstDeg(ms);
  const eps = obliquityDeg(ms);
  const ll = systemViewLatLon(longitude, SYSTEM_VIEW_ELEVATION, gmst, eps);
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

  it('the geometric limit: the best possible look-at first centres the pair on a desktop at ~715 R⊕; the curve gets there at ~1 070', () => {
    // the Sun is ~900 R⊕ from the Earth; in this view (the azimuth following the Sun) the Earth–Sun line is foreshortened, so the
    // best look-at holds both inside 70% of a 1.6 viewport from ~715 R⊕ (the curve's cost is the difference, ~350 R⊕ of its ramp);
    // a 2.2 viewport has more width and holds them from the handoff's start
    let limit: number | null = null;
    for (let d = 600; d <= 1100 && limit === null; d += 5) if (bestPossibleExtent(d, 1.6) <= FRAME_CENTRAL) limit = d;
    expect(limit).not.toBeNull();
    expect(limit!).toBeGreaterThanOrEqual(690);
    expect(limit!).toBeLessThanOrEqual(740);
    expect(limit!).toBeLessThan(FOCUS_HANDOFF.from + 400);
    expect(bestPossibleExtent(STAGE_EDGES.handoff, 2.2)).toBeLessThanOrEqual(FRAME_CENTRAL);
  });

  it('keeps the pair inside the frame (|NDC| ≤ 1, not merely the central 70%) from 1 000 R⊕ on a desktop view', () => {
    for (let d = 1000; d <= 3000; d += 25) {
      expect(within(d, 1.6), `1.6 at ${d} R⊕`).toBeLessThanOrEqual(1);
      expect(within(d, 2.2), `2.2 at ${d} R⊕`).toBeLessThanOrEqual(1);
    }
  });

  it('pins the phone\'s limit: on a 0.46 viewport no look-at centres the pair before ~2 800 R⊕, and none does better than ~0.65', () => {
    // the phone is narrow and the Earth–Sun line runs across it: it is the sibling of the desktop limit, kept visible here
    for (const d of [1000, 1500, 2000, 2500]) expect(bestPossibleExtent(d, 0.46), `${d} R⊕`).toBeGreaterThan(FRAME_CENTRAL);
    expect(bestPossibleExtent(2900, 0.46)).toBeLessThanOrEqual(FRAME_CENTRAL);
    let min = Infinity;
    for (let d = 1000; d <= 3000; d += 50) min = Math.min(min, bestPossibleExtent(d, 0.46));
    expect(min).toBeGreaterThan(0.6);
  });

  it('the azimuth follows the Sun smoothly: the settled view never jumps as the date scrubs', () => {
    // a degree of the Sun's longitude moves the canonical azimuth by 1 ± swing·sin(·) degrees: never more than 1 + swing in magnitude
    const step = 0.5;
    for (let l = 0; l < 360; l += step) {
      const dAz = systemViewLongitude(l + step) - systemViewLongitude(l);
      expect(dAz / step).toBeGreaterThan(0.3);
      expect(dAz / step).toBeLessThan(1.7);
    }
    expect(systemViewLongitude(sunLongitudeDeg(REF))).toBeCloseTo(sunLongitudeDeg(REF) + 50 + 35 * Math.cos(((sunLongitudeDeg(REF) - 310) * Math.PI) / 180), 9);
  });
});

describe('the framing of the Earth and the Sun, across the year', () => {
  /** The worst |NDC| extent of the pair over the handoff's second half (1 070–3 000 R⊕), both desktop aspects, on each day of a year. */
  function yearWorst(longitudeOf: (ms: number) => number | undefined): number[] {
    const out: number[] = [];
    for (let k = 0; k < 366; k++) {
      const c = canonical(REF + k * 86_400_000, longitudeOf(REF + k * 86_400_000));
      let w = 0;
      for (const aspect of [1.6, 2.2]) for (let d = 1070; d <= 3000; d += 10) w = Math.max(w, pairExtent(d, aspect, FOV, c.camDir, c.sunDir));
      out.push(w);
    }
    return out;
  }

  const year = yearWorst(() => undefined);

  it('keeps the Earth and the Sun inside the frame (|NDC| < 1, with room to spare: ≤ 0.9) on every day of the year', () => {
    expect(Math.max(...year)).toBeLessThan(1);
    expect(Math.max(...year)).toBeLessThanOrEqual(0.9);
  });

  it('holds them inside the central 70% on most days (at least 60%); the rest are the December–April swing, still inside 0.9', () => {
    const inside = year.filter((w) => w <= FRAME_CENTRAL).length;
    expect(inside / year.length).toBeGreaterThanOrEqual(0.6);
    // the days outside the central 70% are the Sun at ecliptic longitude ~250°–50° (December–April)
    for (let k = 0; k < year.length; k++) {
      if (year[k] <= FRAME_CENTRAL) continue;
      const l = sunLongitudeDeg(REF + k * 86_400_000);
      expect(l >= 240 || l <= 50, `day ${k}: Sun at ${l.toFixed(0)}° is outside the central 70% (${year[k].toFixed(2)})`).toBe(true);
    }
  });

  it('measures what the change bought: the fixed azimuth (250°) it replaced left the pair far outside the frame on some dates', () => {
    const fixed = yearWorst(() => 250);
    expect(Math.max(...fixed)).toBeGreaterThan(1.8);
    expect(Math.max(...fixed)).toBeGreaterThan(Math.max(...year) * 2);
  });
});

describe('the framing of the Earth and the Sun, the reference view (continued)', () => {
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
