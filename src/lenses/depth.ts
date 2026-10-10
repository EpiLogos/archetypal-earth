// An archetype at full depth (the Great Mother is the exemplar): Jung's line between the archetype and its image, the
// two faces, the structure, the place in the growth of consciousness, then everything the field holds for it — images,
// instances, dreams — and the author's own dated instances. Rendered inside the Symbols lens.
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { eraShort } from '../data/text';
import type { Model } from '../data/model';
import type { PassageBridge } from '../ui/passage';
import { quoteBlock, type LensQuote } from './ui';

/** The archetypes that have a deep field (kept in step with curation/depth/ by tests/data/lenses.test.ts). */
const DREAMS = 5;

export const DEEP_FIELDS: ReadonlySet<string> = new Set(['great-mother']);

export interface DepthSection { id: string; title: string; line: string; quotes: (LensQuote & { speaker?: string })[]; families: string[] }
export interface DepthInstance { year: number; yearDisplay: string; place: string; note: string; text: string; cite: LensQuote['cite'] }
export interface DepthEntry { archetype: string; line: string; sections: DepthSection[]; instances: { line: string; items: DepthInstance[] }; records: number }
export interface DepthData { version: 1; archetypes: Record<string, DepthEntry> }

export interface DepthActions {
  amplifyFamily(id: string): void;
  openOccurrence(id: string): void;
  focus(): void;
  walk(): void;
}

export function depthView(m: Model, d: DepthEntry, act: DepthActions, passages: PassageBridge | undefined, ok: (i: number) => boolean): HTMLElement[] {
  const arch = m.archById.get(d.archetype)!;
  const fams = arch.familyIds.map((id) => m.famById.get(id)!).filter(Boolean);
  const occ = (m.archOcc.get(d.archetype) ?? []).filter(ok);
  const dreams = occ.filter((i) => m.occ[i].locusType === 'dream' || m.occ[i].locusType === 'vision');
  const quotes = d.sections.reduce((n, s) => n + s.quotes.length, 0);
  const stat = (n: number, label: string) => el('div', { class: 'dp-stat' }, [el('span', { class: 'dp-n', text: n.toLocaleString() }), el('span', { class: 'dp-l', text: label })]);
  const quote = (q: LensQuote & { speaker?: string }) => {
    const b = quoteBlock(q, passages, { compact: true });
    if (q.speaker) b.querySelector('.lq-voice')?.replaceChildren(q.speaker);
    return b;
  };
  const chip = (id: string) => el('button', { type: 'button', class: 'sf-pill', text: m.famById.get(id)?.name ?? id, onclick: () => act.amplifyFamily(id) });
  const dreamRow = (i: number) => {
    const o = m.occ[i];
    return el('li', {}, [el('button', { type: 'button', class: 'am-dream-h', onclick: () => act.openOccurrence(o.id) }, [el('span', { text: o.label }), el('span', { class: 'am-year', text: `${o.subject === 'jung' ? 'Jung’s own' : o.subject === 'patient-anon' ? 'a patient’s' : ''} ${o.locusType}, ${eraShort(o.yearDisplay, 18)}`.trim() })])]);
  };
  const dreamList = el('ul', { class: 'dp-dreams' }, dreams.slice(0, DREAMS).map(dreamRow));
  const nodes: (HTMLElement | null)[] = [
    el('p', { class: 'am-kicker', text: 'archetype · the deep field' }),
    el('h2', { class: 'lp-h', text: arch.name }),
    el('p', { class: 'th-line', text: d.line }),
    el('div', { class: 'dp-stats', role: 'list', 'aria-label': 'What the field holds for it' }, [
      stat(fams.length, 'images'), stat(occ.length, 'instances'), stat(dreams.length, 'dreams and visions'), stat(d.records, 'records read from Neumann'), stat(quotes, 'quotations here'),
    ]),
    el('div', { class: 'lp-row' }, [
      el('button', { type: 'button', class: 'lp-btn', onclick: act.walk }, [icon('play', 13), el('span', { text: 'Walk her through time' })]),
      el('button', { type: 'button', class: 'lp-btn quiet', onclick: act.focus }, [icon('field', 14), el('span', { text: 'On the globe' })]),
    ]),
    ...d.sections.flatMap((s) => [
      el('h3', { class: 'as-h3', text: s.title }),
      el('p', { class: 'th-line', text: s.line }),
      ...s.quotes.map(quote),
      s.families.length ? el('div', { class: 'am-chips' }, s.families.map(chip)) : null,
    ]),
    el('h3', { class: 'as-h3', text: `Her images in the field (${fams.length})` }),
    el('div', { class: 'am-chips' }, [...fams].sort((a, b) => b.occurrenceIds.length - a.occurrenceIds.length).slice(0, 24).map((f) => chip(f.id))),
    el('h3', { class: 'as-h3', text: `In dreams and visions (${dreams.length})` }),
    dreamList,
    dreams.length > DREAMS ? el('button', { type: 'button', class: 'link-quiet am-more', text: `All ${dreams.length}`, onclick: (e: Event) => {
      dreamList.replaceChildren(...dreams.map(dreamRow));
      (e.currentTarget as HTMLElement).remove();
    } }) : null,
    el('h3', { class: 'as-h3', text: 'Neumann’s dated instances' }),
    el('p', { class: 'lp-note', text: d.instances.line }),
    el('ol', { class: 'dp-instances' }, d.instances.items.map((x) => el('li', {}, [
      el('span', { class: 'am-year', text: x.year < 0 ? `${Math.abs(x.year)} BCE` : x.year < 1000 ? `${x.year} CE` : String(x.year) }),
      el('div', {}, [el('span', { class: 'dp-place', text: x.place }), quoteBlock({ text: x.text, cite: x.cite }, passages, { compact: true })]),
    ]))),
  ];
  return nodes.filter((n): n is HTMLElement => !!n);
}
