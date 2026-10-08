// The visible side of the sky's clock: the equinox ring in Aion mode, and the "The sky's clock" disclosure on the card.
// Nothing here owns state; AionView feeds it the year the cursor stands on.
import type { AeonEvent, Epoch, HistoryReading } from '../types/history';
import { clear, el } from '../ui/dom';
import { CONVENTION_INFO, CONVENTIONS, conventionTicks, equinoxPlace, type Convention } from './precession';
import {
  abbreviate, aquarianRows, crossCheck, placesAt, sectorOf, signOf, signSpans, SKY_CLOCK_LEDE, SKY_CLOCK_TWO_CLOCKS, spanText, yearText,
} from './skyclock';

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, children: SVGElement[] = []): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children) node.append(c);
  return node;
}

const SIZE = 172;
const C = SIZE / 2;
const R = 52;
/** Longitude 0° at the top, increasing counter-clockwise (as ecliptic longitude does seen from the north): the equinox walks clockwise. */
const angle = (lon: number) => ((-90 - lon) * Math.PI) / 180;
const pt = (lon: number, r: number): [number, number] => [C + r * Math.cos(angle(lon)), C + r * Math.sin(angle(lon))];
const arc = (from: number, to: number, r: number): string => {
  const span = (((to - from) % 360) + 360) % 360;
  const [x0, y0] = pt(from, r);
  const [x1, y1] = pt(from + span, r);
  // counter-clockwise on screen = sweep-flag 0
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${span > 180 ? 1 : 0} 0 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/** A quiet ecliptic circle with the zodiac's ticks and the spring equinox walking backward round it as the clock plays. */
export class EquinoxRing {
  readonly root: HTMLElement;
  private readonly face: SVGSVGElement;
  private readonly ticks: SVGGElement;
  private readonly sector: SVGPathElement;
  private readonly marker: SVGGElement;
  private readonly readout: HTMLElement;
  private readonly select: HTMLSelectElement;
  private convention: Convention = 'jung-equal';
  private shownYear = NaN;
  private shownConvention: Convention | null = null;

  constructor(parent: HTMLElement) {
    this.ticks = svg('g', { class: 'aion-ring-ticks' });
    this.sector = svg('path', { class: 'aion-ring-sector', fill: 'none' });
    this.marker = svg('g', { class: 'aion-ring-marker' }, [
      svg('line', { x1: C, y1: C - R + 7, x2: C, y2: C - R - 8 }),
      svg('circle', { cx: C, cy: C - R, r: 3.2 }),
    ]);
    this.face = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE, 'aria-hidden': 'true', focusable: 'false' }, [
      svg('circle', { class: 'aion-ring-circle', cx: C, cy: C, r: R, fill: 'none' }),
      this.sector, this.ticks, this.marker,
    ]);
    this.readout = el('p', { class: 'aion-ring-read', 'aria-live': 'off' });
    this.select = el('select', { 'aria-label': 'Zodiac convention for the equinox ring', onchange: () => this.set(this.select.value as Convention) });
    for (const c of CONVENTIONS) this.select.append(el('option', { value: c, text: CONVENTION_INFO[c].label }));
    this.root = el('aside', { class: 'aion-ring', 'aria-label': 'The spring equinox among the stars' }, [this.face, this.readout, this.select]);
    parent.append(this.root);
    this.draw();
  }

  /** Choose the convention whose boundaries the ring draws. */
  set(convention: Convention) {
    if (convention === this.convention) return;
    this.convention = convention;
    this.select.value = convention;
    this.draw();
    this.shownYear = NaN;
  }

  private draw() {
    clear(this.ticks);
    for (const t of conventionTicks(this.convention)) {
      const [x0, y0] = pt(t.longitude, R - 4);
      const [x1, y1] = pt(t.longitude, R + 4);
      this.ticks.append(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1 }));
    }
    // names sit mid-sector, small, names only: abbreviations of the sector's own name
    const ticks = conventionTicks(this.convention).sort((a, b) => a.longitude - b.longitude);
    ticks.forEach((t, i) => {
      const next = ticks[(i + 1) % ticks.length];
      const span = (((next.longitude - t.longitude) % 360) + 360) % 360 || 360;
      const [x, y] = pt(t.longitude + span / 2, R + 15);
      const label = svg('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
      label.textContent = abbreviate(t.name);
      this.ticks.append(label);
    });
  }

  /** Per frame: the cheap part is a transform; the text and sector change only when the sign does. */
  update(year: number) {
    const place = equinoxPlace(this.convention, year);
    // drawn at the top (longitude 0) and turned by −longitude: longitude grows counter-clockwise, so the equinox, whose
    // longitude falls with the years, walks clockwise
    this.marker.setAttribute('transform', `rotate(${(-place.longitude).toFixed(3)} ${C} ${C})`);
    const rounded = Math.round(year);
    if (rounded === this.shownYear && this.convention === this.shownConvention) return;
    this.shownYear = rounded;
    this.shownConvention = this.convention;
    const sec = sectorOf(this.convention, place.longitude);
    this.sector.setAttribute('d', arc(sec.from, sec.to, R));
    this.readout.textContent = `In ${yearText(rounded)}, by ${CONVENTION_INFO[this.convention].label}, the spring equinox lies in ${place.name}.`;
  }

}

// ── the disclosure ─────────────────────────────────────────────────────

function table(caption: string, rows: [string, string, boolean?][]): HTMLElement {
  return el('table', { class: 'aion-sc-table' }, [
    el('caption', { text: caption }),
    el('tbody', {}, rows.map(([a, b, primary]) => el('tr', primary ? { class: 'primary' } : {}, [el('th', { scope: 'row', text: a }), el('td', { text: b })]))),
  ]);
}

/**
 * "The sky's clock" for an epoch or an event: where the equinox is, under each convention, beside Jung's own
 * boundaries; and, for Pisces and Aquarius, the conditional Aquarian beginnings as calculations.
 */
export function skyClockDisclosure(reading: HistoryReading, subject: Epoch | AeonEvent, now = new Date().getUTCFullYear()): HTMLElement {
  const sign = signOf(reading, subject);
  const isEvent = 'epochId' in subject;
  // an event stands at its year; an epoch is read at the middle of its span
  const year = isEvent ? subject.year : (subject.from + subject.to) / 2;
  const body = el('div', { class: 'aion-sc-body' }, [el('p', { class: 'aion-sc-lede', text: SKY_CLOCK_LEDE })]);

  if (sign) {
    const rows = signSpans(reading, sign).map((r): [string, string, boolean] => [r.label, `${spanText(r.from, r.to, r.approximate)}${r.to > now ? ' · the end is a calculation' : ''}${r.note ? ` · ${r.note}` : ''}`, r.primary]);
    body.append(table(`The equinox in ${sign}`, rows));
    if (!isEvent && subject.parentId) body.append(el('p', { class: 'aion-sc-note', text: 'The two fishes are Jung’s division of Pisces; no astronomical convention divides it.' }));
  }

  const when = isEvent ? `${subject.yearDisplay}` : `the middle of this span, ${yearText(year)}`;
  body.append(table(`The equinox at ${when}${year > now ? ' (a calculation)' : ''}`, placesAt(year).map((p): [string, string] => [p.label, p.name])));

  if (sign === 'Pisces' || sign === 'Aquarius' || (isEvent && subject.id.startsWith('aquarius-alternative'))) {
    const aq = aquarianRows(reading);
    const rows: [string, string, boolean?][] = [
      ...aq.calculations.map((c): [string, string, boolean] => ['Jung, conditional', `${c.year} CE · depending on the reference star`, true]),
      ['Jung’s range', `${aq.range.from}–${aq.range.to} CE · “very indefinite”, ${aq.range.locator}`, true],
      ...aq.conventions.map((c): [string, string] => [c.label, `${yearText(c.year, c.approximate)} · the equinox leaves Pisces for Aquarius`]),
    ];
    body.append(table('Where Aquarius begins', rows));
    body.append(el('p', { class: 'aion-sc-note', text: 'Each is a calculation under its own convention, not an event and not a forecast. They differ by centuries because the zodiac is drawn differently, which is the point of showing them together.' }));
  }

  body.append(el('p', { class: 'aion-sc-note', text: `Method: Vondrák, Capitaine & Wallace 2011, long-term precession. ${crossCheck(year).text}` }));
  body.append(el('p', { class: 'aion-sc-note', text: SKY_CLOCK_TWO_CLOCKS }));
  return el('details', { class: 'aion-skyclock' }, [el('summary', { text: 'The sky’s clock' }), body]);
}
