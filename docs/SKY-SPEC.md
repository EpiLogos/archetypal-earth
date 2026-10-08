# The Archetypal Sky — development spec

Agent-drafted at the owner's request, 2026-10-08, after reading the app's actual foundations.
A proposal until the owner adopts it; it does not amend the owner-authored [SPEC.md](SPEC.md) —
it lives under it. Source-notes discipline follows [AION-SOURCES.md](AION-SOURCES.md); this file
will be joined by a `SKY-SOURCES.md` written the same way when Phase 0 lands.

One-sentence brief: pull back from the Earth and find it hanging among the real planets — each a
body, each a wiki node wearing its mythic characters — so the atlas gains the solar system as a
second scale of the same field, with the Sun and Moon live and true, the Self standing as their
coniunctio, birth moments computable natively, and the precession of the equinoxes mapped as the
astronomical ground under Aion.

## 1. What the owner asked for, decoded

1. **Solar system as a zoom-out, not a mode change.** From the Earth view, continuous pull-back
   reveals the heliocentric context: real bodies, real geometry, no teleporting, no lost
   orientation (SPEC §9).
2. **Planets as wiki nodes.** Each body attains its mythical/classical character, *re-projected
   by culture*, and links richly down to the Earth: the families and occurrences of the existing
   field. Earth itself is a body too — the atlas's home node.
3. **Sun and Moon, live and true.** A live view in which night and day are real — the actual
   terminator, the actual phase — not decoration.
4. **The Self as their coniunctio.** Jung's syzygy: Sol and Luna joined is the Self's other
   central role. The sky view carries this reading, sourced like every reading here.
5. **Graph anchors.** Graph Settings gains the option to add the planets as anchor nodes, so the
   constellations of meaning hang from the sky.
6. **Kerykeion for the live side.** The live site wants real updates and the ability to find the
   astrological moment of someone's birth, natively.
7. **Aion's prerequisite.** The precession of the equinoxes properly mapped, as the astronomical
   ground under the theory Aion already presents.

## 2. The ground it stands on (as found)

- **Stack**: TypeScript + Vite, three.js/globe.gl, d3-force, no framework, DOM UI in `src/ui/`.
- **One field, two views**: `Model` (`src/data/model.ts`) feeds globe and graph alike; the graph
  is a second view of exactly the field the globe shows (`src/graph/build.ts:1-4`).
- **State machine**: `AppState` in `src/state/store.ts` — `world / focus / manifest / thread`,
  orthogonal flags `graph` and `history`; `depthOf` governs ascent/descent; every state is
  linkable via the hash router (`src/state/router.ts`) and Back works.
- **Camera**: pure, tested math in `src/globe/zoom.ts` — orbit rig, cursor-anchored zoom,
  exponential log-altitude wheel (`zoomedDist`), eased approach that never overshoots
  (`easeDist`), `MIN_DIST = 1.05`.
- **Render**: `GlobeEngine` (`src/globe/engine.ts`) owns one scene; shared uniforms
  (`src/globe/shared.ts`) feed every material; palette tween (`setPalette`, 1.6 s,
  `easeInOutCubic`); deterministic `advance()` test hook; `setPaused` lets graph mode stop GPU
  work without stopping the clock.
- **Atmosphere law** (SPEC §8, §16): the instinct/spirit spectrum (CW8 ¶414ff) governs colour;
  solar/heroic → lucid radiant gold-white; slow, composed motion; no psychedelic excess; reduced
  motion honoured throughout (`reduced` flag).
- **Data flow**: vault (`~/Documents/books/jung-archetypal-field`, read-only) → `scripts/`
  generators → `public/data/*.json` → site. Site-side choices live in `curation/`. Every
  generated layer has a `--check` that verifies sources and generated equality.
- **Honesty law**: `TieBasis` (`jung | inferred | site`) on every interpretive tie; `year` vs
  `yearDisplay`; approximate and conditional dates labelled; source passages expandable in place;
  generated outputs carry `generatedAt`; missing sources fail loudly, never a silent fixture.
- **Vault tiers** (`SCHEMA.md`): archetypes → images → instances, with the Self as prime node.
  The vault already holds `sun`, `moon`, `mercurius`, `seven-planets`, `planetary-gods`,
  `coniunctio`, `sol-niger`, `solificatio`, `star`, `polestar`, `mandala`, `quaternity` image
  families, plus `syzygy` and the prime `self` — the mythic layer's landing zone is prepared.

## 3. Load-bearing decisions

**D1 — One continuous scene; sky is a scale, not a mode.** `sky` becomes an orthogonal flag on
`AppState` (like `graph`): the same field, the same clock wiring, one scene. The camera's
log-altitude extends from the Earth's surface to past Neptune; stage transitions are functions of
distance alone, so any point of the pull-back is reversible and linkable. Keyboard `S` (and a
quiet entry in Graph Settings' family of switches) sets the flag; the zoom gesture reaches the
same state without it.

**D2 — One ephemeris authority: Kerykeion (Swiss Ephemeris), behind a local sidecar.** A small
Python service in `ephemeris/` (FastAPI + `kerykeion`, pin the version in `SKY-SOURCES.md`) is
the only compute authority for positions, charts and ayanamsa. The site never embeds a second
ephemeris: everything the client needs is *generated* into `public/data/sky.json`
(`npm run sky`) — sampled grids, golden epochs, constants — and the client interpolates with
pure, golden-tested math. Live features (now, birth charts) call the sidecar when present and
degrade, labelled, to the last generated snapshot. A missing sidecar fails generation loudly —
the house rule: no silent fixtures, no second implementation to drift.

**D3 — Myth in the vault's own currency; astronomy in curation.** Astronomical fact (orbital
constants, palettes, grids) is site-side: `curation/sky/`, sourced (JPL SSD; see §6). Mythic
character is authored content: proposed as a small new vault tier `wiki/sky/` (one note per body,
frontmatter: `type: body`, astronomical `key`, cultural projections, Jung citations). Because the
vault's schema is the owner's, **Phase 2 unblocks without it**: body→family ties ship first as
`curation/sky/ties.json`, basis-tagged exactly like `family-ties.json` (`jung` where Jung cites
the planet — Mercurius in CW13 above all — `inferred` where justified, `site` where editorial).
Vault adoption then promotes the curation into authored notes without contract change: the
generated `SkyBody` shape is the same either way, with a `provenance` field recording which.

**D4 — The sky is coloured by the existing system.** Each body carries the standard
`Palette{core,glow,fog,deep} + Spectrum` (`src/types/field.ts`), derived from its tied families'
palettes; Sol resolves toward the SPEC §8 solar gold-white, Luna toward the anima liquidity, Mars
toward the chthonic warm register. No new colour theory; the sky deepens the one the atlas has.

**D5 — The two clocks stay distinct.** The historical clock (years, −4300…4343 in Aion) and the
sky's clock (live UTC; hour/season scrub) are different instruments. The sky has its own `moment`
state; the historical clock is untouched; Aion is the only place they are bridged, explicitly,
by the precession layer (Phase 6). This is the vault's "two time axes" law carried into the sky.

**D6 — Framing law, inherited from Aion-SOURCES.** The sky presents astronomical fact and
mythic reading, attributed and distinct. It does not predict, endorse astrology, or dress
SPEC §14's forbidden "cheap occult aesthetics" in planetary colours: no zodiac wheel kitsch, no
glyph soup. Aspect lines, where drawn, are quiet arcs between points, styled like the existing
arcs, toggled off by default.

## 4. Data contracts

`curation/sky/bodies.json` — one entry per body, site-side, sourced:

```jsonc
{
  "key": "mars",                    // sun·moon·earth·mercury·venus·mars·jupiter·saturn·uranus·neptune·pluto
  "order": 4, "modern": false,      // modern = discovered 1781+ (uranus, neptune, pluto)
  "orbit": { "au": 1.52371, "siderealDays": 686.98, "inclinationDeg": 1.85 },
  "radiusKm": 3389.5,
  "palette": { "core": "#c96a4a", "glow": "#8a3b2e", "fog": "#3a1c18", "deep": "#160b0a" },
  "spectrum": 0.35,
  "sources": [{ "claim": "orbital elements", "ref": "JPL SSD, Planetary Fact Sheet", "retrieved": "…" }]
}
```

`curation/sky/ties.json` — body→family and body→archetype, with the standing `basis` discipline
and cites, e.g. `mercurius → f:mercurius (jung, cw13 ¶…)`, `sun+moon → a:syzygy / f:coniunctio
(jung, cw09ii ¶…; cw12 …)`, `mars → f:battle-with-dragon (inferred, justified in body)`.

`curation/sky/cultures.json` — cultural re-projection, keyed by existing `CultureId`:

```jsonc
{ "greek": { "mars": { "name": "Ares", "line": "…" }, "venus": { "name": "Aphrodite", "line": "…" } },
  "babylonian": { "mars": { "name": "Nergal", "line": "…" } } }
```

Each projection carries its own source. The default projection is the atlas's home reading:
the Greco-Roman classical names as Jung inherits them, with the alchemical reading (Mercurius
above all) foregrounded. When a culture focus stands, sky labels and one-line characters
re-project; the reprojection is a display act and says so.

`public/data/sky.json` (generated; `generatedAt`, sidecar version, ephemeris flavour recorded in
`meta`): constants copy, per-body sampled geocentric/heliocentric ecliptic longitudes and
distances (display-grade sampling: planets 2-day, Moon 6-hour, over the live span; ±13 000 years
at 10-year steps for the classical seven under Aion), golden epochs (J2000.0; the 7 BCE May 29
Jupiter–Saturn conjunction of Aion's account; a modern sample), and the ayanamsa golden table
(Fagan-Bradley, Lahiri) from the sidecar.

`src/types/sky.ts` — the contract both sides code against, in the manner of `field.ts`. Vault
side (proposed, owner to adopt): `wiki/sky/<body>.md`, `type: body`, carrying cultural
projections and ¶-cited Jung passages; `SCHEMA.md` gains one row and (recommended) one relation,
`presides` (body → image family), with the same `_jung`/`_inferred` marking as `expresses`.
Until then the curation carries it.

## 5. The experience, by phase

Every phase lands behind the standing gate (`npm run typecheck && npm test && npm run build`),
with its own checks named below, and honours the house bar in §6 from the first commit.

### Phase 0 — Contracts and the sidecar

`src/types/sky.ts`; `curation/sky/*`; `scripts/sky.mjs` (+ `npm run sky`, `npm run sky:check`);
the `ephemeris/` sidecar (localhost-only; endpoints `/ping`, `/now`, `/positions`, `/chart`,
`/geocode`); `docs/SKY-SOURCES.md` recording sources, the Kerykeion version pin, endpoint
contracts, and the framing law. *Done when*: `sky:check` verifies regeneration equality,
sidecar version, and that every body/tie resolves against the published field; the site boots
with sky data present but no sky UI yet.

### Phase 1 — The pull-back (heliocentric zoom-out)

One continuous gesture from `MIN_DIST` to beyond Neptune. Stage model as a pure function of
camera distance (`src/sky/stages.ts`, tested like `zoom.ts`):

- **Earth (1.05 → ~40 R⊕)** — unchanged look. No sky layer yet.
- **Lunar (~40 → ~600 R⊕)** — the Moon's orbit ring fades in; the Moon as a small body at true
  geocentric longitude and phase-lit shading; the Sun appears as the bright direction in the
  backdrop.
- **Handoff (~600 → ~3 000 R⊕)** — the camera's look-at eases from Earth to Sun while zooming;
  the ecliptic plane and orbit rings fade in; Earth shrinks to a labelled point; tiles and
  presences have already faded by altitude.
- **System (beyond)** — the heliocentric field: Sun as radiant gold-white body (SPEC §8), the
  planets as palette-tinted shader bodies on their rings, true ecliptic longitudes for the
  selected moment, orbit inclinations true, **radial scale labelled as diagrammatic** (the rings
  use a power-compressed radius so Neptune fits a usable frame; the compression factor is stated
  in the view's quiet caption — the house labels its approximations). True-scale remains
  available as a toggle for the inner system.

Positions come from the generated grid by pure interpolation (`src/sky/ephemeris.ts`); the
`advance()` hook drives deterministic tests; golden epochs bound the tolerances (planets ≤0.1°,
Moon ≤0.5° display-grade). Selection: a planet picks like a presence; focus opens through the
existing focus-label → reveal path.

*Acceptance*: full out-and-back in one wheel gesture with no orientation loss, no janky resets,
no teleporting; Chromium and WebKit hold their frame budgets through the handoff; Earth-mode
rendering pixel-identical before the handoff altitude (guarded by a screenshot diff in
`tests/ui/e2e/`); `S` and Back and deep links (`#/sky/…`) all behave; reduced motion shortens
all stage eases.

### Phase 2 — Bodies that mean (the mythic layer)

Each body is a wiki node. Picking a body opens the existing reveal pattern: hero image or
shader-portrait, name under the standing culture, one-line mythic identity, current sky position
(sign and degree, labelled tropical), and its families. Family links descend to Earth through
the existing focus navigation: Mercurius opens the mercurius family and its alchemical
occurrences on the globe; the globe's presence details gain a quiet body glyph when the family
has a standing tie. Culture re-projection: when a culture focus stands, body labels and
characters re-project per `cultures.json`, with the projection named. Body→Self: Sun and Moon
carry the syzygy/coniunctio reading with cited passages, expanding in place like Aion sources.

*Acceptance*: every displayed tie is basis-tagged and cited or honestly `site`; no body card
without at least one resolved field link; culture reprojection has a visible, truthful label.

### Phase 3 — Sky anchors in the graph

Graph Settings gains **Sky anchors** (off by default): the bodies join as fixed nodes on an
outer ring at their geocentric ecliptic longitudes for the standing moment; the Self holds the
centre; families with body ties drift to their presiding body; archetypes inherit the pull
through their families. Ties honour the relation filters. New `GNode` kind `body` follows the
existing build path (`src/graph/build.ts`); anchors are laid out with the same
deterministic `hash01` spawn jitter, so layouts stay reproducible.

*Acceptance*: toggling anchors neither breaks Reframe, filters, time playback nor the cap
logic; layouts deterministic across runs; the graph reads as constellations hung from the sky,
not as an added dashboard.

### Phase 4 — The live luminaries (Sun and Moon, true night and day)

The Earth shader gains a true sun direction blended by altitude: near the surface the atlas
keeps its composed key light; from the lunar stage outward, and in live sky mode, illumination
and the terminator come from the actual subsolar point. The Moon renders its true phase. A
quiet **live** state: positions at now, refreshed on a slow poll when the sidecar is present,
otherwise the generated snapshot with its `as of` label. **Syzygy watch**: current elongation,
the next conjunction and opposition, each linked to `a:syzygy`, `f:coniunctio` and the prime
`self` — the astronomical fact stated, the Jung reading attributed beneath it, no more.
Optional, deferred by default: NASA Black Marble night lights through the existing textures
pipeline.

*Acceptance*: terminator matches the sidecar's subsolar point to display accuracy at a named
instant; Moon phase matches to within a day of true; the artistic near-surface look is
unchanged (screenshot gate); live degradation is labelled, never silent.

### Phase 5 — The birth moment (Kerykeion, natively)

From the sky view, a quiet **Birth sky** disclosure: date, time, place (gazetteer first, sidecar
geocode fallback), timezone resolved by the sidecar (zoneinfo; pre-1900 local times labelled
approximate, as the house labels its dates). The sidecar computes the chart; the sky animates to
that moment — bodies fly to their natal longitudes — and the chart reads in place: planets,
signs, aspects as quiet arcs (default off), houses as an optional ring. Every prominent body
links down through its mythic node to the field. The moment is linkable
(`#/sky/birth/<iso>/<lat>/<lon>`) and restorable. Framing text is fixed and sourced: *the sky at
that moment, read in Jung's keys* — no predictions, no verdicts (D6).

*Acceptance*: end-to-end without leaving the page; chart JSON validated against the sidecar
contract; a golden chart (one known instant/place) pinned in tests; absence of the sidecar
disables the disclosure with a labelled notice rather than failing.

### Phase 6 — Aion's ground: the precession of the equinoxes

`src/aion/precession.ts` — pure and golden-tested: general precession in longitude (IAU 2006
polynomial; ~50.29″/yr ≈ 1° per 71.6 yr) gives the vernal point's sidereal longitude across the
reading's span; sidereal boundaries in the labelled conventions: Jung's equal months (2 143 yr,
the display clock already in force), and the ayanamsa-anchored and constellation-boundary
alternatives from the sidecar's golden table. In Aion mode this becomes the visible ground:
the ecliptic ring carries the zodiacal ticks and the equinox point walks backward as the clock
plays; the Aion card gains **The sky's clock**, a disclosure showing where the equinox actually
rises, per convention, beside Jung's reading — the conditional Aquarian boundaries (1997, 2154,
the 2000–2200 range) shown as calculations, as AION-SOURCES already insists. `PRECESSION-NOTES.md`
records sources (IAU 2006/Capitaine; Delporte's IAU boundaries; the ayanamsa conventions) in the
AION-SOURCES form.

*Acceptance*: precession module matches the golden table across ±13 millennia within arcminutes;
Jung's display boundaries remain primary and unchanged; every astronomical boundary is labelled
with its convention; the two clocks are never conflated (D5).

### Phase 7 — Optional enrichment (each separately adoptable)

Real planet textures through the existing Commons/images pipeline (public-domain NASA/JPL, the
`image-queries.json` pattern); IAU constellation stick figures as a sky backdrop; Black Marble
night lights; synastry and transit readings beside the birth sky. None blocks the layer; each
carries its own sources and honesty labels. Not planned: real-scale outer system by default,
a standalone "orrery page", any predictive feature.

## 6. The house bar (what "up to standard" means here)

- **Interaction** — Google-Earth-grade: cursor-anchored zoom with 0.0000° anchor drift, inertial
  drag, flight cancellation, no janky resets, no orientation loss at any scale (`src/globe/zoom.ts`,
  `controls.ts` are the standard; new camera code is pure and tested the same way).
- **Motion** — slow, composed, eased (`easeInOutCubic`, 1.6 s palette tween, exponential approach
  that never overshoots); reduced-motion shortens everything; no twitch, no novelty 3D.
- **Atmosphere** — one palette system, spectrum-governed; fog/glow/deep shared uniforms; the sky
  deepens the existing mood rather than introducing a second one.
- **UI** — minimal, quiet, secondary: focus-label typography, reveal panels that follow their
  content, one quiet disclosure per idea, settings clear of the time control, Escape always
  climbs the ladder (`back()`), visible UI stays within the SPEC §10 budget.
- **A11y** — labelled controls, inactive panels out of the keyboard path and the accessibility
  tree, coarse-pointer targets generous, all verified in the WebKit smoke pass.
- **Data honesty** — basis-tagged ties, dated sources, approximate/conditional labels, generated
  outputs with `generatedAt` and equality checks, loud failure over silent fixtures.
- **Testing** — pure math isolated for vitest (`zoom.ts`, `timeModel.ts`, `precession.ts`);
  deterministic `advance()` for render-time behaviour; e2e browser walks (Chromium + WebKit)
  with screenshot gates; `git diff --check` clean.

## 7. Risks and their guards

- **Depth and scale**: far-plane and depth-precision at ~10⁶ units can regress the existing
  globe. Guard: Phase 1 opens with a spike; the pixel-diff gate keeps Earth-mode rendering
  unchanged below the handoff; floating-origin rendering is the named contingency if jitter
  appears near the outer system.
- **Sidecar dependency**: the site must never hard-require it. Guard: generated snapshots carry
  the sky; live features degrade labelled (D2, Phase 5 acceptance).
- **Two clocks confusion**: guard as stated in D5; Aion is the only bridge and it is labelled.
- **Schema governance**: the vault tier and the `presides` relation are proposals; the owner
  adopts or reshapes them (D3). The curation path keeps every phase unblocked meanwhile.
- **Framing drift**: any wording that predicts, diagnoses or endorses is a defect (D6); Aion
  sources are the precedent to imitate.

## 8. Open questions for the owner

1. `S` as the sky key, and whether the Settings switch and the zoom gesture should share one
   state (recommended: yes, D1).
2. Pluto alongside the modern bodies (recommended: include, flagged `modern`).
3. The sidecar's port (recommended: 5187, beside the dev server) and its name (`ephemeris/`).
4. The vault's `wiki/sky/` tier and the `presides` relation — owner's call under SCHEMA.md.
5. Default radial compression for the system view (recommended: power-scaled so Saturn's ring
   fits the frame, factor stated in the caption).
