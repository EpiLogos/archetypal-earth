import type { Model } from '../data/model';
import { el } from './dom';
import { quote } from './quote';

/** Both surfaces identify the source and retain its printed-page provenance. */
export function symbolReading(model: Model, familyId: string, onFamily: (id: string) => void, compact = false): HTMLElement | null {
  const entry = model.symbols.get(familyId);
  const source = model.symbolSource;
  if (!entry || !source) return null;
  const section = el(compact ? 'details' : 'section', { class: `symbol-reading ${compact ? 'symbol-compact' : ''}`, 'aria-label': 'The Book of Symbols reading' });
  section.append(el(compact ? 'summary' : 'h3', { class: compact ? 'symbol-summary' : 'dp-sub', text: 'The Book of Symbols' }),
    el('p', { class: 'symbol-source', text: `${entry.title} · ${entry.pages.length > 1 ? 'pp.' : 'p.'} ${entry.pages.join(', ')} · ${source.year}` }));
  // the entry's own words, short, each a quotation with its printed page (the list names the book once, above)
  for (const q of entry.quotes) {
    section.append(quote({ text: q.text, cite: { work: 'book-of-symbols', workTitle: source.title, locator: `p. ${q.page}`, print: String(q.page) } }, { cite: 'locator', emphasis: compact ? 'compact' : 'body' }));
  }
  if (entry.resonances.length) {
    const links = el('p', { class: 'symbol-links' }, [el('span', { text: 'Related symbols · ' })]);
    for (const id of entry.resonances) {
      const family = model.famById.get(id);
      if (!family) continue;
      links.append(el('button', { type: 'button', class: 'link-quiet', text: family.name, onclick: () => onFamily(id) }), ' ');
    }
    section.append(links);
  }
  section.append(el('p', { class: 'symbol-source', text: `${source.title} · edited by ${source.editor}` }));
  return section;
}
