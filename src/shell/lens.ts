// The lens contract (docs/MODES-RFC.md §2): a lens is a plugin the shell lists and loads on first use.
// The four reading lenses over the globe (Field, Theory, Aion, Red Book) are driven by the controller's state;
// the panel lenses (Theory's text, Astrology and the practice tools) mount into the shell's panel.
import type { IconName } from '../ui/icons';
import type { Model, Subject } from '../data/model';
import type { GlobeEngine } from '../globe/engine';
import type { TimeModel } from '../state/timeModel';
import type { AppState, PanelLensId } from '../state/store';
import type { PassageBridge } from '../ui/passage';
import type { FieldFilter } from './filter';
import type { Panel } from './panel';

export type LensId = 'field' | 'theory' | 'aion' | 'redbook' | PanelLensId;

export interface LensDef {
  id: LensId;
  label: string;
  icon: IconName;
  group: 'read' | 'practice';
  /** one plain line in the menu */
  blurb: string;
  /** the keyboard shortcut, shown in the menu */
  key?: string;
}

/** The two pieces of the shell's chrome a lens may fill: its context line and its own few controls. */
export interface LensChrome {
  setContext(text: string): void;
  setControls(nodes: Node[] | null): void;
}

/** What a panel lens is given. It never reaches past this into the controller or another lens. */
export interface LensContext {
  model: Model;
  engine: GlobeEngine;
  time: TimeModel;
  panel: Panel;
  /** the lens's one line under the shell's title (and the document title) */
  setContext(text: string): void;
  /** a small row of the lens's own controls, placed and styled by the shell; null clears it */
  setControls(nodes: Node[] | null): void;
  navigate(state: AppState): void;
  /** the field's current filter, and a way to be told when it changes */
  filter(): FieldFilter;
  passages: PassageBridge;
  /** open the field on a subject (leaving this lens), or keep the lens and just tune the globe to it */
  focus(subject: Subject): void;
  openOccurrence(occId: string): void;
  /** the visitor's own chart changed (saved, edited, deleted): the sky re-reads the standing natal chart */
  refreshNatal(): void;
  /** the route this lens stands at changed from inside it (no reload): keeps the hash and Back in step */
  setPath(path: string[], opts?: { replace?: boolean }): void;
}

export interface LensInstance {
  /** show the lens at a sub-route; called again when only the sub-route changes */
  enter(path: string[]): void;
  /** take down everything the lens added to the scene and the DOM */
  leave(): void;
  /** a frame of the shared loop, while the lens stands (optional) */
  update?(dt: number): void;
}

export interface LensModule {
  mount(ctx: LensContext): LensInstance;
}

export const LENSES: readonly LensDef[] = [
  { id: 'field', label: 'Field', icon: 'field', group: 'read', blurb: 'Every archetype, symbol and instance on the globe.', key: 'F' },
  { id: 'theory', label: 'Theory', icon: 'theory', group: 'read', blurb: 'How psychic energy moves: compensation, reversal, the third.', key: 'T' },
  { id: 'aion', label: 'Aion', icon: 'aion', group: 'read', blurb: 'Jung’s history of the aeons, Pisces to Aquarius.', key: 'A' },
  { id: 'redbook', label: 'Red Book', icon: 'redbook', group: 'read', blurb: 'The book the rest of the field grew from.', key: 'R' },
  { id: 'astrology', label: 'Astrology', icon: 'astrology', group: 'practice', blurb: 'Your birth sky beside Jung’s, read through the corpus.' },
  { id: 'dreams', label: 'Dreams', icon: 'dreams', group: 'practice', blurb: 'Keep your dreams and amplify their images.' },
  { id: 'symbols', label: 'Symbols', icon: 'symbols', group: 'practice', blurb: 'Take one symbol through its history and doctrine.' },
  { id: 'coincidences', label: 'Coincidences', icon: 'coincidences', group: 'practice', blurb: 'Log meaningful coincidences and see your series.' },
];

/** The lenses the menu offers. A lens joins when it is built and verified; the registry above is the plan. */
export const BUILT: ReadonlySet<LensId> = new Set<LensId>(['field', 'theory', 'aion', 'redbook', 'astrology', 'dreams', 'symbols', 'coincidences']);

export function lensDef(id: LensId): LensDef {
  return LENSES.find((l) => l.id === id) ?? LENSES[0];
}

/** Which lens a state belongs to: the shell shows this one as active. */
export function lensOf(s: AppState): LensId {
  if (s.lens) return s.lens.id;
  if (s.dynamics) return 'theory';
  if (s.history) return 'aion';
  if (s.redbook) return 'redbook';
  return 'field';
}

/** Panel lenses load on first use: their code is fetched only then (code-split per lens). */
export const PANEL_LOADERS: Record<PanelLensId, () => Promise<LensModule>> = {
  theory: () => import('../lenses/theory'),
  astrology: () => import('../lenses/astrology'),
  dreams: () => import('../lenses/dreams'),
  symbols: () => import('../lenses/symbols'),
  coincidences: () => import('../lenses/coincidences'),
};
