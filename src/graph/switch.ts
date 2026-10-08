// The one mode control: Earth ⇄ Graph, a small pill of two glyphs beside the search glyph (and the key G).
import { el } from '../ui/dom';

const GLOBE = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.15"/><ellipse cx="8" cy="8" rx="2.5" ry="5.6" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.6 6.4h10.8M2.6 9.6h10.8" stroke="currentColor" stroke-width="1" fill="none"/></svg>';
const GRAPH = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 8L3.2 4.4M8 8l5 -3.4M8 8l-1.2 5.2M8 8l4.4 4" stroke="currentColor" stroke-width="1" stroke-linecap="round" fill="none"/><circle cx="8" cy="8" r="2.3" fill="currentColor"/><circle cx="3.2" cy="4.2" r="1.45" fill="currentColor"/><circle cx="13.2" cy="4.4" r="1.45" fill="currentColor"/><circle cx="6.8" cy="13.4" r="1.45" fill="currentColor"/><circle cx="12.6" cy="12.2" r="1.45" fill="currentColor"/></svg>';

export class ModeSwitch {
  readonly root: HTMLButtonElement;

  constructor(parent: HTMLElement, private onToggle: () => void) {
    this.root = el('button', {
      class: 'mode-switch', type: 'button', role: 'switch', 'aria-checked': 'false',
      'aria-label': 'Graph view (press G)', title: 'Earth ⇄ Graph  (G)',
      onclick: () => this.onToggle(),
    }) as HTMLButtonElement;
    const thumb = el('span', { class: 'ms-thumb', 'aria-hidden': 'true' });
    const earth = el('span', { class: 'ms-ico ms-earth' });
    earth.innerHTML = GLOBE;
    const graph = el('span', { class: 'ms-ico ms-graph' });
    graph.innerHTML = GRAPH;
    this.root.append(thumb, earth, graph);
    parent.append(this.root);
  }

  set(graph: boolean) {
    this.root.setAttribute('aria-checked', String(graph));
    this.root.classList.toggle('is-graph', graph);
    document.body.classList.toggle('mode-graph', graph);
    document.body.dataset.mode = graph ? 'graph' : 'earth';
  }
}
