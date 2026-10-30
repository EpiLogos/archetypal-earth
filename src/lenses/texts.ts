// TEXTS: a text is a lens. One module, a Work as its subject. Entered from anywhere a work is named (a cite, search, a graph
// node, a person's page, Contents), it takes the work's name as its title, its chapters as Contents, the occurrences that cite
// it as its scope on the globe and its page-ordered walk as the way through it. CW9ii and Liber Novus keep their own lenses:
// the controller hands those two to Aion and the Red Book before this module is reached (`Controller.lensRoute`).
// Everything the lens shows is derived by src/data/texts.ts and the walk runner; nothing is authored here.
// Routes: #/texts (the picker), #/texts/<work>, #/texts/<work>/<stop>.
import { subjectName } from '../data/model';
import { workLens, worksByVoice, type TextChapter, type WorkLens } from '../data/texts';
import type { PassageRef } from '../data/corpus';
import { WalkRunner, type AppSnapshot, type WalkStep } from '../walk/runner';
import type { WorkKind } from '../types/works';
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { quote } from '../ui/quote';
import type { LensContext, LensInstance } from '../shell/lens';
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

  const show = (nodes: Node[], foot: Node[] | null = null) => {
    if (ctx.panel.isOpen) ctx.panel.replace(nodes as HTMLElement[], { foot });
    else ctx.panel.open('Texts', nodes, { foot });
  };

  const snapshot = (): AppSnapshot => ({ u: ctx.time.cursorU, focus: null, reading: null, centre: null, walk: null });

  // ── the picker: every Work once, grouped by voice and kind ────────────
  const picker = () => {
    runner.interrupt();
    ctx.setContext('');
    ctx.engine.setEmphasis(null, null);
    const nodes: HTMLElement[] = [el('h2', { class: 'lp-h', text: 'Texts' })];
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
    show(nodes);
    ctx.panel.reveal();
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
    const counter = el('span', { class: 'th-count' });
    const walk = wl.walk;
    const go = (to: number) => ctx.setPath([wl.id, String(to)], { replace: true });

    const contents = wl.contents.length
      ? el('ol', { class: 'tx-contents', 'aria-label': 'Contents' }, wl.contents.map((c) => {
        const hasStops = c.to > c.from;
        return el('li', { class: 'tx-chap', style: `--lvl:${Math.max(0, c.level - 1)}` }, [
          hasStops
            ? el('button', { type: 'button', class: 'link-quiet', text: c.title, onclick: () => go(c.from) })
            : el('span', { class: 'tx-chap-bare', text: c.title }),
          hasStops ? el('span', { class: 'tx-chap-n', text: String(c.to - c.from) }) : null,
        ]);
      }))
      : null;

    const nodes: Node[] = [
      el('button', { type: 'button', class: 'link-quiet am-back', onclick: () => ctx.setPath([]) }, [icon('back', 13), el('span', { text: 'Another text' })]),
      el('h2', { class: 'lp-h', text: wl.title }),
      el('p', { class: 'lp-sub', text: [wl.voice, wl.year ? String(wl.year) : ''].filter(Boolean).join(' · ') }),
      el('p', { class: 'tx-count', text: `${w.cites} ${w.cites === 1 ? 'cite' : 'cites'} in the field, from ${w.occurrences} ${w.occurrences === 1 ? 'instance' : 'instances'}` }),
      stepHost,
    ];
    if (contents) nodes.push(el('h3', { class: 'as-h3', text: 'Contents' }), contents);

    let foot: Node[] | null = null;
    if (walk && walk.stops.length) {
      const stepNow = runner.active && runner.position?.walkId === walk.id ? runner.goto(at) : runner.start(walk, snapshot(), at);
      const s = stepNow ?? runner.start(walk, snapshot(), 0)!;
      const prev = el('button', { type: 'button', 'aria-label': 'Previous cite', onclick: () => go(Math.max(0, s.i - 1)) }, [icon('back', 14)]) as HTMLButtonElement;
      const next = el('button', { type: 'button', 'aria-label': 'Next cite', onclick: () => go(Math.min(s.count - 1, s.i + 1)) }, [icon('next', 14)]) as HTMLButtonElement;
      prev.disabled = s.first;
      next.disabled = s.last;
      counter.textContent = `${s.i + 1} / ${s.count}`;
      foot = [el('div', { class: 'th-step' }, [prev, counter, next])];
      step(wl, s, stepHost, myTok);
      if (s.effects.flyTo) ctx.engine.rig.flyTo(s.effects.flyTo.lat, s.effects.flyTo.lon, 2.8, { duration: 1.8 });
      // a walk read to its last page is noted once, for the visitor's own node
      if (s.last && finished !== walk.id) { finished = walk.id; ctx.engage('walk', { type: 'walk', id: walk.id }); }
    } else {
      stepHost.append(el('p', { class: 'lp-note', text: `${subjectName(m, { type: 'work', id: wl.id })} has no cite on a page of its own volume to walk through.` }));
    }
    show(nodes, foot);
    ctx.panel.reveal();
  };

  return {
    enter(path) {
      const [key, at] = path;
      if (!key) { picker(); return; }
      const n = Number(at);
      work(key, Number.isInteger(n) && n >= 0 ? n : 0);
    },
    leave() {
      tok++;
      runner.interrupt();
      finished = '';
      ctx.engine.setEmphasis(null, null);
    },
  };
}
