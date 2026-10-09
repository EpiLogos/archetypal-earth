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
as a quotation attributed to Jung, never in a Jung card. In the mode every V item carries a small `V` mark
(tooltip: *Van Eenwyk's reading — not Jung's*), exactly as ties carry their basis chip. Measures this site
computes from its own data are a third kind, labelled **drawn here** — they claim nothing about Jung or
Van Eenwyk. Source for V: Van Eenwyk, *Archetypes & Strange Attractors* (Inner City Books, 1997), cited by
printed page.

## 2. The mapping (what the data already is)
| Dynamical term (V) | Field datum | Source in `field.json` |
|---|---|---|
| order parameter | `spectrum.position` ∈ [0.12, 0.88], inherited by each occurrence from its family (SPEC §16) | `families[].spectrum` |
| basin | a family — the region of the spectrum its occurrences recur around | `families[]`, `famOcc` |
| trajectory | an archetype's (or family's) occurrences ordered by `year`: *s(t)* | `archOcc`, `occ[].year` |
| correlated trajectories | `parallelIds` — 2,584 of 2,745 occurrences have ≥1 | `occ[].parallelIds` |
| history | the 2,745 dated occurrences; `year`/`yearDisplay` honesty labels stay | `occ[]` |
| the iteration nobody observes | the graph's d3 force simulation (an n-body system) | `src/graph/*` |

## 3. Experience (SPEC §4, §9, §10)
- **Entry:** one quiet switch beside Aion / Red Book (`Dynamics`, key `D`), hash `#/dynamics[/<subject>]`, state
  `dynamics?: { subject?: Subject }` orthogonal like `redbook`; Esc climbs the ladder; deep links; Back works.
  Inactive panel out of the keyboard path and the accessibility tree; reduced motion honoured.
- **The globe stays the centre.** With a subject (any archetype/family — chosen with the existing search or
  focus), its occurrences light in order of date and the chronology arc runs along the time cursor
  (the arc machinery of Phase 5, shared). Nothing else is added to the globe.
- **The phase strip** (one canvas, bottom, above the time control): *s* against time for the subject — a single
  drawn trajectory, basins as soft bands (family colours), the cursor a point riding the line, parallels as
  faint companion traces. A crossing of the midpoint with a large jump is marked once, with a `V` mark
  *phase transition* (V: enantiodromia read as phase transition). No axes legends, no numbers (SPEC §14: no
  stats displays); the strip is read, not decoded.
- **The concept card** (one at a time, the mode's reveal panel): a V concept — *attractor-generating pattern*,
  *strange attractor*, *mandala as fractal attractor*, *enantiodromia*, *the chaotic edge* — leading with the
  concept's **verbatim quotation as an open blockquote with a printed-page cite**, a Jung quotation beside it
  where the vault pairs one (J-labelled), and a hero image: the natively rendered attractor (§4).
  A concept with no vetted quotation shows **no card** — a loud omission, never invented prose.
- **Compare:** the Self (prime) and a chosen subject, two traces in one strip.

## 4. Native attractor renders (original work, no licence issue)
`src/dynamics/render.ts` — pure, deterministic, unit-tested: `lorenz(n)` (σ=10, ρ=28, β=8/3, RK4) projected
and drawn as a luminous trail in the subject's palette; `mandelbrot`/`julia` tiles tinted by the spectrum
palette. These are *generative illustrations of the named systems*, captioned "drawn here" — they are **not**
reproductions of the book's plates. The ten staged plates in `curation/van-eenwyk-figures/` are copyrighted
(Inner City Books / Art Matrix); they stay in `curation/`, are never copied to `public/`, never referenced by
code. Promotion is the owner's reserved decision.

## 5. Data rail (vault-side, runs on the owner's machine)
`curation/dynamics.json` (site choices: which concepts, which families they bind to, which Jung quotation
pairs) → `scripts/dynamics.mjs` (+ `--check`) → `public/data/dynamics.json`. The Van Eenwyk quotation is
**never typed**: curation names a page and a match key; the script matches it **verbatim** against the vault's
`corpus/` page text, mismatch = loud failure (the `definitionPick` rail of `scripts/ingest.mjs`). Until that
file exists the mode renders everything computed from `field.json` (strip, arcs, native renders) and shows no
concept cards. Cloud sessions cannot run the rail; the owner runs `npm run dynamics:check`.

## 6. Out of scope / honest limits
No claim that the field *is* chaotic; no Lyapunov exponents or fitted models presented as findings; no
prediction (cf. SKY-SPEC D6). The strip is a drawing of recorded dates and a published order parameter. The
correspondence rows (attractor-generating pattern; mandala as fractal attractor, Van Eenwyk pp. 110–111;
enantiodromia as phase transition; health at the chaotic edge) are named by the audit from the vault harvest and
remain to be verified verbatim by the rail in §5.
