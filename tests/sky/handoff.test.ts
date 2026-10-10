// The handoff's composition (audit S3 (a)) and the arrival settle (S3 (b)), as pure maths.
//
// The geometry is the canonical system view the S key composes (frames.ts systemViewLatLon at stages.ts systemViewAzimuth: the
// camera sits toward the Sun's geocentric longitude), read at real moments across a whole year and at four viewport aspects,
// and the Sun's true direction from the Earth. The invariant holds on every date and on a phone. The limit the geometry
// imposes is pinned, not hidden: below ~1 200 R⊕ the Earth–Sun separation (~900 R⊕) is wider than the frame can hold.
import { describe, expect, it } from 'vitest';
import { dirFromLatLon, type Vec3 } from '../../src/data/geo';
import { eclipticVector, gmstDeg, obliquityDeg, sceneFromEcliptic, systemViewLatLon } from '../../src/sky/frames';
import {
  bothInFrame, FRAME_CENTRAL, handoffFocusWeight, FOCUS_HANDOFF, ndcOf, pairExtent, SETTLE, settleStep, STAGE_EDGES, SUN_DIAGRAM_DIST,
  SYSTEM_VIEW_ELEVATION, systemViewAzimuth,
} from '../../src/sky/stages';

const FOV = 38;
/** The reference moment (2026-10-09); the year is walked from here in 36 steps of ~10 days. */
const REF = Date.parse('2026-10-09T12:00:00Z');
const YEAR = Array.from({ length: 36 }, (_, k) => REF + k * 10.15 * 86_400_000);
/** A phone in portrait, a squarish tablet, a desktop, an ultra-wide. */
const ASPECTS = [0.46, 0.75, 1.6, 2.2] as const;

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
  const ll = systemViewLatLon(systemViewAzimuth(sunLongitudeDeg(ms)), SYSTEM_VIEW_ELEVATION, gmst, eps);
  return { camDir: dirFromLatLon(ll.lat, ll.lon), sunDir: sceneFromEcliptic(eclipticVector(sunLongitudeDeg(ms), 0, 1), gmst, eps) };
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
    expect(mid).toBeGreaterThan(1150);
    expect(mid).toBeLessThan(1250);
    expect(handoffFocusWeight(mid)).toBeCloseTo(0.5, 9);
  });

  it('depends on the distance alone: the same distance is the same weight, so the zoom is reversible', () => {
    for (const d of [700, 1000, 1400, 2500]) expect(handoffFocusWeight(d)).toBe(handoffFocusWeight(d));
  });
});

/** The distance from which the pair stays inside `fraction` of the frame all the way to the system edge. */
function firstHeld(c: { camDir: Vec3; sunDir: Vec3 }, aspect: number, fraction: number): number {
  let first = STAGE_EDGES.handoff;
  for (let d = STAGE_EDGES.system; d >= STAGE_EDGES.handoff; d -= 5) {
    if (pairExtent(d, aspect, FOV, c.camDir, c.sunDir) > fraction) { first = d + 5; break; }
  }
  return first;
}

describe('the canonical azimuth follows the Sun', () => {
  it('is the Sun\'s geocentric longitude, wrapped to 0–360', () => {
    expect(systemViewAzimuth(0)).toBe(0);
    expect(systemViewAzimuth(196.5)).toBe(196.5);
    expect(systemViewAzimuth(-10)).toBeCloseTo(350, 12);
    expect(systemViewAzimuth(725)).toBeCloseTo(5, 12);
  });

  it('puts the camera on the Sun\'s side: the Earth is farther from it than the Sun, whatever the date', () => {
    // camDir·sunDir > 0 means the camera sits on the Sun's side of the focus, looking along the line toward the Earth
    for (const ms of YEAR) {
      const c = canonical(ms);
      const dot = c.camDir[0] * c.sunDir[0] + c.camDir[1] * c.sunDir[1] + c.camDir[2] * c.sunDir[2];
      expect(dot, new Date(ms).toISOString()).toBeGreaterThan(Math.cos((SYSTEM_VIEW_ELEVATION * Math.PI) / 180) - 0.02);
    }
  });
});

describe('the framing of the Earth and the Sun, every date and every viewport', () => {
  it('keeps both inside the central 70% from 1 330 R⊕ on, on a phone, a tablet, a desktop and an ultra-wide, all year', () => {
    for (const ms of YEAR) {
      const c = canonical(ms);
      for (const aspect of ASPECTS) {
        for (let d = 1330; d <= STAGE_EDGES.system; d += 10) {
          expect(pairExtent(d, aspect, FOV, c.camDir, c.sunDir), `${new Date(ms).toISOString().slice(0, 10)} aspect ${aspect} at ${d} R⊕`).toBeLessThanOrEqual(FRAME_CENTRAL + 1e-9);
        }
      }
    }
  });

  it('first frames both inside that central 70% between 1 250 and 1 330 R⊕ — the boundary is pinned, not hoped for', () => {
    let worst = 0;
    let best = Infinity;
    for (const ms of YEAR) {
      const c = canonical(ms);
      for (const aspect of ASPECTS) {
        const first = firstHeld(c, aspect, FRAME_CENTRAL);
        worst = Math.max(worst, first);
        best = Math.min(best, first);
        expect(bothInFrame(first, aspect, FOV, c.camDir, c.sunDir)).toBe(true);
      }
    }
    expect(worst).toBeGreaterThanOrEqual(1280);
    expect(worst).toBeLessThanOrEqual(1330);
    expect(best).toBeGreaterThanOrEqual(1200);
  });

  it('is the same view on every date: the first-framed distance moves by under 100 R⊕ across the year, whatever the aspect', () => {
    for (const aspect of ASPECTS) {
      const firsts = YEAR.map((ms) => firstHeld(canonical(ms), aspect, FRAME_CENTRAL));
      expect(Math.max(...firsts) - Math.min(...firsts), `aspect ${aspect}`).toBeLessThan(100);
    }
  });

  it('keeps the pair inside the frame (|NDC| ≤ 1, not merely the central 70%) from 1 230 R⊕, all year, on a phone too', () => {
    for (const ms of YEAR) {
      const c = canonical(ms);
      for (const aspect of ASPECTS) {
        for (let d = 1230; d <= STAGE_EDGES.system; d += 25) {
          expect(pairExtent(d, aspect, FOV, c.camDir, c.sunDir), `${new Date(ms).toISOString().slice(0, 10)} aspect ${aspect} at ${d} R⊕`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('the geometric limit: the best possible look-at is ~100–240 R⊕ ahead of the curve: the price of one ramp for every viewport', () => {
    // below ~1 050 R⊕ (desktop) / ~1 170 R⊕ (phone) no look-at at all holds the ~900 R⊕ separation inside 70% of the frame; the
    // curve ends later so that the phone, which needs the Sun alone to hold both only from ~2 300 R⊕, is held too (aspect-
    // aware ramps would buy a desktop ~100 R⊕ and cost a second code path: not taken)
    for (const aspect of ASPECTS) {
      let worstBest = 0;
      let worstCurve = 0;
      for (const ms of YEAR.filter((_, k) => k % 6 === 0)) {
        const c = canonical(ms);
        let best = STAGE_EDGES.handoff;
        for (let d = STAGE_EDGES.system; d >= STAGE_EDGES.handoff; d -= 10) {
          let m = Infinity;
          for (let w = 0; w <= 1 + 1e-9; w += 0.01) m = Math.min(m, pairExtent(d, aspect, FOV, c.camDir, c.sunDir, Math.min(1, w)));
          if (m > FRAME_CENTRAL) { best = d + 10; break; }
        }
        worstBest = Math.max(worstBest, best);
        worstCurve = Math.max(worstCurve, firstHeld(c, aspect, FRAME_CENTRAL));
      }
      expect(worstBest, `aspect ${aspect}`).toBeGreaterThan(1000);
      expect(worstCurve - worstBest, `aspect ${aspect}`).toBeLessThan(260);
    }
  });

  it('the Earth itself stays on screen across the handoff on every viewport and date (its own |NDC| is at most ~0.7)', () => {
    for (const ms of YEAR.filter((_, k) => k % 3 === 0)) {
      const c = canonical(ms);
      for (const aspect of ASPECTS) {
        for (let d = 1000; d <= STAGE_EDGES.system; d += 50) {
          const focus: Vec3 = c.sunDir.map((x) => x * SUN_DIAGRAM_DIST * handoffFocusWeight(d)) as Vec3;
          const p = ndcOf([0, 0, 0], focus, c.camDir, d, aspect, FOV);
          expect(Math.max(Math.abs(p.x), Math.abs(p.y)), `aspect ${aspect} at ${d} R⊕`).toBeLessThanOrEqual(0.7);
        }
      }
    }
  });

  it('once the ramp has ended the Sun is the look-at: it sits at the centre', () => {
    const c = canonical(REF);
    for (const aspect of ASPECTS) {
      const sun: Vec3 = c.sunDir.map((x) => x * SUN_DIAGRAM_DIST) as Vec3;
      const p = ndcOf(sun, sun, c.camDir, STAGE_EDGES.system, aspect, FOV);
      expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-9);
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
