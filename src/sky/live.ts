// The sky's quiet "live" state. Positions are always computed on the client from the generated grids; what "live"
// adds is a witness: while the local ephemeris sidecar answers, the page follows the clock and checks the grids
// against the sidecar's own "now" on a slow poll. Without the sidecar the moment is a snapshot, and says so. The
// degradation is always a labelled state — never silence, never a stale moment dressed as the present.
import type { SkyEphemeris } from './ephemeris';
import { formatMoment } from './card';

export type LiveState =
  /** the sidecar agrees with the grids: the sky follows the clock */
  | { kind: 'live'; checkedAt: number; sunDelta: number; moonDelta: number }
  /** no sidecar to ask: the moment is frozen at `asOf` and computed from the generated grids */
  | { kind: 'snapshot'; asOf: number; why: 'absent' | 'not-local' | 'unreachable' | 'unsupported' }
  /** the sidecar answered but disagrees with the grids: the grids are shown, and the disagreement is stated */
  | { kind: 'diverged'; asOf: number; checkedAt: number; sunDelta: number; moonDelta: number }
  /** the moment lies outside the generated grids: positions hold the nearest sample */
  | { kind: 'beyond'; asOf: number; from: string; to: string };

export interface LiveOptions {
  /** the sidecar's base URL */
  base: string;
  /** whether this page may talk to a local sidecar at all (a deployed site cannot, and does not try) */
  local: boolean;
  fetch?: typeof fetch;
  now?: () => number;
  /** poll period while the sidecar answers, and while it does not (ms) */
  livePeriod?: number;
  idlePeriod?: number;
  timeout?: number;
  onChange?: (state: LiveState) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/** How far the grids may stray from the sidecar's "now" and still be called the same sky (degrees). */
export const LIVE_TOLERANCE = { sun: 0.05, moon: 0.1 } as const;
/** How far the sidecar's clock may stray from this page's before the check is not about the same instant (ms). */
export const LIVE_CLOCK_SKEW = 5 * 60_000;

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export class SkyLive {
  state: LiveState;
  private timer: unknown = null;
  private stopped = true;
  private readonly o: Required<Omit<LiveOptions, 'onChange'>> & Pick<LiveOptions, 'onChange'>;

  constructor(private eph: SkyEphemeris, options: LiveOptions) {
    this.o = {
      fetch: (...a) => globalThis.fetch(...a),
      now: () => Date.now(),
      livePeriod: 60_000,
      idlePeriod: 300_000,
      timeout: 2500,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      ...options,
    };
    this.state = this.initial();
  }

  /** What is true before the sidecar has been asked. */
  private initial(): LiveState {
    const now = this.o.now();
    if (!this.eph.covers(now)) return this.beyond(now);
    return { kind: 'snapshot', asOf: now, why: this.o.local ? 'absent' : 'not-local' };
  }

  private beyond(asOf: number): LiveState {
    return { kind: 'beyond', asOf, from: this.eph.data.meta.span.from.slice(0, 10), to: this.eph.data.meta.span.to.slice(0, 10) };
  }

  /** True while the sky should follow the wall clock. */
  get following(): boolean {
    return this.state.kind === 'live';
  }

  /** The instant to read the sky at: the clock when following, else the moment the snapshot was taken. */
  moment(): number {
    const s = this.state;
    return s.kind === 'live' ? this.o.now() : s.asOf;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    if (!this.o.local) { this.set(this.initial()); return; } // nothing to ask: say so once
    void this.poll();
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) this.o.clearTimer(this.timer);
    this.timer = null;
  }

  /** Ask the sidecar once, settle the state, and schedule the next ask. */
  async poll(): Promise<LiveState> {
    const now = this.o.now();
    let next: LiveState;
    if (!this.eph.covers(now)) {
      next = this.beyond(now);
    } else {
      next = await this.ask(now);
    }
    this.set(next);
    if (!this.stopped) {
      this.timer = this.o.setTimer(() => { void this.poll(); }, next.kind === 'live' || next.kind === 'diverged' ? this.o.livePeriod : this.o.idlePeriod);
    }
    return next;
  }

  private async ask(now: number): Promise<LiveState> {
    const snapshot = (why: 'absent' | 'unreachable' | 'unsupported'): LiveState => ({ kind: 'snapshot', asOf: this.state.kind === 'snapshot' ? this.state.asOf : now, why });
    let res: Response;
    try {
      const ctl = new AbortController();
      const id = this.o.setTimer(() => ctl.abort(), this.o.timeout);
      try { res = await this.o.fetch(`${this.o.base}/now`, { signal: ctl.signal }); } finally { this.o.clearTimer(id); }
    } catch {
      return snapshot('absent');
    }
    if (!res.ok) return snapshot('unreachable');
    let j: { iso?: string; sun?: { lon?: number }; moon?: { lon?: number } };
    try { j = await res.json(); } catch { return snapshot('unsupported'); }
    const at = Date.parse(j.iso ?? '');
    if (!Number.isFinite(at) || typeof j.sun?.lon !== 'number' || typeof j.moon?.lon !== 'number') return snapshot('unsupported');
    // the check is only about the same instant when the two clocks agree
    if (Math.abs(at - now) > LIVE_CLOCK_SKEW) return snapshot('unsupported');
    const sun = this.eph.sunGeo(at);
    const moon = this.eph.moon(at);
    if (!sun || !moon) return this.beyond(now);
    const sunDelta = Math.abs(wrap180(sun.lon - j.sun.lon));
    const moonDelta = Math.abs(wrap180(moon.lon - j.moon.lon));
    if (sunDelta <= LIVE_TOLERANCE.sun && moonDelta <= LIVE_TOLERANCE.moon) return { kind: 'live', checkedAt: at, sunDelta, moonDelta };
    return { kind: 'diverged', asOf: at, checkedAt: at, sunDelta, moonDelta };
  }

  private set(s: LiveState) {
    const changed = JSON.stringify(s) !== JSON.stringify(this.state);
    this.state = s;
    if (changed) this.o.onChange?.(s);
  }
}

const hhmm = (ms: number) => formatMoment(ms).slice(11);
const deg = (d: number) => `${d.toFixed(3)}°`;

/** The sentence the sky wears for a live state: what it is, how it was checked, and when. */
export function describeLive(s: LiveState): { label: string; detail: string } {
  switch (s.kind) {
    case 'live':
      return { label: 'Live', detail: `Following the clock, checked against the sidecar at ${hhmm(s.checkedAt)} (Sun ${deg(s.sunDelta)}, Moon ${deg(s.moonDelta)}).` };
    case 'snapshot': {
      const why = s.why === 'not-local' ? 'The live ephemeris is only reachable when the site runs beside its local sidecar.'
        : s.why === 'unsupported' ? 'The sidecar did not answer as expected.'
        : s.why === 'unreachable' ? 'The ephemeris sidecar answered with an error.'
        : 'The ephemeris sidecar is not running.';
      return { label: 'Snapshot', detail: `Computed from the generated ephemeris as of ${formatMoment(s.asOf)}; it does not follow the clock. ${why}` };
    }
    case 'diverged':
      return { label: 'Snapshot', detail: `Computed from the generated ephemeris as of ${formatMoment(s.asOf)}. The sidecar disagrees with it (Sun ${deg(s.sunDelta)}, Moon ${deg(s.moonDelta)}), so the sky is not called live.` };
    case 'beyond':
      return { label: 'Beyond the generated sky', detail: `${formatMoment(s.asOf)} lies outside ${s.from.slice(0, 4)}–${Number(s.to.slice(0, 4)) - 1}: the bodies hold their nearest generated positions, and the Earth keeps its own light.` };
  }
}
