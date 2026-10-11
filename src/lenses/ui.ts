// Shared pieces for the panel lenses: a quotation with its cite (provenance lives in the quote, MODES-RFC laws),
// the privacy line every personal tool carries, and a small loader for the lens data files.
import { scopeOf } from '../data/scope';
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import type { PassageBridge } from '../ui/passage';
import type { Palette } from '../types/field';
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
  /** the words are as a damaged scan reads them (kept verbatim, marked, never repaired by hand) */
  scan?: true;
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

/** A curated `voice` (the correspondence's Pauli, a foreword's speaker) shown by its own name. */
const VOICE_LABEL: Record<string, string> = { pauli: 'Pauli', 'von-franz': 'von Franz', neumann: 'Neumann', vaneenwyk: 'Van Eenwyk' };

/** A verbatim quotation and its cite; the cite opens the passage at its source when the corpus holds the work. */
/** A quote taken up mid-sentence is shown as such: the words stay verbatim, the ellipsis marks where they begin. */
export const entered = (t: string) => (/^\p{Ll}/u.test(t) ? `…${t}` : t);

export function quoteBlock(q: LensQuote, passages: PassageBridge | undefined, opts: { compact?: boolean } = {}): HTMLElement {
  const c = q.cite;
  const label = `${c.workTitle}, ${c.locator}${c.print ? ` · p. ${c.print}` : ''}`;
  const voice = q.voice ? (VOICE_LABEL[q.voice] ?? q.voice) : voiceOf(c.work);
  const cite = passages?.known(c.work)
    ? el('button', { type: 'button', class: 'link-quiet lq-cite', text: label, title: 'Open the passage in the corpus', onclick: () => passages.open(c.work, c.locator) })
    : el('span', { class: 'lq-cite', text: label });
  return el('blockquote', { class: `lq ${opts.compact ? 'lq-compact' : ''}` }, [
    el('p', { text: entered(q.text) }),
    // a quotation kept as a damaged scan reads it says so — the words are not repaired, they are marked
    q.scan ? el('span', { class: 'dp-scan', text: 'Damaged scan: the words are as the scan reads them' }) : null,
    el('footer', {}, [voice ? el('span', { class: 'lq-voice', text: voice }) : null, cite]),
  ]);
}

/** The line every personal tool shows, plainly: where the data lives and what never happens to it. */
export function privacyLine(extra = ''): HTMLElement {
  return el('p', { class: 'lp-privacy' }, [icon('lock', 13), el('span', { text: `Stays in this browser. Nothing is sent anywhere.${extra ? ` ${extra}` : ''}` })]);
}

/** A QL formulation: the framework's own words, always marked as QL (ProjectCentral/docs/ql-reference.md names its sources). */
export interface QL { text: string; source: string; name?: string }

/** Where a QL formulation is quoted from: the published site by its section (W § I), or the earlier notes (S1–S4). */
export const qlSource = (src: string) => (src.startsWith('W ') ? `epi-logos.org, ${src.slice(2)}` : `the QL framework's notes, ${src}`);

export function qlBlock(q: QL): HTMLElement {
  return el('blockquote', { class: 'lq lq-ql' }, [
    el('p', { text: q.text }),
    el('footer', {}, [el('span', { class: 'lq-voice ql', text: 'QL' }), el('span', { class: 'lq-cite', text: qlSource(q.source) })]),
  ]);
}

/**
 * The still frame of a figure of src/dynamics/figures.ts — the same drawing the dynamical lens paints, frozen at its
 * representative moment and repainted when its box changes. Reused, never rebuilt: the number pages carry Jung's own
 * drawing (the square folded into the torus, `construction`) beside the sentence that describes that motion. The
 * figure module is imported on demand, so nothing of the dynamics set is added to the main bundle.
 */
export async function stillFigure(id: 'construction' | 'torus', palette: Palette): Promise<HTMLElement> {
  const canvas = el('canvas', { class: 'as-figure-canvas', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const fig = el('figure', { class: 'as-figure' }, [canvas]);
  const mod = await import('../dynamics/figures');
  // `construction` is its own export, not a FIGURES entry — read it by name, never through figureOf's fallback
  const figure = id === 'torus' ? mod.FIGURES.torus : mod.construction;
  const p = mod.paletteOf(palette);
  const paint = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(Math.min(220, r.width * 0.62) * dpr);
    canvas.style.height = `${Math.min(220, r.width * 0.62)}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) figure.draw(ctx, canvas.width, canvas.height, figure.still, p, dpr);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(paint).observe(fig);
  requestAnimationFrame(paint);
  return fig;
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
export function tuneGlobe(ctx: { model: import('../data/model').Model; engine: import('../globe/engine').GlobeEngine }, idx: number[], familyId?: string, label = 'this reading') {
  const m = ctx.model;
  if (!idx.length) { ctx.engine.setEmphasis(null, null); return; }
  // the lens's own set: its presences stand, their nearby ones dim, the rest of the field is set aside (and named)
  const sc = scopeOf(m, idx, label);
  const pal = familyId ? m.famPalette.get(familyId) : undefined;
  if (pal) ctx.engine.setPalette(pal, 1.4);
  ctx.engine.setEmphasis(sc.rel, pal?.core ?? null, sc.info);
}
