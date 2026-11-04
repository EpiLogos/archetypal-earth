// A tarot card read from the sky: the sheet the Astrology lens shows when a card on a planet's ring is opened. It keeps
// the reading local to the planet — a card's place is the sky, so nothing here sends the visitor to the Earth for it — and
// says where the card hangs by the field's own joins, with the quotations those joins rest on. It is set as an archetype's
// reading is (the title, the plate, a lede, sections under small capitals, rows with their pictures). The sign's colour and glyph enter as the sheet's tint:
// the same hue the zodiac band has at that longitude, so the colour names a place on the wheel and means nothing else.
//
// Two systems place a card and they do not always agree: its decan has a ruler, its number has a sephira and a body in
// Crowley's list. Both are said, side by side, each with its words; the reading never picks between them.
import type { Model, Subject } from '../data/model';
import { subjectName } from '../data/model';
import type { ImageRef } from '../types/field';
import type { BodyKey } from '../types/sky';
import type { PassageBridge } from '../ui/passage';
import { el, plate } from '../ui/dom';
import { plates } from '../data/plates';
import { quoteBlock, type LensQuote } from './ui';
import { glyphSvg, holoCssAt } from '../sky/zodiac';
import { SIGNS } from '../sky/frames';
import { bodyOfGod, type BodyCards, type SkyCardsData } from '../sky/cards';
import { providerLabels } from '../data/labels';

/** The published field pages: the quotations the page of a card and the join under it rest on. */
export interface FieldPages {
  pages: Record<string, { line: string; sections: { id: string; title: string; line: string; quotes: LensQuote[] }[] }>;
  joins: Record<string, LensQuote[]>;
}

export interface CardReadingInput {
  model: Model;
  passages: PassageBridge | undefined;
  data: SkyCardsData;
  pages: FieldPages | null;
  /** the card's family id */
  id: string;
  /** the planet whose ring it was opened from, and the name the standing culture gives it */
  body: BodyKey;
  bodyName: (key: BodyKey) => string;
  /** a field node a link names (the suit's element, the number, the sephira): the reading closes and the camera goes to it */
  open(subject: Subject): void;
  /** a planetary body: the sky flies there and stays the mode; the planet's own reading carries its Earth relations */
  openBody(key: BodyKey): void;
  /** Kathleen Burt on a planet (public/data/astrology.json), in her order */
  burtOn(key: BodyKey): LensQuote[];
  /** Burt's chapter title for a sign ("AQUARIUS: The Search for the Holy Grail"), the sign named as in SIGNS */
  burtSign(sign: string): LensQuote | undefined;
}

const NUMBER_WORD = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const NUMBER_NAME = ['', 'Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const PLURAL = ['', 'Aces', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens'];
/** Burt's quotations on a planet the reading shows at once; the rest wait under "More from Burt". */
const BURT_SHOWN = 2;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A planet's name as a sentence takes it: the Sun, the Moon, the Earth; the others bare. */
const the = (n: string) => (/^(sun|moon|earth)$/i.test(n) ? `the ${n}` : n);

/**
 * What a reading at a planet is built from, whether it reads a card or a sephira: the quotations already shown (a join's
 * cite is often a clause of a passage the page quotes whole, and is not said twice), and the rows and blocks the sheet is
 * set in.
 */
function parts(r: CardReadingInput) {
  const { data, model } = r;
  const shown: string[] = [];
  const bare = (t: string) => t.replace(/[\s.,;:!?’'”“"]+$/u, '').replace(/^[\s’'”“"]+/u, '').toLowerCase();
  const fresh = (text: string) => {
    const b = bare(text);
    if (!b || shown.some((x) => x.includes(b))) return false;
    shown.push(b);
    return true;
  };
  const quotes = (qs: LensQuote[], compact = false): HTMLElement[] => qs.filter((q) => fresh(q.text)).map((q) => quoteBlock(q, r.passages, { compact }));
  const joinQuotes = (ids: string[]): HTMLElement[] => ids.flatMap((id) => quotes(r.pages?.joins[id] ?? []));
  const uncited = (ids: string[]) => ids.some((id) => data.uncited.includes(id));
  const section = (title: string) => el('h3', { class: 'dp-sub', text: title });
  const para = (text: string) => el('p', { class: 'dp-para cr-para', text });
  const page = (id: string) => r.pages?.pages[`family:${id}`];

  /** A node's own page: the sections of its quotations, each under its title. */
  const pageSections = (id: string): HTMLElement[] => (page(id)?.sections ?? []).flatMap((sec) => {
    const qs = quotes(sec.quotes);
    if (!qs.length) return [];
    return [section(sec.title), ...(sec.line ? [para(sec.line)] : []), ...qs];
  });

  /** Burt on a planet: the first of her passages at once, the rest folded under her name. */
  const burtOnBody = (key: BodyKey): HTMLElement[] => {
    const all = r.burtOn(key).filter((q) => !shown.includes(bare(q.text)));
    if (!all.length) return [];
    const name = cap(r.bodyName(key));
    const out: (HTMLElement | null)[] = [
      el('p', { class: 'cr-voice', text: `${name}, as Kathleen Burt reads it` }),
      ...quotes(all.slice(0, BURT_SHOWN), true),
    ];
    const more = all.slice(BURT_SHOWN);
    if (more.length) out.push(el('details', { class: 'as-more' }, [el('summary', { text: `More from Burt on ${name} (${more.length})` }), ...quotes(more, true)]));
    return out.filter((n): n is HTMLElement => !!n);
  };

  /** A sign as Burt reads it: her chapter's title, then the passages the sign's own page quotes from her. */
  const burtOnSign = (sign: number): HTMLElement[] => {
    const name = SIGNS[sign];
    const title = r.burtSign(name);
    const hers = (page(name.toLowerCase())?.sections ?? []).flatMap((sec) => sec.quotes.filter((q) => q.cite.work === 'burt-zodiac'));
    const body = [...(title ? quotes([title], true) : []), ...quotes(hers.slice(0, 3))];
    if (!body.length) return [];
    const more = hers.slice(3);
    return [section(`The sign: ${name}`), ...body, ...(more.length ? [el('details', { class: 'as-more' }, [el('summary', { text: `More from Burt on ${name} (${more.length})` }), ...quotes(more, true)])] : [])];
  };

  /** A planet named in the reading: a row that takes the sky there; the planet this sheet stands at is said, not linked. */
  const bodyRow = (key: BodyKey, sub: string) => {
    const here = key === r.body;
    const go = here ? undefined : () => r.openBody(key);
    return el('div', { class: `cr-row cr-planet${here ? ' here' : ''}`, 'data-body': key }, [
      el('span', { class: 'cr-disc', 'aria-hidden': 'true' }),
      el('div', { class: 'dp-row-body' }, [
        here ? el('span', { class: 'cr-row-name', text: cap(r.bodyName(key)) }) : el('button', { type: 'button', class: 'link-quiet dp-row-name', text: cap(r.bodyName(key)), onclick: go }),
        el('span', { class: 'dp-row-sub', text: here ? 'the planet you are at' : sub }),
      ]),
    ]);
  };

  /** A field node the reading links to, with its plate: the row the Related list sets a node in. */
  const nodeRow = (label: string, sub: string, subject: Subject | null) => {
    const pl = subject && subject.type !== 'person' && subject.type !== 'work' ? plates(model, subject as Parameters<typeof plates>[1]) : undefined;
    const go = subject ? () => r.open(subject) : undefined;
    return el('li', {}, [
      el('button', { class: 'dp-row-plate', type: 'button', tabindex: -1, 'aria-hidden': 'true', disabled: !subject, onclick: go }, [
        plate(pl?.image, { thumb: true, className: 'dp-row-img', palette: pl?.palette, alt: label }),
      ]),
      el('div', { class: 'dp-row-body' }, [
        subject ? el('button', { type: 'button', class: 'link-quiet dp-row-name', text: label, onclick: go }) : el('span', { class: 'cr-row-name', text: label }),
        el('span', { class: 'dp-row-sub', text: sub }),
      ]),
    ]);
  };

  /** Crowley's list of the ten bodies, as he prints it, the line of the planet that holds this number marked. */
  const tenBodies = (holder: BodyKey): HTMLElement | null => {
    if (!data.tenBodies?.length) return null;
    const cite = data.list?.cite;
    return el('details', { class: 'as-more cr-list' }, [
      el('summary', { text: `Crowley’s list of the ten bodies${cite ? ` · ${cite.workTitle}` : ''}` }),
      el('ol', {}, data.tenBodies.map((b) => el('li', { class: b.body === holder ? 'on' : undefined, value: String(b.position) }, [el('span', { text: b.line })]))),
    ]);
  };

  /** The body Crowley's list gives a number to, with its record. */
  const holderOf = (n: number) => (Object.entries(data.bodies) as [BodyKey, BodyCards][]).find(([, b]) => b.position === n);

  return { shown, quotes, joinQuotes, uncited, section, para, page, pageSections, burtOnBody, burtOnSign, bodyRow, nodeRow, tenBodies, holderOf };
}

/** The sheet, as nodes for the lens panel; its tint is the hue of the card's place on the wheel. */
export function cardReading(r: CardReadingInput): HTMLElement[] {
  const { data, model } = r;
  const card = data.cards[r.id];
  const fam = model.famById.get(r.id);
  if (!card || !fam) return [el('p', { class: 'lp-error', text: 'This card is not in the field.' })];
  const mine: BodyCards | undefined = data.bodies[r.body];
  const name = r.bodyName(r.body);
  const sign = card.sign;
  const place = sign !== undefined ? (card.lon !== undefined ? card.lon + 5 : sign * 30 + 15) : null;
  const tint = place !== null ? holoCssAt(place) : card.image.tone ?? 'rgb(214 214 232)';
  const P = parts(r);
  const { section, para } = P;

  // ── the card itself: the plain reading, then Crowley's own words on it ──────
  const lede = P.page(r.id)?.line || fam.oneLine;
  const own = P.pageSections(r.id);

  // ── where it hangs, by the decan: its ruler and its ten degrees ─────────────
  const rest: (HTMLElement | null)[] = [];
  if (sign !== undefined) rest.push(...P.burtOnSign(sign));
  const decanOf = [...Object.entries(data.bodies) as [BodyKey, BodyCards][]]
    .flatMap(([k, b]) => b.decans.filter((d) => d.card === r.id).map((d) => ({ key: k, d })))[0];
  if (decanOf) {
    const { key, d } = decanOf;
    rest.push(section('By its decan'));
    rest.push(para(`The ${ORDINAL[d.n]} decan of ${cap(SIGNS[d.sign])}, ${d.lon % 30}° to ${(d.lon % 30) + 10}°. Crowley gives the card to the planet that rules it, ${the(r.bodyName(key))}.`));
    rest.push(P.bodyRow(key, 'rules this decan'));
    rest.push(...P.joinQuotes(d.joins));
    rest.push(...P.burtOnBody(key));
    if (P.uncited(d.joins)) rest.push(el('p', { class: 'lp-note', text: 'One of these joins has no placed quotation yet.' }));
  }

  // ── … by its number: the sephira, and the body Crowley's list gives that number ──
  if (card.number !== undefined) {
    const holder = P.holderOf(card.number);
    const sephira = data.tree[card.number - 1];
    const sepName = model.famById.get(sephira)?.name ?? cap(sephira);
    const a = NUMBER_NAME[card.number] === 'Ace' ? 'An Ace' : `A ${NUMBER_NAME[card.number]}`;
    rest.push(section('By its number'));
    if (holder) {
      const [hk, hb] = holder;
      rest.push(para(`${a}, the number of ${sepName}. Crowley’s list of the ten bodies gives that number to ${the(r.bodyName(hk))}.`));
      rest.push(P.bodyRow(hk, `holds this number, and ${sepName} with it`));
      const rank = hb.ranks.find((x) => x.card === r.id);
      if (rank) rest.push(...P.joinQuotes(rank.joins));
      rest.push(P.tenBodies(hk));
    } else rest.push(para(`${a}, the number of ${sepName}.`));
  }

  // ── an Atu's own attributions to this planet ────────────────────────────────
  const major = mine?.majors.find((m) => m.card === r.id);
  if (major) {
    rest.push(section(major.via === 'ruler' ? `The sign ${the(name)} rules` : `Given to ${the(name)}`));
    rest.push(para(major.via === 'ruler' ? `${cap(SIGNS[major.sign ?? 0])} is this Atu’s sign, and ${the(name)} rules the sign.` : major.via === 'element' ? `Crowley gives this Atu to an element, which he writes beside the Earth.` : `The field joins this Atu to ${the(name)} itself.`));
    rest.push(...P.joinQuotes(major.joins));
    if (major.via !== 'element') rest.push(...P.burtOnBody(r.body));
    if (P.uncited(major.joins)) rest.push(el('p', { class: 'lp-note', text: 'This join has no placed quotation yet.' }));
  }

  // ── a court card: its thirty degrees and the ruler of the sign holding most of them; a Princess, her element at the Earth ──
  const court = mine?.courts?.find((x) => x.card === r.id);
  if (court?.court === 'princess') {
    rest.push(section('Where she stands'));
    rest.push(para(`Crowley gives the Princesses no sign. Each is the earthy part of her element and rules a quarter of the heavens around the North Pole, so she stands at ${the(name)}, with the four elements.`));
    rest.push(P.bodyRow(r.body, 'carries the four elements'));
    rest.push(...P.joinQuotes(court.joins));
  } else if (court && court.sign !== undefined && court.from !== undefined) {
    const first = Math.floor(court.from / 30);
    rest.push(section('By its span'));
    rest.push(para(`From the 21st degree of ${SIGNS[first]} to the 20th of ${SIGNS[court.sign]}: the last decan of ${SIGNS[first]} and the first two of ${SIGNS[court.sign]}. Most of it lies in ${SIGNS[court.sign]}, and Burt names ${the(name)} the ruler of ${SIGNS[court.sign]}.`));
    rest.push(P.bodyRow(r.body, `rules ${SIGNS[court.sign]}`));
    rest.push(...P.joinQuotes(court.joins));
    rest.push(...P.burtOnBody(r.body));
  }

  // ── the links: the number stands between the suit's element, the sephira and the planet ──
  const chain: HTMLElement[] = [];
  if (card.number !== undefined && card.suit) {
    const suitFam = `thoth-${card.suit}`;
    const elem = card.element ?? null;
    const word = NUMBER_WORD[card.number];
    const sephira = data.tree[card.number - 1];
    const holder = P.holderOf(card.number);
    const god = holder?.[1].gods[0]?.family;
    // the planet's god is the planet: that link is the planet in the sky (the number's section above), never the god's Earth page
    const godIsBody = !!god && !!bodyOfGod(r.data, god);
    const elemSubject: Subject | null = model.famById.has(elem ?? '') ? { type: 'family', id: elem! } : model.famById.has(suitFam) ? { type: 'family', id: suitFam } : null;
    chain.push(P.nodeRow(`${cap(card.suit)} · ${elem ? subjectName(model, { type: 'family', id: elem }) : '—'}`, 'the suit and its element', elemSubject));
    chain.push(P.nodeRow(model.archById.get(word)?.name ?? cap(word), 'the number, an archetype of the psyche', model.archById.has(word) ? { type: 'archetype', id: word } : null));
    // a sephira's place is its planet: the row says which, and opens the sephira there
    chain.push(P.nodeRow(model.famById.get(sephira)?.name ?? cap(sephira), holder ? `its sephira on the Tree, at ${the(r.bodyName(holder[0]))}` : 'its sephira on the Tree', model.famById.has(sephira) ? { type: 'family', id: sephira } : null));
    // four is the one number whose own page Jung ties to the quaternity of the elements: say so where it is four
    if (card.number === 4 && model.famById.has('quaternity')) chain.push(P.nodeRow(subjectName(model, { type: 'family', id: 'quaternity' }), providerLabels().quaternityLink, { type: 'family', id: 'quaternity' }));
    if (god && !godIsBody && model.famById.has(god)) chain.push(P.nodeRow(subjectName(model, { type: 'family', id: god }), 'the planet’s god', { type: 'family', id: god }));
  } else if (card.court && card.suit) {
    // a court card's links: its suit's element, and its rank as an archetype of the psyche
    const elem = card.element ?? null;
    const suitFam = `thoth-${card.suit}`;
    const elemSubject: Subject | null = model.famById.has(elem ?? '') ? { type: 'family', id: elem! } : model.famById.has(suitFam) ? { type: 'family', id: suitFam } : null;
    chain.push(P.nodeRow(`${cap(card.suit)} · ${elem ? subjectName(model, { type: 'family', id: elem }) : '—'}`, 'the suit and its element', elemSubject));
    const arch = `court-${card.court}`;
    if (model.archById.has(arch)) chain.push(P.nodeRow(model.archById.get(arch)!.name, 'its rank, an archetype of the psyche', { type: 'archetype', id: arch }));
  }

  const placeLine = [
    sign !== undefined && card.from !== undefined ? `${SIGNS[Math.floor(card.from / 30)]} 21° to ${SIGNS[sign]} 20°`
      : sign !== undefined ? `${cap(SIGNS[sign])}${card.n ? `, ${ORDINAL[card.n]} decan` : ''}` : null,
    mine ? `on ${the(name)}’s ring` : null,
  ].filter(Boolean).join(' · ');

  const root = el('article', { class: 'cr' }, [
    el('h2', { class: 'dp-title cr-title', text: card.name }),
    placeLine ? el('p', { class: 'cr-place' }, [
      sign !== undefined ? el('span', { class: 'cr-sign', title: SIGNS[sign] }, [glyphSvg(sign, SIGNS[sign])]) : null,
      el('span', { text: placeLine }),
    ]) : null,
    el('figure', { class: 'cr-fig' }, [plate(card.image as ImageRef, { credit: true, className: 'cr-plate', eager: true, thumb: false })]),
    lede ? el('p', { class: 'dp-lede cr-lede', text: lede }) : null,
    ...own,
    ...rest,
    chain.length ? el('section', { class: 'cr-chain' }, [
      section('The links'),
      card.number !== undefined ? el('p', { class: 'dp-para cr-para', text: 'The number is the link: it stands between the suit’s element and its sephira on the Tree, and Crowley’s list carries it on to a planet.' }) : null,
      el('ul', { class: 'dp-rows' }, chain),
    ]) : null,
  ]);
  root.style.setProperty('--cr-tint', tint);
  return [root];
}

/**
 * A sephira read at its planet (owner, 3 Nov 2026: Geburah goes to Mars, never to the Earth): its page, the planet
 * Crowley's list of the ten bodies gives its number, Burt on that planet, and the four cards of its number, each of which
 * opens at its own planet. Set as a card's reading is; the tint is the planet's own colour.
 */
export function sephiraReading(r: CardReadingInput): HTMLElement[] {
  const { data, model } = r;
  const fam = model.famById.get(r.id);
  const n = data.tree.indexOf(r.id) + 1;
  if (!fam || n < 1) return [el('p', { class: 'lp-error', text: 'This sephira is not in the field.' })];
  const P = parts(r);
  const { section, para } = P;
  const holder = P.holderOf(n);
  const name = r.bodyName(r.body);
  const lede = P.page(r.id)?.line || fam.oneLine;
  const word = NUMBER_WORD[n];

  const out: (HTMLElement | null)[] = [...P.pageSections(r.id)];
  if (holder) {
    const [hk] = holder;
    out.push(section(`Its planet: ${cap(r.bodyName(hk))}`));
    out.push(para(`${fam.name} is the ${ORDINAL[n]} sephira of the Tree. Crowley’s list of the ten bodies gives the number ${word} to ${the(r.bodyName(hk))}, so this is where ${fam.name} stands in the sky.`));
    out.push(P.bodyRow(hk, `holds the number ${word}`));
    out.push(P.tenBodies(hk));
    out.push(...P.burtOnBody(hk));
  }
  const ranks = holder?.[1].ranks ?? [];
  if (ranks.length) {
    out.push(section(`The four ${PLURAL[n]}`));
    out.push(para(`One card of the number ${word} in each suit. Each hangs where its own decan puts it, and opens at that planet.`));
    out.push(el('ul', { class: 'dp-rows' }, ranks.map((rk) => P.nodeRow(data.cards[rk.card]?.name ?? rk.card, model.famById.get(rk.card)?.oneLine ?? cap(rk.suit), model.famById.has(rk.card) ? { type: 'family', id: rk.card } : null))));
  }
  const links: HTMLElement[] = [];
  if (model.archById.has(word)) links.push(P.nodeRow(model.archById.get(word)!.name, 'the number, an archetype of the psyche', { type: 'archetype', id: word }));
  if (model.famById.has('tree')) links.push(P.nodeRow(subjectName(model, { type: 'family', id: 'tree' }), 'the Tree the ten sephiroth make', { type: 'family', id: 'tree' }));
  if (links.length) out.push(el('section', { class: 'cr-chain' }, [section('The links'), el('ul', { class: 'dp-rows' }, links)]));

  const root = el('article', { class: 'cr' }, [
    el('h2', { class: 'dp-title cr-title', text: fam.name }),
    el('p', { class: 'cr-place' }, [el('span', { text: `The ${ORDINAL[n]} sephira · at ${the(name)}` })]),
    fam.image ? el('figure', { class: 'cr-fig' }, [plate(fam.image as ImageRef, { credit: true, className: 'cr-plate', eager: true, thumb: false })]) : null,
    lede ? el('p', { class: 'dp-lede cr-lede', text: lede }) : null,
    ...out,
  ]);
  root.style.setProperty('--cr-tint', fam.palette?.glow ?? 'rgb(214 214 232)');
  return [root];
}
