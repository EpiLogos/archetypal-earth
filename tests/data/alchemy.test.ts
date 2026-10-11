// The Alchemy lens's data (public/data/alchemy.json, built by scripts/alchemy.mjs from curation/alchemy.json): every
// quotation placed by the corpus and verbatim on its page, every name the field must hold checked, the errors loud and
// the build deterministic. The fixture is a temporary root with a small curation whose quotations are sentences of the
// read-only vault's Jung (cw12, cw14), each copied from a verified candidate. Also the lens's routes (pure) and its
// registration (the menu, the built set, the panel loader, the hash).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error Plain ESM shared with the generators.
import { DEFAULT_VAULT } from '../../scripts/lib/vault.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { verify, workLoader } from '../../scripts/lib/cite.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { buildAlchemy } from '../../scripts/alchemy.mjs';
import { alchemyPath, parseAlchemyRoute, type AlchemyIds, type AlchemyRoute } from '../../src/lenses/alchemy-route';
import { BUILT, LENSES, PANEL_LOADERS } from '../../src/shell/lens';
import { PANEL_LENSES } from '../../src/state/store';
import { hashToState, type Resolver } from '../../src/state/router';

const ROOT = path.resolve(__dirname, '..', '..');
const load = workLoader(DEFAULT_VAULT);

// the quotations: copied from the verified candidates (harvest-opus-*.json, harvest-materials-metals.json), each placed
const Q = {
  nigredo: { work: 'cw12', para: 334, quote: 'The nigredo or blackness (fig. 115) is the initial state, either present from the beginning as a quality of the prima materia, the chaos or massa confusa, or else produced by the separation (solutio, separatio, divisio, putrefactio) of the elements.' },
  albedo: { work: 'cw12', para: 334, quote: 'The albedo is, so to speak, the daybreak, but not till the rubedo is it sunrise.' },
  citrinitas: { work: 'cw12', para: 334, quote: 'The transition to the rubedo is formed by the citrinitas, though this, as we have said, was omitted later.' },
  rubedo: { work: 'cw14', para: 307, quote: 'The alchemists termed this the rubedo, in which the marriage of the red man and the white woman, Sol and Luna, is consummated.' },
  nigredoPsy: { work: 'cw12', para: 41, quote: 'The author of this sentence must have been undergoing the experience of the nigredo, the first stage of the work, which was felt as “melancholia” in alchemy and corresponds to the encounter with the shadow in psychology.' },
  albedoPsy: { work: 'cw14', para: 219, quote: 'it is during her work of whitening that the illumination takes place.' },
  citrinitasPsy: { work: 'cw12', para: 271, quote: 'In alchemy yellow (citrinitas) often coincides with the rubedo.' },
  rubedoPsy: { work: 'cw14', para: 441, quote: 'who has risen up from “blackest shade” to the pure whiteness of Luna and attained his redness (rubedo) through the solificatio.' },
  bridgeA: { work: 'cw12', para: 31, quote: 'In alchemy there are three as well as four regimina or procedures, three as well as four colours.' },
  bridgeB: { work: 'cw12', para: 220, quote: 'The fact is that the four colours in the dream represent the transition from trinity to quaternity' },
  elements: { work: 'cw14', para: 281, quote: 'which combines in itself the four alchemical colours, black, white, red, and yellow' },
  calcinatio: { work: 'cw14', para: 247, quote: 'As the expulsion of the spirit was effected by various kinds of burning (combustio, adustio, calcinatio, assatio, sublimatio, incineratio, etc.), it was natural to call the end-product “ash”' },
  solutio: { work: 'cw14', para: 721, quote: 'The nigredo signifies the mortificatio, putrefactio, solutio, separatio, divisio, etc., a state of dissolution and decomposition that precedes the synthesis.' },
  coagulatio: { work: 'cw14', para: 134, quote: 'the coagulating sulphur, which in the corporal gold was turned outwards [extroversion], is turned inwards' },
  mercurius0: { work: 'cw12', para: 84, quote: 'As the planet Mercury, he is nearest to the sun, hence he is pre-eminently related to gold.' },
  mercurius1: { work: 'cw12', para: 84, quote: 'But, as quicksilver, he dissolves the gold and extinguishes its sunlike brilliance.' },
};

const BASE = {
  version: 1,
  line: 'Fixture line.',
  opus: {
    line: 'Fixture opus line.',
    stages: [
      { id: 'nigredo', family: 'nigredo', name: 'Nigredo', colour: 'black', line: 'Fixture.', quotes: [Q.nigredo], psyche: { line: 'Fixture.', quotes: [Q.nigredoPsy] }, operations: ['solutio'], subjects: [{ type: 'archetype', id: 'shadow' }] },
      { id: 'albedo', family: 'albedo', name: 'Albedo', colour: 'white', line: 'Fixture.', quotes: [Q.albedo], psyche: { line: 'Fixture.', quotes: [Q.albedoPsy] }, operations: ['calcinatio'], subjects: [{ type: 'family', id: 'water' }] },
      { id: 'citrinitas', family: 'citrinitas', name: 'Citrinitas', colour: 'yellow', line: 'Fixture.', quotes: [Q.citrinitas], psyche: { line: 'Fixture.', quotes: [Q.citrinitasPsy] }, operations: [], subjects: [] },
      { id: 'rubedo', family: 'rubedo', name: 'Rubedo', colour: 'red', line: 'Fixture.', quotes: [Q.rubedo], psyche: { line: 'Fixture.', quotes: [Q.rubedoPsy] }, operations: ['coagulatio'], subjects: [{ type: 'theoretic', id: 'psychoid' }] },
    ],
    bridge: { line: 'Fixture.', quotes: [Q.bridgeA, Q.bridgeB] },
  },
  operations: [
    { id: 'calcinatio', name: 'Calcinatio', line: 'Fixture.', quotes: [Q.calcinatio], stage: 'albedo', subjects: [{ type: 'family', id: 'fire' }] },
    { id: 'solutio', name: 'Solutio', line: 'Fixture.', quotes: [Q.solutio], stage: 'nigredo', subjects: [{ type: 'family', id: 'water' }] },
    { id: 'coagulatio', name: 'Coagulatio', line: 'Fixture.', quotes: [Q.coagulatio], subjects: [] },
  ],
  matter: [{ id: 'mercurius', name: 'Mercurius', line: 'Fixture.', quotes: [Q.mercurius0, Q.mercurius1], subjects: [{ type: 'family', id: 'mercurius' }] }],
  elements: { line: 'Fixture.', quotes: [Q.elements], subjects: [{ type: 'family', id: 'fire' }, { type: 'family', id: 'water' }] },
};

const FIELD = {
  families: ['nigredo', 'albedo', 'citrinitas', 'rubedo', 'fire', 'water', 'mercurius'].map((id) => ({ id })),
  archetypes: [{ id: 'shadow' }],
  theoretics: [{ id: 'psychoid' }],
};

const roots: string[] = [];
afterAll(() => { for (const d of roots) fs.rmSync(d, { recursive: true, force: true }); });

/** A temporary root: public/data/field.json and (when given) curation/alchemy.json. */
function fixtureRoot(curation: unknown, field: unknown = FIELD): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alchemy-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'public', 'data'), { recursive: true });
  if (field) fs.writeFileSync(path.join(root, 'public', 'data', 'field.json'), JSON.stringify(field));
  if (curation) {
    fs.mkdirSync(path.join(root, 'curation'), { recursive: true });
    fs.writeFileSync(path.join(root, 'curation', 'alchemy.json'), JSON.stringify(curation));
  }
  return root;
}

const clone = () => JSON.parse(JSON.stringify(BASE)) as typeof BASE;
/** The errors a curation gives after one change to it. */
function errorsAfter(change: (c: any) => void): string[] {
  const c: any = clone();
  change(c);
  return buildAlchemy({ root: fixtureRoot(c), vault: DEFAULT_VAULT }).errors;
}

type Quote = { text: string; cite: { work: string; workTitle: string; locator: string } };
/** Every quotation object of a published alchemy file. */
function quotesOf(d: any): Quote[] {
  const out: Quote[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o.text === 'string' && o.cite) out.push(o as unknown as Quote);
      for (const v of Object.values(o)) walk(v);
    }
  };
  walk(d);
  return out;
}

describe('the alchemy data is placed by the corpus', () => {
  it('the curation places every quotation on its cited page, with no errors', () => {
    const { data, errors } = buildAlchemy({ root: fixtureRoot(clone()), vault: DEFAULT_VAULT });
    expect(errors).toEqual([]);
    expect(data.version).toBe(1);
    expect(data.opus.stages.map((s: { id: string }) => s.id)).toEqual(['nigredo', 'albedo', 'citrinitas', 'rubedo']);
    expect(data.opus.stages[0].quotes[0].cite).toMatchObject({ work: 'cw12', locator: '¶334 (pdf p245)' });
    expect(data.opus.stages[0].psyche.quotes[0].cite.locator).toBe('¶41 (pdf p65)');
    expect(data.operations.find((o: { id: string }) => o.id === 'solutio').stage).toBe('nigredo');
    expect(data.operations.find((o: { id: string }) => o.id === 'coagulatio')).not.toHaveProperty('stage');
    expect(data.matter[0].quotes).toHaveLength(2);
    for (const q of quotesOf(data)) expect(q.cite.locator, q.text.slice(0, 30)).toMatch(/^(?:¶\d+ \(pdf p\d+\)|pdf p\d+)$/);
  }, 120_000);

  it('every placed quotation stands verbatim on its cited page of the read-only vault', () => {
    const { data } = buildAlchemy({ root: fixtureRoot(clone()), vault: DEFAULT_VAULT });
    const qs = quotesOf(data);
    // 4 stages, 4 psychological readings, 2 bridge, 3 operations, 2 matter, 1 elements
    expect(qs.length).toBe(16);
    expect(qs.map((q) => verify(load, { work: q.cite.work, locator: q.cite.locator, quote: q.text })).filter(Boolean)).toEqual([]);
  }, 120_000);

  it('the same curation gives the same published data', () => {
    const root = fixtureRoot(clone());
    const a = buildAlchemy({ root, vault: DEFAULT_VAULT });
    const b = buildAlchemy({ root, vault: DEFAULT_VAULT });
    expect(a.data).toEqual(b.data);
  }, 120_000);

  it('a quotation that does not place exactly once is an error that names its stage', () => {
    const errors = errorsAfter((c) => { c.opus.stages[0].quotes[0].quote = Q.nigredo.quote.replace('blackness', 'darkness'); });
    expect(errors.some((e) => e.startsWith('stage nigredo:'))).toBe(true);
  }, 120_000);

  it('a stage that names a family the field lacks is an error', () => {
    expect(errorsAfter((c) => { c.opus.stages[0].family = 'nope'; })).toContain('stage nigredo: no family nope in the field');
  });

  it('a subject the field does not hold is an error, and a subject of another kind is refused', () => {
    expect(errorsAfter((c) => { c.opus.stages[1].subjects = [{ type: 'archetype', id: 'nope' }]; })).toContain('stage albedo: no archetype nope in the field');
    expect(errorsAfter((c) => { c.matter[0].subjects = [{ type: 'family', id: 'nope' }]; })).toContain('matter mercurius: no family nope in the field');
    expect(errorsAfter((c) => { c.elements.subjects = [{ type: 'culture', id: 'gnostic' }]; })).toContain('elements: a subject of type culture is not a family, archetype or theoretic');
  });

  it('an operation a stage names must be in the operations list, and an operation\'s stage must be a stage of the opus', () => {
    expect(errorsAfter((c) => { c.opus.stages[0].operations = ['nope']; })).toContain('stage nigredo: no operation nope in the operations list');
    expect(errorsAfter((c) => { c.operations[0].stage = 'nope'; })).toContain('operation calcinatio: no stage nope in the opus');
  });

  it('stage, operation and matter ids are each named once', () => {
    expect(errorsAfter((c) => { c.opus.stages[1].id = 'nigredo'; })).toContain('stage nigredo is named twice');
    expect(errorsAfter((c) => { c.operations[2].id = 'solutio'; })).toContain('operation solutio is named twice');
    expect(errorsAfter((c) => { c.matter.push({ ...c.matter[0] }); })).toContain('matter mercurius is named twice');
  });

  it('a stage with no psychological reading is an error', () => {
    expect(errorsAfter((c) => { c.opus.stages[2].psyche.line = ''; })).toContain('stage citrinitas: the psychological reading has no line');
  });

  it('a missing curation file is a clear error, not a crash', () => {
    const built = buildAlchemy({ root: fixtureRoot(null), vault: DEFAULT_VAULT });
    expect(built.data).toBeNull();
    expect(built.errors).toEqual([expect.stringMatching(/curation\/alchemy\.json is missing/)]);
  });

  it('a missing field is a clear error, not a crash', () => {
    const built = buildAlchemy({ root: fixtureRoot(clone(), null), vault: DEFAULT_VAULT });
    expect(built.data).toBeNull();
    expect(built.errors).toEqual([expect.stringMatching(/field\.json is missing/)]);
  });

  // the published file, once the curation is published: it is what the sources give now, with no hand edits
  const published = path.join(ROOT, 'public', 'data', 'alchemy.json');
  (fs.existsSync(published) ? it : it.skip)('the published file is what the sources give now', () => {
    const built = buildAlchemy({ vault: DEFAULT_VAULT });
    expect(built.errors).toEqual([]);
    expect(JSON.parse(fs.readFileSync(published, 'utf8'))).toEqual(built.data);
  }, 120_000);
});

const IDS: AlchemyIds = { stages: ['nigredo', 'albedo', 'citrinitas', 'rubedo'], operations: ['calcinatio', 'solutio', 'coagulatio'], matter: ['mercurius'] };

describe('the alchemy routes parse, and write back to the same path', () => {
  it('each section, its stage, operation or matter item, and the unknown ones falling back to the nearest section', () => {
    const r = (p: string[]) => parseAlchemyRoute(p, IDS);
    expect(r([])).toEqual({ section: 'opus' });
    expect(r(['opus'])).toEqual({ section: 'opus' });
    expect(r(['opus', 'albedo'])).toEqual({ section: 'opus', stage: 'albedo' });
    expect(r(['opus', 'nope'])).toEqual({ section: 'opus' });
    expect(r(['operations'])).toEqual({ section: 'operations' });
    expect(r(['operations', 'solutio'])).toEqual({ section: 'operations', id: 'solutio' });
    expect(r(['operations', 'nope'])).toEqual({ section: 'operations' });
    expect(r(['matter', 'mercurius'])).toEqual({ section: 'matter', id: 'mercurius' });
    expect(r(['matter', 'nope'])).toEqual({ section: 'matter' });
    expect(r(['elements'])).toEqual({ section: 'elements' });
    expect(r(['elements', 'extra'])).toEqual({ section: 'elements' });
    expect(r(['nope'])).toEqual({ section: 'opus' });
  });

  it('a route written as a path parses back to itself', () => {
    const routes: AlchemyRoute[] = [
      { section: 'opus' }, { section: 'opus', stage: 'rubedo' }, { section: 'operations' },
      { section: 'operations', id: 'calcinatio' }, { section: 'matter' }, { section: 'matter', id: 'mercurius' }, { section: 'elements' },
    ];
    for (const route of routes) expect(parseAlchemyRoute(alchemyPath(route), IDS)).toEqual(route);
    expect(alchemyPath({ section: 'opus' })).toEqual([]);
    expect(alchemyPath({ section: 'opus', stage: 'albedo' })).toEqual(['opus', 'albedo']);
  });
});

describe('the lens is registered: the menu, the built set, the loader and the hash', () => {
  const resolver: Resolver = {
    hasArchetype: () => false, hasTheoretic: () => false, hasFamily: () => false, hasCulture: () => false, hasPlace: () => false,
    familyOf: () => undefined,
  };

  it('Alchemy is a read lens listed after Theory, with its shortcut, and it is built and loaded on first use', () => {
    const i = LENSES.findIndex((l) => l.id === 'alchemy');
    expect(i).toBe(LENSES.findIndex((l) => l.id === 'theory') + 1);
    expect(LENSES[i]).toMatchObject({ label: 'Alchemy', icon: 'alchemy', group: 'read', key: 'L' });
    expect(BUILT.has('alchemy')).toBe(true);
    expect(PANEL_LENSES).toContain('alchemy');
    expect(typeof PANEL_LOADERS.alchemy).toBe('function');
  });

  it('the router reads the lens routes into its path', () => {
    const at = (hash: string) => hashToState(hash, resolver).state.lens;
    expect(at('#/alchemy')).toEqual({ id: 'alchemy', path: [] });
    expect(at('#/alchemy/opus/nigredo')).toEqual({ id: 'alchemy', path: ['opus', 'nigredo'] });
    expect(at('#/alchemy/operations/solutio')).toEqual({ id: 'alchemy', path: ['operations', 'solutio'] });
    expect(at('#/alchemy/elements')).toEqual({ id: 'alchemy', path: ['elements'] });
  });
});
