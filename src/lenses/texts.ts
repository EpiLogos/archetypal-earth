// TEXTS: a text is a lens. One module, a Work as its subject. Entered from anywhere a work is named (a cite, search, a graph
// node, a person's page, Contents), it takes the work's name as its title, its chapters as Contents, the occurrences that cite
// it as its scope on the globe and its page-ordered walk as the way through it. CW9ii and Liber Novus keep their own lenses:
// the controller hands those two to Aion and the Red Book before this module is reached (`Controller.lensRoute`).
// Everything the lens shows is derived by src/data/texts.ts and the walk runner; nothing is authored here.
// The reading is in the pane (a list of the works, or a cite with its stepper); the Contents are the chapters of the work that is
// open and the way back to the list. Routes: #/texts (the list), #/texts/<work>, #/texts/<work>/<stop>.
import { subjectName } from '../data/model';
import { workLens, worksByVoice, type TextChapter, type WorkLens } from '../data/texts';
import type { PassageRef } from '../data/corpus';
import { WalkRunner, type AppSnapshot, type WalkStep } from '../walk/runner';
import type { WorkKind } from '../types/works';
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { quote } from '../ui/quote';
import type { LensContext, LensInstance } from '../shell/lens';
import type { ContentsGroup } from '../ui/deep';
import { paneStepper } from '../ui/pane';
import { tuneGlobe } from './ui';

/** The kinds as the picker names them. */
const KIND_LABEL: Record<WorkKind, string> = {
  'collected-volume': 'Collected works',
  seminar: 'Seminars',
  lectures: 'Lectures',
  book: 'Books',
  anthology: 'Anthologies',
  letters: 'Letters',
  memoir: 'Memoirs',
  manuscript: 'Manuscripts',
  secondary: 'Studies',
  deck: 'Decks',
  dictionary: 'Dictionaries',
};

/** The chapter a stop falls in, the narrowest (deepest) one that holds it. */
export function chapterOfStop(contents: readonly TextChapter[], i: number): TextChapter | undefined {
  let best: TextChapter | undefined;
  for (const c of contents) if (c.from <= i && i < c.to && (!best || c.level >= best.level)) best = c;
  return best;
}

export function mount(ctx: LensContext): LensInstance {
  const m = ctx.model;
  const runner = new WalkRunner({ scale: m.scale });
  let tok = 0;
  let finished = '';

  /** A reading of this lens, held for the pane; `reveal` brings it up now (a work's cite is read at once, the list only when asked for). */
  const show = (key: string, nodes: Node[], foot: Node[] | null = null, reveal = true) => {
    ctx.pane.load({ key: `texts/${key}`, eyebrow: 'Texts', nodes, foot });
    if (reveal) ctx.pane.reveal();
  };
  /** What the Contents list shows: the open work's chapters (the one the walk stands in marked), and the way back to the list of texts. */
  let standing: { wl: WorkLens; i: number } | null = null;
  const contents = (): ContentsGroup[] => {
    const groups: ContentsGroup[] = [];
    if (standing && standing.wl.contents.length) {
      const { wl, i } = standing;
      const here = chapterOfStop(wl.contents, i);
      const last = Math.max(0, (wl.walk?.stops.length ?? 1) - 1);
      groups.push({
        title: wl.title,
        items: wl.contents.map((c) => ({
          label: c.title, level: Math.max(0, c.level - 1), note: c.to > c.from ? String(c.to - c.from) : undefined, current: c === here,
          onPick: () => ctx.setPath([wl.id, String(Math.min(c.from, last))], { replace: true }),
        })),
      });
    }
    if (standing) { groups.push({ title: 'Another text', items: [{ label: 'The list of texts', onPick: () => ctx.setPath([]) }] }); return groups; }
    // at the list itself the Contents are the works, by voice and kind
    for (const g of worksByVoice(m)) {
      for (const k of g.kinds) groups.push({ title: `${g.voice} · ${KIND_LABEL[k.kind] ?? k.kind}`, items: k.works.map((w) => ({ label: w.title, note: w.year ? String(w.year) : undefined, onPick: () => ctx.setPath([w.id]) })) });
    }
    return groups;
  };

  const snapshot = (): AppSnapshot => ({ u: ctx.time.cursorU, focus: null, reading: null, centre: null, walk: null });

  // ── the picker: every Work once, grouped by voice and kind ────────────
  const picker = () => {
    runner.interrupt();
    ctx.setContext('');
    ctx.engine.setEmphasis(null, null);
    standing = null;
    const nodes: HTMLElement[] = [el('h2', { class: 'dp-title', text: 'Texts' })];
    for (const g of worksByVoice(m)) {
      nodes.push(el('h3', { class: 'as-h3', text: g.voice }));
      for (const k of g.kinds) {
        nodes.push(el('p', { class: 'tx-kind', text: KIND_LABEL[k.kind] ?? k.kind }));
        nodes.push(el('div', { class: 'tx-works' }, k.works.map((w) => el('button', { type: 'button', class: 'th-link', 'data-work': w.id, onclick: () => ctx.setPath([w.id]) }, [
          el('span', {}, [el('span', { class: 'as-tie-name', text: w.title }), w.year ? el('span', { class: 'as-basis', text: String(w.year) }) : null]),
          icon('next', 14),
        ]))));
      }
    }
    show('list', nodes, null, false);
  };

  // ── a work ────────────────────────────────────────────────────────────
  const step = (wl: WorkLens, s: WalkStep, host: HTMLElement, pageTok: number) => {
    const chapter = chapterOfStop(wl.contents, s.i);
    host.replaceChildren();
    const occId = s.stop.subject?.type === 'occurrence' ? s.stop.subject.id : undefined;
    const oi = occId ? m.occIndex.get(occId) : undefined;
    if (chapter) host.append(el('p', { class: 'tx-chapter', text: chapter.title }));
    if (oi !== undefined) {
      host.append(el('button', { type: 'button', class: 'link-quiet tx-occ', text: m.occ[oi].label, title: 'Open this instance', onclick: () => ctx.openOccurrence(occId!) }));
    }
    // a stop with no cite of its own opens the page it stands on
    const workKey = s.stop.cite?.work ?? s.stop.page?.work;
    const where = s.stop.cite?.locator ?? (s.stop.page ? `pdf p${s.stop.page.page}` : '');
    if (!workKey || !where) return;
    const cite = { work: workKey, locator: where };
    const paint = (ref: PassageRef | null) => {
      if (pageTok !== tok) return;
      const spec = { text: ref?.text ?? '', cite: { work: cite.work, workTitle: wl.title, locator: where, ...(ref?.print ? { print: ref.print } : {}) } };
      if (!ref) { host.append(el('p', { class: 'lp-note tx-cite', text: `${wl.title} · ${where}` })); return; }
      host.append(quote(spec, { passages: ctx.passages, emphasis: 'compact' }));
      if (ref.para !== undefined && ref.text !== ref.pageText) {
        host.append(el('details', { class: 'as-more tx-page' }, [el('summary', { text: `The whole page — pdf p${ref.page}` }), el('p', { class: 'ps-text', text: ref.pageText })]));
      }
    };
    if (ctx.passages.read) void ctx.passages.read(cite.work, cite.locator).then(paint, () => paint(null));
    else paint(null);
  };

  const work = (key: string, at: number) => {
    const wl = workLens(m, key);
    if (!wl) { picker(); return; }
    const w = m.workById.get(wl.id)!;
    const myTok = ++tok;
    ctx.setContext(wl.title);
    ctx.engage('open', { type: 'work', id: wl.id });
    tuneGlobe(ctx, [...wl.scope].filter((i) => m.located[i]), undefined, wl.title);

    const stepHost = el('div', { class: 'tx-step' });
    const walk = wl.walk;
    const go = (to: number) => ctx.setPath([wl.id, String(to)], { replace: true });

    const nodes: Node[] = [
      el('h2', { class: 'dp-title', text: wl.title }),
      el('p', { class: 'th-line', text: [wl.voice, wl.year ? String(wl.year) : ''].filter(Boolean).join(' · ') }),
      el('p', { class: 'tx-count', text: `${w.cites} ${w.cites === 1 ? 'cite' : 'cites'} in the field, from ${w.occurrences} ${w.occurrences === 1 ? 'instance' : 'instances'}` }),
      stepHost,
    ];

    let foot: Node[] | null = null;
    if (walk && walk.stops.length) {
      const stepNow = runner.active && runner.position?.walkId === walk.id ? runner.goto(at) : runner.start(walk, snapshot(), at);
      const s = stepNow ?? runner.start(walk, snapshot(), 0)!;
      standing = { wl, i: s.i };
      foot = paneStepper({ prev: 'Previous cite', next: 'Next cite' }, `${s.i + 1} / ${s.count}`, () => go(Math.max(0, s.i - 1)), () => go(Math.min(s.count - 1, s.i + 1)), { prev: s.first, next: s.last });
      step(wl, s, stepHost, myTok);
      if (s.effects.flyTo) ctx.engine.rig.flyTo(s.effects.flyTo.lat, s.effects.flyTo.lon, 2.8, { duration: 1.8 });
      // a walk read to its last page is noted once, for the visitor's own node
      if (s.last && finished !== walk.id) { finished = walk.id; ctx.engage('walk', { type: 'walk', id: walk.id }); }
    } else {
      stepHost.append(el('p', { class: 'lp-note', text: `${subjectName(m, { type: 'work', id: wl.id })} has no cite on a page of its own volume to walk through.` }));
    }
    if (!standing || standing.wl !== wl) standing = { wl, i: at };
    show(`${wl.id}/${standing.i}`, nodes, foot);
  };

  return {
    enter(path) {
      const [key, at] = path;
      ctx.pane.contents('Texts', contents);
      if (!key) { picker(); return; }
      const n = Number(at);
      work(key, Number.isInteger(n) && n >= 0 ? n : 0);
    },
    leave() {
      standing = null;
      tok++;
      runner.interrupt();
      finished = '';
      ctx.engine.setEmphasis(null, null);
    },
  };
}
