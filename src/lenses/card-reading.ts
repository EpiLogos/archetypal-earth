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
        out.push(quoteBlock(q, r.passages));
      }
    }
    return out;
  };
  const uncited = (ids: string[]) => ids.some((id) => data.uncited.includes(id));
  const section = (title: string) => el('h3', { class: 'dp-sub', text: title });
  const para = (text: string) => el('p', { class: 'dp-para cr-para', text });

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

  /** A field node the card links to, with its plate: the row the Related list sets a node in. */
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
    return el('figure', { class: 'cr-list' }, [
      el('figcaption', { class: 'cr-list-cap', text: `Crowley’s list of the ten bodies${cite ? ` · ${cite.workTitle}` : ''}` }),
      el('ol', {}, data.tenBodies.map((b) => el('li', { class: b.body === holder ? 'on' : undefined, value: String(b.position) }, [el('span', { text: b.line })]))),
    ]);
  };

  // ── where it hangs, by the decan: its ruler and its ten degrees ─────────────
  const parts: (HTMLElement | null)[] = [];
  const decanOf = [...Object.entries(data.bodies) as [BodyKey, BodyCards][]]
    .flatMap(([k, b]) => b.decans.filter((d) => d.card === r.id).map((d) => ({ key: k, d })))[0];
  if (decanOf) {
    const { key, d } = decanOf;
    parts.push(section('By its decan'));
    parts.push(para(`The ${ORDINAL[d.n]} decan of ${cap(SIGNS[d.sign])}, ${d.lon % 30}° to ${(d.lon % 30) + 10}°. Crowley gives the card to the planet that rules it, ${the(r.bodyName(key))}.`));
    parts.push(bodyRow(key, 'rules this decan'));
    parts.push(...joinQuotes(d.joins));
    if (uncited(d.joins)) parts.push(el('p', { class: 'lp-note', text: 'One of these joins has no placed quotation yet.' }));
  }

  // ── … by its number: the sephira, and the body Crowley's list gives that number ──
  if (card.number !== undefined) {
    const holder = (Object.entries(data.bodies) as [BodyKey, BodyCards][]).find(([, b]) => b.position === card.number);
    const sephira = data.tree[card.number - 1];
    const sepName = model.famById.get(sephira)?.name ?? cap(sephira);
    parts.push(section('By its number'));
    if (holder) {
      const [hk, hb] = holder;
      parts.push(para(`${NUMBER_NAME[card.number] === 'Ace' ? 'An Ace' : `A ${NUMBER_NAME[card.number]}`}, the number of ${sepName}. Crowley’s list of the ten bodies gives that number to ${the(r.bodyName(hk))}.`));
      parts.push(bodyRow(hk, 'holds this number'));
      parts.push(tenBodies(hk));
      const rank = hb.ranks.find((x) => x.card === r.id);
      if (rank) parts.push(...joinQuotes(rank.joins));
    } else parts.push(para(`${NUMBER_NAME[card.number] === 'Ace' ? 'An Ace' : `A ${NUMBER_NAME[card.number]}`}, the number of ${sepName}.`));
  }

  // ── an Atu's own attributions to this planet ────────────────────────────────
  const major = mine?.majors.find((m) => m.card === r.id);
  if (major) {
    parts.push(section(major.via === 'ruler' ? `The sign ${the(name)} rules` : `Given to ${the(name)}`));
    parts.push(para(major.via === 'ruler' ? `${cap(SIGNS[major.sign ?? 0])} is this Atu’s sign, and ${the(name)} rules the sign.` : major.via === 'element' ? `Crowley gives this Atu to an element, which he writes beside the Earth.` : `The field joins this Atu to ${the(name)} itself.`));
    parts.push(...joinQuotes(major.joins));
    if (uncited(major.joins)) parts.push(el('p', { class: 'lp-note', text: 'This join has no placed quotation yet.' }));
  }

  // ── the links: the number stands between the suit's element, the sephira and the planet ──
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
    const elemSubject: Subject | null = model.famById.has(elem ?? '') ? { type: 'family', id: elem! } : model.famById.has(suitFam) ? { type: 'family', id: suitFam } : null;
    chain.push(nodeRow(`${cap(card.suit)} · ${elem ? subjectName(model, { type: 'family', id: elem }) : '—'}`, 'the suit and its element', elemSubject));
    chain.push(nodeRow(model.archById.get(word)?.name ?? cap(word), 'the number, an archetype of the psyche', model.archById.has(word) ? { type: 'archetype', id: word } : null));
    chain.push(nodeRow(model.famById.get(sephira)?.name ?? cap(sephira), 'its sephira on the Tree', model.famById.has(sephira) ? { type: 'family', id: sephira } : null));
    // four is the one number whose own page Jung ties to the quaternity of the elements: say so where it is four
    if (card.number === 4 && model.famById.has('quaternity')) chain.push(nodeRow(subjectName(model, { type: 'family', id: 'quaternity' }), providerLabels().quaternityLink, { type: 'family', id: 'quaternity' }));
    if (god && !godIsBody && model.famById.has(god)) chain.push(nodeRow(subjectName(model, { type: 'family', id: god }), 'the planet’s god', { type: 'family', id: god }));
  }

  const placeLine = [
    sign !== undefined ? `${cap(SIGNS[sign])}${card.n ? `, ${ORDINAL[card.n]} decan` : ''}` : null,
    mine ? `on ${the(name)}’s ring` : null,
  ].filter(Boolean).join(' · ');

  const root = el('article', { class: 'cr' }, [
    el('h2', { class: 'dp-title cr-title', text: card.name }),
    placeLine ? el('p', { class: 'cr-place' }, [
      sign !== undefined ? el('span', { class: 'cr-sign', title: SIGNS[sign] }, [glyphSvg(sign, SIGNS[sign])]) : null,
      el('span', { text: placeLine }),
    ]) : null,
    el('figure', { class: 'cr-fig' }, [plate(card.image as ImageRef, { credit: true, className: 'cr-plate', eager: true, thumb: false })]),
    fam.oneLine ? el('p', { class: 'dp-lede cr-lede', text: fam.oneLine }) : null,
    ...parts,
    chain.length ? el('section', { class: 'cr-chain' }, [
      section('The links'),
      el('p', { class: 'dp-para cr-para', text: 'The number is the link: it stands between the suit’s element and its sephira on the Tree, and Crowley’s list carries it on to a planet.' }),
      el('ul', { class: 'dp-rows' }, chain),
    ]) : null,
  ]);
  root.style.setProperty('--cr-tint', tint);
  return [root];
}
