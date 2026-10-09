import type { History, HistoryReading, Epoch, AeonEvent } from '../types/history';
import type { ImageRef } from '../types/field';
import { occurrenceImage, type Model } from '../data/model';

/** Nested intervals are half-open; the narrowest epoch supplies the atmosphere. */
export function epochAt(reading: HistoryReading, year: number): Epoch | undefined {
  return reading.epochs.filter(e => year >= e.from && (year < e.to || year === reading.to && e.to === reading.to))
    .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
}

export function eventOccurrences(model: Model, event: AeonEvent): number[] {
  const indices = new Set<number>();
  for (const id of event.occurrenceIds) {
    const i = model.occIndex.get(id);
    if (i !== undefined) indices.add(i);
  }
  for (const id of event.familyIds) for (const i of model.famOcc.get(id) ?? []) indices.add(i);
  return [...indices].sort((a, b) => model.occ[a].year - model.occ[b].year);
}

/** An epoch and every epoch nested inside it (the two fishes inside Pisces). */
function spanIds(reading: HistoryReading, epoch: Epoch): Set<string> {
  const ids = new Set([epoch.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of reading.epochs) if (e.parentId && ids.has(e.parentId) && !ids.has(e.id)) { ids.add(e.id); grew = true; }
  }
  return ids;
}

/**
 * The hero of an event: its first gathered occurrence's own image (or that occurrence's family image), then the
 * first family with an image, then the first archetype with one. Undefined leaves the card a tonal plate.
 */
export function eventHeroImage(model: Model, event: AeonEvent): ImageRef | undefined {
  for (const id of event.occurrenceIds) {
    const i = model.occIndex.get(id);
    if (i !== undefined) { const image = occurrenceImage(model, model.occ[i]); if (image) return image; }
  }
  for (const id of event.familyIds) { const image = model.famById.get(id)?.image; if (image) return image; }
  for (const id of event.archetypeIds ?? []) { const image = model.archById.get(id)?.image; if (image) return image; }
  return undefined;
}

/**
 * The hero of an epoch: the archetypes it names, then the families of the events inside it (nested epochs
 * included), the most-cited family first. Undefined leaves the card a tonal plate in the epoch's palette.
 */
export function epochHeroImage(model: Model, reading: HistoryReading, epoch: Epoch): ImageRef | undefined {
  for (const id of epoch.archetypeIds ?? []) { const image = model.archById.get(id)?.image; if (image) return image; }
  const inside = spanIds(reading, epoch);
  const counts = new Map<string, number>();
  for (const event of reading.events) if (inside.has(event.epochId)) for (const id of event.familyIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const id of ranked) { const image = model.famById.get(id)?.image; if (image) return image; }
  return undefined;
}

export function historyExtent(history: History): { from: number; to: number } | undefined {
  if (!history.readings.length) return undefined;
  return { from: Math.min(...history.readings.map(r => r.from)), to: Math.max(...history.readings.map(r => r.to)) };
}

export async function loadHistory(): Promise<History> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const response = await fetch(`${base}/data/history.json`);
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Aion history data is unavailable.');
  const history = await response.json() as History;
  if (!Array.isArray(history.readings) || !history.readings.length || history.readings.some(r =>
    !r.id || !Number.isFinite(r.from) || !Number.isFinite(r.to) || r.from >= r.to ||
    !Array.isArray(r.epochs) || !Array.isArray(r.events) || !Array.isArray(r.threads))) throw new Error('Aion history data is invalid.');
  return history;
}
