// `plates(subject)`: the one rule for the picture a subject shows. Floats, the reveal card, the reading pane, the walk rails and
// the sky orbits all ask here, so the same subject cannot show a family plate on one surface and a tonal plate on another.
// Pure: it reads the Model (and, for the kinds the Model does not hold, a PlateContext) and returns a value. Nothing is
// drawn, nothing is written, and a picture is never invented: where no register holds one the result has no image and the
// surface paints its tonal plate in `palette`.
//
// `standIn` is a value the code chooses a rule by, never a thing a reader is told. It is true when the picture shown is a
// family's, standing for a more particular subject (an occurrence, a folio, an event) that has no plate of its own.
import type { Archetype, Family, ImageRef, Palette, Theoretic } from '../types/field';
import type { History, HistoryReading } from '../types/history';
import type { Person, PersonPortraitFile } from '../types/people';
import type { WalkStop } from '../types/walks';
import type { CardInfo } from '../sky/cards';
import { creditLine, creditLineFull } from '../ui/credit';
import type { Model } from './model';

/** The subject kinds a plate is asked for. `stop` is a Red Book folio (its id is the occurrence's). */
export type PlateSubject =
  | { type: 'archetype' | 'theoretic' | 'family' | 'occurrence' | 'work' | 'person' | 'stop' | 'stage' | 'card' | 'chapter'; id: string }
  | { type: 'event' | 'epoch'; id: string; /** the reading it belongs to; searched for when absent */ reading?: string };

/** What the Model does not hold: the Aion history (with its book), the alchemy stages, the sky cards. Each is optional; absent, its kind is tonal. */
export interface PlateContext {
  history?: Pick<History, 'readings' | 'book'>;
  /** the opus stages of alchemy.json: a stage's plate is its family's */
  stages?: readonly { id: string; family: string }[];
  /** public/data/sky-cards.json: a card is its family's plate; the card's own file is used only for a card with no family */
  skyCards?: { cards: Record<string, Pick<CardInfo, 'image'>> } | null;
}

export interface Plate {
  /** the picture; undefined leaves a tonal plate */
  image?: ImageRef;
  /** the palette of the subject (or of what it stands under), for the tonal plate and the tint before load */
  palette?: Palette;
  /** the credit line, as `src/ui/credit.ts` formats it ('' when there is no image) */
  credit: string;
  /** the same line unclipped, for a title attribute */
  creditFull: string;
  sourceUrl?: string;
  standIn: boolean;
}

const TONAL: Plate = { credit: '', creditFull: '', standIn: false };

function make(image: ImageRef | undefined, palette: Palette | undefined, standIn = false): Plate {
  if (!image) return { credit: '', creditFull: '', standIn: false, ...(palette ? { palette } : {}) };
  return {
    image,
    ...(palette ? { palette } : {}),
    credit: creditLine(image),
    creditFull: creditLineFull(image),
    ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
    standIn,
  };
}

/** A portrait kept as a file in a person's record, as an ImageRef (a portrait has one size). */
function portraitFile(p: PersonPortraitFile): ImageRef {
  return { src: p.src, thumb: p.src, width: p.width ?? 0, height: p.height ?? 0, title: p.title, credit: p.credit, license: p.license, sourceUrl: p.sourceUrl };
}

/** A card's own file as an ImageRef: only for a card the families do not hold. Fields the file lacks stay empty, never filled. */
function cardFile(c: Pick<CardInfo, 'image'>['image']): ImageRef {
  return { src: c.src, thumb: c.thumb, width: c.width, height: c.height, ...(c.tone ? { tone: c.tone } : {}), title: c.title ?? '', credit: c.credit ?? '', license: c.license ?? '', sourceUrl: c.sourceUrl ?? '' };
}

function readingsOf(ctx: PlateContext, reading?: string): HistoryReading[] {
  const all = ctx.history?.readings ?? [];
  return reading ? all.filter((r) => r.id === reading) : all;
}

const familyPlate = (m: Model, id: string): { image?: ImageRef; palette?: Palette } => {
  const f: Family | undefined = m.famById.get(id);
  return { image: f?.image, palette: f?.palette };
};

/** An occurrence: its own image, else its family's (a stand-in), else none. The one rule floats, reveal and the folios share. */
function plateOfOccurrence(m: Model, o: { image?: ImageRef; familyId: string }): Plate {
  const fam = familyPlate(m, o.familyId);
  if (o.image) return make(o.image, fam.palette);
  return make(fam.image, fam.palette, !!fam.image);
}

function occurrencePlate(m: Model, id: string): Plate {
  const i = m.occIndex.get(id);
  return i === undefined ? TONAL : plateOfOccurrence(m, m.occ[i]);
}

/**
 * The hero of an event: its first gathered occurrence's picture (its own, else its family's), then the first family it names
 * with one. Same rule as `eventHeroImage` in aion/model.ts; a hero resting on a family plate is a stand-in, one that is the
 * occurrence's own is not.
 */
function eventPlate(m: Model, ctx: PlateContext, id: string, reading?: string): Plate {
  for (const r of readingsOf(ctx, reading)) {
    const e = r.events.find((x) => x.id === id);
    if (!e) continue;
    const palette = r.epochs.find((x) => x.id === e.epochId)?.palette;
    for (const oid of e.occurrenceIds) {
      const i = m.occIndex.get(oid);
      if (i === undefined) continue;
      const o = m.occ[i];
      if (o.image) return make(o.image, palette);
      const fam = m.famById.get(o.familyId)?.image;
      if (fam) return make(fam, palette, true);
    }
    for (const fid of e.familyIds) {
      const fam = m.famById.get(fid)?.image;
      if (fam) return make(fam, palette, true);
    }
    return make(undefined, palette);
  }
  return TONAL;
}

/** An epoch and every epoch nested inside it. */
function epochSpan(r: HistoryReading, root: string): Set<string> {
  const ids = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of r.epochs) if (e.parentId && ids.has(e.parentId) && !ids.has(e.id)) { ids.add(e.id); grew = true; }
  }
  return ids;
}

/** The hero of an epoch: the families of the events inside it, the most-cited first (same rule as `epochHeroImage`). The families are named by the epoch's events, so it is not a stand-in. */
function epochPlate(m: Model, ctx: PlateContext, id: string, reading?: string): Plate {
  for (const r of readingsOf(ctx, reading)) {
    const epoch = r.epochs.find((x) => x.id === id);
    if (!epoch) continue;
    const inside = epochSpan(r, id);
    const counts = new Map<string, number>();
    for (const e of r.events) if (inside.has(e.epochId)) for (const f of e.familyIds) counts.set(f, (counts.get(f) ?? 0) + 1);
    for (const [f] of [...counts].sort((a, b) => b[1] - a[1])) {
      const image = m.famById.get(f)?.image;
      if (image) return make(image, epoch.palette);
    }
    return make(undefined, epoch.palette);
  }
  return TONAL;
}

/** A chapter of the book: the first family it names with a picture, else the hero of the first of its events that has one. */
function chapterPlate(m: Model, ctx: PlateContext, id: string): Plate {
  const chapter = ctx.history?.book?.chapters.find((c) => c.id === id);
  if (!chapter) return TONAL;
  let palette: Palette | undefined;
  for (const s of chapter.subjects) {
    if (s.type !== 'family') continue;
    const f = m.famById.get(s.id);
    palette ??= f?.palette;
    if (f?.image) return make(f.image, f.palette);
  }
  for (const e of chapter.events) {
    const p = eventPlate(m, ctx, e.id, e.reading);
    if (p.image) return { ...p, palette: palette ?? p.palette };
    palette ??= p.palette;
  }
  return make(undefined, palette);
}

/** A person: the portrait their record names (a file of its own, or an id in the image registers). No portrait named, none shown. */
function personPlate(m: Model, p: Person | undefined): Plate {
  const named = p?.portrait;
  if (!named) return TONAL;
  if (typeof named !== 'string') return make(portraitFile(named), undefined);
  const i = m.occIndex.get(named);
  const image = (i !== undefined ? m.occ[i].image : undefined)
    ?? m.famById.get(named)?.image
    ?? m.archById.get(named)?.image
    ?? m.theoById.get(named)?.image;
  return make(image, undefined);
}

/** A work has no picture of its own; its tonal plate takes the colours of the family its cites touch most. */
function workPlate(m: Model, id: string): Plate {
  const w = m.workById.get(id);
  const top = w?.ties.families[0];
  return make(undefined, top ? m.famById.get(top.id)?.palette : undefined);
}

/** The picture a subject shows. Pure; an unknown id, or a subject nothing holds a picture for, is a tonal plate. */
export function plates(m: Model, subject: PlateSubject, ctx: PlateContext = {}): Plate {
  switch (subject.type) {
    case 'archetype': {
      const a: Archetype | undefined = m.archById.get(subject.id);
      return a ? make(a.image, a.palette) : TONAL;
    }
    case 'theoretic': {
      const t: Theoretic | undefined = m.theoById.get(subject.id);
      return t ? make(t.image, t.palette) : TONAL;
    }
    case 'family': {
      const f = m.famById.get(subject.id);
      return f ? make(f.image, f.palette) : TONAL;
    }
    case 'occurrence':
    case 'stop':
      return occurrencePlate(m, subject.id);
    case 'event':
      return eventPlate(m, ctx, subject.id, subject.reading);
    case 'epoch':
      return epochPlate(m, ctx, subject.id, subject.reading);
    case 'chapter':
      return chapterPlate(m, ctx, subject.id);
    case 'stage': {
      const family = ctx.stages?.find((s) => s.id === subject.id)?.family;
      const f = family ? familyPlate(m, family) : {};
      return make(f.image, f.palette);
    }
    case 'card': {
      // a sky card is the family of the same id: the card files are the family plates (54 of 54 share their src)
      const f = familyPlate(m, subject.id);
      if (f.image) return make(f.image, f.palette);
      const own = ctx.skyCards?.cards[subject.id]?.image;
      return make(own ? cardFile(own) : undefined, f.palette);
    }
    case 'work':
      return workPlate(m, subject.id);
    case 'person':
      return personPlate(m, m.personById.get(subject.id));
  }
}

/** The plate of a walk stop: the subject it names. A route stop or a concept has no plate register, so it is tonal. */
export function walkStopPlate(m: Model, stop: WalkStop, ctx: PlateContext = {}): Plate {
  const s = stop.subject;
  if (!s) return TONAL;
  switch (s.type) {
    case 'occurrence': return plates(m, { type: 'stop', id: s.id }, ctx);
    case 'event': return plates(m, { type: 'event', id: s.id }, ctx);
    case 'chapter': return plates(m, { type: 'chapter', id: s.id }, ctx);
    case 'stage': return plates(m, { type: 'stage', id: s.id }, ctx);
    default: return TONAL;
  }
}

/**
 * The float's rule (S13), the one the reveal card already follows: an occurrence's own plate, else its family's marked as a
 * stand-in, else tonal. A float and a reveal of the same occurrence now show the same picture.
 */
export function floatPlate(m: Model, occurrence: { image?: ImageRef; familyId: string }): Plate {
  return plateOfOccurrence(m, occurrence);
}
