// H5, Dreams: the lens's Contents. The journal and the recorder, then the visitor's own dreams newest first; with no dream kept, no
// "Your dreams" group; the dream the lens stands on is marked; a dream with no title is called by its first words.
import { describe, expect, it } from 'vitest';
import { dreamName, dreamsContentsGroups, newestFirst, type DreamListing } from '../../src/lenses/dreams-contents';

const d = (id: string, date: string, title: string, text: string, createdAt = `${date}T08:00:00Z`): DreamListing => ({ id, date, title, text, createdAt });
const list = [d('a', '2026-10-01', 'The orchard', 'text a'), d('b', '2026-10-20', '', 'I was on a long road at dusk and the road kept turning back on itself, and a dog'), d('c', '2026-10-20', 'Second that day', 'text c', '2026-10-20T20:00:00Z')];

describe('the Dreams Contents', () => {
  it('holds the journal and the recorder, and no list when no dream is kept', () => {
    const g = dreamsContentsGroups([], [], () => {});
    expect(g.map((x) => x.title)).toEqual(['Dreams']);
    expect(g[0].items.map((i) => i.label)).toEqual(['The journal', 'Record a dream']);
  });

  it('lists the visitor\'s dreams newest first, by the date given then by when they were kept', () => {
    expect(newestFirst(list).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    const g = dreamsContentsGroups(list, [], () => {});
    expect(g[1].title).toBe('Your dreams');
    expect(g[1].items.map((i) => i.note)).toEqual(['2026-10-20', '2026-10-20', '2026-10-01']);
  });

  it('adds the dream\'s first words under a title it was given, and nothing under a dream called by its words', () => {
    const g = dreamsContentsGroups(list, [], () => {});
    const sub = (id: string) => g[1].items[newestFirst(list).findIndex((x) => x.id === id)].sub;
    expect(sub('a')).toBe('text a');
    expect(sub('b')).toBeUndefined();
    expect(sub('c')).toBe('text c');
  });

  it('calls a dream by its title, else its first sixty characters, else Untitled', () => {
    expect(dreamName(list[0])).toBe('The orchard');
    expect(dreamName(list[1])).toHaveLength(60);
    expect(dreamName(list[1])).toBe(list[1].text.slice(0, 60));
    expect(dreamName({ title: '  ', text: '' })).toBe('Untitled');
  });

  it('marks the dream (or the recorder, or the journal) the lens stands on, and a pick goes to its route', () => {
    const marked = (at: string[]) => dreamsContentsGroups(list, at, () => {}).flatMap((g) => g.items.filter((i) => i.current).map((i) => i.label));
    expect(marked([])).toEqual(['The journal']);
    expect(marked(['new'])).toEqual(['Record a dream']);
    expect(marked(['a'])).toEqual(['The orchard']);
    expect(marked(['a', 'serpent'])).toEqual(['The orchard']);
    const log: string[][] = [];
    const g = dreamsContentsGroups(list, [], (p) => { log.push(p); });
    g[0].items[1].onPick!();
    g[1].items[0].onPick!();
    expect(log).toEqual([['new'], ['c']]);
  });
});
