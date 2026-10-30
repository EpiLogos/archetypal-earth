// The visitor's own page, in the smallest form that is honest: what is kept in this browser, and the plain list of what has
// been recorded about what they opened, with the switch that stops the recording. It reads the practice store and nothing
// else, and shows what the store holds to the person it belongs to; none of it goes anywhere (MODES-RFC §8).
import type { Model } from '../data/model';
import { subjectName } from '../data/model';
import type { PracticeStore, Engagement } from '../practice/store';
import { clear, el } from './dom';
import { closeGlyph } from './reveal';

export interface YouHandlers {
  onClose(): void;
  /** open one of the practice lenses ('dreams' | 'coincidences' | 'astrology') */
  onLens(id: 'dreams' | 'coincidences' | 'astrology'): void;
  /** open a subject the log names */
  onSubject(subject: { type: string; id: string }): void;
}

const SHOWN = 40;
const VERB: Record<Engagement['kind'], string> = { open: 'Opened', walk: 'Walked', dream: 'Wrote down', symbol: 'Looked up', coincidence: 'Logged', chart: 'Cast' };

/** What an engagement's subject is called: a registry name, or the plain word for one of the person's own records. */
export function engagementName(m: Model, s: { type: string; id: string }): string {
  if (s.type === 'archetype' || s.type === 'theoretic' || s.type === 'family' || s.type === 'work' || s.type === 'person') return subjectName(m, { type: s.type, id: s.id });
  if (s.type === 'occurrence') { const i = m.occIndex.get(s.id); return i === undefined ? 'an instance' : m.occ[i].label; }
  if (s.type === 'walk') return m.walkById.get(s.id)?.title ?? 'a walk';
  return `a ${s.type}`;
}

export class YouSheet {
  readonly root: HTMLElement;
  private article: HTMLElement;
  private scroller: HTMLElement;
  private open = false;
  private off: (() => void) | null = null;

  constructor(parent: HTMLElement, private model: Model, private store: PracticeStore, private h: YouHandlers) {
    this.article = el('article', { class: 'dp-article' });
    this.scroller = el('div', { class: 'dp-scroll', tabindex: 0 }, [this.article]);
    this.root = el('section', { class: 'deep you-sheet', role: 'dialog', 'aria-label': 'You', 'aria-modal': 'false' }, [
      el('button', { class: 'dp-close', type: 'button', 'aria-label': 'Close', onclick: () => h.onClose() }, [closeGlyph()]),
      this.scroller,
    ]);
    this.root.hidden = true;
    parent.append(this.root);
  }

  get isOpen() {
    return this.open;
  }

  show() {
    this.root.hidden = false;
    this.render();
    this.scroller.scrollTop = 0;
    requestAnimationFrame(() => this.root.classList.add('on'));
    this.open = true;
    document.body.classList.add('deep-open');
    // the page follows the store while it stands (a forgotten line, the switch)
    this.off?.();
    this.off = this.store.onChange(() => { if (this.open) this.render(); });
    this.scroller.focus({ preventScroll: true });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.off?.();
    this.off = null;
    this.root.classList.remove('on');
    document.body.classList.remove('deep-open');
    window.setTimeout(() => { if (!this.open) this.root.hidden = true; }, 420);
  }

  private render() {
    const a = this.article;
    const s = this.store;
    const keep = this.scroller.scrollTop;
    clear(a);
    a.append(
      el('h2', { class: 'dp-title', text: 'You' }),
      el('p', { class: 'dp-lede', text: 'What you have written, charted and opened here. It is kept in this browser and goes nowhere else.' }),
    );
    const counts: [string, number, 'dreams' | 'coincidences' | 'astrology'][] = [
      ['Dreams', s.list('dreams').length, 'dreams'],
      ['Coincidences', s.list('coincidences').length, 'coincidences'],
      ['Charts', s.list('charts').length, 'astrology'],
    ];
    a.append(el('h3', { class: 'dp-sub', text: 'Kept' }));
    const kept = el('ul', { class: 'you-kept' });
    for (const [label, n, lens] of counts) {
      kept.append(el('li', {}, [
        el('button', { type: 'button', class: 'link-quiet', text: label, onclick: () => this.h.onLens(lens) }),
        el('span', { class: 'you-n', text: n ? String(n) : 'none yet' }),
      ]));
    }
    a.append(kept);

    const log = s.engagements();
    a.append(el('h3', { class: 'dp-sub', text: 'What has been recorded' }));
    a.append(el('p', { class: 'you-note', text: s.recording
      ? 'Each page you open, walk you finish and symbol you look up is noted here, so the field can show where you have been. It stays on this device.'
      : 'Recording is off. Nothing new is being noted.' }));
    a.append(el('div', { class: 'you-acts' }, [
      el('button', { type: 'button', class: 'lp-btn quiet', text: s.recording ? 'Stop recording' : 'Record again', onclick: () => s.setRecording(!s.recording) }),
      log.length ? el('button', { type: 'button', class: 'lp-btn quiet', text: 'Clear the list', onclick: () => s.clearEngagements() }) : null,
    ]));
    if (!log.length) a.append(el('p', { class: 'you-note', text: 'Nothing recorded yet.' }));
    else {
      const ul = el('ul', { class: 'you-log' });
      for (const e of log.slice(0, SHOWN)) {
        const name = engagementName(this.model, e.subject);
        const openable = ['archetype', 'theoretic', 'family', 'work', 'person', 'occurrence'].includes(e.subject.type);
        ul.append(el('li', {}, [
          el('span', { class: 'you-verb', text: VERB[e.kind] }),
          openable ? el('button', { type: 'button', class: 'link-quiet', text: name, onclick: () => this.h.onSubject(e.subject) }) : el('span', { text: name }),
          el('button', { type: 'button', class: 'you-forget', 'aria-label': `Forget: ${VERB[e.kind]} ${name}`, text: '×', onclick: () => s.forgetEngagement(e.id) }),
        ]));
      }
      a.append(ul);
      if (log.length > SHOWN) a.append(el('p', { class: 'you-note', text: `and ${log.length - SHOWN} earlier` }));
    }
    this.scroller.scrollTop = keep;
  }
}
