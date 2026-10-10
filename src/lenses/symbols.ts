// SYMBOLS (Thread 4): the amplification engine as a flow of its own. Any word → the image family the field knows it by →
// Jung's definition, the dated instances in order, the dreams and visions among them, what it expresses, what it is found
// with. Routes: #/symbols, #/symbols/<family>, #/symbols/archetype/<id>.
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { startThread, WORLD } from '../state/store';
import type { LensContext, LensInstance } from '../shell/lens';
import { passes } from '../shell/filter';
import { amplify, findImages, vocabulary, type Vocabulary } from '../practice/amplify';
import { amplificationView, type AmplifyActions } from '../practice/amplify-view';
import { loadLensData, quoteBlock, tuneGlobe, type LensQuote } from './ui';
import { DEEP_FIELDS, depthView, type DepthData } from './depth';

interface PracticeData { dreams: { method: LensQuote[] } }

export function mount(ctx: LensContext): LensInstance {
  const m = ctx.model;
  let vocab: Vocabulary | null = null;
  let framing: PracticeData | null = null;
  void loadLensData<PracticeData>('practice').then((d) => { framing = d; }).catch(() => { framing = null; });
  const voc = () => (vocab ??= vocabulary(m));
  const ok = (i: number) => passes(m.occ[i], ctx.filter());

  const act: AmplifyActions = {
    openOccurrence: (id) => ctx.openOccurrence(id),
    focusFamily: (id) => ctx.focus({ type: 'family', id }),
    focusArchetype: (id) => ctx.focus({ type: 'archetype', id }),
    walkFamily: (id) => ctx.navigate(startThread(WORLD, { type: 'family', id })),
    amplifyFamily: (id) => ctx.setPath([id]),
  };

  const show = (nodes: HTMLElement[]) => { if (ctx.panel.isOpen) ctx.panel.replace(nodes); else ctx.panel.open('Symbols', nodes); };

  const searchBox = (initial = '') => {
    const input = el('input', { type: 'search', value: initial, placeholder: 'A symbol: serpent, tower, rose, well…', 'aria-label': 'Find a symbol', autocomplete: 'off', enterkeyhint: 'search' });
    const results = el('div', { class: 'sy-results', role: 'list' });
    const run = () => {
      const hits = findImages(m, voc(), input.value);
      results.replaceChildren(...hits.map((t) => el('button', { type: 'button', class: 'th-link', role: 'listitem', onclick: () => ctx.setPath(t.type === 'family' ? [t.id] : ['archetype', t.id]) }, [
        el('span', {}, [el('span', { class: 'as-tie-name', text: t.type === 'family' ? m.famById.get(t.id)!.name : m.archById.get(t.id)!.name }), el('span', { class: 'as-basis', text: t.type === 'family' ? `${(m.famOcc.get(t.id) ?? []).length} instances` : 'archetype' })]),
        icon('next', 14),
      ])));
      if (input.value.trim() && !hits.length) results.append(el('p', { class: 'lp-note', text: `The field has no image by the name “${input.value.trim()}”. It holds the images Jung wrote about, under the names his texts use.` }));
    };
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = results.querySelector('button'); (first as HTMLButtonElement | null)?.click(); } });
    if (initial) run();
    return { node: el('div', { class: 'sy-search' }, [el('label', { class: 'lp-field' }, [el('span', { text: 'Find a symbol' }), input]), results]), input };
  };

  const home = () => {
    ctx.setContext('');
    ctx.engine.setEmphasis(null, null);
    const top = [...m.famOcc].sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([id]) => m.famById.get(id)!).filter(Boolean);
    const box = searchBox();
    show([
      el('p', { class: 'th-line', text: 'Name a symbol and see how it runs through the field: what Jung said it is, every dated instance of it, the dreams and visions it turns up in, and what it expresses.' }),
      box.node,
      el('h3', { class: 'as-h3', text: 'The images with the most instances' }),
      el('div', { class: 'am-chips' }, top.map((f) => el('button', { type: 'button', class: 'sf-pill', text: f.name, onclick: () => ctx.setPath([f.id]) }))),
      ...(framing ? [el('h3', { class: 'as-h3', text: 'The method' }), ...framing.dreams.method.map((q) => quoteBlock(q, ctx.passages, { compact: true }))] : []),
    ]);
    window.setTimeout(() => box.input.focus({ preventScroll: true }), 50);
  };

  const family = (id: string) => {
    const a = amplify(m, id, ok);
    if (!a) { home(); return; }
    ctx.setContext(a.family.name);
    tuneGlobe(ctx, a.instances, id);
    show([
      el('button', { type: 'button', class: 'link-quiet am-back', onclick: () => ctx.setPath([]) }, [icon('back', 13), el('span', { text: 'Another symbol' })]),
      ...amplificationView(m, a, act, ctx.passages),
    ]);
  };

  const deep = (id: string) => {
    ctx.setContext(m.archById.get(id)!.name);
    tuneGlobe(ctx, (m.archOcc.get(id) ?? []).filter(ok));
    loadLensData<DepthData>('depth').then((d) => {
      const entry = d.archetypes[id];
      if (!entry) { plainArchetype(id); return; }
      const nodes = [
        el('button', { type: 'button', class: 'link-quiet am-back', onclick: () => ctx.setPath([]) }, [icon('back', 13), el('span', { text: 'Another symbol' })]),
        ...depthView(m, entry, {
          amplifyFamily: (fid) => ctx.setPath([fid]),
          openOccurrence: (oid) => ctx.openOccurrence(oid),
          focus: () => ctx.focus({ type: 'archetype', id }),
          walk: () => ctx.navigate(startThread(WORLD, { type: 'archetype', id })),
        }, ctx.passages, ok),
      ];
      if (ctx.panel.isOpen) ctx.panel.replace(nodes); else ctx.panel.open('The deep field', nodes, { height: 'full', wide: true });
    }).catch(() => plainArchetype(id));
  };

  const archetype = (id: string) => {
    if (DEEP_FIELDS.has(id) && m.archById.has(id)) { deep(id); return; }
    plainArchetype(id);
  };

  const plainArchetype = (id: string) => {
    const arch = m.archById.get(id);
    if (!arch) { home(); return; }
    ctx.setContext(arch.name);
    tuneGlobe(ctx, (m.archOcc.get(id) ?? []).filter(ok));
    const nodes: (HTMLElement | null)[] = [
      el('button', { type: 'button', class: 'link-quiet am-back', onclick: () => ctx.setPath([]) }, [icon('back', 13), el('span', { text: 'Another symbol' })]),
      el('p', { class: 'am-kicker', text: 'archetype · known only through its images' }),
      el('h2', { class: 'lp-h', text: arch.name }),
      arch.definition ? el('blockquote', { class: 'lq' }, [el('p', { text: arch.definition.text }), el('footer', {}, [el('span', { class: 'lq-cite', text: arch.definition.cite })])]) : null,
      el('h3', { class: 'as-h3', text: 'Its images' }),
      el('div', { class: 'am-chips' }, arch.familyIds.slice(0, 24).map((fid) => el('button', { type: 'button', class: 'sf-pill', text: m.famById.get(fid)?.name ?? fid, onclick: () => ctx.setPath([fid]) }))),
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus({ type: 'archetype', id }) }, [el('span', { text: `${arch.name} on the globe` }), icon('next', 14)]),
    ];
    show(nodes.filter((n): n is HTMLElement => !!n));
  };

  return {
    enter(path) {
      if (path[0] === 'archetype' && path[1]) archetype(path[1]);
      else if (path[0]) family(path[0]);
      else home();
    },
    leave() { ctx.engine.setEmphasis(null, null); },
  };
}
