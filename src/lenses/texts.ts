// TEXTS: a text is a lens. One module, a Work as its subject. Entered from anywhere a work is named (a cite, search, a graph
// node, a person's page, Contents), it takes the work's name as its title, the occurrences that cite it as its scope on the
// globe, and reads it as an archetype is read (owner, 1 Nov 2026): the work and whose it is, then the instances it attests,
// each linking back to it. The text itself is not on the site: no chapters of the pdf, no pages, no read-through.
// CW9ii and Liber Novus keep their own lenses: the controller hands those two to Aion and the Red Book before this module is
// reached (`Controller.lensRoute`). Everything the lens shows is derived by src/data/texts.ts; nothing is authored here.
// The reading is in the pane (the list of the works, or one work's page); the Contents are the works, the open one marked.
// Routes: #/texts (the list), #/texts/<work>.
import { workLens, worksByVoice, workInstances } from '../data/texts';
import { plates } from '../data/plates';
import type { Model } from '../data/model';
import type { Work, WorkKind } from '../types/works';
import { el, plate } from '../ui/dom';
import type { LensContext, LensInstance } from '../shell/lens';
import { workPage, type ContentsGroup } from '../ui/deep';
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

/** The picture a Work is shown by in a list: the first of its instances that has one. */
export function workPlate(m: Model, w: Work): ReturnType<typeof plates> | undefined {
  for (const i of workInstances(m, w.id)) {
    const pl = plates(m, { type: 'occurrence', id: m.occ[i].id });
    if (pl.image) return pl;
  }
  return undefined;
}

export function mount(ctx: LensContext): LensInstance {
  const m = ctx.model;
  /** the Work whose page stands, '' at the list */
  let standing = '';

  /** A reading of this lens, held for the pane; `reveal` brings it up now (a work is read at once, the list only when asked for). */
  const show = (key: string, nodes: Node[], reveal: boolean) => {
    ctx.pane.load({ key: `texts/${key}`, eyebrow: 'Texts', nodes, foot: null });
    if (reveal) ctx.pane.reveal();
  };

  /** The Contents: every work with an instance, by voice and kind, each with its picture; the open one is marked. */
  const contents = (): ContentsGroup[] => worksByVoice(m).flatMap((g) => g.kinds.map((k) => ({
    title: `${g.voice} · ${KIND_LABEL[k.kind] ?? k.kind}`,
    items: k.works.map((w) => {
      const pl = workPlate(m, w);
      return {
        label: w.title,
        note: w.year ? String(w.year) : undefined,
        current: w.id === standing,
        ...(pl ? { plate: { image: pl.image, palette: pl.palette } } : {}),
        onPick: () => ctx.setPath([w.id]),
      };
    }),
  })));

  // ── the list: every Work with an instance, as rows with their pictures ───
  const picker = () => {
    standing = '';
    ctx.setContext('');
    ctx.engine.setEmphasis(null, null);
    const nodes: HTMLElement[] = [el('h2', { class: 'dp-title', text: 'Texts' })];
    for (const g of worksByVoice(m)) {
      for (const k of g.kinds) {
        nodes.push(el('h3', { class: 'dp-sub', text: `${g.voice} · ${KIND_LABEL[k.kind] ?? k.kind}` }));
        const ul = el('ul', { class: 'dp-rows' });
        for (const w of k.works) {
          const pl = workPlate(m, w);
          const open = () => ctx.setPath([w.id]);
          ul.append(el('li', { 'data-work': w.id }, [
            el('button', { class: 'dp-row-plate', type: 'button', tabindex: -1, 'aria-hidden': 'true', onclick: open }, [
              plate(pl?.image, { thumb: true, className: 'dp-row-img', palette: pl?.palette, alt: w.title }),
            ]),
            el('div', { class: 'dp-row-body' }, [
              el('button', { class: 'link-quiet dp-row-name', type: 'button', text: w.title, onclick: open }),
              w.year ? el('span', { class: 'dp-row-sub', text: String(w.year) }) : null,
            ]),
          ]));
        }
        nodes.push(ul);
      }
    }
    show('list', nodes, false);
  };

  // ── a work: its page, the globe tuned to its instances ─────────────────
  const work = (key: string) => {
    const wl = workLens(m, key);
    if (!wl) { picker(); return; }
    const entered = standing !== wl.id;
    standing = wl.id;
    ctx.setContext(wl.title);
    if (entered) ctx.engage('open', { type: 'work', id: wl.id });
    tuneGlobe(ctx, [...wl.scope].filter((i) => m.located[i]), undefined, wl.title);
    const nodes = workPage(m, wl.id, {
      onSubject: (s) => ctx.focus(s),
      onOccurrence: (id) => ctx.openOccurrence(id),
    });
    show(wl.id, nodes, true);
  };

  return {
    enter(path) {
      const [key] = path;
      ctx.pane.contents('Texts', contents);
      if (!key) { picker(); return; }
      work(key);
    },
    leave() {
      standing = '';
      ctx.engine.setEmphasis(null, null);
    },
  };
}
