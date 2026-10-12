// The card rings of the sky: curation/sky/cards.json + field.json (its joins) + curation/sky/ties.json → public/data/sky-cards.json.
// A held planet carries, besides its archetypes, the tarot cards the field already joins to it, drawn as two outer rings:
//   • its decans — the pip cards of the thirty-six decans whose ruler it is, each at its true ecliptic longitude;
//   • its rank   — the four cards of the number its sephira carries (Crowley's tenfold list of the bodies of the solar
//     system gives each body its number), with the Atu the field joins to it.
// Nothing here is authored: the cards, the decans and the rank come from field.joins; the planet's number and its god's
// family from curation/sky/cards.json, whose every line is a quotation placed in the corpus by scripts/lib/cite.mjs. A
// join that has no placed quotation in field-pages.json is named and carried as uncited, never dressed as sourced.
// The Earth (terra) is number 10 in that list "(The Four Elements)": the elements are tied to it here, as Crowley writes.
//   npm run sky-cards          regenerate
//   npm run sky-cards:check    verify the published file matches what the field and the corpus give now
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BODY_KEYS = ['sun', 'moon', 'terra', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
/** The Tree as Crowley numbers it: the sephira of each number, one to ten. */
export const TREE = ['kether', 'chokmah', 'binah', 'chesed', 'geburah', 'tiphareth', 'netzach', 'hod', 'yesod', 'malkuth'];
export const SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
/** The suits in Crowley's order (the Aces' order too): Wands, Cups, Swords, Disks. */
export const SUITS = ['wands', 'cups', 'swords', 'disks'];
const WORD = { ace: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ELEMENT_OF_SUIT = { wands: 'fire', cups: 'water', swords: 'air', disks: 'earth-element' };
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function buildSkyCards({ root = ROOT, vault = DEFAULT_VAULT } = {}) {
  const cur = read(path.join(root, 'curation', 'sky', 'cards.json'));
  const field = read(path.join(root, 'public', 'data', 'field.json'));
  const pages = read(path.join(root, 'public', 'data', 'field-pages.json'));
  const skyTies = read(path.join(root, 'curation', 'sky', 'ties.json'));
  const load = workLoader(vault);
  const titles = workTitles(root);
  const errors = [];
  const warnings = [];
  const fam = new Map(field.families.map((f) => [f.id, f]));
  const placed = (quotes, where) => citeQuotes(load, titles, quotes, where, errors, warnings);
  const cited = (id) => (pages.joins?.[id]?.length ?? 0) > 0;

  // ── the joins the rings read ──────────────────────────────────────────────
  const joinsOf = new Map(); // family id -> [{ other, id }]
  for (const j of field.joins) {
    if (j.a.type !== 'family' || j.b.type !== 'family') continue;
    for (const [x, y] of [[j.a.id, j.b.id], [j.b.id, j.a.id]]) {
      if (!joinsOf.has(x)) joinsOf.set(x, []);
      joinsOf.get(x).push({ other: y, id: j.id, system: j.system });
    }
  }
  const joined = (id) => joinsOf.get(id) ?? [];

  const parseDecan = (id) => {
    const m = /^decan-([a-z]+)-([123])$/.exec(id);
    if (!m || !SIGNS.includes(m[1])) return null;
    const sign = SIGNS.indexOf(m[1]);
    const n = Number(m[2]);
    return { sign, n, lon: sign * 30 + (n - 1) * 10 };
  };
  const parseRank = (id) => {
    const m = /^thoth-([a-z]+)-of-(wands|cups|swords|disks)$/.exec(id);
    if (!m || !(m[1] in WORD)) return null;
    return { number: WORD[m[1]], suit: m[2] };
  };
  const isMajor = (id) => /^Atu /.test(fam.get(id)?.name ?? '') && id.startsWith('thoth-');

  const used = new Set(); // card ids drawn anywhere
  const bodies = {};
  const uncited = new Set();
  const use = (joinIds) => { for (const id of joinIds) if (!cited(id)) uncited.add(id); };

  // the suit ↔ element table, from the field's own joins (thoth-wands ↔ fire …)
  const suitElement = {};
  for (const s of SUITS) {
    const e = joined(`thoth-${s}`).find((j) => Object.values(ELEMENT_OF_SUIT).includes(j.other));
    suitElement[s] = e?.other ?? null;
    if (e?.other !== ELEMENT_OF_SUIT[s]) errors.push(`suit ${s}: the field joins it to ${e?.other ?? 'no element'}, not ${ELEMENT_OF_SUIT[s]}`);
  }

  const listQuote = placed([cur.list], 'list')[0] ?? null;

  for (const key of BODY_KEYS) {
    const c = cur.bodies[key];
    if (!c) continue;
    const out = { gods: [], position: c.position ?? null, sephira: null, positionQuotes: placed([{ work: cur.list.work, page: cur.list.page, voice: cur.list.voice, quote: c.quote }], `body ${key}`), decans: [], ranks: [], majors: [], elements: [], abyss: !!c.abyss, ...(c.note ? { note: c.note } : {}) };
    if (c.position) {
      out.sephira = TREE[c.position - 1];
      if (!fam.has(out.sephira)) errors.push(`body ${key}: the field has no family ${out.sephira}`);
    }

    // the planet's god: a family the sky ties already name, or the one curated here with Jung's words
    if (c.god) {
      const g = { family: c.god.family, basis: c.god.basis ?? null, voice: c.god.voice ?? null, quotes: [] };
      if (!fam.has(g.family)) errors.push(`body ${key}: the field has no family ${g.family}`);
      if (c.god.fromSkyTie) {
        const t = skyTies.ties.find((x) => x.body === key && x.target?.type === 'family' && x.target.id === g.family);
        if (!t) errors.push(`body ${key}: curation/sky/ties.json does not tie it to ${g.family}`);
        else {
          g.basis = t.basis;
          g.voice = t.basis === 'jung' ? 'Jung' : null;
          g.quotes = placed((t.cites ?? []).map((q) => ({ work: q.work, quote: q.quote })), `body ${key} god`);
        }
      } else g.quotes = placed(c.god.quotes ?? [], `body ${key} god`);
      if (g.basis === 'jung' && !g.quotes.length) errors.push(`body ${key}: a jung tie to ${g.family} needs a placed quotation`);
      out.gods.push(g);

      // decans: the planet's family ↔ decan family ↔ pip card
      for (const j of joined(g.family)) {
        const d = parseDecan(j.other);
        if (!d) continue;
        const cardJoin = joined(j.other).find((x) => x.system === 'thoth' && x.other.startsWith('thoth-') && parseRank(x.other));
        if (!cardJoin) { errors.push(`${j.other}: no pip card joined`); continue; }
        use([j.id, cardJoin.id]);
        used.add(cardJoin.other);
        out.decans.push({ card: cardJoin.other, decan: j.other, sign: d.sign, n: d.n, lon: d.lon, joins: [j.id, cardJoin.id] });
      }
      out.decans.sort((a, b) => a.lon - b.lon);

      // majors: the Atu joined to the god's family — attributed to the planet itself, or to a sign it rules
      for (const j of joined(g.family)) {
        if (!isMajor(j.other)) continue;
        const sign = joined(j.other).map((x) => SIGNS.indexOf(x.other)).find((i) => i >= 0);
        use([j.id]);
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
        use([j.id]);
        used.add(j.other);
        out.ranks.push({ card: j.other, suit: r.suit, number: r.number, joins: [j.id] });
      }
      out.ranks.sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
      if (out.ranks.length !== 4) errors.push(`body ${key}: ${out.sephira} carries ${out.ranks.length} cards of its number, not four`);
    }

    if (c.elements) {
      for (const e of c.elements) if (!fam.has(e)) errors.push(`body ${key}: the field has no family ${e}`);
      out.elements = [...c.elements];
      // the Atu the field gives an element and no sign (the Fool to Air, the Hanged Man to Water, the Aeon to Fire, the
      // Universe to Earth): a sign's Atu that only stands in an element by its sign (the Chariot) is not the element's own
      for (const e of c.elements) {
        for (const j of joined(e)) {
          if (!isMajor(j.other) || joined(j.other).some((x) => SIGNS.includes(x.other))) continue;
          use([j.id]);
          used.add(j.other);
          out.majors.push({ card: j.other, via: 'element', element: e, joins: [j.id] });
        }
      }
    }
    bodies[key] = out;
  }

  // ── the cards, with what a ring and a reading need of each ─────────────────
  const cards = {};
  for (const id of [...used].sort()) {
    const f = fam.get(id);
    if (!f) { errors.push(`card ${id}: not in the field`); continue; }
    if (!f.image?.thumb) { errors.push(`card ${id}: no plate in the field`); continue; }
    const r = parseRank(id);
    const dec = joined(id).map((j) => parseDecan(j.other)).find((d) => d);
    const decanId = joined(id).find((j) => parseDecan(j.other))?.other ?? null;
    const { src, thumb, width, height, tone, title, credit, license, sourceUrl } = f.image;
    cards[id] = {
      name: f.name,
      kind: isMajor(id) ? 'major' : 'pip',
      image: { src, thumb, width, height, tone, title, credit, license, sourceUrl },
      ...(r ? { number: r.number, suit: r.suit, element: suitElement[r.suit] } : {}),
      ...(dec ? { sign: dec.sign, n: dec.n, lon: dec.lon, decan: decanId } : {}),
      ...(isMajor(id) ? { sign: joined(id).map((x) => SIGNS.indexOf(x.other)).find((i) => i >= 0) } : {}),
    };
    if (cards[id].sign === undefined) delete cards[id].sign;
  }

  if (errors.length) throw new Error(errors.join('\n'));
  return {
    version: 1,
    list: listQuote,
    tree: TREE,
    suits: SUITS.map((s) => ({ suit: s, element: suitElement[s] })),
    bodies,
    cards,
    uncited: [...uncited].sort(),
    _warnings: warnings,
  };
}

const stable = (o) => JSON.stringify({ ...o, _warnings: undefined }, null, 2) + '\n';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(ROOT, 'public', 'data', 'sky-cards.json');
  try {
    const built = buildSkyCards();
    const text = stable(built);
    if (process.argv.includes('--check')) {
      const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (have !== text) { console.error('public/data/sky-cards.json is missing or differs from what the field gives now; run npm run sky-cards'); process.exit(1); }
      console.log(`sky-cards: ok (${Object.keys(built.cards).length} cards, ${built.uncited.length} joins without a placed quotation)`);
    } else {
      fs.writeFileSync(target, text);
      const n = (k) => Object.values(built.bodies).reduce((s, b) => s + b[k].length, 0);
      console.log(`sky-cards: ${Object.keys(built.cards).length} cards | decans ${n('decans')} | ranks ${n('ranks')} | majors ${n('majors')} | uncited joins ${built.uncited.length}`);
      for (const w of built._warnings) console.warn(`  warn: ${w}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
