// A compact graph settings space, away from the history scrubber. Filters first, then the layout's four forces in one
// quiet disclosure (closed by default). The crumb, the mode pill and G already take the person out of the graph, so
// the sheet does not repeat them.
import { el } from '../ui/dom';
import type { TieBasis } from '../types/field';
import { DEFAULT_FORCES, FORCE_ROWS, type Forces } from './forces';

export interface ToolHandlers {
  onDepth(depth: number): void;
  onDust(on: boolean): void;
  onTies(bases: TieBasis[]): void;
  /** all four forces, as the person set them: applied to the live layout */
  onForces(forces: Forces): void;
  onSky(on: boolean): void;
  onFit(): void;
}

export interface ToolState {
  local: boolean;
  depth: number;
  dust: boolean;
  ties: TieBasis[];
  /** the layout's four forces, as set */
  forces: Forces;
  /** the sky's bodies hung from the graph: off by default */
  sky: 'off' | 'loading' | 'on' | 'unavailable';
  /** when the standing sky is, in words — shown while the anchors are on */
  skyAsOf?: string;
}

export class GraphTools {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private toggle: HTMLButtonElement;
  private depthWrap: HTMLElement;
  private depthN: HTMLElement;
  private minus: HTMLButtonElement;
  private plus: HTMLButtonElement;
  private dust: HTMLButtonElement;
  private ties = new Map<TieBasis, HTMLButtonElement>();
  private sky: HTMLButtonElement;
  private skyNote: HTMLElement;
  private forceIn = new Map<keyof Forces, HTMLInputElement>();
  private forceN = new Map<keyof Forces, HTMLElement>();
  private state: ToolState = { local: false, depth: 1, dust: true, ties: ['jung', 'inferred', 'site'], sky: 'off', forces: { ...DEFAULT_FORCES } };

  constructor(h: ToolHandlers) {
    this.minus = el('button', { class: 'gvt-step', type: 'button', 'aria-label': 'Fewer steps from the subject', text: '−', onclick: () => h.onDepth(this.state.depth - 1) }) as HTMLButtonElement;
    this.plus = el('button', { class: 'gvt-step', type: 'button', 'aria-label': 'More steps from the subject', text: '+', onclick: () => h.onDepth(this.state.depth + 1) }) as HTMLButtonElement;
    this.depthN = el('span', { class: 'gvt-n' });
    this.depthWrap = el('div', { class: 'gvt-row', role: 'group', 'aria-label': 'Depth of the local graph' }, [el('span', { text: 'Steps' }), el('span', { class: 'gvt-depth' }, [this.minus, this.depthN, this.plus])]);
    this.dust = el('button', { class: 'gvt-option', type: 'button', 'aria-pressed': 'true', onclick: () => h.onDust(!this.state.dust) }) as HTMLButtonElement;
    const tieGroup = el('div', { class: 'gvt-ties', role: 'group', 'aria-label': 'Family to archetype relations' });
    for (const [basis, label] of [['jung', 'Jung'], ['inferred', 'Inferred'], ['site', 'Read here']] as const) {
      const button = el('button', { class: 'gvt-filter', type: 'button', text: label, 'aria-pressed': 'true', onclick: () => h.onTies(this.state.ties.includes(basis) ? this.state.ties.filter((b) => b !== basis) : [...this.state.ties, basis]) }) as HTMLButtonElement;
      this.ties.set(basis, button);
      tieGroup.append(button);
    }
    this.sky = el('button', { class: 'gvt-option gvt-sky', type: 'button', text: 'Sky anchors', 'aria-pressed': 'false',
      onclick: () => h.onSky(this.state.sky === 'off' || this.state.sky === 'unavailable') }) as HTMLButtonElement;
    this.skyNote = el('p', { class: 'gvt-caption gvt-sky-note', role: 'status', 'aria-live': 'polite' });
    this.skyNote.hidden = true;
    // the four forces: one quiet disclosure, closed. Each slider re-sets the live layout in place; the tooltip says what it does.
    const forces = el('details', { class: 'gvt-forces' }, [el('summary', { class: 'gvt-caption', text: 'Forces' })]);
    for (const row of FORCE_ROWS) {
      const input = el('input', { type: 'range', class: 'gvt-range', min: String(row.min), max: String(row.max), step: String(row.step), 'aria-label': `${row.label}: ${row.tip}`, title: row.tip }) as HTMLInputElement;
      const out = el('span', { class: 'gvt-n' });
      input.addEventListener('input', () => h.onForces({ ...this.state.forces, [row.key]: Number(input.value) }));
      this.forceIn.set(row.key, input);
      this.forceN.set(row.key, out);
      forces.append(el('div', { class: 'gvt-row', title: row.tip }, [el('span', { text: row.label }), out, input]));
    }
    const fit = el('button', { class: 'gvt-option', type: 'button', text: 'Reframe graph', onclick: () => { h.onFit(); this.close(); } });
    this.panel = el('section', { class: 'gvt-panel', id: 'graph-settings', 'aria-label': 'Graph settings' }, [
      this.dust,
      el('div', { class: 'gvt-rels' }, [el('span', { class: 'gvt-caption', text: 'Relations' }), tieGroup]),
      this.sky, this.skyNote,
      this.depthWrap,
      forces,
      fit,
    ]);
    this.panel.hidden = true;
    this.toggle = el('button', { class: 'gvt-link gvt-settings', type: 'button', text: 'Settings', 'aria-expanded': 'false', 'aria-controls': 'graph-settings', onclick: () => this.setOpen(this.panel.hidden) }) as HTMLButtonElement;
    this.root = el('nav', { class: 'gv-tools', 'aria-label': 'Graph' }, [this.toggle, this.panel]);
    // Safari does not focus buttons on pointer click, so Escape must also work
    // when the settings were opened with a pointer and focus remains on the canvas.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) {
        e.preventDefault(); e.stopPropagation(); this.close(); this.toggle.focus();
      }
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) this.close();
    }, { capture: true });
    document.addEventListener('pointerdown', (e) => {
      if (!this.panel.hidden && !this.root.contains(e.target as Node)) this.close();
    });
    this.render();
  }

  private setOpen(open: boolean) {
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
  }

  close() { this.setOpen(false); }

  setState(s: ToolState) {
    this.state = s;
    this.render();
  }

  private render() {
    const s = this.state;
    this.depthWrap.hidden = !s.local;
    this.depthN.textContent = String(s.depth);
    this.minus.disabled = s.depth <= 1;
    this.plus.disabled = s.depth >= 3;
    this.dust.textContent = 'Occurrences';
    this.dust.setAttribute('aria-pressed', String(s.dust));
    for (const [basis, button] of this.ties) button.setAttribute('aria-pressed', String(s.ties.includes(basis)));
    for (const row of FORCE_ROWS) {
      const v = s.forces[row.key];
      const input = this.forceIn.get(row.key);
      if (input) input.value = String(v);
      const out = this.forceN.get(row.key);
      if (out) out.textContent = `${v.toFixed(2)}×`;
    }
    this.sky.setAttribute('aria-pressed', String(s.sky === 'on' || s.sky === 'loading'));
    this.sky.disabled = s.sky === 'loading';
    const note = s.sky === 'on' ? `Bodies stand at their geocentric ecliptic longitudes, ${s.skyAsOf ?? 'now'}. In a local graph they are ordinary neighbours.`
      : s.sky === 'loading' ? 'Loading the sky…'
      : s.sky === 'unavailable' ? 'The sky’s data is unavailable.' : '';
    this.skyNote.textContent = note;
    this.skyNote.hidden = !note;
    this.root.classList.toggle('is-local', s.local);
  }
}
