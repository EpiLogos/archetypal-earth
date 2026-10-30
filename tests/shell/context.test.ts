import { describe, expect, it } from 'vitest';
import { verbFacts, verbsOf, VERB_IDS, type ContextSources, type ContextSubject } from '../../src/shell/context';

const subjects: [string, ContextSubject][] = [
  ['an archetype', { type: 'archetype', id: 'anima' }],
  ['a family', { type: 'family', id: 'serpent' }],
  ['a theoretic', { type: 'theoretic', id: 'psychoid' }],
  ['a Work', { type: 'work', id: 'cw9ii' }],
  ['a Person', { type: 'person', id: 'jung' }],
  ['You', { type: 'you', id: 'you' }],
];

const none: ContextSources = { threadStops: () => 0, tie: () => null, chart: () => null };

describe('Context: the same verbs for every subject', () => {
  it('answers the same three verbs, in the same order, for each kind of subject, with and without anything behind them', () => {
    for (const [what, s] of subjects) {
      expect(verbsOf(verbFacts(s, none)).map((v) => v.id), what).toEqual(VERB_IDS);
      const rich: ContextSources = { threadStops: () => 5, tie: () => ({ body: 'sun', name: 'Sol' }), chart: () => 'chart-1' };
      expect(verbsOf(verbFacts(s, rich)).map((v) => v.id), what).toEqual(VERB_IDS);
    }
  });

  it('the Reading is offered for every subject, You included', () => {
    for (const [what, s] of subjects) expect(verbsOf(verbFacts(s, none)).find((v) => v.id === 'reading')?.offered, what).toBe(true);
  });

  it('offers a thread only where the subject has stops enough to walk (two)', () => {
    const one: ContextSources = { ...none, threadStops: () => 1 };
    const many: ContextSources = { ...none, threadStops: () => 4 };
    expect(verbsOf(verbFacts({ type: 'work', id: 'cw9ii' }, one)).find((v) => v.id === 'thread')?.offered).toBe(false);
    expect(verbsOf(verbFacts({ type: 'work', id: 'cw9ii' }, many)).find((v) => v.id === 'thread')?.offered).toBe(true);
  });

  it('a Work and a Person reach the sky through the places their occurrences hang at, a Person with a chart through the chart first', () => {
    const tie: ContextSources = { ...none, tie: () => ({ body: 'moon', name: 'Moon' }) };
    const w = verbsOf(verbFacts({ type: 'work', id: 'cw9ii' }, tie)).find((v) => v.id === 'sky')!;
    expect(w.offered).toBe(true);
    expect(w.text).toBe('See in sky (Moon)');
    expect(w.door).toEqual({ kind: 'body', body: 'moon' });
    const p = verbsOf(verbFacts({ type: 'person', id: 'jung' }, { ...tie, chart: (s) => (s === 'you' ? null : 'jung') })).find((v) => v.id === 'sky')!;
    expect(p.door).toEqual({ kind: 'chart', chart: 'jung' });
  });

  it('You reaches the sky through the visitor’s own chart, when there is one, and offers none when there is not', () => {
    const me: ContextSubject = { type: 'you', id: 'you' };
    const withChart = verbsOf(verbFacts(me, { ...none, chart: (s) => (s === 'you' ? 'you' : null) }));
    expect(withChart.find((v) => v.id === 'sky')).toMatchObject({ offered: true, door: { kind: 'chart', chart: 'you' } });
    const without = verbsOf(verbFacts(me, none));
    expect(without.find((v) => v.id === 'sky')?.offered).toBe(false);
    // You has no place on the Earth: it never offers a thread of its own
    expect(verbsOf(verbFacts(me, { ...none, threadStops: () => 9 })).find((v) => v.id === 'thread')?.offered).toBe(false);
  });
});
