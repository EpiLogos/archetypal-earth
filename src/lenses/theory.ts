// THEORY: the psychodynamics the rest of the field runs on (MODES-RFC §3) — the Self as centre, energy, compensation,
// enantiodromia, the transcendent function, and number. Every claim is a verbatim quotation placed by the corpus
// (public/data/theory.json, built by scripts/theory.mjs). The globe tunes to what a section names; the dynamical lens is
// this lens's picture of a subject in motion.
import { scopeOf } from '../data/scope';
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
interface QL { text: string; source: string; name?: string }
/** One stop of the walk: a QL position, the number beside it, von Franz on the number, Jung on what the position names. */
interface NumberRow { n: number; position: string; ql: QL; gloss: QL; line: string; quotes: LensQuote[]; jung: LensQuote[]; subjects: Subject[]; section?: string }
interface NumberData {
  line: string;
  matheme: QL;
  pauli: QL;
  jung: LensQuote[];
  series: LensQuote;
  numbers: NumberRow[];
  psychoid: { line: string; quotes: LensQuote[]; ql: QL };
  time: { line: string; quotes: LensQuote[]; quaternio: { intro: LensQuote; terms: string[] }; vaneenwyk: { line: string; quotes: LensQuote[] } };
}
interface TheoryData { version: 1; sections: TheorySection[]; number?: NumberData }

const NUMBER: TheorySection = { id: 'number', name: 'Number', line: '', quotes: [], links: [] };

/** Where a QL formulation is quoted from: the published site by its section (W § I), or the earlier notes (S1–S4). */
const qlSource = (src: string) => src.startsWith('W ') ? `epi-logos.org, ${src.slice(2)}` : `the QL framework's notes, ${src}`;

/** A QL formulation: the framework's own words, always marked as QL (ProjectCentral/docs/ql-reference.md names its sources). */
function qlBlock(q: QL): HTMLElement {
  return el('blockquote', { class: 'lq lq-ql' }, [
    el('p', { text: q.text }),
    el('footer', {}, [el('span', { class: 'lq-voice ql', text: 'QL' }), el('span', { class: 'lq-cite', text: qlSource(q.source) })]),
  ]);
}

/**
 * The six positions on a circle, numbers 1–6 at #0–#5, the site's two vertical poles (origin, synthesis) dashed, and
 * #5 turning back into #0 (the site writes it 5→0). Each position opens its stop; the standing one is lit.
 */
function qlWheel(rows: NumberRow[], open?: (i: number) => void, current = -1, small = false): HTMLElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 240 200');
  svg.setAttribute('class', `ql-wheel${small ? ' small' : ''}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Numbers one to six at QL positions #0 to #5, with #5 returning to #0');
  const add = (tag: string, a: Record<string, string | number>, text?: string) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v)); if (text) n.textContent = text; svg.append(n); return n; };
  const cx = 120, cy = 100, R = 70;
  add('circle', { cx, cy, r: R, class: 'ql-ring' });
  rows.forEach((r, i) => {
    const a = (-90 + i * 60) * (Math.PI / 180);
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `ql-stop${i === current ? ' on' : ''}`);
    svg.append(g);
    const put = (tag: string, a2: Record<string, string | number>, text?: string) => { const n = add(tag, a2, text); g.append(n); return n; };
    put('circle', { cx: x, cy: y, r: 15, class: `ql-node${i === 0 || i === 5 ? ' implicate' : ''}` });
    put('text', { x, y: y + 5, class: 'ql-n', 'text-anchor': 'middle' }, String(r.n));
    put('text', { x: cx + (R + 28) * Math.cos(a), y: cy + (R + 28) * Math.sin(a) + 4, class: 'ql-pos', 'text-anchor': 'middle' }, r.position);
    if (open) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${r.position}, ${r.ql.name}: number ${r.n}`);
      g.addEventListener('click', () => open(i));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } });
    }
  });
  add('text', { x: cx, y: cy + 4, class: 'ql-centre', 'text-anchor': 'middle' }, '5→0');
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
    const sc = scopeOf(ctx.model, idx, `“${s.name}”`);
    if (pal) ctx.engine.setPalette(pal, 1.4);
    ctx.engine.setEmphasis(sc.rel, pal?.core ?? null, sc.info);
  };

  /** The globe tuned to a stop's subjects: their presences stand, the nearby dim, the rest is set aside. */
  const tuneSubjects = (subjects: Subject[], label: string) => {
    const idx = [...new Set(subjects.flatMap((x) => subjectOccurrences(ctx.model, x)))];
    if (!idx.length) { ctx.engine.setEmphasis(null, null); return; }
    const pal = subjectPalette(ctx.model, subjects[0], averagePalettes);
    const sc = scopeOf(ctx.model, idx, label);
    if (pal) ctx.engine.setPalette(pal, 1.4);
    ctx.engine.setEmphasis(sc.rel, pal?.core ?? null, sc.info);
  };

  const sectionNav = (sections: TheorySection[], id: string) => el('nav', { class: 'th-nav', 'aria-label': 'Theory sections' }, sections.map((x) =>
    el('button', { type: 'button', class: 'th-tab', 'aria-current': x.id === id ? 'true' : undefined, text: x.name, onclick: () => ctx.setPath(x.id === sections[0].id ? [] : [x.id]) })));

  const show = (key: string, nodes: (HTMLElement | null)[], wide = true) => {
    const body = nodes.filter((n): n is HTMLElement => !!n);
    if (ctx.panel.isOpen) ctx.panel.replace(body); else ctx.panel.open('Theory', body, { wide });
    current = key;
  };

  /** Number: the overview — the six positions on their wheel, Jung and von Franz on number, the psychoid and time. */
  const renderNumber = (sections: TheorySection[]) => {
    const d = data!.number!;
    ctx.setContext('Number');
    ctx.engine.setEmphasis(null, null);
    const openStop = (i: number) => ctx.setPath(['number', String(i)]);
    const stops = el('div', { class: 'th-links ql-stops' }, d.numbers.map((r, i) =>
      el('button', { type: 'button', class: 'th-link', onclick: () => openStop(i) }, [
        el('span', { class: 'ql-stop-name' }, [el('strong', { text: `${r.n} ↔ ${r.position}` }), el('span', { text: ` ${r.ql.name ?? ''}` })]), icon('next', 14)])));
    const q = (x: { terms: string[] }) => el('div', { class: 'ql-quaternio', role: 'img', 'aria-label': `The quaternio: ${x.terms.join('; ')}` }, x.terms.map((t, i) => el('span', { class: `ql-q q${i}`, text: t })));
    show('number', [
      sectionNav(sections, 'number'),
      el('p', { class: 'th-line', text: d.line }),
      ...d.jung.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      qlBlock(d.pauli),
      el('h3', { class: 'as-h3', text: 'One to six, beside #0 to #5' }),
      qlWheel(d.numbers, openStop),
      qlBlock(d.matheme),
      quoteBlock(d.series, ctx.passages, { compact: true }),
      el('button', { type: 'button', class: 'th-walk', onclick: () => openStop(0) }, [el('span', { text: 'Walk the six positions' }), icon('next', 14)]),
      stops,
      el('h3', { class: 'as-h3', text: 'The psychoid' }),
      el('p', { class: 'th-line', text: d.psychoid.line }),
      ...d.psychoid.quotes.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      qlBlock(d.psychoid.ql),
      el('h3', { class: 'as-h3', text: 'Time' }),
      el('p', { class: 'th-line', text: d.time.line }),
      ...d.time.quotes.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      quoteBlock(d.time.quaternio.intro, ctx.passages, { compact: true }),
      q(d.time.quaternio),
      el('p', { class: 'th-line', text: d.time.vaneenwyk.line }),
      ...d.time.vaneenwyk.quotes.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.navigate({ view: { kind: 'world' }, deep: false, dynamics: {} }) }, [el('span', { text: 'The dynamical lens' }), icon('next', 14)]),
    ]);
  };

  /**
   * One stop of the walk, the way the Red Book walks its folios: the position and its number, the framework's words for
   * both, von Franz on the number and Jung on what the position names (each cite opens its page in the corpus), the
   * globe tuned to what the stop speaks of, and the way on.
   */
  const renderStop = (sections: TheorySection[], i: number) => {
    const d = data!.number!;
    const r = d.numbers[i];
    const all = d.numbers.length;
    const go = (k: number) => ctx.setPath(['number', String((k + all) % all)]);
    const word = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][r.n];
    ctx.setContext(`${word} at ${r.position}`);
    const links = el('div', { class: 'th-links' });
    for (const subject of r.subjects) links.append(el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus(subject) }, [el('span', { text: `${subjectName(ctx.model, subject)} on the globe` }), icon('next', 14)]));
    const sec = r.section ? sections.find((x) => x.id === r.section) : undefined;
    if (sec) links.append(el('button', { type: 'button', class: 'th-link', onclick: () => ctx.setPath([sec.id]) }, [el('span', { text: `Theory: ${sec.name}` }), icon('next', 14)]));
    const first = r.jung[0] ?? r.quotes[0];
    show(`number/${i}`, [
      sectionNav(sections, 'number'),
      el('div', { class: 'ql-walk-head' }, [
        el('button', { type: 'button', class: 'link-quiet', text: 'Number', onclick: () => ctx.setPath(['number']) }),
        el('span', { class: 'th-count', text: `${i + 1} of ${all}` }),
      ]),
      qlWheel(d.numbers, (k) => go(k), i, true),
      el('div', { class: 'ql-head' }, [el('span', { class: 'ql-big', text: String(r.n) }), el('span', { class: 'ql-arrow', text: '↔' }), el('span', { class: 'ql-big pos', text: r.position }), el('span', { class: 'ql-name', text: r.ql.name ?? '' })]),
      el('p', { class: 'th-line', text: r.line }),
      el('h3', { class: 'as-h3', text: 'The framework' }),
      qlBlock(r.ql),
      qlBlock(r.gloss),
      el('h3', { class: 'as-h3', text: `Von Franz on ${['', 'one', 'two', 'three', 'four', 'five', 'six'][r.n]}` }),
      ...r.quotes.map((q) => quoteBlock(q, ctx.passages, { compact: true })),
      r.quotes.length < 2 ? el('p', { class: 'lp-note', text: `Number and Time says less about ${['', 'one', 'two', 'three', 'four', 'five', 'six'][r.n]} than about the first four numbers.` }) : null,
      r.jung.length ? el('h3', { class: 'as-h3', text: 'Jung' }) : null,
      ...r.jung.map((q) => quoteBlock(q, ctx.passages)),
      // the deep dive: the passage itself, read in full in the corpus
      first && ctx.passages?.known(first.cite.work)
        ? el('button', { type: 'button', class: 'th-walk', onclick: () => ctx.passages!.open(first.cite.work, first.cite.locator) }, [el('span', { text: `Read ${first.cite.workTitle} at ${first.cite.locator}` }), icon('next', 14)])
        : null,
      links.childElementCount ? links : null,
      el('div', { class: 'th-step' }, [
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous position', onclick: () => go(i - 1) }, [icon('back')]),
        el('span', { class: 'th-count', text: `${r.position} → ${d.numbers[(i + 1) % all].position}` }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next position', onclick: () => go(i + 1) }, [icon('next')]),
      ]),
    ]);
    tuneSubjects(r.subjects, `${word.toLowerCase()} at ${r.position}`);
  };

  const render = (id: string, stop?: string) => {
    if (!data) return;
    const sections = data.number ? [...data.sections, NUMBER] : data.sections;
    if (id === 'number' && data.number) {
      const i = stop === undefined ? -1 : Number(stop);
      if (Number.isInteger(i) && i >= 0 && i < data.number.numbers.length) renderStop(sections, i); else renderNumber(sections);
      return;
    }
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
      const key = path[1] !== undefined ? `${want}/${path[1]}` : want;
      if (data) { if (key !== current || !ctx.panel.isOpen) render(want, path[1]); return; }
      if (failed) return;
      ctx.panel.open('Theory', [el('p', { class: 'lp-sub', text: 'Loading…' })]);
      loadLensData<TheoryData>('theory').then((d) => { data = d; render(want, path[1]); }).catch((err) => {
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

