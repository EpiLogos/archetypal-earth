# Sky source, sidecar and decision notes

The sky layer shows astronomical fact and C. G. Jung's mythic and alchemical reading, attributed and kept distinct. It does not predict, endorse astrology, assign verdicts to a person's chart, or turn a conditional calculation into accomplished history. This follows `docs/AION-SOURCES.md`, and SPEC §14's never-list applies to every pixel.

## Generate and verify

```sh
# one-time sidecar setup (python3 ≥ 3.11)
python3 -m venv ephemeris/.venv
ephemeris/.venv/bin/pip install -r ephemeris/requirements.txt
ephemeris/run.sh                 # serves http://127.0.0.1:5187

npm run sky                      # curation + sidecar + vault → public/data/sky.json
npm run sky:check                # regeneration equality + sidecar pin + every reference resolves
npx vitest run tests/data/sky.test.ts
```

`npm run sky` fails loudly when the sidecar is not running (no fixture, no cache, no second ephemeris). `--check` regenerates in memory and compares everything except `meta.generatedAt`, which is preserved when nothing else changed. It also verifies that the running sidecar's name, version and package versions equal the pin below, that every body, tie and culture resolves against `public/data/field.json`, and that every cited quotation is verbatim on its cited page of the read-only vault corpus. `JUNG_VAULT` can point at another vault with the same `corpus/` layout; the vault is only ever read.

## Sidecar version pin

| Component | Pin | Role |
| --- | --- | --- |
| `archetypal-earth-ephemeris` | 1.0.0 (`ephemeris/app.py`) | the local service; version reported by `/ping` |
| kerykeion | 6.0.5 | charts, houses, aspects, lunar phase (factories) |
| libephemeris | 3.2.2 | Swiss-Ephemeris-compatible API over JPL DE440 (Skyfield, jplephem, pyerfa) |
| fastapi / uvicorn | 0.143.0 / 0.54.0 | HTTP |
| timezonefinder | 9.0.0 | offline timezone from coordinates; `zoneinfo` resolves the historical offset |
| httpx | 0.28.1 | the Nominatim geocode client |

`ephemeris/requirements.txt` is the single source of the pins; `ephemeris/requirements.lock.txt` is the full resolved set the sidecar was verified against (Python 3.14.3). `sky:check` reads the requirements file, not a copy.

**Ephemeris range.** The kernel is JPL **DE440**: 1549-12-31 to 2650-01-25. Dates outside it are not computed and not approximated: the sidecar answers HTTP 422 `{"error": "outside-ephemeris-range"}` and the generated golden epochs record `status: "outside-ephemeris-range"`. The 7 BCE Jupiter–Saturn conjunction of Aion's account therefore has no computed positions in `sky.json`; only the precession table (which is a model, see below) reaches that far. DE441 (−13200 to +17191) is not installed and would need a separate ~3 GB kernel; the limitation is stated rather than hidden.

**Licence.** kerykeion and libephemeris are AGPL-3.0. They run only in the separate local sidecar process; the site bundles neither and calls it over HTTP. Distributing the sidecar means distributing it under the AGPL with its source; this project does not distribute it.

## Endpoint contracts

All GET, JSON, bound to 127.0.0.1:5187 (`EPHEMERIS_PORT` overrides). CORS allows only `http://localhost:*` and `http://127.0.0.1:*`. Ecliptic and equinox **of date**, tropical, degrees; r in au; `speed` in degrees per day.

| Endpoint | Parameters | Answer |
| --- | --- | --- |
| `/ping` | – | `{name, version, time, python, packages, ephemeris: {kernel, from, to, fromJd, toJd}, positions, port}` |
| `/now` | – | snapshot at the current instant (below) plus Kerykeion's lunar `phase` |
| `/positions` | `t` | the snapshot at one instant: `{jd, iso, sun, moon (+distKm), elongation, illuminated, waxing, gmst, subsolar, sublunar, earth, planets}`; `subsolar`/`sublunar` are `{lat, lon}` (latitude = declination, longitude = right ascension − GMST) |
| `/positions` | `start`, `stepHours`, `count`, `bodies`, `frame=helio\|geo` | a uniform grid: `{frame, start, stepHours, count, bodies: {<key>: {lon[], lat[], r[]}}}`; lon/lat to 3 dp, r to 5 dp (Moon 7 dp) |
| `/chart` | `local` (`YYYY-MM-DDTHH:MM`, wall clock), `lat`, `lon`, `tz?`, `name?` | a natal chart (type `SidecarChart` in `src/types/sky.ts`): resolved `tz` and UTC offset, `utc`, `jd`, `approximate` (true before 1900, with a reason), `warnings` (gap/fold), tropical `bodies` with sign/degree/retrograde/house, `angles`, `houses` (requested vs effective system and cusps), `aspects`, lunar `moon` phase, `gmst` |
| `/geocode` | `q` | `{results: [{name, lat, lon, source}]}` from OpenStreetMap Nominatim; HTTP 503 when unreachable |
| `/golden` | – | reference values: golden epochs, ayanamsa definitions and table, constellation boundaries |

`sky:check` and the unit tests pin the contract to `src/types/sky.ts`; the site treats a missing or wrong-version sidecar as "absent" and says so.

## What is generated, and from what

`public/data/sky.json` (type `SkyData`) holds:

- `bodies` — eleven: sun, moon, earth, mercury, venus, mars, jupiter, saturn and, flagged `modern: true` with a dated source, uranus (1781), neptune (1846) and pluto (1930). Each has display orbit constants, radius, a palette and spectrum position, one line, its sources and its ties.
- `readings` — pair readings (the Self as the coniunctio of Sol and Luna).
- `cultures` — the cultural reprojection of the classical seven into the field's own cultures.
- `planets` — heliocentric ecliptic grid, every 48 hours, 2015-01-01 → 2039-12-31 (4,566 samples; the Earth's grid gives the Sun's direction).
- `moon` — geocentric ecliptic grid, every 6 hours, same span (36,525 samples).
- `golden` — pinned epochs (J2000.0; a modern sample; the 7 BCE conjunction as `outside-ephemeris-range`), the ayanamsa table (Fagan-Bradley and Lahiri, ±13,000 years, 500-year steps plus −6, 0, 1900, 2000, 2026), and the 13 IAU constellation boundaries along the J2000.0 ecliptic.
- `meta` — `generatedAt`, the sidecar name/version/packages, the ephemeris kernel and range, the span, the frame, and counts.

## Sources

Retrieved 2026-10-08 unless stated; each body's `sources` array in `curation/sky/bodies.json` carries the same claim-by-claim record.

| Claim | Source |
| --- | --- |
| orbital semimajor axis, eccentricity, inclination, sidereal period (Mercury … Neptune, Earth–Moon barycentre) | JPL SSD, *Approximate Positions of the Planets*, Table 1 — https://ssd.jpl.nasa.gov/planets/approx_pos.html |
| mean radii; sidereal periods | JPL SSD, *Planetary Physical Parameters* — https://ssd.jpl.nasa.gov/planets/phys_par.html |
| Pluto's orbit; Moon's radius, semimajor axis, eccentricity, period, inclination | NASA NSSDCA Planetary Fact Sheet and Moon Fact Sheet — https://nssdc.gsfc.nasa.gov/planetary/factsheet/ |
| discovery of Uranus (1781) and Neptune (1846) | JPL SSD, *Planetary Discovery Circumstances* — https://ssd.jpl.nasa.gov/planets/discovery.html |
| discovery of Pluto (1930), reclassification (2006) | NASA Science, *Pluto Facts* — https://science.nasa.gov/dwarf-planets/pluto/facts/ (JPL's discovery page does not list Pluto) |
| nominal solar radius 695,700 km | IAU 2015 Resolution B3 |
| Jung's quotations (every `cites` entry) | the read-only vault corpus `corpus/<work>.md`; verified verbatim on the cited PDF page by `sky:check` |
| the planetary-god, metal and culture correspondences | the vault note `wiki/images/planetary-gods.md`, whose own `(J)`/`(S)` marks decide each cell's `basis` |

The Jung works cited: CW5 (*Symbols of Transformation*), CW9i, CW9ii (*Aion*), CW11, CW12 (*Psychology and Alchemy*), CW13 (*Alchemical Studies*), CW14 (*Mysterium Coniunctionis*), and the Nietzsche's *Zarathustra* seminar.

**Locator convention.** A ¶ number is stated only where the nearest preceding paragraph marker in the corpus agrees with it; otherwise the citation is the PDF page alone. The vault's paragraph spine is incomplete, and where the vault's own wiki ¶ number disagrees with the corpus marker (CW9ii's coniunctio oppositorum sentence is "¶425" in the wiki, marker ¶424 in the corpus; the Jupiter–Saturn tradition ¶131 versus ¶126; CW13 ¶355 versus ¶354) the stricter reading wins and the discrepancy stays visible here.

## Basis discipline

- **jung** — Jung makes the link in the cited sentence. A `jung` tie without a quotation fails generation.
- **inferred** — the vault or the atlas infers the link; the note says why. Never presented as Jung's word.
- **site** — editorial. No citation. All the links for Uranus, Neptune, Pluto and the Earth are `site`: Jung's alchemical and astrological sources know only the seven classical bodies, and the sky says so.

Palettes and spectrum positions are the atlas's visual interpretation of the tied families' own palettes (D4), recorded per body in `paletteFrom`; they are not measurements.

## Framing law (fixed text and prohibitions)

- Birth sky is framed, exactly, as *the sky at that moment, read in Jung's keys*.
- No prediction language, no verdicts, no "your sign", no "influence". Aspects, where drawn, are quiet arcs, off by default; houses are an optional ring.
- No zodiac-wheel kitsch, no glyph soup, no cheap occult ornament.
- Approximate things are labelled where they appear: the compressed radial scale, pre-1900 birth times, snapshot "as of" dates, a sidecar that is absent.

## Decisions taken

Recorded with the full thing in view; none was left blocking on the owner. D1–D6 of `SKY-SPEC.md` are applied as settled.

1. **Pluto is in** (owner, in the commission). `modern: true`, 1930 discovery sourced to NASA Science, present in the grid, ties, graph anchors and birth charts. Its orbital elements are the NASA fact-sheet values (JPL's approximate-positions table does not cover it); its 17.2° inclination and 0.244 eccentricity are why the diagram draws orbits as tilted ellipses rather than flat circles.
2. **`S` shares state with the zoom gesture, sidecar is `ephemeris/` on port 5187, radial compression is power-scaled with the factor in the view caption** (the spec's recommended defaults).
3. **The ephemeris authority is Kerykeion over libephemeris on DE440,** not a pure Swiss Ephemeris: the Kerykeion version 6 stack ships libephemeris, which exposes the Swiss API over JPL DE440. The flavour is recorded in `meta` and the pin table above.
4. **A grid, not an embedded ephemeris.** The client interpolates sampled grids (planets 48 h, Moon 6 h) with golden-tested math; it never computes a second ephemeris. The Moon's finer cadence exists because it moves 13° a day.
5. **Grids run 2015–2039, not ±13,000 years.** The spec's long-range sampling cannot be honest: DE440 stops at 1549–2650. What reaches ±13,000 years is the ayanamsa/precession table, a model, not a position. Phase 6 states this where it shows it.
6. **Ayanamsa and precession.** The sidecar's ayanamsa is its defining value plus Vondrák et al. (2011) accumulated precession; the IAU 2006 polynomial drifts from it by about 1.4′ at ±6,000 years and 17′ at +13,000, so Phase 6 ports Vondrák and keeps IAU 2006 as a labelled cross-check rather than the authority.
7. **Strict citation verifier.** A quotation must be on the cited PDF page and a stated ¶ must equal the nearest corpus marker; otherwise cite the page alone. Stricter than the wiki's own paragraph numbers, on purpose.
8. **Source honesty beats completeness for the modern bodies.** Three bodies carry no Jung tie because Jung wrote none; each has a `site` tie that says why.
9. **Culture reprojection is the vault's table, transcribed.** `cultures.json` copies `planetary-gods.md`; where that table marks a cell `(J)` the basis is `jung`, `(S)` is `inferred`, unmarked classical names are `site`. The Chinese wuxing set has five terms: Sun and Moon have no cell, and the sky says so rather than inventing one.
10. **Generated output is committed, reviewable and diff-checked.** `public/data/sky.json` is 2.1 MB because the grids are the data; it is lazy-loaded by the experience layer so Earth mode pays nothing for it.
11. **A phase commit stages only its own files.** The working tree carries the owner's uncommitted changes (README.md, curation/image-queries.json, index.html, package-lock.json, and earlier edits in several tracked files). Where a file of mine was already dirty (`package.json`), the commit stages only my hunks.

## Draft vault schema proposal (`wiki/sky/`, for the owner)

The vault is the owner's and is never written by this project. Proposed, not adopted:

```yaml
# wiki/sky/<body>.md — one note per body
---
type: body
key: mercury                # sun·moon·earth·mercury·venus·mars·jupiter·saturn·uranus·neptune·pluto
modern: false               # true for bodies found after 1781
presides:                   # body → image family; each id carries its basis marking like `expresses`
  - mercurius
  - planetary-gods
presides_jung: [mercurius, planetary-gods]
presides_inferred: [psychopomp]
projections:                # cultural re-projection; each cell marked (J) or (S)
  greek: Hermes (J: cw12 ¶84)
  babylonian: Nabu (S)
---
Body text, Jung passages quoted with ¶ and PDF-page locators, in the existing note style.
```

`SCHEMA.md` would gain one row (`type: body`) and, recommended, one relation, `presides` (body → image family), with the same `_jung`/`_inferred` marking as `expresses`. Adoption replaces `provenance: 'curation'` with `'vault'` in the generated `SkyBody` without changing its shape.
