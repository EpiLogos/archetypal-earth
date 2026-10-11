// The landing (MODES-RFC §6): the globe is the landing. Once the field is drawn, a short line of mine and one action
// appear over it; the action flies to the Self, the centre every lens starts from. Shown once per browser; touching the
// globe or pressing Escape simply lets it go. No image, no menu of choices, nothing before the field is seen.
import { el } from '../ui/dom';
import { icon } from '../ui/icons';

const SEEN = 'aae.landing.seen';

export const LANDING_COPY = 'I built this to see Jung’s whole field in one place: every archetype, symbol and instance he wrote about, set where and when it appeared and cited to the page. Everything in it connects back to one centre, which Jung called the Self. That’s where it starts.';

function seen(): boolean {
  try { return localStorage.getItem(SEEN) === '1'; } catch { return false; }
}

function remember() {
  try { localStorage.setItem(SEEN, '1'); } catch { /* private mode: it shows again next time, which is harmless */ }
}

export class Landing {
  private root: HTMLElement | null = null;

  /** Show the landing if this browser has not seen it; `onStart` flies to the Self. Returns whether it showed. */
  maybeShow(parent: HTMLElement, onStart: () => void): boolean {
    if (seen()) return false;
    const start = el('button', { type: 'button', class: 'ld-start', onclick: () => { this.dismiss(); onStart(); } }, [icon('self', 17), el('span', { text: 'Start at the Self' })]);
    this.root = el('section', { class: 'landing', 'aria-label': 'Welcome' }, [el('p', { class: 'ld-copy', text: LANDING_COPY }), start]);
    parent.append(this.root);
    document.body.classList.add('landing-on');
    // the line arrives after the field has had a moment on its own
    window.setTimeout(() => this.root?.classList.add('on'), 900);
    window.addEventListener('keydown', this.onKey, true);
    start.focus({ preventScroll: true });
    return true;
  }

  get showing(): boolean {
    return !!this.root;
  }

  /** Let the landing go (an action, a touch on the globe, Escape). It does not come back in this browser. */
  dismiss() {
    if (!this.root) return;
    remember();
    const node = this.root;
    this.root = null;
    document.body.classList.remove('landing-on');
    window.removeEventListener('keydown', this.onKey, true);
    node.classList.remove('on');
    window.setTimeout(() => node.remove(), 600);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); this.dismiss(); }
  };
}
