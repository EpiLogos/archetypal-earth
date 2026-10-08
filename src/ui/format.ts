// Small text formatting shared by the reveal, the deep sheet and the strip.
import type { Cite, Occurrence } from '../types/field';
import type { Model } from '../data/model';
import { clipText, eraShort } from '../data/text';

export { clipText, eraShort };

/** "Psychology and Alchemy (CW12)" → "Psychology and Alchemy" */
export function shortWork(workTitle: string): string {
  return workTitle.replace(/\s*\((?:cw|CW)[^)]*\)\s*$/, '').trim();
}

/** "fig. 131, ¶357 (pdf p268)" → "¶357" — falls back to the locator minus pdf noise. */
export function shortLocator(loc: string): string {
  const para = loc.match(/¶\s*[\d][\d\s,–\-¶]*/);
  if (para) return para[0].replace(/\s+$/, '').replace(/\s*,\s*$/, '');
  const t = loc.replace(/\(\s*pdf[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
  return t.length > 36 ? clipText(t, 36) : t;
}

export function jungLine(c: Cite): string {
  return ['Jung', shortWork(c.workTitle), c.year, shortLocator(c.locator)].filter(Boolean).join(' · ');
}


export function cultureNames(m: Model, o: Occurrence, limit = 2): string[] {
  return o.cultureIds.slice(0, limit).map((c) => m.cultureById.get(c)?.name ?? '').filter(Boolean);
}


function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** One quiet line: year display · place · cultures — without repeating itself. */
export function placeLine(m: Model, o: Occurrence): string {
  const era = clipText(o.yearDisplay.trim(), 60);
  let place = (o.place ?? '').trim();
  place = place.length > 56 ? clipText(place, 56) : place;
  if (place && (norm(era).includes(norm(place)) || norm(place).includes(norm(era)))) place = '';
  const taken = norm(`${era} ${place}`);
  const cs = cultureNames(m, o).filter((c) => !taken.includes(norm(c)));
  return [era, place, ...cs].filter(Boolean).join(' · ');
}
