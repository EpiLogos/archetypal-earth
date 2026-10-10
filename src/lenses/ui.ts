// Shared pieces for the panel lenses: a quotation with its cite (provenance lives in the quote, MODES-RFC laws),
// the privacy line every personal tool carries, and a small loader for the lens data files.
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import type { PassageBridge } from '../ui/passage';
import { resolveSrc } from '../data/load';

export interface LensCite {
  work: string;
  workTitle: string;
  locator: string;
  print?: string;
}

export interface LensQuote {
  text: string;
  cite: LensCite;
  /** whose words, when not Jung's: 'neumann' | 'von-franz' | 'burt' … (the cite says so too) */
  voice?: string;
}

/** A verbatim quotation and its cite; the cite opens the passage at its source when the corpus holds the work. */
export function quoteBlock(q: LensQuote, passages: PassageBridge | undefined, opts: { compact?: boolean } = {}): HTMLElement {
  const c = q.cite;
  const label = `${c.workTitle}, ${c.locator}${c.print ? ` · p. ${c.print}` : ''}`;
  const cite = passages?.known(c.work)
    ? el('button', { type: 'button', class: 'link-quiet lq-cite', text: label, title: 'Open the passage in the corpus', onclick: () => passages.open(c.work, c.locator) })
    : el('span', { class: 'lq-cite', text: label });
  return el('blockquote', { class: `lq ${opts.compact ? 'lq-compact' : ''}` }, [el('p', { text: q.text }), el('footer', {}, [cite])]);
}

/** The line every personal tool shows, plainly: where the data lives and what never happens to it. */
export function privacyLine(extra = ''): HTMLElement {
  return el('p', { class: 'lp-privacy' }, [icon('lock', 13), el('span', { text: `Stays in this browser. Nothing is sent anywhere.${extra ? ` ${extra}` : ''}` })]);
}

export function lensHeading(text: string, sub?: string): HTMLElement[] {
  return [el('h2', { class: 'lp-h', text }), ...(sub ? [el('p', { class: 'lp-sub', text: sub })] : [])];
}

const cache = new Map<string, Promise<unknown>>();
/** Fetch a lens data file once (public/data/<name>.json). */
export function loadLensData<T>(name: string): Promise<T> {
  if (!cache.has(name)) {
    cache.set(name, fetch(resolveSrc(`data/${name}.json`)).then((r) => {
      // the dev server answers a missing file with index.html: absent, never invented
      if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`${name}.json is not available`);
      return r.json();
    }));
  }
  return cache.get(name) as Promise<T>;
}
