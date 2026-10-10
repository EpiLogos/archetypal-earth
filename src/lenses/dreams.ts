// DREAMS (Thread 4): a private dream journal run on Jung's method. Record a dream and what was going on in your life;
// the images it names are picked out in the field's own names; each opens its amplification with the corpus's dreams
// and visions of that image first; then the question compensation asks: what does this dream add to the waking attitude?
// Everything stays in this browser (src/practice/store.ts). Routes name an entry by a random id, never its content:
// #/dreams, #/dreams/new, #/dreams/<id>, #/dreams/<id>/edit, #/dreams/<id>/<family>.
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { startThread, WORLD } from '../state/store';
import type { LensContext, LensInstance } from '../shell/lens';
import { passes } from '../shell/filter';
import { practice, saveFile, type PracticeRecord } from '../practice/store';
import { amplify, matchImages, vocabulary, type ImageMatch, type Vocabulary } from '../practice/amplify';
import { amplificationView, type AmplifyActions } from '../practice/amplify-view';
import { loadLensData, privacyLine, quoteBlock, tuneGlobe, type LensQuote } from './ui';

export interface DreamEntry extends PracticeRecord {
  date: string;
  title: string;
  text: string;
  /** what was going on in the dreamer's life: the context Jung always asked for first */
  context: string;
  /** the dreamer's own answer to the compensation question */
  answer: string;
}

interface PracticeData { dreams: { method: LensQuote[]; portrait: LensQuote; compensation: LensQuote[] } }

const today = () => new Date().toISOString().slice(0, 10);

export function mount(ctx: LensContext): LensInstance {
  const m = ctx.model;
  let vocab: Vocabulary | null = null;
  let framing: PracticeData | null = null;
  const voc = () => (vocab ??= vocabulary(m));
  const ok = (i: number) => passes(m.occ[i], ctx.filter());
  const ready = loadLensData<PracticeData>('practice').then((d) => { framing = d; }).catch(() => { framing = null; });

  const show = (label: string, nodes: (HTMLElement | null)[]) => {
    const list = nodes.filter((n): n is HTMLElement => !!n);
    if (ctx.panel.isOpen) ctx.panel.replace(list); else ctx.panel.open(label, list, { height: 'full' });
  };
  const entries = () => practice.list<DreamEntry>('dreams').sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const back = (text: string, path: string[]) => el('button', { type: 'button', class: 'link-quiet am-back', onclick: () => ctx.setPath(path) }, [icon('back', 13), el('span', { text })]);

  // ── the journal ──────────────────────────────────────────────────────
  const journal = () => {
    ctx.setContext('');
    ctx.engine.setEmphasis(null, null);
    const list = entries();
    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try { const r = practice.importAll(await f.text()); alert(`Read back ${r.added} entr${r.added === 1 ? 'y' : 'ies'}.`); journal(); } catch (err) { alert(err instanceof Error ? err.message : 'That file could not be read.'); }
    } });
    show('Dreams', [
      privacyLine(practice.persistent ? 'Your dreams are kept only in this browser’s storage.' : 'This browser is not letting the page store anything, so entries last only until you close the tab.'),
      el('p', { class: 'th-line', text: 'Write a dream down. The images in it that the field knows are picked out; each one opens onto the dreams and visions in the corpus that carry the same image. That is how Jung read a dream: by lining it up with its parallels.' }),
      el('div', { class: 'lp-row' }, [el('button', { type: 'button', class: 'lp-btn primary', onclick: () => ctx.setPath(['new']) }, [icon('plus', 14), el('span', { text: 'Record a dream' })])]),
      list.length ? el('ol', { class: 'dr-list' }, list.map((d) => el('li', {}, [el('button', { type: 'button', class: 'dr-row', onclick: () => ctx.setPath([d.id]) }, [
        el('span', { class: 'am-year', text: d.date }),
        el('span', { class: 'dr-title', text: d.title || d.text.slice(0, 60) || 'Untitled' }),
        el('span', { class: 'dr-n', text: `${matchImages(voc(), d.text).length} images` }),
      ])]))) : el('p', { class: 'lp-note', text: 'No dreams recorded yet.' }),
      framing ? el('details', { class: 'as-more' }, [el('summary', { text: 'How Jung read a dream' }), quoteBlock(framing.dreams.portrait, ctx.passages, { compact: true }), ...framing.dreams.method.map((q) => quoteBlock(q, ctx.passages, { compact: true }))]) : null,
      el('div', { class: 'lp-row as-own' }, [
        list.length ? el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => saveFile('my-journal.json', practice.exportAll()) }, [icon('export', 14), el('span', { text: 'Save a copy' })]) : null,
        el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => fileInput.click() }, [icon('download', 14), el('span', { text: 'Read a copy back' })]),
        list.length ? el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => { if (confirm('Delete every dream from this browser?')) { practice.wipe('dreams'); journal(); } } }, [icon('trash', 14), el('span', { text: 'Delete all' })]) : null,
        fileInput,
      ]),
    ]);
  };

  // ── recording and editing ────────────────────────────────────────────
  const editor = (d?: DreamEntry) => {
    ctx.setContext(d ? 'Change the dream' : 'A new dream');
    const date = el('input', { type: 'date', value: d?.date ?? today(), max: today() });
    const title = el('input', { type: 'text', value: d?.title ?? '', placeholder: 'A few words to find it by', maxlength: 80 });
    const text = el('textarea', { placeholder: 'Write the dream as you remember it, in the present tense if that helps.', rows: 9 });
    text.value = d?.text ?? '';
    const context = el('textarea', { placeholder: 'What was going on in your life when you had it?', rows: 4 });
    context.value = d?.context ?? '';
    const found = el('p', { class: 'lp-note dr-found' });
    const preview = () => {
      const hits = matchImages(voc(), text.value);
      found.textContent = hits.length ? `Images the field knows: ${[...new Set(hits.map((h) => h.text.toLowerCase()))].join(', ')}.` : 'Images the field knows will be picked out as you write.';
    };
    text.addEventListener('input', preview);
    preview();
    const save = (e: Event) => {
      e.preventDefault();
      if (!text.value.trim()) { text.focus(); return; }
      const stored = practice.put<DreamEntry>('dreams', { ...(d ?? {}), date: date.value || today(), title: title.value.trim(), text: text.value.trim(), context: context.value.trim(), answer: d?.answer ?? '' });
      ctx.setPath([stored.id]);
    };
    show('Record a dream', [
      back(d ? 'The dream' : 'The journal', d ? [d.id] : []),
      el('form', { class: 'dr-form', onsubmit: save }, [
        el('label', { class: 'lp-field' }, [el('span', { text: 'Date' }), date]),
        el('label', { class: 'lp-field' }, [el('span', { text: 'Title (optional)' }), title]),
        el('label', { class: 'lp-field' }, [el('span', { text: 'The dream' }), text]),
        found,
        el('label', { class: 'lp-field' }, [el('span', { text: 'Your life at the time' }), context]),
        el('div', { class: 'lp-row' }, [el('button', { type: 'submit', class: 'lp-btn primary' }, [icon('dreams', 14), el('span', { text: d ? 'Save' : 'Keep it' })])]),
      ]),
      privacyLine(),
    ]);
    window.setTimeout(() => text.focus({ preventScroll: true }), 50);
  };

  // ── a dream, read ────────────────────────────────────────────────────
  const marked = (txt: string, hits: ImageMatch[], open: (h: ImageMatch) => void): HTMLElement => {
    const p = el('div', { class: 'dr-text' });
    let at = 0;
    for (const h of hits) {
      if (h.start > at) p.append(txt.slice(at, h.start));
      p.append(el('button', { type: 'button', class: 'dr-img', title: 'Amplify this image', onclick: () => open(h) }, [txt.slice(h.start, h.end)]));
      at = h.end;
    }
    p.append(txt.slice(at));
    return p;
  };

  const dream = (d: DreamEntry) => {
    ctx.setContext(d.title || 'A dream');
    const hits = matchImages(voc(), d.text);
    const families = [...new Set(hits.filter((h) => h.target.type === 'family').map((h) => h.target.id))];
    // the globe: the corpus's dreams and visions of every image this dream names
    const idx = families.flatMap((f) => (amplify(m, f, ok)?.dreams ?? []));
    tuneGlobe(ctx, idx, families[0]);
    const openImage = (h: ImageMatch) => (h.target.type === 'family' ? ctx.setPath([d.id, h.target.id]) : ctx.focus({ type: 'archetype', id: h.target.id }));
    const answer = el('textarea', { rows: 4, placeholder: 'What attitude in your waking life might this dream be answering? What does it add that you leave out?' });
    answer.value = d.answer;
    const saved = el('span', { class: 'lp-note dr-saved', 'aria-live': 'polite' });
    answer.addEventListener('change', () => { practice.put<DreamEntry>('dreams', { ...d, answer: answer.value.trim() }); saved.textContent = 'Kept.'; });
    show('A dream', [
      back('The journal', []),
      el('p', { class: 'am-kicker', text: d.date }),
      el('h2', { class: 'lp-h', text: d.title || 'Untitled' }),
      marked(d.text, hits, openImage),
      hits.length ? el('p', { class: 'lp-note', text: 'The underlined words are images the field knows. Open one to see its parallels.' }) : el('p', { class: 'lp-note', text: 'None of the words in this dream is an image the field has a name for. Try the Symbols lens with your own word for an image.' }),
      hits.length ? el('div', { class: 'am-chips' }, [...new Map(hits.map((h) => [`${h.target.type}:${h.target.id}`, h])).values()].map((h) => el('button', { type: 'button', class: 'sf-pill', onclick: () => openImage(h) }, [h.target.type === 'family' ? m.famById.get(h.target.id)!.name : `${m.archById.get(h.target.id)!.name} (archetype)`]))) : null,
      d.context ? el('section', { class: 'am-sec' }, [el('h3', { class: 'as-h3', text: 'Your life at the time' }), el('p', { class: 'th-line', text: d.context })]) : null,
      el('section', { class: 'am-sec' }, [
        el('h3', { class: 'as-h3', text: 'What the dream adds' }),
        ...(framing ? framing.dreams.compensation.map((q) => quoteBlock(q, ctx.passages, { compact: true })) : []),
        el('label', { class: 'lp-field' }, [el('span', { text: 'Your answer (kept with the dream)' }), answer]),
        saved,
      ]),
      el('div', { class: 'lp-row as-own' }, [
        el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => ctx.setPath([d.id, 'edit']) }, [el('span', { text: 'Change' })]),
        el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => { if (confirm('Delete this dream from this browser?')) { practice.remove('dreams', d.id); ctx.setPath([]); } } }, [icon('trash', 14), el('span', { text: 'Delete' })]),
      ]),
    ]);
  };

  const image = (d: DreamEntry, familyId: string) => {
    const a = amplify(m, familyId, ok);
    if (!a) { dream(d); return; }
    ctx.setContext(`${a.family.name}, in ${d.title || 'the dream'}`);
    tuneGlobe(ctx, a.dreams.length ? a.dreams : a.instances, familyId);
    const act: AmplifyActions = {
      openOccurrence: (id) => ctx.openOccurrence(id),
      focusFamily: (id) => ctx.focus({ type: 'family', id }),
      focusArchetype: (id) => ctx.focus({ type: 'archetype', id }),
      walkFamily: (id) => ctx.navigate(startThread(WORLD, { type: 'family', id })),
      amplifyFamily: (id) => ctx.setPath([d.id, id]),
    };
    show('An image in the dream', [back(d.title || 'The dream', [d.id]), ...amplificationView(m, a, act, ctx.passages, { dreamFirst: true })]);
  };

  const route = (path: string[]) => {
    if (!path[0]) return journal();
    if (path[0] === 'new') return editor();
    const d = practice.get<DreamEntry>('dreams', path[0]);
    if (!d) return ctx.setPath([], { replace: true });
    if (path[1] === 'edit') return editor(d);
    if (path[1]) return image(d, path[1]);
    dream(d);
  };

  return {
    enter(path) { void ready.then(() => route(path)); },
    leave() { ctx.engine.setEmphasis(null, null); },
  };
}
