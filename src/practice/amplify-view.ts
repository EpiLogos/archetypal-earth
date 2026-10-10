// One amplification, drawn: what Symbols shows for a family and what Dreams opens for each image a dream names.
// Image, Jung's definition, the instances through time, the dreams and visions among them, what it expresses, and what it
// is found with. Every line that claims something carries the vault's cite.
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { eraShort } from '../data/text';
import type { Model } from '../data/model';
import type { PassageBridge } from '../ui/passage';
import type { Occurrence } from '../types/field';
import type { Amplification } from './amplify';

export interface AmplifyActions {
  openOccurrence(occId: string): void;
  focusFamily(id: string): void;
  focusArchetype(id: string): void;
  walkFamily(id: string): void;
  /** another family, inside the same tool (Symbols or a dream's image) */
  amplifyFamily(id: string): void;
}

const yearOf = (y: number) => (y < 0 ? `${Math.abs(Math.round(y))} BCE` : `${Math.round(y)}`);
const BASIS = { jung: 'Jung ties it', inferred: 'inferred by the vault', site: 'linked by this site' } as const;
const SHOW = 12;

function citeLink(o: Occurrence, passages?: PassageBridge): HTMLElement | null {
  const c = o.jung[0];
  if (!c) return null;
  const label = `${c.workTitle}${c.year ? `, ${c.year}` : ''} · ${c.locator}`;
  return passages?.known(c.work)
    ? el('button', { type: 'button', class: 'link-quiet lq-cite', text: label, onclick: () => passages.open(c.work, c.locator) })
    : el('span', { class: 'lq-cite', text: label });
}

function instanceRow(o: Occurrence, act: AmplifyActions): HTMLElement {
  return el('li', {}, [
    el('button', { type: 'button', class: 'am-inst', onclick: () => act.openOccurrence(o.id) }, [
      el('span', { class: 'am-year', text: eraShort(o.yearDisplay, 18) }),
      el('span', { class: 'am-label', text: o.label }),
    ]),
  ]);
}

export function amplificationView(m: Model, a: Amplification, act: AmplifyActions, passages: PassageBridge | undefined, opts: { dreamFirst?: boolean } = {}): HTMLElement[] {
  const f = a.family;
  const dreams = a.dreams.map((i) => m.occ[i]);
  const list = el('ol', { class: 'am-list' }, a.instances.slice(0, SHOW).map((i) => instanceRow(m.occ[i], act)));
  const more = a.instances.length > SHOW
    ? el('button', { type: 'button', class: 'link-quiet am-more', text: `All ${a.instances.length} instances`, onclick: (e: Event) => {
      list.replaceChildren(...a.instances.map((i) => instanceRow(m.occ[i], act)));
      (e.currentTarget as HTMLElement).remove();
    } })
    : null;

  const dreamBlock = dreams.length ? el('section', { class: 'am-sec' }, [
    el('h3', { class: 'as-h3', text: `In dreams and visions (${dreams.length})` }),
    el('p', { class: 'lp-note', text: 'The dreams and visions in the corpus where this image appears: the parallels Jung lined up beside a dream image.' }),
    ...dreams.slice(0, opts.dreamFirst ? 6 : 3).map((o) => el('div', { class: 'am-dream' }, [
      el('button', { type: 'button', class: 'am-dream-h', onclick: () => act.openOccurrence(o.id) }, [el('span', { text: o.label }), el('span', { class: 'am-year', text: `${o.subject === 'jung' ? 'Jung’s own' : o.subject === 'patient-anon' ? 'a patient’s' : ''} ${o.locusType}, ${eraShort(o.yearDisplay, 18)}`.trim() })]),
      o.quote ? el('blockquote', { class: 'lq lq-compact' }, [el('p', { text: o.quote }), el('footer', {}, [citeLink(o, passages)])]) : null,
    ])),
  ]) : el('p', { class: 'lp-note', text: 'No dream or vision in the corpus carries this image, so there is no dream parallel to set beside yours.' });

  const nodes: (HTMLElement | null)[] = [
    el('p', { class: 'am-kicker', text: [f.subtype !== 'unknown' ? f.subtype : '', a.span ? `${yearOf(a.span.from.year)} to ${yearOf(a.span.to.year)}` : ''].filter(Boolean).join(' · ') }),
    el('h2', { class: 'lp-h', text: f.name }),
    f.oneLine ? el('p', { class: 'th-line', text: f.oneLine }) : null,
    f.definition ? el('blockquote', { class: 'lq' }, [el('p', { text: f.definition.text }), el('footer', {}, [el('span', { class: 'lq-cite', text: f.definition.cite })])]) : el('p', { class: 'lp-note', text: 'Jung gives no definition of this image in the vault’s records.' }),
    el('div', { class: 'lp-row' }, [
      a.instances.length > 1 ? el('button', { type: 'button', class: 'lp-btn', onclick: () => act.walkFamily(f.id) }, [icon('play', 13), el('span', { text: 'Walk it through time' })]) : null,
      el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => act.focusFamily(f.id) }, [icon('field', 14), el('span', { text: 'On the globe' })]),
    ]),
    opts.dreamFirst ? dreamBlock : null,
    a.archetypes.length ? el('section', { class: 'am-sec' }, [
      el('h3', { class: 'as-h3', text: 'What it expresses' }),
      ...a.archetypes.map((x) => el('button', { type: 'button', class: 'th-link', onclick: () => act.focusArchetype(x.archetype.id) }, [el('span', {}, [el('span', { class: 'as-tie-name', text: x.archetype.name }), el('span', { class: 'as-basis', text: BASIS[x.basis] })]), icon('next', 14)])),
    ]) : null,
    el('section', { class: 'am-sec' }, [el('h3', { class: 'as-h3', text: `Through time (${a.instances.length})` }), list, more]),
    opts.dreamFirst ? null : dreamBlock,
    a.companions.length ? el('section', { class: 'am-sec' }, [
      el('h3', { class: 'as-h3', text: 'Found with' }),
      el('div', { class: 'am-chips' }, a.companions.map((c) => el('button', { type: 'button', class: 'sf-pill', text: c.family.name, onclick: () => act.amplifyFamily(c.family.id) }))),
    ]) : null,
  ];
  return nodes.filter((n): n is HTMLElement => !!n);
}
