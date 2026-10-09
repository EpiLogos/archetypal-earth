import type { DynamicsCite, DynamicsConcept, DynamicsData, DynamicsQuote, DynamicsRender } from '../types/dynamics';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
const RENDERS: readonly DynamicsRender[] = ['lorenz', 'mandelbrot', 'julia'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, where: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`dynamics data: ${where} must be a non-empty string`);
  return v;
};

function cite(v: unknown, where: string): DynamicsCite {
  if (!isObj(v)) throw new Error(`dynamics data: ${where} must be an object`);
  const out: DynamicsCite = { workTitle: str(v.workTitle, `${where}.workTitle`), year: typeof v.year === 'string' ? v.year : String(v.year ?? ''), locator: str(v.locator, `${where}.locator`) };
  if (v.work !== undefined) out.work = str(v.work, `${where}.work`);
  return out;
}

function quote(v: unknown, where: string): DynamicsQuote {
  if (!isObj(v)) throw new Error(`dynamics data: ${where} must be an object`);
  return { text: str(v.text, `${where}.text`), cite: cite(v.cite, `${where}.cite`) };
}

/**
 * Validate the published shape. A malformed file is a loud failure (it is the rail's output, not an absence);
 * an absent file is handled by loadDynamics and never reaches here.
 */
export function parseDynamics(raw: unknown): DynamicsData {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.concepts)) throw new Error('dynamics data: expected { version: 1, concepts: [] }');
  const concepts: DynamicsConcept[] = raw.concepts.map((c, i) => {
    const where = `concepts[${i}]`;
    if (!isObj(c)) throw new Error(`dynamics data: ${where} must be an object`);
    if (!Array.isArray(c.familyIds) || c.familyIds.some((f) => typeof f !== 'string')) throw new Error(`dynamics data: ${where}.familyIds must be strings`);
    if (c.render !== undefined && !RENDERS.includes(c.render as DynamicsRender)) throw new Error(`dynamics data: ${where}.render is not a native render`);
    const out: DynamicsConcept = {
      id: str(c.id, `${where}.id`),
      name: str(c.name, `${where}.name`),
      quote: quote(c.quote, `${where}.quote`),
      familyIds: c.familyIds as string[],
    };
    if (c.jung !== undefined) out.jung = quote(c.jung, `${where}.jung`);
    if (c.render !== undefined) out.render = c.render as DynamicsRender;
    return out;
  });
  return { version: 1, concepts };
}

/**
 * Fetch public/data/dynamics.json. Absent (404, or the dev server's HTML fallback, or no network) resolves to null
 * silently: there is nothing to report. Any other failure rejects.
 */
export async function loadDynamics(fetchFn: typeof fetch = fetch): Promise<DynamicsData | null> {
  let res: Response;
  try {
    res = await fetchFn(`${BASE}/data/dynamics.json`);
  } catch {
    return null;
  }
  if (res.status === 404) return null;
  const type = res.headers.get('content-type') ?? '';
  // vite's dev server answers unknown paths with index.html (200): that is absent too
  if (type.includes('text/html')) return null;
  if (!res.ok) throw new Error(`The dynamics data could not be loaded (HTTP ${res.status}).`);
  return parseDynamics(await res.json());
}
