// A tarot card read from the sky: the sheet the Astrology lens shows when a card on a planet's ring is opened. It keeps
// the reading local to the planet — nothing here gazes at the Earth or leaves the sky — and says where the card hangs by
// the field's own joins, with the quotations those joins rest on. The sign's colour and glyph enter as the sheet's tint:
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
import { icon } from '../ui/icons';
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
  /** a field node: the reading closes and the camera descends to it (the reading's own action, one click) */
  open(subject: Subject): void;
  /** a planetary body: the sky flies there and stays the mode; the planet's own reading carries its Earth relations */
  openBody(key: BodyKey): void;
}

const NUMBER_WORD = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const NUMBER_NAME = ['', 'Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const ORDINAL = ['', 'first', 'second', 'third'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A planet's name as a sentence takes it: the Sun, the Moon, the Earth; the others bare. */
const the = (n: string) => (/^(sun|moon|earth)$/i.test(n) ? `the ${n}` : n);

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

  const joinQuotes = (ids: string[]): HTMLElement[] => {
    const seen = new Set<string>();
    const out: HTMLElement[] = [];
    for (const id of ids) {
      for (const q of r.pages?.joins[id] ?? []) {
        if (seen.has(q.text)) continue;
        seen.add(q.text);
        out.push(quoteBlock(q, r.passages, { compact: true }));
      }
    }
    return out;
  };
  const uncited = (ids: string[]) => ids.some((id) => data.uncited.includes(id));
  const link = (label: string, sub: string | null, subject: Subject | null) => el('button', {
    type: 'button', class: 'th-link cr-chip', disabled: !subject, onclick: subject ? () => r.open(subject) : undefined,
  }, [el('span', {}, [el('span', { class: 'as-tie-name', text: label }), sub ? el('span', { class: 'as-basis', text: sub }) : null]), subject ? icon('next', 14) : null]);

  /** A planet named in the reading is a link to that body in the sky; the body this sheet stands at is not a link to itself. */
  const bodyLink = (key: BodyKey, sub: string) => {
    const here = key === r.body;
    return el('button', {
      type: 'button', class: `th-link cr-chip cr-planet${here ? ' here' : ''}`, disabled: here, 'data-body': key,
      onclick: here ? undefined : () => r.openBody(key),
    }, [el('span', {}, [el('span', { class: 'as-tie-name', text: cap(r.bodyName(key)) }), el('span', { class: 'as-basis', text: here ? 'the planet you are at' : sub })]), here ? null : icon('next', 14)]);
  };

  // ── where it hangs, by the decan: its ruler and its ten degrees ─────────────
  const parts: (HTMLElement | null)[] = [];
  const decanOf = [...Object.entries(data.bodies) as [BodyKey, BodyCards][]]
    .flatMap(([k, b]) => b.decans.filter((d) => d.card === r.id).map((d) => ({ key: k, d })))[0];
  if (decanOf) {
    const { key, d } = decanOf;
    parts.push(el('h3', { class: 'as-h3', text: 'By its decan' }));
    parts.push(el('p', { class: 'th-line', text: `${cap(ORDINAL[d.n])} decan of ${cap(SIGNS[d.sign])} (${d.lon % 30}°–${(d.lon % 30) + 10}°). Crowley’s card for it is ruled by ${the(r.bodyName(key))}.` }));
    parts.push(bodyLink(key, 'rules this decan, in the sky'));
    parts.push(...joinQuotes(d.joins));
    if (uncited(d.joins)) parts.push(el('p', { class: 'lp-note', text: 'One of these joins has no placed quotation yet.' }));
  }

  // ── … by its number: the sephira, and the body Crowley's list gives that number ──
  if (card.number !== undefined) {
    const holder = (Object.entries(data.bodies) as [BodyKey, BodyCards][]).find(([, b]) => b.position === card.number);
    const sephira = data.tree[card.number - 1];
    const sepName = model.famById.get(sephira)?.name ?? cap(sephira);
    parts.push(el('h3', { class: 'as-h3', text: 'By its number' }));
    if (holder) {
      const [hk, hb] = holder;
      parts.push(el('p', { class: 'th-line', text: `A ${NUMBER_NAME[card.number]}: the number of ${sepName}, which Crowley’s list of the ten bodies gives to ${the(r.bodyName(hk))}.` }));
      parts.push(bodyLink(hk, 'holds this number, in the sky'));
      for (const q of hb.positionQuotes) parts.push(quoteBlock(q as LensQuote, r.passages, { compact: true }));
      const rank = hb.ranks.find((x) => x.card === r.id);
      if (rank) parts.push(...joinQuotes(rank.joins));
    } else parts.push(el('p', { class: 'th-line', text: `A ${NUMBER_NAME[card.number]}: the number of ${sepName}.` }));
  }

  // ── an Atu's own attributions to this planet ────────────────────────────────
  const major = mine?.majors.find((m) => m.card === r.id);
  if (major) {
    parts.push(el('h3', { class: 'as-h3', text: major.via === 'ruler' ? `The sign ${the(name)} rules` : `Attributed to ${the(name)}` }));
    parts.push(el('p', { class: 'th-line', text: major.via === 'ruler' ? `${cap(SIGNS[major.sign ?? 0])} is this Atu’s sign, and ${the(name)} rules the sign.` : major.via === 'element' ? `Crowley gives this Atu to an element, which he writes beside the Earth.` : `The field joins this Atu to ${the(name)} itself.` }));
    parts.push(...joinQuotes(major.joins));
    if (uncited(major.joins)) parts.push(el('p', { class: 'lp-note', text: 'This join has no placed quotation yet.' }));
  }

  // ── the teaching: the link a number is between the elements, the sephira and the planet ──
  const chain: HTMLElement[] = [];
  if (card.number !== undefined && card.suit) {
    const suitFam = `thoth-${card.suit}`;
    const elem = card.element ?? null;
    const word = NUMBER_WORD[card.number];
    const sephira = data.tree[card.number - 1];
    const holder = (Object.entries(data.bodies) as [BodyKey, BodyCards][]).find(([, b]) => b.position === card.number)?.[1];
    const god = holder?.gods[0]?.family;
    // the planet's god is the planet: that link is the planet in the sky (the number's section above), never the god's Earth page
    const godIsBody = !!god && !!bodyOfGod(r.data, god);
    chain.push(link(`${cap(card.suit)} · ${elem ? subjectName(model, { type: 'family', id: elem }) : '—'}`, 'the suit and its element', model.famById.has(elem ?? '') ? { type: 'family', id: elem! } : model.famById.has(suitFam) ? { type: 'family', id: suitFam } : null));
    chain.push(link(model.archById.get(word)?.name ?? cap(word), 'the number, an archetype of the psyche', model.archById.has(word) ? { type: 'archetype', id: word } : null));
    chain.push(link(model.famById.get(sephira)?.name ?? cap(sephira), 'its sephira on the Tree', model.famById.has(sephira) ? { type: 'family', id: sephira } : null));
    // four is the one number whose own page Jung ties to the quaternity of the elements: say so where it is four
    if (card.number === 4 && model.famById.has('quaternity')) chain.push(link(subjectName(model, { type: 'family', id: 'quaternity' }), providerLabels().quaternityLink, { type: 'family', id: 'quaternity' }));
    if (god && !godIsBody && model.famById.has(god)) chain.push(link(subjectName(model, { type: 'family', id: god }), 'the planet’s god', { type: 'family', id: god }));
  }

  const head = el('header', { class: 'cr-head' }, [
    sign !== undefined ? el('span', { class: 'cr-sign', title: SIGNS[sign] }, [glyphSvg(sign, SIGNS[sign])]) : null,
    el('div', {}, [
      el('h2', { class: 'lp-h cr-title', text: card.name }),
      el('p', { class: 'cr-place', text: [
        sign !== undefined ? `${cap(SIGNS[sign])}${card.n ? ` · ${ORDINAL[card.n]} decan` : ''}` : null,
        mine ? `on ${the(name)}’s ring` : null,
      ].filter(Boolean).join(' · ') }),
    ]),
  ]);

  const root = el('article', { class: 'cr' }, [
    head,
    el('figure', { class: 'cr-fig' }, [plate(card.image as ImageRef, { credit: true, className: 'cr-plate', eager: true, thumb: false })]),
    fam.oneLine ? el('p', { class: 'th-line', text: fam.oneLine }) : null,
    ...parts,
    chain.length ? el('section', { class: 'cr-chain' }, [
      el('h3', { class: 'as-h3', text: 'The links' }),
      el('p', { class: 'lp-note', text: 'The number is the link: it stands between the suit’s element and its sephira on the Tree, and Crowley’s list carries it on to a planet.' }),
      ...chain,
    ]) : null,
    el('button', { type: 'button', class: 'th-link', onclick: () => r.open({ type: 'family', id: r.id }) }, [el('span', { text: 'Read it in the field' }), icon('next', 14)]),
  ]);
  root.style.setProperty('--cr-tint', tint);
  return [root];
}
