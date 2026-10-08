// The sky's clock, as plain data for the Aion card and the equinox ring: where the vernal equinox stands, and when
// it enters and leaves each sign, under each stated convention, set beside Jung's own boundaries — which are read from
// the reading unchanged and always come first. Pure: the precession lives in ./precession.
import type { AeonEvent, Epoch, HistoryReading } from '../types/history';
import {
  CONVENTION_INFO, CONVENTIONS, conventionTicks, entersAfter, equinoxPlace, generalPrecessionIau2006, accumulatedPrecession, J2000_JD, jdOfYear,
  stayNear, type Convention,
} from './precession';

/** Two sentences the disclosure opens with. Fixed text: the framing law (SKY-SPEC D6) and the two-clocks law (D5). */
export const SKY_CLOCK_LEDE =
  'Where the spring equinox lies among the stars is a calculation, and it depends on how the zodiac is drawn. These are the sky’s own boundaries under stated conventions, set beside Jung’s months, which stay as the reading gives them. Nothing here is a forecast.';
export const SKY_CLOCK_TWO_CLOCKS =
  'Two clocks: the historical clock is untouched. This one reads the year the cursor stands on as a calendar year, and is the only place the two meet.';

/** Jung's own conditional dating of the Aquarian beginning: Aion ¶149 n.84 (cw09ii, pdf p106). */
export const JUNG_AQUARIAN = {
  eventIds: ['aquarius-alternative-1997', 'aquarius-alternative-2154'],
  range: { from: 2000, to: 2200 },
  locator: 'cw09ii ¶149, n.84 (pdf p106)',
} as const;

export function yearText(year: number, approximate = false): string {
  const y = Math.round(year);
  const body = y < 0 ? `${Math.abs(y).toLocaleString('en')} BCE` : `${y.toLocaleString('en')} CE`;
  return approximate ? `c. ${body}` : body;
}

/** A span of years as text: "c. 222 CE – c. 2,376 CE"; an end past `now` is marked as a calculation, never as a date to wait for. */
export function spanText(from: number, to: number, approximate: boolean): string {
  return `${yearText(from, approximate)} – ${yearText(to, approximate)}`;
}

export interface SpanRow {
  key: Convention | 'jung-display';
  label: string;
  from: number;
  to: number;
  /** Jung's display boundaries are primary: the others are alternatives beside them */
  primary: boolean;
  approximate: boolean;
  note?: string;
}

function signEpoch(reading: HistoryReading, sign: string): Epoch | undefined {
  return reading.epochs.find((e) => e.sign === sign && !e.parentId);
}

/** When the equinox is in `sign`: Jung's display span first, then every convention's stay nearest to it. */
export function signSpans(reading: HistoryReading, sign: string): SpanRow[] {
  const rows: SpanRow[] = [];
  const own = signEpoch(reading, sign);
  if (own) rows.push({ key: 'jung-display', label: 'Jung’s display boundaries', from: own.from, to: own.to, primary: true, approximate: false, note: 'the reading’s own span, unchanged' });
  const mid = own ? (own.from + own.to) / 2 : 0;
  for (const c of CONVENTIONS) {
    const s = stayNear(c, sign, mid);
    if (s) rows.push({ key: c, label: CONVENTION_INFO[c].label, from: s.from, to: s.to, primary: false, approximate: c !== 'jung-equal' });
  }
  return rows;
}

export interface PlaceRow {
  convention: Convention;
  label: string;
  name: string;
  longitude: number;
}

/** Where the equinox stands at a calendar year, under every convention. */
export function placesAt(year: number): PlaceRow[] {
  return CONVENTIONS.map((c) => {
    const p = equinoxPlace(c, year);
    return { convention: c, label: CONVENTION_INFO[c].label, name: p.name, longitude: p.longitude };
  });
}

export interface AquarianRows {
  /** Jung's two conditional calculations, from the reading's own events, in year order */
  calculations: { id: string; year: number; label: string }[];
  range: { from: number; to: number; locator: string };
  /** where the equinox leaves Pisces for Aquarius under each convention */
  conventions: { convention: Convention; label: string; year: number; approximate: boolean }[];
}

export function aquarianRows(reading: HistoryReading): AquarianRows {
  const calculations = JUNG_AQUARIAN.eventIds
    .map((id) => reading.events.find((e) => e.id === id))
    .filter((e): e is AeonEvent => !!e)
    .map((e) => ({ id: e.id, year: e.year, label: e.name }))
    .sort((a, b) => a.year - b.year);
  const conventions: AquarianRows['conventions'] = [];
  for (const c of CONVENTIONS) {
    const y = entersAfter(c, 'Aquarius', 1000);
    if (y !== undefined) conventions.push({ convention: c, label: CONVENTION_INFO[c].label, year: y, approximate: c !== 'jung-equal' });
  }
  return { calculations, range: { ...JUNG_AQUARIAN.range, locator: JUNG_AQUARIAN.locator }, conventions };
}

/** Which sign a card speaks of: an epoch's own, or the sign of the epoch an event sits in. */
export function signOf(reading: HistoryReading, subject: Epoch | AeonEvent): string | undefined {
  if ('epochId' in subject) return reading.epochs.find((e) => e.id === subject.epochId)?.sign;
  return subject.sign;
}

/** The IAU 2006 polynomial against the long-term model at a year: the cross-check, in arcseconds, and what it means. */
export function crossCheck(year: number): { arcsec: number; agrees: boolean; text: string } {
  const jd = jdOfYear(year);
  const arcsec = Math.abs(generalPrecessionIau2006(jd) - accumulatedPrecession(jd, J2000_JD)) * 3600;
  const agrees = arcsec < 2;
  const size = arcsec < 60 ? `${arcsec.toFixed(arcsec < 10 ? 1 : 0)}″` : `${(arcsec / 60).toFixed(0)}′`;
  return {
    arcsec,
    agrees,
    text: agrees
      ? `The IAU 2006 polynomial agrees with the long-term model here to ${size}.`
      : `Here the IAU 2006 polynomial, fitted near J2000.0, differs from the long-term model by ${size}; the long-term model is the one used.`,
  };
}

/** The sector of a convention's circle that holds a longitude: its start and end longitude, and its name. */
export function sectorOf(convention: Convention, longitude: number): { from: number; to: number; name: string } {
  const ticks = conventionTicks(convention).sort((a, b) => a.longitude - b.longitude);
  let k = -1;
  for (let i = 0; i < ticks.length; i++) if (longitude >= ticks[i].longitude) k = i;
  const cur = ticks[k < 0 ? ticks.length - 1 : k];
  const next = ticks[(ticks.indexOf(cur) + 1) % ticks.length];
  return { from: cur.longitude, to: next.longitude, name: cur.name };
}

const ABBR: Record<string, string> = {
  Aries: 'Ari', Taurus: 'Tau', Gemini: 'Gem', Cancer: 'Cnc', Leo: 'Leo', Virgo: 'Vir', Libra: 'Lib', Scorpio: 'Sco', Scorpius: 'Sco', Ophiuchus: 'Oph',
  Sagittarius: 'Sgr', Capricorn: 'Cap', Capricornus: 'Cap', Aquarius: 'Aqr', Pisces: 'Psc',
};
export const abbreviate = (name: string): string => ABBR[name] ?? name.slice(0, 3);
