import type { History, HistoryReading, Epoch, AeonEvent } from '../types/history';
import type { Model } from '../data/model';

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
