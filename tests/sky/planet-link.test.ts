import { describe, expect, it } from 'vitest';
import { bodyOfGod, type BodyCards, type SkyCardsData } from '../../src/sky/cards';
import type { BodyKey } from '../../src/types/sky';

const body = (...gods: string[]): BodyCards => ({
  gods: gods.map((family) => ({ family, basis: 'jung', voice: 'Jung', quotes: [] })),
  position: null, sephira: null, positionQuotes: [], decans: [], ranks: [], majors: [], elements: [], abyss: false,
});

const data = {
  version: 1, list: null, tree: [], suits: [], cards: {}, uncited: [],
  bodies: {
    sun: body('sun'), moon: body('moon'), mercury: body('mercurius'), venus: body('venus'), mars: body('mars'),
    jupiter: body('jupiter'), saturn: body('saturn'),
    terra: { ...body(), elements: ['fire', 'water', 'air', 'earth-element'] },
    uranus: body(), neptune: body(), pluto: body(),
  } satisfies Partial<Record<BodyKey, BodyCards>>,
} as unknown as SkyCardsData;

describe('a planet\'s family is a link to its body in the sky', () => {
  it('maps each classical god family to its body (Mercurius is Mercury)', () => {
    expect(bodyOfGod(data, 'sun')).toBe('sun');
    expect(bodyOfGod(data, 'moon')).toBe('moon');
    expect(bodyOfGod(data, 'mercurius')).toBe('mercury');
    expect(bodyOfGod(data, 'venus')).toBe('venus');
    expect(bodyOfGod(data, 'mars')).toBe('mars');
    expect(bodyOfGod(data, 'jupiter')).toBe('jupiter');
    expect(bodyOfGod(data, 'saturn')).toBe('saturn');
  });

  it('leaves the others as links into the field: the elemental Earth, signs, sephiroth, cards', () => {
    for (const id of ['earth-element', 'fire', 'aries', 'binah', 'thoth-five-of-wands', 'quaternity']) expect(bodyOfGod(data, id)).toBeNull();
  });

  it('never names the Earth as a body, and reads a missing file as no link', () => {
    const odd = { ...data, bodies: { ...data.bodies, terra: body('earth-element') } } as SkyCardsData;
    expect(bodyOfGod(odd, 'earth-element')).toBeNull();
    expect(bodyOfGod(null, 'mars')).toBeNull();
    expect(bodyOfGod(undefined, 'mars')).toBeNull();
  });
});
