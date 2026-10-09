# The dynamical lens — one-page spec (2026-10-09)

Third sibling of the Aion and Red Book harvests, commissioned by the Van Eenwyk external-lens lane and
never built (AUDIT-2026-10-09 §5). Lives under [SPEC.md](SPEC.md); the sourcing discipline is
[AION-SOURCES.md](AION-SOURCES.md). The vault's `wiki/maps/chaos-dynamics.md` correspondence table is on the
owner's machine, not in this clone: what it holds enters the site **only** through the vault-side rail below,
never typed here.

**One sentence.** The field read as a dynamical system: *families are basins, the instinct↔spirit spectrum is the
order parameter, an archetype's occurrences through time are a trajectory, parallels are correlated
trajectories, dates are the field's history* — drawn, not tabulated (SPEC §3, §13, §14).

## 1. Voices (the labelling law)
Van Eenwyk's vocabulary (attractor, basin, bifurcation, phase transition, the chaotic edge) is **V**.
Jung's words are **J**. They are never merged: a V term never appears in a sentence in Jung's voice, never
as a quotation attributed to Jung, never in a Jung card. A V mark (tooltip: *Van Eenwyk's reading — not Jung's*)
appears **only on a concept quotation**, where a vault-matched Van Eenwyk passage exists; the strip carries no
voice mark at all. Measures this site computes from its own data are a third kind, labelled **drawn here** — they
claim nothing about Jung or Van Eenwyk: the strip's trace, its bands, its crossing ticks, and the hero's native
renders. Source for V: Van Eenwyk, *Archetypes & Strange Attractors* (Inner City Books, 1997), cited by
printed page.

## 2. The mapping (what the data already is)
| Dynamical term (V) | Field datum | Source in `field.json` |
|---|---|---|
| order parameter | `spectrum.position` ∈ [0.12, 0.88], inherited by each occurrence from its family (SPEC §16) | `families[].spectrum` |
| basin | a family — the region of the spectrum its occurrences recur around | `families[]`, `famOcc` |
| trajectory | an archetype's (or family's) occurrences binned into 40 eras along its own span: the count-weighted mean *s* per era, lightly smoothed; an era with no occurrence is a gap, never interpolated across (`eraSeries`, `smoothEra`) | `archOcc`, `occ[].year` |
| phase transition (V) | a *sustained* crossing of the midpoint 0.5: the smoothed series enters the other side past ±0.03 (hysteresis), with at least 5 occurrences on each side (`sustainedCrossings`). Drawn as one neutral tick, computed here | derived from the trajectory |
| a single level | a subject whose era means do not vary (spread ≤ 0.03) is drawn as a band at its *s*, not a trace. Every family is one; so is every parallel group, whose *s* is its family's constant | `families[].spectrum` |
| correlated trajectories | `parallelIds` — 2,584 of 2,745 occurrences have ≥1. A companion is drawn only where its own era series varies, which on the shipped field is never (see §6) | `occ[].parallelIds` |
| history | the 2,745 dated occurrences; `year`/`yearDisplay` honesty labels stay | `occ[]` |
| the iteration nobody observes | the graph's d3 force simulation (an n-body system) | `src/graph/*` |

## 3. Experience (SPEC §4, §9, §10)
- **Entry:** one quiet switch beside Aion / Red Book (`Dynamics`, key `D`), hash `#/dynamics[/<subject>]`, state
  `dynamics?: { subject?: Subject }` orthogonal like `redbook`; Esc climbs the ladder; deep links; Back works.
  Inactive panel out of the keyboard path and the accessibility tree; reduced motion honoured.
- **The globe stays the centre.** With a subject (any archetype/family — chosen with the existing search or
  focus), its occurrences light in order of date and the chronology arc runs along the time cursor
  (the arc machinery of Phase 5, shared). Nothing else is added to the globe. A subject picked inside the lens
  glides the clock to its span, as a focus does; it never snaps (SPEC §9).
- **The phase strip** (one canvas, bottom, above the time control): *s* against time for the subject, drawn as
  eras — count-weighted and lightly smoothed, with gaps where a span holds no occurrence. A subject that is one
  level (a family) is a quiet band at its *s*, not a trace. Basins are soft bands in their family colours. A
  sustained midpoint crossing carries one neutral tick on the 0.5 line, titled *crosses the midpoint · drawn here*;
  where none survives there is none. The cursor is a point on the drawn line. No axes, no legends, no numbers
  (SPEC §14: no stats displays); the strip is read, not decoded.
- **The reveal card** (one at a time, the mode's reveal panel): the hero is the natively rendered attractor (§4),
  captioned with the system it draws — *Lorenz attractor · drawn here* — an illustration of the lens, not of the
  subject. The subject's name is the heading; no line of Jung's is set under the hero. With concept data, a V
  concept — *attractor-generating pattern*, *strange attractor*, *mandala as fractal attractor*, *enantiodromia*,
  *the chaotic edge* — leads with the concept's **verbatim quotation as an open blockquote with a printed-page
  cite**, a Jung quotation beside it where the vault pairs one (J-labelled). A concept with no vetted quotation
  shows **no card** — a loud omission, never invented prose.
- **Compare:** not yet built. The Self (prime) and a chosen subject as two traces in one strip wait on the owner's
  reading of the strip's rule (§6).

## 4. Native attractor renders (original work, no licence issue)
`src/dynamics/render.ts` — pure, deterministic, unit-tested: `lorenz(n)` (σ=10, ρ=28, β=8/3, RK4) projected
and drawn as a luminous trail in the subject's palette; `mandelbrot`/`julia` tiles tinted by the spectrum
palette. These are *generative illustrations of the named systems*, captioned by the system they draw ("Lorenz
attractor · drawn here") — they are **not** reproductions of the book's plates. The hero repaints when its box or
the device pixel ratio changes. The ten staged plates in `curation/van-eenwyk-figures/` are copyrighted
(Inner City Books / Art Matrix); they stay in `curation/`, are never copied to `public/`, never referenced by
code. Promotion is the owner's reserved decision.

## 5. Data rail (vault-side, runs on the owner's machine)
`curation/dynamics.json` (site choices: which concepts, which families they bind to, which Jung quotation
pairs) → `scripts/dynamics.mjs` (+ `--check`) → `public/data/dynamics.json`. The Van Eenwyk quotation is
**never typed**: curation names a corpus work, a pdf page and a match key, and the script matches it **verbatim**
against that page. A match is refused unless it occurs exactly once, starts and ends at a word boundary, runs at
least six words, and does not span a hyphen at a printed line break: the rail never de-hyphenates by guess
(*self-/reflection* and *re-/peats* cannot be told apart), so it refuses and the curator chooses another match.
A mismatch, a missing page, or an ambiguous match is a loud failure (the `definitionPick` rail of
`scripts/ingest.mjs`).

The cite is taken from the corpus, not typed: a Van Eenwyk locator must be the printed page the corpus marker gives
the matched pdf page (`print pNN` → `p. NN`), and a Van Eenwyk cite carries the matched source's own title and year.
A Jung locator must name the matched pdf page. Until `public/data/dynamics.json` exists the mode renders everything
computed from `field.json` (strip, arcs, native renders) and shows no concept cards. `npm run dynamics:check` with
no concepts curated prints *nothing to check* and fails if a published file exists without its curation. Cloud
sessions cannot run the rail; the owner runs `npm run dynamics:check`.

## 6. Out of scope / honest limits
No claim that the field *is* chaotic; no Lyapunov exponents or fitted models presented as findings; no prediction
(cf. SKY-SPEC D6). The strip is a drawing of recorded dates and a published order parameter.

What the rule finds on the shipped field, as the unit tests pin it: the Self has **no** sustained crossing (over
every era with more than one occurrence its mean stays between 0.41 and 0.52, short of the far side of 0.5 at
0.53); the Hero, Shadow, Great Mother, Anima and Trickster have none either; Psychopomp has one. The Hero's
single-occurrence excursions across 0.5 are real occurrences, but five are needed on a side before a crossing is
drawn. Most subjects therefore carry no tick, and that is the reading, not a fault. A family is one level and is
drawn as a band; the three parallel groups of the Self are one level each, so none is drawn.

The correspondence rows (attractor-generating pattern; mandala as fractal attractor, Van Eenwyk pp. 110–111;
enantiodromia as phase transition; health at the chaotic edge) are named by the audit from the vault harvest and
remain to be verified verbatim by the rail in §5.
