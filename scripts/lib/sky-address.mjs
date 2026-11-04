// Where the field's sky-tied nodes hang: the one derivation the card rings (scripts/sky-cards.mjs) and the occurrences'
// extraterrestrial placement (scripts/ingest.mjs → Occurrence.sky) both read, so a ring and a place cannot disagree.
//
// Nothing is authored here. The decans, the pip cards, the Atu and the sephiroth are placed by the field's own joins;
// the body each sephira stands on, the god family of each body and the bodies' elements come from curation/sky/cards.json
// (every line of it a quotation placed in the corpus). A node the joins do not put anywhere has no address and is not
// given one: absence is carried, never filled.
//
// The geometry is the card rings' own (src/sky/cards.ts): a decan wheel at true ecliptic longitude, a rank ring that is
// not a longitude, the planet itself, the zodiac.
export const BODY_KEYS = ['sun', 'moon', 'terra', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
/** The Tree as Crowley numbers it: the sephira of each number, one to ten. */
export const TREE = ['kether', 'chokmah', 'binah', 'chesed', 'geburah', 'tiphareth', 'netzach', 'hod', 'yesod', 'malkuth'];
export const SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
/** The suits in Crowley's order (the Aces' order too): Wands, Cups, Swords, Disks. */
export const SUITS = ['wands', 'cups', 'swords', 'disks'];
export const ELEMENT_OF_SUIT = { wands: 'fire', cups: 'water', swords: 'air', disks: 'earth-element' };
const WORD = { ace: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export const COURTS = ['knight', 'queen', 'prince', 'princess'];
export const RINGS = ['body', 'wheel', 'rank', 'zodiac', 'pole'];

/** `decan-aries-2` → { sign: 0, n: 2, lon: 10 }. */
export function parseDecan(id) {
  const m = /^decan-([a-z]+)-([123])$/.exec(id);
  if (!m || !SIGNS.includes(m[1])) return null;
  const sign = SIGNS.indexOf(m[1]);
  const n = Number(m[2]);
  return { sign, n, lon: sign * 30 + (n - 1) * 10 };
}
/** `thoth-two-of-wands` → { number: 2, suit: 'wands' }. */
export function parseRank(id) {
  const m = /^thoth-([a-z]+)-of-(wands|cups|swords|disks)$/.exec(id);
  if (!m || !(m[1] in WORD)) return null;
  return { number: WORD[m[1]], suit: m[2] };
}
/** `thoth-queen-of-cups` → { court: 'queen', suit: 'cups' }. */
export function parseCourt(id) {
  const m = /^thoth-(knight|queen|prince|princess)-of-(wands|cups|swords|disks)$/.exec(id);
  return m ? { court: m[1], suit: m[2] } : null;
}

/**
 * A Knight's, Queen's or Prince's thirty degrees: from the 20th of one sign to the 20th of the next, the pair of adjacent
 * signs the field joins it to. `first` is the sign it enters at its 21st degree, `main` the next, which holds two of its
 * three decans. Null (with the reason in `error`) for any other card or a pair that is not adjacent.
 */
export function courtSpan(joined, id) {
  const c = parseCourt(id);
  if (!c || c.court === 'princess') return null;
  const s = joined(id).map((j) => ({ idx: SIGNS.indexOf(j.other), j })).filter((x) => x.idx >= 0);
  if (s.length !== 2) return s.length ? { error: `${id}: joined to ${s.length} signs, not the two a court card spans` } : null;
  const [a, b] = s.map((x) => x.idx);
  const first = (a + 1) % 12 === b ? a : (b + 1) % 12 === a ? b : null;
  if (first === null) return { error: `${id}: joined signs ${SIGNS[a]} and ${SIGNS[b]} are not adjacent` };
  return { first, main: (first + 1) % 12, lon: (first * 30 + 20) % 360, joins: s.map((x) => x.j.id) };
}

/** Every join as an index: family id → [{ other, id, system }] (both ends), family-to-family only. */
export function joinIndex(joins) {
  const out = new Map();
  for (const j of joins) {
    const a = j.a?.type === 'family' ? j.a.id : null;
    const b = j.b?.type === 'family' ? j.b.id : null;
    if (!a || !b) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!out.has(x)) out.set(x, []);
      out.get(x).push({ other: y, id: j.id, system: j.system, basis: j.basis });
    }
  }
  return out;
}

/**
 * The geometry of every body's rings, from the field's joins and curation/sky/cards.json. `famName(id)` is the family's
 * display name (an Atu is a family whose name begins "Atu "). Returns what the sky-cards file and the occurrences share:
 *   bodies[key] = { god, position, sephira, decans, ranks, majors, elements, abyss, note? }
 * with each card carrying the join ids it rests on, and `used` the set of card ids drawn anywhere.
 */
export function deriveCardGeometry({ cur, famIds, famName, joined, errors }) {
  const has = (id) => famIds.has(id);
  const isMajor = (id) => /^Atu /.test(famName(id) ?? '') && id.startsWith('thoth-');
  const used = new Set();
  const bodies = {};

  for (const key of BODY_KEYS) {
    const c = cur.bodies[key];
    if (!c) continue;
    const out = { god: c.god ? { ...c.god } : null, position: c.position ?? null, sephira: null, decans: [], ranks: [], majors: [], courts: [], elements: [], abyss: !!c.abyss, ...(c.note ? { note: c.note } : {}) };
    if (c.position) {
      out.sephira = TREE[c.position - 1];
      if (!has(out.sephira)) errors.push(`body ${key}: the field has no family ${out.sephira}`);
    }

    if (c.god) {
      const gf = c.god.family;
      if (!has(gf)) errors.push(`body ${key}: the field has no family ${gf}`);
      // decans: the planet's family ↔ decan family ↔ pip card
      for (const j of joined(gf)) {
        const d = parseDecan(j.other);
        if (!d) continue;
        const cardJoin = joined(j.other).find((x) => x.system === 'thoth' && x.other.startsWith('thoth-') && parseRank(x.other));
        if (!cardJoin) { errors.push(`${j.other}: no pip card joined`); continue; }
        used.add(cardJoin.other);
        out.decans.push({ card: cardJoin.other, decan: j.other, sign: d.sign, n: d.n, lon: d.lon, joins: [j.id, cardJoin.id] });
      }
      out.decans.sort((a, b) => a.lon - b.lon);

      // majors: the Atu joined to the god's family — attributed to the planet itself, or to a sign it rules
      for (const j of joined(gf)) {
        if (!isMajor(j.other)) continue;
        const sign = joined(j.other).map((x) => SIGNS.indexOf(x.other)).find((i) => i >= 0);
        used.add(j.other);
        out.majors.push({ card: j.other, via: sign === undefined ? 'planet' : 'ruler', ...(sign === undefined ? {} : { sign }), joins: [j.id] });
      }
      out.majors.sort((a, b) => (a.via === b.via ? a.card.localeCompare(b.card) : a.via === 'planet' ? -1 : 1));
    }

    // rank: the cards joined to the body's sephira, one per suit, in Crowley's suit order
    if (out.sephira) {
      for (const j of joined(out.sephira)) {
        const r = parseRank(j.other);
        if (!r || r.number !== c.position) continue;
        used.add(j.other);
        out.ranks.push({ card: j.other, suit: r.suit, number: r.number, joins: [j.id] });
      }
      out.ranks.sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
      if (out.ranks.length !== 4) errors.push(`body ${key}: ${out.sephira} carries ${out.ranks.length} cards of its number, not four`);
    }

    if (c.elements) {
      for (const e of c.elements) if (!has(e)) errors.push(`body ${key}: the field has no family ${e}`);
      out.elements = [...c.elements];
      // the Atu the field gives an element and no sign (the Fool to Air, the Hanged Man to Water, the Aeon to Fire, the
      // Universe to Earth): a sign's Atu that only stands in an element by its sign (the Chariot) is not the element's own
      for (const e of c.elements) {
        for (const j of joined(e)) {
          if (!isMajor(j.other) || joined(j.other).some((x) => SIGNS.includes(x.other))) continue;
          used.add(j.other);
          out.majors.push({ card: j.other, via: 'element', element: e, joins: [j.id] });
        }
      }
      // the Princesses: no sign (Crowley, Book of Thoth p140), each the earthy part of her element; they stand where the
      // four elements stand, at the Earth Crowley's list numbers ten
      for (const e of c.elements) {
        for (const j of joined(e)) {
          const ct = parseCourt(j.other);
          if (ct?.court !== 'princess') continue;
          used.add(j.other);
          out.courts.push({ card: j.other, court: ct.court, suit: ct.suit, element: e, joins: [j.id] });
        }
      }
      out.courts.sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
    }
    bodies[key] = out;
  }

  // the signs a planet rules, as Burt names each sign's mundane ruler (sign ↔ the planet's god, system burt): the Atu of
  // the sign stands at its ruler where the field does not join the Atu to a planet itself (Art at Jupiter, the Star at
  // Saturn), and so does the court card whose span lies mostly in the sign (the Queen of Cups, Gemini 21° to Cancer 20°,
  // at the Moon). Every card of the deck has a planet to be read at.
  const direct = new Set(Object.values(bodies).flatMap((b) => b.majors.map((m) => m.card)));
  const signOfAtu = (id) => joined(id).map((x) => SIGNS.indexOf(x.other)).find((i) => i >= 0);
  for (const key of BODY_KEYS) {
    const c = cur.bodies[key];
    const out = bodies[key];
    if (!c?.god || !out) continue;
    for (const r of joined(c.god.family).filter((j) => j.system === 'burt' && SIGNS.includes(j.other))) {
      const sign = SIGNS.indexOf(r.other);
      for (const j of joined(r.other)) {
        if (isMajor(j.other) && !direct.has(j.other) && signOfAtu(j.other) === sign) {
          used.add(j.other);
          out.majors.push({ card: j.other, via: 'ruler', sign, joins: [j.id, r.id] });
          continue;
        }
        const span = courtSpan(joined, j.other);
        if (!span || span.error || span.main !== sign) continue;
        used.add(j.other);
        const ct = parseCourt(j.other);
        out.courts.push({ card: j.other, court: ct.court, suit: ct.suit, sign, from: span.lon, joins: [...span.joins, r.id] });
      }
    }
    out.majors.sort((a, b) => (a.via === b.via ? a.card.localeCompare(b.card) : a.via === 'planet' ? -1 : 1));
    out.courts.sort((a, b) => (a.sign ?? 0) - (b.sign ?? 0) || COURTS.indexOf(a.court) - COURTS.indexOf(b.court));
  }
  return { bodies, used, isMajor };
}

/**
 * The extraterrestrial address of every family the joins and the card curation place: family id → { loci, ruled }.
 * `loci` are { body?, ring, lon?, span?, slot?, basis, via[] } in order of how exactly the source puts them; `ruled`
 * is not used by callers but kept for tests (the join ids the address rests on).
 *
 *   decan-<sign>-<n>          the zodiac, ten degrees from its start
 *   <sign>                    the zodiac, thirty degrees
 *   thoth pip 2–10            its ruler's decan wheel at its decan's span, and the rank ring of its number's body
 *   thoth Ace                 the rank ring of the body whose number is one
 *   Atu via planet/ruler/el.  the rank ring of that body (a sign's ruler as Burt names it, where the field joins the Atu to
 *                             no planet itself); with a sign join, also the sign's span
 *   Atu with a sign, no ring  the zodiac, the sign's span
 *   knight/queen/prince       the rank ring of the ruler of the sign holding most of its span, and the thirty degrees
 *                             from the 20th of one sign to the 20th of the next (the two signs the field joins are adjacent)
 *   princess                  the rank ring of the Earth, with the elements, and the heavens round the North Pole, the
 *                             quadrant of her suit (Crowley, Book of Thoth p147)
 *   a sephira                 the body that carries its number
 *   an element on a body      the body itself
 */
export function skyAddresses({ cur, famIds, famName, joins, errors }) {
  const jidx = joinIndex(joins);
  const joined = (id) => jidx.get(id) ?? [];
  const geo = deriveCardGeometry({ cur, famIds, famName, joined, errors });
  const out = new Map();
  const put = (id, locus) => {
    if (!famIds.has(id)) return;
    if (!out.has(id)) out.set(id, []);
    const list = out.get(id);
    const k = JSON.stringify([locus.body ?? null, locus.ring, locus.lon ?? null, locus.span ?? null, locus.slot ?? null]);
    if (!list.some((l) => l._k === k)) list.push({ ...locus, _k: k });
  };
  const signOf = (id) => joined(id).map((j) => ({ idx: SIGNS.indexOf(j.other), j })).filter((x) => x.idx >= 0);

  // signs and decans: the zodiac itself
  SIGNS.forEach((s, i) => put(s, { ring: 'zodiac', lon: i * 30, span: 30, basis: 'site', via: [] }));
  for (const id of famIds) {
    const d = parseDecan(id);
    if (d) put(id, { ring: 'zodiac', lon: d.lon, span: 10, basis: 'site', via: [] });
  }

  for (const [key, b] of Object.entries(geo.bodies)) {
    // pip cards: the ruler's decan wheel
    for (const d of b.decans) put(d.card, { body: key, ring: 'wheel', lon: d.lon, span: 10, basis: 'site', via: d.joins });
    // the number's body: the rank ring (cards of its number) and the sephira itself
    for (const r of b.ranks) put(r.card, { body: key, ring: 'rank', slot: SUITS.indexOf(r.suit), basis: 'site', via: r.joins });
    if (b.sephira) put(b.sephira, { body: key, ring: 'body', basis: 'site', via: [] });
    for (const e of b.elements) put(e, { body: key, ring: 'body', basis: 'site', via: [] });
    // the court cards: at the ruler of the sign their span lies mostly in, the Princesses at the Earth
    for (const ct of b.courts) put(ct.card, { body: key, ring: 'rank', basis: 'site', via: ct.joins });
    // the Atu: the planet's, a sign's ruler's, an element's
    for (const m of b.majors) {
      put(m.card, { body: key, ring: 'rank', basis: 'site', via: m.joins });
      if (m.via === 'ruler') put(m.card, { ring: 'zodiac', lon: m.sign * 30, span: 30, basis: 'site', via: m.joins });
    }
  }
  // an Atu with a sign the rings do not hold stands on the sign's span; a sign-bearing Atu always also stands there
  for (const id of famIds) {
    if (!geo.isMajor(id)) continue;
    for (const { idx, j } of signOf(id)) put(id, { ring: 'zodiac', lon: idx * 30, span: 30, basis: j.basis ?? 'site', via: [j.id] });
  }
  // the court: thirty degrees from the 20th of one sign to the 20th of the next — the pair the field joins
  for (const id of famIds) {
    const c = parseCourt(id);
    if (!c) continue;
    if (c.court === 'princess') { put(id, { ring: 'pole', slot: SUITS.indexOf(c.suit), basis: 'site', via: [] }); continue; }
    const span = courtSpan(joined, id);
    if (!span) continue;
    if (span.error) { errors.push(span.error); continue; }
    put(id, { ring: 'zodiac', lon: span.lon, span: 30, basis: 'site', via: span.joins });
  }

  const final = new Map();
  for (const [id, list] of out) final.set(id, list.map(({ _k, ...l }) => l));
  return { addresses: final, geometry: geo, joined };
}
