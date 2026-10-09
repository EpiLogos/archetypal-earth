import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RAMP,
  DEFAULT_TRAIL,
  EMERGE_RAMPS,
  GHOST_ALPHA,
  STANDING_REL,
  effectiveVisibility,
  presenceCurve,
  presenceState,
  presenceWeights,
  standingWeight,
  timeVisibility,
  type TimeWindow,
} from '../../src/data/time';

const E = DEFAULT_RAMP * EMERGE_RAMPS; // emergence length in u
const DISSOLVE_START = DEFAULT_TRAIL * 0.55;
const win = (cursorU: number, on = 1): TimeWindow => ({ on, cursorU, trail: DEFAULT_TRAIL, ramp: DEFAULT_RAMP });
/** a node at u = 0, seen when the cursor is at d (so d = cursor - u) */
const at = (d: number, rel = 1, on = 1) => presenceWeights(d, win(d, on), rel);

describe('T2: standing occurrences are never time-gated', () => {
  it('the emphasis threshold: related (1.5) stays time-gated, standing (1.55) is ungated', () => {
    expect(STANDING_REL).toBe(1.55);
    expect(standingWeight(1.5)).toBe(0);
    expect(standingWeight(1.52)).toBe(0);
    expect(standingWeight(1.55)).toBe(1);
    expect(standingWeight(1.6)).toBe(1);
    expect(standingWeight(2.4)).toBe(1);
    const mid = standingWeight(1.535);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('truth table: effectiveVisibility(vis, rel)', () => {
    const vis = [0, 0.2, 0.5, 1];
    // ordinary rel: visibility is passed through unchanged
    for (const rel of [0, 0.07, 1, 1.5]) for (const v of vis) expect(effectiveVisibility(v, rel)).toBe(v);
    // standing rel: always 1, whatever the time visibility
    for (const rel of [1.55, 1.6, 2.4]) for (const v of vis) expect(effectiveVisibility(v, rel)).toBe(1);
    // exact threshold: 1.549 is still partly gated, 1.55 is not
    expect(effectiveVisibility(0, 1.549)).toBeLessThan(1);
    expect(effectiveVisibility(0, 1.55)).toBe(1);
  });

  it('is monotone in emphasis, so easing emphasis up never pulls a node back out', () => {
    let prev = -1;
    for (let r = 0.9; r <= 2.4; r += 0.002) {
      const e = effectiveVisibility(0, r);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });

  it('a standing occurrence stays visible at every cursor position', () => {
    for (let u = 0; u <= 1; u += 0.05) {
      for (let c = 0; c <= 1; c += 0.05) {
        expect(effectiveVisibility(timeVisibility(u, win(c)), 1.6)).toBe(1);
      }
    }
  });

  it('a standing occurrence has no time curve: present, no pinprick, no dot, no ring at any d', () => {
    for (const d of [-0.5, -0.02, 0, E / 2, 0.06, 0.12, 0.3, 0.9]) {
      const s = at(d, 1.6);
      expect(s.arrive).toBe(1);
      expect(s.leave).toBe(0);
      expect(s.present).toBe(1);
      expect(s.ring).toBe(0);
      expect(s.pin).toBe(0);
      expect(s.after).toBe(0);
    }
  });

  it('an ordinary related occurrence (1.5) keeps its time gate', () => {
    expect(at(-0.02, 1.5).pin).toBe(1);
    expect(at(0.3, 1.5).after).toBe(1);
  });
});

describe('T1: the lifecycle by d', () => {
  it('classifies the five phases, with half-open boundaries', () => {
    const s = (d: number) => presenceState(d, win(0));
    expect(s(-1e-9)).toBe('notYet');
    expect(s(-0.5)).toBe('notYet');
    expect(s(0)).toBe('emerging');
    expect(s(E - 1e-9)).toBe('emerging');
    expect(s(E)).toBe('live');
    expect(s(DISSOLVE_START - 1e-9)).toBe('live');
    expect(s(DISSOLVE_START)).toBe('dissolving');
    expect(s(DEFAULT_TRAIL - 1e-9)).toBe('dissolving');
    expect(s(DEFAULT_TRAIL)).toBe('after');
    expect(s(0.5)).toBe('after');
  });

  it('pins the curve at its boundaries', () => {
    expect(presenceCurve(0, win(0), 1)).toMatchObject({ arrive: 0, leave: 0, ring: 0 });
    expect(presenceCurve(E, win(E), 1).arrive).toBe(1);
    expect(presenceCurve(E, win(E), 1).ring).toBe(0);
    expect(presenceCurve(DISSOLVE_START, win(0), 1).leave).toBe(0);
    expect(presenceCurve(DEFAULT_TRAIL, win(0), 1).leave).toBe(1);
  });

  it('not yet: absent (no presence, pinprick weight 1, no ring)', () => {
    const w = at(-0.02);
    expect(w.present).toBe(0);
    expect(w.pin).toBe(1);
    expect(w.alpha).toBe(0);
    expect(w.after).toBe(0);
    expect(w.ring).toBe(0);
  });

  it('emergence: one ring grows from the core outward, and fades to nothing at the end', () => {
    const mid = at(E / 2);
    expect(mid.ring).toBeGreaterThan(0.2);
    expect(mid.ringR).toBeCloseTo(1 - Math.pow(0.5, 3), 10);
    let prevR = -1;
    let peakD = 0;
    let peak = 0;
    for (let i = 0; i <= 200; i++) {
      const d = (E * i) / 200;
      const s = at(d);
      expect(s.ringR).toBeGreaterThanOrEqual(prevR);
      prevR = s.ringR;
      if (s.ring > peak) { peak = s.ring; peakD = d; }
    }
    expect(peakD).toBeGreaterThan(0);
    expect(peakD).toBeLessThan(E);
    expect(at(E).ring).toBe(0);
    expect(at(E * 0.999).ring).toBeLessThan(0.02);
  });

  it('live: fully present, no pin, no dot, no ring', () => {
    for (const d of [E, (E + DISSOLVE_START) / 2, DISSOLVE_START - 1e-6]) {
      const w = at(d);
      expect(w.present).toBe(1);
      expect(w.pin).toBe(0);
      expect(w.after).toBe(0);
      expect(w.ring).toBe(0);
    }
  });

  it('dissolution: presence falls and the warm dot takes over', () => {
    const a = at(DISSOLVE_START + 0.01);
    const b = at(DEFAULT_TRAIL - 0.01);
    expect(a.present).toBeGreaterThan(b.present);
    expect(a.after).toBeLessThan(b.after);
    expect(b.present).toBeLessThan(0.1);
  });

  it('after: a small warm dot, no live presence, no ring, no pinprick', () => {
    const w = at(0.5);
    expect(w.present).toBe(0);
    expect(w.after).toBe(1);
    expect(w.pin).toBe(0);
    expect(w.alpha).toBe(0);
    expect(w.ring).toBe(0);
  });

  it('distinct: not-yet and after are different states (cool pinprick vs warm dot), and both differ from attentional absence', () => {
    const notYet = at(-0.02);
    const after = at(0.5);
    const receded = at(0.05, 0.07); // present in the window, but outside the focus
    expect(notYet.pin).toBe(1);
    expect(after.after).toBe(1);
    expect(receded.focus).toBe(0);
    expect(receded.after).toBe(0);
    expect(receded.pin).toBe(0);
    expect(receded.alpha).toBeCloseTo(GHOST_ALPHA, 10);
  });

  it('temporal absence wins over attentional absence: a receded node before its date shows the pinprick, not the ring', () => {
    const w = at(-0.02, 0.07);
    expect(w.pin).toBe(1);
    expect(w.alpha).toBe(0);
  });

  it('continuity: sampling d densely, no component jumps', () => {
    const keys = ['arrive', 'leave', 'ring', 'ringR', 'present', 'alpha', 'pin', 'after'] as const;
    const step = 1e-4;
    let prev = at(-0.06);
    for (let d = -0.06 + step; d <= 0.25; d += step) {
      const cur = at(d);
      for (const k of keys) expect(Math.abs(cur[k] - prev[k]), `${k} at d=${d.toFixed(4)}`).toBeLessThan(0.02);
      prev = cur;
    }
  });

  it('continuity in emphasis: easing rel from 1 to 1.7 never jumps a node', () => {
    const keys = ['arrive', 'leave', 'present', 'alpha', 'pin', 'after'] as const;
    for (const d of [-0.02, 0.05, 0.12, 0.3]) {
      let prev = at(d, 1);
      for (let r = 1 + 1e-3; r <= 1.7; r += 1e-3) {
        const cur = at(d, r);
        for (const k of keys) expect(Math.abs(cur[k] - prev[k]), `${k} at d=${d}, rel=${r.toFixed(3)}`).toBeLessThan(0.06);
        prev = cur;
      }
    }
  });

  it('scrubbing either way retraces the same curve (the curve depends on d alone)', () => {
    // one node at u = 0.45; the cursor visits the same positions going out and coming back
    const path = Array.from({ length: 21 }, (_, i) => 0.4 + i * 0.01);
    const atCursor = (c: number) => presenceWeights(c - 0.45, win(c), 1);
    const out = path.map(atCursor);
    const back = [...path].reverse().map(atCursor).reverse();
    expect(back).toEqual(out);
  });
});

describe('all time (uTimeOn = 0): unchanged from before', () => {
  it('the time visibility is 1 everywhere, and the attentional alpha is the old mix', () => {
    expect(timeVisibility(0.1, win(0.5, 0))).toBe(1);
    for (const d of [-0.5, -0.02, 0, 0.05, 0.2, 0.9]) {
      const w = at(d, 1, 0);
      expect(w.arrive).toBe(1);
      expect(w.leave).toBe(0);
      expect(w.ring).toBe(0);
      expect(w.present).toBe(1);
      expect(w.pin).toBe(0);
      expect(w.after).toBe(0);
    }
  });

  it('matches the old presence formula: alpha = mix(0.32, 1, focus), and the receded ghost keeps 0.32', () => {
    for (const rel of [0.07, 0.3, 0.6, 1, 1.5, 2.4]) {
      const focus = Math.min(1, Math.max(0, (rel - 0.42) / 0.36));
      const t = focus * focus * (3 - 2 * focus);
      const oldAlpha = 0.32 + (1 - 0.32) * t; // mix(ghostA, 1, live) with ghostA = 0.32 and live = focus
      expect(at(0.5, rel, 0).alpha).toBeCloseTo(oldAlpha, 9);
    }
    expect(at(0.5, 0.07, 0).alpha).toBeCloseTo(GHOST_ALPHA, 10);
  });
});

describe('GLSL mirror guard', () => {
  // The vertex shader's constants must match these, or the two halves of the lifecycle drift apart.
  const src = readFileSync(new URL('../../src/globe/shaders.ts', import.meta.url), 'utf8');
  it('carries the same constants as the CPU mirror', () => {
    expect(src).toContain('float standingWeight(float rel) {\n  return smoothstep(1.52, 1.55, rel);');
    expect(src).toContain('float e = uRamp * 1.5;');
    expect(src).toContain('float leave = smoothstep(uTrail * 0.55, uTrail, d);');
    expect(src).toContain('float ring = smoothstep(0.0, 0.3, t) * pow(1.0 - t, 1.5);');
    expect(src).toContain('float ringR = 1.0 - pow(1.0 - t, 3.0);');
    expect(src).toContain('float fl = 1.0 + 0.5 * flare;');
    expect(src).toContain('mix(0.32, 1.0, focus)');
    expect(src).toContain('vec4 presenceCurve(float u, float rel) {');
  });
});
