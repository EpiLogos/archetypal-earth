// ALCHEMY: the opus as an ordered walk (nigredo, albedo, citrinitas, rubedo), its operations, the matter it works on and the
// elements it draws on (ProjectCentral/docs/ELEMENTS-ALCHEMY-SKY-TAROT-PLAN.md, track B). Every claim is a verbatim
// quotation placed by the corpus (public/data/alchemy.json, built by scripts/alchemy.mjs). The globe tunes to the family a
// stage names; the subjects a page links are the field's own nodes, and the routes are pure (alchemy-route.ts).
import { scopeOf } from '../data/scope';
import { el, plate } from '../ui/dom';
import { creditLine, creditLineFull } from '../ui/credit';
import { icon } from '../ui/icons';
import { averagePalettes } from '../data/palette';
import { subjectName, subjectOccurrences, subjectPalette, type Subject } from '../data/model';
import type { LensContext, LensInstance } from '../shell/lens';
import { paneStepper } from '../ui/pane';
import { WalkRunner } from '../walk/runner';
import { alchemyContentsGroups, stagesWalk } from './alchemy-contents';
import { loadLensData, quoteBlock, type LensQuote } from './ui';
import { alchemyPath, parseAlchemyRoute, type AlchemyIds, type AlchemyRoute } from './alchemy-route';

interface AlchemyStage {
  id: string; family: string; name: string; colour: string; line: string; quotes: LensQuote[];
  psyche: { line: string; quotes: LensQuote[] };
  operations: string[];
  subjects: Subject[];
}
interface AlchemyOperation { id: string; name: string; line: string; quotes: LensQuote[]; stage?: string; subjects: Subject[] }
interface AlchemyMatter { id: string; name: string; line: string; quotes: LensQuote[]; subjects: Subject[] }
interface AlchemyData {
  version: 1;
  line: string;
  opus: { line: string; stages: AlchemyStage[]; bridge: { line: string; quotes: LensQuote[] } };
  operations: AlchemyOperation[];
  matter: AlchemyMatter[];
  elements: { line: string; quotes: LensQuote[]; subjects: Subject[] };
}

const NS = 'http://www.w3.org/2000/svg';

/** The four colours of the work, by the word the curation gives the stage: the wheel shows the colour the stage is named for. */
const STAGE_COLOUR: Record<string, string> = { black: '#26252b', white: '#ecebe6', yellow: '#d8b845', red: '#b5473a' };

/**
 * The opus on its circle: the stages clockwise from the top (the curation's order), each stop filled with its family's
 * core, the standing one lit. Same drawing as Theory's number wheel (qlWheel), with the stop's name beside it.
 */
function opusWheel(stages: { name: string; colour: string }[], cores: (string | undefined)[], open: (i: number) => void, current = -1, small = false): HTMLElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 200');
  svg.setAttribute('class', `ql-wheel${small ? ' small' : ''}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `The opus, clockwise from the top: ${stages.map((s) => s.name).join(', then ')}`);
  const add = (tag: string, a: Record<string, string | number>, text?: string) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v)); if (text) n.textContent = text; svg.append(n); return n; };
  const cx = 150, cy = 100, R = 64;
  add('circle', { cx, cy, r: R, class: 'ql-ring' });
  stages.forEach((s, i) => {
    const a = (-90 + (i * 360) / stages.length) * (Math.PI / 180);
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `ql-stop${i === current ? ' on' : ''}`);
    svg.append(g);
    const put = (tag: string, a2: Record<string, string | number>, text?: string) => { const n = add(tag, a2, text); g.append(n); return n; };
    const node = put('circle', { cx: x, cy: y, r: 15, class: 'ql-node' });
    const core = STAGE_COLOUR[s.colour.toLowerCase()] ?? cores[i];
    if (core) node.style.fill = core;
    put('text', { x, y: y + 5, class: 'ql-n', 'text-anchor': 'middle' }, String(i + 1));
    const c = Math.cos(a);
    put('text', { x: cx + (R + 22) * c, y: cy + (R + 22) * Math.sin(a) + 4, class: 'ql-pos', 'text-anchor': c > 0.2 ? 'start' : c < -0.2 ? 'end' : 'middle' }, s.name);
    if (open) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${s.name}, ${s.colour}`);
      g.addEventListener('click', () => open(i));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } });
    }
  });
  add('text', { x: cx, y: cy + 4, class: 'ql-centre', 'text-anchor': 'middle' }, 'opus');
  const fig = el('figure', { class: 'as-figure' });
  fig.append(svg);
  return fig;
}

export function mount(ctx: LensContext): LensInstance {
  let data: AlchemyData | null = null;
  let current = '';
  let failed = false;
  /** the path the lens was last asked to show: a load that finishes after another request shows the latest one */
  let wanted: string[] = [];

  const idsOf = (d: AlchemyData): AlchemyIds => ({ stages: d.opus.stages.map((s) => s.id), operations: d.operations.map((o) => o.id), matter: d.matter.map((m) => m.id) });
  const canon = (d: AlchemyData, path: string[]) => alchemyPath(parseAlchemyRoute(path, idsOf(d))).join('/');
  const famCore = (id: string): string | undefined => ctx.model.famById.get(id)?.palette?.core;
  /** The stage family's own plate, when the register has one (citrinitas has none: nothing stands in its place). */
  const stagePlate = (st: AlchemyStage, kind: 'thumb' | 'figure'): HTMLElement | null => {
    const fam = ctx.model.famById.get(st.family);
    if (!fam?.image) return null;
    if (kind === 'thumb') return plate(fam.image, { thumb: true, className: 'al-thumb', palette: fam.palette, alt: '' });
    // the credit and licence stand under the plate, as the Astrology portraits carry theirs: a tall plate is narrow, and
    // an overlaid line would be cut short of its licence
    return el('div', { class: 'as-figure al-figure' }, [
      plate(fam.image, { className: 'al-plate', palette: fam.palette, alt: `${st.name}, ${st.colour}` }),
      el('p', { class: 'al-credit', text: creditLine(fam.image), title: creditLineFull(fam.image) }),
    ]);
  };

  /** The globe tuned to the subjects: their presences stand, the nearby dim, the rest is set aside. Nothing placed: the field stands as it was. */
  const tuneSubjects = (subjects: Subject[], label: string) => {
    const idx = [...new Set(subjects.flatMap((x) => subjectOccurrences(ctx.model, x)))];
    if (!idx.length) { ctx.engine.setEmphasis(null, null); return; }
    const pal = subjectPalette(ctx.model, subjects[0], averagePalettes);
    const sc = scopeOf(ctx.model, idx, label);
    if (pal) ctx.engine.setPalette(pal, 1.4);
    ctx.engine.setEmphasis(sc.rel, pal?.core ?? null, sc.info);
  };

  /** the route the lens stands at, for the Contents to mark */
  let standing: AlchemyRoute | null = null;
  /** the opus's stages are walked by the one runner (past the last comes the first) */
  const runner = new WalkRunner({ scale: ctx.model.scale, wrap: true });
  const SNAPSHOT = { u: 0, focus: null, reading: null, centre: null, walk: null };

  /** A reading of this lens: held in the pane until the visitor asks for it (the Contents does), shown at once when it already is. */
  const show = (nodes: (HTMLElement | null)[], foot?: Node[] | null, engages?: { type: string; id: string }) => {
    ctx.pane.load({ key: `alchemy/${current}`, eyebrow: 'Alchemy', nodes: nodes.filter((n): n is HTMLElement => !!n), foot: foot ?? null, engages });
  };

  /** Prev / next under a reading, in the pane's own stepper. */
  const stepper = (label: string, prev: () => void, next: () => void, at: string, names?: { prev: string; next: string }) =>
    paneStepper({ prev: `Previous ${label}`, next: `Next ${label}` }, at, prev, next, {}, names);

  const subjectLink = (s: Subject) => el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus(s) }, [el('span', { text: subjectName(ctx.model, s) }), icon('next', 14)]);
  const walkLink = (label: string, path: string[]) => el('button', { type: 'button', class: 'th-link', onclick: () => ctx.setPath(path) }, [el('span', { text: label }), icon('next', 14)]);

  /** The opus overview: the lens line, the four stages on their circle, the stage list, then the bridge block. */
  const renderOpus = (d: AlchemyData) => {
    ctx.setContext('Opus');
    ctx.engine.setEmphasis(null, null);
    const go = (i: number) => ctx.setPath(['opus', d.opus.stages[i].id]);
    const list = el('div', { class: 'th-links ql-stops' }, d.opus.stages.map((s, i) =>
      el('button', { type: 'button', class: 'th-link', onclick: () => go(i) }, [
        el('span', { class: 'al-stop' }, [
          stagePlate(s, 'thumb'),
          el('span', { class: 'ql-stop-name' }, [el('strong', { text: s.name }), el('span', { text: ` ${s.colour}` })]),
        ]), icon('next', 14)])));
    show([
      el('h2', { class: 'dp-title', text: 'Alchemy' }),
      el('p', { class: 'th-line', text: d.line }),
      el('h3', { class: 'as-h3', text: 'The opus' }),
      el('p', { class: 'th-line', text: d.opus.line }),
      opusWheel(d.opus.stages, d.opus.stages.map((s) => famCore(s.family)), go),
      list,
      el('h3', { class: 'as-h3', text: 'The bridge' }),
      el('p', { class: 'th-line', text: d.opus.bridge.line }),
      ...d.opus.bridge.quotes.map((q) => quoteBlock(q, ctx.passages)),
    ]);
  };

  /** One stage of the opus, walked as the Theory stops are: its line, Jung's quotations, the psychological reading, the way on. */
  const renderStage = (d: AlchemyData, i: number) => {
    const st = d.opus.stages[i];
    const n = d.opus.stages.length;
    // the wheel's stops open their stage; the stepper asks the runner for the neighbour
    const open = (k: number) => ctx.setPath(['opus', d.opus.stages[(k + n) % n].id]);
    const go = (delta: number) => {
      const step = delta > 0 ? runner.next() : runner.prev();
      const id = step?.stop.subject?.id;
      if (id) ctx.setPath(['opus', id]);
    };
    ctx.setContext(`${st.name}, ${st.colour}`);
    const ops = st.operations.map((id) => d.operations.find((o) => o.id === id)).filter((o): o is AlchemyOperation => !!o);
    // the walk: the runner stands on this stage (it begins here when the opus is entered at a stage)
    if (runner.active) runner.goto(i); else runner.start(stagesWalk(ctx.model.walkById, d.opus.stages), SNAPSHOT, i);
    show([
      el('div', { class: 'ql-walk-head' }, [
        el('button', { type: 'button', class: 'link-quiet', text: 'Opus', onclick: () => ctx.setPath([]) }),
        el('span', { class: 'th-count', text: `${i + 1} of ${n}` }),
      ]),
      opusWheel(d.opus.stages, d.opus.stages.map((s) => famCore(s.family)), open, i, true),
      el('div', { class: 'ql-head' }, [el('span', { class: 'ql-big pos', text: st.name }), el('span', { class: 'ql-name', text: st.colour })]),
      stagePlate(st, 'figure'),
      el('p', { class: 'th-line', text: st.line }),
      ...st.quotes.map((q) => quoteBlock(q, ctx.passages)),
      el('h3', { class: 'as-h3', text: 'The psychological reading' }),
      el('p', { class: 'th-line', text: st.psyche.line }),
      ...st.psyche.quotes.map((q) => quoteBlock(q, ctx.passages)),
      ops.length ? el('h3', { class: 'as-h3', text: 'Operations' }) : null,
      ops.length ? el('div', { class: 'th-links' }, ops.map((o) => walkLink(o.name, ['operations', o.id]))) : null,
      el('h3', { class: 'as-h3', text: 'In the field' }),
      el('div', { class: 'th-links' }, [
        // the family's own node: the globe and the field focus on it, as any subject
        subjectLink({ type: 'family', id: st.family }),
        ...st.subjects.map(subjectLink),
      ]),
    ], stepper('stage', () => go(-1), () => go(1), `${i + 1} / ${n}`, { prev: d.opus.stages[(i - 1 + n) % n].name, next: d.opus.stages[(i + 1) % n].name }), { type: 'family', id: st.family });
    tuneSubjects([{ type: 'family', id: st.family }], st.name.toLowerCase());
  };

  /** Operations or matter, one item at a time: the line, the quotations, the subjects, and the stage an operation belongs to. */
  const renderItem = (section: 'operations' | 'matter', items: (AlchemyOperation | AlchemyMatter)[], i: number, d: AlchemyData) => {
    const it = items[i];
    const n = items.length;
    const go = (k: number) => ctx.setPath([section, items[(k + n) % n].id]);
    const stage = section === 'operations' && (it as AlchemyOperation).stage !== undefined
      ? d.opus.stages.find((s) => s.id === (it as AlchemyOperation).stage) : undefined;
    ctx.setContext(it.name);
    show([
      el('div', { class: 'ql-walk-head' }, [
        el('button', { type: 'button', class: 'link-quiet', text: section === 'operations' ? 'Operations' : 'Matter', onclick: () => ctx.setPath([section]) }),
        el('span', { class: 'th-count', text: `${i + 1} of ${n}` }),
      ]),
      el('div', { class: 'ql-head' }, [el('span', { class: 'ql-big pos', text: it.name })]),
      el('p', { class: 'th-line', text: it.line }),
      ...it.quotes.map((q) => quoteBlock(q, ctx.passages)),
      stage ? el('h3', { class: 'as-h3', text: 'Its stage in the opus' }) : null,
      stage ? el('div', { class: 'th-links' }, [walkLink(`${stage.name}, ${stage.colour}`, ['opus', stage.id])]) : null,
      it.subjects.length ? el('h3', { class: 'as-h3', text: 'In the field' }) : null,
      it.subjects.length ? el('div', { class: 'th-links' }, it.subjects.map(subjectLink)) : null,
    ], stepper(section === 'operations' ? 'operation' : 'matter', () => go(i - 1), () => go(i + 1), `${i + 1} / ${n}`, { prev: items[(i - 1 + n) % n].name, next: items[(i + 1) % n].name }));
    tuneSubjects(it.subjects, it.name.toLowerCase());
  };

  /** The list of operations or of matter: each name, with the stage it belongs to. */
  const renderList = (section: 'operations' | 'matter', d: AlchemyData) => {
    const items = section === 'operations' ? d.operations : d.matter;
    ctx.setContext(section === 'operations' ? 'Operations' : 'Matter');
    ctx.engine.setEmphasis(null, null);
    show([
      el('h2', { class: 'dp-title', text: section === 'operations' ? 'Operations' : 'Matter' }),
      el('div', { class: 'th-links ql-stops' }, items.map((it) => {
        const stage = section === 'operations' ? d.opus.stages.find((s) => s.id === (it as AlchemyOperation).stage) : undefined;
        return el('button', { type: 'button', class: 'th-link', onclick: () => ctx.setPath([section, it.id]) }, [
          el('span', { class: 'ql-stop-name' }, [el('strong', { text: it.name }), el('span', { text: stage ? ` ${stage.name}` : '' })]), icon('next', 14)]);
      })),
    ]);
  };

  const renderElements = (d: AlchemyData) => {
    ctx.setContext('Elements');
    ctx.engine.setEmphasis(null, null);
    show([
      el('h2', { class: 'dp-title', text: 'Elements' }),
      el('p', { class: 'th-line', text: d.elements.line }),
      ...d.elements.quotes.map((q) => quoteBlock(q, ctx.passages)),
      d.elements.subjects.length ? el('h3', { class: 'as-h3', text: 'In the field' }) : null,
      d.elements.subjects.length ? el('div', { class: 'th-links' }, d.elements.subjects.map(subjectLink)) : null,
    ]);
    tuneSubjects(d.elements.subjects, 'the elements');
  };

  const render = (d: AlchemyData, path: string[]) => {
    const r = parseAlchemyRoute(path, idsOf(d));
    standing = r;
    current = alchemyPath(r).join('/');
    switch (r.section) {
      case 'opus': {
        const i = r.stage !== undefined ? d.opus.stages.findIndex((s) => s.id === r.stage) : -1;
        if (i >= 0) renderStage(d, i); else renderOpus(d);
        break;
      }
      case 'operations':
      case 'matter': {
        const items = r.section === 'operations' ? d.operations : d.matter;
        const i = r.id !== undefined ? items.findIndex((x) => x.id === r.id) : -1;
        if (i >= 0) renderItem(r.section, items, i, d); else renderList(r.section, d);
        break;
      }
      case 'elements': renderElements(d); break;
    }
  };

  /** The Contents: the opus whole and its stages, the operations, the matter, the elements. Each pick is a request to read: the pane shows the reading. */
  const contents = () => data
    ? alchemyContentsGroups({ stages: data.opus.stages, operations: data.operations, matter: data.matter }, standing, (p) => ctx.setPath(p))
    : [];

  return {
    enter(path) {
      wanted = path;
      ctx.pane.contents('Alchemy', contents);
      if (data) {
        if (canon(data, path) !== current) render(data, path);
        return;
      }
      if (failed) return;
      loadLensData<AlchemyData>('alchemy').then((d) => { data = d; render(d, wanted); }).catch((err) => {
        failed = true;
        console.error(err);
        ctx.pane.load({ key: 'unavailable', eyebrow: 'Alchemy', nodes: [el('p', { class: 'lp-error', text: 'The alchemy data is not available in this build.' })] });
      });
    },
    leave() {
      current = '';
      standing = null;
      runner.interrupt();
      ctx.engine.setEmphasis(null, null);
    },
  };
}
