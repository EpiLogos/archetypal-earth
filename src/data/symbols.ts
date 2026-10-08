import type { Symbols } from '../types/symbols';

/** An additional named source, never merged into Jung's authored passages. */
export async function loadSymbols(): Promise<Symbols> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const response = await fetch(`${base}/data/symbols.json`);
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Symbolic readings are unavailable.');
  const symbols = await response.json() as Symbols;
  if (!symbols.source?.title || !Array.isArray(symbols.entries) || symbols.entries.some(e =>
    !e.familyId || !e.title || !Array.isArray(e.body) || !Array.isArray(e.pages) || !Array.isArray(e.resonances))) throw new Error('Symbolic readings are invalid.');
  return symbols;
}
