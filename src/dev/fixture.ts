// Synthetic Field used ONLY when /data/field.json is absent (dev, before the
// data pipeline has landed). Deterministic; images are generated SVG plates so
// every image code path can be exercised, and ~1/3 of occurrences have none.
import type { Archetype, Culture, Family, Field, GeoPrecision, ImageRef, Occurrence, Palette } from '../types/field';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(7);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function plate(seed: number, p: Palette, w: number, h: number, title: string): ImageRef {
  const r = rng(seed * 977 + 13);
  const [hh] = hexToHsl(p.core);
  const c1 = p.core, c2 = hslHex((hh + 40 + r() * 40) % 360, 0.45, 0.35), c3 = p.fog;
  const cx = 30 + r() * 40, cy = 28 + r() * 40;
  const rings = Array.from({ length: 6 }, (_, i) => `<circle cx="${cx}%" cy="${cy}%" r="${6 + i * (7 + r() * 5)}%" fill="none" stroke="${i % 2 ? c1 : '#fff'}" stroke-opacity="${(0.1 + r() * 0.22).toFixed(2)}" stroke-width="${(0.4 + r() * 2.2).toFixed(1)}"/>`).join('');
  const arcs = Array.from({ length: 4 }, () => {
    const x0 = r() * w, y0 = r() * h, x1 = r() * w, y1 = r() * h;
    return `<path d="M${x0.toFixed(0)} ${y0.toFixed(0)} Q ${(w / 2 + (r() - 0.5) * w).toFixed(0)} ${(h / 2 + (r() - 0.5) * h).toFixed(0)} ${x1.toFixed(0)} ${y1.toFixed(0)}" fill="none" stroke="${c1}" stroke-opacity="0.35" stroke-width="${(1 + r() * 5).toFixed(1)}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs><radialGradient id="g" cx="${cx}%" cy="${cy}%" r="85%"><stop offset="0" stop-color="${c1}"/><stop offset=".45" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></radialGradient><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .09 0"/></filter></defs><rect width="100%" height="100%" fill="url(#g)"/>${rings}${arcs}<rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return { src: uri, thumb: uri, width: w, height: h, tone: c2, title, credit: 'Synthetic plate', license: 'Dev fixture', sourceUrl: '' };
}

const A: [string, string, string, number, Palette][] = [
  ['self', 'Self', 'The whole that holds the opposites, and the centre that orients them.', 0.9, { core: '#f4ecd0', glow: '#c9b27c', fog: '#2b2540', deep: '#0b0912' }],
  ['shadow', 'Shadow', 'What the light casts behind it, and the life we refuse.', 0.1, { core: '#c25a74', glow: '#7a2f78', fog: '#241034', deep: '#07030c' }],
  ['anima', 'Anima', 'The soul-image, watery and unlooked-for.', 0.5, { core: '#7fd6d0', glow: '#3b8fc0', fog: '#0f2c42', deep: '#030b13' }],
  ['animus', 'Animus', 'The spirit-voice that speaks in convictions.', 0.65, { core: '#93a9ee', glow: '#5b61c8', fog: '#161d4a', deep: '#04061a' }],
  ['great-mother', 'Great Mother', 'Origin and devourer, cave and cradle.', 0.22, { core: '#e09a62', glow: '#b05a3a', fog: '#34190f', deep: '#0b0504' }],
  ['wise-old-man', 'Wise Old Man', 'Meaning arriving as a figure of age.', 0.78, { core: '#bcd6ee', glow: '#7aa2cf', fog: '#17283f', deep: '#040810' }],
  ['trickster', 'Trickster', 'Boundary-crosser, breaker of the settled.', 0.38, { core: '#b7d46c', glow: '#639a3e', fog: '#192a10', deep: '#050a03' }],
  ['hero', 'Hero', 'The ego\'s victory over the dark, and its cost.', 0.82, { core: '#ffeab8', glow: '#e69a50', fog: '#3a2414', deep: '#0d0705' }],
  ['child', 'Child', 'Future and beginning, small and invincible.', 0.7, { core: '#f6c8e0', glow: '#b88ad2', fog: '#2c1c46', deep: '#070410' }],
];

// family: id, name, subtype, aliases, [archetype ids], one line
const F: [string, string, Family['subtype'], string[], string[], string][] = [
  ['serpent', 'Serpent', 'figure', ['snake', 'ophis', 'naga'], ['self', 'shadow', 'great-mother'], 'Renewal and poison in one coil.'],
  ['tree', 'Tree', 'object', ['world tree', 'arbor'], ['self', 'great-mother'], 'The axis between ground and sky.'],
  ['mandala', 'Mandala', 'object', ['circle', 'yantra'], ['self'], 'The order a psyche draws around its centre.'],
  ['cave', 'Cave', 'scene', ['grotto', 'cavern'], ['great-mother', 'shadow'], 'The dark interior where images are born.'],
  ['vessel', 'Vessel', 'object', ['grail', 'cauldron', 'vas'], ['great-mother', 'anima', 'self'], 'The container in which change can happen.'],
  ['sun', 'Sun', 'object', ['helios', 'sol'], ['hero', 'self', 'wise-old-man'], 'Consciousness as radiance.'],
  ['moon', 'Moon', 'object', ['luna', 'selene'], ['anima', 'great-mother'], 'The reflected light, tidal and changeful.'],
  ['labyrinth', 'Labyrinth', 'scene', ['maze'], ['shadow', 'self'], 'The way in that is also the way through.'],
  ['flood', 'Flood', 'scene', ['deluge'], ['shadow', 'great-mother'], 'The unconscious rising over the dry ground.'],
  ['cross', 'Cross', 'object', ['quaternity'], ['self'], 'Four directions meeting at a point.'],
  ['crown', 'Crown', 'object', [], ['hero', 'self'], 'Authority made visible.'],
  ['mountain', 'Mountain', 'object', ['meru', 'olympus'], ['wise-old-man', 'self'], 'The place where the world touches the heights.'],
  ['dragon', 'Dragon', 'figure', ['drake', 'tiamat', 'long'], ['shadow', 'hero'], 'The guardian of the treasure, hard to reach.'],
  ['lion', 'Lion', 'figure', [], ['hero', 'self'], 'Sovereign instinct, gold-eyed.'],
  ['bird', 'Bird', 'figure', ['phoenix', 'thunderbird'], ['wise-old-man', 'anima'], 'Messenger between the depth and the air.'],
  ['fish', 'Fish', 'figure', ['ichthys'], ['self', 'child'], 'The silent inhabitant of the deep.'],
  ['twins', 'Twins', 'figure', ['dioscuri', 'gemini'], ['shadow', 'hero'], 'The self and its double, set side by side.'],
  ['androgyne', 'Androgyne', 'figure', ['rebis', 'hermaphrodite'], ['anima', 'animus', 'self'], 'The union of opposites in one body.'],
  ['divine-child', 'Divine Child', 'figure', ['puer', 'infant'], ['child', 'self'], 'Beginning that carries the whole.'],
  ['trickster-figure', 'Trickster Figure', 'figure', ['coyote', 'hermes', 'loki', 'eshu'], ['trickster'], 'The one who undoes and remakes the rules.'],
  ['old-sage', 'Old Sage', 'figure', ['senex', 'merlin', 'hermit'], ['wise-old-man'], 'The elder who knows the way back.'],
  ['great-goddess', 'Great Goddess', 'figure', ['magna mater', 'isis', 'demeter', 'cybele'], ['great-mother'], 'The mother who gives and withholds.'],
];

interface Pl { n: string; lat: number; lon: number; c: string; y: number }
// place, lat, lon, culture, rough era anchor
const P: Pl[] = [
  { n: 'Alexandria, Egypt', lat: 31.2, lon: 29.9, c: 'hellenistic-egypt', y: 150 },
  { n: 'Teotihuacan, Mexico', lat: 19.69, lon: -98.84, c: 'mesoamerica', y: 300 },
  { n: 'Nineveh, Iraq', lat: 36.36, lon: 43.15, c: 'mesopotamia', y: -700 },
  { n: 'Delphi, Greece', lat: 38.48, lon: 22.5, c: 'greek', y: -450 },
  { n: 'Angkor, Cambodia', lat: 13.41, lon: 103.87, c: 'khmer', y: 1150 },
  { n: 'Chartres, France', lat: 48.447, lon: 1.487, c: 'latin-christian', y: 1200 },
  { n: 'Lascaux, France', lat: 45.05, lon: 1.17, c: 'palaeolithic-europe', y: -2900 },
  { n: 'Bodh Gaya, India', lat: 24.7, lon: 84.99, c: 'indic', y: -200 },
  { n: 'Lhasa, Tibet', lat: 29.65, lon: 91.1, c: 'tibetan', y: 1300 },
  { n: 'Uppsala, Sweden', lat: 59.86, lon: 17.64, c: 'norse', y: 950 },
  { n: 'Cusco, Peru', lat: -13.52, lon: -71.97, c: 'andean', y: 1450 },
  { n: 'Thebes, Egypt', lat: 25.7, lon: 32.64, c: 'pharaonic-egypt', y: -1300 },
  { n: 'Kyoto, Japan', lat: 35.01, lon: 135.77, c: 'japanese', y: 1100 },
  { n: 'Beijing, China', lat: 39.9, lon: 116.4, c: 'chinese', y: 1400 },
  { n: 'Benin City, Nigeria', lat: 6.34, lon: 5.62, c: 'west-african', y: 1500 },
  { n: 'Arnhem Land, Australia', lat: -12.9, lon: 134.0, c: 'aboriginal-australia', y: -2000 },
  { n: 'Ohio, USA', lat: 39.02, lon: -83.43, c: 'north-american', y: 1070 },
  { n: 'Basel, Switzerland', lat: 47.56, lon: 7.59, c: 'latin-alchemy', y: 1560 },
  { n: 'Prague, Bohemia', lat: 50.08, lon: 14.43, c: 'latin-alchemy', y: 1600 },
  { n: 'Jerusalem', lat: 31.78, lon: 35.22, c: 'hebrew', y: -900 },
  { n: 'Ephesus, Turkey', lat: 37.94, lon: 27.36, c: 'greek', y: -300 },
  { n: 'Rome, Italy', lat: 41.9, lon: 12.5, c: 'roman', y: 100 },
  { n: 'Florence, Italy', lat: 43.77, lon: 11.26, c: 'renaissance-italy', y: 1480 },
  { n: 'Ravenna, Italy', lat: 44.42, lon: 12.2, c: 'byzantine', y: 540 },
  { n: 'Küsnacht, Switzerland', lat: 47.32, lon: 8.58, c: 'modern-psychology', y: 1928 },
  { n: 'Taos, New Mexico', lat: 36.4, lon: -105.57, c: 'pueblo', y: 1925 },
  { n: 'Mount Elgon, Kenya', lat: 1.13, lon: 34.55, c: 'east-african', y: 1926 },
  { n: 'Varanasi, India', lat: 25.32, lon: 83.0, c: 'indic', y: 1100 },
  { n: 'Konya, Turkey', lat: 37.87, lon: 32.49, c: 'sufi', y: 1250 },
  { n: 'Reykjavik, Iceland', lat: 64.15, lon: -21.94, c: 'norse', y: 1250 },
  { n: 'Q\'umarkaj, Guatemala', lat: 15.02, lon: -91.2, c: 'mesoamerica', y: 1550 },
  { n: 'Uruk, Iraq', lat: 31.32, lon: 45.64, c: 'mesopotamia', y: -2900 },
  { n: 'Knossos, Crete', lat: 35.3, lon: 25.16, c: 'minoan', y: -1600 },
  { n: 'Glastonbury, England', lat: 51.15, lon: -2.71, c: 'celtic', y: 1190 },
  { n: 'Isfahan, Iran', lat: 32.65, lon: 51.67, c: 'persian', y: 1600 },
];

const CULTURE_NAMES: Record<string, string> = {};
for (const p of P) CULTURE_NAMES[p.c] = p.c.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const FORMS = ['relief', 'manuscript page', 'dream-image', 'ritual', 'carved figure', 'fresco', 'myth episode', 'seal', 'vision', 'painted vessel'];
const WORKS: [string, string, string][] = [
  ['cw12', 'Psychology and Alchemy (CW12)', '1944'],
  ['cw9i', 'The Archetypes and the Collective Unconscious (CW9i)', '1954'],
  ['cw14', 'Mysterium Coniunctionis (CW14)', '1955'],
  ['cw5', 'Symbols of Transformation (CW5)', '1952'],
  ['cw11', 'Psychology and Religion (CW11)', '1938'],
  ['cw13', 'Alchemical Studies (CW13)', '1929'],
];

// hand-set anchors: family, label, place index (by name), year, yearDisplay, precision
const HAND: [string, string, string, number, string, GeoPrecision][] = [
  ['serpent', 'Ouroboros of the Chrysopoeia', 'Alexandria, Egypt', 300, '~3rd c.', 'place'],
  ['serpent', 'Feathered Serpent at the Citadel', 'Teotihuacan, Mexico', 200, '~200', 'place'],
  ['serpent', 'Rainbow Serpent', 'Arnhem Land, Australia', -2500, 'millennia old', 'culture'],
  ['serpent', 'Nagas of the Bayon', 'Angkor, Cambodia', 1190, '~1190', 'place'],
  ['serpent', 'Midgard Serpent', 'Uppsala, Sweden', 1000, '~11th c.', 'culture'],
  ['serpent', 'Serpent Mound', 'Ohio, USA', 1070, '~1070', 'place'],
  ['serpent', 'Mercurius Serpens', 'Prague, Bohemia', 1600, '~1600', 'region'],
  ['serpent', 'Brazen Serpent', 'Jerusalem', -900, '~9th c. BCE', 'place'],
  ['tree', 'Tree of Jesse window', 'Chartres, France', 1145, '~1145', 'place'],
  ['tree', 'Bodhi Tree', 'Bodh Gaya, India', -200, '3rd c. BCE', 'place'],
  ['tree', 'Yggdrasil', 'Uppsala, Sweden', 1000, '~11th c.', 'culture'],
  ['tree', 'Ceiba, the world axis', 'Q\'umarkaj, Guatemala', 700, '~700', 'region'],
  ['tree', 'Arbor Philosophica', 'Basel, Switzerland', 1560, '~1560', 'place'],
  ['mandala', 'Kalachakra Mandala', 'Lhasa, Tibet', 1300, '~14th c.', 'place'],
  ['mandala', 'Rose Window', 'Chartres, France', 1220, '~1220', 'place'],
  ['mandala', 'Stone of the Sun', 'Teotihuacan, Mexico', 1479, '1479', 'region'],
  ['mandala', 'Mandala drawings', 'Küsnacht, Switzerland', 1928, '1928', 'place'],
  ['cave', 'Lascaux, the painted hall', 'Lascaux, France', -2900, '~17,000 BCE (nominal)', 'place'],
  ['cave', 'Corycian Cave', 'Delphi, Greece', -450, '5th c. BCE', 'place'],
  ['cave', 'Mithraeum', 'Rome, Italy', 150, '~2nd c.', 'place'],
  ['vessel', 'Gundestrup Cauldron', 'Uppsala, Sweden', -100, '~100 BCE', 'region'],
  ['vessel', 'The Grail at Glastonbury', 'Glastonbury, England', 1190, '~1190', 'place'],
  ['vessel', 'Vas Hermeticum', 'Basel, Switzerland', 1560, '~1560', 'place'],
  ['sun', 'Sol Invictus', 'Rome, Italy', 274, '274', 'place'],
  ['sun', 'Inti', 'Cusco, Peru', 1450, '~1450', 'place'],
  ['sun', 'Aten disc', 'Thebes, Egypt', -1345, '~1345 BCE', 'region'],
  ['moon', 'Artemis of Ephesus', 'Ephesus, Turkey', -300, '~300 BCE', 'place'],
  ['moon', 'Hecate\'s crossroads', 'Delphi, Greece', -400, '4th c. BCE', 'region'],
  ['labyrinth', 'Labyrinth of Knossos', 'Knossos, Crete', -1600, '~1600 BCE', 'place'],
  ['labyrinth', 'Chartres labyrinth', 'Chartres, France', 1200, '~1200', 'place'],
  ['flood', 'Utnapishtim\'s deluge', 'Nineveh, Iraq', -700, '7th c. BCE tablet', 'place'],
  ['dragon', 'Tiamat', 'Uruk, Iraq', -1100, '~12th c. BCE', 'culture'],
  ['dragon', 'Imperial Dragon', 'Beijing, China', 1420, '~1420', 'place'],
  ['twins', 'Hero Twins of the Popol Vuh', 'Q\'umarkaj, Guatemala', 1550, '~1550', 'place'],
  ['androgyne', 'Rebis of the Rosarium', 'Prague, Bohemia', 1550, '~1550', 'region'],
  ['divine-child', 'Child at Eleusis', 'Delphi, Greece', -600, '~600 BCE', 'region'],
  ['old-sage', 'The Hermit of Taos', 'Taos, New Mexico', 1925, '1925', 'region'],
  ['trickster-figure', 'Eshu at the crossroads', 'Benin City, Nigeria', 1500, '~1500', 'culture'],
  ['great-goddess', 'Isis suckling Horus', 'Thebes, Egypt', -1000, '~1000 BCE', 'place'],
];

export function buildFixture(): Field {
  const archetypes: Archetype[] = [];
  const families: Family[] = [];
  const occurrences: Occurrence[] = [];
  let imgSeed = 1;

  const archPal = new Map<string, { p: Palette; s: number }>();
  for (const [id, name, line, s, p] of A) {
    archPal.set(id, { p, s });
    archetypes.push({ id, name, oneLine: line, prime: id === 'self', spectrum: { position: s }, palette: p,
      definition: { text: `The ${name.toLowerCase()} is not invented but found; it arrives as image before it arrives as idea.`, cite: 'CW9i ¶6 (fixture)' },
      body: [`${name} appears in this fixture as a stand-in for the vault's own reading. ${line}`, 'Longer deep-layer text will come from the vault body. This paragraph exists to let the typography be judged at length: the measure, the leading, the rhythm of a Garamond set quietly against a dark sheet of glass.'],
      image: plate(imgSeed++, p, 900, 1100, name), familyIds: [], occurrenceCount: 0 });
  }

  for (const [id, name, subtype, aliases, archIds, line] of F) {
    const base = archPal.get(archIds[0])!;
    const [h, s, l] = hexToHsl(base.p.core);
    const jit = (id.length * 17) % 40 - 20;
    const palette: Palette = {
      core: hslHex((h + jit + 360) % 360, Math.min(0.75, s * 0.95), Math.min(0.78, l)),
      glow: hslHex((h + jit * 1.3 + 360) % 360, 0.5, 0.45),
      fog: base.p.fog,
      deep: base.p.deep,
    };
    const spec = archIds.reduce((a, x) => a + archPal.get(x)!.s, 0) / archIds.length;
    families.push({ id, name, subtype, aliases, oneLine: line, archetypes: archIds.map((a, i) => ({ id: a, basis: i === 0 ? 'jung' : 'inferred' as const })),
      spectrum: { position: spec }, palette, body: [`${name}: ${line} Appears across traditions in forms that differ in every detail and echo in structure.`, 'A second paragraph sits here to show how family-level reading runs in the deep sheet.'],
      image: plate(imgSeed++, palette, 1000, 760, name), occurrenceIds: [], synthesised: false });
  }

  const cultures: Culture[] = [];
  const placeByName = new Map(P.map((p) => [p.n, p]));
  for (const p of P) if (!cultures.find((c) => c.id === p.c)) cultures.push({ id: p.c, name: CULTURE_NAMES[p.c], lat: p.lat, lon: p.lon, occurrenceCount: 0 });

  let n = 0;
  const addOcc = (fam: Family, label: string, pl: Pl, year: number, display: string, prec: GeoPrecision) => {
    const id = `${fam.id}-${n++}`;
    const jitterLat = prec === 'place' ? (rand() - 0.5) * 0.6 : (rand() - 0.5) * 6;
    const jitterLon = prec === 'place' ? (rand() - 0.5) * 0.6 : (rand() - 0.5) * 6;
    const hasImg = rand() < 0.66;
    const w = pick([[900, 1150], [1200, 800], [1000, 1000], [820, 1100]]);
    const work = pick(WORKS);
    const o: Occurrence = {
      id, title: `${label} (${pl.n})`, label: label.length > 48 ? label.slice(0, 47) + '…' : label, familyId: fam.id, coFamilyIds: [],
      locusType: pick(['artifact', 'text-passage', 'myth-episode', 'ritual', 'dream', 'vision'] as const), subject: 'n/a', cultureIds: [pl.c], place: pl.n,
      lat: Math.max(-80, Math.min(80, pl.lat + jitterLat)), lon: pl.lon + jitterLon, geoPrecision: prec, year, yearDisplay: display,
      jung: [{ work: work[0], workTitle: work[1], year: work[2], locator: `¶${100 + Math.floor(rand() * 600)} (pdf p${100 + Math.floor(rand() * 400)})` }],
      quote: rand() < 0.5 ? 'It is as though the image remembered something the people who made it never knew they knew.' : undefined,
      body: [`${label} at ${pl.n}, taken here as a ${fam.name.toLowerCase()} expression. ${fam.oneLine}`, rand() < 0.6 ? 'Jung returns to this form to show how an image survives the culture that produced it, reappearing in dreams and in the work of alchemists alike.' : ''].filter(Boolean),
      parallelIds: [], image: hasImg ? plate(imgSeed++, fam.palette, w[0], w[1], label) : undefined,
    };
    occurrences.push(o);
    fam.occurrenceIds.push(id);
    return o;
  };

  for (const [fid, label, place, year, display, prec] of HAND) {
    const fam = families.find((f) => f.id === fid)!;
    const pl = placeByName.get(place)!;
    addOcc(fam, label, pl, year, display, prec);
  }
  // procedural fill: each family gains a few more, culture-consistent in era
  for (const fam of families) {
    const k = 3 + Math.floor(rand() * 6);
    for (let i = 0; i < k; i++) {
      const pl = pick(P);
      const year = Math.round(pl.y + (rand() - 0.5) * 380);
      const prec = pick<GeoPrecision>(['place', 'place', 'region', 'culture']);
      const form = pick(FORMS);
      addOcc(fam, `${fam.name} ${form}`, pl, Math.max(-3000, Math.min(1960, year)), year < 0 ? `~${Math.abs(year)} BCE` : `~${year}`, prec);
    }
  }
  // a few with no location at all
  for (let i = 0; i < 3; i++) addOcc(families[i], `${families[i].name} dream, unplaced`, P[0], 1930, '1930', 'none');

  // parallels: link occurrences within the same family and nearby ids
  for (const fam of families) {
    const ids = fam.occurrenceIds;
    for (let i = 0; i < ids.length; i++) {
      const o = occurrences.find((x) => x.id === ids[i])!;
      o.parallelIds = [ids[(i + 1) % ids.length], ids[(i + 3) % ids.length]].filter((x, j, a) => x !== o.id && a.indexOf(x) === j).slice(0, 3);
    }
    fam.occurrenceIds.sort((a, b) => occurrences.find((o) => o.id === a)!.year - occurrences.find((o) => o.id === b)!.year);
  }
  for (const a of archetypes) {
    a.familyIds = families.filter((f) => f.archetypes.some((t) => t.id === a.id)).sort((x, y) => y.occurrenceIds.length - x.occurrenceIds.length).map((f) => f.id);
    a.occurrenceCount = a.familyIds.reduce((s, id) => s + families.find((f) => f.id === id)!.occurrenceIds.length, 0);
  }
  for (const c of cultures) c.occurrenceCount = occurrences.filter((o) => o.cultureIds.includes(c.id)).length;

  const years = occurrences.map((o) => o.year);
  return {
    meta: { generatedAt: new Date().toISOString(), vaultPath: 'fixture', vaultLedgerLine: 'Synthetic dev fixture', counts: { archetypes: archetypes.length, families: families.length, occurrences: occurrences.length, cultures: cultures.length, images: 0 }, yearMin: Math.min(...years), yearMax: Math.max(...years) },
    archetypes, families, occurrences, cultures,
  };
}
