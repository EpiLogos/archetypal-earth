// S11 / S13: `plates(subject)` is the one rule for the picture a subject shows, and `floatPlate` is the float's use of it.
// Nothing here is a label: `standIn` is a value the code chooses a rule by, never a thing a reader is told.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildModel, occurrenceImage } from '../../src/data/model';
import { floatPlate, plates, walkStopPlate, type PlateContext } from '../../src/data/plates';
import { epochHeroImage, eventHeroImage, historyExtent } from '../../src/aion/model';
import { creditLine } from '../../src/ui/credit';
import type { Field } from '../../src/types/field';
import type { History } from '../../src/types/history';
import type { PeopleData } from '../../src/types/people';
import type { SkyCardsData } from '../../src/sky/cards';
import type { WalksData } from '../../src/types/walks';
import type { WorksData } from '../../src/types/works';

const ROOT = path.resolve(__dirname, '..', '..');
const json = <T,>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')) as T;
const field = json<Field>('public/data/field.json');
const history = json<History>('public/data/history.json');
history.book = json('public/data/aionbook.json');
const skyCards = json<SkyCardsData>('public/data/sky-cards.json');
const alchemy = json<{ opus: { stages: { id: string; family: string }[] } }>('public/data/alchemy.json');
const redbook = json<{ stops: { id: string }[] }>('public/data/redbook.json');
const m = buildModel(field, historyExtent(history), undefined, {
  works: json<WorksData>('public/data/works.json'),
  people: json<PeopleData>('public/data/people.json'),
  walks: json<WalksData>('public/data/walks.json'),
});
const ctx: PlateContext = { history, skyCards, stages: alchemy.opus.stages };

describe('plates: the picture a subject shows', () => {
  it('an occurrence with its own image shows it, and is not a stand-in', () => {
    const o = m.occ.find((x) => x.image)!;
    const p = plates(m, { type: 'occurrence', id: o.id });
    expect(p.image).toBe(o.image);
    expect(p.standIn).toBe(false);
  });

  it('an occurrence with no image of its own returns its family plate, marked as a stand-in', () => {
    const o = m.occ.find((x) => !x.image && m.famById.get(x.familyId)?.image)!;
    expect(o).toBeTruthy();
    const p = plates(m, { type: 'occurrence', id: o.id });
    expect(p.image).toBe(m.famById.get(o.familyId)!.image);
    expect(p.image!.src).toBe(m.famById.get(o.familyId)!.image!.src);
    expect(p.standIn).toBe(true);
    expect(p.palette).toEqual(m.famById.get(o.familyId)!.palette);
  });

  it('archetype, theoretic and family return their own plate and palette', () => {
    for (const a of m.field.archetypes) {
      const p = plates(m, { type: 'archetype', id: a.id });
      expect(p.image).toBe(a.image);
      expect(p.standIn).toBe(false);
      expect(p.palette).toEqual(a.palette);
    }
    for (const t of m.field.theoretics ?? []) expect(plates(m, { type: 'theoretic', id: t.id }).image).toBe(t.image);
    for (const f of m.field.families.slice(0, 80)) expect(plates(m, { type: 'family', id: f.id }).image).toBe(f.image);
  });

  it('the credit is the line the credit module formats, and the source link is the image\'s own', () => {
    const f = m.field.families.find((x) => x.image)!;
    const p = plates(m, { type: 'family', id: f.id });
    expect(p.credit).toBe(creditLine(f.image!));
    expect(p.sourceUrl).toBe(f.image!.sourceUrl);
  });

  it('a sky card such as thoth-ace-of-cups returns exactly the family plate (same src), not a stand-in', () => {
    const fam = m.famById.get('thoth-ace-of-cups')!.image!;
    const p = plates(m, { type: 'card', id: 'thoth-ace-of-cups' }, ctx);
    expect(p.image).toBe(fam);
    expect(p.image!.src).toBe(fam.src);
    expect(p.standIn).toBe(false);
  });

  it('every one of the 78 sky cards (the whole deck stands in the sky) resolves to the family plate with the same src as the card\'s own file', () => {
    const ids = Object.keys(skyCards.cards);
    expect(ids).toHaveLength(78);
    for (const id of ids) expect(plates(m, { type: 'card', id }, ctx).image?.src, id).toBe(skyCards.cards[id].image.src);
  });

  it('a card that is not a family falls back to the card file of its own, converted; nothing else', () => {
    const odd: PlateContext = { skyCards: { cards: { 'only-a-card': { image: { src: 'img/x.jpg', thumb: 'img/x.t.jpg', width: 3, height: 4, credit: 'C', license: 'L', sourceUrl: 'u' } } } } };
    const p = plates(m, { type: 'card', id: 'only-a-card' }, odd);
    expect(p.image).toMatchObject({ src: 'img/x.jpg', thumb: 'img/x.t.jpg', credit: 'C' });
    expect(plates(m, { type: 'card', id: 'nothing-anywhere' }, odd).image).toBeUndefined();
  });

  it('a subject with no plate anywhere returns no image: tonal, never an invented one', () => {
    const noImage = m.field.archetypes.filter((a) => !a.image);
    for (const a of noImage) {
      const p = plates(m, { type: 'archetype', id: a.id });
      expect(p.image).toBeUndefined();
      expect(p.credit).toBe('');
      expect(p.sourceUrl).toBeUndefined();
      expect(p.standIn).toBe(false);
    }
    expect(plates(m, { type: 'archetype', id: 'not-a-thing' }).image).toBeUndefined();
    expect(plates(m, { type: 'occurrence', id: 'not-a-thing' }).image).toBeUndefined();
    expect(plates(m, { type: 'person', id: 'not-a-thing' }).image).toBeUndefined();
    expect(plates(m, { type: 'card', id: 'not-a-thing' }).image).toBeUndefined();
  });

  it('an occurrence whose family has no image either is tonal, not a stand-in', () => {
    const bare = buildModel({
      ...field,
      families: field.families.map((f) => ({ ...f, image: undefined })),
      occurrences: field.occurrences.map((o) => ({ ...o, image: undefined })),
    });
    const p = plates(bare, { type: 'occurrence', id: field.occurrences[0].id });
    expect(p.image).toBeUndefined();
    expect(p.standIn).toBe(false);
  });

  it('a person\'s portrait resolves when the record names one: a file of its own, or an id in the image registers', () => {
    const jung = plates(m, { type: 'person', id: 'jung' });
    const file = m.personById.get('jung')!.portrait as { src: string; credit: string };
    expect(jung.image).toMatchObject({ src: file.src, thumb: file.src, credit: file.credit });
    expect(jung.credit).toBe(creditLine(jung.image!));
    expect(jung.sourceUrl).toMatch(/^https:/);
    const nietzsche = plates(m, { type: 'person', id: 'nietzsche' });
    const id = m.personById.get('nietzsche')!.portrait as string;
    expect(nietzsche.image).toBe(m.occ[m.occIndex.get(id)!].image);
    expect(nietzsche.image).toBeDefined();
  });

  it('a person whose record names no portrait has none', () => {
    for (const p of m.personById.values()) if (!p.portrait) expect(plates(m, { type: 'person', id: p.id }).image, p.id).toBeUndefined();
  });

  it('a work has no picture of its own: tonal', () => {
    for (const w of m.workById.values()) expect(plates(m, { type: 'work', id: w.id }).image, w.id).toBeUndefined();
  });

  it('an event takes the hero the Aion cards take (same rule), an epoch likewise', () => {
    for (const r of history.readings) {
      for (const e of r.events) {
        const p = plates(m, { type: 'event', id: e.id, reading: r.id }, ctx);
        expect(p.image, e.id).toBe(eventHeroImage(m, e));
      }
      for (const e of r.epochs) expect(plates(m, { type: 'epoch', id: e.id, reading: r.id }, ctx).image, e.id).toBe(epochHeroImage(m, r, e));
    }
  });

  it('an event whose picture is its own occurrence\'s is not a stand-in; one resting on a family plate is', () => {
    let own = 0, stood = 0;
    for (const r of history.readings) for (const e of r.events) {
      const p = plates(m, { type: 'event', id: e.id, reading: r.id }, ctx);
      if (!p.image) { expect(p.standIn).toBe(false); continue; }
      const first = e.occurrenceIds.map((id) => m.occIndex.get(id)).find((i) => i !== undefined && m.occ[i].image !== undefined);
      if (first !== undefined && e.occurrenceIds.map((id) => m.occIndex.get(id)).find((i) => i !== undefined) === first) { expect(p.standIn).toBe(false); own++; }
      else { expect(p.standIn).toBe(true); stood++; }
    }
    expect(own).toBeGreaterThan(0);
    expect(stood).toBeGreaterThan(0);
  });

  it('an event with no occurrence and no family is tonal in its epoch\'s palette', () => {
    const jung = history.readings.find((r) => r.id === 'jung-aion')!;
    const bare = jung.events.filter((e) => !eventHeroImage(m, e));
    expect(bare.length).toBeGreaterThan(0);
    for (const e of bare) {
      const p = plates(m, { type: 'event', id: e.id, reading: jung.id }, ctx);
      expect(p.image).toBeUndefined();
      expect(p.palette).toEqual(jung.epochs.find((x) => x.id === e.epochId)?.palette);
    }
  });

  it('a chapter takes the first family it names, else the hero of its first event', () => {
    for (const c of history.book!.chapters) {
      const p = plates(m, { type: 'chapter', id: c.id }, ctx);
      const fam = c.subjects.filter((s) => s.type === 'family').map((s) => m.famById.get(s.id)?.image).find(Boolean);
      if (fam) expect(p.image, c.id).toBe(fam);
    }
    expect(history.book!.chapters.filter((c) => plates(m, { type: 'chapter', id: c.id }, ctx).image).length).toBeGreaterThanOrEqual(14);
  });

  it('a Red Book stop is its occurrence: 37 resolve, the ones with no image of their own as stand-ins', () => {
    expect(redbook.stops).toHaveLength(37);
    let stood = 0;
    for (const s of redbook.stops) {
      const o = m.occ[m.occIndex.get(s.id)!];
      const p = plates(m, { type: 'stop', id: s.id });
      expect(p.image, s.id).toBe(occurrenceImage(m, o));
      expect(p.standIn).toBe(!o.image && !!p.image);
      if (p.standIn) stood++;
    }
    expect(stood).toBe(redbook.stops.filter((s) => !m.occ[m.occIndex.get(s.id)!].image).length);
  });

  it('an alchemy stage takes its family\'s plate; a stage whose family has none is tonal', () => {
    for (const st of alchemy.opus.stages) {
      const p = plates(m, { type: 'stage', id: st.id }, ctx);
      expect(p.image, st.id).toBe(m.famById.get(st.family)?.image);
    }
  });

  it('a walk stop is plated by the subject it names', () => {
    const rb = m.walkById.get('redbook')!;
    for (const s of rb.stops) expect(walkStopPlate(m, s, ctx).image).toBe(plates(m, { type: 'stop', id: s.subject!.id }).image);
    const route = m.walkById.get('theory-route')!;
    for (const s of route.stops) expect(walkStopPlate(m, s, ctx).image).toBeUndefined();
    expect(walkStopPlate(m, {}, ctx).image).toBeUndefined();
  });
});

describe('floatPlate: the float uses the rule reveal uses', () => {
  it('over the real field, the floats that show a family plate are exactly the stand-ins', () => {
    let family = 0, standIn = 0, own = 0, tonal = 0;
    for (const o of m.occ) {
      const f = floatPlate(m, o);
      const p = plates(m, { type: 'occurrence', id: o.id });
      if (f.image && f.image !== o.image) family++;
      if (p.standIn) standIn++;
      if (f.image && f.image === o.image) own++;
      if (!f.image) tonal++;
      expect(f.image).toBe(p.image);
      expect(f.standIn).toBe(p.standIn);
    }
    expect(family).toBe(standIn);
    // the count is derived from the raw field, not from the function under test
    expect(standIn).toBe(field.occurrences.filter((o) => !o.image && field.families.find((f) => f.id === o.familyId)?.image).length);
    expect(own).toBe(field.occurrences.filter((o) => o.image).length);
    expect(own + standIn + tonal).toBe(field.occurrences.length);
    expect(standIn).toBeGreaterThan(0);
  });

  it('a float with no family plate behind it is tonal', () => {
    const o = { ...m.occ[0], image: undefined, familyId: 'no-such-family' };
    const f = floatPlate(m, o);
    expect(f.image).toBeUndefined();
    expect(f.standIn).toBe(false);
  });
});
