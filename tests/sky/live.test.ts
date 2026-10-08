import { describe, expect, it } from 'vitest';
import sky from '../../public/data/sky.json';
import { SkyEphemeris } from '../../src/sky/ephemeris';
import { describeLive, LIVE_TOLERANCE, SkyLive, type LiveState } from '../../src/sky/live';
import type { SkyData } from '../../src/types/sky';

const eph = new SkyEphemeris(sky as unknown as SkyData);
const NOW = Date.parse('2026-10-08T16:40:00Z');

const answer = (offsetSun = 0, offsetMoon = 0, atMs = NOW) => {
  const sun = eph.sunGeo(atMs)!;
  const moon = eph.moon(atMs)!;
  return { iso: new Date(atMs).toISOString(), sun: { lon: sun.lon + offsetSun }, moon: { lon: moon.lon + offsetMoon } };
};
const respond = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
const never = (async () => { throw new Error('connection refused'); }) as unknown as typeof fetch;
const make = (fetchImpl: typeof fetch, over: { local?: boolean; now?: number } = {}) => {
  const changes: LiveState[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const live = new SkyLive(eph, {
    base: 'http://127.0.0.1:5187', local: over.local ?? true, fetch: fetchImpl, now: () => over.now ?? NOW,
    onChange: (s) => changes.push(s),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => undefined,
  });
  return { live, changes, timers };
};

describe('the sky\u2019s live state is a labelled state, never silence', () => {
  it('is live when the sidecar agrees with the generated grids, and then follows the clock', async () => {
    const { live } = make(respond(answer(0.001, 0.003)));
    const s = await live.poll();
    expect(s.kind).toBe('live');
    expect(live.following).toBe(true);
    expect(live.moment()).toBe(NOW);
    expect(describeLive(s).label).toBe('Live');
    expect(describeLive(s).detail).toMatch(/checked against the sidecar at 16:40 UTC/);
  });

  it('is a snapshot, frozen at the moment it was taken, when no sidecar answers', async () => {
    const { live } = make(never);
    const s = await live.poll();
    expect(s).toEqual({ kind: 'snapshot', asOf: NOW, why: 'absent' });
    expect(live.following).toBe(false);
    const text = describeLive(s);
    expect(text.label).toBe('Snapshot');
    expect(text.detail).toMatch(/as of 2026-10-08 16:40 UTC; it does not follow the clock/);
    expect(text.detail).toMatch(/sidecar is not running/);
  });

  it('keeps the first snapshot\u2019s moment through later failed asks (it is a moment, not a clock)', async () => {
    let t = NOW;
    const live = new SkyLive(eph, { base: 'x', local: true, fetch: never, now: () => t, setTimer: () => 0, clearTimer: () => undefined });
    await live.poll();
    t = NOW + 3_600_000;
    const s = await live.poll();
    expect(s.kind === 'snapshot' && s.asOf).toBe(NOW);
  });

  it('does not try at all from a page that cannot reach a local sidecar, and says why', () => {
    let asked = 0;
    const { live } = make((async () => { asked++; throw new Error('no'); }) as unknown as typeof fetch, { local: false });
    live.start();
    expect(asked).toBe(0);
    expect(live.state).toEqual({ kind: 'snapshot', asOf: NOW, why: 'not-local' });
    expect(describeLive(live.state).detail).toMatch(/only reachable when the site runs beside its local sidecar/);
    live.stop();
  });

  it('refuses to call the sky live when the sidecar disagrees with the grids, and states by how much', async () => {
    const { live } = make(respond(answer(LIVE_TOLERANCE.sun * 4, 0)));
    const s = await live.poll();
    expect(s.kind).toBe('diverged');
    expect(live.following).toBe(false);
    expect(describeLive(s).detail).toMatch(/sidecar disagrees/);
    expect(describeLive(s).detail).toMatch(/Sun 0\.200°/);
  });

  it('does not compare two different instants: a sidecar clock far from the page\u2019s is not a check', async () => {
    const { live } = make(respond(answer(0, 0, NOW + 3_600_000)));
    expect((await live.poll()).kind).toBe('snapshot');
  });

  it('treats a malformed or failing answer as unsupported, not as live', async () => {
    expect((await make(respond({ nonsense: true })).live.poll())).toMatchObject({ kind: 'snapshot', why: 'unsupported' });
    expect((await make(respond({}, false)).live.poll())).toMatchObject({ kind: 'snapshot', why: 'unreachable' });
  });

  it('says plainly that the moment lies beyond the generated sky, without asking', async () => {
    let asked = 0;
    const { live } = make((async () => { asked++; return {} as Response; }) as unknown as typeof fetch, { now: Date.parse('2044-05-01T00:00:00Z') });
    const s = await live.poll();
    expect(asked).toBe(0);
    expect(s.kind).toBe('beyond');
    expect(describeLive(s).label).toBe('Beyond the generated sky');
    expect(describeLive(s).detail).toMatch(/outside 2015–2039/);
  });

  it('polls slowly: a minute while it answers, five when it does not', async () => {
    const wait = () => new Promise((r) => setTimeout(r, 10));
    const a = make(respond(answer()));
    a.live.start();
    await wait();
    expect(a.live.state.kind).toBe('live');
    expect(a.timers.filter((t) => t.ms > 2500).map((t) => t.ms)).toEqual([60_000]);
    a.live.stop();
    const b = make(never);
    b.live.start();
    await wait();
    expect(b.timers.filter((t) => t.ms > 2500).map((t) => t.ms)).toEqual([300_000]);
    b.live.stop();
  });

  it('reports a change once, not on every poll', async () => {
    let up = true;
    const flaky = (async () => { if (!up) throw new Error('gone'); return { ok: true, json: async () => answer() } as Response; }) as unknown as typeof fetch;
    const { live, changes } = make(flaky);
    await live.poll();
    await live.poll();
    expect(changes.map((c) => c.kind)).toEqual(['live']);
    up = false;
    await live.poll();
    await live.poll();
    await live.poll();
    expect(changes.map((c) => c.kind)).toEqual(['live', 'snapshot']);
  });
});
