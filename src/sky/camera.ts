// The sky camera: the one owner of every scripted move between the Earth and the sky. The controller asks for a transition
// and reads `phase`, `key` and `busy`; the rig and the sky layer are driven for sky work from here and nowhere else.
//
// A transition is a run of stages: a timed track that writes the pose each frame, a flight the rig animates itself, a look
// turn that reports back, or a one-shot step. A new request replaces the run, so no stage of the old one runs again and no
// callback of it fires. Every rig callback is also checked against the request's token.
//
// While a track runs the pose is world-space. The rig's (lat, lon, dist) are about its focus, which the layer eases, so a
// track pins the focus to the point the pose is written about (the Earth's centre for the descent and the return, the planet
// for a swing about it) and releases the pin in the step that hands the camera back to the layer. The pin sets the rig's
// focus at once as well: the engine copies the pin into the focus once a frame, which is too late for a drive in the same frame.
import { Vector3 } from 'three';
import { dirFromLatLon, latLonFromDir, type Vec3 } from '../data/geo';
import type { BodyKey } from '../types/sky';
import { composeLook, composeStation, type Frame } from './compose';
import { STAGE_EDGES } from './stages';

export type SkyPhase = 'system' | 'approach' | 'gaze' | 'descend' | 'return' | 'settled';

/** The rig surface the sky camera drives: the subset of CameraRig it uses, so a test can stand a fake in for it. */
export interface RigLike {
  lat: number;
  lon: number;
  dist: number;
  /** the point the pose is written about: the layer's focus, unless pinned */
  readonly focus: Vector3;
  focusPin: Vector3 | null;
  readonly tShiftX: number;
  readonly tShiftY: number;
  readonly flying: boolean;
  readonly gazing: boolean;
  drive(lat: number, lon: number, dist: number, look: Vector3 | null): void;
  lookAtPoint(target: Vector3, opts?: { duration?: number; instant?: boolean; onDone?: () => void }): void;
  recentreLook(opts?: { duration?: number; onDone?: () => void }): void;
  flyTo(lat: number, lon: number, dist: number, opts?: { duration?: number; instant?: boolean; lift?: number }): void;
  snapshot(): { pos: [number, number, number]; look: [number, number, number] };
}

/** The sky layer's surface the sky camera uses. `SkyLayer` reaches it through `beckon`, `setApproach` and `scenePosition`. */
export interface LayerLike {
  readonly approach: number;
  readonly approached: BodyKey | null;
  setApproach(key: BodyKey | null, instant?: boolean): void;
  beckon(key: BodyKey | null, instant?: boolean): void;
  scenePosition(key: BodyKey): Vector3 | null;
  /** the body's radius in Earth radii */
  bodyRadiusR(key: BodyKey): number;
  /** true while the bodies are still sweeping to a new moment (a birth chart's travel): their places are not yet settled */
  readonly travelling: boolean;
}

export interface SkyCameraDeps {
  rig: RigLike;
  layer: () => LayerLike | null;
  frame: () => Frame;
  reduced: boolean;
  /** the camera distance (Earth radii) at which a body's disc fills the view: the approach station's distance */
  approachDist: (key: BodyKey) => number;
  /** the distance of the whole system's canonical home view (or the chart's frame) */
  homeDist: () => number;
  /** the canonical direction of an approach (a body) or of the whole system (null) */
  viewLatLon: (key: BodyKey | null) => { lat: number; lon: number };
  /** the controller writes `document.body.dataset.skyPhase` and the legacy classes from this */
  setPhase: (p: SkyPhase) => void;
}

export interface SkyOpts { instant?: boolean }
/** The Earth-side landing a descent drops onto: its place, its eye distance, and the hover height above it. */
export interface Landing { lat: number; lon: number; dist: number; high: number }

/**
 * Track durations in seconds: the budgets of the choreography. Reduced motion and `instant` take every track at once, so a
 * test or a reduced-motion user gets the finished pose on the same call.
 */
const T = {
  turn: 1.2, travelPlanet: 2.4, travelFromSystem: 2.2, travelHome: 3.2,
  gazeSwing: 1.2, gazeLook: 1.4, cancel: 0.8,
  drop: 3.2, dropLook: 1.0, land: 1.9,
  lift: 1.0, compose: 1.4, hold: 0.25, climb: 2.8, climbLook: 1.4,
} as const;

/**
 * Where the return composes the planet with the Earth: past the sky group's 20 R⊕ gate and the far plane over the outer
 * planets, and where the surface layers (presence markers, tiles) have fully faded (`surfaceWeight` is 0 from 36 R⊕), so the
 * Earth reads as a clean globe rather than clumps of half-faded markers.
 */
const COMPOSE_DIST = STAGE_EDGES.lunar * 0.9;

const ORIGIN: Vec3 = [0, 0, 0];
const add = (p: Vec3, q: Vec3): Vec3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const mul = (p: Vec3, k: number): Vec3 => [p[0] * k, p[1] * k, p[2] * k];
const dot = (p: Vec3, q: Vec3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const norm = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]);
const unit = (p: Vec3): Vec3 => mul(p, 1 / (norm(p) || 1));
const toVec = (p: Vector3): Vec3 => [p.x, p.y, p.z];
const toV = (p: Vec3): Vector3 => new Vector3(p[0], p[1], p[2]);
/**
 * Smoothstep, 0…1: gentle at both ends, and its steepest slope is 1.5. The cubic in-out it replaces peaks at 3, which on a
 * log-radius track that spans a thousandfold (a planet's station to the Earth) lurches at the middle and, on a slow frame,
 * moves the camera by more than a tenth of its distance in one step.
 */
const ease = (t: number): number => t * t * (3 - 2 * t);

/** A direction perpendicular to `a`, for when the arc has no plane of its own. */
const perpendicular = (a: Vec3): Vec3 => unit(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));

/**
 * Great-circle interpolation from `a` to `b` by `e` (0…1). It stays defined for an antipodal pair, where slerp is singular:
 * a camera swung to the far side of the Earth needs its arc. The arc lies in the plane of `a` and `b`, so its end is `b`.
 */
function arc(a: Vec3, b: Vec3, e: number): Vec3 {
  const w = Math.atan2(norm(cross(a, b)), dot(a, b));
  if (w < 1e-9) return a;
  const p0 = sub(b, mul(a, dot(a, b)));
  const p = norm(p0) > 1e-9 ? unit(p0) : perpendicular(a);
  return add(mul(a, Math.cos(w * e)), mul(p, Math.sin(w * e)));
}

/** A point on the Earth-centred polar track: the direction swings along its arc, the radius interpolates in log space. */
function polarPose(dirFrom: Vec3, rFrom: number, dirTo: Vec3, rTo: number, e: number): { dir: Vec3; r: number } {
  return { dir: unit(arc(dirFrom, dirTo, e)), r: Math.exp(Math.log(rFrom) + (Math.log(rTo) - Math.log(rFrom)) * e) };
}

/** The framer's two bodies: the body (a) and the Earth at the origin (b). */
const pairOf = (a: Vec3, aRadius: number, frame: Frame) => ({ a, aRadius, b: ORIGIN, bRadius: 1, frame });

/** Write a pose into the rig: the direction becomes lat/lon, the distance the orbit radius, and the look is held on `look`. */
function aim(rig: RigLike, dir: Vec3, r: number, look: Vector3 | null): void {
  const ll = latLonFromDir(dir);
  rig.drive(ll.lat, ll.lon, r, look);
}

/** One unit of a run. `start` runs once before the first `step`; `step` returns true when the stage is complete. */
interface Stage {
  start?(): void;
  step(dt: number): boolean;
}

interface Run {
  stages: Stage[];
  i: number;
  began: boolean;
  onEnd?: () => void;
}

/** A track of `dur` seconds (a number, or read when it starts). `frame` gets the linear progress 0…1; zero ends at once. */
function timed(dur: number | (() => number), frame: (t: number) => void): Stage {
  let t = 0;
  let d = 0;
  return {
    start() {
      t = 0;
      d = typeof dur === 'number' ? dur : dur();
    },
    step(dt) {
      if (!(d > 0)) {
        frame(1);
        return true;
      }
      t = Math.min(1, t + dt / d);
      frame(t);
      return t >= 1;
    },
  };
}

/** A single step: runs `fn` and ends. */
const once = (fn: () => void): Stage => ({ step: () => { fn(); return true; } });

/** A rig flight: `call` starts it, and the stage ends once the rig has stopped flying (at once when the call was a no-op). */
const flight = (rig: RigLike, call: () => void): Stage => ({ start: call, step: () => !rig.flying });

/** The lift's pose: the camera's direction and distance about the Earth's centre, where it lifts to, and its look. */
interface Lift {
  dir: Vec3;
  r: number;
  to: number;
  look: Vector3;
}

export class SkyCamera {
  private _phase: SkyPhase = 'system';
  private _key: BodyKey | null = null;
  private _busy = false;
  private tok = 0;
  private run: Run | null = null;

  constructor(private readonly deps: SkyCameraDeps) {}

  get phase(): SkyPhase {
    return this._phase;
  }

  /** The body the sky is held on, or null (the whole system, or the Earth). */
  get key(): BodyKey | null {
    return this._key;
  }

  /** True from the first frame of a request to its last callback: the controller's "is the sky being left?" test. */
  get busy(): boolean {
    return this._busy;
  }

  /** Advance the running track by `dt` seconds. Call it once a frame, before the rig's own update, which would otherwise add its inertia to a pose just written. */
  update(dt: number): void {
    if (this.run) this.pump(this.run, dt);
  }

  /**
   * Hold the sky on a body, or on the whole system (null). In the sky a planet is turned to, then travelled to; a planet from
   * another planet is one dolly there (no turn first, no rise); the whole system is one travel home. Near the Earth a body
   * is entered through the ascent, which is the return.
   */
  approach(key: BodyKey | null, opts: SkyOpts = {}): void {
    const layer = this.deps.layer();
    if (!layer) return;
    const rig = this.deps.rig;
    const fast = this.fastOf(opts);
    const tok = ++this.tok;
    // near the Earth is the camera's own distance from it: `rig.dist` is about the rig's focus, which is the held planet while
    // one is held (a station 5 R⊕ from Mars reads "near the Earth" there), and that sent every planet-to-planet pick down the
    // return from the Earth: a lift, a swing about the Earth and a climb, with no turn to the planet. The same holds with the
    // Earth itself held: its station is inside that edge, and a pick from there is a move in the sky, not a return
    if (key && this._key !== 'terra' && norm(rig.snapshot().pos) < STAGE_EDGES.lunar) {
      this.ascend(key, layer, fast);
      return;
    }
    const from = this._key;
    const home = this.deps.homeDist();
    const ll = this.deps.viewLatLon(key);
    // travelling is not stationed: orbits and gaze stand down at once (a held 'gaze' would otherwise survive the move)
    this.setPhase('system');
    if (!key) {
      this._key = null;
      this.begin([
        once(() => { this.pin(null); layer.setApproach(null, fast); }),
        flight(rig, () => rig.flyTo(ll.lat, ll.lon, home, { duration: T.travelHome, instant: fast })),
        once(() => this.setPhase('system')),
      ]);
      return;
    }
    const dest = this.deps.approachDist(key);
    this._key = key;
    if (fast) {
      this.begin([once(() => {
        this.pin(null);
        layer.setApproach(key, true);
        rig.flyTo(ll.lat, ll.lon, dest, { instant: true });
        this.setPhase('approach');
      })]);
      return;
    }
    const planet = layer.scenePosition(key);
    // the Earth is the sky's own origin: one move in to it from wherever the camera stands, never a turn to a point and a flight
    const stages: Stage[] = from || key === 'terra'
      ? this.dollyStages(key, layer, ll, dest, planet)
      : [
        once(() => { this.pin(null); layer.setApproach(key); }),
        ...(planet ? [this.waitFor(tok, (done) => rig.lookAtPoint(planet, { duration: T.turn, onDone: done }))] : []),
        flight(rig, () => rig.flyTo(ll.lat, ll.lon, dest, { duration: T.travelFromSystem, lift: 0 })),
      ];
    stages.push(once(() => this.setPhase('approach')));
    this.begin(stages);
  }

  /**
   * Planet to planet: one move in the sky's own space, a polar track about the new planet — the camera's direction from it
   * swings from where it stands to the station's while its distance closes in log space, so the distance to the planet only
   * ever falls and the camera never rises or passes it. The look turns onto the planet in the first moments and holds it. The
   * pin stands the rig about the origin for the track, so the layer's look-at glide (`setApproach` moves it from one body to
   * the other) is not what carries the camera: the glide, which was, outran the camera's own offset and left the camera past
   * the planet and rising back out to its station. The station is read each frame (the planet moves), and the handoff to the
   * layer is the ascent's (the focus snapped onto the body, the camera driven to the station about it). The camera is already
   * out in the sky and never leaves it: nothing lifts or swings about the Earth.
   */
  private dollyStages(key: BodyKey, layer: LayerLike, ll: { lat: number; lon: number }, dest: number, planet: Vector3 | null): Stage[] {
    const rig = this.deps.rig;
    const va = dirFromLatLon(ll.lat, ll.lon);
    const start = { dir: va, r: dest, lookDir: va };
    let target: Vec3 = planet ? toVec(planet) : ORIGIN;
    const readTarget = (): Vec3 => {
      const p = layer.scenePosition(key);
      if (p) target = toVec(p);
      return target;
    };
    return [
      once(() => {
        const s0 = rig.snapshot();
        const off = sub([s0.pos[0], s0.pos[1], s0.pos[2]], readTarget());
        // (the Earth is closed on from either side: the camera may stand nearer it than its station, and a floor at the station
        // would throw it out to the station in the first frame)
        start.r = key === 'terra' ? Math.max(1.2, norm(off)) : Math.max(dest, norm(off));
        start.dir = norm(off) > 1e-9 ? unit(off) : va;
        // the look is turned as a direction from the camera, not as a point: the old look point is a few radii away (the held
        // planet's station), so a blend of the two points would swing the view through most of a turn in its first frames
        const ld = sub([s0.look[0], s0.look[1], s0.look[2]], [s0.pos[0], s0.pos[1], s0.pos[2]]);
        start.lookDir = norm(ld) > 1e-9 ? unit(ld) : mul(start.dir, -1);
        this.pin(ORIGIN);
        layer.setApproach(key);
      }),
      timed(T.travelPlanet, (t) => {
        const P = readTarget();
        const p = polarPose(start.dir, start.r, va, dest, ease(t));
        const pos = add(P, mul(p.dir, p.r));
        const to = sub(P, pos);
        const turned = unit(arc(start.lookDir, norm(to) > 1e-9 ? unit(to) : start.lookDir, ease(Math.min(1, (t * T.travelPlanet) / T.turn))));
        aim(rig, unit(pos), norm(pos), toV(add(pos, mul(turned, Math.max(1, norm(to))))));
      }),
      once(() => {
        this.pin(readTarget());
        rig.drive(ll.lat, ll.lon, dest, null);
        this.pin(null);
        layer.setApproach(key, true);
      }),
    ];
  }

  /**
   * Turn from the held planet so that the planet and the Earth both sit in the frame. The camera does not translate: it turns,
   * unless no turn frames the pair, and then it swings about the planet at constant distance by the smallest angle that does.
   * Only from 'approach' with nothing else running. `onSettled` fires once the turn has arrived.
   */
  gaze(onSettled?: () => void): void {
    const layer = this.deps.layer();
    const held = this._key;
    const p0 = layer && held ? layer.scenePosition(held) : null;
    if (!layer || !held || !p0 || this._phase !== 'approach' || this._busy) return;
    const rig = this.deps.rig;
    const radius = layer.bodyRadiusR(held);
    let planet = toVec(p0);
    const readPlanet = (): Vec3 => {
      const p = layer.scenePosition(held);
      if (p) planet = toVec(p);
      return planet;
    };
    const tok = ++this.tok;
    const swing = { dir0: ORIGIN, dirS: ORIGIN, dist: 1, dur: 0, on: false };
    this.setPhase('gaze');
    this.begin([
      once(() => {
        const a = readPlanet();
        const cam = rig.snapshot().pos;
        if (composeLook({ cam, ...pairOf(a, radius, this.deps.frame()) }).ok) return;
        const off = sub(cam, a);
        const dist = norm(off);
        const st = composeStation({ ...pairOf(a, radius, this.deps.frame()), center: a, dist, currentDir: unit(off) });
        if (!st.ok) console.warn('sky camera: no station frames the planet and the Earth', { held, swingDeg: st.swingDeg });
        Object.assign(swing, { dir0: unit(off), dirS: st.dir, dist, dur: Math.min(T.gazeSwing, 0.4 + st.swingDeg / 150), on: true });
        this.pin(a);
      }),
      timed(() => (this.deps.reduced ? 0 : swing.dur), (t) => {
        if (!swing.on) return;
        this.pin(readPlanet());
        const ll = latLonFromDir(arc(swing.dir0, swing.dirS, ease(t)));
        rig.drive(ll.lat, ll.lon, swing.dist, null);
      }),
      this.waitFor(tok, (done) => {
        const a = readPlanet();
        const c = composeLook({ cam: rig.snapshot().pos, ...pairOf(a, radius, this.deps.frame()) });
        if (!c.ok) console.warn('sky camera: the gaze does not frame the planet and the Earth', { held, sepDeg: c.sepDeg, ndcA: c.ndcA, ndcB: c.ndcB });
        rig.lookAtPoint(toV(c.look), { duration: T.gazeLook, instant: this.deps.reduced, onDone: done });
      }),
    ], onSettled);
  }

  /** End a gaze: the look eases back onto the held planet and the camera stays where it is. Phase 'approach'. */
  cancelGaze(): void {
    if (this._phase !== 'gaze') return;
    const tok = ++this.tok;
    const rig = this.deps.rig;
    this.begin([
      this.waitFor(tok, (done) => rig.recentreLook({ duration: this.deps.reduced ? 0 : T.cancel, onDone: done })),
      once(() => { this.pin(null); this.setPhase('approach'); }),
    ]);
  }

  /**
   * Leave the sky for the Earth: an Earth-centred polar drop from where the camera is to the landing, with the focus pinned to
   * the Earth's centre and the look held on it. Phase 'descend' at once, 'settled' when the camera stands on the landing;
   * `onLanded` then fires once. The controller shows its chrome in `onLanded`, not before.
   */
  descend(land: Landing, opts: SkyOpts, onLanded: () => void): void {
    const layer = this.deps.layer();
    if (!layer) return;
    const rig = this.deps.rig;
    const fast = this.fastOf(opts);
    const dirL = dirFromLatLon(land.lat, land.lon);
    const from: Lift = { dir: ORIGIN, r: 1, to: land.high, look: new Vector3() };
    ++this.tok;
    this._key = null;
    this.setPhase('descend');
    this.begin([
      once(() => {
        const s = rig.snapshot();
        from.dir = unit(s.pos);
        from.r = norm(s.pos);
        from.look = toV(s.look);
        this.pin(ORIGIN);
        layer.setApproach(null, fast);
      }),
      timed(fast ? 0 : T.drop, (t) => {
        const p = polarPose(from.dir, from.r, dirL, land.high, ease(t));
        aim(rig, p.dir, p.r, from.look.clone().lerp(new Vector3(), ease(Math.min(1, (t * T.drop) / T.dropLook))));
      }),
      timed(fast ? 0 : T.land, (t) => {
        const p = polarPose(dirL, land.high, dirL, land.dist, ease(t));
        aim(rig, p.dir, p.r, new Vector3());
      }),
      once(() => {
        this.pin(null);
        layer.setApproach(null, true);
        rig.drive(land.lat, land.lon, land.dist, null);
        this.setPhase('settled');
      }),
    ], onLanded);
  }

  /**
   * The return to a body: the literal inverse of the descent. A lift from the Earth, a swing about the Earth until the planet
   * and the Earth share the frame, a climb along the Earth-centred track to the body's approach station, then the layer takes
   * the camera (`approach`). `onDone` fires on arrival.
   */
  returnToSky(key: BodyKey, opts: SkyOpts = {}, onDone?: () => void): void {
    const layer = this.deps.layer();
    if (!layer) return;
    ++this.tok;
    this.ascend(key, layer, this.fastOf(opts), onDone);
  }

  /** Enter the sky from near the Earth: the return to a body, or for the whole system a lift and one travel home. */
  enter(key: BodyKey | null, opts: SkyOpts = {}): void {
    const layer = this.deps.layer();
    if (!layer) return;
    if (key) {
      this.returnToSky(key, opts);
      return;
    }
    ++this.tok;
    const rig = this.deps.rig;
    const fast = this.fastOf(opts);
    const home = this.deps.homeDist();
    const ll = this.deps.viewLatLon(null);
    const lift: Lift = { dir: ORIGIN, r: 1, to: 1, look: new Vector3() };
    this._key = null;
    this.setPhase('return');
    this.begin([
      ...this.liftStages(fast, lift, null, layer),
      once(() => this.pin(null)),
      flight(rig, () => rig.flyTo(ll.lat, ll.lon, home, { duration: T.travelHome, instant: fast })),
      once(() => this.setPhase('system')),
    ]);
  }

  /** Let the sky go: the layer lets its focus and its body go, the pin is released, phase 'system'. Any running track is dropped. */
  release(): void {
    ++this.tok;
    this.run = null;
    this._busy = false;
    this.pin(null);
    this._key = null;
    const layer = this.deps.layer();
    layer?.setApproach(null);
    layer?.beckon(null, true);
    this.setPhase('system');
  }

  /** Pointer or wheel input. It is ignored while a descent or a return drives the camera; during a gaze it cancels the gaze. */
  onUserGrab(): void {
    if (this._phase === 'gaze') this.cancelGaze();
  }

  /** The ascent into a body, shared by the return and the approach from near the Earth. */
  private ascend(key: BodyKey, layer: LayerLike, fast: boolean, onDone?: () => void): void {
    if (key === 'terra') {
      this.earthStation(layer, fast, onDone);
      return;
    }
    const rig = this.deps.rig;
    const v = this.deps.viewLatLon(key);
    const dAp = this.deps.approachDist(key);
    const va = dirFromLatLon(v.lat, v.lon);
    this._key = key;
    this.setPhase('return');
    const lift: Lift = { dir: ORIGIN, r: 1, to: 1, look: new Vector3() };
    const comp = { dirS: ORIGIN, stationPos: ORIGIN, look0: new Vector3(), lookC: new Vector3() };
    let planet: Vec3 = ORIGIN;
    const readPlanet = (): Vec3 => {
      const p = layer.scenePosition(key);
      if (p) planet = toVec(p);
      return planet;
    };
    /** the planet-centred look for the station: the composed look, read each frame from the planet's current place */
    const target = (): Vector3 => toV(composeLook({ cam: comp.stationPos, ...pairOf(readPlanet(), layer.bodyRadiusR(key), this.deps.frame()) }).look);
    this.begin([
      ...this.liftStages(fast, lift, key, layer),
      // the station is framed on the planet's place, so it waits for the sky to be still: a birth chart's travel (2.6 s)
      // can still be sweeping the bodies from the field's sky when the lift ends, and a station framed on a place in transit
      // misses the planet once it has arrived (scenario D: the planet ended 71° off the station's frame)
      { step: () => fast || !layer.travelling },
      once(() => {
        const st = composeStation({ ...pairOf(readPlanet(), layer.bodyRadiusR(key), this.deps.frame()), center: ORIGIN, dist: lift.to, currentDir: lift.dir });
        comp.dirS = st.dir;
        comp.stationPos = mul(st.dir, lift.to);
        comp.look0 = toV(rig.snapshot().look);
      }),
      timed(fast ? 0 : T.compose, (t) => {
        aim(rig, unit(arc(lift.dir, comp.dirS, ease(t))), lift.to, comp.look0.clone().lerp(target(), ease(t)));
      }),
      timed(fast ? 0 : T.hold, () => aim(rig, comp.dirS, lift.to, target())),
      once(() => {
        const c = composeLook({ cam: comp.stationPos, ...pairOf(readPlanet(), layer.bodyRadiusR(key), this.deps.frame()) });
        if (!c.ok) console.warn('sky camera: the return does not frame the planet and the Earth', { key, sepDeg: c.sepDeg, ndcA: c.ndcA, ndcB: c.ndcB, behind: c.behind, occluded: c.occluded });
        comp.lookC = toV(c.look);
        layer.setApproach(key, fast);
      }),
      timed(fast ? 0 : T.climb, (t) => {
        const P = readPlanet();
        const w = add(P, mul(va, dAp));
        const p = polarPose(comp.dirS, lift.to, unit(w), norm(w), ease(t));
        aim(rig, p.dir, p.r, comp.lookC.clone().lerp(toV(P), ease(Math.min(1, (t * T.climb) / T.climbLook))));
      }),
      once(() => {
        this.pin(readPlanet());
        rig.drive(v.lat, v.lon, dAp, null);
        this.pin(null);
        layer.setApproach(key, true);
        layer.beckon(null, true);
        this.setPhase('approach');
      }),
    ], onDone);
  }

  /**
   * Hold the Earth. It is the sky's own origin, so there is nothing to lift to or to compose it with: the camera closes on it
   * from where it stands (the Field's globe, a planet's station, the whole sky) in one polar track about its centre, to the
   * station where its disc fills the view as a planet's does. Phase 'return' while it travels, 'approach' on arrival.
   */
  private earthStation(layer: LayerLike, fast: boolean, onDone?: () => void): void {
    const rig = this.deps.rig;
    const ll = this.deps.viewLatLon('terra');
    const dest = this.deps.approachDist('terra');
    this._key = 'terra';
    this.setPhase('return');
    const stages: Stage[] = fast
      ? [once(() => {
        this.pin(null);
        layer.setApproach('terra', true);
        layer.beckon(null, true);
        rig.flyTo(ll.lat, ll.lon, dest, { instant: true });
      })]
      : this.dollyStages('terra', layer, ll, dest, null);
    stages.push(once(() => { layer.beckon(null, true); this.setPhase('approach'); }));
    this.begin(stages, onDone);
  }

  /** The lift from the present pose to a little above the Earth, pinned about the Earth's centre. It is the first step of every ascent. */
  private liftStages(fast: boolean, lift: Lift, beckon: BodyKey | null, layer: LayerLike): Stage[] {
    const rig = this.deps.rig;
    return [
      once(() => {
        const s = rig.snapshot();
        lift.dir = unit(s.pos);
        lift.r = norm(s.pos);
        lift.look = toV(s.look);
        // entering the sky for a body: the lift goes far enough that the sky layer draws the planet (the group shows beyond 20
        // R⊕ and the far plane reaches the outer planets by ~30), or "turn so the planet and the Earth share the frame" would
        // be a turn with nothing to see; a whole-sky entry only needs a clean turn, as it always had
        lift.to = beckon
          ? Math.max(lift.r, COMPOSE_DIST)
          : Math.max(lift.r, Math.min(Math.max(lift.r * 1.55, lift.r + 0.55), STAGE_EDGES.lunar * 0.85));
        this.pin(ORIGIN);
        layer.beckon(beckon, fast);
      }),
      timed(fast ? 0 : T.lift, (t) => {
        const e = ease(t);
        const p = polarPose(lift.dir, lift.r, lift.dir, lift.to, e);
        aim(rig, p.dir, p.r, lift.look.clone().lerp(new Vector3(), e));
      }),
    ];
  }

  /**
   * A stage that ends when the rig calls back. `start` gets the `done` it must hand the rig; a `done` from a superseded
   * request is ignored.
   */
  private waitFor(tok: number, start: (done: () => void) => void): Stage {
    let fin = false;
    return {
      start: () => {
        fin = false;
        start(() => { if (tok === this.tok) fin = true; });
      },
      step: () => fin,
    };
  }

  /** Pin the focus to `p` (the rig's focus too, so a drive in this frame stands about it), or release the pin to the layer. */
  private pin(p: Vec3 | null): void {
    const rig = this.deps.rig;
    if (!p) {
      rig.focusPin = null;
      return;
    }
    rig.focus.set(p[0], p[1], p[2]);
    rig.focusPin = rig.focus.clone();
  }

  private fastOf(opts: SkyOpts): boolean {
    return !!opts.instant || this.deps.reduced;
  }

  private setPhase(p: SkyPhase): void {
    this._phase = p;
    this.deps.setPhase(p);
  }

  private begin(stages: Stage[], onEnd?: () => void): void {
    const run: Run = { stages, i: 0, began: false, onEnd };
    this.run = run;
    this._busy = true;
    this.pump(run, 0);
  }

  /** Run stages from the current one. A stage that ends hands over within the same call, so zero-length tracks finish at once. */
  private pump(run: Run, dt: number): void {
    while (this.run === run) {
      if (run.i >= run.stages.length) {
        this.run = null;
        this._busy = false;
        run.onEnd?.();
        return;
      }
      const s = run.stages[run.i];
      if (!run.began) {
        run.began = true;
        s.start?.();
        if (this.run !== run) return;
      }
      if (!s.step(dt)) return;
      run.i++;
      run.began = false;
    }
  }
}
