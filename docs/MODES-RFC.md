# MODES-RFC — one instrument, many lenses

Status: accepted for implementation, 2026-10-10. Written before the refactor; the "As built" notes at the end
record where the implementation differs.

## 1. What is wrong now

I walked every mode on a desktop (1440×900) and a phone (390×844) before touching anything. What I found:

- **Every mode draws its own chrome.** Aion puts "Aion · C. G. Jung" in a 40px serif heading with its own author line
  and Browse menu. The Red Book draws "The Red Book" plus a subtitle, a one-liner and its own walk/genesis toggle. The
  dynamical lens draws "The Self" with its own link row. The sky draws its own culture selector and birth disclosure.
  There are four headings in four styles in the same corner, and none of them says which mode you are in.
- **The switches are a row of words.** `Dynamics · Red Book · Sky · Aion` sit top right, beside an Earth/Graph pill and
  the search glyph. On a phone, Aion's heading collides with that row (the row sits at 16px, the heading at 20px).
- **A mode is a boolean on the state.** `AppState` carries `history`, `redbook`, `dynamics`, `sky` and `graph` as
  independent flags. The controller's `apply()` has an early-return branch per flag and a `leaveX()` per mode. Adding a
  mode means another flag, another branch, another switch button and another heading. That is the mode creep the owner
  wants stopped.
- **Nothing is filtered, everything is a mode.** There is no way to say "only CW 12" or "only Gnostic material" or "only
  dreams" except by inventing a mode for it.
- **The birth sky breaks the privacy law.** `#/sky/birth/1990-04-01T08:30/51.5/-0.12` puts a person's birth moment in
  the URL, where it lands in browser history and in any link they copy. It also only works with the local Python
  sidecar, so it is dead on the deployed site.
- **One bundle.** `vite build` emits one 916 kB script (261 kB gzipped). Aion, the Red Book, the graph and the lens are
  all parsed before the globe can draw.

## 2. The shape: a shell, lenses, filters

```
┌──────────────────────────────────────────────────────────────────┐
│ [≡ Aion ▾]  Pisces · the first fish          [⌕]  [GitHub icon]   │  ← the shell's one bar
│  └ lens controls slot (the mode's own few controls)              │
│                                                                  │
│                        the globe / the graph                      │  ← unchanged: one scene
│                                                                  │
│                              the mode's panel (card or sheet) ──┐ │
│  [filter chips: CW 12 × · Gnostic ×]                             │ │
│  ─────────────── the shared time control ───────────────         │ │
└──────────────────────────────────────────────────────────────────┘
```

**The shell** (`src/shell/`) owns all chrome and nothing else:

- **One title.** The top-left button shows the active lens's icon and name; under it, one context line that the lens
  sets (the reading, the folio, the subject). It is the only `h1` on the page. `document.title` is derived from it.
- **One menu.** Pressing the title opens the menu. On a desktop it is a popover under the title; at ≤720px it is a bottom
  sheet with 48px rows, reachable by a thumb. It lists the lenses in two groups, the filter controls, and the footer
  (downloads, issues, credits, and the privacy line).
- **One slot for lens controls.** A lens may hand the shell a small row of its own controls (Aion's reading picker and
  epochs, the Red Book's walk/genesis toggle). The shell places and styles them; the lens never positions chrome.
- **One panel host.** Lenses that need a reading surface get the shell's panel: a right-hand card on a desktop, a
  bottom sheet with a grab handle on a phone. The existing reveal/deep layers keep their own placement for now (§7).
- **The corners.** Search glyph and a GitHub icon (icon-only, links to the repository) top right. Nothing else.

**A lens** is a plugin:

```ts
interface LensDef {
  id: LensId;                 // 'field' | 'theory' | 'aion' | 'redbook' | 'astrology' | 'dreams' | 'symbols' | 'coincidences'
  label: string;              // "Red Book"
  icon: IconName;             // from src/ui/icons.ts, one stroke family
  group: 'read' | 'practice';
  blurb: string;              // one plain line in the menu
  key?: string;               // keyboard shortcut
  load(): Promise<LensModule>;   // dynamic import: the code is fetched when the lens is first opened
}
interface LensModule { mount(ctx: LensContext): LensInstance }
interface LensInstance {
  enter(route: string[]): void;  // show, at a sub-route (e.g. ['venus'])
  leave(): void;                 // tear down everything it added to the scene or the DOM
}
```

`LensContext` gives a lens the model, the engine, the clock, the shell API (`setTitle`, `setControls`, `panel`), the
shared filter, the corpus passage bridge, `navigate`, and the practice store. A lens never touches another lens.

## 3. The hierarchy

Lenses are the robust modes. Everything that slices the field (a book, a volume, a culture, an era, a kind of material)
is a **filter**, never a lens. That rule is the whole point: no per-book or per-culture modes, ever.

| Group | Lens | What it is | Built from |
|---|---|---|---|
| read | **Field** | The globe and the graph: archetype → family → occurrence, focus, threads. Home. | existing core |
| read | **Theory** | Psychodynamics: libido as energy, compensation, enantiodromia, the transcendent function; the number/QL lens; the dynamical lens as its picture | vault concept notes, von Franz, QL reference, existing dynamics view |
| read | **Aion** | The aeon doctrine: Pisces, the Turn, the Aquarius horizon | existing Aion view |
| read | **Red Book** | The genesis narrative: the folio walk and the genesis table | existing Red Book view |
| practice | **Astrology** | Your natal sky beside Jung's, walked planet by planet, each planet read through the corpus | sky layer + in-browser ephemeris + `curation/astrology.json` |
| practice | **Dreams** | A private dream journal; each image amplified from the corpus's dream and vision instances | `src/practice/` + field |
| practice | **Symbols** | The amplification engine as a flow: any symbol → family → dated instances → doctrine | field + concept notes |
| practice | **Coincidences** | A private synchronicity log, drawn as your own series beside Jung's statements on seriality | `src/practice/` + cw08/sync records |

**Graph** is not a lens: it is a second rendering of the Field (the existing Earth ⇄ Graph pill, now inside the shell
bar while the Field is active). **Sky** is not a lens: it is a scale of the globe you reach by zooming out (or `S`), and it
is the ground the Astrology lens stands on. **Dynamics** moves inside Theory.

The **Self is the centre**: the entry action lands on the Self's node (§6), the Theory lens opens on the Self, the
dynamical lens's default subject is the Self, and the Astrology walk ends on the Sun → Self tie, which is where every
chart, Jung's included, meets the field.

## 4. Filters

```ts
interface FieldFilter {
  works?: string[];    // Jung volumes cited by the occurrence (Occurrence.jung[].work): 'cw12', 'sem-visions'…
  cultures?: string[]; // Occurrence.cultureIds
  era?: [number, number]; // year range on Occurrence.year
  kinds?: LocusType[]; // 'dream' | 'vision' | 'artifact' | …
}
```

- One filter lives in the shell and applies to every lens that shows the field. The engine receives a **mask**: an
  occurrence the filter excludes is not drawn and cannot be picked. Emphasis (focus, threads, Aion's reveal) composes
  with the mask in one place (`GlobeEngine.setEmphasis`), so no lens has to know about filters.
- Search results, thread walks, amplification parallels (Dreams, Symbols) and the graph's occurrence nodes read the same
  predicate (`passes(occ)`).
- The authored readings (Aion events, Red Book folios, the Astrology walk) are not filtered: they are texts with an
  order. The field under them is.
- The filter is linkable: `#/a/self?w=cw12,cw9ii&c=gnostic&e=-200..400&k=dream`. It is not personal data.
- The menu shows the filter; active filters show as removable chips above the time control.

## 5. Routes and state

The hash keeps every existing route (links stay valid). Lenses add theirs:

```
#/                      Field, world             #/theory[/<section>]       Theory
#/a/self …              Field, focus etc.        #/dynamics[/a/<id>]        Theory's dynamical picture
#/graph …               Field as graph           #/astrology[/you|/jung][/<body>]
#/aion/… #/redbook/…    unchanged                #/dreams[/<entryId>]  #/symbols[/<family>]  #/coincidences
```

`AppState` gains one field, `lens?: { id: PanelLensId; path: string[] }`, for the panel lenses. The older flags
(`history`, `redbook`, `dynamics`, `sky`, `graph`) stay as they are because their transitions are tested and correct;
`lensOf(state)` maps any state to the lens the shell shows. A lens switch always goes through `navigate()`, so Back,
Escape and links work the same everywhere.

**Privacy in routes.** No personal data is ever in a route. `#/astrology/you` names a chart; the birth data behind it is
read from localStorage. `#/dreams/<id>` names a journal entry by a random id. The old `#/sky/birth/<moment>/<lat>/<lon>`
links open the Astrology form pre-filled (not saved) and the hash is replaced with `#/astrology`, so the moment does not
stay in history.

## 6. Landing

The globe is the landing. On first visit the page shows the field and one short line of mine with a single action. The
action flies the camera to the Self's node and opens the Self, which is where every lens starts from. No image, no
paragraph, no buttons before the field is seen. Downloads and Issues leave the intro: the GitHub icon sits in the
corner and Downloads goes in the menu footer.

## 7. Mobile and performance

- Every control is at least 44×44px on touch devices; hover-only affordances (the credit `i`, hover labels, the card
  double-click) get a tap equivalent.
- The menu, the lens panel and the filter are bottom sheets at ≤720px.
- Lenses are code-split: `load()` is a dynamic `import()`, fetched the first time the lens is opened (or when a link
  boots into it). The graph is split the same way. Images in panels are `loading="lazy"`.
- Measured before and after in §9.

## 8. Practice storage (one module for all personal tools)

`src/practice/store.ts` is the only code that reads or writes personal data. It stores under one prefix
(`aae.practice.v1.*`) in localStorage, never sends anything, and exposes `list/get/put/remove/exportAll/wipe`.
Each practice lens states in its own UI: "Stays in this browser. Nothing is sent anywhere." and offers export (a JSON
file the browser saves) and delete-all.

The astrology chart, dream entries and coincidence records share the store, so a later shared layer can slot in as a
second backend behind the same interface without touching the lenses.

## 9. Measurements

Recorded with `vite build` (Rollup chunk sizes) and Lighthouse mobile (simulated Moto G Power, headless Chromium with
software GL in the cloud container, so absolute scores are pessimistic; compare before and after only).

| | before | after |
|---|---|---|
| JS on first load (raw / gzip) | 916 kB / 261 kB (one chunk) | see "As built" |
| Lighthouse mobile performance | see "As built" | see "As built" |

## As built

(Filled in after the refactor.)
