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

/** Whose words a work holds, when they are not Jung's: said beside the cite, so no one else reads as Jung. */
export function voiceOf(work: string): string | null {
  if (work.startsWith('vonzfranz')) return 'von Franz';
  if (work.startsWith('neumann')) return 'Neumann';
  if (work === 'burt-zodiac') return 'Burt';
  if (work === 'a-blue-fire') return 'Hillman';
  if (work === 'van-eenwyk') return 'Van Eenwyk';
  return null;
}

/** A verbatim quotation and its cite; the cite opens the passage at its source when the corpus holds the work. */
/** A quote taken up mid-sentence is shown as such: the words stay verbatim, the ellipsis marks where they begin. */
export const entered = (t: string) => (/^\p{Ll}/u.test(t) ? `…${t}` : t);

export function quoteBlock(q: LensQuote, passages: PassageBridge | undefined, opts: { compact?: boolean } = {}): HTMLElement {
  const c = q.cite;
  const label = `${c.workTitle}, ${c.locator}${c.print ? ` · p. ${c.print}` : ''}`;
  const voice = voiceOf(c.work);
  const cite = passages?.known(c.work)
    ? el('button', { type: 'button', class: 'link-quiet lq-cite', text: label, title: 'Open the passage in the corpus', onclick: () => passages.open(c.work, c.locator) })
    : el('span', { class: 'lq-cite', text: label });
  return el('blockquote', { class: `lq ${opts.compact ? 'lq-compact' : ''}` }, [el('p', { text: entered(q.text) }), el('footer', {}, [voice ? el('span', { class: 'lq-voice', text: voice }) : null, cite])]);
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

/**
 * Tune the globe to some occurrences (a family's instances, a dream's images): they stand, the rest recede, the palette
 * follows the first family. Unplaced occurrences keep their own standing, as the field's own focus does.
 */
export function tuneGlobe(ctx: { model: import('../data/model').Model; engine: import('../globe/engine').GlobeEngine }, idx: number[], familyId?: string) {
  const m = ctx.model;
  if (!idx.length) { ctx.engine.setEmphasis(null, null); return; }
  const rel = new Float32Array(m.occ.length).fill(0.07);
  for (const i of idx) rel[i] = 1.5;
  for (let i = 0; i < rel.length; i++) if (!m.located[i]) rel[i] = 1;
  const pal = familyId ? m.famPalette.get(familyId) : undefined;
  if (pal) ctx.engine.setPalette(pal, 1.4);
  ctx.engine.setEmphasis(rel, pal?.core ?? null);
}
