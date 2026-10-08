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
| `archetypal-earth-ephemeris` | 1.1.0 (`ephemeris/app.py`) | the local service; version reported by `/ping` |
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
- `orbits` — one sidereal period of each heliocentric body (180 samples, ecliptic of date with the precession since 2026.0 removed, so a ring is a closed curve in the 2026 frame). The rings of the system view are these real orbits, not drawn ellipses; Sun-centred.
- `public/data/sky.ties.json` — a derived index of body ↔ field ties (see decision 26); same `generatedAt`.
- `golden` — pinned epochs (J2000.0; a modern sample; an off-grid probe at 2026-03-17T07:23Z that the client's interpolation is tested against; the 7 BCE conjunction as `outside-ephemeris-range`), the ayanamsa table (Fagan-Bradley and Lahiri, ±13,000 years, 500-year steps plus −6, 0, 1900, 2000, 2026), and the 13 IAU constellation boundaries along the J2000.0 ecliptic.
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

### Phase 1 — the sky as a scale of the globe

12. **One camera, one frame.** The scene is Earth-fixed (Earth radius 1, +Y north). The sky is drawn in that frame by rotating the ecliptic of date into it (obliquity IAU 2006, mean sidereal time Meeus 12.4): ecliptic → equator (ε) → scene with latitude = declination, longitude = right ascension − GMST. The client keeps *mean* sidereal time; the sidecar's is apparent, and the equation of the equinoxes (≤ 0.005°) is the whole difference — far below a pixel, so it is tested to 0.006° rather than silently ignored.
13. **Stages are a pure function of distance.** Edges at 40 (lunar), 600 (handoff) and 3000 (system) Earth radii. Between 600 and 3000 the look-at point moves from the Earth to the Sun and the camera rides the sky (the rig rotates against the Earth's turning) so the sky stays still while the Earth turns beneath it. All distance weights use distance to the focus; depth planes and Earth uniforms use distance to the origin.
14. **Radial compression: `900 R⊕ × √(au)`.** True scale cannot show Mercury and Neptune together; a power scale keeps order and shows all eleven. The factor is printed in the view caption, and angles, longitudes and inclinations are true. Pluto's typical reach (≈ 39 au → 5,620 R⊕) sets the framing, so every body is in frame at the system home (tested on a wide and a phone viewport).
15. **Earth mode is pixel-identical.** Below distance 6 the depth planes are exactly the atlas's own expressions, the sky group is not drawn below distance 20, and the drag cap (0.25°/px) exceeds the old maximum (0.2°/px). `tests/ui/e2e/sky-pixels.mjs` renders seven Earth poses against a build of the pre-sky source and demands zero differing pixels (with a negative control that must fail).
16. **The atlas's constant-pixel layers give way to the sky.** Presences, arcs, tiles and marker decals are sized in screen pixels, so on a shrinking globe they smear into a white blob. Between 6 and 36 Earth radii they fade (presence size × a smoothstep) and are not drawn beyond. At 6 and below the weight is exactly 1.
17. **Sky state is a flag with its own lifecycle.** `AppState.sky = {body?, birth?}`, valid only over the world view; focusing anything, or switching mode, drops it. The zoom gesture sets it at distance 40 and clears it at 30 (hysteresis, so a hovering wheel cannot flicker the sky); gesture transitions never fly the camera, and leaving by gesture replaces the history entry rather than pushing one. `S`, the Sky switch and `#/sky…` links fly to the system home; Back flies to the Earth.
18. **The sky layer is lazy.** Its 2.1 MB of data is fetched only once the user pulls back past 4.4 Earth radii, presses `S` or follows a link. Earth mode pays nothing. The sky's shader programs are compiled when the layer attaches, while the Earth is on screen.
19. **Sidecar 1.1.0.** The step limit rose to 1,000 days per sample (orbit sampling needs one sidereal period of Neptune at coarse steps) and the off-grid probe epoch was added.

### Phase 2 — bodies that mean

20. **A body's card is the reveal pattern.** Hero, name, one line, position, then ties; the same panel, motion and close behaviour as a family's reveal, so the sky reads as the same instrument. The hero is the body's own palette as a lit sphere, not an image: no photograph is claimed, none is invented (real planet textures are Phase 7).
21. **A card is earned.** It opens only for a body with at least one tie that resolves to a living field node (`canOpenCard`); a deep link to a body without one opens the plain sky. The unit test holds all eleven to this against the shipped `field.json`.
22. **Every tie shows its basis, in words.** `Jung` (he makes the link in the passage cited, shown on request), `inferred` (the atlas or vault infers it; the tooltip says so), `the atlas's reading` (editorial, no citation, never dressed with one). A `jung` tie without a quotation, or a `site` tie with one, fails the test.
23. **Position is geocentric, tropical, of date — and says so.** The sign and degree come from the Earth's heliocentric vector subtracted from the body's (Sun: the Earth turned around; Moon: its own grid), read at the sky's moment, with that moment printed. Outside the generated 2015–2039 span the card declines and states the span; the Earth has no place in its own sky and the card says why.
24. **Culture reprojection is a sky-local selector, not a focus.** The spec reads "when a culture focus stands"; but a focus leaves the sky by design (decision 17), so the two cannot stand together. The equivalent is a "Names read through" selector that is part of the sky state and link (`#/sky/mars/c/indian`). It re-names labels and cards from the transcribed table, names the culture and the table on the card, tags each cell with its basis, and states that the character beneath is the default one. A culture with no cell for a body (Chinese for Sun and Moon; every culture for the modern three) keeps the default name and says so.
25. **Sun and Moon carry the pair reading.** "The Self as their coniunctio" with its basis, three field links (Coniunctio, Syzygy, the Self) and the cited passages in an in-place expander like Aion's sources. The astronomical fact (the card's position line) and Jung's reading are separate blocks.
26. **A small ties index precedes the sky.** `public/data/sky.ties.json` (5 kB, derived from `sky.json` by the generator and byte-checked by `sky:check`) lets a family's reveal show a quiet glyph — ☿ Mercurius — in Earth mode without fetching the sky's 2 MB. The glyph opens the body in the sky.
27. **Labels are real buttons.** Visible body labels are in the tab order; hidden or inactive ones are `visibility: hidden` and the sky's panels are `inert` in Earth mode.

### Phase 3 — the sky in the graph

28. **Sky anchors are an extension, never a rewrite.** `buildGraph` is unchanged and the field's tests still assert its exact node count. `withSkyAnchors(graph, source)` is a pure function that returns a new graph with the bodies appended after the field's own nodes, so every existing node keeps its id and the view can swap graphs in place. Off by default; the toggle lives in the graph's Settings (`Sky anchors`) and is not part of the hash.
29. **A body is a node of kind `body`, tied by edges of kind `sky`.** Each `sky` edge is one row of the ties index (`sky.ties.json`) with its basis intact, drawn as a hairline in the body's own light, quieter than the field's ties. Sky edges honour the relation filters exactly as tie edges do (`edgeAllowed`): with every relation off no strand remains, though the ring stays.
30. **The ring is the ecliptic, drawn once, faintly.** Bodies stand on a circle of radius 560 graph units at their geocentric ecliptic longitudes for the standing moment (now), counter-clockwise as a chart is drawn. The circle is one dotted line: no wheel, no signs, no divisions. The Earth has no ring position — it has no geocentric longitude, being the place the longitude is measured from — and is left out; this is stated in the Settings note.
31. **The moment is now, and it is stated.** Longitudes come from the same generated grids as the sky (`SkyEphemeris.geo`), at `Date.now()`. If now lies outside the generated span the toggle reports that the sky's data could not be had, rather than hanging stale positions. The Settings note prints the moment: "…geocentric ecliptic longitudes, as of 2026-10-08 16:25 UTC". The graph does not follow the clock: toggling again refreshes the moment.
32. **Layout: held bodies, drifting forms.** In the whole graph a body is held (`fx`/`fy`) at its ring position, including after a drag. Families with body ties are drawn toward the body by the sky strands (jung 0.2, inferred 0.1, site 0.05 link strength, at distances 150/190/240), so they drift toward their presiding body when the anchors come on; archetypes inherit through their families. The strand to the Self is drawn but exerts almost no pull (0.004), so the Self holds the centre — the e2e measures it at under 0.01 graph units from the origin. Forms may sit a little beyond the ring when the pull of their body wins; the gate allows 1.2× the ring.
33. **In a local graph a body is an ordinary neighbour.** The ring only makes sense around the whole; around one subject the body is released, enters by the sky strand like anything else, and obeys the same depth, relation filters and node ceiling (a body has the family's priority when a level is trimmed). At three steps from the Self the ceiling of 520 holds with eight bodies present.
34. **Time playback does not touch the sky.** A body has no year; its liveness is 1 and playing history never dims it. The field's liveness values are byte-equal with and without the anchors (unit test).
35. **A click on a body goes to the sky.** Choosing a body in the graph (or its Earth shortcut) leaves graph mode for the sky on that body's card, the same as clicking it there. A body with no field link opens the plain sky (decision 21).
36. **Reproducibility, stated plainly.** The ring is exact: two fresh sessions put a body within 0.5 graph units of the same place. The force simulation steps with the frame clock, as the graph always has, so the settled field differs by a few graph units between sessions (Δ up to ~9 observed in WebKit over a ~1100-unit span); the arrangement does not. The unit tests pin what is pure: the same sky gives the same nodes, edges and ring.
37. **The ties index carries the palette.** `sky.ties.json` gained each body's two palette colours and spectrum so the graph can colour a body without loading the 2 MB `sky.json` for anything but the longitudes it asks for on the toggle.

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
