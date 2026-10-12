import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { SkyCamera, type LayerLike, type RigLike, type SkyPhase } from '../../src/sky/camera';
import { composeLook, projectNdc, type Frame } from '../../src/sky/compose';
import { dirFromLatLon, latLonFromDir, type Vec3 } from '../../src/data/geo';
import type { BodyKey } from '../../src/types/sky';

// A scene in Earth radii: the Earth at the origin, one planet at ~950 R⊕ with its approach station 40 R⊕ from it.
const PLANET: Vec3 = [900, 0, 300];
const PLANET_R = 11;
const DIST_AP = 40;
const VIEW = { lat: 34, lon: 200 };
const KEY = 'saturn' as BodyKey;
const DESK: Frame = { fovDeg: 45, aspect: 1.6, shiftX: 0, shiftY: 0, margin: 0.78 };
const DT = 1 / 60;
const LAND = { lat: 10, lon: 40, dist: 2.25, high: 3.4 };

const norm = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]);
const unit = (p: Vec3): Vec3 => { const l = norm(p); return [p[0] / l, p[1] / l, p[2] / l]; };
const dist3 = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The approach station: the planet plus DIST_AP along the view direction the controller would use. */
const stationAp = (): Vec3 => {
  const d = dirFromLatLon(VIEW.lat, VIEW.lon);
  return [PLANET[0] + DIST_AP * d[0], PLANET[1] + DIST_AP * d[1], PLANET[2] + DIST_AP * d[2]];
};

/** A station about the planet at DIST_AP, in a direction `theta` from the planet's Earth-facing axis and azimuth `phi`. */
function stationAt(theta: number, phi: number): Vec3 {
  const u = unit(PLANET);
  const e1: Vec3 = [0, 1, 0];
  const e2: Vec3 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const t = (theta * Math.PI) / 180;
  const p = (phi * Math.PI) / 180;
  const d: Vec3 = [0, 1, 2].map((i) => Math.cos(t) * u[i] + Math.sin(t) * (Math.cos(p) * e1[i] + Math.sin(p) * e2[i])) as Vec3;
  return [PLANET[0] + DIST_AP * d[0], PLANET[1] + DIST_AP * d[1], PLANET[2] + DIST_AP * d[2]];
}

/** A station that frames the pair by turning alone (found by a fixed scan), so a gaze needs no swing. */
function framedStation(): Vec3 {
  for (let theta = 20; theta <= 60; theta += 2) {
    for (let phi = 0; phi < 360; phi += 15) {
      const s = stationAt(theta, phi);
      if (composeLook({ cam: s, a: PLANET, aRadius: PLANET_R, b: [0, 0, 0], bRadius: 1, frame: DESK }).ok) return s;
    }
  }
  throw new Error('no turn-only station in the scan');
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A rig that keeps the real rig's pose semantics: position = focus + dir(lat, lon)·dist, a held or a centred look. */
class FakeRig implements RigLike {
  lat = 0;
  lon = 0;
  dist = 1;
  readonly focus = new Vector3();
  focusPin: Vector3 | null = null;
  tShiftX = 0;
  tShiftY = 0;
  flying = false;
  gazing = false;
  private readonly look = new Vector3();
  private lookTracks = true;
  private fly: { t: number; dur: number; from: number[]; to: number[] } | null = null;
  private turn: { t: number; dur: number; from: Vector3; to: Vector3 | null; done?: () => void } | null = null;

  constructor(readonly log: string[]) {}

  pose(): [number, number, number] {
    const d = dirFromLatLon(this.lat, this.lon);
    return [this.focus.x + d[0] * this.dist, this.focus.y + d[1] * this.dist, this.focus.z + d[2] * this.dist];
  }

  drive(lat: number, lon: number, dist: number, look: Vector3 | null): void {
    this.log.push('drive');
    this.fly = null;
    this.flying = false;
    this.turn = null;
    this.lat = lat;
    this.lon = lon;
    this.dist = dist;
    this.lookTracks = look === null;
    this.look.copy(look ?? this.focus);
  }

  lookAtPoint(target: Vector3, opts: { duration?: number; instant?: boolean; onDone?: () => void } = {}): void {
    this.log.push('lookAt');
    this.startTurn(target.clone(), opts.instant ? 0 : (opts.duration ?? 1.5), opts.onDone);
  }

  recentreLook(opts: { duration?: number; onDone?: () => void } = {}): void {
    this.log.push('recentre');
    this.startTurn(null, opts.duration ?? 0.7, opts.onDone);
  }

  flyTo(lat: number, lon: number, dist: number, opts: { duration?: number; instant?: boolean; lift?: number } = {}): void {
    this.log.push('flyTo');
    this.startTurn(null, 0.6);
    if (opts.instant) {
      this.lat = lat;
      this.lon = lon;
      this.dist = dist;
      this.fly = null;
      this.flying = false;
      this.lookTracks = true;
      return;
    }
    this.fly = { t: 0, dur: opts.duration ?? 2, from: [this.lat, this.lon, this.dist], to: [lat, lon, dist] };
    this.flying = true;
  }

  snapshot(): { pos: [number, number, number]; look: [number, number, number] } {
    const l = this.lookTracks ? this.focus : this.look;
    return { pos: this.pose(), look: [l.x, l.y, l.z] };
  }

  /** The rig's own per-frame work, for flights and look turns (a drive cancels both, as the real one does). */
  update(dt: number): void {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = ease(f.t);
      this.lat = lerp(f.from[0], f.to[0], e);
      this.lon = lerp(f.from[1], f.to[1], e);
      this.dist = lerp(f.from[2], f.to[2], e);
      if (f.t >= 1) {
        this.fly = null;
        this.flying = false;
      }
    }
    if (this.turn) {
      const tn = this.turn;
      tn.t = Math.min(1, tn.t + dt / tn.dur);
      this.look.lerpVectors(tn.from, tn.to ?? this.focus, ease(tn.t));
      if (tn.t >= 1) {
        this.turn = null;
        this.lookTracks = tn.to === null;
        tn.done?.();
      }
    }
  }

  private startTurn(to: Vector3 | null, dur: number, done?: () => void): void {
    const from = this.lookTracks ? this.focus.clone() : this.look.clone();
    this.look.copy(from);
    this.lookTracks = false;
    if (dur <= 0) {
      this.turn = null;
      if (to) this.look.copy(to);
      else this.look.copy(this.focus);
      this.lookTracks = to === null;
      done?.();
      return;
    }
    this.turn = { t: 0, dur, from, to, done };
  }
}

/** A layer that records its calls into the shared log and eases its focus onto the planet like the real one. */
class FakeLayer implements LayerLike {
  approach = 0;
  approached: BodyKey | null = null;
  readonly focus = new Vector3();
  beckoned: BodyKey | null = null;
  hook: ((key: BodyKey | null, instant: boolean) => void) | null = null;
  private target = new Vector3();
  private readonly planet = new Vector3(PLANET[0], PLANET[1], PLANET[2]);
  /** other bodies' places, for a planet-to-planet move; a body not listed stands at PLANET */
  readonly places: Partial<Record<BodyKey, Vector3>> = {};

  constructor(private readonly log: string[]) {}

  setApproach(key: BodyKey | null, instant = false): void {
    this.log.push(`approach:${key}:${instant}`);
    this.approached = key;
    this.target = key ? this.at(key).clone() : new Vector3();
    if (instant) this.focus.copy(this.target);
    this.hook?.(key, instant);
  }

  beckon(key: BodyKey | null, instant = false): void {
    this.log.push(`beckon:${key}:${instant}`);
    this.beckoned = key;
  }

  private at(key: BodyKey): Vector3 {
    return this.places[key] ?? this.planet;
  }

  scenePosition(key: BodyKey): Vector3 | null {
    return this.at(key).clone();
  }

  bodyRadiusR(): number {
    return PLANET_R;
  }

  travelling = false;

  update(dt: number): void {
    this.focus.lerp(this.target, 1 - Math.exp(-dt * 12));
  }
}

interface Scene {
  rig: FakeRig;
  layer: FakeLayer;
  cam: SkyCamera;
  log: string[];
  phases: SkyPhase[];
  frame(): void;
  settle(max?: number): number;
}

/** One display frame in the engine's order: the focus copy, the layer, the sky camera, then the rig. */
function scene(reduced = false, station = DIST_AP): Scene {
  const log: string[] = [];
  const phases: SkyPhase[] = [];
  const rig = new FakeRig(log);
  const layer = new FakeLayer(log);
  const cam = new SkyCamera({
    rig,
    layer: () => layer,
    frame: () => DESK,
    reduced,
    approachDist: () => station,
    homeDist: () => 9000,
    viewLatLon: () => VIEW,
    setPhase: (p) => phases.push(p),
  });
  const frame = () => {
    rig.focus.copy(rig.focusPin ?? layer.focus);
    layer.update(DT);
    cam.update(DT);
    rig.update(DT);
  };
  const settle = (max = 3000) => {
    let n = 0;
    while (cam.busy && n < max) {
      frame();
      n++;
    }
    return n;
  };
  return { rig, layer, cam, log, phases, frame, settle };
}

/** The Earth-side pose a visitor starts from: a surface point, one radius out. */
function earthPose(s: Scene): void {
  s.rig.lat = 20;
  s.rig.lon = 30;
  s.rig.dist = 1.05;
}

/** Stand the camera at a world point: the rig's orbit about its focus, with the look left as it is. */
function placeCamera(s: Scene, cam: Vec3): void {
  const f = s.rig.focus;
  const rel: Vec3 = [cam[0] - f.x, cam[1] - f.y, cam[2] - f.z];
  const ll = latLonFromDir(unit(rel));
  s.rig.lat = ll.lat;
  s.rig.lon = ll.lon;
  s.rig.dist = norm(rel);
}

/** Return to the approach station of KEY and let the layer settle its focus on the planet. */
function atApproach(): Scene {
  const s = scene();
  earthPose(s);
  s.cam.approach(KEY);
  s.settle();
  for (let i = 0; i < 180; i++) s.frame();
  expect(s.cam.phase).toBe('approach');
  return s;
}

describe('SkyCamera gaze', () => {
  it('turns without translating when the planet and the Earth already share the frame', () => {
    const s = atApproach();
    placeCamera(s, framedStation());
    const before = s.rig.snapshot().pos;
    const mark = s.log.length;
    let settled = 0;
    s.cam.gaze(() => settled++);
    s.settle();
    expect(s.log.slice(mark)).not.toContain('drive');
    expect(dist3(s.rig.snapshot().pos, before)).toBeLessThan(1e-9);
    expect(settled).toBe(1);
    expect(composeLook({ cam: s.rig.snapshot().pos, a: PLANET, aRadius: PLANET_R, b: [0, 0, 0], bRadius: 1, frame: DESK }).ok).toBe(true);
    expect(s.cam.phase).toBe('gaze');
  });

  it('swings about the planet at constant distance when turning alone cannot frame the pair', () => {
    const s = atApproach();
    const station = stationAp();
    placeCamera(s, station);
    expect(composeLook({ cam: s.rig.snapshot().pos, a: PLANET, aRadius: PLANET_R, b: [0, 0, 0], bRadius: 1, frame: DESK }).ok).toBe(false);
    let settled = 0;
    s.cam.gaze(() => settled++);
    let maxDev = 0;
    let moved = 0;
    while (s.cam.busy) {
      s.frame();
      const p = s.rig.snapshot().pos;
      maxDev = Math.max(maxDev, Math.abs(dist3(p, PLANET) - DIST_AP));
      moved = Math.max(moved, dist3(p, station));
    }
    expect(maxDev).toBeLessThan(1e-6);
    expect(moved).toBeGreaterThan(1);
    expect(settled).toBe(1);
    const end = s.rig.snapshot();
    expect(composeLook({ cam: end.pos, a: PLANET, aRadius: PLANET_R, b: [0, 0, 0], bRadius: 1, frame: DESK }).ok).toBe(true);
    const a = projectNdc(end.pos, end.look, [0, 1, 0], PLANET, DESK);
    const b = projectNdc(end.pos, end.look, [0, 1, 0], [0, 0, 0], DESK);
    for (const n of [a, b]) {
      expect(Math.abs(n.x)).toBeLessThanOrEqual(DESK.margin);
      expect(Math.abs(n.y)).toBeLessThanOrEqual(DESK.margin);
    }
  });
});

describe('SkyCamera cancelGaze', () => {
  it('re-centres on the held planet from the same station, never leaving the approach', () => {
    const s = atApproach();
    placeCamera(s, stationAp());
    s.cam.gaze();
    s.settle();
    const before = s.rig.snapshot().pos;
    const mark = s.log.length;
    const phaseMark = s.phases.length;
    s.cam.cancelGaze();
    expect(s.cam.busy).toBe(true);
    s.settle();
    const tail = s.log.slice(mark);
    expect(tail.some((e) => e.startsWith('approach:null'))).toBe(false);
    expect(tail).not.toContain('flyTo');
    expect(s.phases.slice(phaseMark)).toEqual(['approach']);
    expect(s.cam.phase).toBe('approach');
    expect(s.cam.key).toBe(KEY);
    expect(s.cam.busy).toBe(false);
    expect(s.rig.focusPin).toBeNull();
    expect(dist3(s.rig.snapshot().pos, before)).toBeLessThan(1e-6);
  });
});

describe('SkyCamera descend', () => {
  it('drops on one polar track with the focus pinned, and lands once after the last drive', () => {
    const s = atApproach();
    placeCamera(s, stationAp());
    s.cam.gaze();
    s.settle();
    const landed: number[] = [];
    const mark = s.log.length;
    const phaseMark = s.phases.length;
    s.cam.descend(LAND, {}, () => landed.push(s.log.length));
    expect(s.cam.phase).toBe('descend');
    let prev = s.rig.snapshot().pos;
    let maxRatio = 0;
    const pinnedDuring: boolean[] = [];
    while (s.cam.busy) {
      s.frame();
      const p = s.rig.snapshot().pos;
      maxRatio = Math.max(maxRatio, dist3(p, prev) / norm(prev));
      prev = p;
      // the frame that ends the descent is the one that releases the pin, so it is not a frame of the drop
      if (s.cam.busy) pinnedDuring.push(s.rig.focusPin !== null);
    }
    expect(maxRatio).toBeLessThan(0.12);
    expect(pinnedDuring.length).toBeGreaterThan(100);
    expect(pinnedDuring.every(Boolean)).toBe(true);
    expect(s.rig.focusPin).toBeNull();
    expect(s.phases.slice(phaseMark)).toEqual(['descend', 'settled']);
    expect(landed.length).toBe(1);
    expect(s.log.lastIndexOf('drive')).toBeLessThan(landed[0]);
    const nullAt = s.log.indexOf('approach:null:false', mark);
    expect(nullAt).toBeGreaterThanOrEqual(0);
    expect(nullAt).toBeLessThan(s.log.indexOf('drive', mark));
    const after = s.log.length;
    for (let i = 0; i < 60; i++) s.frame();
    expect(s.log.length).toBe(after);
    expect(landed.length).toBe(1);
    const end = s.rig.snapshot().pos;
    expect(dist3(end, [LAND.dist * dirFromLatLon(LAND.lat, LAND.lon)[0], LAND.dist * dirFromLatLon(LAND.lat, LAND.lon)[1], LAND.dist * dirFromLatLon(LAND.lat, LAND.lon)[2]])).toBeLessThan(1e-6);
  });

  it('ignores a grab while it runs', () => {
    const s = atApproach();
    placeCamera(s, stationAp());
    s.cam.gaze();
    s.settle();
    s.cam.descend(LAND, {}, () => {});
    for (let i = 0; i < 30; i++) s.frame();
    s.cam.onUserGrab();
    expect(s.cam.phase).toBe('descend');
    expect(s.cam.busy).toBe(true);
  });
});

describe('SkyCamera returnToSky', () => {
  it('lifts, turns so both bodies share the frame, climbs, and ends on the approach station', () => {
    const s = scene();
    earthPose(s);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mark = s.log.length;
    const phaseMark = s.phases.length;
    let done = 0;
    let composed: { pos: [number, number, number]; look: [number, number, number] } | null = null;
    s.layer.hook = (key, instant) => {
      if (key && !instant && !composed) composed = s.rig.snapshot();
    };
    s.cam.returnToSky(KEY, {}, () => done++);
    expect(s.cam.busy).toBe(true);
    expect(s.cam.phase).toBe('return');
    const flags: boolean[] = [];
    const phases = new Set<SkyPhase>();
    for (let i = 0; i < 2000; i++) {
      s.frame();
      flags.push(s.cam.busy);
      phases.add(s.cam.phase);
      if (!s.cam.busy) break;
    }
    expect(flags.slice(0, -1).every(Boolean)).toBe(true);
    expect(flags[flags.length - 1]).toBe(false);
    expect([...phases].every((p) => p === 'return' || p === 'approach')).toBe(true);
    expect(s.phases.slice(phaseMark)).toEqual(['return', 'approach']);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    const firstDrive = s.log.indexOf('drive', mark);
    expect(s.log.indexOf(`beckon:${KEY}:false`, mark)).toBeLessThan(firstDrive);
    expect(s.log.lastIndexOf('beckon:null:true')).toBeGreaterThan(s.log.lastIndexOf('drive'));

    const c = composed as unknown as { pos: [number, number, number]; look: [number, number, number] } | null;
    expect(c).not.toBeNull();
    if (c) {
      for (const p of [PLANET, [0, 0, 0] as Vec3]) {
        const n = projectNdc(c.pos, c.look, [0, 1, 0], p, DESK);
        expect(n.depth).toBeGreaterThan(0);
        expect(Math.abs(n.x)).toBeLessThanOrEqual(DESK.margin);
        expect(Math.abs(n.y)).toBeLessThanOrEqual(DESK.margin);
      }
    }
    expect(dist3(s.rig.snapshot().pos, stationAp())).toBeLessThan(1e-6);
    expect(done).toBe(1);
    expect(s.cam.key).toBe(KEY);
    expect(s.layer.approached).toBe(KEY);
    expect(s.rig.focusPin).toBeNull();
  });
});

describe('SkyCamera return from a travelling sky', () => {
  it('frames the planet only once the sky has stopped travelling (its place is not yet the one it will hold)', () => {
    const s = scene();
    earthPose(s);
    s.layer.travelling = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let framedWhile: boolean | null = null;
    s.layer.hook = (key, instant) => {
      if (key && !instant && framedWhile === null) framedWhile = s.layer.travelling;
    };
    s.cam.returnToSky(KEY);
    // the flight runs for 90 frames, then the bodies are where they will stand
    for (let i = 0; i < 90; i++) s.frame();
    expect(s.cam.busy).toBe(true);
    expect(framedWhile).toBeNull();
    s.layer.travelling = false;
    const n = s.settle();
    expect(n).toBeLessThan(3000);
    expect(framedWhile).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    expect(s.cam.key).toBe(KEY);
    expect(s.cam.phase).toBe('approach');
  });
});

describe('SkyCamera supersession', () => {
  it('a release drops a running descent: its landing never fires', () => {
    const s = atApproach();
    placeCamera(s, stationAp());
    s.cam.gaze();
    s.settle();
    const landed = vi.fn();
    s.cam.descend(LAND, {}, landed);
    for (let i = 0; i < 30; i++) s.frame();
    s.cam.release();
    expect(s.cam.busy).toBe(false);
    s.settle();
    expect(landed).not.toHaveBeenCalled();
    expect(s.cam.phase).toBe('system');
    const mark = s.log.length;
    for (let i = 0; i < 60; i++) s.frame();
    expect(s.log.length).toBe(mark);
  });

  it('a whole-system request drops a running return: its arrival never fires', () => {
    const s = scene();
    earthPose(s);
    const onDone = vi.fn();
    s.cam.returnToSky(KEY, {}, onDone);
    for (let i = 0; i < 60; i++) s.frame();
    s.cam.approach(null);
    s.settle();
    expect(onDone).not.toHaveBeenCalled();
    expect(s.cam.phase).toBe('system');
    expect(s.cam.key).toBeNull();
  });
});

describe('SkyCamera reduced motion and instant requests', () => {
  it('finishes a return, a gaze and a descent synchronously', () => {
    const s = scene(true);
    earthPose(s);
    let done = 0;
    s.cam.returnToSky(KEY, {}, () => done++);
    expect(done).toBe(1);
    expect(s.cam.busy).toBe(false);
    expect(s.cam.phase).toBe('approach');

    placeCamera(s, stationAp());
    let settled = 0;
    s.cam.gaze(() => settled++);
    expect(settled).toBe(1);
    expect(s.cam.busy).toBe(false);

    let landed = 0;
    s.cam.descend(LAND, {}, () => landed++);
    expect(landed).toBe(1);
    expect(s.cam.busy).toBe(false);
    expect(s.cam.phase).toBe('settled');
  });

  it('an instant approach from the Earth stands at once', () => {
    const s = scene();
    earthPose(s);
    s.cam.approach(KEY, { instant: true });
    expect(s.cam.busy).toBe(false);
    expect(s.cam.phase).toBe('approach');
    expect(s.cam.key).toBe(KEY);
  });
});

describe('SkyCamera planet to planet', () => {
  const MARS = 'mars' as BodyKey;
  const MARS_AT = new Vector3(-700, 220, 520);
  const STATION = 6; // a held planet's station is a few radii: the rig's own distance about the planet reads "near the Earth"
  const angle = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (norm(a) * norm(b))))) * 180) / Math.PI;

  /** Held at KEY's station, then a pick of Mars: every frame of the move, until the camera stands. */
  function move() {
    const s = scene(false, STATION);
    s.layer.places[MARS] = MARS_AT;
    earthPose(s);
    s.cam.approach(KEY);
    s.settle();
    for (let i = 0; i < 180; i++) s.frame();
    expect(s.cam.phase).toBe('approach');
    const phaseMark = s.phases.length;
    const logMark = s.log.length;
    const mars: Vec3 = [MARS_AT.x, MARS_AT.y, MARS_AT.z];
    const frames: { pos: Vec3; look: Vec3; toMars: number; fromEarth: number }[] = [];
    s.cam.approach(MARS);
    let n = 0;
    while (s.cam.busy && n++ < 3000) {
      s.frame();
      const snap = s.rig.snapshot();
      const look: Vec3 = [snap.look[0] - snap.pos[0], snap.look[1] - snap.pos[1], snap.look[2] - snap.pos[2]];
      frames.push({ pos: snap.pos, look, toMars: dist3(snap.pos, mars), fromEarth: norm(snap.pos) });
    }
    for (let i = 0; i < 60; i++) s.frame();
    return { s, frames, phases: s.phases.slice(phaseMark), log: s.log.slice(logMark), mars };
  }

  it('is a dolly in the sky: no return from the Earth, no lift, no beckon', () => {
    const { phases, log } = move();
    expect(phases).not.toContain('return');
    expect(phases[0]).toBe('system');
    expect(phases[phases.length - 1]).toBe('approach');
    expect(log.some((e) => e.startsWith('beckon:'))).toBe(false);
  });

  it('closes on the planet and never opens again: its distance only falls, and it never rises above where it started', () => {
    const { frames } = move();
    expect(frames.length).toBeGreaterThan(60);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].toMars).toBeLessThanOrEqual(frames[i - 1].toMars + 1e-6);
    }
    // the camera is never driven farther from the planet than it began (no pop outward, no pass-and-return)
    expect(Math.max(...frames.map((f) => f.toMars))).toBeLessThanOrEqual(frames[0].toMars + 1e-6);
    // …and it stays within the sky it started in: no frame is farther from the Earth than the sky's own extent
    const extent = Math.max(norm([PLANET[0], PLANET[1], PLANET[2]]), MARS_AT.length(), frames[0].fromEarth);
    expect(Math.max(...frames.map((f) => f.fromEarth))).toBeLessThanOrEqual(extent * 1.5);
  });

  it('turns smoothly onto the planet: no frame swings the view by more than a few degrees', () => {
    const { frames } = move();
    let worst = 0;
    for (let i = 1; i < frames.length; i++) worst = Math.max(worst, angle(frames[i].look, frames[i - 1].look));
    expect(worst).toBeLessThan(4);
    // the planet is the look at the end
    const last = frames[frames.length - 1];
    expect(angle(last.look, [MARS_AT.x - last.pos[0], MARS_AT.y - last.pos[1], MARS_AT.z - last.pos[2]])).toBeLessThan(0.5);
  });

  it('ends on the new planet\'s approach station, at the station distance', () => {
    const { s, mars } = move();
    expect(s.cam.key).toBe(MARS);
    expect(s.layer.approached).toBe(MARS);
    expect(dist3(s.rig.snapshot().pos, mars)).toBeCloseTo(STATION, 3);
    expect(s.cam.busy).toBe(false);
  });

  it('a pick made while the camera is still close to the Earth still returns through the ascent', () => {
    const s = scene(false, STATION);
    s.layer.places[MARS] = MARS_AT;
    earthPose(s);
    s.cam.approach(MARS);
    expect(s.cam.phase).toBe('return');
  });
});
