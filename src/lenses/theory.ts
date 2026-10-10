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
interface TheoryData { version: 1; sections: TheorySection[] }

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

  const render = (id: string) => {
    if (!data) return;
    const sections = data.sections;
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

