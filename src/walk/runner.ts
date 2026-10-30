// The Walk runner core (S9). One runner over the ordered stops of a walk (public/data/walks.json): it plans, for each stop,
// the effects the controller executes through its existing entries, keeps {walkId, i}, steps forward and back, and on
// interrupt hands back the snapshot taken when the walk began. Pure: no DOM, no camera, no clock of its own. The controller
// owns the doing (glide the clock, fly the globe, open the page); this module owns the deciding, so the five walk
// mechanisms can read from one place.
//
// A stop's year moves the clock; a stop with no year leaves it alone (the chapters of a book, the Theory route). A place
// flies; a page opens the reading; a subject is focused. The order is the walk's own: nothing here sorts.
import type { Walk, WalkStop } from '../types/walks';
import type { TimeScale } from '../data/time';

export interface WalkPlace { lat: number; lon: number }
export interface WalkPage { work: string; page: number }
/** What a stop names: the walk data's own subject reference (an occurrence, an event, a chapter, a stage, a route stop). */
export type WalkSubject = NonNullable<WalkStop['subject']>;

/**
 * The app's state a walk must give back: the clock (a slider position), what is focused, the reading that was open, where
 * the globe looked, and the walk (if any) that was already running. The controller builds it; the runner copies it.
 */
export interface AppSnapshot {
  u: number;
  focus: { type: string; id: string } | null;
  reading: WalkPage | null;
  centre: WalkPlace | null;
  walk: { walkId: string; i: number } | null;
}

/** What to do for one stop. Every key is present: `null` means "leave it as it is". */
export interface WalkEffects {
  /** the slider position to glide the clock to; null leaves the clock alone */
  setClock: number | null;
  /** where to fly the globe; null does not fly */
  flyTo: WalkPlace | null;
  /** the corpus page to open as the reading; null opens none */
  openPage: WalkPage | null;
  /** the subject the stop names, for the controller to focus through its own entry */
  focus: WalkSubject | null;
}

export interface WalkStep {
  walkId: string;
  i: number;
  count: number;
  first: boolean;
  last: boolean;
  stop: WalkStop;
  effects: WalkEffects;
}

export interface WalkRunnerOptions {
  /** the shared time scale: a stop's year becomes a slider position through it */
  scale: Pick<TimeScale, 'toU'>;
  /** past the last stop comes the first (the Red Book rail does this today); default: the walk ends */
  wrap?: boolean;
}

/** The effects of one stop. A copy: nothing the caller does to the plan reaches the data. */
export function planStop(stop: WalkStop, scale: Pick<TimeScale, 'toU'>): WalkEffects {
  return {
    setClock: stop.year === undefined ? null : scale.toU(stop.year),
    flyTo: stop.place ? { lat: stop.place.lat, lon: stop.place.lon } : null,
    openPage: stop.page ? { work: stop.page.work, page: stop.page.page } : null,
    focus: stop.subject ? { type: stop.subject.type, id: stop.subject.id } : null,
  };
}

export class WalkRunner {
  private walk: Walk | null = null;
  private at = 0;
  private before: AppSnapshot | null = null;

  constructor(private readonly opts: WalkRunnerOptions) {}

  get active(): boolean {
    return this.walk !== null;
  }

  /** {walkId, i} while a walk runs, else null. */
  get position(): { walkId: string; i: number } | null {
    return this.walk ? { walkId: this.walk.id, i: this.at } : null;
  }

  /**
   * Begin a walk at stop `at` (the first, or the one a restored address names). `snapshot` is the app as it stands now; it is
   * kept for `interrupt`. Starting a walk while another runs replaces the walk but keeps the snapshot from before the first,
   * so one interrupt returns the visitor to where they began. An empty walk, or a stop the walk does not have, does not start.
   */
  start(walk: Walk, snapshot: AppSnapshot, at = 0): WalkStep | null {
    if (!walk.stops.length || !Number.isInteger(at) || at < 0 || at >= walk.stops.length) return null;
    if (!this.before) this.before = structuredClone(snapshot);
    this.walk = walk;
    this.at = at;
    return this.step();
  }

  next(): WalkStep | null {
    return this.move(1);
  }

  prev(): WalkStep | null {
    return this.move(-1);
  }

  /** Go to stop `i`; null (and no move) when the walk has no such stop or none is running. */
  goto(i: number): WalkStep | null {
    if (!this.walk || !Number.isInteger(i) || i < 0 || i >= this.walk.stops.length) return null;
    this.at = i;
    return this.step();
  }

  /** The step the runner stands on, without moving. */
  current(): WalkStep | null {
    return this.walk ? this.step() : null;
  }

  /**
   * End the walk and return the app as it was before the first walk began: the controller restores the clock, the focus, the
   * reading and the globe from it. Null when no walk is running.
   */
  interrupt(): AppSnapshot | null {
    if (!this.walk) return null;
    const restore = this.before;
    this.walk = null;
    this.before = null;
    this.at = 0;
    return restore;
  }

  private move(by: 1 | -1): WalkStep | null {
    if (!this.walk) return null;
    const n = this.walk.stops.length;
    let to = this.at + by;
    if (to < 0 || to >= n) {
      if (!this.opts.wrap) return null;
      to = (to + n) % n;
    }
    this.at = to;
    return this.step();
  }

  private step(): WalkStep {
    const walk = this.walk!;
    const stop = walk.stops[this.at];
    return {
      walkId: walk.id,
      i: this.at,
      count: walk.stops.length,
      first: this.at === 0,
      last: this.at === walk.stops.length - 1,
      stop,
      effects: planStop(stop, this.opts.scale),
    };
  }
}
