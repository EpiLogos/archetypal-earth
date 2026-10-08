import type { Field, ImageRef } from '../types/field';

const BASE = import.meta.env.BASE_URL ?? '/';

/** Site-relative image paths are served from public/; data/http URLs pass through. */
export function resolveSrc(src: string): string {
  if (/^(data:|https?:|blob:)/.test(src)) return src;
  return BASE.replace(/\/$/, '') + '/' + src.replace(/^\//, '');
}

export function imgUrl(ref: ImageRef, thumb = false): string {
  return resolveSrc(thumb && ref.thumb ? ref.thumb : ref.src);
}

/** Load the field; fall back to the synthetic fixture when the data isn't there yet. */
export async function loadField(): Promise<{ field: Field; fixture: boolean }> {
  let why = 'not found';
  try {
    const res = await fetch(BASE.replace(/\/$/, '') + '/data/field.json');
    const type = res.headers.get('content-type') ?? '';
    // vite's dev server answers unknown paths with index.html (200) — treat as absent
    if (res.ok && !type.includes('text/html')) {
      const field = (await res.json()) as Field;
      if (field?.occurrences?.length) return { field, fixture: false };
      why = 'empty';
    } else why = `HTTP ${res.status} ${type}`;
  } catch (e) {
    why = String(e);
  }
  console.warn(`[archetypal-earth] /data/field.json not available (${why}) — using the synthetic dev fixture.`);
  const { buildFixture } = await import('../dev/fixture');
  return { field: buildFixture(), fixture: true };
}
