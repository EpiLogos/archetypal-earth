// A body's card: the existing reveal pattern (hero, name, one line, position, ties) for a planet, the Sun or the Moon.
//
// Honesty: every tie carries its basis and either Jung's cited passage or an honest "the atlas's reading"; a card is
// only ever opened for a body with at least one tie that resolves to a living field node; a culture's name is shown with
// the table it is transcribed from, never as the body's own character; a position outside the generated span is not
// invented, it is declined with the span stated.
import type { Model } from '../data/model';
import { subjectExists, subjectName } from '../data/model';
import type { TieBasis } from '../types/field';
import type { BodyKey, SkyBody, SkyCite, SkyData, SkyReading, SkyTie } from '../types/sky';
import { clear, el, plate } from '../ui/dom';
import { closeGlyph } from '../ui/reveal';
import { eraShort, shortLocator, shortWork } from '../ui/format';
import type { SkyEphemeris } from './ephemeris';
import { signOf } from './frames';
import { moonPhase, nextSyzygies } from './luminaries';

export interface FieldTarget { type: 'family' | 'archetype'; id: string }

export interface SkyCardHandlers {
  onField(target: FieldTarget): void;
  /** open one of the body's earth-bound occurrences, leaving the sky for the field */
  onOccurrence(id: string): void;
  onClose(): void;
}

/** What each basis says, in the words the card shows (and the tooltip explains). */
export const BASIS_LABEL: Record<TieBasis, { chip: string; title: string }> = {
  jung: { chip: 'Jung', title: 'Jung makes this link himself, in the passage cited.' },
  inferred: { chip: 'inferred', title: 'The atlas or the vault infers this link from the sources; it is not Jung\'s own statement.' },
  site: { chip: 'the atlas\'s reading', title: 'An editorial link this atlas supplies; Jung does not make it and none is cited.' },
};

/** Ties of a body whose target exists in the field, in curation order; the rest are reported, never silently shown. */
export function resolveTies(body: Pick<SkyBody, 'ties'>, model: Model): { resolved: SkyTie[]; unresolved: SkyTie[] } {
  const resolved: SkyTie[] = [];
  const unresolved: SkyTie[] = [];
  for (const t of body.ties) (subjectExists(model, t.target) ? resolved : unresolved).push(t);
  return { resolved, unresolved };
}

/** A body may open a card only when it has a resolved field link. */
export function canOpenCard(body: Pick<SkyBody, 'ties'>, model: Model): boolean {
  return resolveTies(body, model).resolved.length > 0;
}

export interface PositionReading {
  /** the line to show */
  line: string;
  /** false when no position could be given (the Earth, or a moment outside the generated span) */
  known: boolean;
}

/** "Gemini 14°32′ — tropical, ecliptic of date" with the moment it was read for; honest when it cannot be given. */
export function describePosition(key: BodyKey, eph: SkyEphemeris, ms: number, asOf: string): PositionReading {
  if (key === 'earth') return { known: false, line: 'The observer\'s own ground — the sky is read from here, so the Earth has no place in it.' };
  const p = eph.geo(key, ms);
  if (!p) {
    const span = `${eph.data.meta.span.from.slice(0, 4)}–${(Number(eph.data.meta.span.to.slice(0, 4)) - 1)}`;
    return { known: false, line: `No position for ${asOf}: the generated sky covers ${span} only.` };
  }
  const s = signOf(p.lon);
  return { known: true, line: `${s.sign} ${s.degree}°${String(s.minute).padStart(2, '0')}′ — tropical, ecliptic of date · ${asOf}` };
}

export const formatMoment = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
};

export interface CardContext {
  data: SkyData;
  eph: SkyEphemeris;
  model: Model;
  /** the instant the position is read for */
  ms: number;
  /** "as of" wording for the moment: the clock's own, or a snapshot's date */
  asOf: string;
  /** field culture id the names are read through, if any */
  culture?: string;
  /** the card stands inside a birth sky: the moment is the birth moment, and "next" events are not asked */
  birth?: boolean;
}

export class SkyCard {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private foot: HTMLElement;
  private shown = false;
  private key: string = '';
  private gen = 0;

  constructor(parent: HTMLElement, private h: SkyCardHandlers) {
    this.body = el('div', { class: 'rv-body' });
    this.foot = el('nav', { class: 'rv-links', 'aria-label': 'Go further' });
    this.root = el('aside', { class: 'reveal sky-card', 'aria-label': 'Body of the sky', 'aria-hidden': 'true' }, [
      el('button', { class: 'rv-close', type: 'button', 'aria-label': 'Close', onclick: () => h.onClose() }, [closeGlyph()]),
      this.body,
      this.foot,
    ]);
    this.root.inert = true;
    parent.append(this.root);
  }

  show(key: BodyKey, ctx: CardContext) {
    const body = ctx.data.bodies.find((b) => b.key === key);
    if (!body) return;
    const stamp = `${key}|${ctx.culture ?? ''}|${ctx.asOf}`;
    if (stamp === this.key && this.shown) return;
    const gen = ++this.gen;
    const render = () => {
      this.key = stamp;
      this.build(body, ctx);
    };
    if (this.shown && this.key !== stamp) {
      this.root.classList.add('swap');
      window.setTimeout(() => {
        if (gen !== this.gen) return;
        render();
        this.root.classList.remove('swap');
      }, 220);
    } else render();
    this.shown = true;
    this.root.inert = false;
    this.root.setAttribute('aria-hidden', 'false');
    this.root.classList.add('on');
  }

  hide() {
    ++this.gen;
    this.shown = false;
    this.key = '';
    this.root.classList.remove('on', 'swap');
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
  }

  private build(body: SkyBody, ctx: CardContext) {
    clear(this.body);
    clear(this.foot);
    this.body.scrollTop = 0;
    const m = ctx.model;
    const projection = ctx.culture ? ctx.data.cultures[ctx.culture]?.[body.key] : undefined;
    const cultureName = ctx.culture ? m.cultureById.get(ctx.culture)?.name ?? ctx.culture : undefined;

    this.body.append(portrait(body));
    const text = el('div', { class: 'rv-text' });
    text.append(el('h2', { class: 'rv-name', text: projection ? projection.name : body.name }));
    text.append(el('p', { class: 'rv-line', text: kindLine(body, !!projection) }));

    // culture reprojection is always named, and always says what it is not
    if (ctx.culture) {
      text.append(projection
        ? el('p', { class: 'sky-reproject' }, [
          `Read through ${cultureName}: ${projection.name} `,
          basisChip(projection.basis),
          el('span', { class: 'sky-source', text: ` after ${projection.source}. The character below is the default one (${body.name}).` }),
        ])
        : el('p', { class: 'sky-reproject' }, [`${cultureName} has no cell for ${body.name} in the table this is transcribed from, so it is shown under its default name.`]));
    }

    text.append(el('p', { class: 'rv-para', text: body.oneLine }));

    // the book's own definition of the body, in her words and under her name
    if (body.quotes?.length) {
      text.append(el('details', { class: 'aion-sources sky-burt' }, [
        el('summary', { text: 'Kathleen Burt · Archetypes of the Zodiac' }),
        ...body.quotes.map((q) => el('blockquote', {}, [
          el('p', { text: `“${q.text}”` }),
          el('cite', { text: `p. ${q.bookPage ?? q.page}${q.chapter ? ` · ${q.chapter}` : ''}` }),
        ])),
      ]));
    }

    const pos = describePosition(body.key, ctx.eph, ctx.ms, ctx.asOf);
    text.append(el('p', { class: `sky-position${pos.known ? '' : ' sky-position-none'}`, text: pos.line }));

    // the luminaries' astronomy first, in its own words; Jung's reading beneath it, attributed
    if (body.key === 'sun' || body.key === 'moon') text.append(this.syzygy(ctx));

    // the pair reading, for the luminaries
    for (const r of ctx.data.readings.filter((x) => x.bodies.includes(body.key))) text.append(this.reading(r));

    // ties
    const { resolved } = resolveTies(body, m);
    const ties = el('div', { class: 'sky-ties' }, [el('h3', { class: 'sky-h', text: 'In the field' })]);
    for (const t of resolved) ties.append(this.tie(t, m));
    text.append(ties);

    // the tie made flesh: occurrences on the ground the presiding families carry
    const earth = this.earthSection(m, resolved);
    if (earth) text.append(earth);

    // sources, plainly
    if (body.sources.length) {
      text.append(el('details', { class: 'aion-sources sky-body-sources' }, [
        el('summary', { text: 'Sources for this body' }),
        ...body.sources.map((s) => el('p', { class: 'sky-source-row' }, [s.claim, el('cite', { text: ` ${s.ref} (read ${s.retrieved})` })])),
      ]));
    }
    this.body.append(text);

    // the way down to the Earth
    const first = resolved.find((t) => t.basis !== 'site') ?? resolved[0];
    if (first) this.foot.append(el('button', { class: 'link-quiet', type: 'button', text: `Descend to ${subjectName(m, first.target)}`, onclick: () => this.h.onField(first.target) }));
    this.foot.append(el('button', { class: 'link-quiet', type: 'button', text: 'Back to the sky', onclick: () => this.h.onClose() }));
  }

  private tie(t: SkyTie, m: Model): HTMLElement {
    const name = subjectName(m, t.target);
    const row = el('div', { class: 'sky-tie' }, [
      el('div', { class: 'sky-tie-head' }, [
        el('button', { class: 'link-quiet', type: 'button', text: name, onclick: () => this.h.onField(t.target) }),
        el('span', { class: 'sky-kind', text: t.target.type === 'archetype' ? 'archetype' : 'family' }),
        basisChip(t.basis),
      ]),
      el('p', { class: 'sky-tie-note', text: t.note }),
    ]);
    if (t.cites?.length) row.append(passages(t.cites, 'Read the passage'));
    return row;
  }

  /**
   * Where the body's families touch the ground: one representative occurrence per family, at most three, each a
   * real field node that opens in place. An occurrence with its own image stands for the family; otherwise the
   * family's median occurrence (by year) does — deterministic, never a rotation of favourites.
   */
  private earthSection(m: Model, resolved: SkyTie[]): HTMLElement | null {
    const picks: number[] = [];
    const seenFam = new Set<string>();
    for (const t of resolved) {
      if (t.target.type !== 'family' || seenFam.has(t.target.id)) continue;
      seenFam.add(t.target.id);
      const list = (m.famOcc.get(t.target.id) ?? []).filter((i) => m.located[i]);
      if (!list.length) continue;
      const withImage = list.filter((i) => m.occ[i].image);
      const pool = withImage.length ? withImage : list;
      picks.push(pool[Math.floor(pool.length / 2)]);
      if (picks.length >= 3) break;
    }
    if (!picks.length) return null;
    const sec = el('div', { class: 'sky-earth' }, [el('h3', { class: 'sky-h', text: 'On the earth' })]);
    for (const i of picks) {
      const o = m.occ[i];
      const fam = m.famById.get(o.familyId);
      sec.append(el('button', { class: 'sky-earth-row', type: 'button', onclick: () => this.h.onOccurrence(o.id) }, [
        plate(o.image ?? fam?.image, { thumb: true, className: 'sky-earth-plate', palette: fam?.palette, alt: '' }),
        el('span', { class: 'sky-earth-text' }, [
          el('span', { class: 'sky-earth-label', text: o.label }),
          el('span', { class: 'sky-earth-era', text: `${eraShort(o.yearDisplay, 26)} · ${fam?.name ?? ''}` }),
        ]),
      ]));
    }
    return sec;
  }

  private reading(r: SkyReading): HTMLElement {
    const box = el('section', { class: 'sky-reading' }, [
      el('h3', { class: 'sky-h' }, [r.name, ' ', basisChip(r.basis)]),
      el('p', { class: 'rv-para', text: r.statement }),
    ]);
    box.append(passages(r.cites, 'Read the passages'));
    return box;
  }

  /**
   * Sun and Moon now: the elongation and the Moon's lit share, and when they next stand together and opposed. The
   * facts are the ephemeris's; each event is linked to the field entries Jung's reading of the pair names (Syzygy,
   * Coniunctio, the Self) and says whose reading that is. Nothing more is claimed about them.
   */
  private syzygy(ctx: CardContext): HTMLElement {
    const m = ctx.model;
    const box = el('section', { class: 'sky-syzygy' }, [el('h3', { class: 'sky-h', text: ctx.birth ? 'Sun and Moon at that moment' : 'Sun and Moon now' })]);
    const phase = moonPhase(ctx.eph, ctx.ms);
    if (!phase) {
      box.append(el('p', { class: 'sky-fact sky-position-none', text: `No elongation for ${ctx.asOf}: it lies outside the generated sky.` }));
      return box;
    }
    box.append(el('p', { class: 'sky-fact', text: `Elongation ${phase.elongation.toFixed(2)}° — the Moon is ${Math.round(phase.illuminated * 100)}% lit, ${phase.name}.` }));
    const reading = ctx.data.readings.find((r) => r.bodies.includes('sun') && r.bodies.includes('moon'));
    const links = (reading?.targets ?? []).filter((t) => subjectExists(m, t));
    const event = (what: string, t: number | null) => {
      const row = el('div', { class: 'sky-event' });
      if (t === null) {
        row.append(el('p', { class: 'sky-fact sky-position-none', text: `${what}: none within the generated sky.` }));
        return row;
      }
      const days = (t - ctx.ms) / 86_400_000;
      row.append(el('p', { class: 'sky-fact', text: `${what}: ${formatMoment(t)}, in ${days < 1 ? `${Math.max(1, Math.round(days * 24))} hours` : `${days.toFixed(1)} days`}.` }));
      if (links.length) {
        row.append(el('div', { class: 'aion-links sky-event-links' }, [
          el('span', { class: 'sky-source', text: 'Read in Jung\u2019s keys:' }),
          ...links.map((l) => el('button', { type: 'button', class: 'link-quiet', text: subjectName(m, l), onclick: () => this.h.onField(l) })),
        ]));
      }
      return row;
    };
    // a birth sky answers where they stood, not when they will next meet
    if (ctx.birth) {
      box.append(el('div', { class: 'aion-links sky-event-links' }, [
        el('span', { class: 'sky-source', text: 'Read in Jung\u2019s keys:' }),
        ...links.map((l) => el('button', { type: 'button', class: 'link-quiet', text: subjectName(m, l), onclick: () => this.h.onField(l) })),
      ]));
      box.append(el('p', { class: 'sky-source sky-syzygy-note', text: 'The elongation and the lit share are computed for the birth moment. The links lead to Jung\u2019s reading of the pair, given below with his passages.' }));
      return box;
    }
    const next = nextSyzygies(ctx.eph, ctx.ms);
    box.append(event('Next conjunction in longitude (new Moon)', next.conjunction), event('Next opposition (full Moon)', next.opposition));
    box.append(el('p', { class: 'sky-source sky-syzygy-note', text: 'The dates are computed from the generated ephemeris. The links lead to Jung\u2019s reading of the pair, given below with his passages.' }));
    return box;
  }
}

function kindLine(body: SkyBody, reprojected: boolean): string {
  const kind = body.key === 'sun' || body.key === 'moon' ? 'luminary' : body.key === 'earth' ? 'the ground' : body.modern ? `planet, known since ${body.discovered?.year ?? 'modern times'} — outside Jung's classical seven` : 'planet of the classical seven';
  return reprojected ? `${kind} · default name ${body.name}` : kind;
}

export function basisChip(basis: TieBasis): HTMLElement {
  const b = BASIS_LABEL[basis];
  return el('span', { class: `sky-basis sky-basis-${basis}`, title: b.title, text: b.chip });
}

function passages(cites: SkyCite[], summary: string): HTMLElement {
  return el('details', { class: 'aion-sources' }, [
    el('summary', { text: summary }),
    ...cites.map((c) => el('blockquote', {}, [el('p', { text: `“${c.quote}”` }), el('cite', { text: `Jung · ${shortWork(c.workTitle)} · ${shortLocator(c.locator)}` })])),
  ]);
}

/** A hero made of the body's own palette: a lit sphere on its deep tone. No image is claimed; none is invented. */
function portrait(body: SkyBody): HTMLElement {
  const f = el('figure', { class: 'plate rv-hero sky-portrait', 'aria-hidden': 'true' });
  f.style.setProperty('--sp-core', body.palette.core);
  f.style.setProperty('--sp-glow', body.palette.glow);
  f.style.setProperty('--sp-fog', body.palette.fog);
  f.style.setProperty('--sp-deep', body.palette.deep);
  f.append(el('span', { class: 'sky-orb' }));
  return f;
}
