// Tiny DOM helpers + the image plate (an image, or a tonal plate when there is none).
import type { ImageRef, Palette } from '../types/field';
import { imgUrl } from '../data/load';

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: (Node | string | null | undefined | false)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

export function clear(node: Element) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export interface PlateOptions {
  /** show credit · license over the image, in small type */
  credit?: boolean;
  thumb?: boolean;
  className?: string;
  alt?: string;
  /** fallback tint when the image has no tone */
  palette?: Palette;
  eager?: boolean;
}

/**
 * An image presented as a plate. With no image, or when it fails to load,
 * it stays a tonal plate in the entity's palette — never a broken-image icon.
 */
export function plate(ref: ImageRef | undefined, opts: PlateOptions = {}): HTMLElement {
  const fig = el('figure', { class: `plate ${opts.className ?? ''}` });
  const core = opts.palette?.core ?? ref?.tone ?? '#46557f';
  const fog = opts.palette?.fog ?? '#0d1330';
  fig.style.setProperty('--pc', ref?.tone ?? core);
  fig.style.setProperty('--pf', fog);
  if (ref && ref.width && ref.height) fig.style.setProperty('--ar', String(ref.width / ref.height));
  if (!ref) {
    fig.classList.add('plate-empty');
    return fig;
  }
  const img = el('img', { alt: opts.alt ?? ref.title ?? '', decoding: 'async', draggable: 'false' });
  if (!opts.eager) img.loading = 'lazy';
  // decode off the main thread first, then reveal: no decode work lands inside a frame
  img.addEventListener('load', () => {
    const show = () => fig.classList.add('loaded');
    if (typeof img.decode === 'function') img.decode().then(show, show);
    else show();
  });
  img.addEventListener('error', () => {
    img.remove();
    fig.classList.add('plate-empty', 'plate-failed');
  });
  img.src = imgUrl(ref, opts.thumb);
  fig.append(img);
  if (opts.credit && (ref.credit || ref.license)) {
    const parts = [ref.credit, ref.license].filter(Boolean).join(' · ');
    fig.append(el('figcaption', { class: 'plate-credit', text: parts }));
  }
  return fig;
}

export function mq(query: string): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia(query).matches;
}

export const isNarrow = () => mq('(max-width: 760px)');
export const prefersReducedMotion = () => mq('(prefers-reduced-motion: reduce)');
