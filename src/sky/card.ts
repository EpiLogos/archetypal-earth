// A body's card: the existing reveal pattern for a planet, the Sun or the Moon. Order is the dossier's: the hero, the
// name and kind, one key passage in its own voice, the one-line identity, what the body is tied to in the field, its
// earthly occurrences, then its position and (for the luminaries) its syzygy, the readings, and the sources last.
//
// Honesty: every tie carries its basis and either Jung's cited passage or an honest "the atlas's reading"; a card is
// only ever opened for a body with at least one tie that resolves to a living field node; a culture's name is shown with
// the table it is transcribed from, never as the body's own character; a position outside the generated span is not
// invented, it is declined with the span stated. Words are Burt's under her name, Jung's under his, never swapped.
import type { Model } from '../data/model';
import { subjectExists, subjectName } from '../data/model';
import type { TieBasis } from '../types/field';
import type { BodyKey, SkyBody, SkyBodyQuote, SkyCite, SkyData, SkyReading, SkyTie } from '../types/sky';
import { clear, el, plate } from '../ui/dom';
import { closeGlyph } from '../ui/reveal';
import { eraShort, passageLine } from '../ui/format';
import type { PassageBridge } from '../ui/passage';
import type { SkyEphemeris } from './ephemeris';
import { signOf } from './frames';
import { moonPhase, nextSyzygies } from './luminaries';

export interface FieldTarget { type: 'family' | 'archetype'; id: string }

export interface SkyCardHandlers {
  onField(target: FieldTarget): void;
  /** open one of the body's earth-bound occurrences, leaving the sky for the field */
  onOccurrence(id: string): void;
  onClose(): void;
  /** the corpus bridge: a Burt cite is a link only when her book stands in the corpus (wave 4) */
  passage?: PassageBridge;
}

/** What each basis says, in the words the card shows (and the tooltip explains). */
export const BASIS_LABEL: Record<TieBasis, { chip: string; title: string }> = {
  jung: { chip: 'Jung', title: 'Jung makes this link himself, in the passage cited.' },
  inferred: { chip: 'inferred', title: 'Inferred from the sources; it is not Jung’s own statement.' },
  site: { chip: 'read here', title: 'An editorial link this atlas supplies; Jung does not make it and none is cited.' },
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

/**
 * A tie's note as the card draws it, or null. A note the curation marks `restates` only says what the basis chip beside
 * it already says (an inference, an editorial link) and is kept in the data, not drawn. Every other note is drawn.
 */
export function tieNote(t: Pick<SkyTie, 'note' | 'restates'>): string | null {
  return t.restates || !t.note.trim() ? null : t.note;
}

/** Burt's footer, in her name and her book's own page. */
export function burtFooter(q: SkyBodyQuote): string {
  return `Kathleen Burt · Archetypes of the Zodiac · p. ${q.bookPage ?? q.page}`;
}

export interface KeyPassage {
  /** whose words: Kathleen Burt's definition of the body, or a passage Jung cites for a tie or the pair reading */
  voice: 'burt' | 'jung';
  quote: string;
  /** the footer line, in the same voice as every other cite on the site */
  footer: string;
  /** Burt's page, when the quote is hers (the corpus bridge opens it) */
  burt?: SkyBodyQuote;
  /** the Jung cite that leads the card; it is not repeated in its own tie's disclosure */
  cite?: SkyCite;
}

/**
 * The one passage the card leads with. The Sun and the Moon lead with the pair reading Jung gives them (the coniunctio),
 * and Burt's definition sits in her disclosure. Every other body leads with Burt's definition when the book gives one,
 * else with the first passage Jung cites for a tie that Jung makes (or for a reading of this body). Never the atlas's
 * own link: that has no quotation.
 */
export function keyPassageOf(
  body: Pick<SkyBody, 'key' | 'quotes'>,
  resolved: SkyTie[],
  readings: SkyReading[],
  m: Model,
): KeyPassage | null {
  const jungKey = (cite: SkyCite): KeyPassage => ({ voice: 'jung', quote: cite.quote, footer: passageLine(m, cite.work, cite.locator), cite });
  if (body.key === 'sun' || body.key === 'moon') {
    const pair = readings.find((r) => r.basis === 'jung' && r.bodies.includes(body.key) && r.cites.length)?.cites[0];
    if (pair) return jungKey(pair);
  }
  const q = body.quotes?.[0];
  if (q) return { voice: 'burt', quote: q.text, footer: burtFooter(q), burt: q };
  const cite = resolved.find((t) => t.basis === 'jung' && t.cites?.length)?.cites?.[0]
    ?? readings.find((r) => r.basis === 'jung' && r.bodies.includes(body.key) && r.cites.length)?.cites[0];
  if (!cite) return null;
  return jungKey(cite);
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
    return { known: false, line: `No position for ${asOf}: the sky tables cover ${span} only.` };
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
    const { resolved } = resolveTies(body, m);
    const key = keyPassageOf(body, resolved, ctx.data.readings, m);
    // the passage the card leads with is not repeated in a disclosure beneath it
    const skip = key?.cite;

    // the hero: a genuine picture of the body when one is curated, else the drawn orb (the tonal plate of this mode)
    this.body.append(body.image
      ? plate(body.image, { className: 'rv-hero sky-portrait', credit: true, palette: body.palette, eager: true, alt: body.name })
      : portrait(body));
    const text = el('div', { class: 'rv-text' });
    text.append(el('h2', { class: 'rv-name', text: projection ? projection.name : body.name }));
    text.append(el('p', { class: 'rv-line', text: kindLine(body, !!projection) }));

    // culture reprojection is always named, and always says what it is not; its table is the chip's own tooltip
    if (ctx.culture) {
      text.append(projection
        ? el('p', { class: 'sky-reproject' }, [
          `Read through ${cultureName}: ${projection.name} `,
          basisChip(projection.basis, projection.source),
          `. The character below is the default one (${body.name}).`,
        ])
        : el('p', { class: 'sky-reproject' }, [`${cultureName} gives ${body.name} no name of its own; it stands under its default name.`]));
    }

    // the key passage, open: one quotation, in its own voice and under its own name
    if (key) text.append(this.keyBlock(key));

    text.append(el('p', { class: 'rv-para', text: body.oneLine }));

    // the rest of the book's own definitions of the body, in her words and under her name, quietly
    const more = (body.quotes ?? []).slice(key?.burt ? 1 : 0);
    if (more.length) {
      text.append(el('details', { class: 'aion-sources sky-burt' }, [
        el('summary', { text: 'Kathleen Burt · Archetypes of the Zodiac' }),
        ...more.map((q) => this.burtQuote(q)),
      ]));
    }

    // each quiet disclosure of further passages is named for what it adds to, once the card has more than one
    const pairs = ctx.data.readings.filter((x) => x.bodies.includes(body.key));
    const disclosures = resolved.filter((t) => (t.cites ?? []).some((c) => c !== skip)).length
      + pairs.filter((r) => r.cites.some((c) => c !== skip)).length;
    const moreLabel = (name: string) => (disclosures > 1 ? `More on ${name}` : 'More from the text');

    // the field the body is tied to, then the ground those families touch
    const ties = el('div', { class: 'sky-ties' }, [el('h3', { class: 'sky-h', text: 'In the field' })]);
    for (const t of resolved) ties.append(this.tie(t, m, skip, moreLabel));
    text.append(ties);
    const earth = this.earthSection(m, resolved);
    if (earth) text.append(earth);

    // then the position, and for the luminaries their syzygy: the astronomy in its own words, Jung's reading beneath
    const pos = describePosition(body.key, ctx.eph, ctx.ms, ctx.asOf);
    text.append(el('p', { class: `sky-position${pos.known ? '' : ' sky-position-none'}`, text: pos.line }));
    if (body.key === 'sun' || body.key === 'moon') text.append(this.syzygy(ctx));

    // the pair reading, for the luminaries
    for (const r of pairs) text.append(this.reading(r, m, skip, moreLabel));

    // sources, plainly, last
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

  /** the open key passage: a blockquote in the field's own definition pattern, its footer in the voice of its author */
  private keyBlock(k: KeyPassage): HTMLElement {
    const footer = el('footer', {});
    if (k.burt) {
      // wave 4 put her pages in the corpus: the cite opens the page it was verified against
      const page = `p. ${k.burt.bookPage ?? k.burt.page}`;
      footer.append('Kathleen Burt · Archetypes of the Zodiac · ');
      footer.append(this.h.passage?.known('burt-zodiac')
        ? el('button', {
          class: 'link-quiet dp-cite-link', type: 'button', text: page,
          title: 'Open the page in the corpus', 'aria-label': `${page} — open the page`,
          onclick: () => this.h.passage!.open('burt-zodiac', `${page} (pdf p${k.burt!.page})`),
        })
        : page);
    } else footer.append(k.footer);
    return el('blockquote', { class: `dp-def sky-key sky-key-${k.voice}` }, [el('p', { text: `“${k.quote}”` }), footer]);
  }

  private burtQuote(q: SkyBodyQuote): HTMLElement {
    const citeText = `p. ${q.bookPage ?? q.page}${q.chapter ? ` · ${q.chapter}` : ''}`;
    // wave 4 put her pages in the corpus: the cite opens the page it was verified against
    const cite = this.h.passage?.known('burt-zodiac')
      ? el('button', {
        class: 'link-quiet dp-cite-link', type: 'button', text: citeText,
        title: 'Open the page in the corpus', 'aria-label': `${citeText} — open the page`,
        onclick: () => this.h.passage!.open('burt-zodiac', `p. ${q.bookPage ?? q.page} (pdf p${q.page})`),
      })
      : el('cite', { text: citeText });
    return el('blockquote', {}, [el('p', { text: `“${q.text}”` }), cite]);
  }

  private tie(t: SkyTie, m: Model, skip: SkyCite | undefined, moreLabel: (name: string) => string): HTMLElement {
    const name = subjectName(m, t.target);
    const row = el('div', { class: 'sky-tie' }, [
      el('div', { class: 'sky-tie-head' }, [
        el('button', { class: 'link-quiet', type: 'button', text: name, onclick: () => this.h.onField(t.target) }),
        el('span', { class: 'sky-kind', text: t.target.type === 'archetype' ? 'archetype' : 'family' }),
        basisChip(t.basis),
      ]),
    ]);
    const note = tieNote(t);
    if (note) row.append(el('p', { class: 'sky-tie-note', text: note }));
    const cites = (t.cites ?? []).filter((c) => c !== skip);
    if (cites.length) row.append(passages(m, cites, moreLabel(name)));
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

  private reading(r: SkyReading, m: Model, skip: SkyCite | undefined, moreLabel: (name: string) => string): HTMLElement {
    const box = el('section', { class: 'sky-reading' }, [
      el('h3', { class: 'sky-h' }, [r.name, ' ', basisChip(r.basis)]),
      el('p', { class: 'rv-para', text: r.statement }),
    ]);
    const cites = r.cites.filter((c) => c !== skip);
    if (cites.length) box.append(passages(m, cites, moreLabel(r.name)));
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
      box.append(el('p', { class: 'sky-fact sky-position-none', text: `No elongation for ${ctx.asOf}: it lies outside the sky tables.` }));
      return box;
    }
    box.append(el('p', { class: 'sky-fact', text: `Elongation ${phase.elongation.toFixed(2)}° — the Moon is ${Math.round(phase.illuminated * 100)}% lit, ${phase.name}.` }));
    const reading = ctx.data.readings.find((r) => r.bodies.includes('sun') && r.bodies.includes('moon'));
    const links = (reading?.targets ?? []).filter((t) => subjectExists(m, t));
    const event = (what: string, t: number | null) => {
      const row = el('div', { class: 'sky-event' });
      if (t === null) {
        row.append(el('p', { class: 'sky-fact sky-position-none', text: `${what}: none within the sky tables.` }));
        return row;
      }
      const days = (t - ctx.ms) / 86_400_000;
      row.append(el('p', { class: 'sky-fact', text: `${what}: ${formatMoment(t)}, in ${days < 1 ? `${Math.max(1, Math.round(days * 24))} hours` : `${days.toFixed(1)} days`}.` }));
      if (links.length) {
        row.append(el('div', { class: 'aion-links sky-event-links' }, [
          el('span', { class: 'sky-source', text: 'Read in Jung’s keys:' }),
          ...links.map((l) => el('button', { type: 'button', class: 'link-quiet', text: subjectName(m, l), onclick: () => this.h.onField(l) })),
        ]));
      }
      return row;
    };
    // a birth sky answers where they stood, not when they will next meet
    if (ctx.birth) {
      box.append(el('div', { class: 'aion-links sky-event-links' }, [
        el('span', { class: 'sky-source', text: 'Read in Jung’s keys:' }),
        ...links.map((l) => el('button', { type: 'button', class: 'link-quiet', text: subjectName(m, l), onclick: () => this.h.onField(l) })),
      ]));
      box.append(el('p', { class: 'sky-source sky-syzygy-note', text: 'Computed for the birth moment.' }));
      return box;
    }
    const next = nextSyzygies(ctx.eph, ctx.ms);
    box.append(event('Next conjunction in longitude (new Moon)', next.conjunction), event('Next opposition (full Moon)', next.opposition));
    box.append(el('p', { class: 'sky-source sky-syzygy-note', text: 'Computed from the ephemeris.' }));
    return box;
  }
}

function kindLine(body: SkyBody, reprojected: boolean): string {
  const kind = body.key === 'sun' || body.key === 'moon' ? 'luminary' : body.key === 'earth' ? 'the ground' : body.modern ? `planet, known since ${body.discovered?.year ?? 'modern times'} — outside Jung's classical seven` : 'planet of the classical seven';
  return reprojected ? `${kind} · default name ${body.name}` : kind;
}

export function basisChip(basis: TieBasis, source?: string): HTMLElement {
  return el('span', { class: `sky-basis sky-basis-${basis}`, title: basisTitle(basis, source), text: BASIS_LABEL[basis].chip });
}

/** The chip's tooltip: what the basis says and, for a culture's reading, the table it is transcribed from. */
export function basisTitle(basis: TieBasis, source?: string): string {
  const title = BASIS_LABEL[basis].title;
  return source ? `${title} Source: ${source}` : title;
}

/** A quiet disclosure of further passages, each cited in the site's one voice: "Jung · Aion · 1951 · ¶149". */
function passages(m: Model, cites: SkyCite[], summary: string): HTMLElement {
  return el('details', { class: 'aion-sources' }, [
    el('summary', { text: summary }),
    ...cites.map((c) => el('blockquote', {}, [el('p', { text: `“${c.quote}”` }), el('cite', { text: passageLine(m, c.work, c.locator) })])),
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
