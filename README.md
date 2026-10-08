# An Archetypal Earth

A globe for moving through Jung's archetypes as they recur across place and time. The spec is in [docs/SPEC.md](docs/SPEC.md).

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
- `npm run data` runs ingest, then images, then ingest again.

Choices made by the site rather than taken from the vault live in `curation/`:

- `gazetteer.json` and `cultures.json` turn the vault's free-text place descriptions into coordinates.
- `archetypes.json` sets the instinct–spirit spectrum and atmosphere colours.
- `family-ties.json` links symbols to archetypes, marked `jung`, `inferred` or `site`.
- `image-queries.json` holds the Commons search queries and pinned image choices.

The shared data contract is [src/types/field.ts](src/types/field.ts).

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

- **What it does.** The sky is one more scale of the globe (`S`, or zoom out): the Moon's ring, the planets on their real orbits (radial distance compressed, and captioned as such), the Earth lit by the true Sun, the phase of the Moon, and the bodies as anchors in the graph. A **Birth sky** disclosure takes a date, a time and a place and draws the sky at that moment from the Earth, in Jung's keys; it makes no forecast and passes no verdict. In **Aion**, the equinox ring and a "The sky's clock" disclosure show where the spring equinox lies among the stars under stated conventions beside Jung's own months.
- **The data.** `npm run sky` generates `public/data/sky.json` (positions 2015–2039 from JPL DE440, the mythic ties, a gazetteer, golden values) and `npm run sky:check` verifies it is reproducible. Choices the site makes live in `curation/sky/`. The vault is read, never written.
- **The sidecar (optional, local).** Everything above works without it, except generating the data and the birth sky. `cd ephemeris && ./run.sh` serves `http://127.0.0.1:5187` (Python ≥ 3.11; setup in SKY-SOURCES.md): live Sun and Moon, birth charts, and place lookup. It is AGPL (Kerykeion, libephemeris), runs only on your machine, and the page only talks to it from localhost. A place *lookup* (as opposed to choosing from the built-in gazetteer) sends the text you typed to OpenStreetMap through the sidecar, and the page says so.
- **Honesty.** Approximate things are labelled (charts before 1900; the radial scale; calculated boundaries after the present). Ephemeris range is 1549–2650; outside it nothing is computed or approximated, and the page says so.
- **Checks.** `npx vitest run tests/sky tests/aion`; `node scripts/sky-golden.mjs --check`; browser walks under `tests/ui/e2e/` (`sky-*.mjs`, `aion-clock.mjs`), run against `npx vite --port 5183 --strictPort`.

## Checks

```bash
npm run typecheck && npm test && npm run build
```

### Aion, time and graph controls

**Aion** (or **A**) opens Jung's reading of archetypal history on the same globe.
Choose an epoch to inspect its nested periods, select a historical event, or
follow one of four historical threads. Source passages remain expandable in
place. Approximate dates and conditional Aquarian boundaries are labelled;
this is Jung's reading, with the atlas's explanatory gloss distinguished in the
source notes. Future readings can declare `extends: "jung-aion"` without
rewriting his dataset. See [AION-SOURCES.md](docs/AION-SOURCES.md).

`npm run aion` regenerates `public/data/history.json` from the curated reading;
`npm run aion:check` verifies actual corpus passages, field references and
published equality. This does not re-ingest the growing Jung vault.

**G** switches Earth and Graph. Graph **Settings** contains local depth,
occurrence visibility, relation filters and Reframe. The bottom clock is shared
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
