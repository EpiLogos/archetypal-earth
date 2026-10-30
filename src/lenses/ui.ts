// Shared pieces for the panel lenses: a quotation with its cite (provenance lives in the quote, MODES-RFC laws),
// the privacy line every personal tool carries, and a small loader for the lens data files.
import { scopeOf } from '../data/scope';
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import type { PassageBridge } from '../ui/passage';
import { quote, type CitedQuote, type QuoteCite } from '../ui/quote';
import type { Model } from '../data/model';
import type { Palette } from '../types/field';
import { resolveSrc } from '../data/load';

// A quotation is drawn by the one Quote component (src/ui/quote.ts); these are the lens data's shapes and the doors to it.
// (the data lane's tests read the voice table through here)
export { voiceOf } from '../ui/quote';

export type LensCite = QuoteCite;

export interface LensQuote {
  text: string;
  cite: LensCite;
  /** whose words, when not Jung's: 'neumann' | 'von-franz' | 'burt' … (the cite says so too) */
  voice?: string;
  /** a plate caption as printed: an object label, shown as one and never in quotation marks */
  caption?: true;
}

/** A lens quotation as the component takes it. */
const specOf = (q: LensQuote): CitedQuote => ({ text: q.text, cite: q.cite, ...(q.voice ? { voice: q.voice } : {}), ...(q.caption ? { kind: 'caption' as const } : {}) });

/** A verbatim quotation and its cite; "open the page" opens the passage at its source when the corpus holds the work. */
export function quoteBlock(q: LensQuote, passages: PassageBridge | undefined, opts: { compact?: boolean } = {}): HTMLElement {
  return quote(specOf(q), { passages, emphasis: opts.compact ? 'compact' : undefined });
}

/** A plate caption as printed, with its cite: the words stand as the plate gives them, unquoted. */
export function captionBlock(q: LensQuote, passages: PassageBridge | undefined, opts: { compact?: boolean } = {}): HTMLElement {
  return quote({ ...specOf(q), kind: 'caption' }, { passages, emphasis: opts.compact ? 'compact' : undefined });
}

/** The registry id a "(CW9ii)" code names: CW9ii -> cw09ii, CW5 -> cw05. */
const codeId = (code: string): string | undefined => {
  const m = /^CW\s*(\d+)([a-z]*)$/i.exec(code.trim());
  return m ? `cw${m[1].padStart(2, '0')}${m[2].toLowerCase()}` : undefined;
};
const squash = (t: string) => t.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * A cite the data still holds as a string ("Aion (CW9ii) ¶426 (pdf p284)", "Children's Dreams pdf p436") as a structured cite:
 * the Work by its CW code, its key or its title (a unique prefix of one Work's), the locator as written after it. A string
 * that names no Work, or no locator, stays a string and is drawn as text.
 */
export function citeOfString(m: Model, s: string): QuoteCite | string {
  const at = /¶\s*\d|\(?\s*pdf\s+pp?\.?\s*\d|\bfol\.|\bp\.\s*\d/i.exec(s);
  if (!at) return s;
  let title = s.slice(0, at.index).trim();
  const locator = s.slice(at.index).trim();
  // a work key that leads the title ("cw09i The Archetypes …") is the key, not part of the name
  const lead = /^(\S+)\s+(.*)$/.exec(title);
  if (lead && m.workKey.has(lead[1]) && lead[2]) title = lead[2];
  if (!title) return s;
  let id = m.workKey.get(title) ?? m.workKey.get(title.toLowerCase());
  const code = /\((CW\s*\d+[a-z]*)\)/i.exec(title)?.[1];
  const byCode = code ? codeId(code) : undefined;
  if (!id && byCode && m.workById.has(byCode)) id = byCode;
  if (!id) {
    const want = squash(title);
    const hits = want.length >= 4 ? [...m.workById.values()].filter((w) => squash(w.title).startsWith(want)) : [];
    if (hits.length === 1) id = hits[0].id;
  }
  if (!id) return s;
  // a title that is only a key reads as the Work's own name
  const shown = m.workKey.has(title) || m.workKey.has(title.toLowerCase()) ? (m.workById.get(id)?.title ?? title) : title;
  return { work: id, workTitle: shown, locator };
}

/** A definition (a composite of verbatim fragments, cited) as the lead-size quotation it is. */
export function definitionQuote(m: Model, d: { text: string; cite: string }): CitedQuote {
  return { text: d.text, cite: citeOfString(m, d.cite), emphasis: 'lead' };
}

/** An occurrence's own quotation (or plate caption) with the first cite the vault gives it; null when it carries none. */
export function occurrenceQuote(o: { quote?: string; caption?: boolean; jung: { work: string; workTitle: string; locator: string; voice?: string }[] }): CitedQuote | null {
  const c = o.jung[0];
  if (!o.quote || !c) return null;
  return { text: o.quote, cite: { work: c.work, workTitle: c.workTitle, locator: c.locator }, ...(c.voice ? { voice: c.voice } : {}), ...(o.caption ? { kind: 'caption' as const } : {}) };
}

/** The line every personal tool shows, plainly: where the data lives and what never happens to it. */
export function privacyLine(extra = ''): HTMLElement {
  return el('p', { class: 'lp-privacy' }, [icon('lock', 13), el('span', { text: `Stays in this browser. Nothing is sent anywhere.${extra ? ` ${extra}` : ''}` })]);
}

/** A QL formulation: the framework's own words, always marked as QL (ProjectCentral/docs/ql-reference.md names its sources). */
export interface QL { text: string; source: string; name?: string }

export function qlBlock(q: QL): HTMLElement {
  return quote({ kind: 'ql', text: q.text, source: q.source });
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
