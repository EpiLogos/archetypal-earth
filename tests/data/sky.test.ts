import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error Plain ESM data generator, shared with the CLI.
import { checkSidecarPin, collectCites, crossCheckOrbits, formatSky, pinnedPackages, validateCuration, validateGazetteer, verifyCitations } from '../../scripts/sky.mjs';
import type { Field } from '../../src/types/field';
import { BODY_KEYS, HELIO_KEYS, type SkyData } from '../../src/types/sky';

const ROOT = path.resolve(__dirname, '..', '..');
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const sky: SkyData = readJson('public/data/sky.json');
const field: Field = readJson('public/data/field.json');
const curation = { bodies: readJson('curation/sky/bodies.json'), ties: readJson('curation/sky/ties.json'), cultures: readJson('curation/sky/cultures.json') };
const copy = <T,>(value: T): T => structuredClone(value);
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('the gazetteer behind the birth sky', () => {
  const gaz = readJson('curation/sky/gazetteer.json');

  it('is valid, sourced, and published into sky.json unchanged', () => {
    expect(validateGazetteer(gaz)).toEqual([]);
    expect(sky.gazetteer).toEqual(gaz);
  });

  it('refuses a missing source, a place off the Earth, and a duplicate', () => {
    const bad = copy(gaz);
    bad.source.ref = '';
    bad.places[0].lat = 91;
    bad.places[1].lon = -181;
    bad.places.push(copy(bad.places[2]));
    const errors = validateGazetteer(bad).join('\n');
    expect(errors).toMatch(/source\.ref/);
    expect(errors).toMatch(/lat must be within/);
    expect(errors).toMatch(/lon must be within/);
    expect(errors).toMatch(/duplicate place/);
    expect(validateGazetteer({})).not.toEqual([]);
  });

  it('holds the places of Jung\u2019s own life and a spread of the world\u2019s time zones', () => {
    const names = gaz.places.map((p: { name: string }) => p.name);
    for (const n of ['Kesswil', 'Basel', 'Zürich', 'Küsnacht', 'Bollingen', 'Vienna']) expect(names).toContain(n);
    const lons = gaz.places.map((p: { lon: number }) => p.lon);
    expect(Math.min(...lons)).toBeLessThan(-150);
    expect(Math.max(...lons)).toBeGreaterThan(170);
    const lats = gaz.places.map((p: { lat: number }) => p.lat);
    expect(Math.min(...lats)).toBeLessThan(-35);
  });
});

describe('sky curation', () => {
  it('satisfies the contract and resolves every body, tie and culture against the published field', () => {
    expect(validateCuration(curation, { field })).toEqual([]);
  });

  it('holds all eleven bodies, Pluto among them, with the modern three dated', () => {
    expect(sky.bodies.map((b) => b.key)).toEqual([...BODY_KEYS]);
    expect(sky.bodies.filter((b) => b.modern).map((b) => [b.key, b.discovered?.year])).toEqual([['uranus', 1781], ['neptune', 1846], ['pluto', 1930]]);
  });

  it('tags every tie with its basis, cites every jung tie, and keeps a field link on every body', () => {
    for (const body of sky.bodies) {
      expect(body.ties.length, body.key).toBeGreaterThan(0);
      for (const tie of body.ties) {
        expect(['jung', 'inferred', 'site']).toContain(tie.basis);
        if (tie.basis === 'jung') expect(tie.cites?.length, `${body.key}→${tie.target.id}`).toBeGreaterThan(0);
        if (tie.basis === 'site') expect(tie.cites).toBeUndefined();
        const known = tie.target.type === 'family' ? field.families : field.archetypes;
        expect(known.some((x) => x.id === tie.target.id), `${body.key}→${tie.target.id}`).toBe(true);
      }
    }
  });

  it('keeps the modern bodies honestly editorial: no Jung-basis tie for Uranus, Neptune or Pluto', () => {
    for (const key of ['uranus', 'neptune', 'pluto']) {
      expect(sky.bodies.find((b) => b.key === key)!.ties.every((t) => t.basis === 'site'), key).toBe(true);
    }
  });

  it('carries the syzygy / coniunctio reading for Sun and Moon with cited passages', () => {
    const reading = sky.readings.find((r) => r.id === 'self-as-coniunctio')!;
    expect(reading.bodies).toEqual(['sun', 'moon']);
    expect(reading.cites.length).toBeGreaterThanOrEqual(2);
    expect(reading.targets.map((t) => t.id)).toEqual(['coniunctio', 'syzygy', 'self']);
    for (const key of ['sun', 'moon']) {
      const ids = sky.bodies.find((b) => b.key === key)!.ties.map((t) => t.target.id);
      expect(ids).toEqual(expect.arrayContaining(['coniunctio', 'syzygy']));
    }
  });

  it('labels the culture reprojection with a basis for every cell', () => {
    for (const per of Object.values(sky.cultures)) for (const cell of Object.values(per)) {
      expect(['jung', 'inferred', 'site']).toContain(cell.basis);
      expect(cell.source.length).toBeGreaterThan(10);
    }
    expect(Object.keys(sky.cultures)).toEqual(expect.arrayContaining(['mesopotamian', 'greek', 'roman', 'indian', 'chinese']));
  });

  it('every cited quotation is verbatim on its cited page of the read-only vault; a fabricated one is refused', () => {
    // No skip: a missing corpus is a failed source acceptance check, as in the Aion tests.
    expect(verifyCitations(collectCites(curation), { vault: process.env.JUNG_VAULT })).toEqual([]);
    const forged = copy(curation.ties.ties.find((t: { cites?: unknown[] }) => t.cites?.length));
    forged.cites[0].quote += ' and the atlas predicts the future';
    expect(verifyCitations([{ cite: forged.cites[0], where: 'forged' }])).toEqual([expect.stringContaining('quotation not verbatim')]);
  });

  it('refuses an unresolved link, an uncited Jung tie and an undated modern body', () => {
    const bad = copy(curation);
    bad.ties.ties.push({ body: 'mars', target: { type: 'family', id: 'not-a-family' }, basis: 'jung', note: 'x' });
    bad.bodies.bodies.find((b: { key: string }) => b.key === 'pluto').discovered = undefined;
    const errors: string[] = validateCuration(bad, { field });
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('unresolved family not-a-family'), expect.stringContaining('needs a cited passage'), expect.stringContaining('dated discovery')]));
  });
});

describe('generated sky data', () => {
  it('names its sidecar and kernel, and the sidecar pin matches requirements.txt', () => {
    expect(sky.meta.sidecar.name).toBe('archetypal-earth-ephemeris');
    expect(sky.meta.ephemeris.kernel).toBe('de440');
    expect(Number.isFinite(Date.parse(sky.meta.generatedAt))).toBe(true);
    expect(checkSidecarPin({ name: sky.meta.sidecar.name, version: sky.meta.sidecar.version, packages: sky.meta.sidecar.packages }, ROOT)).toEqual([]);
    expect(pinnedPackages(ROOT).kerykeion).toBe(sky.meta.sidecar.packages.kerykeion);
    const wrong = { name: 'x', version: '9', packages: { kerykeion: '0.0.0' } };
    expect(checkSidecarPin(wrong, ROOT).length).toBeGreaterThanOrEqual(3);
  });

  it('samples the live span at the stated cadence, with finite equal-length columns', () => {
    const planetCount = Math.floor((Date.parse(sky.meta.span.to) - Date.parse(sky.meta.span.from)) / 3_600_000 / sky.planets.stepHours) + 1;
    expect(sky.planets.count).toBe(planetCount);
    expect(sky.moon.count).toBe(Math.floor((Date.parse(sky.meta.span.to) - Date.parse(sky.meta.span.from)) / 3_600_000 / sky.moon.stepHours) + 1);
    // the last sample never lies beyond the stated span
    expect(Date.parse(sky.planets.start) + (sky.planets.count - 1) * sky.planets.stepHours * 3_600_000).toBeLessThanOrEqual(Date.parse(sky.meta.span.to));
    expect(Object.keys(sky.planets.bodies).sort()).toEqual([...HELIO_KEYS].sort());
    for (const grid of [sky.planets, sky.moon]) for (const col of Object.values(grid.bodies)) {
      for (const k of ['lon', 'lat', 'r'] as const) {
        expect(col![k]).toHaveLength(grid.count);
        expect(col![k].every(Number.isFinite)).toBe(true);
      }
      expect(Math.min(...col!.lon)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...col!.lon)).toBeLessThan(360);
    }
  });

  it('agrees with independently known facts of the sky', () => {
    const j2000 = sky.golden.epochs.find((e) => e.label === 'J2000.0')!;
    // Apparent solar longitude at J2000.0 is 280.37° (Meeus, Astronomical Algorithms ch. 25); the Moon's is 223.32°.
    expect(angDiff(j2000.sun!.lon, 280.37)).toBeLessThan(0.02);
    expect(angDiff(j2000.moon!.lon, 223.32)).toBeLessThan(0.05);
    // The Earth's heliocentric longitude is the Sun's geocentric longitude + 180°.
    expect(angDiff(j2000.earth!.lon, j2000.sun!.lon + 180)).toBeLessThan(0.05);
    // Sidereal time at J2000.0 is 280.46° (the IAU definition's value at 12h TT).
    expect(angDiff(j2000.gmst!, 280.4606)).toBeLessThan(0.01);
    // The subsolar latitude is the solar declination: ≈ −23.03° in early January.
    expect(j2000.subsolar!.lat).toBeCloseTo(-23.03, 1);
    // Ayanamsa definitions: Lahiri 23°51′25.5″ at J2000.0.
    expect(j2000.ayanamsa.lahiri).toBeCloseTo(23.857, 2);
  });

  it('keeps every orbit constant consistent with the sampled radii', () => {
    expect(crossCheckOrbits(sky.bodies, sky.planets, sky.moon)).toEqual([]);
  });

  it('records dates the kernel cannot reach as outside the range, never approximated', () => {
    const bce = sky.golden.epochs.find((e) => e.calendar === 'julian')!;
    expect(bce.status).toBe('outside-ephemeris-range');
    expect(bce.sun).toBeUndefined();
    expect(typeof bce.reason).toBe('string');
    expect(Number.isFinite(bce.ayanamsa['fagan-bradley'])).toBe(true);
  });

  it('ships the ayanamsa table across ±13 millennia and the IAU boundaries in order', () => {
    const years = sky.golden.ayanamsa.table.map((r) => r.year);
    expect(years[0]).toBe(-13000);
    expect(years[years.length - 1]).toBe(13000);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
    const lon = sky.golden.constellationBoundaries.map((b) => b.lon);
    expect([...lon].sort((a, b) => a - b)).toEqual(lon);
    expect(lon.length).toBe(13);
    const aqrPsc = sky.golden.constellationBoundaries.find((b) => b.from === 'Aqr' && b.to === 'Psc')!;
    expect(aqrPsc.lon).toBeCloseTo(351.65, 1);
  });

  it('is byte-stable under its own formatter', () => {
    expect(`${formatSky(sky)}\n`).toBe(fs.readFileSync(path.join(ROOT, 'public/data/sky.json'), 'utf8'));
  });
});
