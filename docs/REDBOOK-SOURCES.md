# Red Book source and licence notes

The Red Book mode presents Liber Novus (1913–1930) as a folio-sequence walk over the same
globe, with the vault’s genesis table beside it. The curated source is `curation/redbook.json`;
`public/data/redbook.json` is its validated generated projection. Generate and verify:

```sh
npm run redbook
node scripts/redbook.mjs --check
npx vitest run tests/data/redbook.test.ts
```

## Source basis

The vault completed its Liber Novus lane (capstone: `wiki/maps/red-book-bearing.md`; work note
`wiki/works/liber-novus.md`; ~40 `liber-novus-*` instances, all `subject: jung`, folio/ms/pdf-cited).
The walk uses exactly those instances — every stop is an occurrence id in `field.json`, so titles,
dates, places, quotes and bodies come from the ingested field and are never copied. The curation
adds only what the vault does not hold: the order of the descent (ten sections, 37 stops), the
plate mapping per stop, and the genesis table’s rows as links.

The ten sections follow the descent’s own sequence: the flood and the refound soul → Siegfried →
Elijah and Salome → the Red One → the desert → Izdubar → the egg → Philemon and the second layer →
the Sermones → the epilogue. Stops keep the vault’s own dating (`year_display`) and folio citations.

## The plates — licence law, handled deliberately

The 210 facsimile plates (`vault:_raw/redbook/plates/p0014.jpg–p0223.jpg`) are copyrighted pages
of the Norton facsimile of Liber Novus. The site’s Commons-only provenance law governs anything
shipped or committed, so:

- **Plates never enter git and never enter dist.** The build copies nothing; the data file records
  plate *file names* only.
- They are **local-only runtime assets**: a dev-server-only route (`/redbook-plates/`, see
  `vite.config.ts`) streams them from the vault’s own copy on this machine. Any served build gets
  a 404 and the card degrades to a cited note naming the vault path.
- The decision is recorded in `curation/redbook.json` under `licence`, and the mode’s plate note
  repeats it wherever a plate is missing.
- A plate is attached to a stop only when the vault’s own instance body names it (`PLATE (pNNNN.jpg
  …)`) — 15 stops carry one. The vault’s plate mapping (plate `pNNNN` = ms page `NNNN − 31`, once
  manuscript numbering begins) is the vault’s, not ours.

The mode’s text is the vault’s Reader-edition English (folio/ms/pdf-cited translations), quoted
under the vault’s own citation law. German blackletter folios are read only through that
translation, exactly as the vault reads them.

## Genesis view

The genesis table is the vault’s capstone (`red-book-bearing.md`, §2): each root hub → its Liber
Novus root locus → the published doctrine it grew into. Every row’s `words` are verified verbatim
against the vault’s map at build time — the curation cannot improve on the vault’s wording. Rows
link forward to the field archetype or family it became (or, for the aeon doctrine and the war
prophecies, to the Aion readings that carry those arcs), and back to the folio stop.

## Honest gaps (inherited from the vault)

- The German-only folios: all quotes are translations, cited to the Reader edition’s pdf pagination.
- The Sermones/Scrutinies are absent from the facsimile — no plates exist for the Sermones stops
  (pdf 377–85); the mode says so by carrying no plate, never a substitute image.
- The calligraphy ends mid-scene at ms p.189; the frog-son and the Scrutinies exist only in lower
  strata.
- The Black Book stratum is reached only through editor notes, as in the vault.
- Jung relative to himself: every record is `subject: jung` — analyst, patient, prophet and
  commentator are the same body, and the mode labels that on every card rather than resolving it.
