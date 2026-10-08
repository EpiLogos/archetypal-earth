# Recovered feature round — 8 October 2026

The recovered Claude session is `58aed336-feca-45f4-840f-dddfebf80668`.
The owner asked at 01:31:40 UTC for a higher quality map and zoom, OCR repair,
an Obsidian-style graph, quieter fonts, surface-aligned selection rings and
clear live points. At 02:14:29 UTC they added Jung's own Aion history and
richer readings from Taschen's Book of Symbols. Claude's interrupted round
had implemented most globe/graph work but had not delivered Aion data or UI.
The current commission explicitly prioritises these features and defers the
growing corpus refresh. The later owner request adds gentle time playback,
a compact graph settings panel, and retained path inspection.

## Working result

Open http://localhost:5183/ (`npm run dev` for a fresh server).

- **Aion / A**: seven sourced epochs, 28 historical events, four historical
  threads, nested periods, source drawers and a clock spanning the reading.
  Conditional dates and geographic uncertainty are retained. Later readings
  extend Jung's dataset separately.
- **G / Graph Settings**: local depth, occurrence visibility, Jung/inferred/site
  relation filters and Reframe. Settings remain clear of the time control.
- **Play history**: the same moving time window drives globe and graph. Nodes
  gently brighten and fade; all-time restores the full field. The normal Earth
  clock ends at the published field's last year; Aion includes its future span.
- **Path inspection**: opening a presence pauses the same tour, retains its
  arcs and step, permits deep reading and returns to the same paused step.
- **Reading**: 29 page-cited Book of Symbols readings appear in family sheets
  and expandable presence details, with related-symbol comparisons. They stay
  distinct from Jung's quotations, chronological records and canonical ties.
- Recovered globe work includes progressive NASA textures and close detail,
  cursor anchored zoom/pinch, flat surface rings, selective points and quieter
  typography. Published image references now match the existing image assets.
- Missing atlas data raises an explicit error. Production never substitutes
  synthetic occurrences.

## Verification

- `npm test -- --maxWorkers=1`: **163 passed, 1 failed**. The sole failure is
  `tests/data/lib.test.ts`'s live-vault ingest determinism check. Its ingest
  child exits 2 with `VALIDATION FAILED (32 errors)` (new family ties and
  unresolved occurrence families) and `OCR RESIDUAL: 3 suspect(s) remain`.
  This is the owner's explicitly deferred corpus refresh, outside the published
  snapshot; it has not been hidden, disabled or weakened.
- `npm run symbols:check`: passed against the actual private PDF, source page
  fingerprints/witnesses and generated parity (29 motifs, 45 content pages).
- `npm run aion:check`: passed against the actual Jung corpus and live field.
- `npm run build`: passed; the synthetic dev fixture is absent from the client
  build. `node scripts/validate.mjs` and `git diff --check`: passed.
- Actual GPU zoom/pinch/drag/double-click acceptance reports 0.0000° anchor
  drift, working flight cancellation, and NASA detail at zoom levels 7–8
  with no failed tile requests.
- `QUALITY_BROWSER=webkit node tests/ui/e2e/quality-smoke.mjs`: real-GPU browser acceptance
  passed at desktop and 390×844. It verified time playback reaching the renderer,
  a stable paused clock, graph settings/filtering/Escape, mobile control placement,
  node inspection, deep reading, return to the same Tour object and step, and
  Resume, with no browser errors or warnings. Inactive graph, label, presence and
  path panels are removed from keyboard navigation and the accessibility tree.
- The final bounded UI/graph replay passed **42 tests in seven files** after
  the close-zoom and accessibility repairs; the production build, published
  field validation and whitespace checks also passed again.
- Manual in-app checks verified graph/focus/Earth transitions, nested Aion
  epochs, historical threads and reloadable links, and the actual Book of
  Symbols section. A temporary boot error found during integration was fixed
  and replayed. Source-page spot checks covered tree, fish and mandala.

## Rendering limit

Map profiling stopped at the owner's direction. The result below records the
last completed replay; it is not a reason to hold up the feature work.

An extreme anchored zoom could reject all map tiles because a coarse patch's
centre projected off-screen while its edge filled the viewport. Culling now
tests the entire spherical patch against the camera frustum. Independent WebKit
replays at Italy, the Alps and India, at camera distances 1.05–1.053, draw actual
level-8 detail with no failed tile requests. Only one decoded tile is uploaded
per frame, prioritising the visible centre and discarding departed views.

WebKit's unchanged frame budget still fails during close tile streaming. The
latest bounded zoom/pan profiles measured median 52.6/55.6 fps, with maximum frames
177/125 ms; individual GPU transfers took approximately 70 ms. This residual
loading hitch is retained as an open performance limitation. It is not a passing
60 fps claim or a disabled acceptance check. The repaired Chromium profile and
exact replay commands are recorded with the quality evidence under
`.cache/screens/quality-finish/`.

## Interface refinement

At the owner's correction, parallel work and map testing stopped. Aion now uses
the existing focus-heading typography, manifestation panel, text spacing, close
glyph and glass treatment. Its event/thread selectors live behind one quiet
Explore history disclosure; the single reading is a heading rather than a
dropdown. The panel follows its content rather than filling a fixed-height
column. Short epoch labels leave the shared timeline clear. Graph Settings uses
the same existing surface treatment. This is an evolution of the atlas interface;
the added source data and functioning path/time behaviour remain intact.
The refined interface was reviewed in the in-app browser, including the
disclosure closing after selecting a historical thread; `npm run typecheck`
and `git diff --check` passed afterward. No further map tests were run.

## Remaining scope

The owner deferred reconciliation with the growing Jung corpus. No source-vault
files were changed by this recovery. This is the existing local checkout;
there is no remote deployment or push. Source depth lives in AION-SOURCES.md
and SYMBOLS-SOURCES.md. Local proof is saved under `.cache/screens/`, including
`recovered-aion-evolved.jpg` and `recovered-symbols.jpg`.
