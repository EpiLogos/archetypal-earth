// ASTROLOGY (MODES-RFC §3): your birth sky beside Jung's, walked planet by planet up the old ladder to the Sun, each
// planet read through the corpus: Jung's god-image and its field ties, Burt's reading of the planet and of the sign.
// The walk ends where every chart meets the field: the Sun, which Jung reads as a symbol of the self.
//
// Privacy law: the birth data and everything computed from it stay in this browser (src/practice/store.ts). The chart
// is computed here (src/astro/natal.ts); routes name a chart ('you', 'jung'), never a birth; nothing is sent anywhere.
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { subjectName, type Subject } from '../data/model';
import { astrologyAt } from '../state/store';
import type { BirthPrefill } from '../state/router';
import type { LensContext, LensInstance } from '../shell/lens';
import { birthProblems, deviceOffset, meanTimeOffset, natalChart, type BirthData, type ChartBody } from '../astro/natal';
import { chartSources, forgetLocalChart, saveLocalChart, YOU, type ChartRecord, type CuratedPerson } from '../astro/charts';
import type { BodyKey, GazetteerPlace, SidecarChart } from '../types/sky';
import { findPlaces, formatCoordinates } from '../sky/gazetteer';
import { practice, saveFile } from '../practice/store';
import { loadLensData, privacyLine, quoteBlock, type LensQuote } from './ui';
import { creditLine } from '../ui/credit';

interface Tie { target: Subject; basis: 'jung' | 'inferred' | 'site'; note: string; quotes: LensQuote[] }
interface BodyReading { key: ChartBody; name: string; line: string; quotes: LensQuote[]; ties: Tie[]; burt: LensQuote[] }
/** A curated person's portrait: Commons provenance, the same fields the image manifest records (docs/IMAGE-REGISTER-2026-10-09.md). */
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
  // a birth an old link carried: fills the form until the chart is cast, then is gone (never stored from here)
  let prefill = ctx.takeBirthPrefill();
  const charts = new Map<string, { rec: ChartRecord; chart: SidecarChart & { timeKnown: boolean } }>();

  const refreshCharts = () => {
    charts.clear();
    if (!data) return;
    for (const rec of chartSources(data.people)) charts.set(rec.id, { rec, chart: natalChart(rec.birth) });
  };

  const show = (label: string, body: (HTMLElement | null)[]) => {
    const nodes = body.filter((n): n is HTMLElement => !!n);
    if (ctx.panel.isOpen) ctx.panel.replace(nodes); else ctx.panel.open(label, nodes);
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

  // ── the landing: the charts, the form, the Self ────────────────────────
  const renderHome = () => {
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
          el('button', { type: 'button', class: 'lp-btn primary', onclick: () => ctx.navigate(astrologyAt([c.rec.id])) }, [icon('astrology', 15), el('span', { text: c.rec.id === YOU ? 'Walk your sky' : `Walk ${c.rec.label}’s sky` })]),
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
      el('hr', { class: 'lp-divider' }),
      el('h3', { class: 'as-h3', text: 'Where every chart meets the field' }),
      selfDiagram(),
      el('p', { class: 'th-line', text: 'Every walk here ends at the Sun, and Jung reads the sun as a symbol of the self. So whoever’s chart it is, the line runs to the same centre.' }),
      sunToSelf() ? quoteBlock(sunToSelf()!, ctx.passages, { compact: true }) : null,
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus({ type: 'archetype', id: 'self' }) }, [el('span', { text: 'The Self on the globe' }), icon('next', 14)]),
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
    const place = el('input', { type: 'text', value: b?.place ?? '', placeholder: 'Start typing a city', autocomplete: 'off', list: 'as-places' });
    const datalist = el('datalist', { id: 'as-places' });
    const lat = el('input', { type: 'number', step: '0.01', min: -89.9, max: 89.9, value: b ? String(b.lat) : pre ? String(pre.lat) : '', placeholder: 'Latitude, e.g. 47.37' });
    const lon = el('input', { type: 'number', step: '0.01', min: -180, max: 180, value: b ? String(b.lon) : pre ? String(pre.lon) : '', placeholder: 'Longitude, e.g. 8.54' });
    const offset = el('input', { type: 'number', step: '0.25', min: -14, max: 14, value: b ? String(b.offsetMinutes / 60) : '' });
    const offsetWhy = el('p', { class: 'lp-note' });
    const errors = el('div', { class: 'as-errors', role: 'alert' });
    let offsetTouched = !!b;
    const places = data!.gazetteer.places;
    const syncPlace = () => {
      const q = place.value.trim();
      datalist.replaceChildren(...findPlaces(places, q, 8).map((p) => el('option', { value: `${p.name}, ${p.country}` })));
      const hit = places.find((p) => `${p.name}, ${p.country}`.toLowerCase() === q.toLowerCase());
      if (hit) { lat.value = String(hit.lat); lon.value = String(hit.lon); syncOffset(); }
    };
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
      field('Place', place, datalist),
      el('details', { class: 'as-more', open: !!pre || (!!b && !places.some((p) => `${p.name}, ${p.country}` === b.place)) }, [
        el('summary', { text: 'Not in the list? Enter coordinates' }),
        el('div', { class: 'as-two' }, [field('Latitude', lat), field('Longitude', lon)]),
      ]),
      field('Clock offset from UTC, in hours', offset, offsetWhy),
      errors,
      el('div', { class: 'lp-row' }, [
        el('button', { type: 'submit', class: 'lp-btn primary' }, [icon('astrology', 15), el('span', { text: existing ? 'Save and walk' : 'Cast and walk' })]),
        existing ? el('button', { type: 'button', class: 'lp-btn quiet', text: 'Cancel', onclick: () => { editing = false; renderHome(); } }) : null,
      ]),
      el('p', { class: 'lp-note', text: `The place list is a short gazetteer of cities (${data!.gazetteer.source.claim.split('.')[0].toLowerCase()}). Nothing you type is looked up online.` }),
    ]);
  };

  // ── the walk ───────────────────────────────────────────────────────────
  const renderWalk = (chartId: string, bodyKey?: string) => {
    if (!data) return;
    const walked = charts.get(chartId);
    if (!walked) { ctx.navigate(astrologyAt([])); return; }
    const order = data.order.bodies;
    const key = (order.includes(bodyKey as ChartBody) ? bodyKey : order[0]) as ChartBody;
    if (key !== bodyKey) { ctx.setPath([chartId, key], { replace: true }); return; }
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
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.focus(t.target) }, [el('span', {}, [el('span', { class: 'as-tie-name', text: subjectName(ctx.model, t.target) }), el('span', { class: 'as-basis', text: BASIS[t.basis] })]), icon('next', 14)]),
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
      last ? el('button', { type: 'button', class: 'lp-btn primary as-to-self', onclick: () => ctx.focus({ type: 'archetype', id: 'self' }) }, [icon('self', 15), el('span', { text: 'Go to the Self' })]) : null,
      el('div', { class: 'th-step' }, [
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous planet', disabled: i === 0, onclick: () => ctx.setPath([chartId, order[i - 1]]) }, [icon('back')]),
        el('span', { class: 'th-count', text: `${i + 1} of ${order.length}` }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next planet', disabled: last, onclick: () => ctx.setPath([chartId, order[i + 1]]) }, [icon('next')]),
      ]),
      el('button', { type: 'button', class: 'th-link', onclick: () => ctx.navigate(astrologyAt([])) }, [el('span', { text: 'Back to the charts' }), icon('next', 14)]),
    ];
    show('Astrology walk', body);
  };

  const render = (path: string[]) => {
    if (!data) return;
    if (path[0]) renderWalk(path[0], path[1]); else renderHome();
  };

  // the lens lives as long as the page; another tab's change reaches it the next time it renders
  practice.onChange((c) => { if (c === 'charts') refreshCharts(); });

  return {
    enter(path) {
      if (data) { render(path); return; }
      if (failed) return;
      ctx.panel.open('Astrology', [el('p', { class: 'lp-sub', text: 'Loading…' })], { height: 'full' });
      loadLensData<AstrologyData>('astrology').then((d) => { data = d; refreshCharts(); render(path); }).catch((err) => {
        failed = true;
        console.error(err);
        ctx.panel.replace([el('p', { class: 'lp-error', text: 'The astrology data is not available in this build.' })]);
      });
    },
    leave() {
      editing = false;
    },
  };
}

