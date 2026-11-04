// The Quote component: the only module that draws a quotation. Nothing else creates a <blockquote>. A quotation is the words
// exactly as the page gives them, who speaks when it is not Jung, where it is from (work · locator · printed page), and the
// way to open that page. The component adds no quotation marks, no label and no verdict; prose that is not a quotation is
// not drawn here at all (it is plain body text). ProjectCentral/docs/QUOTE-MOCK.html is the accepted shape.
import { el } from './dom';
import type { PassageBridge } from './passage';

export type QuoteKind = 'quotation' | 'caption' | 'ql';

export interface QuoteCite {
  /** registry key, 'cw09ii'; aliases are folded by the registry, never here */
  work: string;
  /** as shown. Never a key */
  workTitle: string;
  /** as the data holds it: '¶426 (pdf p284)' · 'pdf p74' · 'fol. 5/6 (pdf p292-295)' */
  locator: string;
  /** the printed page, '268', drawn 'p. 268'. Where none is known the pdf page is drawn as 'pdf p284' */
  print?: string;
}

interface QuoteBase {
  /** verbatim. The component adds no quotation marks; a lower-case start gets a leading '…' */
  text: string;
  /** whose words, when the work does not say: 'pauli' | 'von-franz' … Jung wears no chip */
  voice?: string;
  /** lead = a definition (the large size); compact = narrow panels and cards; body leaves the size alone */
  emphasis?: 'lead' | 'body' | 'compact';
  /** a CSS colour for the bar (a card reading's tint) */
  tint?: string;
  /** false: the page is not offered even where the corpus holds it */
  passage?: false;
}

/** A quotation or a plate caption as printed: it always carries its cite (a string only where the data still holds it as one). */
export interface CitedQuote extends QuoteBase {
  kind?: 'quotation' | 'caption';
  cite: QuoteCite | string;
}

/** The QL framework's own words: the chip says QL and the source says where (W § I = epi-logos.org; S2 = the framework's notes). */
export interface QLQuote extends QuoteBase {
  kind: 'ql';
  source: string;
}

export type QuoteSpec = CitedQuote | QLQuote;

export interface QuoteOpts {
  /** when it knows the work, "open the page" is drawn, and calls passages.open(work, locator) */
  passages?: PassageBridge;
  /** 'locator' omits the work's title (a list names it once, in the group head) */
  cite?: 'full' | 'locator';
  /** 'compact' (a narrow surface) wins over the spec's own size; 'body' leaves it alone */
  emphasis?: 'body' | 'compact';
}

/** Whose words a work holds, when they are not Jung's. */
export function voiceOf(work: string): string | null {
  if (work.startsWith('vonzfranz')) return 'von Franz';
  if (work.startsWith('neumann')) return 'Neumann';
  if (work === 'burt-zodiac') return 'Burt';
  if (work === 'a-blue-fire') return 'Hillman';
  if (work === 'van-eenwyk') return 'Van Eenwyk';
  if (work === 'book-of-thoth') return 'Crowley';
  if (work === 'book-of-symbols') return 'Ronnberg';
  return null;
}

/** A curated `voice` (the correspondence's Pauli, a foreword's speaker) shown by its own name. */
const VOICE_LABEL: Record<string, string> = { pauli: 'Pauli', 'von-franz': 'von Franz', neumann: 'Neumann', vaneenwyk: 'Van Eenwyk', ronnberg: 'Ronnberg', burt: 'Burt' };

/** A quote taken up mid-sentence is shown as such: the words stay verbatim, the ellipsis marks where they begin. */
export const entered = (t: string) => (/^\p{Ll}/u.test(t) ? `…${t}` : t);

/** Where a QL formulation is quoted from: the published site by its section (W § I), or the earlier notes (S1–S4). */
export const qlSource = (src: string) => (src.startsWith('W ') ? `epi-logos.org · ${src.slice(2)}` : `the QL framework’s notes · ${src}`);

/** A registry title as it is drawn: its trailing CW code ("(CW9ii)") is the book's key, not its name. */
const titled = (t: string) => t.replace(/\s*\((?:cw|CW)[^)]*\)\s*$/, '').trim() || t;

/** The words a cite is drawn in, in order: work · locator · printed page. The pdf page stands only where no printed page is known. */
export function citeParts(c: QuoteCite, full = true): { cls: 'q-work' | 'q-loc' | 'q-pg'; text: string }[] {
  const para = /¶\s*\d+(?:\s*[–-]\s*\d+)?/.exec(c.locator)?.[0].replace(/\s+/g, '');
  const pdf = /pdf\s+pp?\.?\s*(\d[\d–,\- ]*)/i.exec(c.locator);
  const rest = c.locator
    .replace(/\(?\s*pdf\s+pp?\.?[^)]*\)?/i, '')
    .replace(/¶\s*\d+(?:\s*[–-]\s*\d+)?/, '')
    .replace(/^[;,\s]+|[;,\s]+$/g, '');
  // a locator that is itself a printed page ("p. 171 (pdf p172)") is the printed page, not a locator
  const printed = !c.print && !para ? /^pp?\.\s*(\d[\d–-]*)$/.exec(rest)?.[1] : undefined;
  const parts: { cls: 'q-work' | 'q-loc' | 'q-pg'; text: string }[] = [];
  if (full) parts.push({ cls: 'q-work', text: titled(c.workTitle) });
  if (para) parts.push({ cls: 'q-loc', text: para });
  else if (rest && !printed) parts.push({ cls: 'q-loc', text: rest });
  const print = c.print ?? printed;
  if (print) parts.push({ cls: 'q-pg', text: `p. ${print}` });
  else if (pdf) parts.push({ cls: 'q-pg', text: `pdf p${pdf[1].trim()}` });
  return parts;
}

function arrow(): SVGElement | null {
  if (typeof document.createElementNS !== 'function') return null;
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 12 12');
  s.setAttribute('width', '10');
  s.setAttribute('height', '10');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M3 9l6-6M4.5 3H9v4.5');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.append(p);
  return s;
}

/** One quotation: a blockquote (a figure for a plate caption), the words, and the foot that says who, where and how to open it. */
export function quote(spec: QuoteSpec, opts: QuoteOpts = {}): HTMLElement {
  const kind: QuoteKind = spec.kind ?? 'quotation';
  if (kind !== 'ql' && !(spec as CitedQuote).cite) throw new TypeError('a quotation carries its cite');
  // a narrow surface wins over the spec: a definition's 'lead' steps down by itself
  const size = opts.emphasis === 'compact' ? 'compact' : (spec.emphasis ?? opts.emphasis);
  const compact = size === 'compact';
  const lead = size === 'lead';
  const cls = ['q', kind === 'caption' ? 'q-caption' : '', kind === 'ql' ? 'q-ql' : '', lead ? 'q-lead' : '', compact ? 'q-compact' : ''].filter(Boolean).join(' ');
  const root = el(kind === 'caption' ? 'figure' : 'blockquote', { class: cls, 'data-kind': kind, style: spec.tint ? `--q-tint: ${spec.tint}` : undefined });
  root.append(el('p', { class: 'q-text', text: kind === 'quotation' ? entered(spec.text) : spec.text }));

  const foot: (HTMLElement | null)[] = [];
  const cite = kind === 'ql' ? undefined : (spec as CitedQuote).cite;
  const voice = kind === 'ql' ? 'QL' : spec.voice ? (VOICE_LABEL[spec.voice] ?? spec.voice) : cite && typeof cite !== 'string' ? voiceOf(cite.work) : null;
  if (voice) foot.push(el('span', { class: 'q-voice', text: voice }));
  if (kind === 'ql') foot.push(el('span', { class: 'q-cite', text: qlSource((spec as QLQuote).source) }));
  else if (typeof cite === 'string') foot.push(el('span', { class: 'q-cite', text: cite }));
  else if (cite) {
    foot.push(el('span', { class: 'q-cite', 'aria-label': `${titled(cite.workTitle)}, ${cite.locator}` }, citeParts(cite, opts.cite !== 'locator').map((p) => el('span', { class: p.cls, text: p.text }))));
    const passages = opts.passages;
    if (spec.passage !== false && passages?.known(cite.work)) {
      const open = el('button', { type: 'button', class: 'link-quiet q-open', title: `Open ${titled(cite.workTitle)} at ${cite.locator}`, onclick: () => passages.open(cite.work, cite.locator) }, ['open the page', arrow()]);
      foot.push(el('span', { class: 'q-acts' }, [open]));
    }
  }
  if (foot.length) root.append(el('footer', { class: 'q-foot' }, foot));
  return root;
}

export interface QuoteListOpts {
  /** 'Quotations' */
  title?: string;
  /** quotations shown per work before "Show all N"; default 3. One hidden quotation is never hidden. */
  collapseAfter?: number;
  /** the work filter inside the list; default 'chips' ('select' in a compact panel); absent when one work */
  filter?: 'chips' | 'select' | false;
  /** the short name on a chip (the registry's); default the cite's workTitle */
  workLabel?(work: string): string;
  emphasis?: 'body' | 'compact';
  passages?: PassageBridge;
  /** when the filter leaves nothing */
  emptyText?: string;
}

/** A quotation the list can group: it always has a structured cite. */
export type ListedQuote = CitedQuote & { cite: QuoteCite };

const pdfOf = (q: ListedQuote): number => Number(/pdf\s+pp?\.?\s*(\d+)/i.exec(q.cite.locator)?.[1] ?? 0);
const paraOf = (q: ListedQuote): number => Number(/¶\s*(\d+)/.exec(q.cite.locator)?.[1] ?? 0);

/**
 * The list form: grouped by work (in order of first appearance), each in page order, a count per work, collapsed beyond a
 * few, with a work filter inside. The filter and the "Show all" state live here, not in the caller.
 */
export function quoteList(items: ListedQuote[], opts: QuoteListOpts = {}): HTMLElement {
  const collapseAfter = opts.collapseAfter ?? 3;
  const title = opts.title ?? 'Quotations';
  const label = opts.workLabel ?? ((w: string) => groups.get(w)?.[0].cite.workTitle ?? w);
  const groups = new Map<string, ListedQuote[]>();
  for (const q of items) {
    const g = groups.get(q.cite.work);
    if (g) g.push(q); else groups.set(q.cite.work, [q]);
  }
  for (const g of groups.values()) g.sort((a, b) => pdfOf(a) - pdfOf(b) || paraOf(a) - paraOf(b));
  const state: { work: string | null; open: Set<string> } = { work: null, open: new Set() };

  const root = el('section', { class: 'qs', 'aria-label': title });
  const count = el('span', { class: 'qs-count' });
  root.append(el('div', { class: 'qs-head' }, [el('h3', { class: 'qs-title', text: title }), count]));
  const body = el('div', { class: 'qs-body' });

  const paint = () => {
    const shown = [...groups].filter(([w]) => !state.work || w === state.work);
    const n = shown.reduce((sum, [, g]) => sum + g.length, 0);
    count.textContent = `${n} from ${shown.length} ${shown.length === 1 ? 'work' : 'works'}`;
    body.replaceChildren();
    if (!shown.length) body.append(el('p', { class: 'lp-note qs-empty', text: opts.emptyText ?? 'No quotation from this work in this set.' }));
    for (const [w, g] of shown) {
      const open = state.open.has(w) || g.length <= collapseAfter + 1 || !!state.work;
      const grp = el('div', { class: 'qs-group', 'data-work': w }, [
        el('h4', { class: 'qs-work' }, [el('span', { text: g[0].cite.workTitle }), el('span', { class: 'qs-n', text: `${g.length} ${g.length === 1 ? 'quotation' : 'quotations'}` })]),
      ]);
      for (const q of open ? g : g.slice(0, collapseAfter)) grp.append(quote(q, { cite: 'locator', emphasis: opts.emphasis, passages: opts.passages }));
      if (!open) grp.append(el('p', { class: 'qs-more' }, [el('button', { type: 'button', class: 'link-quiet', text: `Show all ${g.length}`, onclick: () => { state.open.add(w); paint(); } })]));
      else if (g.length > collapseAfter + 1 && !state.work) grp.append(el('p', { class: 'qs-more' }, [el('button', { type: 'button', class: 'link-quiet', text: 'Show fewer', onclick: () => { state.open.delete(w); paint(); } })]));
      body.append(grp);
    }
  };

  if (groups.size >= 2 && opts.filter !== false) {
    if ((opts.filter ?? (opts.emphasis === 'compact' ? 'select' : 'chips')) === 'select') {
      const sel = el('select', { class: 'qs-select', 'aria-label': 'Show quotations from' }, [
        el('option', { value: '', text: `All works (${items.length})` }),
        ...[...groups].map(([w, g]) => el('option', { value: w, text: `${label(w)} (${g.length})` })),
      ]);
      sel.addEventListener('change', () => { state.work = (sel as HTMLSelectElement).value || null; paint(); });
      root.append(sel);
    } else {
      const bar = el('div', { class: 'qs-filter', role: 'group', 'aria-label': 'Show quotations from' });
      const chips: HTMLElement[] = [];
      const chip = (w: string, text: string, n: number) => {
        const b = el('button', { type: 'button', class: 'sf-pill', 'aria-pressed': String((state.work ?? '') === w) }, [text, el('span', { class: 'qs-n', text: String(n) })]);
        b.addEventListener('click', () => { state.work = w || null; chips.forEach((c) => c.setAttribute('aria-pressed', String(c === b))); paint(); });
        chips.push(b);
        return b;
      };
      bar.append(chip('', 'All', items.length), ...[...groups].map(([w, g]) => chip(w, label(w), g.length)));
      root.append(bar);
    }
  }
  root.append(body);
  paint();
  return root;
}
