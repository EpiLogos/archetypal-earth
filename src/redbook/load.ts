import type { RedBook } from '../types/redbook';

/** Load the published Red Book data. Missing data must never become invented content. */
export async function loadRedbook(): Promise<RedBook | null> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/data/redbook.json`);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) return null;
    const redbook = await response.json() as RedBook;
    if (!Array.isArray(redbook.stops) || !redbook.stops.length || !Array.isArray(redbook.sections) || !Array.isArray(redbook.genesis)) return null;
    return redbook;
  } catch {
    return null;
  }
}
