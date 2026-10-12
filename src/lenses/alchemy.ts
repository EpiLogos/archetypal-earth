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
import { modeOptions, optionAction, optionGroup } from '../ui/mode-options';
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

type Section = AlchemyRoute['section'];
/** The four tabs, each with the lens path it stands at (the Opus tab is the overview, the empty path). */
const SECTIONS: { id: Section; name: string; path: string[] }[] = [
  { id: 'opus', name: 'Opus', path: [] },
  { id: 'operations', name: 'Operations', path: ['operations'] },
  { id: 'matter', name: 'Matter', path: ['matter'] },
  { id: 'elements', name: 'Elements', path: ['elements'] },
];

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

  const show = (nodes: (HTMLElement | null)[], foot?: HTMLElement | null, wide = true) => {
    const body = nodes.filter((n): n is HTMLElement => !!n);
    const footNodes = foot ? [foot] : null;
    if (ctx.panel.isOpen) ctx.panel.replace(body, { foot: footNodes }); else ctx.panel.open('Alchemy', body, { wide, foot: footNodes });
  };

  /** Same prev/next circles as Theory's walk and the Red Book rail. */
  const walkRail = (label: string, prev: () => void, next: () => void, at: string) => el('nav', { class: 'rb-rail', 'aria-label': label }, [
    el('button', { type: 'button', text: '←', 'aria-label': 'Previous', onclick: prev }),
    el('span', { class: 'rb-progress', text: at }),
    el('button', { type: 'button', text: '→', 'aria-label': 'Next', onclick: next }),
  ]);

  const sectionNav = (section: Section) => el('nav', { class: 'th-nav', 'aria-label': 'Alchemy sections' }, SECTIONS.map((x) =>
    el('button', { type: 'button', class: 'th-tab', 'aria-current': x.id === section ? 'true' : undefined, text: x.name, onclick: () => ctx.setPath(x.path) })));

  const subjectLink = (s: Subject) => el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus(s) }, [el('span', { text: subjectName(ctx.model, s) }), icon('next', 14)]);
  const walkLink = (label: string, path: string[]) => el('button', { type: 'button', class: 'th-link', onclick: () => ctx.setPath(path) }, [el('span', { text: label }), icon('next', 14)]);

  const alchemyOptions = (section: Section) => {
    ctx.setControls([modeOptions([
      optionGroup('Walk the work', [
        optionAction('Opus', () => ctx.setPath([]), { pressed: section === 'opus', description: 'The opus, nigredo to rubedo' }),
        optionAction('Operations', () => ctx.setPath(['operations']), { pressed: section === 'operations', description: 'The workings of the opus' }),
        optionAction('Matter', () => ctx.setPath(['matter']), { pressed: section === 'matter', description: 'What the work is done on' }),
        optionAction('Elements', () => ctx.setPath(['elements']), { pressed: section === 'elements', description: 'Fire, water, earth, air and the fifths' }),
      ]),
    ], 'Options')]);
  };

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
      sectionNav('opus'),
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
    const go = (k: number) => ctx.setPath(['opus', d.opus.stages[(k + n) % n].id]);
    ctx.setContext(`${st.name}, ${st.colour}`);
    const ops = st.operations.map((id) => d.operations.find((o) => o.id === id)).filter((o): o is AlchemyOperation => !!o);
    show([
      sectionNav('opus'),
      el('div', { class: 'ql-walk-head' }, [
        el('button', { type: 'button', class: 'link-quiet', text: 'Opus', onclick: () => ctx.setPath([]) }),
        el('span', { class: 'th-count', text: `${i + 1} of ${n}` }),
      ]),
      opusWheel(d.opus.stages, d.opus.stages.map((s) => famCore(s.family)), go, i, true),
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
    ], walkRail('Opus stages', () => go(i - 1), () => go(i + 1), `${i + 1} / ${n}`));
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
      sectionNav(section),
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
    ], walkRail(section === 'operations' ? 'Operations' : 'Matter', () => go(i - 1), () => go(i + 1), `${i + 1} / ${n}`));
    tuneSubjects(it.subjects, it.name.toLowerCase());
  };

  /** The list of operations or of matter: each name, with the stage it belongs to. */
  const renderList = (section: 'operations' | 'matter', d: AlchemyData) => {
    const items = section === 'operations' ? d.operations : d.matter;
    ctx.setContext(section === 'operations' ? 'Operations' : 'Matter');
    ctx.engine.setEmphasis(null, null);
    show([
      sectionNav(section),
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
      sectionNav('elements'),
      el('p', { class: 'th-line', text: d.elements.line }),
      ...d.elements.quotes.map((q) => quoteBlock(q, ctx.passages)),
      d.elements.subjects.length ? el('h3', { class: 'as-h3', text: 'In the field' }) : null,
      d.elements.subjects.length ? el('div', { class: 'th-links' }, d.elements.subjects.map(subjectLink)) : null,
    ]);
    tuneSubjects(d.elements.subjects, 'the elements');
  };

  const render = (d: AlchemyData, path: string[]) => {
    const r = parseAlchemyRoute(path, idsOf(d));
    alchemyOptions(r.section);
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
    current = alchemyPath(r).join('/');
  };

  return {
    enter(path) {
      wanted = path;
      if (data) {
        if (canon(data, path) !== current || !ctx.panel.isOpen) render(data, path);
        return;
      }
      if (failed) return;
      alchemyOptions('opus');
      ctx.panel.open('Alchemy', [el('p', { class: 'lp-sub', text: 'Loading…' })]);
      loadLensData<AlchemyData>('alchemy').then((d) => { data = d; render(d, wanted); }).catch((err) => {
        failed = true;
        console.error(err);
        ctx.panel.replace([el('p', { class: 'lp-error', text: 'The alchemy data is not available in this build.' })]);
      });
    },
    leave() {
      current = '';
      ctx.setControls(null);
      ctx.engine.setEmphasis(null, null);
    },
  };
}
