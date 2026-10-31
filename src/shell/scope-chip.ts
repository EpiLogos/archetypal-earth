// The lens's scope as a chip in the slice dock (H6). A lens draws its own set on the globe and sets the rest of the field back; the
// chip says how many presences that set holds and takes the setting-back away when it is removed ("the whole field"). With the
// scope removed the chip stays, as the way back to the lens's own set. Pure: the scope in, the chip's words out.

export interface ScopeState {
  /** the lens's set, named ("the Red Book", "Aion") */
  label: string;
  /** how many presences the set holds on the globe */
  own: number;
}

export interface ScopeChip {
  label: string;
  /** what pressing it does, for a screen reader */
  aria: string;
  /** true while the whole field stands (the chip is then the way back to the lens's own set) */
  off: boolean;
}

export function scopeChip(scope: ScopeState | null, wholeField: boolean): ScopeChip | null {
  if (!scope) return null;
  if (wholeField) return { label: `Only ${scope.label}`, aria: `Show only ${scope.label} again`, off: true };
  return { label: `${scope.own.toLocaleString('en-GB')} in ${scope.label}`, aria: `Set ${scope.label} aside and show the whole field`, off: false };
}
