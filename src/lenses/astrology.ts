// ASTROLOGY (MODES-RFC §3): your birth sky beside Jung's, walked planet by planet up the old ladder to the Sun, each
// planet read through the corpus: Jung's god-image and its field ties, Burt's reading of the planet and of the sign.
// The walk ends where every chart meets the field: the Sun, which Jung reads as a symbol of the self.
//
// Privacy law: the birth data and everything computed from it stay in this browser (src/practice/store.ts). The chart
// is computed here (src/astro/natal.ts); routes name a chart ('you', 'jung'), never a birth; nothing is sent anywhere.
import { clear, el } from '../ui/dom';
import { icon } from '../ui/icons';
import { subjectName, type Subject } from '../data/model';
import { ASTROLOGY_LIVE, astrologyAt, astrologyLive } from '../state/store';
import type { BirthPrefill } from '../state/router';
import type { LensContext, LensInstance } from '../shell/lens';
import { modeOptions, optionAction, optionGroup } from '../ui/mode-options';
import { birthProblems, deviceOffset, meanTimeOffset, natalChart, type BirthData, type ChartBody } from '../astro/natal';
import { chartSources, forgetLocalChart, saveLocalChart, YOU, type ChartRecord, type CuratedPerson } from '../astro/charts';
import type { BodyKey, GazetteerPlace, SidecarChart } from '../types/sky';
import { findPlaces, formatCoordinates } from '../sky/gazetteer';
import { SIGNS } from '../sky/frames';
import { glyphSvg, SIGN_FAMILY_IDS } from '../sky/zodiac';
import { combobox } from '../ui/combobox';
import { PlanetOrbits, type CardNode, type Satellite } from '../sky/orbits';
import { loadSkyCards, ringsFor, type PlacedQuote, type SkyCardsData } from '../sky/cards';
import { cardReading, type FieldPages } from './card-reading';
import { practice, saveFile } from '../practice/store';
import { loadLensData, privacyLine, quoteBlock, type LensQuote } from './ui';
import { creditLine } from '../ui/credit';

/** Apply a culture's planet names onto the standing Astrology sky (Charts stay put). */
function astrologySky(path: string[], culture?: string | null): ReturnType<typeof astrologyAt> {
  const base = astrologyAt(path);
  if (!culture) return base;
  return { ...base, sky: { ...base.sky, culture } };
}

interface Tie { target: Subject; basis: 'jung' | 'inferred' | 'site'; note: string; quotes: LensQuote[] }
interface BodyReading { key: ChartBody; name: string; line: string; quotes: LensQuote[]; ties: Tie[]; burt: LensQuote[] }
/** A curated person's portrait: Commons provenance, the same fields the image manifest records (ProjectCentral/docs/IMAGE-REGISTER-2026-10-09.md). */
interface Portrait { src: string; title?: string; credit?: string; license?: string }
interface AstrologyData {
  version: 1;
  gazetteer: { source: { claim: string }; places: GazetteerPlace[] };
  frame: LensQuote[];
  pillars: LensQuote;
  order: { bodies: ChartBody[]; line: string; quote: LensQuote };
  bodies: Record<ChartBody, BodyReading>;
  signs: Record<string, LensQuote>;
  people: (CuratedPerson & { quote: LensQuote; portrait?: Portrait | null })[];
}

const BASIS: Record<Tie['basis'], string> = { jung: 'Jung’s own link', inferred: 'the atlas’s inference', site: 'the atlas’s own link' };
const ASPECT_WORD: Record<string, string> = { conjunction: 'conjunct', opposition: 'opposite', trine: 'trine', square: 'square', sextile: 'sextile' };
const fmtDeg = (d: number) => `${Math.floor(d)}°`;
const placeIn = (c: SidecarChart, k: ChartBody) => { const p = c.bodies[k as BodyKey]!; return `${p.sign} ${fmtDeg(p.degree)}${p.retrograde ? ' (retrograde)' : ''}`; };

export function mount(ctx: LensContext): LensInstance {
  let data: AstrologyData | null = null;
  let failed = false;
  let editing = false;
  // the chart the walk stands in: "Back to the Earth" returns to its whole birth sky
  let walking: string | null = null;
  /** Planet names through a culture (Options → Names); stays with the Astrology sky. */
  let nameCulture: string | null = null;
  let pathNow: string[] = [];
  let namesReady = false;
  /** Body whose satellites are currently drawn — synced from the sky approach, not from the walk panel. */
  let orbitsBody: BodyKey | null = null;
  /** the satellites those are (kept, so a thing that arrives with the card data can join them) */
  let heldSats: Satellite[] = [];
  /** true between enter() and leave(): a data load that lands outside it must not render (it would reopen the sheet) */
  let inLens = false;
  /** the newest data load's token: a re-enter while a load is pending supersedes the older load */
  let loadToken = 0;
  const liveLine = el('p', { class: 'mode-opt-live', role: 'status' });
  const orbits = new PlanetOrbits(ctx.engine.renderer.domElement.parentElement ?? document.body, () => {
    // Whole sky: release the held planet onto the open chart / live sky (walking is unset on a live pick)
    const chart = walking || (pathNow[0] && pathNow[0] !== ASTROLOGY_LIVE ? pathNow[0] : null);
    if (chart) ctx.navigate(astrologyAt([chart]));
    else ctx.navigate(astrologyLive({ culture: nameCulture || undefined }));
  });
  // a birth an old link carried: fills the form until the chart is cast, then is gone (never stored from here)
  let prefill = ctx.takeBirthPrefill();
  const charts = new Map<string, { rec: ChartRecord; chart: SidecarChart & { timeKnown: boolean } }>();

  const refreshCharts = () => {
    charts.clear();
    if (!data) return;
    for (const rec of chartSources(data.people)) charts.set(rec.id, { rec, chart: natalChart(rec.birth) });
  };

  // the walk opens its sheet at half height: on a phone the body it holds stands in the space above it
  const show = (label: string, body: (HTMLElement | null)[], height?: 'half' | 'full') => {
    const nodes = body.filter((n): n is HTMLElement => !!n);
    if (ctx.panel.isOpen) ctx.panel.replace(nodes); else ctx.panel.open(label, nodes);
    if (height) ctx.panel.setHeight(height);
    // a walk step's sheet is not a local reading: its dismissal steps onto the whole sky, as it always did
    ctx.localSheet(false);
  };

  // ── the Self and the charts linked to it ───────────────────────────────
  const selfDiagram = (): HTMLElement => {
    const list = [...charts.values()];
    const W = 280, H = 190, cx = W / 2, cy = H / 2 + 4, R = 70;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'as-self');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `The Self at the centre, linked to ${list.map((c) => c.rec.label).join(' and ')} through each one's Sun`);
    const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text) n.textContent = text;
      svg.append(n);
      return n;
    };
    add('circle', { cx, cy, r: R, class: 'as-orbit' });
    list.forEach((c, i) => {
      const a = (-90 + (360 / Math.max(2, list.length)) * i + (list.length === 1 ? 0 : -60)) * (Math.PI / 180);
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      add('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'as-link' });
      add('circle', { cx: x, cy: y, r: 6, class: `as-node ${c.rec.source}` });
      const sun = c.chart.bodies.sun!;
      add('text', { x, y: y + (Math.sin(a) > 0 ? 20 : -12), class: 'as-label', 'text-anchor': 'middle' }, `${c.rec.label} · Sun in ${sun.sign}`);
    });
    add('circle', { cx, cy, r: 9, class: 'as-centre' });
    add('text', { x: cx, y: cy + 26, class: 'as-label centre', 'text-anchor': 'middle' }, 'the Self');
    const fig = el('figure', { class: 'as-figure' });
    fig.append(svg);
    return fig;
  };

  const sunToSelf = (): LensQuote | undefined => data?.bodies.sun.ties.find((t) => t.target.type === 'archetype' && t.target.id === 'self')?.quotes[0];

  // ── the twelve signs: a quiet row of their field families; no row when the field holds none of them ──
  const signsRow = (): HTMLElement | null => {
    const signs = SIGN_FAMILY_IDS.map((id, i) => ({ id, i, name: SIGNS[i], open: ctx.model.famById.has(id) }));
    if (!signs.some((s) => s.open)) return null;
    return el('section', { class: 'as-signs' }, [
      el('h3', { class: 'as-h3', text: 'The twelve signs' }),
      el('div', { class: 'as-sign-grid' }, signs.map((s) => el('button', {
        type: 'button', class: 'th-link as-sign', title: s.name, disabled: !s.open,
        onclick: s.open ? () => ctx.descend({ type: 'family', id: s.id }) : undefined,
      }, [el('span', { class: 'as-sign-name' }, [glyphSvg(s.i), el('span', { text: s.name })])]))),
    ]);
  };

  // ── the landing: the charts, the form, the Self ────────────────────────
  const renderHome = () => {
    orbits.set(null);
    if (!data) return;
    ctx.setContext('');
    const jung = charts.get('jung');
    const mine = charts.get(YOU);
    const portraitOf = (c: { rec: ChartRecord }) => c.rec.source === 'curated' ? (data!.people.find((p) => p.id === c.rec.id)?.portrait ?? null) : null;
    const chartCard = (c: { rec: ChartRecord; chart: SidecarChart & { timeKnown: boolean } }, mineToo: boolean) => {
      const portrait = portraitOf(c);
      return el('section', { class: 'as-card' }, [
        portrait ? el('figure', { class: 'as-portrait' }, [
          el('img', { src: portrait.src, alt: portrait.title ? `${c.rec.label} — ${portrait.title}` : c.rec.label, loading: 'lazy', width: 96 }),
          el('figcaption', { class: 'as-portrait-credit', text: creditLine(portrait) }),
        ]) : null,
        el('h3', { class: 'as-card-h', text: c.rec.label }),
        el('p', { class: 'as-card-p', text: `${c.rec.birth.date}${c.rec.birth.time ? `, ${c.rec.birth.time}${c.rec.clock ? ` ${c.rec.clock}` : ''}` : ''} · ${c.rec.birth.place || formatCoordinates(c.rec.birth.lat, c.rec.birth.lon)}` }),
        el('p', { class: 'as-pillars', text: `Sun ${placeIn(c.chart, 'sun')} · Moon ${placeIn(c.chart, 'moon')}${c.chart.timeKnown ? ` · Rising ${c.chart.angles.ascendant.sign} ${fmtDeg(c.chart.angles.ascendant.degree)}` : ''}` }),
        el('div', { class: 'lp-row' }, [
          el('button', { type: 'button', class: 'lp-btn primary', onclick: () => ctx.navigate(astrologyAt([c.rec.id])) }, [icon('astrology', 15), el('span', { text: c.rec.id === YOU ? 'Your sky' : `${c.rec.label}’s sky` })]),
          mineToo ? el('button', { type: 'button', class: 'lp-btn quiet', text: 'Change', onclick: () => { editing = true; renderHome(); } }) : null,
        ]),
      ]);
    };
    const body: (HTMLElement | null)[] = [
      privacyLine('Your birth data and your chart are kept only in this browser’s storage, and you can delete them below.'),
      el('p', { class: 'th-line', text: 'Enter a birthday and you get a walk through that sky, planet by planet, with what Jung and Kathleen Burt wrote about each planet and sign. Jung’s own chart is here as the first one, so you can read yours beside his.' }),
      quoteBlock(data.frame[0], ctx.passages),
      prefill ? el('p', { class: 'lp-note', text: 'Filled in from the link you opened. Nothing is kept until you cast the chart.' }) : null,
      mine && !editing && !prefill ? chartCard(mine, true) : form(prefill ? undefined : mine?.rec, prefill),
      jung ? chartCard(jung, false) : null,
      jung ? el('p', { class: 'lp-note', text: jung.rec.line ?? '' }) : null,
      jung?.rec.timeSource ? el('p', { class: 'lp-note', text: `The time is from ${jung.rec.timeSource}` }) : null,
      jung ? quoteBlock(data.people.find((p) => p.id === 'jung')!.quote, ctx.passages, { compact: true }) : null,
      signsRow(),
      el('hr', { class: 'lp-divider' }),
      el('h3', { class: 'as-h3', text: 'Where every chart meets the field' }),
      selfDiagram(),
      el('p', { class: 'th-line', text: 'Every walk here ends at the Sun, and Jung reads the sun as a symbol of the self. So whoever’s chart it is, the line runs to the same centre.' }),
      sunToSelf() ? quoteBlock(sunToSelf()!, ctx.passages, { compact: true }) : null,
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.descend({ type: 'archetype', id: 'self' }) }, [el('span', { text: 'The Self on the globe' }), icon('next', 14)]),
      el('details', { class: 'as-more' }, [
        el('summary', { text: 'Why planets, in a book about the psyche' }),
        ...data.frame.slice(1).map((q) => quoteBlock(q, ctx.passages, { compact: true })),
      ]),
      mine ? el('div', { class: 'lp-row as-own' }, [
        el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => saveFile('my-chart.json', practice.exportAll()) }, [icon('export', 14), el('span', { text: 'Save a copy' })]),
        el('button', { type: 'button', class: 'lp-btn quiet', onclick: () => { if (confirm('Delete your chart from this browser?')) { forgetLocalChart(); refreshCharts(); ctx.refreshNatal(); renderHome(); } } }, [icon('trash', 14), el('span', { text: 'Delete my chart' })]),
      ]) : null,
    ];
    show('Astrology', body);
  };

  // ── the birth form ─────────────────────────────────────────────────────
  const form = (existing?: ChartRecord, pre?: BirthPrefill | null): HTMLElement => {
    const b = existing?.birth;
    const name = el('input', { type: 'text', value: existing?.label && existing.label !== 'You' ? existing.label : '', placeholder: 'You', autocomplete: 'off', maxlength: 40 });
    const date = el('input', { type: 'date', value: b?.date ?? pre?.date ?? '', min: '1600-01-01', max: '2400-12-31', required: true });
    const time = el('input', { type: 'time', value: b?.time ?? pre?.time ?? '', step: 60 });
    const noTime = el('input', { type: 'checkbox', checked: !!b && !b.time });
    const place = el('input', { type: 'text', value: b?.place ?? '', placeholder: 'Start typing a city', autocomplete: 'off', spellcheck: 'false' });
    const lat = el('input', { type: 'number', step: '0.01', min: -89.9, max: 89.9, value: b ? String(b.lat) : pre ? String(pre.lat) : '', placeholder: 'Latitude, e.g. 47.37' });
    const lon = el('input', { type: 'number', step: '0.01', min: -180, max: 180, value: b ? String(b.lon) : pre ? String(pre.lon) : '', placeholder: 'Longitude, e.g. 8.54' });
    const offset = el('input', { type: 'number', step: '0.25', min: -14, max: 14, value: b ? String(b.offsetMinutes / 60) : '' });
    const offsetWhy = el('p', { class: 'lp-note' });
    const errors = el('div', { class: 'as-errors', role: 'alert' });
    let offsetTouched = !!b;
    const places = data!.gazetteer.places;
    // coordinates typed by hand are the visitor's; coordinates filled from the list follow the place field
    let coordsByHand = !!b && !places.some((p) => `${p.name}, ${p.country}` === b.place);
    const setPlace = (p: GazetteerPlace) => { lat.value = String(p.lat); lon.value = String(p.lon); coordsByHand = false; syncOffset(); };
    const syncPlace = () => {
      const q = place.value.trim();
      const hit = places.find((p) => `${p.name}, ${p.country}`.toLowerCase() === q.toLowerCase());
      if (hit) setPlace(hit);
      else if (!coordsByHand) { lat.value = ''; lon.value = ''; }
    };
    const placeBox = combobox<GazetteerPlace>(place, {
      suggest: (q) => findPlaces(places, q, 8).map((p) => ({ value: p, label: `${p.name}, ${p.country}`, detail: formatCoordinates(p.lat, p.lon) })),
      onPick: (o) => setPlace(o.value),
      empty: 'No city by that name in the list. Enter its latitude and longitude below.',
    });
    lat.addEventListener('input', () => { coordsByHand = true; });
    lon.addEventListener('input', () => { coordsByHand = true; });
    const syncOffset = () => {
      if (offsetTouched) return;
      const y = Number(date.value.slice(0, 4));
      const t = noTime.checked ? null : time.value || null;
      if (date.value && y < 1900 && lon.value) {
        offset.value = String(meanTimeOffset(Number(lon.value)) / 60);
        offsetWhy.textContent = 'Before 1900, local mean time: the clock set by the Sun at that longitude.';
      } else if (date.value) {
        offset.value = String(deviceOffset(date.value, t) / 60);
        offsetWhy.textContent = 'From this device’s own time zone on that date. If you were born in another zone, change it.';
      }
    };
    place.addEventListener('input', syncPlace);
    date.addEventListener('change', syncOffset);
    time.addEventListener('change', syncOffset);
    noTime.addEventListener('change', () => { time.disabled = noTime.checked; syncOffset(); });
    offset.addEventListener('input', () => { offsetTouched = true; offsetWhy.textContent = 'Set by you.'; });
    time.disabled = noTime.checked;
    if (!b) syncOffset();
    const submit = (e: Event) => {
      e.preventDefault();
      const birth: BirthData = {
        date: date.value, time: noTime.checked || !time.value ? null : time.value,
        offsetMinutes: Math.round(Number(offset.value) * 60), lat: Number(lat.value), lon: Number(lon.value), place: place.value.trim(),
      };
      const problems = lat.value === '' || lon.value === '' ? ['Choose a city from the list, or give the latitude and longitude.'] : birthProblems(birth);
      if (offset.value === '') problems.push('Give the clock’s offset from UTC.');
      errors.replaceChildren(...problems.map((p) => el('p', { text: p })));
      if (problems.length) return;
      prefill = null;
      saveLocalChart(name.value.trim() || 'You', birth);
      editing = false;
      refreshCharts();
      ctx.refreshNatal();
      ctx.navigate(astrologyAt([YOU]));
    };
    const field = (label: string, input: HTMLElement, extra?: HTMLElement) => el('label', { class: 'lp-field' }, [el('span', { text: label }), input, extra ?? null]);
    return el('form', { class: 'as-form', onsubmit: submit, novalidate: true }, [
      el('h3', { class: 'as-card-h', text: existing ? 'Change your chart' : 'Your chart' }),
      field('Name (optional)', name),
      field('Date of birth', date),
      el('div', { class: 'as-two' }, [field('Time', time), el('label', { class: 'as-check' }, [noTime, el('span', { text: 'I don’t know the time' })])]),
      field('Place', placeBox.root),
      el('details', { class: 'as-more', open: !!pre || (!!b && !places.some((p) => `${p.name}, ${p.country}` === b.place)) }, [
        el('summary', { text: 'Not in the list? Enter coordinates' }),
        el('div', { class: 'as-two' }, [field('Latitude', lat), field('Longitude', lon)]),
      ]),
      field('Clock offset from UTC, in hours', offset, offsetWhy),
      errors,
      el('div', { class: 'lp-row' }, [
        el('button', { type: 'submit', class: 'lp-btn primary' }, [icon('astrology', 15), el('span', { text: existing ? 'Save and see the sky' : 'Cast and see the sky' })]),
        existing ? el('button', { type: 'button', class: 'lp-btn quiet', text: 'Cancel', onclick: () => { editing = false; renderHome(); } }) : null,
      ]),
      el('p', { class: 'lp-note', text: `The place list is a short gazetteer of cities (${data!.gazetteer.source.claim.split('.')[0].toLowerCase()}). Nothing you type is looked up online.` }),
    ]);
  };

  // ── the walk ───────────────────────────────────────────────────────────
  /**
   * The birth sky with no sheet: chart held, Options under the title, planets pickable for approach + orbits.
   * Opening a walk step (path body) or Charts (empty path) is what brings the modal back.
   */
  const renderWholeSky = (chartId: string, walked: { rec: ChartRecord; chart: SidecarChart & { timeKnown: boolean } }) => {
    walking = chartId;
    const who = walked.rec.id === YOU ? 'Your' : `${walked.rec.label}’s`;
    const held = ctx.skyBody();
    const bodyName = held && held !== 'terra' ? data!.bodies[held as ChartBody]?.name : undefined;
    ctx.setContext(bodyName ? `${who} ${bodyName}` : `${who} birth sky`);
    ctx.panel.close();
  };

  const renderWalk = (chartId: string, bodyKey?: string) => {
    walking = chartId;
    if (!data) return;
    const walked = charts.get(chartId);
    if (!walked) { ctx.navigate(astrologyAt([])); return; }
    const order = data.order.bodies;
    // no body: the wide sky, the chart drawn on it. A walk is a choice, not the way in.
    if (!bodyKey || bodyKey === 'terra') { renderWholeSky(chartId, walked); return; }
    const key = bodyKey as ChartBody;
    if (!order.includes(key)) { ctx.setPath([chartId], { replace: true }); return; }
    const i = order.indexOf(key);
    const r = data.bodies[key];
    const others = [...charts.values()].filter((c) => c.rec.id !== chartId);
    const pos = walked.chart.bodies[key as BodyKey]!;
    const who = walked.rec.id === YOU ? 'Your' : `${walked.rec.label}’s`;
    ctx.setContext(`${who} ${r.name}`);

    const steps = el('nav', { class: 'as-steps', 'aria-label': 'The walk' }, order.map((k, j) => el('button', {
      type: 'button', class: `as-step${j < i ? ' past' : ''}`, 'aria-current': k === key ? 'step' : undefined, 'aria-label': data!.bodies[k].name, title: data!.bodies[k].name,
      onclick: () => ctx.setPath([chartId, k]),
    }, [el('span', { text: data!.bodies[k].name.slice(0, 2) })])));

    const compare = el('div', { class: 'as-compare' }, [
      el('div', { class: 'as-cmp mine' }, [el('span', { class: 'as-cmp-who', text: walked.rec.label }), el('span', { class: 'as-cmp-pos', text: placeIn(walked.chart, key) })]),
      ...others.map((o) => el('div', { class: 'as-cmp' }, [el('span', { class: 'as-cmp-who', text: o.rec.label }), el('span', { class: 'as-cmp-pos', text: placeIn(o.chart, key) })])),
    ]);
    const shared = others.filter((o) => o.chart.bodies[key as BodyKey]!.sign === pos.sign).map((o) => o.rec.label);

    // the relational truth: this planet's aspects in the walked chart, and its place beside the other chart's
    const aspects = walked.chart.aspects.filter((a) => a.a === key || a.b === key).map((a) => {
      const other = (a.a === key ? a.b : a.a) as ChartBody;
      return `${ASPECT_WORD[a.type] ?? a.type} ${data!.bodies[other]?.name ?? other} (orb ${a.orb.toFixed(1)}°)`;
    });

    // a quotation stands once in a step: a second tie resting on the same sentence shows its link alone
    const seen = new Set(r.quotes.map((q) => q.text));
    const once = (t: Tie): Tie => {
      const quotes = t.quotes.filter((q) => !seen.has(q.text));
      for (const q of quotes) seen.add(q.text);
      return { ...t, quotes };
    };
    const jungTies = r.ties.filter((t) => t.basis === 'jung');
    const otherTies = r.ties.filter((t) => t.basis !== 'jung');
    const tieBlock = (t: Tie) => el('div', { class: 'as-tie' }, [
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.descend(t.target) }, [el('span', {}, [el('span', { class: 'as-tie-name', text: subjectName(ctx.model, t.target) }), el('span', { class: 'as-basis', text: BASIS[t.basis] })]), icon('next', 14)]),
      ...t.quotes.slice(0, 1).map((q) => quoteBlock(q, ctx.passages, { compact: true })),
      t.basis !== 'jung' && t.note ? el('p', { class: 'lp-note', text: t.note }) : null,
    ]);
    const signQuote = data.signs[pos.sign];
    const noTimeMoon = key === 'moon' && !walked.chart.timeKnown;
    const last = i === order.length - 1;

    const body: (HTMLElement | null)[] = [
      steps,
      i === 0 ? el('p', { class: 'lp-note as-why', text: data.order.line }) : null,
      compare,
      el('p', { class: 'th-line', text: r.line }),
      noTimeMoon ? el('p', { class: 'lp-note', text: 'No birth time was given, so this Moon is the noon Moon: it may be up to about 7° from where it stood.' }) : null,
      shared.length ? el('p', { class: 'as-shared', text: `${shared.join(' and ')} had ${r.name} in ${pos.sign} too.` }) : null,
      ...r.quotes.map((q) => quoteBlock(q, ctx.passages)),
      jungTies.length ? el('h3', { class: 'as-h3', text: `What ${r.name} touches in the field` }) : null,
      ...jungTies.map(once).map(tieBlock),
      otherTies.length ? el('details', { class: 'as-more' }, [el('summary', { text: jungTies.length ? 'Links the atlas draws, not Jung' : 'Links the atlas draws (Jung gives none)' }), ...otherTies.map(once).map(tieBlock)]) : null,
      el('h3', { class: 'as-h3', text: `${r.name} in ${pos.sign}, as Kathleen Burt reads it` }),
      signQuote ? quoteBlock(signQuote, ctx.passages, { compact: true }) : null,
      ...r.burt.slice(0, 2).map((q) => quoteBlock(q, ctx.passages, { compact: true })),
      r.burt.length > 2 ? el('details', { class: 'as-more' }, [el('summary', { text: `More from Burt on ${r.name} (${r.burt.length - 2})` }), ...r.burt.slice(2).map((q) => quoteBlock(q, ctx.passages, { compact: true }))]) : null,
      aspects.length ? el('div', { class: 'as-aspects' }, [el('h3', { class: 'as-h3', text: 'How it stands to the others' }), el('ul', {}, aspects.map((a) => el('li', { text: a })))]) : null,
      i === 0 ? quoteBlock(data.pillars, ctx.passages, { compact: true }) : null,
      last ? el('hr', { class: 'lp-divider' }) : null,
      last ? el('h3', { class: 'as-h3', text: 'Where the walk ends' }) : null,
      last ? selfDiagram() : null,
      last ? quoteBlock(data.order.quote, ctx.passages, { compact: true }) : null,
      last ? el('button', { type: 'button', class: 'lp-btn primary as-to-self', onclick: () => ctx.descend({ type: 'archetype', id: 'self' }) }, [icon('self', 15), el('span', { text: 'Go to the Self' })]) : null,
      el('div', { class: 'th-step' }, [
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous planet', disabled: i === 0, onclick: () => ctx.setPath([chartId, order[i - 1]]) }, [icon('back')]),
        el('span', { class: 'th-count', text: `${i + 1} of ${order.length}` }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next planet', disabled: last, onclick: () => ctx.setPath([chartId, order[i + 1]]) }, [icon('next')]),
      ]),
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.navigate(astrologyAt([])) }, [el('span', { text: 'Back to the charts' }), icon('next', 14)]),
    ];
    show('Astrology walk', body, 'half');
  };

  const render = (path: string[]) => {
    if (!data) return;
    // ['sky'] = live Astrology sky (no modal, no natal). [chart] = birth sky. [chart, body] = walk. [] = Charts.
    if (path[0] === ASTROLOGY_LIVE) {
      walking = null;
      const held = path[1] ?? ctx.skyBody();
      // the Earth is held like a planet (the camera goes in to it): it is the sky's subject, so it titles the sky
      const bodyName = held === 'terra' ? 'Earth' : held ? data.bodies[held as ChartBody]?.name : undefined;
      ctx.setContext(bodyName ?? 'The sky');
      ctx.panel.close();
      return;
    }
    if (path[0] && path[1] && path[1] !== 'terra') renderWalk(path[0], path[1]);
    else if (path[0]) {
      const walked = charts.get(path[0]);
      if (!walked) { ctx.navigate(astrologyAt([])); return; }
      renderWholeSky(path[0], walked);
    } else renderHome();
  };

  // the lens lives as long as the page; another tab's change reaches it the next time it renders
  practice.onChange((c) => { if (c === 'charts') refreshCharts(); });

  /**
   * Archetype satellites for whatever body the sky is holding — canvas pick, walk step, or approach.
   * Not gated on the walk panel: the approached body is enough.
   */
  const syncOrbits = () => {
    if (!data) { if (orbitsBody) { orbits.set(null); orbitsBody = null; } return; }
    // approached body, sky.body from a canvas pick, or the walk step — any one is enough
    const key = ctx.engine.sky?.approached
      ?? ctx.skyBody()
      ?? (pathNow[1] && pathNow[1] !== 'terra' ? pathNow[1] as BodyKey : null);
    // the Earth is held where it stands (the system view): the elements Crowley writes beside it, and its cards
    if (key === 'terra') {
      if (key === orbitsBody) return;
      orbitsBody = key;
      orbits.set(key, []);
      void loadSkyCards().then((cards) => {
        if (!cards || orbitsBody !== key) return;
        const elements = (cards.bodies.terra?.elements ?? []).filter((id) => ctx.model.famById.has(id));
        orbits.set(key, elements.map((id) => ({
          id: `family:${id}`, name: subjectName(ctx.model, { type: 'family', id }), inner: false, open: () => ctx.focus({ type: 'family', id }),
        })));
        loadCards(key);
      });
      return;
    }
    if (!key || !data.bodies[key as ChartBody]) {
      if (orbitsBody) { orbits.set(null); orbitsBody = null; }
      return;
    }
    if (key === orbitsBody) return;
    orbitsBody = key;
    const r = data.bodies[key as ChartBody];
    const satSeen = new Set<string>();
    heldSats = r.ties.filter((t) => {
      const k = `${t.target.type}:${t.target.id}`;
      if (satSeen.has(k)) return false;
      satSeen.add(k);
      return true;
    }).map((t) => ({
      id: `${t.target.type}:${t.target.id}`,
      name: subjectName(ctx.model, t.target),
      inner: t.basis === 'jung',
      open: () => ctx.focus(t.target),
    }));
    orbits.set(key, heldSats);
    loadCards(key);
  };

  /**
   * A thing Crowley's list gives a body that the field holds no family for (Uranus is "the Abyss"): read from its placed
   * quotations alone, in the sheet at the planet — recorded, with nothing made up around it.
   */
  const openAnchor = (title: string, line: string, quotes: PlacedQuote[]) => {
    const nodes: HTMLElement[] = [
      el('h2', { class: 'lp-h', text: title }),
      el('p', { class: 'th-line', text: line }),
      ...quotes.map((q) => quoteBlock(q as LensQuote, ctx.passages, { compact: true })),
      el('p', { class: 'lp-note', text: 'The field holds no family for this, so there is no page to read it in; these are the words it rests on.' }),
    ];
    show(title, nodes, 'half');
    ctx.localSheet(true);
    ctx.panel.reveal();
  };

  /**
   * A card on a planet's ring, opened: its reading in the lens's sheet, here at the planet. Nothing gazes at the Earth
   * or leaves the sky — a card has no place on the Earth to point back to — and closing the sheet returns to the planet
   * with its rings still standing.
   */
  const openCard = (cards: SkyCardsData, id: string, key: BodyKey) => {
    void loadLensData<FieldPages>('field-pages').catch(() => null).then((pages) => {
      if (!inLens) return;
      const nodes = cardReading({
        model: ctx.model, passages: ctx.passages, data: cards, pages, id, body: key,
        bodyName: (k) => (k === 'terra' ? 'Earth' : data?.bodies[k as ChartBody]?.name ?? k),
        open: (s) => ctx.descend(s),
        openBody: (k) => ctx.openBody(k),
      });
      show('A card at the planet', nodes, 'half');
      ctx.localSheet(true);
      ctx.panel.reveal();
    });
  };

  /** The planet's tarot cards, floated on the two outer rings once their data is in (a body with none gets none). */
  const loadCards = (key: BodyKey) => {
    void loadSkyCards().then((cards) => {
      if (!cards || orbitsBody !== key) return;
      // the Abyss: Crowley's list gives it to Uranus; the field has no family for it, so it stands as a quotation only
      const b = cards.bodies[key];
      if (b?.abyss && b.positionQuotes.length && !heldSats.some((x) => x.id === 'anchor:abyss')) {
        heldSats = [...heldSats, { id: 'anchor:abyss', name: 'The Abyss', inner: false, open: () => openAnchor('The Abyss', 'Crowley’s list of the ten bodies of the solar system sets the Abyss under the number 3 and gives it to Herschel, which is Uranus. It is not a sephira, so it has no number of its own and no cards.', [...(cards.list ? [cards.list] : []), ...b.positionQuotes]) } satisfies Satellite];
        orbits.set(key, heldSats);
      }
      const rings = ringsFor(cards, key);
      if (!rings) { orbits.setCards(key, []); return; }
      const bodyName = key === 'terra' ? 'Earth' : data?.bodies[key as ChartBody]?.name ?? key;
      const hint = (rc: { role: string; id: string; decan?: number }): string => {
        const c = cards.cards[rc.id];
        if (rc.role === 'decan') return `${SIGNS[c.sign ?? 0]} ${c.n ?? ''}: a decan ${bodyName} rules`.replace(' :', ':');
        if (rc.role === 'rank') return `the ${c.number === 1 ? 'Aces' : `${['', '', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens'][c.number ?? 0]}`}: ${bodyName}’s number in Crowley’s list`;
        if (rc.role === 'ruler') return `an Atu of ${SIGNS[c.sign ?? 0]}, which ${bodyName} rules`;
        if (rc.role === 'element') return 'an Atu Crowley gives to an element';
        return `an Atu attributed to ${bodyName}`;
      };
      const nodes: CardNode[] = [...rings.decan, ...rings.rank].map((rc) => ({
        ring: rc, name: cards.cards[rc.id].name, hint: hint(rc), plate: cards.cards[rc.id].image, open: () => openCard(cards, rc.id, key),
      }));
      orbits.setCards(key, nodes);
    });
  };

  const paintLive = () => {
    clear(liveLine);
    const s = ctx.skyStatus();
    if (!s) { liveLine.removeAttribute('data-state'); return; }
    liveLine.dataset.state = s.state;
    liveLine.append(el('strong', { text: s.label }), ` · ${s.detail}`);
  };

  const goPath = (path: string[], culture: string | null = nameCulture) => {
    ctx.navigate(culture ? astrologySky(path, culture) : astrologyAt(path));
  };

  const astrologyOptions = (path: string[]) => {
    pathNow = path;
    const skyCultures = ctx.engine.sky?.data.cultures;
    if (skyCultures) namesReady = true;
    paintLive();
    const live = path[0] === ASTROLOGY_LIVE;
    const chart = live ? null : path[0];
    const onSky = live || (!!chart && !path[1]);
    const names = [
      optionAction('Greco-Roman (default)', () => {
        nameCulture = null;
        if (live) ctx.navigate(astrologyLive({ body: path[1] as BodyKey | undefined }));
        else goPath(onSky && chart ? [chart] : path, null);
      }, { pressed: !nameCulture }),
      ...(skyCultures
        ? Object.keys(skyCultures).map((id) => optionAction(
          ctx.model.cultureById.get(id)?.name ?? id,
          () => {
            nameCulture = id;
            if (live) ctx.navigate(astrologyLive({ body: path[1] as BodyKey | undefined, culture: id }));
            else goPath(onSky && chart ? [chart] : path, id);
          },
          { pressed: nameCulture === id },
        ))
        : []),
    ];
    // the names are a reading choice, not a request to read: they never open the sheet (the shell reads data-no-reveal)
    for (const n of names) n.setAttribute('data-no-reveal', '');
    const walk = chart && data
      ? optionAction('Walk the planets', () => goPath([chart, data!.order.bodies[0]]), {
        pressed: !!path[1] && path[1] !== 'terra',
        description: 'Planet by planet through the birth sky',
      })
      : null;
    ctx.setControls([modeOptions([
      optionGroup('Read the chart', [
        optionAction('Charts', () => goPath([]), { pressed: !path[0], description: 'Jung’s chart and your birth form' }),
        walk,
      ]),
      optionGroup('Names', names),
      liveLine,
      liveLine,
    ])]);
  };

  return {
    enter(path) {
      inLens = true;
      astrologyOptions(path);
      if (data) { render(path); syncOrbits(); return; }
      if (failed) return;
      const token = ++loadToken;
      ctx.panel.open('Astrology', [el('p', { class: 'lp-sub', text: 'Loading…' })], { height: 'full' });
      loadLensData<AstrologyData>('astrology').then((d) => {
        // the user left while the data loaded (or left and came back: the newer load renders): nothing reopens
        if (!inLens || token !== loadToken) return;
        data = d;
        refreshCharts();
        astrologyOptions(path);
        render(path);
        syncOrbits();
      }).catch((err) => {
        console.error(err);
        // a failure after leaving is not shown; it is not remembered either, so the next enter tries again
        if (!inLens || token !== loadToken) return;
        failed = true;
        ctx.panel.replace([el('p', { class: 'lp-error', text: 'The astrology data is not available in this build.' })]);
      });
    },
    leave() {
      inLens = false;
      editing = false;
      nameCulture = null;
      namesReady = false;
      orbitsBody = null;
      orbits.set(null);
      ctx.setControls(null);
    },
    update(dt) {
      if (!namesReady && ctx.engine.sky?.data.cultures) astrologyOptions(pathNow);
      paintLive();
      syncOrbits();
      orbits.update(ctx.engine.sky ?? null, dt, ctx.engine.reduced);
    },
  };
}

