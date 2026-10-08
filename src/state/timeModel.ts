// The live state behind the time control: "all time" or a moving window.
import { DEFAULT_RAMP, DEFAULT_TRAIL, type TimeWindow } from '../data/time';

export interface TimeSnapshot {
  mode: 'all' | 'cursor';
  cursorU: number;
  trail: number;
  cumulative: boolean;
}

const CUMULATIVE_TRAIL = 3;
export const PLAY_SECONDS = 42;

export class TimeModel {
  mode: 'all' | 'cursor' = 'all';
  cursorU = 1;
  /** where smoothing is heading (== cursorU when scrubbing directly) */
  targetU = 1;
  trail = DEFAULT_TRAIL;
  trailTarget = DEFAULT_TRAIL;
  cumulative = false;
  playing = false;
  /** 0..1 blend between "all" and windowed */
  on = 0;
  /** Active view's bounds in the shared historical scale. */
  fromU = 0;
  toU = 1;
  private listeners = new Set<() => void>();
  private direct = true;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  get window(): TimeWindow {
    return { on: this.on, cursorU: this.cursorU, trail: this.trail, ramp: DEFAULT_RAMP };
  }

  setRange(fromU = 0, toU = 1) {
    if (!Number.isFinite(fromU) || !Number.isFinite(toU) || toU <= fromU) throw new RangeError('Time range must have increasing finite bounds');
    const from = clamp01(fromU), to = clamp01(toU);
    if (to <= from) throw new RangeError('Time range is outside the shared scale');
    this.fromU = from;
    this.toU = to;
    this.cursorU = this.mode === 'all' ? to : this.clampU(this.cursorU);
    this.targetU = this.mode === 'all' ? to : this.clampU(this.targetU);
    this.emit();
  }

  private clampU(u: number) { return Math.max(this.fromU, Math.min(this.toU, u)); }

  /** Immediate move (dragging the handle). */
  scrub(u: number) {
    this.mode = 'cursor';
    this.cursorU = this.targetU = this.clampU(u);
    this.direct = true;
    this.emit();
  }

  /** Smoothed move (tour, search results). */
  glideTo(u: number, trail?: number) {
    if (this.mode === 'all') {
      this.cursorU = this.clampU(u); // start where the new window belongs, avoiding a sweep across all history
    }
    this.mode = 'cursor';
    this.targetU = this.clampU(u);
    if (trail !== undefined) this.trailTarget = trail;
    this.direct = false;
    this.emit();
  }

  setCumulative(on: boolean) {
    this.cumulative = on;
    this.trailTarget = on ? CUMULATIVE_TRAIL : DEFAULT_TRAIL;
    this.emit();
  }

  setAll() {
    this.mode = 'all';
    this.playing = false;
    this.cumulative = false;
    this.trailTarget = DEFAULT_TRAIL;
    this.emit();
  }

  play(startU?: number) {
    if (startU !== undefined || this.mode === 'all' || this.cursorU >= this.toU - (this.toU - this.fromU) * 0.005) {
      this.cursorU = this.targetU = this.clampU(startU ?? this.fromU);
    }
    this.mode = 'cursor';
    this.playing = true;
    this.direct = true;
    this.emit();
  }

  pause() {
    this.playing = false;
    this.emit();
  }

  snapshot(): TimeSnapshot {
    return { mode: this.mode, cursorU: this.cursorU, trail: this.trailTarget, cumulative: this.cumulative };
  }

  restore(s: TimeSnapshot) {
    this.playing = false;
    this.cumulative = s.cumulative;
    if (s.mode === 'all') {
      this.setAll();
    } else {
      this.mode = 'cursor';
      this.targetU = this.clampU(s.cursorU);
      this.trailTarget = s.cumulative ? CUMULATIVE_TRAIL : DEFAULT_TRAIL;
      this.direct = false;
      this.emit();
    }
  }

  update(dt: number) {
    let changed = false;
    if (this.playing) {
      const span = this.toU - this.fromU;
      this.cursorU = this.targetU = this.cursorU + dt * span / PLAY_SECONDS;
      changed = true;
      if (this.cursorU >= this.toU + 0.04 * span) {
        this.cursorU = this.targetU = this.toU;
        this.playing = false;
        this.setAll();
        return;
      }
    } else if (!this.direct && Math.abs(this.targetU - this.cursorU) > 1e-4) {
      this.cursorU += (this.targetU - this.cursorU) * (1 - Math.exp(-dt * 2.4));
      changed = true;
    }
    const tt = this.trailTarget - this.trail;
    if (Math.abs(tt) > 1e-4) {
      this.trail += tt * (1 - Math.exp(-dt * 3));
      changed = true;
    }
    const onT = this.mode === 'cursor' ? 1 : 0;
    if (Math.abs(onT - this.on) > 1e-3) {
      this.on += (onT - this.on) * (1 - Math.exp(-dt * 4));
      changed = true;
    } else this.on = onT;
    if (changed) this.emit();
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
