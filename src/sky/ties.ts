// The small index of body ↔ field ties (public/data/sky.ties.json, derived from sky.json by the generator), so Earth
// mode can show a quiet glyph on a family's reveal without fetching the sky's 2 MB of grids.
import type { TieBasis } from '../types/field';
import type { BodyKey } from '../types/sky';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

export interface TiesIndex {
  meta: { generatedAt: string; from: string };
  bodies: { key: BodyKey; name: string; order: number; modern: boolean; palette: { core: string; glow: string }; spectrum: number }[];
  ties: { body: BodyKey; type: 'family' | 'archetype'; id: string; basis: TieBasis }[];
  readings: { id: string; bodies: BodyKey[]; targets: { type: 'family' | 'archetype'; id: string }[]; basis: TieBasis }[];
}

export interface BodyTie { body: BodyKey; name: string; basis: TieBasis }

/** The planets' conventional signs, as text (never the emoji presentation). The Earth's is the astronomers' ⊕. */
export const BODY_GLYPH: Record<BodyKey, string> = {
  sun: '☉', moon: '☽', earth: '⊕', mercury: '☿', venus: '♀', mars: '♂', jupiter: '♃', saturn: '♄', uranus: '♅', neptune: '♆', pluto: '♇',
};
export const glyphOf = (key: BodyKey): string => `${BODY_GLYPH[key]}\uFE0E`;

export function bodyTiesFor(index: TiesIndex, type: 'family' | 'archetype', id: string): BodyTie[] {
  const names = new Map(index.bodies.map((b) => [b.key, b]));
  return index.ties
    .filter((t) => t.type === type && t.id === id)
    .sort((a, b) => (names.get(a.body)?.order ?? 99) - (names.get(b.body)?.order ?? 99))
    .map((t) => ({ body: t.body, name: names.get(t.body)?.name ?? t.body, basis: t.basis }));
}

/** Lazy, once. A missing index is absence — the reveal simply shows no glyph. */
export class SkyTies {
  private index: TiesIndex | null = null;
  private pending: Promise<TiesIndex | null> | null = null;

  get loaded(): TiesIndex | null { return this.index; }

  ensure(): Promise<TiesIndex | null> {
    this.pending ??= fetch(`${BASE}/data/sky.ties.json`)
      .then(async (res) => {
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || type.includes('text/html')) return null;
        const j = (await res.json()) as TiesIndex;
        return Array.isArray(j?.ties) && Array.isArray(j?.bodies) ? (this.index = j) : null;
      })
      .catch(() => null);
    return this.pending;
  }

  forFamily(id: string): BodyTie[] {
    return this.index ? bodyTiesFor(this.index, 'family', id) : [];
  }
}
