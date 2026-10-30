// The View control's reading (H3): Earth, Graph or Sky is where the camera is, never a switch of its own. The control only
// reads: the route (graph, sky) and the sky camera's phase (`document.body.dataset.skyPhase`, written by the controller from
// the camera). A click asks the controller for the transition the gesture makes (`viewTarget` names which); the camera
// stays the one thing that moves.

export type View = 'earth' | 'graph' | 'sky';
export const VIEWS: View[] = ['earth', 'graph', 'sky'];

/** Where the camera is: Graph in the graph (it has no sky); Sky while the route is in the sky, and through the descent until the camera settles; else the Earth. */
export function viewOf(f: { graph: boolean; sky: boolean; phase?: string }): View {
  if (f.graph) return 'graph';
  if (f.sky || f.phase === 'descend') return 'sky';
  return 'earth';
}

/** The transition a click on `to` asks of the controller when the camera shows `from`. */
export type ViewMove = 'none' | 'earth' | 'graph' | 'descend' | 'lift';
export function viewTarget(from: View, to: View): ViewMove {
  if (from === to) return 'none';
  if (to === 'graph') return 'graph';
  if (to === 'sky') return 'lift';
  return from === 'sky' ? 'descend' : 'earth';
}
