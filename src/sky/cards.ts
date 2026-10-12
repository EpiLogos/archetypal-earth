// The card rings' data (public/data/sky-cards.json, built by scripts/sky-cards.mjs from the field's joins) and the
// plain functions the rings are laid out with. Nothing here draws: orbits.ts draws, the Astrology lens reads. A card is
// where the field's own joins put it — a decan's pip card at that decan's ecliptic longitude on its ruler's wheel, the
// four cards of a sephira's number on the rank ring, with the Atu the field joins to the planet.
import type { BodyKey } from '../types/sky';
import type { TieBasis } from '../types/field';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

export interface CardPlate {
  src: string;
  thumb: string;
  width: number;
  height: number;
  tone?: string;
  title?: string;
  credit?: string;
  license?: string;
  sourceUrl?: string;
}

export interface CardInfo {
  name: string;
  kind: 'major' | 'pip';
  image: CardPlate;
  /** a pip's rank (1 = Ace … 10), its suit and the element that suit stands for */
  number?: number;
  suit?: string;
  element?: string | null;
  /** the sign (Aries 0 … Pisces 11) a decan card or a sign's Atu stands in; a decan card also its decan and start longitude */
  sign?: number;
  n?: number;
  lon?: number;
  decan?: string | null;
}

export interface PlacedQuote {
  text: string;
  cite: { work: string; workTitle: string; locator: string; print?: string };
  voice?: string;
}

export interface DecanCard { card: string; decan: string; sign: number; n: number; lon: number; joins: string[] }
export interface RankCard { card: string; suit: string; number: number; joins: string[] }
export interface MajorCard { card: string; via: 'planet' | 'ruler' | 'element'; sign?: number; element?: string; joins: string[] }

export interface BodyCards {
  gods: { family: string; basis: TieBasis | null; voice: string | null; quotes: PlacedQuote[] }[];
  position: number | null;
  sephira: string | null;
  positionQuotes: PlacedQuote[];
  decans: DecanCard[];
  ranks: RankCard[];
  majors: MajorCard[];
  elements: string[];
  abyss: boolean;
  note?: string;
}

export interface SkyCardsData {
  version: 1;
  list: PlacedQuote | null;
  tree: string[];
  suits: { suit: string; element: string | null }[];
  bodies: Partial<Record<BodyKey, BodyCards>>;
  cards: Record<string, CardInfo>;
  /** joins the rings use that have no placed quotation in the field pages: said, never dressed as sourced */
  uncited: string[];
}

let pending: Promise<SkyCardsData | null> | null = null;

/** Lazy, once. A missing file is absence — the planets simply carry no card rings. */
export function loadSkyCards(): Promise<SkyCardsData | null> {
  pending ??= fetch(`${BASE}/data/sky-cards.json`)
    .then(async (res) => {
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || type.includes('text/html')) return null;
      const j = (await res.json()) as SkyCardsData;
      return j && typeof j === 'object' && j.bodies && j.cards ? j : null;
    })
    .catch(() => null);
  return pending;
}

export function imageUrl(plate: CardPlate, thumb = true): string {
  return `${BASE}/${(thumb ? plate.thumb : plate.src).replace(/^\//, '')}`;
}

// ── layout ────────────────────────────────────────────────────────────────

export interface RingCard {
  id: string;
  /** which ring: the decan wheel (a card sits at its decan's longitude) or the rank ring (spread round) */
  ring: 'decan' | 'rank';
  /** what it stands as on that ring */
  role: 'decan' | 'rank' | 'planet' | 'ruler' | 'element';
  /** the ecliptic longitude it hangs at, degrees; for the rank ring, where the spread put it */
  lon: number;
  /** a decan card's own span (start longitude), so the wheel can say where the planet stands now */
  decan?: number;
  /** the longitude its tint is taken from: the sign's own colour on the ring, at the card's place */
  tintLon: number;
}

export interface BodyRings {
  decan: RingCard[];
  rank: RingCard[];
}

/**
 * The turn (degrees) at which `n` cards spread evenly round a ring stand farthest from the given longitudes: the largest
 * least angular distance, tried every 5°, the first such turn winning. 45 when there is nothing to stand apart from.
 */
export function restAngle(n: number, away: number[]): number {
  if (n <= 0 || !away.length) return 45;
  const step = 360 / n;
  const gap = (a: number, b: number) => { const d = Math.abs((((a - b) % 360) + 540) % 360 - 180); return 180 - d; };
  let best = 45;
  let bestGap = -1;
  for (let t = 0; t < Math.min(step, 360); t += 5) {
    let least = Infinity;
    for (let i = 0; i < n; i++) for (const a of away) least = Math.min(least, gap(t + i * step, a));
    if (least > bestGap + 1e-9) { bestGap = least; best = t; }
  }
  return best;
}

/**
 * The two card rings of a body. The decan ring is the zodiac in little: each pip card at the middle of its ten degrees.
 * The rank ring holds, in order, the Atu the field joins to the planet itself, those of a sign it rules, and the four
 * cards of its number in Crowley's suit order. A body with no card in the data has no rings.
 */
export function ringsFor(data: SkyCardsData | null, key: BodyKey): BodyRings | null {
  const b = data?.bodies[key];
  if (!b || !data) return null;
  const decan: RingCard[] = b.decans
    .filter((d) => data.cards[d.card])
    .map((d) => ({ id: d.card, ring: 'decan', role: 'decan', lon: d.lon + 5, decan: d.lon, tintLon: d.lon + 5 }));
  const order: { id: string; role: RingCard['role']; sign?: number }[] = [
    ...b.majors.filter((m) => m.via === 'planet' || m.via === 'element').map((m) => ({ id: m.card, role: (m.via === 'element' ? 'element' : 'planet') as RingCard['role'] })),
    ...b.majors.filter((m) => m.via === 'ruler').map((m) => ({ id: m.card, role: 'ruler' as const, sign: m.sign })),
    ...b.ranks.map((r) => ({ id: r.card, role: 'rank' as const })),
  ].filter((x) => data.cards[x.id]);
  // the rank ring is not a longitude, so its spread is turned to stand as far from the decan cards as it can (they would
  // otherwise meet on the screen where a decan's longitude and a rank card's place happen to agree)
  const start = restAngle(order.length, decan.map((d) => d.lon));
  const rank: RingCard[] = order.map((x, i) => {
    const lon = (start + (i / Math.max(1, order.length)) * 360) % 360;
    const info = data.cards[x.id];
    // the tint is the sign's own colour where the card has a sign, else the colour of the place the spread gave it
    const sign = x.sign ?? info.sign;
    return { id: x.id, ring: 'rank', role: x.role, lon, tintLon: sign === undefined ? lon : sign * 30 + 15 };
  });
  if (!decan.length && !rank.length) return null;
  return { decan, rank };
}

/** Which of a body's decans (0 … 35) an ecliptic longitude stands in. */
export function decanOf(lon: number): number {
  return Math.floor((((lon % 360) + 360) % 360) / 10);
}

/** The ties the cards give the sky (card → body), in the shape the sky's tie index holds, for `See in sky` on a card. */
export function cardTies(data: SkyCardsData): { body: BodyKey; type: 'family'; id: string; basis: TieBasis }[] {
  const out: { body: BodyKey; type: 'family'; id: string; basis: TieBasis }[] = [];
  const seen = new Set<string>();
  const add = (body: BodyKey, id: string) => {
    const k = `${body}|${id}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ body, type: 'family', id, basis: 'site' });
  };
  for (const [key, b] of Object.entries(data.bodies) as [BodyKey, BodyCards][]) {
    for (const d of b.decans) add(key, d.card);
    for (const r of b.ranks) add(key, r.card);
    for (const m of b.majors) add(key, m.card);
    for (const e of b.elements) add(key, e);
    if (b.sephira) add(key, b.sephira);
  }
  return out;
}

/**
 * The planetary body a field family is the god of, or null: Mars the family is the body Mars, Mercurius the body Mercury.
 * Read from the bodies' own gods in the cards data, which is where the tie curation puts them (sun → sun, moon → moon,
 * mercury → mercurius, … saturn → saturn); a family that is no body's god (the elemental Earth, a sign, a sephira, an Atu)
 * has none and stays a link into the field. A card's planet link goes to the body in the sky with this; the body's own
 * reading carries its Earth relations from there.
 */
export function bodyOfGod(data: SkyCardsData | null | undefined, family: string): BodyKey | null {
  if (!data) return null;
  for (const [key, b] of Object.entries(data.bodies) as [BodyKey, BodyCards][]) {
    if (key !== 'terra' && b.gods.some((g) => g.family === family)) return key;
  }
  return null;
}
