// Context (H4): the verbs a subject answers, the same three for every kind of subject — an archetype, a family, a theoretic,
// a Work, a Person, and You. Each is always asked; a subject that has nothing behind a verb answers it as not offered, and
// the label shows only what is offered. The sky door is the one a subject has: a Person's or the visitor's chart first, else
// the body its occurrences are tied to.
import type { Subject } from '../data/model';
import type { BodyKey } from '../types/sky';

export type VerbId = 'sky' | 'thread' | 'reading';
/** The order the label gives them in. */
export const VERB_IDS: VerbId[] = ['sky', 'thread', 'reading'];

/** The visitor's own node: not a record of the field, a page the browser derives (practice store). */
export type ContextSubject = Subject | { type: 'you'; id: 'you' };

export type SkyDoor = { kind: 'body'; body: BodyKey } | { kind: 'chart'; chart: string };

/** What the app can say of a subject, read where it is known (the controller hands these in). */
export interface ContextSources {
  /** how many stops the subject's thread has */
  threadStops(s: Subject): number;
  /** a body the subject is tied to, or the first place in the sky its occurrences hang at */
  tie(s: Subject): { body: BodyKey; name: string } | null;
  /** the chart that stands for the subject: a Person with a birth, You with a saved chart */
  chart(s: Subject | 'you'): string | null;
}

export interface VerbFacts {
  thread: number;
  sky: { door: SkyDoor; label: string } | null;
}

export function verbFacts(s: ContextSubject, src: ContextSources): VerbFacts {
  if (s.type === 'you') {
    const chart = src.chart('you');
    return { thread: 0, sky: chart ? { door: { kind: 'chart', chart }, label: 'your birth' } : null };
  }
  const chart = s.type === 'person' ? src.chart(s) : null;
  if (chart) return { thread: src.threadStops(s), sky: { door: { kind: 'chart', chart }, label: 'birth sky' } };
  const tie = src.tie(s);
  return { thread: src.threadStops(s), sky: tie ? { door: { kind: 'body', body: tie.body }, label: tie.name } : null };
}

export interface Verb { id: VerbId; text: string; offered: boolean; door?: SkyDoor }

/** The three verbs, always in the same order, each marked offered or not. */
export function verbsOf(f: VerbFacts): Verb[] {
  return [
    { id: 'sky', text: f.sky ? `See in sky (${f.sky.label})` : 'See in sky', offered: !!f.sky, door: f.sky?.door },
    { id: 'thread', text: 'Follow the thread', offered: f.thread >= 2 },
    { id: 'reading', text: 'Reading', offered: true },
  ];
}
