// H5, Astrology: the lens's Contents. The charts first (the visitor's own is spoken to), then the planets of the walked chart with
// the placement the chart gives each; the chart or planet the lens stands on is marked; a pick goes to its own route.
import { describe, expect, it } from 'vitest';
import { astrologyContentsGroups, skyName, type ChartListing, type PlanetListing } from '../../src/lenses/astrology-contents';

const you: ChartListing = { id: 'you', label: 'You', own: true };
const jung: ChartListing = { id: 'jung', label: 'C. G. Jung', own: false };
const planets: PlanetListing[] = [{ key: 'moon', name: 'Moon', placement: 'Aries 14°' }, { key: 'sun', name: 'Sun', placement: 'Leo 3°' }];
const marked = (at: string[], walked = jung) => astrologyContentsGroups([you, jung], walked, planets, at, () => {}).flatMap((g) => g.items.filter((i) => i.current).map((i) => i.label));

describe('the Astrology Contents', () => {
  it('names the charts, the visitor\'s own spoken to', () => {
    expect(skyName(you)).toBe('Your sky');
    expect(skyName(jung)).toBe('C. G. Jung’s sky');
    const g = astrologyContentsGroups([you, jung], jung, planets, [], () => {});
    expect(g.map((x) => x.title)).toEqual(['Charts', 'C. G. Jung’s planets']);
    expect(g[0].items.map((i) => i.label)).toEqual(['Charts', 'Your sky', 'C. G. Jung’s sky']);
  });

  it('lists the walked chart\'s planets in the walk\'s order, each with its placement; none when there is no chart', () => {
    const g = astrologyContentsGroups([you], you, planets, [], () => {});
    expect(g[1].title).toBe('Your planets');
    expect(g[1].items.map((i) => `${i.label} ${i.note}`)).toEqual(['Moon Aries 14°', 'Sun Leo 3°']);
    expect(astrologyContentsGroups([], null, [], [], () => {}).map((x) => x.title)).toEqual(['Charts']);
  });

  it('marks where the lens stands', () => {
    expect(marked([])).toEqual(['Charts']);
    expect(marked(['jung'])).toEqual(['C. G. Jung’s sky']);
    expect(marked(['jung', 'sun'])).toEqual(['Sun']);
    expect(marked(['you', 'sun'], jung)).toEqual([]);
    expect(marked(['sky'])).toEqual([]);
  });

  it('a pick goes to the route: a chart to its sky, a planet to its reading in the walked chart', () => {
    const log: string[][] = [];
    const g = astrologyContentsGroups([you, jung], jung, planets, [], (p) => { log.push(p); });
    g[0].items[0].onPick();
    g[0].items[2].onPick();
    g[1].items[1].onPick();
    expect(log).toEqual([[], ['jung'], ['jung', 'sun']]);
  });
});
