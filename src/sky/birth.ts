// The "Birth sky" disclosure: a date, a time and a place in, the sky at that moment out. The form asks; the controller
// asks the sidecar; this file draws the answer as the sidecar gave it, with the framing sentence beside it and the
// limits of the feature stated once, plainly. Without the sidecar the disclosure stays, labelled and disabled — a
// feature that cannot be reached says so rather than failing.
import { clear, el } from '../ui/dom';
import type { BodyKey, GeocodeResult, SidecarChart, SkyBody } from '../types/sky';
import type { FieldTarget } from './card';
import { approximationNote, BIRTH_FRAMING, BIRTH_LIMITS, chartMoonPhase, chartRows, describeAspect, describeInstant, placeInSign } from './chart';
import { findPlaces, formatCoordinates, fromGazetteer, fromGeocode, type ChosenPlace } from './gazetteer';
import { parseBirthInput, SidecarError, type BirthInput } from './sidecar';
import type { Gazetteer } from '../types/sky';

export interface BirthHandlers {
  /** the person asked for this sky */
  onCast(b: BirthInput): void;
  /** leave the birth sky for the present one */
  onLeave(): void;
  /** open the body's card within the birth sky */
  onBody(key: BodyKey): void;
  /** go down to the field through a mythic node */
  onField(target: FieldTarget): void;
  /** aspect arcs / houses ring toggled */
  onDraw(o: { aspects: boolean; houses: boolean }): void;
  /** free-text place lookup through the sidecar's geocoder */
  lookup(q: string): Promise<GeocodeResult[]>;
  /** the first mythic node a body descends through, if it has one that resolves */
  descent(key: BodyKey): { label: string; target: FieldTarget } | null;
  nameOf(key: BodyKey): string;
  /** the disclosure was opened: a good moment to look for the sidecar again */
  onOpen(): void;
}

export type BirthAvailability =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'off'; why: 'absent' | 'not-local' };

const WHY_OFF: Record<'absent' | 'not-local', string> = {
  absent: 'The ephemeris sidecar is not running, so a birth sky cannot be computed. Start it with ephemeris/run.sh and reload; everything else in the sky works without it.',
  'not-local': 'A birth sky is computed by the ephemeris sidecar, which only runs on the machine that serves this site. This copy cannot reach one.',
};

export class BirthPanel {
  readonly root: HTMLDetailsElement;
  private summary: HTMLElement;
  private notice: HTMLElement;
  private form: HTMLFormElement;
  private date: HTMLInputElement;
  private time: HTMLInputElement;
  private place: HTMLInputElement;
  private lat: HTMLInputElement;
  private lon: HTMLInputElement;
  private suggest: HTMLElement;
  private lookupBtn: HTMLButtonElement;
  private castBtn: HTMLButtonElement;
  private status: HTMLElement;
  private result: HTMLElement;
  private gazetteer: Gazetteer | null = null;
  private chosen: ChosenPlace | null = null;
  private availability_: BirthAvailability = { kind: 'checking' };
  private aspects = false;
  private houses = false;
  private bodies: SkyBody[] = [];

  constructor(parent: HTMLElement, private h: BirthHandlers) {
    this.summary = el('summary', { text: 'Birth sky' });
    this.notice = el('p', { class: 'sky-birth-notice', role: 'status' });
    this.date = el('input', { type: 'text', name: 'date', inputmode: 'numeric', placeholder: 'YYYY-MM-DD', autocomplete: 'off', 'aria-label': 'Date of birth, year-month-day', maxlength: '10' }) as HTMLInputElement;
    this.time = el('input', { type: 'text', name: 'time', inputmode: 'numeric', placeholder: 'HH:MM', autocomplete: 'off', 'aria-label': 'Time of birth, 24-hour, local to the place', maxlength: '5' }) as HTMLInputElement;
    this.place = el('input', { type: 'text', name: 'place', placeholder: 'a city', autocomplete: 'off', 'aria-label': 'Place of birth', 'aria-describedby': 'sky-birth-place-help' }) as HTMLInputElement;
    this.lat = el('input', { type: 'text', name: 'lat', inputmode: 'decimal', placeholder: '47.37', autocomplete: 'off', 'aria-label': 'Latitude, degrees north (south is negative)' }) as HTMLInputElement;
    this.lon = el('input', { type: 'text', name: 'lon', inputmode: 'decimal', placeholder: '8.54', autocomplete: 'off', 'aria-label': 'Longitude, degrees east (west is negative)' }) as HTMLInputElement;
    this.suggest = el('div', { class: 'sky-birth-suggest', role: 'group', 'aria-label': 'Matching places' });
    this.lookupBtn = el('button', { type: 'button', class: 'link-quiet', text: 'Look up elsewhere', title: 'Search beyond the atlas\u2019s own list of cities' }) as HTMLButtonElement;
    this.castBtn = el('button', { type: 'submit', class: 'sky-birth-cast', text: 'Show this sky' }) as HTMLButtonElement;
    this.status = el('p', { class: 'sky-birth-status', role: 'status', 'aria-live': 'polite' });
    this.result = el('div', { class: 'sky-birth-result' });

    this.form = el('form', { class: 'sky-birth-form', novalidate: '' }, [
      el('div', { class: 'sky-birth-row' }, [
        el('label', {}, [el('span', { text: 'Date' }), this.date]),
        el('label', {}, [el('span', { text: 'Local time' }), this.time]),
      ]),
      el('label', { class: 'sky-birth-place' }, [el('span', { text: 'Place' }), this.place]),
      this.suggest,
      el('p', { id: 'sky-birth-place-help', class: 'sky-birth-help', text: 'From the list, or as coordinates; the time zone follows the place.' }),
      el('div', { class: 'sky-birth-row' }, [
        el('label', {}, [el('span', { text: 'Latitude °' }), this.lat]),
        el('label', {}, [el('span', { text: 'Longitude °' }), this.lon]),
      ]),
      el('div', { class: 'sky-birth-actions' }, [this.castBtn, this.lookupBtn]),
    ]);

    const body = el('div', { class: 'sky-birth-body' }, [
      el('p', { class: 'sky-birth-frame', text: BIRTH_FRAMING }),
      el('p', { class: 'sky-birth-limits', text: BIRTH_LIMITS }),
      this.notice,
      this.form,
      this.status,
      this.result,
    ]);
    this.root = el('details', { class: 'sky-birth' }, [this.summary, body]) as HTMLDetailsElement;
    parent.append(this.root);

    this.place.addEventListener('input', () => this.onPlaceInput());
    this.place.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = this.suggest.querySelector<HTMLButtonElement>('button[data-choice]');
        if (first && !this.chosen) { e.preventDefault(); first.click(); }
      }
    });
    for (const i of [this.lat, this.lon]) i.addEventListener('input', () => { this.chosen = { name: this.place.value.trim() || 'these coordinates', lat: Number(this.lat.value), lon: Number(this.lon.value), source: 'coordinates' }; });
    this.root.addEventListener('toggle', () => { if (this.root.open) this.h.onOpen(); });
    this.lookupBtn.addEventListener('click', () => void this.lookup());
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.cast(); });
    this.render();
  }

  setBodies(bodies: SkyBody[]) { this.bodies = bodies; }

  get availability(): BirthAvailability { return this.availability_; }

  setGazetteer(g: Gazetteer) {
    this.gazetteer = g;
  }

  /** Whether the sidecar can be reached: without it the disclosure stays, labelled, and cannot be submitted. */
  setAvailability(a: BirthAvailability) {
    this.availability_ = a;
    this.render();
  }

  private render() {
    const a = this.availability_;
    const off = a.kind === 'off';
    this.root.dataset.availability = a.kind;
    this.notice.textContent = a.kind === 'off' ? WHY_OFF[a.why] : a.kind === 'checking' ? 'Looking for the ephemeris sidecar…' : '';
    this.notice.hidden = a.kind === 'ready';
    this.form.toggleAttribute('inert', off);
    this.form.classList.toggle('off', off);
    for (const c of [this.date, this.time, this.place, this.lat, this.lon, this.castBtn, this.lookupBtn]) c.disabled = off;
  }

  /** Reflect a state that arrived by link: the form holds what the link said. */
  setInput(b: BirthInput | null) {
    if (!b) return;
    const [d, t] = b.local.split('T');
    this.date.value = d;
    this.time.value = t;
    this.lat.value = String(b.lat);
    this.lon.value = String(b.lon);
    if (!this.chosen || this.chosen.lat !== b.lat || this.chosen.lon !== b.lon) {
      this.chosen = { name: this.nameForCoordinates(b.lat, b.lon), lat: b.lat, lon: b.lon, source: 'coordinates' };
      this.place.value = this.chosen.name;
    }
    this.root.open = true;
  }

  /** A gazetteer city within a few kilometres reads as that city; anything else reads as its coordinates. */
  private nameForCoordinates(lat: number, lon: number): string {
    const near = this.gazetteer?.places.find((p) => Math.abs(p.lat - lat) < 0.03 && Math.abs(p.lon - lon) < 0.03);
    return near ? `${near.name}, ${near.country}` : formatCoordinates(lat, lon);
  }

  setStatus(kind: 'idle' | 'working' | 'error', message = '') {
    this.status.textContent = message;
    this.status.dataset.state = kind;
    this.castBtn.disabled = kind === 'working' || this.availability_.kind === 'off';
  }

  open() { this.root.open = true; }

  // ── the form ────────────────────────────────────────────────────────

  private onPlaceInput() {
    this.chosen = null;
    clear(this.suggest);
    const q = this.place.value;
    if (!this.gazetteer || q.trim().length < 2) return;
    const found = findPlaces(this.gazetteer.places, q);
    for (const p of found) {
      this.suggest.append(el('button', { type: 'button', class: 'link-quiet', 'data-choice': '', onclick: () => this.choose(fromGazetteer(p)) }, [
        p.name, el('span', { class: 'sky-source', text: ` ${p.country}` }),
      ]));
    }
    if (!found.length) this.suggest.append(el('p', { class: 'sky-birth-help', text: 'Not in the list of cities; use “Look up elsewhere”, or give the coordinates.' }));
  }

  private choose(p: ChosenPlace) {
    this.chosen = p;
    this.place.value = p.name;
    this.lat.value = String(p.lat);
    this.lon.value = String(p.lon);
    clear(this.suggest);
    this.suggest.append(el('p', { class: 'sky-birth-help sky-birth-chosen', text: `${formatCoordinates(p.lat, p.lon)} · ${p.source === 'gazetteer' ? 'from the atlas\u2019s list of cities' : p.source === 'geocoder' ? 'from OpenStreetMap, through the sidecar' : 'as given'}` }));
  }

  private async lookup() {
    const q = this.place.value.trim();
    if (q.length < 2) { this.setStatus('error', 'Type a place first.'); return; }
    this.setStatus('working', 'Looking up the place…');
    try {
      const results = await this.h.lookup(q);
      clear(this.suggest);
      if (!results.length) this.suggest.append(el('p', { class: 'sky-birth-help', text: `No place found for “${q}”.` }));
      for (const r of results) this.suggest.append(el('button', { type: 'button', class: 'link-quiet', 'data-choice': '', onclick: () => this.choose(fromGeocode(r)) }, [fromGeocode(r).name]));
      this.setStatus('idle', results.length ? `${results.length} found.` : '');
    } catch (e) {
      this.setStatus('error', e instanceof SidecarError ? e.message : 'The place lookup failed.');
    }
  }

  private cast() {
    const lat = Number(this.lat.value.trim());
    const lon = Number(this.lon.value.trim());
    const b = this.lat.value.trim() && this.lon.value.trim() ? parseBirthInput(this.date.value.trim(), this.time.value.trim(), lat, lon) : null;
    if (!b) {
      const date = this.date.value.trim();
      const time = this.time.value.trim();
      const [y, mo, d] = date.split('-').map(Number);
      const real = new Date(Date.UTC(y, mo - 1, d));
      const [h, mi] = time.split(':').map(Number);
      const why = !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'Give the date as year-month-day, for example 1875-07-26.'
        : real.getUTCFullYear() !== y || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d ? 'That date does not exist in the calendar.'
        : !/^\d{2}:\d{2}$/.test(time) ? 'Give the local time as hours:minutes, 24-hour, for example 19:30.'
        : h > 23 || mi > 59 ? 'That is not a time on the clock (00:00 to 23:59).'
        : !this.lat.value.trim() || !this.lon.value.trim() ? 'Choose a place, or give its latitude and longitude.'
        : 'That is not a place that exists (latitude within ±90°, longitude within ±180°).';
      this.setStatus('error', why);
      return;
    }
    this.setStatus('working', 'Computing the sky at that moment…');
    this.h.onCast(b);
  }

  // ── the answer ──────────────────────────────────────────────────────

  clearChart() {
    clear(this.result);
  }

  showChart(chart: SidecarChart) {
    clear(this.result);
    const nameOf = (k: BodyKey) => this.h.nameOf(k);
    this.result.append(el('p', { class: 'sky-birth-when', text: describeInstant(chart) }));
    const approx = approximationNote(chart);
    if (approx) this.result.append(el('p', { class: 'sky-birth-approx', role: 'note', text: approx }));
    for (const w of chart.warnings) this.result.append(el('p', { class: 'sky-birth-approx', role: 'note', text: w }));
    const moon = chartMoonPhase(chart);
    if (moon) this.result.append(el('p', { class: 'sky-birth-moon', text: `At that moment: ${moon}.` }));

    const list = el('ul', { class: 'sky-birth-rows', 'aria-label': 'Where the bodies stood, tropical zodiac, ecliptic of date' });
    for (const r of chartRows(chart, this.bodies, nameOf)) {
      const d = this.h.descent(r.key);
      list.append(el('li', { 'data-body': r.key }, [
        el('button', { type: 'button', class: 'link-quiet sky-birth-name', text: r.name, onclick: () => this.h.onBody(r.key) }),
        el('span', { class: 'sky-birth-place-at', text: r.place }),
        r.retrograde ? el('span', { class: 'sky-birth-retro', title: 'Retrograde: moving backward against the stars as seen from the Earth', text: '℞' }) : '',
        d ? el('button', { type: 'button', class: 'link-quiet sky-birth-descend', 'aria-label': `Descend to ${d.label}, through ${r.name}`, text: `→ ${d.label}`, onclick: () => this.h.onField(d.target) }) : '',
      ]));
    }
    this.result.append(list);
    this.result.append(el('p', { class: 'sky-birth-angles' }, [
      `Ascendant ${placeInSign(chart.angles.ascendant.lon)} · Midheaven ${placeInSign(chart.angles.midheaven.lon)}`,
      el('span', { class: 'sky-source', text: ` — the points of the ecliptic rising and culminating at that place and moment; ${chart.houses.effective} houses${chart.houses.effective !== chart.houses.requested ? ` (${chart.houses.requested} could not be used at this latitude)` : ''}.` }),
    ]));

    const aspect = el('input', { type: 'checkbox', 'aria-label': 'Draw the aspects as arcs' }) as HTMLInputElement;
    const house = el('input', { type: 'checkbox', 'aria-label': 'Draw the house cusps as a ring' }) as HTMLInputElement;
    aspect.checked = this.aspects;
    house.checked = this.houses;
    const sync = () => { this.aspects = aspect.checked; this.houses = house.checked; this.h.onDraw({ aspects: this.aspects, houses: this.houses }); };
    aspect.addEventListener('change', sync);
    house.addEventListener('change', sync);
    this.result.append(el('div', { class: 'sky-birth-draw' }, [
      el('label', {}, [aspect, el('span', { text: `Aspects as arcs (${chart.aspects.length})` })]),
      el('label', {}, [house, el('span', { text: `Houses as a ring (${chart.houses.effective})` })]),
    ]));
    if (chart.aspects.length) {
      this.result.append(el('details', { class: 'sky-birth-aspects' }, [
        el('summary', { text: 'The aspects, listed' }),
        el('ul', {}, chart.aspects.map((a) => el('li', { text: describeAspect(a, nameOf) }))),
        el('p', { class: 'sky-source', text: 'Angles between bodies as the sidecar found them, with their orb. They are geometry; this atlas gives them no meaning.' }),
      ]));
    }
    this.result.append(el('button', { type: 'button', class: 'link-quiet sky-birth-leave', text: 'Return to the present sky', onclick: () => this.h.onLeave() }));
    this.setStatus('idle', '');
    this.root.open = true;
  }

  /** Aspect and house arcs' standing choice, so the overlay can be set to it when a chart arrives. */
  get drawn() { return { aspects: this.aspects, houses: this.houses }; }
}
