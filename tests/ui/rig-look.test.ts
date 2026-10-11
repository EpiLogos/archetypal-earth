import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../../src/globe/controls';
import { dirFromLatLon } from '../../src/data/geo';

// The rig needs a camera and an element it can listen on. Nothing here dispatches pointer events, so a stub is enough.
function stubDom() {
  return {
    addEventListener() {},
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    clientHeight: 600,
    setPointerCapture() {},
    releasePointerCapture() {},
  } as unknown as HTMLElement;
}

const DT = 1 / 60;

function makeRig(reduced = false) {
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.01, 100);
  const rig = new CameraRig(camera, stubDom(), {
    reduced,
    onInteract() {},
    onGrab() {},
    onClick() {},
    onHover() {},
  });
  rig.autoRotate = false;
  rig.interacted = true;
  rig.lat = 20;
  rig.lon = 40;
  rig.dist = 3;
  rig.targetDist = 3;
  rig.focus.set(0, 0, 0);
  rig.update(0);
  return { camera, rig };
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const dist = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b);

/** Largest per-step look movement over a sequence of look points. */
function maxStep(points: THREE.Vector3[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) m = Math.max(m, dist(points[i], points[i - 1]));
  return m;
}

/** Position must equal focus + dir(lat, lon) * dist, whatever the look is doing. */
function expectOrbitPosition(rig: CameraRig, camera: THREE.PerspectiveCamera) {
  const d = dirFromLatLon(rig.lat, rig.lon);
  const f = rig.focus;
  const want = v(f.x + d[0] * rig.dist, f.y + d[1] * rig.dist, f.z + d[2] * rig.dist);
  expect(dist(camera.position, want)).toBeLessThanOrEqual(1e-9);
}

describe('lookAtPoint: turn without translating', () => {
  it('keeps the position fixed and eases the look monotonically to the target', () => {
    const { camera, rig } = makeRig();
    const start = camera.position.clone();
    const target = v(1.2, 0.4, -0.6);
    rig.lookAtPoint(target, { duration: 1.0 });
    const looks: THREE.Vector3[] = [];
    let prevGap = Infinity;
    for (let i = 0; i < 60; i++) {
      rig.update(DT);
      expect(dist(camera.position, start)).toBeLessThanOrEqual(1e-9);
      expectOrbitPosition(rig, camera);
      const look = rig.lookPoint(v(0, 0, 0));
      looks.push(look);
      const gap = dist(look, target);
      expect(gap).toBeLessThanOrEqual(prevGap + 1e-12);
      prevGap = gap;
    }
    // arrived at the end of the 1.0 s turn
    expect(dist(looks[looks.length - 1], target)).toBeLessThanOrEqual(1e-9);
    expect(rig.lookOffset).toBeCloseTo(1, 9);
    expect(rig.gazing).toBe(true);
  });
});

describe('retargeting mid-turn', () => {
  it('has no discontinuity: no step exceeds 1.5x an uninterrupted turn of the same endpoints', () => {
    const A = v(0, 0, 0);
    const B = v(2, 0, 0);
    const C = v(2, 0.5, 0);

    // reference: the largest step of an uninterrupted turn from A to C over 1.0 s
    const ref = makeRig();
    ref.rig.lookAtPoint(C, { duration: 1.0 });
    const refLooks: THREE.Vector3[] = [ref.rig.lookPoint(v(0, 0, 0))];
    for (let i = 0; i < 60; i++) {
      ref.rig.update(DT);
      refLooks.push(ref.rig.lookPoint(v(0, 0, 0)));
    }
    const refStep = maxStep(refLooks);
    expect(refStep).toBeGreaterThan(0);
    expect(dist(refLooks[0], A)).toBeLessThanOrEqual(1e-9);

    // interrupted: turn toward B for 20 frames, retarget to C, then run it out
    const { rig } = makeRig();
    const seq: THREE.Vector3[] = [rig.lookPoint(v(0, 0, 0))];
    rig.lookAtPoint(B, { duration: 1.0 });
    for (let i = 0; i < 20; i++) {
      rig.update(DT);
      seq.push(rig.lookPoint(v(0, 0, 0)));
    }
    rig.lookAtPoint(C, { duration: 1.0 });
    for (let i = 0; i < 60; i++) {
      rig.update(DT);
      seq.push(rig.lookPoint(v(0, 0, 0)));
    }
    expect(maxStep(seq)).toBeLessThanOrEqual(refStep * 1.5);
    expect(dist(seq[seq.length - 1], C)).toBeLessThanOrEqual(1e-9);
  });

  it('a retarget from a held point starts from the held point, not from the focus', () => {
    const { rig } = makeRig();
    rig.lookAtPoint(v(1, 0, 0), { instant: true });
    const held = rig.lookPoint(v(0, 0, 0));
    rig.lookAtPoint(v(0, 1, 0), { duration: 1.0 });
    rig.update(DT);
    const next = rig.lookPoint(v(0, 0, 0));
    // one frame of a 1.0 s turn: well under a tenth of the way, and nowhere near the focus
    expect(dist(next, held)).toBeLessThan(0.1);
    expect(dist(next, v(0, 0, 0))).toBeGreaterThan(0.5);
  });
});

describe('recentre (end of a gaze)', () => {
  it('returns the look to the focus with no step above 1.5x the uniform turn, and gazing goes false', () => {
    // reference: an uninterrupted 0.6 s turn from the focus to T
    const T = v(0.9, 0.7, 0.2);
    const ref = makeRig();
    ref.rig.lookAtPoint(T, { duration: 0.6 });
    const refLooks: THREE.Vector3[] = [ref.rig.lookPoint(v(0, 0, 0))];
    for (let i = 0; i < 60; i++) {
      ref.rig.update(DT);
      refLooks.push(ref.rig.lookPoint(v(0, 0, 0)));
    }
    const refStep = maxStep(refLooks);

    // held at T, then recentre
    const { rig } = makeRig();
    rig.lookAtPoint(T, { instant: true });
    expect(rig.gazing).toBe(true);
    rig.clearGaze();
    expect(rig.gazing).toBe(true); // a recentre is in progress, not a drop
    const seq: THREE.Vector3[] = [rig.lookPoint(v(0, 0, 0))];
    for (let i = 0; i < 60; i++) {
      rig.update(DT);
      seq.push(rig.lookPoint(v(0, 0, 0)));
    }
    expect(maxStep(seq)).toBeLessThanOrEqual(refStep * 1.5);
    expect(dist(seq[seq.length - 1], v(0, 0, 0))).toBeLessThanOrEqual(1e-9);
    expect(rig.lookOffset).toBeCloseTo(0, 9);
    expect(rig.gazing).toBe(false);
  });

  it('recentreLook tracks a focus that moves while it eases, and fires onDone once', () => {
    const { camera, rig } = makeRig();
    rig.lookAtPoint(v(0, 1, 0), { instant: true });
    const done: string[] = [];
    rig.recentreLook({ duration: 0.5, onDone: () => done.push('done') });
    let f = 0;
    for (let i = 0; i < 90; i++) {
      f += 0.01;
      rig.focus.set(f, 0, 0);
      rig.update(DT);
      expectOrbitPosition(rig, camera);
    }
    expect(dist(rig.lookPoint(v(0, 0, 0)), rig.focus)).toBeLessThanOrEqual(1e-9);
    expect(done).toEqual(['done']);
    expect(rig.gazing).toBe(false);
  });

  it('a second clearGaze mid-recentre does not restart the ease (same look as one clearGaze)', () => {
    const once = makeRig().rig;
    once.lookAtPoint(v(0, 1, 0), { instant: true });
    once.clearGaze();
    for (let i = 0; i < 31; i++) once.update(DT);

    const twice = makeRig().rig;
    twice.lookAtPoint(v(0, 1, 0), { instant: true });
    twice.clearGaze();
    for (let i = 0; i < 30; i++) twice.update(DT);
    twice.clearGaze(); // e.g. another wheel tick mid-recentre
    twice.update(DT);

    expect(dist(twice.lookPoint(v(0, 0, 0)), once.lookPoint(v(0, 0, 0)))).toBeLessThanOrEqual(1e-12);
  });
});

describe('moving the focus while the look is offset', () => {
  it('keeps the position at focus + dir * dist', () => {
    const { camera, rig } = makeRig();
    rig.lookAtPoint(v(0.5, 0.5, 0.5), { duration: 0.5 });
    for (let i = 0; i < 60; i++) {
      rig.focus.set(0.02 * i, -0.01 * i, 0.015 * i);
      rig.update(DT);
      expectOrbitPosition(rig, camera);
    }
  });
});

describe('flyTo during an offset look', () => {
  it('ends centred and at the flown position', () => {
    const { camera, rig } = makeRig();
    rig.lookAtPoint(v(1.4, 0.3, -0.5), { duration: 0.5 });
    for (let i = 0; i < 30; i++) rig.update(DT);
    expect(rig.gazing).toBe(true);
    rig.flyTo(-20, 120, 2.0, { duration: 1.2 });
    let frames = 0;
    while (rig.flying && frames < 400) {
      rig.update(DT);
      frames++;
      expectOrbitPosition(rig, camera);
    }
    expect(rig.flying).toBe(false);
    expect(rig.lat).toBeCloseTo(-20, 6);
    expect(rig.dist).toBeCloseTo(2.0, 6);
    expect(dist(rig.lookPoint(v(0, 0, 0)), rig.focus)).toBeLessThanOrEqual(1e-9);
    expect(rig.gazing).toBe(false);
  });
});

describe('instant paths snap deterministically', () => {
  it('lookAtPoint instant lands on the target in the same frame, with onDone called once and synchronously', () => {
    const run = () => {
      const { rig } = makeRig();
      let calls = 0;
      rig.lookAtPoint(v(0.3, 0.8, 0.1), { instant: true, onDone: () => calls++ });
      const first = rig.snapshot();
      rig.update(DT);
      rig.update(DT);
      return { first, last: rig.snapshot(), calls };
    };
    const a = run();
    const b = run();
    expect(a.first.look[0]).toBeCloseTo(0.3, 12);
    expect(a.first.look[1]).toBeCloseTo(0.8, 12);
    expect(a.first.look[2]).toBeCloseTo(0.1, 12);
    expect(a.calls).toBe(1);
    expect(a.last).toEqual(b.last);
    expect(a.first).toEqual(b.first);
  });

  it('a reduced-motion rig snaps lookAtPoint and clearGaze', () => {
    const { rig } = makeRig(true);
    rig.lookAtPoint(v(0, 1, 0), { duration: 2 });
    expect(rig.lookOffset).toBe(1);
    expect(rig.lookPoint(v(0, 0, 0)).toArray()).toEqual([0, 1, 0]);
    rig.clearGaze();
    expect(rig.gazing).toBe(false);
    expect(rig.lookPoint(v(0, 0, 0)).toArray()).toEqual([0, 0, 0]);
  });

  it('flyTo instant centres the look at once', () => {
    const { rig } = makeRig();
    rig.lookAtPoint(v(1, 0, 0), { instant: true });
    rig.flyTo(10, 10, 2.5, { instant: true });
    expect(rig.gazing).toBe(false);
    expect(rig.lookPoint(v(0, 0, 0)).toArray()).toEqual([0, 0, 0]);
  });

  it('a look aimed at the camera itself falls back to the focus rather than producing a degenerate pose', () => {
    const { camera, rig } = makeRig();
    rig.lookAtPoint(camera.position.clone(), { instant: true });
    const s = rig.snapshot();
    expect(s.look).toEqual([0, 0, 0]);
    expect(Number.isFinite(camera.quaternion.x)).toBe(true);
  });

  it('a look point directly up the axis from the camera falls back to the focus', () => {
    const { camera, rig } = makeRig();
    // the camera sits at x,z != 0, so a point at the same x,z but higher up is parallel to up from the camera
    rig.lookAtPoint(v(camera.position.x, 5, camera.position.z), { instant: true });
    expect(rig.snapshot().look).toEqual([0, 0, 0]);
  });
});
