// THEORY: the psychodynamics the rest of the field runs on (MODES-RFC §3) — the Self as centre, energy, compensation,
// enantiodromia, the transcendent function, and number. Every claim is a verbatim quotation placed by the corpus
// (public/data/theory.json, built by scripts/theory.mjs). The globe tunes to what a section names; the dynamical lens is
// this lens's picture of a subject in motion.
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { averagePalettes } from '../data/palette';
import { subjectName, subjectOccurrences, subjectPalette, type Subject } from '../data/model';
import { BUILT, type LensContext, type LensInstance } from '../shell/lens';
import type { PanelLensId } from '../state/store';
import { inLens } from '../state/store';
import { loadLensData, quoteBlock, type LensQuote } from './ui';

interface TheoryLink { type: 'family' | 'archetype' | 'lens'; id: string }
interface TheorySection { id: string; name: string; line: string; quotes: LensQuote[]; links: TheoryLink[] }
interface QL { text: string; source: string; name?: string; also?: { text: string; source: string } }
interface NumberRow { n: number; position: string; ql: QL; quotes: LensQuote[] }
interface NumberData {
  line: string;
  matheme: QL;
  jung: LensQuote[];
  series: LensQuote;
  numbers: NumberRow[];
  psychoid: { line: string; quotes: LensQuote[]; ql: QL };
  time: { line: string; quotes: LensQuote[]; quaternio: { intro: LensQuote; terms: string[] }; vaneenwyk: string };
}
interface TheoryData { version: 1; sections: TheorySection[]; number?: NumberData }

const NUMBER: TheorySection = { id: 'number', name: 'Number', line: '', quotes: [], links: [] };

/** A QL formulation: the framework's own words, always marked as QL (docs/ql-reference.md names its sources). */
function qlBlock(q: QL): HTMLElement {
  return el('blockquote', { class: 'lq lq-ql' }, [
    el('p', { text: q.text }),
    el('footer', {}, [el('span', { class: 'lq-voice ql', text: 'QL' }), el('span', { class: 'lq-cite', text: `the QL framework (Epi-Logos), ${q.source}` })]),
  ]);
}

/** The six positions on a circle, numbers 1–6 at #0–#5, with #5 turning back into #0. */
function qlWheel(rows: NumberRow[]): HTMLElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 240 200');
  svg.setAttribute('class', 'ql-wheel');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Numbers one to six at QL positions #0 to #5, with #5 returning to #0');
  const add = (tag: string, a: Record<string, string | number>, text?: string) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v)); if (text) n.textContent = text; svg.append(n); return n; };
  const cx = 120, cy = 100, R = 70;
  add('circle', { cx, cy, r: R, class: 'ql-ring' });
  rows.forEach((r, i) => {
    const a = (-90 + i * 60) * (Math.PI / 180);
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    add('circle', { cx: x, cy: y, r: 15, class: `ql-node${i === 0 || i === 5 ? ' implicate' : ''}` });
    add('text', { x, y: y + 5, class: 'ql-n', 'text-anchor': 'middle' }, String(r.n));
    add('text', { x: cx + (R + 28) * Math.cos(a), y: cy + (R + 28) * Math.sin(a) + 4, class: 'ql-pos', 'text-anchor': 'middle' }, r.position);
  });
  add('text', { x: cx, y: cy + 4, class: 'ql-centre', 'text-anchor': 'middle' }, '6 ≡ 0');
  const fig = el('figure', { class: 'as-figure' });
  fig.append(svg);
  return fig;
}

const LENS_LINK: Record<string, { text: string; state: () => import('../state/store').AppState }> = {
  aion: { text: 'Enantiodromia across the ages: Aion', state: () => ({ view: { kind: 'world' }, deep: false, history: { reading: 'jung-aion' } }) },
  dynamics: { text: 'Watch a symbol move as a dynamical system', state: () => ({ view: { kind: 'world' }, deep: false, dynamics: {} }) },
  dreams: { text: 'Bring your own dreams', state: () => inLens('dreams') },
};

export function mount(ctx: LensContext): LensInstance {
  let data: TheoryData | null = null;
  let current = '';
  let failed = false;

  const tune = (s: TheorySection) => {
    const target = s.links.find((l) => l.type !== 'lens') as Subject | undefined;
    if (!target) { ctx.engine.setEmphasis(null, null); return; }
    const idx = subjectOccurrences(ctx.model, target);
    const pal = subjectPalette(ctx.model, target, averagePalettes);
    const rel = new Float32Array(ctx.model.occ.length).fill(0.07);
    for (const i of idx) rel[i] = 1.5;
    for (let i = 0; i < rel.length; i++) if (!ctx.model.located[i]) rel[i] = 1;
    if (pal) ctx.engine.setPalette(pal, 1.4);
    ctx.engine.setEmphasis(rel, pal?.core ?? null);
  };

  const renderNumber = (sections: TheorySection[]) => {
    const d = data!.number!;
    ctx.setContext('Number');
    ctx.engine.setEmphasis(null, null);
    const nav = el('nav', { class: 'th-nav', 'aria-label': 'Theory sections' }, sections.map((x) =>
      el('button', { type: 'button', class: 'th-tab', 'aria-current': x.id === 'number' ? 'true' : undefined, text: x.name, onclick: () => ctx.setPath(x.id === sections[0].id ? [] : [x.id]) })));
    const row = (r: NumberRow) => el('section', { class: 'ql-row' }, [
      el('div', { class: 'ql-head' }, [el('span', { class: 'ql-big', text: String(r.n) }), el('span', { class: 'ql-arrow', text: '↔' }), el('span', { class: 'ql-big pos', text: r.position }), el('span', { class: 'ql-name', text: r.ql.name ?? '' })]),
      ...r.quotes.map((q) => quoteBlock(q, ctx.passages, { compact: true })),
      r.quotes.length < 2 ? el('p', { class: 'lp-note', text: `Number and Time says less about ${['', 'one', 'two', 'three', 'four', 'five', 'six'][r.n]} than about the first four numbers.` }) : null,
      qlBlock(r.ql),
      r.ql.also ? qlBlock(r.ql.also) : null,
    ].filter((n): n is HTMLElement => !!n));
    const q = (x: { terms: string[] }) => el('div', { class: 'ql-quaternio', role: 'img', 'aria-label': `The quaternio: ${x.terms.join('; ')}` }, x.terms.map((t, i) => el('span', { class: `ql-q q${i}`, text: t })));
    const body: (HTMLElement | null)[] = [
      nav,
      el('p', { class: 'th-line', text: d.line }),
      ...d.jung.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      el('h3', { class: 'as-h3', text: 'One to six, beside #0 to #5' }),
      qlWheel(d.numbers),
      qlBlock(d.matheme),
      quoteBlock(d.series, ctx.passages, { compact: true }),
      ...d.numbers.map(row),
      el('h3', { class: 'as-h3', text: 'The psychoid' }),
      el('p', { class: 'th-line', text: d.psychoid.line }),
      ...d.psychoid.quotes.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      qlBlock(d.psychoid.ql),
      el('h3', { class: 'as-h3', text: 'Time' }),
      el('p', { class: 'th-line', text: d.time.line }),
      ...d.time.quotes.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      quoteBlock(d.time.quaternio.intro, ctx.passages, { compact: true }),
      q(d.time.quaternio),
      el('p', { class: 'lp-note', text: d.time.vaneenwyk }),
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.navigate({ view: { kind: 'world' }, deep: false, dynamics: {} }) }, [el('span', { text: 'The dynamical lens' }), icon('next', 14)]),
    ];
    const nodes = body.filter((n): n is HTMLElement => !!n);
    if (ctx.panel.isOpen) ctx.panel.replace(nodes); else ctx.panel.open('Theory', nodes, { wide: true });
    current = 'number';
  };

  const render = (id: string) => {
    if (!data) return;
    const sections = data.number ? [...data.sections, NUMBER] : data.sections;
    if (id === 'number' && data.number) { renderNumber(sections); return; }
    const i = Math.max(0, sections.findIndex((s) => s.id === id));
    const s = sections[i];
    current = s.id;
    ctx.setContext(s.name);
    const nav = el('nav', { class: 'th-nav', 'aria-label': 'Theory sections' }, sections.map((x) =>
      el('button', { type: 'button', class: 'th-tab', 'aria-current': x.id === s.id ? 'true' : undefined, text: x.name, onclick: () => ctx.setPath(x.id === sections[0].id ? [] : [x.id]) })));
    const links = el('div', { class: 'th-links' });
    for (const l of s.links) {
      if (l.type === 'lens') {
        const def = LENS_LINK[l.id];
        if (!def || (l.id !== 'aion' && l.id !== 'dynamics' && !BUILT.has(l.id as PanelLensId))) continue;
        links.append(el('button', { type: 'button', class: 'th-link', onclick: () => ctx.navigate(def.state()) }, [el('span', { text: def.text }), icon('next', 14)]));
      } else {
        const subject = l as Subject;
        links.append(el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus(subject) }, [el('span', { text: `${subjectName(ctx.model, subject)} on the globe` }), icon('next', 14)]));
      }
    }
    const step = (d: number) => {
      const n = sections[(i + d + sections.length) % sections.length];
      ctx.setPath(n.id === sections[0].id ? [] : [n.id]);
    };
    const body = [
      nav,
      el('p', { class: 'th-line', text: s.line }),
      ...s.quotes.map((q) => quoteBlock(q, ctx.passages)),
      links.childElementCount ? links : null,
      el('div', { class: 'th-step' }, [
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous section', onclick: () => step(-1) }, [icon('back')]),
        el('span', { class: 'th-count', text: `${i + 1} of ${sections.length}` }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next section', onclick: () => step(1) }, [icon('next')]),
      ]),
    ].filter((n): n is HTMLElement => !!n);
    if (ctx.panel.isOpen) ctx.panel.replace(body); else ctx.panel.open('Theory', body);
    tune(s);
  };

  return {
    enter(path) {
      const want = path[0] ?? '';
      if (data) { if (want !== current || !ctx.panel.isOpen) render(want); return; }
      if (failed) return;
      ctx.panel.open('Theory', [el('p', { class: 'lp-sub', text: 'Loading…' })]);
      loadLensData<TheoryData>('theory').then((d) => { data = d; render(want); }).catch((err) => {
        failed = true;
        console.error(err);
        ctx.panel.replace([el('p', { class: 'lp-error', text: 'The theory data is not available in this build.' })]);
      });
    },
    leave() {
      current = '';
      ctx.engine.setEmphasis(null, null);
    },
  };
}

