import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import sky from '../../public/data/sky.json';
import type { SkyData } from '../../src/types/sky';
import { SkyLayer, beckonedBody, skyGroupShown, BECKONED_ABOVE } from '../../src/sky/layer';
import { orbitsSnapOff, orbitsWanted } from '../../src/sky/orbits';

const LIVE = { on: true, px: 120 };

describe('the orbits follow the sky phase (spec §2.5: orbits show only in approach)', () => {
  const phases = ['system', 'approach', 'gaze', 'descend', 'return', 'settled'] as const;

  it('stand only in approach, once arrived and drawn large enough', () => {
    for (const phase of phases) {
      const wanted = orbitsWanted(phase, false, 1, LIVE);
      expect(wanted, phase).toBe(phase === 'approach');
    }
  });

  it('a set phase decides alone: the sky-gazing class no longer matters', () => {
    expect(orbitsWanted('approach', true, 1, LIVE)).toBe(true);
    expect(orbitsWanted('gaze', false, 1, LIVE)).toBe(false);
  });

  it('the approach must have arrived (> 0.6) and the disc must be on screen and large enough', () => {
    expect(orbitsWanted('approach', false, 0.6, LIVE)).toBe(false);
    expect(orbitsWanted('approach', false, 0.61, LIVE)).toBe(true);
    expect(orbitsWanted('approach', false, 1, { on: false, px: 120 })).toBe(false);
    expect(orbitsWanted('approach', false, 1, { on: true, px: 40 })).toBe(false);
    expect(orbitsWanted('approach', false, 1, { on: true, px: 40.5 })).toBe(true);
    expect(orbitsWanted('approach', false, 1, null)).toBe(false);
  });

  it('legacy (no phase set): today’s rule, stand down while sky-gazing', () => {
    expect(orbitsWanted(undefined, false, 1, LIVE)).toBe(true);
    expect(orbitsWanted(undefined, true, 1, LIVE)).toBe(false);
    expect(orbitsWanted(undefined, false, 0.3, LIVE)).toBe(false);
    expect(orbitsWanted(undefined, false, 1, null)).toBe(false);
  });

  it('gaze, descend, return and system go at once (no fade lingering); approach, settled and legacy fade', () => {
    expect(orbitsSnapOff('gaze')).toBe(true);
    expect(orbitsSnapOff('descend')).toBe(true);
    expect(orbitsSnapOff('return')).toBe(true);
    expect(orbitsSnapOff('system')).toBe(true);
    expect(orbitsSnapOff('approach')).toBe(false);
    expect(orbitsSnapOff('settled')).toBe(false);
    expect(orbitsSnapOff(undefined)).toBe(false);
  });
});

describe('beckon: the presence rule and the group gate (pure)', () => {
  it('a body is beckoned only while its presence is above the threshold', () => {
    expect(beckonedBody('mars', 0)).toBeNull();
    expect(beckonedBody('mars', BECKONED_ABOVE)).toBeNull();
    expect(beckonedBody('mars', BECKONED_ABOVE + 0.001)).toBe('mars');
    expect(beckonedBody('mars', 1)).toBe('mars');
    expect(beckonedBody(null, 1)).toBeNull();
  });

  it('the sky group draws inside the Earth stage only when a beckon is present', () => {
    expect(skyGroupShown(10, 0)).toBe(false);
    expect(skyGroupShown(10, 0.001)).toBe(true);
    expect(skyGroupShown(6.5, 1)).toBe(true);
    expect(skyGroupShown(20, 0)).toBe(false); // skyVisible is dist > 20
    expect(skyGroupShown(25, 0)).toBe(true);
  });
});

/** SkyLayer draws with three.js only: no GL context is needed to build it or to read its screen discs. */
const data = sky as unknown as SkyData;

function frame(layer: SkyLayer, camDist: number, dt: number, target: 'mars') {
  layer.prepare(camDist, dt);
  const camera = new THREE.PerspectiveCamera(50, 1, 1e-3, 1e6);
  camera.position.set(0, 0, camDist);
  const at = layer.scenePosition(target);
  expect(at, `${target} has a place`).not.toBeNull();
  camera.lookAt(at!);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  layer.update(camera, camDist, 1000, 800);
}

describe('SkyLayer.beckon (drawn through the layer, no GL context)', () => {
  it('a planet is not drawn near Earth unless beckoned, and is drawn at full presence when it is', () => {
    const layer = new SkyLayer(data);
    frame(layer, 300, 0, 'mars');
    expect(layer.screenDisc('mars')!.on).toBe(false);

    layer.beckon('mars', true);
    frame(layer, 300, 0, 'mars');
    expect(layer.screenDisc('mars')!.on).toBe(true);
    expect(layer.screenBodies().find((b) => b.key === 'mars')!.alpha).toBe(1);
    expect(layer.beckoned).toBe('mars');
  });

  it('beckon does not touch the focus, the approach or the approached body', () => {
    const layer = new SkyLayer(data);
    frame(layer, 300, 0, 'mars');
    const focus = layer.focus.clone();
    layer.beckon('mars', true);
    frame(layer, 300, 0, 'mars');
    expect(layer.focus.equals(focus)).toBe(true);
    expect(layer.approach).toBe(0);
    expect(layer.approached).toBeNull();
  });

  it('the group is drawn inside dist 20 for a beckoned body (the test camera’s far plane is set wide to isolate the gate)', () => {
    const layer = new SkyLayer(data);
    frame(layer, 10, 0, 'mars');
    expect(layer.screenDisc('mars')!.on).toBe(false);
    layer.beckon('mars', true);
    frame(layer, 10, 0, 'mars');
    expect(layer.screenDisc('mars')!.on).toBe(true);
  });

  it('eases in on the layer clock and eases out, and lets go after the release', () => {
    const layer = new SkyLayer(data);
    layer.beckon('mars');
    frame(layer, 300, 0.9, 'mars'); // 900 ms of an 1800 ms ease: presence is half way
    expect(layer.screenBodies().find((b) => b.key === 'mars')!.alpha).toBeCloseTo(0.5, 1);
    expect(layer.beckoned).toBe('mars');

    frame(layer, 300, 1.8, 'mars'); // the ease is complete
    expect(layer.screenBodies().find((b) => b.key === 'mars')!.alpha).toBe(1);

    layer.beckon(null);
    frame(layer, 300, 1.6, 'mars'); // halfway down a 3200 ms release: still beckoned
    expect(layer.beckoned).toBe('mars');
    frame(layer, 300, 1.7, 'mars'); // past the release
    expect(layer.beckoned).toBeNull();
    expect(layer.screenDisc('mars')!.on).toBe(false);
  });

  it('reduced motion shortens the ease to 0.4 of its length', () => {
    const layer = new SkyLayer(data);
    layer.reduced = true;
    layer.beckon('mars');
    frame(layer, 300, 0.72, 'mars'); // 720 ms = the full 0.4 × 1800 ms ease
    expect(layer.beckoned).toBe('mars');
    expect(layer.screenBodies().find((b) => b.key === 'mars')!.alpha).toBe(1);
  });
});
