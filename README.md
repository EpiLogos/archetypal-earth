# An Archetypal Earth

A globe for moving through Jung's archetypes as they recur across place and time. The spec is in [docs/SPEC.md](docs/SPEC.md);
the shell and lens design is [docs/MODES-RFC.md](docs/MODES-RFC.md).

## The shell and its lenses

One menu (top left, or **M**) and one title hold everything. Each way of reading the field is a lens, a plugin
`{ id, label, icon, load() }` in `src/shell/lens.ts` whose code is fetched the first time it opens:

- **Read the field.** Field (**F**: the globe and the graph), Theory (**T**: how psychic energy moves, and number as an
  archetype), Aion (**A**), the Red Book (**R**).
- **Bring your own material.** Astrology (your birth sky beside Jung's, walked planet by planet to the Sun and the
  Self), Dreams (a journal whose images are amplified against the corpus's dreams and visions), Symbols (one symbol
  through its history and doctrine), Coincidences (a synchronicity log and its series).

Slices by source, culture, era and kind are a filter in the menu, not lenses; the filter is part of the link
(`#/a/self?w=cw12&k=dream`). The landing is the globe with one line and "Start at the Self".

Every interpretive line in a lens is a verbatim corpus quotation with its cite. The generators place each quotation in
the corpus text and write the locator from the corpus itself; `npm run <lens>:check` re-verifies the published file.

**Personal data.** Birth data, dreams and coincidences are kept in this browser's localStorage only
(`src/practice/store.ts`, prefix `aae.practice.v1.*`), never sent anywhere, and each tool says so where you enter it.
Export and delete-all are in each tool. Birth charts are computed in the page (astronomy-engine, MIT); no route ever
carries a birth.

The Great Mother is the first **deep field** (`#/symbols/archetype/great-mother`, or "The deep field" on her label):
Jung's distinction between image and archetype, Neumann's structure and stages, her images, dreams and dated
instances, built from `curation/depth/` by `npm run depth`.

## Run

```bash
npm install
npm run dev        # http://localhost:5181
```

## Data

The site reads the Jung archetypal-field vault at `~/Documents/books/jung-archetypal-field` and never writes to it. Set `VAULT=/path` to read a different one.

- `npm run ingest` rebuilds `public/data/field.json` from the vault. Run it after the vault's reading runs add material.
- `npm run images` fetches any images still missing from Wikimedia Commons into `public/img/`. Re-runs skip images already on disk.
- `npm run images:verify` checks the shipped corpus with no image ever opened: provenance completeness, licence law, manifest↔disk↔field agreement, byte-identity (a plate shared under one recorded source is intended curation; identical bytes under different sources fail).
- `npm run data` runs ingest, then images, then ingest again, then every generator (Aion, the Red Book, Theory,
  Astrology, Practice, the deep field). The images step needs Wikimedia Commons; everything else reads only the vault.
- `npm run harvest:check` checks the reading-pass records for the newest texts against the corpus text.

Choices made by the site rather than taken from the vault live in `curation/`:

- `gazetteer.json` and `cultures.json` turn the vault's free-text place descriptions into coordinates.
- `archetypes.json` sets the instinct–spirit spectrum and atmosphere colours.
- `family-ties.json` links symbols to archetypes, marked `jung`, `inferred` or `site`.
- `image-queries.json` holds the Commons search queries and pinned image choices.
- `aion/` curates the historical readings (see below); `redbook.json` curates the Red Book walk.

The shared data contract is [src/types/field.ts](src/types/field.ts).

The vault's `corpus/` (33 works, page-anchored: the Collected Works, the seminars, the Pauli letters and the
secondary texts the lenses quote) is also ingested: `npm run ingest` builds
`public/data/corpus/` (an index plus one file per volume: chapters, pages, ¶ anchor spans), and any
citing card in the site opens the actual passage at its source — "cw12 ¶452 (pdf p350)" becomes a
deep link with the whole page behind it. The corpus text is the owner's own local copy of
copyrighted translations: treat `public/data/corpus/` like the vault, not like redistributable
content.

## Imagery

The globe is NASA Blue Marble, public domain, in two layers:

- **Base** — Blue Marble Next Generation with topography and bathymetry (July 2004, Visible Earth 73751), prepared by `npm run textures` into `public/textures/` as 2k (first paint), 4k and 8k progressive JPEGs (~5.5 MB in all; the script downloads the 21600×10800 original from NASA into `.cache/`).
- **Close zoom** — a quadtree of sphere patches streaming NASA GIBS `BlueMarble_ShadedRelief_Bathymetry` tiles (`GoogleMapsCompatible_Level8`, no key), see `src/globe/tiles.ts`. Both layers go through the same earth shader, so the map keeps the site's dark, palette-tinted look.

Browser walks (frame-rate, screenshots, WebKit) live in `tests/ui/e2e/` and run against a dev server:

```bash
npx vite --port 5183 --strictPort &
node tests/ui/e2e/perf.mjs        # headed Chromium, 1440x900 @2x
node tests/ui/e2e/shots.mjs       # screenshots into .cache/screens/round2/
node tests/ui/e2e/shots.mjs webkit
```

## The sky

Zoom out past the Moon and the globe becomes a scale model of the sky: the Sun, Moon and planets stand where they really are, each linked to what Jung wrote of it. The full design is [docs/SKY-SPEC.md](docs/SKY-SPEC.md); sources, pins and every decision taken are in [docs/SKY-SOURCES.md](docs/SKY-SOURCES.md); the precession work is in [docs/PRECESSION-NOTES.md](docs/PRECESSION-NOTES.md).

- **What it does.** The sky is one more scale of the globe (`S`, or zoom out): the Moon's ring, the planets on their real orbits (radial distance compressed, and captioned as such), the Earth lit by the true Sun, the phase of the Moon, and the bodies as anchors in the graph. A birth sky is opened from the Astrology lens, which computes the chart in the page, and the sky then draws it from the Earth, in Jung's keys; it makes no forecast and passes no verdict. In **Aion**, the equinox ring and a "The sky's clock" disclosure show where the spring equinox lies among the stars under stated conventions beside Jung's own months.
- **The data.** `npm run sky` generates `public/data/sky.json` (positions 2015–2039 from JPL DE440, the mythic ties, a gazetteer, golden values) and `npm run sky:check` verifies it is reproducible. Choices the site makes live in `curation/sky/`. The vault is read, never written.
- **The sidecar (optional, local).** Everything above works without it, birth charts included; it is needed only to generate the sky data. `cd ephemeris && ./run.sh` serves `http://127.0.0.1:5187` (Python ≥ 3.11; setup in SKY-SOURCES.md): live Sun and Moon, birth charts, and place lookup. It is AGPL (Kerykeion, libephemeris), runs only on your machine, and the page only talks to it from localhost. A place *lookup* (as opposed to choosing from the built-in gazetteer) sends the text you typed to OpenStreetMap through the sidecar, and the page says so.
- **Honesty.** Approximate things are labelled (charts before 1900; the radial scale; calculated boundaries after the present). Ephemeris range is 1549–2650; outside it nothing is computed or approximated, and the page says so.
- **Checks.** `npx vitest run tests/sky tests/aion`; `node scripts/sky-golden.mjs --check`; browser walks under `tests/ui/e2e/` (`sky-*.mjs`, `aion-clock.mjs`), run against `npx vite --port 5183 --strictPort`.

## Checks

```bash
npm run typecheck && npm test && npm run build
```

### Aion, the Red Book, time and graph controls

**Aion** (or **A**) opens the archetypal readings of history on the same globe.
Three readings now stand there: Jung's **Aion** itself (the Pisces arc, 45
events), **The Turn** (the epoch's hinge 1914→1958 in five phases: forecast,
eruption, catastrophe, compensation, horizon), and **The Aquarius Horizon**
(every dated forecast, 1929→1958, with the reckoned threshold beside it).
Choose an epoch, a historical event, or a thread; source passages expand in
place and open the actual corpus passage. Jung-claims and standard scholarship
are labelled J/S exactly as the vault labels them; approximate dates and
conditional Aquarian boundaries stay labelled. See [AION-SOURCES.md](docs/AION-SOURCES.md).

`npm run aion` regenerates `public/data/history.json` from the curated readings;
`npm run aion:check` verifies actual corpus passages, field references and
published equality. This does not re-ingest the growing Jung vault.

**The Red Book** (or **R**) walks Liber Novus in folio order — the descent that
generated half the archetypes in the field, every stop `subject: Jung`. Each
folio stop shows its facsimile plate beside the translated text where one
exists (plates are copyrighted Norton pages: they load only from the vault on
this machine, never from any build — the licence law is in
[curation/redbook.json](curation/redbook.json) and
[REDBOOK-SOURCES.md](docs/REDBOOK-SOURCES.md)); the genesis view links each
symbol-episode forward to the archetype it became and its globe occurrences.
`npm run redbook` regenerates `public/data/redbook.json`;
`npm run redbook:check` verifies it.

**G** switches Earth and Graph. Graph **Settings** contains local depth,
occurrence visibility, relation filters, the layout's link space and
gravity, and Reframe. The bottom clock is shared
by both views. Playing time highlights the current historical window; the
all-time readout restores the full field. Opening a presence from a traced path
pauses inspection without discarding the path; closing its detail returns to
the same step. Deep reading closes before returning to the thread.

The **Book of Symbols** adds a separate page-cited reading to 29 existing
symbol families. Open **Reading** from a family, or expand its section in a
presence's detail; the original Jung text and dates remain separately sourced.
Related-symbol links are editorial comparisons, distinct from the graph's
Jung, inferred and site ties. `npm run symbols` regenerates this layer;
`npm run symbols:check` verifies the supplied private PDF, page evidence and
published output. The PDF and its plates are not served by the website.
See [SYMBOLS-SOURCES.md](docs/SYMBOLS-SOURCES.md).
