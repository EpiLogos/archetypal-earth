// THEORY: the psychodynamics the rest of the field runs on (MODES-RFC §3) — the Self as centre, energy, compensation,
// enantiodromia, the transcendent function, and number. Every claim is a verbatim quotation placed by the corpus
// (public/data/theory.json, built by scripts/theory.mjs). The globe tunes to what a section names; the dynamical lens is
// this lens's picture of a subject in motion.
import { scopeOf } from '../data/scope';
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { averagePalettes, rgbCss } from '../data/palette';
import { subjectName, subjectOccurrences, subjectPalette, type Subject } from '../data/model';
import { BUILT, type LensContext, type LensInstance } from '../shell/lens';
import type { PanelLensId } from '../state/store';
import { inLens } from '../state/store';
import { paneStepper } from '../ui/pane';
import { WalkRunner } from '../walk/runner';
import type { DynamicsConcept, DynamicsRoute } from '../types/dynamics';
import { theoreticReading, theoreticsWalk, theoryContentsGroups, type TheoryAt } from './theory-contents';
import { loadLensData, qlBlock, quoteBlock, type LensQuote, type QL } from './ui';
import { treeFigure } from './tree';
import { providerLabels } from '../data/labels';

/** The number archetypes past six, and the family the Tree of Life is filed under (both added by the data lanes). */
const NUMBER_PAST_SIX = ['seven', 'eight', 'nine', 'ten'];
const TREE_FAMILY = 'tree';

interface TheoryLink { type: 'family' | 'archetype' | 'theoretic' | 'lens'; id: string }
interface TheorySection { id: string; name: string; line: string; quotes: LensQuote[]; links: TheoryLink[] }
/** One stop of the walk: a QL position, the number beside it, von Franz on the number, Jung on what the position names. */
interface NumberRow { n: number; position: string; ql: QL; gloss: QL; line: string; quotes: LensQuote[]; jung: LensQuote[]; subjects: Subject[]; section?: string }
interface NumberData {
  line: string;
  matheme: QL;
  pauli: QL;
  jung: LensQuote[];
  series: LensQuote;
  numbers: NumberRow[];
  psychoid: { line: string; quotes: LensQuote[]; ql: QL; subjects?: TheoryLink[] };
  time: { line: string; quotes: LensQuote[]; quaternio: { intro: LensQuote; terms: string[] }; vaneenwyk: { line: string; quotes: LensQuote[] } };
}
interface TheoryData { version: 1; sections: TheorySection[]; number?: NumberData }

const NUMBER: TheorySection = { id: 'number', name: 'Number', line: '', quotes: [], links: [] };

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
  dynamics: { text: 'Dynamics: Archetypes & Strange Attractors', state: () => ({ view: { kind: 'world' }, deep: false, dynamics: { route: true } }) },
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

  /** Where the visitor stands, for the Contents to mark. */
  let standing: TheoryAt = { kind: 'none' };
  let route: DynamicsRoute | null = null;
  let concepts: DynamicsConcept[] = [];
  /** the fourteen theoretics, walked by the one runner (past the last comes the first) */
  const theoretics = theoreticsWalk(ctx.model);
  const runner = new WalkRunner({ scale: ctx.model.scale, wrap: true });
  const SNAPSHOT = { u: 0, focus: null, reading: null, centre: null, walk: null };

  /** A reading of this lens: held in the pane until the visitor asks for it (the Contents does), shown at once when it already is. */
  const show = (key: string, eyebrow: string, nodes: (HTMLElement | null)[], foot?: Node[] | null, engages?: { type: string; id: string }) => {
    ctx.pane.load({ key, eyebrow, nodes: nodes.filter((n): n is HTMLElement => !!n), foot: foot ?? null, engages });
    current = key;
  };

  /** Prev / next under a reading, in the pane's own stepper. */
  const stepper = (label: string, prev: () => void, next: () => void, at: string) =>
    paneStepper({ prev: `Previous ${label}`, next: `Next ${label}` }, at, prev, next);

  /** The number archetypes seven to ten, and the Tree's family, as links where the field holds them; null when it holds none. */
  const pastSixLinks = (): HTMLElement | null => {
    const subjects: Subject[] = [
      ...NUMBER_PAST_SIX.filter((id) => ctx.model.archById.has(id)).map((id): Subject => ({ type: 'archetype', id })),
      ...(ctx.model.famById.has(TREE_FAMILY) ? [{ type: 'family', id: TREE_FAMILY } as Subject] : []),
    ];
    if (!subjects.length) return null;
    return el('div', { class: 'th-links' }, subjects.map((s) =>
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus(s) }, [el('span', { text: subjectName(ctx.model, s) }), icon('next', 14)])));
  };

  /** Number: the overview — the six positions on their wheel, Jung and von Franz on number, the psychoid and time. */
  const renderNumber = () => {
    const d = data!.number!;
    ctx.setContext('Number');
    ctx.engine.setEmphasis(null, null);
    const openStop = (i: number) => ctx.setPath(['number', String(i)]);
    const stops = el('div', { class: 'th-links ql-stops' }, d.numbers.map((r, i) =>
      el('button', { type: 'button', class: 'th-link', onclick: () => openStop(i) }, [
        el('span', { class: 'ql-stop-name' }, [el('strong', { text: `${r.n} ↔ ${r.position}` }), el('span', { text: ` ${r.ql.name ?? ''}` })]), icon('next', 14)])));
    const q = (x: { terms: string[] }) => el('div', { class: 'ql-quaternio', role: 'img', 'aria-label': `The quaternio: ${x.terms.join('; ')}` }, x.terms.map((t, i) => el('span', { class: `ql-q q${i}`, text: t })));
    standing = { kind: 'section', id: 'number' };
    show('number', 'Theory', [
      el('h2', { class: 'dp-title', text: 'Number' }),
      el('p', { class: 'th-line', text: d.line }),
      ...d.jung.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      qlBlock(d.pauli),
      el('h3', { class: 'as-h3', text: 'One to six, beside #0 to #5' }),
      qlWheel(d.numbers, openStop),
      qlBlock(d.matheme),
      quoteBlock(d.series, ctx.passages, { compact: true }),
      el('button', { type: 'button', class: 'th-walk', onclick: () => openStop(0) }, [el('span', { text: 'Walk the six positions' }), icon('next', 14)]),
      stops,
      el('h3', { class: 'as-h3', text: 'Seven to ten and the Tree' }),
      el('p', { class: 'th-line', text: 'The numbers seven to ten are archetypes of the field; the Tree’s ten sephiroth carry them.' }),
      el('figure', { class: 'as-figure' }, [treeFigure({
        palette: (id) => { const p = ctx.model.famPalette.get(id); return p ? { core: rgbCss(p.core) } : undefined; },
        has: (id) => ctx.model.famById.has(id),
        open: (id) => ctx.focus({ type: 'family', id }),
      })]),
      pastSixLinks(),
      el('h3', { class: 'as-h3', text: 'The psychoid' }),
      el('p', { class: 'th-line', text: d.psychoid.line }),
      ...d.psychoid.quotes.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      qlBlock(d.psychoid.ql),
      ...(d.psychoid.subjects?.length ? [el('div', { class: 'th-links' }, d.psychoid.subjects.map((l) =>
        el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus(l as Subject) }, [el('span', { text: subjectName(ctx.model, l as Subject) }), icon('next', 14)])))] : []),
      el('h3', { class: 'as-h3', text: 'Time' }),
      el('p', { class: 'th-line', text: d.time.line }),
      ...d.time.quotes.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      quoteBlock(d.time.quaternio.intro, ctx.passages, { compact: true }),
      q(d.time.quaternio),
      el('p', { class: 'th-line', text: d.time.vaneenwyk.line }),
      ...d.time.vaneenwyk.quotes.map((x) => quoteBlock(x, ctx.passages, { compact: true })),
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.navigate({ view: { kind: 'world' }, deep: false, dynamics: { route: true } }) }, [el('span', { text: 'The dynamical lens' }), icon('next', 14)]),
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
    for (const subject of r.subjects) links.append(el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus(subject) }, [el('span', { text: subjectName(ctx.model, subject) }), icon('next', 14)]));
    const sec = r.section ? sections.find((x) => x.id === r.section) : undefined;
    if (sec) links.append(el('button', { type: 'button', class: 'th-link', onclick: () => ctx.setPath([sec.id]) }, [el('span', { text: `Theory: ${sec.name}` }), icon('next', 14)]));
    const first = r.jung[0] ?? r.quotes[0];
    standing = { kind: 'section', id: 'number' };
    show(`number/${i}`, 'Number', [
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
      r.jung.length ? el('h3', { class: 'as-h3', text: providerLabels().voiceHeading }) : null,
      ...r.jung.map((q) => quoteBlock(q, ctx.passages)),
      // the deep dive: the passage itself, read in full in the corpus
      first && ctx.passages?.known(first.cite.work)
        ? el('button', { type: 'button', class: 'th-walk', onclick: () => ctx.passages!.open(first.cite.work, first.cite.locator) }, [el('span', { text: `Read ${first.cite.workTitle} at ${first.cite.locator}` }), icon('next', 14)])
        : null,
      links.childElementCount ? links : null,
    ], stepper('position', () => go(i - 1), () => go(i + 1), `${i + 1} / ${all}`));
    tuneSubjects(r.subjects, `${word.toLowerCase()} at ${r.position}`);
  };

  const render = (id: string, stop?: string) => {
    if (!data) return;
    const sections = data.number ? [...data.sections, NUMBER] : data.sections;
    if (id === 'number' && data.number) {
      const i = stop === undefined ? -1 : Number(stop);
      if (Number.isInteger(i) && i >= 0 && i < data.number.numbers.length) renderStop(sections, i); else renderNumber();
      return;
    }
    const i = Math.max(0, sections.findIndex((s) => s.id === id));
    const s = sections[i];
    current = s.id;
    ctx.setContext(s.name);
    standing = { kind: 'section', id: s.id };
    const links = el('div', { class: 'th-links' });
    for (const l of s.links) {
      if (l.type === 'lens') {
        const def = LENS_LINK[l.id];
        if (!def || (l.id !== 'aion' && l.id !== 'dynamics' && !BUILT.has(l.id as PanelLensId))) continue;
        links.append(el('button', { type: 'button', class: 'th-link', onclick: () => ctx.navigate(def.state()) }, [el('span', { text: def.text }), icon('next', 14)]));
      } else {
        const subject = l as Subject;
        const name = subjectName(ctx.model, subject);
        links.append(el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus(subject) }, [el('span', { text: name }), icon('next', 14)]));
      }
    }
    const step = (d: number) => {
      const n = sections[(i + d + sections.length) % sections.length];
      ctx.setPath(n.id === sections[0].id ? [] : [n.id]);
    };
    show(s.id, 'Theory', [
      el('h2', { class: 'dp-title', text: s.name }),
      el('p', { class: 'th-line', text: s.line }),
      ...s.quotes.map((q) => quoteBlock(q, ctx.passages)),
      links.childElementCount ? links : null,
    ], stepper('section', () => step(-1), () => step(1), `${i + 1} / ${sections.length}`));
    tune(s);
  };

  /** One theoretic, read in the pane, with the walk of the fourteen under it. */
  const renderTheoretic = (id: string) => {
    const at = theoretics.stops.findIndex((x) => x.subject?.id === id);
    const nodes = at >= 0 ? theoreticReading(ctx.model, id, { passages: ctx.passages, open: (s) => ctx.focus(s) }) : null;
    if (!nodes) { render('', undefined); return; }
    const t = ctx.model.theoById.get(id)!;
    // the walk: the runner stands on this theoretic (it begins here when the route is entered at one)
    if (runner.active) runner.goto(at); else runner.start(theoretics, SNAPSHOT, at);
    const go = (delta: number) => {
      const step = delta > 0 ? runner.next() : runner.prev();
      const next = step?.stop.subject?.id;
      if (next) ctx.setPath(['theoretics', next]);
    };
    ctx.setContext(t.name);
    standing = { kind: 'theoretic', id };
    show(`theoretics/${id}`, 'Theory', nodes, stepper('theoretic', () => go(-1), () => go(1), `${at + 1} / ${theoretics.stops.length}`), { type: 'theoretic', id });
    tuneSubjects([{ type: 'theoretic', id }], t.name);
  };

  /** The Contents: Jung's theory, the fourteen theoretics, the route (Dynamics). Each pick is a request to read: the pane shows the reading. */
  const contents = () => {
    const sections = data ? (data.number ? [...data.sections, NUMBER] : data.sections) : [];
    return theoryContentsGroups({
      model: ctx.model,
      theoryTitle: providerLabels().theoryRoute,
      sections: sections.map((x) => ({ id: x.id, name: x.name })),
      route,
      stopName: (st) => (st.concept ? concepts.find((c) => c.id === st.concept)?.name : st.name) ?? st.id,
      at: standing,
      go: {
        section: (id) => { ctx.setPath(id === sections[0]?.id ? [] : [id]); },
        theoretic: (id) => { ctx.setPath(['theoretics', id]); },
        overview: () => ctx.navigate({ view: { kind: 'world' }, deep: false, dynamics: { route: true } }),
        stop: (id) => ctx.navigate({ view: { kind: 'world' }, deep: false, dynamics: { stop: id } }),
      },
    });
  };

  const showRoute = (path: string[]) => {
    if (path[0] === 'theoretics' && path[1]) renderTheoretic(path[1]); else render(path[0] ?? '', path[1]);
  };

  return {
    enter(path) {
      ctx.setControls(null);
      ctx.pane.contents('Theory', contents);
      const key = path[1] !== undefined ? `${path[0]}/${path[1]}` : (path[0] ?? '');
      if (!route) {
        void Promise.all([loadLensData<DynamicsRoute>('dynamics-route'), loadLensData<{ concepts: DynamicsConcept[] }>('dynamics')])
          .then(([r, d]) => { route = r; concepts = d.concepts; }).catch(() => { /* the route is optional: Contents then lists Jung's theory and the theoretics */ });
      }
      if (data) { if (key !== current) showRoute(path); return; }
      if (failed) return;
      loadLensData<TheoryData>('theory').then((d) => { data = d; showRoute(path); }).catch((err) => {
        failed = true;
        console.error(err);
        ctx.pane.load({ key: 'unavailable', eyebrow: 'Theory', nodes: [el('p', { class: 'lp-error', text: 'The theory data is not available in this build.' })] });
      });
    },
    leave() {
      current = '';
      standing = { kind: 'none' };
      runner.interrupt();
      ctx.setControls(null);
      ctx.engine.setEmphasis(null, null);
    },
  };
}
