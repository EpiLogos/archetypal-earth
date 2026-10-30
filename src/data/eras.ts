// The one era table. The time strip names these stretches of history (src/data/time.ts, drawn by src/ui/time-control.ts) and the
// filter offers them as its era chips (src/shell/filter.ts); both read this table, so a chip and the strip's name over the same
// years are the same word. Ends are years: `from` is inclusive, `to` is exclusive (the next era's `from`); the first era opens at
// -Infinity and the last closes at Infinity.

export interface EraDef {
  id: string;
  name: string;
  from: number;
  to: number;
}

export const ERA_TABLE: readonly EraDef[] = [
  { id: 'antiquity', name: 'Antiquity', from: -Infinity, to: 250 },
  { id: 'late-antiquity', name: 'Late antiquity', from: 250, to: 750 },
  { id: 'middle-ages', name: 'Middle Ages', from: 750, to: 1400 },
  { id: 'renaissance', name: 'Renaissance', from: 1400, to: 1700 },
  { id: 'modern', name: 'Modern', from: 1700, to: Infinity },
];

/** The filter works in finite years: the open ends of the table close at the field's own floor and ceiling. */
export const ERA_FLOOR = -40000;
export const ERA_CEIL = 2100;
