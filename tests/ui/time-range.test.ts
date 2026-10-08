import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTimeScale } from '../../src/data/time';
import { PLAY_SECONDS, TimeModel } from '../../src/state/timeModel';
import type { Field } from '../../src/types/field';
import type { History } from '../../src/types/history';

const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
const history = JSON.parse(readFileSync(new URL('../../public/data/history.json', import.meta.url), 'utf8')) as History;
const reading = history.readings[0];
const scale = createTimeScale(Math.min(field.meta.yearMin, reading.from), Math.max(field.meta.yearMax, reading.to));

describe('the clock in the real field and Aion ranges', () => {
  it('starts and plays the active Aion reading without traversing the empty surrounding years', () => {
    const time = new TimeModel();
    const lo = scale.toU(reading.from), hi = scale.toU(reading.to);
    time.setRange(lo, hi);
    time.play();
    expect(scale.fromU(time.cursorU)).toBeCloseTo(reading.from);
    time.update(PLAY_SECONDS / 2);
    expect(time.cursorU).toBeCloseTo((lo + hi) / 2);
    time.update(PLAY_SECONDS * 0.6);
    expect(time.playing).toBe(false);
    expect(time.mode).toBe('all');
    expect(scale.fromU(time.cursorU)).toBeCloseTo(reading.to);
  });

  it('restores the normal Earth bounds and clamps scrubbing and requested playback', () => {
    const time = new TimeModel();
    time.setRange(scale.toU(reading.from), scale.toU(reading.to));
    const lo = scale.toU(field.meta.yearMin), hi = scale.toU(field.meta.yearMax);
    time.setRange(lo, hi);
    time.scrub(2); expect(time.cursorU).toBe(hi);
    time.scrub(-1); expect(time.cursorU).toBe(lo);
    time.play(); expect(time.cursorU).toBe(lo);
    time.play(2); expect(time.cursorU).toBe(hi);
  });

  it('opens a historical window at its requested date and resumes paused playback there', () => {
    const time = new TimeModel();
    time.setRange(scale.toU(reading.from), scale.toU(reading.to));
    const mid = (time.fromU + time.toU) / 2;
    time.glideTo(mid);
    expect(time.cursorU).toBe(mid);
    time.play(); time.update(1); time.pause();
    const paused = time.cursorU;
    time.update(3); expect(time.cursorU).toBe(paused);
    time.play(); expect(time.cursorU).toBe(paused);
    time.update(1); expect(time.cursorU).toBeGreaterThan(paused);
  });

  it('refuses malformed bounds without damaging the current range', () => {
    const time = new TimeModel();
    expect(() => time.setRange(0.8, 0.3)).toThrow(RangeError);
    expect(() => time.setRange(NaN, 1)).toThrow(RangeError);
    expect(time.fromU).toBe(0); expect(time.toU).toBe(1);
  });
});
