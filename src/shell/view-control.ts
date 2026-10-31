// THE VIEW CONTROL (H3): Earth | Graph | Sky, and ⚙. It is a readout of where the camera is (shell/view.ts reads the route and
// the sky camera's phase), and a click hands the controller the transition the gesture makes: this component never moves the
// camera. The segment that is shown is the one the camera stands at, named in words; the others are glyphs.
import { el } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { VIEWS, type View } from './view';

const LABEL: Record<View, string> = { earth: 'Earth', graph: 'Graph', sky: 'Sky' };
const ICON: Record<View, IconName> = { earth: 'field', graph: 'graph', sky: 'astrology' };
const TITLE: Record<View, string> = { earth: 'Earth', graph: 'Graph (G)', sky: 'Sky' };

export interface ViewHooks {
  /** a segment was clicked: the controller sends the camera the transition for it */
  onView(v: View): void;
  /** the ⚙ was clicked: the controller opens the settings of what is on screen */
  onSettings(): void;
}

export class ViewControl {
  readonly root: HTMLElement;
  /** the settings button: it stands at the corner beside the search (shell.setCornerTool) */
  readonly gearButton: HTMLButtonElement;
  private segs = new Map<View, HTMLButtonElement>();
  private current: View = 'earth';

  constructor(private h: ViewHooks) {
    this.gearButton = el('button', {
      type: 'button', class: 'vc-gear sh-corner-btn icon-btn', 'aria-label': 'View settings', title: 'View settings', hidden: true,
      onclick: () => this.h.onSettings(),
    }, [icon('gear', 15)]) as HTMLButtonElement;
    const group = el('div', { class: 'vc-segs', role: 'group', 'aria-label': 'View' });
    for (const v of VIEWS) {
      const b = el('button', {
        type: 'button', class: 'vc-seg', 'data-view': v, title: TITLE[v], 'aria-label': LABEL[v], 'aria-pressed': 'false',
        onclick: () => this.h.onView(v),
      }, [el('span', { class: 'vc-ico' }, [icon(ICON[v], 15)]), el('span', { class: 'vc-name', text: LABEL[v] })]) as HTMLButtonElement;
      this.segs.set(v, b);
      group.append(b);
    }
    this.root = el('div', { class: 'view-control' }, [group]);
    this.set('earth');
  }

  get view(): View {
    return this.current;
  }

  /** Show where the camera is. The body carries it too (`mode-graph`, `data-mode`), as the graph's own styles read it. */
  set(v: View, phase?: string) {
    this.current = v;
    for (const [id, b] of this.segs) {
      const on = id === v;
      b.setAttribute('aria-pressed', String(on));
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      b.classList.toggle('on', on);
    }
    this.root.dataset.view = v;
    if (phase) this.root.dataset.phase = phase; else delete this.root.dataset.phase;
    const graph = v === 'graph';
    document.body.classList.toggle('mode-graph', graph);
    document.body.dataset.mode = graph ? 'graph' : 'earth';
  }

  /**
   * The ⚙ shows only while something answers it. `own` is a lens's settings popover (the ⚙ is then its only way in, so a phone
   * keeps it); the graph's panel and a lens's Options stand on a phone's screen themselves.
   */
  setSettings(available: boolean, own = false) {
    this.gearButton.hidden = !available;
    if (own) this.gearButton.dataset.own = ''; else delete this.gearButton.dataset.own;
    document.body.classList.toggle('view-gear', own && available);
  }
}
