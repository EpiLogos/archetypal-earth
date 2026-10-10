// COINCIDENCES (Thread 4): a private log of meaningful coincidences, drawn as your own series. Each entry is what Jung's
// definition has two factors for: an inner event (a dream, a thought, a premonition) and an outer one that met it, and
// the image that connects them. The chart sets them in time, one row per image: a row with more than one mark is a series.
// Jung's framing stands beside it, including his caution that most runs are chance (cw08, on Kammerer).
// Everything stays in this browser. Routes: #/coincidences, #/coincidences/new, #/coincidences/<id>[/edit].
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import type { LensContext, LensInstance } from '../shell/lens';
import { practice, saveFile, type PracticeRecord } from '../practice/store';
import { findImages, vocabulary, type Vocabulary } from '../practice/amplify';
import { inLens } from '../state/store';
import { loadLensData, privacyLine, quoteBlock, type LensQuote } from './ui';

export interface Coincidence extends PracticeRecord {
  date: string;
  /** the inner event: a dream, a thought, a feeling, a premonition */
  inner: string;
  /** the outer event that met it */
  outer: string;
  /** the image that connects them, in the person's own words */
  symbol: string;
  /** the field family the person tied it to, if any */
  familyId: string | null;
  note: string;
}

interface PracticeData { coincidences: { definition: LensQuote; factors: LensQuote[]; series: LensQuote[] } }

const today = () => new Date().toISOString().slice(0, 10);
const NS = 'http://www.w3.org/2000/svg';

export function mount(ctx: LensContext): LensInstance {
  const m = ctx.model;
  let vocab: Vocabulary | null = null;
  let framing: PracticeData | null = null;
  const voc = () => (vocab ??= vocabulary(m));
  const ready = loadLensData<PracticeData>('practice').then((d) => { framing = d; }).catch(() => { framing = null; });
  const show = (nodes: (HTMLElement | SVGElement | null)[]) => {
    const list = nodes.filter((n): n is HTMLElement => !!n);
    if (ctx.panel.isOpen) ctx.panel.replace(list); else ctx.panel.open('Coincidences', list, { height: 'full' });
  };
  const entries = () => practice.list<Coincidence>('coincidences').sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const symbolKey = (c: Coincidence) => (c.familyId ? `f:${c.familyId}` : `t:${c.symbol.trim().toLowerCase()}`);
  const symbolName = (c: Coincidence) => (c.familyId ? m.famById.get(c.familyId)?.name ?? c.symbol : c.symbol.trim()) || 'no image named';

  /** Your series: time across, one row per connecting image; a row with more than one mark is a series. */
  const seriesChart = (list: Coincidence[]): HTMLElement => {
    const rows = [...new Map(list.map((c) => [symbolKey(c), symbolName(c)])).entries()]
      .map(([k, name]) => ({ k, name, items: list.filter((c) => symbolKey(c) === k) }))
      .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
    const t = (c: Coincidence) => Date.parse(c.date);
    const t0 = Math.min(...list.map(t)), t1 = Math.max(...list.map(t));
    const span = Math.max(t1 - t0, 86_400_000 * 30);
    const W = 360, rowH = 30, left = 112, right = 14, top = 10;
    const H = top + rows.length * rowH + 26;
    const x = (c: Coincidence) => left + ((t(c) - t0) / span) * (W - left - right);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'co-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Your coincidences over time, one row per connecting image. ${rows.filter((r) => r.items.length > 1).length} images recur.`);
    const add = (tag: string, a: Record<string, string | number>, text?: string) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
      if (text) n.textContent = text;
      svg.append(n);
      return n;
    };
    rows.forEach((r, i) => {
      const y = top + i * rowH + rowH / 2;
      add('text', { x: left - 10, y: y + 4, class: `co-row${r.items.length > 1 ? ' series' : ''}`, 'text-anchor': 'end' }, r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name);
      add('line', { x1: left, x2: W - right, y1: y, y2: y, class: 'co-rule' });
      if (r.items.length > 1) add('line', { x1: x(r.items[0]), x2: x(r.items[r.items.length - 1]), y1: y, y2: y, class: 'co-run' });
      for (const c of r.items) {
        const dot = add('circle', { cx: x(c), cy: y, r: 6, class: 'co-dot', tabindex: 0 });
        dot.addEventListener('click', () => ctx.setPath([c.id]));
        dot.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') ctx.setPath([c.id]); });
        add('title', {}, `${c.date}: ${c.inner.slice(0, 40)} / ${c.outer.slice(0, 40)}`);
        dot.append(svg.lastChild!);
      }
    });
    const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 7);
    add('text', { x: left, y: H - 6, class: 'co-axis' }, fmt(t0));
    add('text', { x: W - right, y: H - 6, class: 'co-axis', 'text-anchor': 'end' }, fmt(t0 + span));
    const fig = el('figure', { class: 'co-figure' });
    fig.append(svg);
    return fig;
  };

  const home = () => {
    ctx.setContext('');
    ctx.engine.setEmphasis(null, null);
    const list = entries();
    const recurring = new Set(list.map(symbolKey).filter((k, i, a) => a.indexOf(k) !== i));
    show([
      privacyLine(practice.persistent ? 'Your log is kept only in this browser’s storage.' : 'This browser is not letting the page store anything, so entries last only until you close the tab.'),
      el('p', { class: 'th-line', text: 'Keep a note when something inside you and something outside meet in a way that feels meant: a dream, then the thing it showed. Over time the log draws your own series.' }),
      framing ? quoteBlock(framing.coincidences.definition, ctx.passages, { compact: true }) : null,
      el('div', { class: 'lp-row' }, [el('button', { type: 'button', class: 'lp-btn primary', onclick: () => ctx.setPath(['new']) }, [icon('plus', 14), el('span', { text: 'Log a coincidence' })])]),
      list.length ? el('h3', { class: 'as-h3', text: 'Your series' }) : null,
      list.length ? seriesChart(list) : el('p', { class: 'lp-note', text: 'Nothing logged yet. The chart appears with the first entry.' }),
      list.length ? el('p', { class: 'lp-note', text: recurring.size ? `${recurring.size === 1 ? 'One image recurs' : `${recurring.size} images recur`}. A row with more than one mark is a series: the same image turning up again.` : 'No image has come back yet. When one does, its row will hold more than one mark.' }) : null,
      list.length ? el('ol', { class: 'dr-list' }, [...list].reverse().map((c) => el('li', {}, [el('button', { type: 'button', class: 'dr-row', onclick: () => ctx.setPath([c.id]) }, [
        el('span', { class: 'am-year', text: c.date }),
        el('span', { class: 'dr-title', text: `${c.inner.slice(0, 40)} · ${c.outer.slice(0, 40)}` }),
        el('span', { class: 'dr-n', text: symbolName(c) }),
      ])]))) : null,
      framing ? el('details', { class: 'as-more' }, [
        el('summary', { text: 'Jung on what counts, and on runs of chance' }),
        ...framing.coincidences.factors.map((q) => quoteBlock(q, ctx.passages, { compact: true })),
        ...framing.coincidences.series.map((q) => quoteBlock(q, ctx.passages, { compact: true })),
        el('p', { class: 'lp-note', text: 'He argued with Kammerer’s “law of series”: a run of the same number is, in his reading, only probability. What he called synchronicity is a coincidence that carries meaning for the person it happens to.' }),
      ]) : null,
      list.length ? el('div', { class: 'lp-row as-own' }, [
        el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => saveFile('my-coincidences.json', practice.exportAll()) }, [icon('export', 14), el('span', { text: 'Save a copy' })]),
        el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => { if (confirm('Delete every logged coincidence from this browser?')) { practice.wipe('coincidences'); home(); } } }, [icon('trash', 14), el('span', { text: 'Delete all' })]),
      ]) : null,
    ]);
  };

  const editor = (c?: Coincidence) => {
    ctx.setContext(c ? 'Change the entry' : 'A coincidence');
    const date = el('input', { type: 'date', value: c?.date ?? today(), max: today() });
    const inner = el('textarea', { rows: 3, placeholder: 'What was inside: a dream, a thought, a feeling, a premonition' });
    inner.value = c?.inner ?? '';
    const outer = el('textarea', { rows: 3, placeholder: 'What happened outside that met it' });
    outer.value = c?.outer ?? '';
    const symbol = el('input', { type: 'text', value: c?.symbol ?? '', placeholder: 'The image that connects them: a scarab, a bird, a number…', maxlength: 60 });
    const note = el('textarea', { rows: 2, placeholder: 'Anything else (optional)' });
    note.value = c?.note ?? '';
    let familyId: string | null = c?.familyId ?? null;
    const suggest = el('div', { class: 'am-chips co-suggest' });
    const runSuggest = () => {
      const hits = findImages(m, voc(), symbol.value, 5).filter((t) => t.type === 'family');
      suggest.replaceChildren(...hits.map((t) => el('button', { type: 'button', class: 'sf-pill', 'aria-pressed': String(familyId === t.id), text: m.famById.get(t.id)!.name, onclick: () => { familyId = familyId === t.id ? null : t.id; runSuggest(); } })));
      if (hits.length) suggest.prepend(el('span', { class: 'lp-note', text: 'Tie it to an image in the field (optional):' }));
    };
    symbol.addEventListener('input', () => { familyId = null; runSuggest(); });
    runSuggest();
    const save = (e: Event) => {
      e.preventDefault();
      if (!inner.value.trim() || !outer.value.trim()) { (inner.value.trim() ? outer : inner).focus(); return; }
      const stored = practice.put<Coincidence>('coincidences', { ...(c ?? {}), date: date.value || today(), inner: inner.value.trim(), outer: outer.value.trim(), symbol: symbol.value.trim(), familyId, note: note.value.trim() });
      ctx.setPath([stored.id]);
    };
    show([
      el('button', { type: 'button', class: 'link-quiet am-back', onclick: () => ctx.setPath(c ? [c.id] : []) }, [icon('back', 13), el('span', { text: c ? 'The entry' : 'Your log' })]),
      el('form', { class: 'dr-form', onsubmit: save }, [
        el('label', { class: 'lp-field' }, [el('span', { text: 'Date' }), date]),
        el('label', { class: 'lp-field' }, [el('span', { text: 'Inside' }), inner]),
        el('label', { class: 'lp-field' }, [el('span', { text: 'Outside' }), outer]),
        el('label', { class: 'lp-field' }, [el('span', { text: 'The connecting image' }), symbol]),
        suggest,
        el('label', { class: 'lp-field' }, [el('span', { text: 'Note' }), note]),
        el('div', { class: 'lp-row' }, [el('button', { type: 'submit', class: 'lp-btn primary' }, [icon('coincidences', 14), el('span', { text: c ? 'Save' : 'Log it' })])]),
      ]),
      privacyLine(),
    ]);
  };

  const entry = (c: Coincidence) => {
    ctx.setContext(symbolName(c));
    const same = entries().filter((x) => x.id !== c.id && symbolKey(x) === symbolKey(c));
    if (c.familyId) {
      const idx = (m.famOcc.get(c.familyId) ?? []);
      const rel = new Float32Array(m.occ.length).fill(0.07);
      for (const i of idx) rel[i] = 1.5;
      ctx.engine.setEmphasis(rel, m.famPalette.get(c.familyId)?.core ?? null);
    } else ctx.engine.setEmphasis(null, null);
    show([
      el('button', { type: 'button', class: 'link-quiet am-back', onclick: () => ctx.setPath([]) }, [icon('back', 13), el('span', { text: 'Your log' })]),
      el('p', { class: 'am-kicker', text: c.date }),
      el('h2', { class: 'lp-h', text: symbolName(c) }),
      el('h3', { class: 'as-h3', text: 'Inside' }), el('p', { class: 'th-line', text: c.inner }),
      el('h3', { class: 'as-h3', text: 'Outside' }), el('p', { class: 'th-line', text: c.outer }),
      c.note ? el('p', { class: 'lp-note', text: c.note }) : null,
      same.length ? el('p', { class: 'as-shared', text: `This image has come up ${same.length} other time${same.length === 1 ? '' : 's'} in your log.` }) : null,
      c.familyId ? el('button', { type: 'button', class: 'th-link', onclick: () => ctx.navigate(inLens('symbols', [c.familyId!])) }, [el('span', { text: `${m.famById.get(c.familyId)?.name} in the field: its history and its dreams` }), icon('next', 14)]) : null,
      el('div', { class: 'lp-row as-own' }, [
        el('button', { type: 'button', class: 'lp-btn quiet', text: 'Change', onclick: () => ctx.setPath([c.id, 'edit']) }),
        el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => { if (confirm('Delete this entry from this browser?')) { practice.remove('coincidences', c.id); ctx.setPath([]); } } }, [icon('trash', 14), el('span', { text: 'Delete' })]),
      ]),
    ]);
  };

  const route = (path: string[]) => {
    if (!path[0]) return home();
    if (path[0] === 'new') return editor();
    const c = practice.get<Coincidence>('coincidences', path[0]);
    if (!c) return ctx.setPath([], { replace: true });
    if (path[1] === 'edit') return editor(c);
    entry(c);
  };

  return {
    enter(path) { void ready.then(() => route(path)); },
    leave() { ctx.engine.setEmphasis(null, null); },
  };
}
