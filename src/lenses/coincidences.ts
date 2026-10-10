// Placeholder until this lens is built; it is not listed in the menu (see BUILT in src/shell/lens.ts).
import type { LensContext, LensInstance } from '../shell/lens';

export function mount(_ctx: LensContext): LensInstance {
  return { enter() {}, leave() {} };
}
