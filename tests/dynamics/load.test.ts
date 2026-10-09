import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDynamics, parseDynamics } from '../../src/dynamics/load';

const good = {
  version: 1,
  concepts: [{
    id: 'c1', name: 'Placeholder', familyIds: ['serpent'], render: 'julia',
    quote: { text: 'PLACEHOLDER', cite: { workTitle: 'Work', year: '1997', locator: 'p. 1', work: 'cw09ii' } },
    jung: { text: 'PLACEHOLDER', cite: { workTitle: 'CW', year: '1950', locator: '¶1' } },
  }],
};
const response = (status: number, type: string, body: unknown = null) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': type } });

describe('the optional dynamics data', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses a well-formed file', () => {
    const d = parseDynamics(good);
    expect(d.concepts[0].render).toBe('julia');
    expect(d.concepts[0].quote.cite.work).toBe('cw09ii');
    expect(d.concepts[0].jung?.cite.locator).toBe('¶1');
  });

  it('fails loudly on a malformed file', () => {
    expect(() => parseDynamics({ version: 2, concepts: [] })).toThrow();
    expect(() => parseDynamics({ version: 1, concepts: [{ ...good.concepts[0], quote: { text: '', cite: good.concepts[0].quote.cite } }] })).toThrow(/quote\.text/);
    expect(() => parseDynamics({ version: 1, concepts: [{ ...good.concepts[0], render: 'mandala' }] })).toThrow(/native render/);
  });

  it('is absent (null, silently) on a 404, on the dev server HTML fallback, and with no network', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadDynamics(async () => response(404, 'text/plain', 'nope'))).toBeNull();
    expect(await loadDynamics(async () => response(200, 'text/html', '<!doctype html>'))).toBeNull();
    expect(await loadDynamics(async () => { throw new TypeError('offline'); })).toBeNull();
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns the parsed data when the file is there', async () => {
    const d = await loadDynamics(async () => response(200, 'application/json', good));
    expect(d?.concepts).toHaveLength(1);
  });
});
