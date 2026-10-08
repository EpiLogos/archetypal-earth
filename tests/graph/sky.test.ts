import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { DEFAULT_RAMP, DEFAULT_TRAIL } from '../../src/data/time';
import { buildGraph, edgeAllowed, globalSet, neighbourhood, nodeLiveness, SKY_RING_RADIUS, skyRingPosition, withSkyAnchors, type SkyAnchorSource } from '../../src/graph/build';
import { SkyEphemeris } from '../../src/sky/ephemeris';
import type { TiesIndex } from '../../src/sky/ties';
import type { Field } from '../../src/types/field';
import type { SkyData } from '../../src/types/sky';

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
const field = read<Field>('../../public/data/field.json');
const sky = read<SkyData>('../../public/data/sky.json');
const ties = read<TiesIndex>('../../public/data/sky.ties.json');
const model = buildModel(field);
const base = buildGraph(model);

// the same derivation the controller makes, at a fixed instant inside the generated span
const MS = Date.parse('2026-10-08T12:00:00Z');
const eph = new SkyEphemeris(sky);
const lon: SkyAnchorSource['lon'] = {};
for (const b of ties.bodies) {
  if (b.key === 'earth') continue;
  const p = eph.geo(b.key, MS);
  if (p) lon[b.key] = p.lon;
}
const src: SkyAnchorSource = { bodies: ties.bodies, ties: ties.ties, lon };
const g = withSkyAnchors(base, src);

describe('sky anchors in the graph', () => {
  it('leaves the default graph exactly as it was', () => {
    expect(base.bodyIds).toEqual([]);
    expect(base.nodes.some((n) => n.kind === 'body')).toBe(false);
    expect(base.edges.some((e) => e.kind === 'sky')).toBe(false);
    expect(base.nodes.length).toBe(field.archetypes.length + field.families.length + field.occurrences.length);
  });

  it('does not touch the graph it extends, and keeps every existing node and edge where it was', () => {
    const before = JSON.stringify([base.nodes.length, base.edges.length, base.adj.map((a) => a.length)]);
    withSkyAnchors(base, src);
    expect(JSON.stringify([base.nodes.length, base.edges.length, base.adj.map((a) => a.length)])).toBe(before);
    for (let i = 0; i < base.nodes.length; i++) expect(g.nodes[i]).toBe(base.nodes[i]);
    for (let i = 0; i < base.edges.length; i++) expect(g.edges[i]).toBe(base.edges[i]);
    expect(g.occurrenceIds).toBe(base.occurrenceIds);
  });

  it('hangs one body per body with a geocentric longitude: every one but the Earth, Pluto included', () => {
    const keys = g.bodyIds.map((i) => g.nodes[i].ref);
    expect(keys).toContain('pluto');
    expect(keys).toContain('sun');
    expect(keys).toContain('moon');
    expect(keys).not.toContain('earth');
    expect(keys.length).toBe(ties.bodies.length - 1);
    expect(g.bodyIds.every((i) => g.nodes[i].kind === 'body' && g.nodes[i].key === `b:${g.nodes[i].ref}`)).toBe(true);
  });

  it('ties each body to exactly the family or archetype the ties index records, keeping the basis', () => {
    const want = new Set(ties.ties.filter((t) => t.body !== 'earth').map((t) => `b:${t.body}|${t.type === 'family' ? 'f' : 'a'}:${t.id}|${t.basis}`));
    const got = new Set(g.edges.filter((e) => e.kind === 'sky').map((e) => `${g.nodes[e.s].key}|${g.nodes[e.t].key}|${e.basis}`));
    expect(got).toEqual(want);
    expect(got.size).toBeGreaterThan(0);
  });

  it('keeps adjacency symmetric for the new edges', () => {
    g.edges.forEach((e, k) => {
      expect(g.adj[e.s]).toContain(e.t);
      expect(g.adj[e.t]).toContain(e.s);
      expect(g.incident[e.s]).toContain(k);
    });
  });

  it('is deterministic: the same sky gives the same graph', () => {
    const a = withSkyAnchors(base, src);
    expect(JSON.stringify([a.nodes.slice(base.nodes.length), a.edges.slice(base.edges.length), a.bodyIds])).toBe(JSON.stringify([g.nodes.slice(base.nodes.length), g.edges.slice(base.edges.length), g.bodyIds]));
  });

  it('places each body on the outer ring at its geocentric ecliptic longitude', () => {
    for (const id of g.bodyIds) {
      const key = g.nodes[id].ref as keyof typeof lon;
      const p = skyRingPosition(lon[key]!);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(SKY_RING_RADIUS, 3);
      // drawn as a chart: longitude counter-clockwise, y downward
      const back = ((Math.atan2(-p.y, p.x) * 180) / Math.PI + 360) % 360;
      expect(Math.abs(((back - lon[key]! + 540) % 360) - 180)).toBeLessThan(1e-4);
    }
    expect(skyRingPosition(0)).toEqual({ x: SKY_RING_RADIUS, y: 0 });
    expect(skyRingPosition(90).x).toBeCloseTo(0, 6);
    expect(skyRingPosition(90).y).toBeCloseTo(-SKY_RING_RADIUS, 6);
  });

  it('puts the Sun at its true place: opposite the Earth\u2019s heliocentric longitude', () => {
    const sun = eph.sunGeo(MS)!;
    const earth = eph.helio('earth', MS)!;
    const diff = Math.abs(((sun.lon - (earth.lon + 180) + 540) % 360) - 180);
    expect(diff).toBeLessThan(0.05);
    expect(lon.sun).toBeCloseTo(sun.lon, 6);
  });
});

describe('sky anchors honour the graph\u2019s existing rules', () => {
  const skyEdge = g.edges.find((e) => e.kind === 'sky')!;

  it('follows the relation filters: a sky strand is allowed only for the bases that are on', () => {
    expect(edgeAllowed(skyEdge, undefined)).toBe(true);
    expect(edgeAllowed(skyEdge, [skyEdge.basis!])).toBe(true);
    const others = (['jung', 'inferred', 'site'] as const).filter((b) => b !== skyEdge.basis);
    expect(edgeAllowed(skyEdge, others)).toBe(false);
    expect(edgeAllowed(skyEdge, [])).toBe(false);
  });

  it('shows no sky strand in the whole graph when its relation is off, but keeps the bodies', () => {
    const none = globalSet(g, false, []);
    expect(none.edges.some((k) => g.edges[k].kind === 'sky')).toBe(false);
    expect(g.bodyIds.every((i) => none.dist.has(i))).toBe(true);
    const jung = globalSet(g, false, ['jung']);
    expect(jung.edges.filter((k) => g.edges[k].kind === 'sky').every((k) => g.edges[k].basis === 'jung')).toBe(true);
  });

  it('reaches a body from its family in a local graph only through an allowed relation', () => {
    const e = g.edges.find((x) => x.kind === 'sky' && g.nodes[x.t].kind === 'family')!;
    const fam = e.t;
    const body = e.s;
    expect(neighbourhood(g, [fam], { depth: 1, tieBases: [e.basis!] }).dist.has(body)).toBe(true);
    expect(neighbourhood(g, [fam], { depth: 1, tieBases: [] }).dist.has(body)).toBe(false);
  });

  it('keeps the cap: a ceiling is a ceiling, with bodies in the graph', () => {
    const self = g.byKey.get('a:self')!;
    for (const cap of [12, 40, 120]) {
      const nb = neighbourhood(g, [self], { depth: 3, cap, occurrences: true });
      expect(nb.dist.size).toBeLessThanOrEqual(cap);
    }
    const same = neighbourhood(base, [base.byKey.get('a:self')!], { depth: 2, cap: 380 });
    const withSky = neighbourhood(g, [g.byKey.get('a:self')!], { depth: 2, cap: 380 });
    expect(withSky.dist.size).toBeLessThanOrEqual(380);
    // the field's own nodes keep their distances unless a body stood between them
    for (const [id, d] of same.dist) if (withSky.dist.has(id)) expect(withSky.dist.get(id)!).toBeLessThanOrEqual(d);
  });

  it('leaves time playback alone: the field\u2019s liveness is unchanged and bodies are not bound to a year', () => {
    const w = { cursorU: 0.5, ramp: DEFAULT_RAMP, trail: DEFAULT_TRAIL, on: 1 };
    const a = nodeLiveness(base, model, w);
    const b = nodeLiveness(g, model, w);
    for (let i = 0; i < base.nodes.length; i++) expect(b[i]).toBe(a[i]);
    for (const id of g.bodyIds) expect(b[id]).toBe(1);
  });

  it('counts the bodies as part of the whole graph without disturbing the field\u2019s own count', () => {
    const whole = globalSet(g, true);
    expect(whole.dist.size).toBe(g.nodes.length);
    expect(globalSet(base, true).dist.size).toBe(base.nodes.length);
  });
});
