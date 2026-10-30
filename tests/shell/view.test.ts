import { describe, expect, it } from 'vitest';
import { viewOf, viewTarget } from '../../src/shell/view';

describe('the View control reads the camera, it does not set it', () => {
  it('is Earth with no sky in the route, whatever phase the camera last held', () => {
    expect(viewOf({ graph: false, sky: false })).toBe('earth');
    expect(viewOf({ graph: false, sky: false, phase: 'system' })).toBe('earth');
    expect(viewOf({ graph: false, sky: false, phase: 'settled' })).toBe('earth');
  });
  it('is Sky while the route stands in the sky, in each phase of it', () => {
    for (const phase of ['system', 'approach', 'gaze', 'return'] as const) expect(viewOf({ graph: false, sky: true, phase })).toBe('sky');
  });
  it('stays Sky through the descent and is Earth when the camera has settled', () => {
    expect(viewOf({ graph: false, sky: false, phase: 'descend' })).toBe('sky');
    expect(viewOf({ graph: false, sky: false, phase: 'settled' })).toBe('earth');
  });
  it('is Graph in the graph, which has no sky', () => {
    expect(viewOf({ graph: true, sky: false })).toBe('graph');
    expect(viewOf({ graph: true, sky: true, phase: 'system' })).toBe('graph');
  });
});

describe('a click asks for the transition the gesture makes', () => {
  it('names nothing to do for the view already shown', () => {
    expect(viewTarget('earth', 'earth')).toBe('none');
    expect(viewTarget('sky', 'sky')).toBe('none');
  });
  it('leaves the sky by the descent, enters it by the lift, and takes the graph from either', () => {
    expect(viewTarget('sky', 'earth')).toBe('descend');
    expect(viewTarget('earth', 'sky')).toBe('lift');
    expect(viewTarget('graph', 'sky')).toBe('lift');
    expect(viewTarget('graph', 'earth')).toBe('earth');
    expect(viewTarget('earth', 'graph')).toBe('graph');
    expect(viewTarget('sky', 'graph')).toBe('graph');
  });
});

import { readFileSync } from 'node:fs';
describe('the control never writes the camera', () => {
  it('imports and calls nothing of the rig or the sky camera', () => {
    for (const f of ['src/shell/view.ts', 'src/shell/view-control.ts']) {
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/\brig\b|SkyCamera|skyCam|flyTo|\.drive\(|setShift/);
    }
  });
});
