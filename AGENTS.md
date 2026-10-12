## Learned User Preferences

- Keep ProjectCentral and project docs inside `Archetypal-Earth/ProjectCentral/`; never create a loose `~/Central/Work/ProjectCentral/`.
- Merge finished feature work to `main` before deploying; production builds `main`, not a feature branch.
- Do not remove established behaviours when fixing adjacent UI (personal chart, descend-to-archetype, sky orbits, modal close staying in-mode).
- Mode chrome: closing a reading/modal stays in that mode; the no-modal state keeps options; put options in one bottom-panel control under the mode selector, matching the rest of the app rather than ad-hoc lists, toasts, or dividers.
- Keep the authored product README (what/why from early history); do not replace it with a data-pipeline note or an old spec.
- Prefer unique Commons image plates per family/occurrence within the 320MB budget; slug or metadata coverage is not the same as distinct plates on the site.
- Field: clicking a node opens that instance (parent is already linked); default focus is The Self.
- Astrology/sky: orbits and options belong in default sky mode, not walk-gated; modal X closes to sky with orbits (do not force the birth-chart view); default view is the zoomed-out sky with the chart (not walk-gated); drop snapshot/radial-scale text dumps; prefer a near-live ephemeris-driven sky; orbit-node click stays at the planet, gazes at Earth (floats up) and float click descends; descend looks at Earth, then drops, then settles—open the reading only after descend finishes; return to sky zooms out a little, orients to the planet, then zooms to it; planet pick in-sky approaches without a forced zoom-out; subjects with sky ties keep a persistent “See in sky” (not ad-hoc “back to sky”).

## Learned Workspace Facts

- Archetypal Earth is `~/Central/Work/Archetypal-Earth` (GitHub remote `EpiLogos/archetypal-earth`), with its own docs and `ProjectCentral`.
- Cite and ingest use the vault at `~/Documents/books/jung-archetypal-field` (`VAULT=...` for theory, astrology, practice, depth, aionbook, dynamics-route, and images work).
- After new plates land in `public/data/images.json`, run ingest so `field.json` carries them (`VAULT=$HOME/Documents/books/jung-archetypal-field npm run ingest`), then `npm run images:verify`.
- The dynamical lens is a route: `curation/dynamics-route.json` → `scripts/dynamics-route.mjs` → `public/data/dynamics-route.json` / `src/dynamics/figures.ts`; the e2e gate is `tests/ui/e2e/dynamics-route.mjs`.
- In `scripts/lib/cite.mjs`, a ¶ is cited only when the next marker is the next number; otherwise cites stay page-only.
- Dynamics/theory quotation enrichment draws from vault works `van-eenwyk` and `cw08` through the existing citation rails; quotes must be verbatim on the cited pages.
- Elements/alchemy/sky/Thoth plan: `ProjectCentral/docs/ELEMENTS-ALCHEMY-SKY-TAROT-PLAN.md`. Alchemy is its own lens (not a Theory subsection). Elemental earth family id `earth-element` (display “Earth”); sky planet body key `terra`. Quintessence, ether, and spirit are distinct, not aliases. Number archetypes extend through ten with Sephiroth; the tree family is the join.
- Thoth deck work uses plates from `~/Central/Work/Quaternal-Tarot`; Book of Thoth is under `~/Documents/books`. Families cover majors, minors, suits, ranks↔1–10, and courts as archetypes.
