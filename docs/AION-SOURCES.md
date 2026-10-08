# Aion source and dating notes

The historical overlay presents C. G. Jung’s reading of Western symbolic history. It does not endorse astrology, assign moral verdicts to historical movements, or turn Jung’s anticipated future into accomplished history. The curated source is `curation/aion/jung-aion.json`; `public/data/history.json` is its validated generated projection.

## Generate and verify

```sh
npm run aion
node scripts/aion.mjs --check
npx vitest run tests/data/history.test.ts
```

Generation reads the actual corpus without writing into it and resolves all family and occurrence links against the existing `public/data/field.json`. It does not ingest or expand the field. `--check` verifies source quotations, source revisions, the public contract, temporal nesting, chronologically ordered threads, and generated equality without rewriting the output. Unchanged generation preserves `generatedAt`.

The default corpus is `~/Documents/books/jung-archetypal-field`; `JUNG_VAULT` can supply another path containing the same source files. A missing corpus fails source verification; the tests do not substitute a fixture or skip that acceptance check.

## Source basis

The assignment recovered from the Claude Agent call of 2026-10-08 at 02:17:56 UTC asked for Aion’s Platonic months, Pisces’s two fishes, historically situated moments and ordered threads, with source-exact quotations and extension by the owner’s later Antichrist reading. The implemented reading contains 7 epochs, 28 events and 4 threads.

| Work | Actual source file | SHA-256 at curation |
| --- | --- | --- |
| cw09ii | `corpus/cw09ii.md` | `617ae92d0baaafd95f35eecf10ecd7784a1ebebf6d309213d773822d9f4ae5e6` |
| cw10 | `corpus/cw10.md` | `d6568d43ce9f2d59cf5789dcb730f5d629259c6d6ebf2d4481e564fa70231bb0` |

CW9ii is the main source. CW10 ¶589, the later Flying Saucers preface, supplies the explicit Taurus → Aries → Pisces → Aquarius sequence. The quotations are selected exact substrings of the corpus after whitespace normalization. The existing OCR module, version 4, is imported and applied in **safe** mode: Unicode ligatures, soft hyphens and spacing may be repaired; words are neither rephrased nor joined by a speculative vocabulary pass.

The vault’s paragraph spine is incomplete and includes false paragraph hits from the index and contents. It was not repaired. Page comments in the actual corpus bind every passage to its cited source pages. Printed paragraph witnesses, including damaged OCR margins, are retained where available in `sourceBindings`. Continuations are checked on their actual page windows and their paragraph sequence; false spine/index hits are not treated as source evidence.

Two places deliberately retain PDF-page locators: the Aquarius argument on PDF p99 (a dropped paragraph marker, between ¶141 and the corrupted ¶143 marker), and the Lambspringk discussion on PDF p162 (damaged margin sequence). Their text is verified exactly on those pages. The atlas does not invent a paragraph number for them. Other damaged margins retained as witnesses include ¶145 rendered “45,” ¶143 rendered “43,” ¶268 rendered “68,” and ¶156 rendered “1S6.” Paragraph continuations such as ¶149 carry their continuing page rather than a falsely repeated margin.

## The clocks

Historical events use `year` and `yearDisplay`. A representative year for a century or period is expressly called approximate in the display and body. A source’s composition or publication date is not automatically an event date. The modern-crisis marker uses the aftermath of the Second World War, with 1945 named as an atlas gloss, while Aion’s 1950 foreword remains source dating.

The precessional argument is Jung’s interpretive clock. A constellation sign is not a historical epoch boundary: the 7 BCE conjunction occurs in the astronomical sign Pisces but before the approximate year-0 display boundary, so its chronological atlas epoch is Aries. Christ at year 0 is explicitly a symbolic era boundary, not a claimed historical birth date.

Aion ¶149 n.84 calls the Aquarian dating very indefinite. It gives a range 2000–2200 and conditional calculations 1997 or 2154 according to the starting star. Both alternatives remain visible as calculations rather than accomplished events. The epoch picker uses 2200 for a convenient outer display boundary.

Taurus and Aries have no fixed dates in the cited Jung passages. Their display boundaries are two equal 2,143-year months counted backward from the approximate beginning of the Christian era, following the month length mentioned in ¶149 n.84. Aquarius’s display endpoint 4343 is likewise an illustrative equal month, not a future dated by Jung. These choices are disclosed in each epoch’s body.

## Epochs

| Epoch | Display span | Charge in the reading | Source locators |
| --- | --- | --- | --- |
| Taurus · the bull | -4286–-2143 | neutral | cw10 ¶589 (pdf p284); cw09ii ¶149, n.84 (pdf p106) |
| Aries · the ram | -2143–0 | light | cw09ii ¶147 (pdf p102); cw10 ¶589 (pdf p284) |
| Pisces · the two fishes | 0–2200 | neutral | cw09ii ¶148 (pdf p104); cw09ii ¶149 (pdf p106); cw09ii ¶149, n.84 (pdf p106) |
| The first fish · Christ | 0–1000 | light | cw09ii ¶70 (pdf p49); cw09ii ¶149 (pdf p106); cw09ii ¶231 (pdf p161) |
| The second fish · Antichrist | 1000–2200 | shadow | cw09ii ¶231 (pdf p161); cw09ii ¶76 (pdf p54); cw09ii ¶141 (pdf p98) |
| The commissure · the connecting band | 1000–1500 | union | cw09ii ¶149 (pdf p105); cw09ii ¶149 (pdf p106) |
| Aquarius · union of opposites | 2200–4343 | union | cw09ii pdf p99; cw09ii ¶149, n.84 (pdf p106); cw10 ¶589 (pdf p284) |

The first and second fish are children of Pisces. The connecting band is a transitional child within the second-fish span, roughly 1000–1500; Jung supplies no exact endpoints for the band. The UI atmosphere uses the narrowest active span. Palette and spectrum values are the atlas’s visual interpretation of each reading, not numerical measurements given by Jung.

## Events

| Display year | Event | Placement | Source locators |
| --- | --- | --- | --- |
| 1st century BCE · approximate midpoint | The fishes at Denderah | Denderah, Egypt (temple of Hathor) | cw09ii ¶147 (pdf p103) |
| 7 BCE · May 29 in Jung’s account | Jupiter–Saturn in Pisces | No single earthly point asserted | cw09ii ¶130 (pdf p89) |
| Beginning of the Christian era · symbolic boundary | Christ as the first fish | No single earthly point asserted | cw09ii ¶147 (pdf p102); cw09ii ¶149 (pdf p106); cw09ii ¶70 (pdf p49) |
| ~140 CE · existing field dating | Christ casts off his shadow | Rome? (Valentinus; reported by Irenaeus, Adv. haer. I, 11, 1; II, 5, 1) | cw09ii ¶75 (pdf p53); cw09ii ¶76 (pdf p54) |
| ~2nd century CE copy · existing field dating | The vertical and horizontal fishes | Naples · later museum location | cw09ii ¶147 (pdf p103) |
| Around 200 CE · Jung citing Doelger | The early Christian fish | Alexandria · tradition named by Jung | cw09ii ¶145 (pdf p101) |
| After 216 CE · lower-bound display year | The great, pure fish of Abercius | Phrygia / Hierapolis (Abercius epitaph) | cw09ii ¶145, n.71 (pdf p101) |
| ~388–396 CE · existing field dating | Augustine’s king and priest | Hippo Regius | cw09ii ¶228 (pdf p159) |
| A few years after 529 · approximate marker | Benedict and the latent age of spirit | Monte Cassino · monastery named in Aion ¶139 | cw09ii ¶137 (pdf p94) |
| 7th–8th century · approximate midpoint | Morienus and the inner work | Jerusalem → Latin West | cw09ii ¶256 (pdf p178) |
| Around 1000 CE · Jung’s periodisation | The reversal around 1000 | No single earthly point asserted | cw09ii ¶231 (pdf p161) |
| 1111 confession · later Cathar transmission | The Cathar–Bogomil two fishes | Carcassonne · later archival transmission | cw09ii ¶229 (pdf p159–160); cw09ii ¶229 (pdf p160) |
| ~1185–1202 · existing field dating | Joachim’s third aeon | Calabria (Joachim d. 1202; condemned Lateran IV 1215) | cw09ii ¶137 (pdf p94) |
| 12th–13th centuries · approximate midpoint | Latin alchemy emerges | No single earthly point asserted | cw09ii ¶143 (pdf p99) |
| 1215 CE · Fourth Lateran Council | Joachim condemned at Lateran | Rome · Fourth Lateran Council | cw09ii ¶137 (pdf p94) |
| 1254 CE · publication | The everlasting gospel in Paris | Paris · publication named by Jung | cw09ii ¶137 (pdf p94) |
| ~1414 CE · existing field dating | Pierre d’Ailly’s calculation | France (Cardinal Pierre d'Ailly, 1356-1420) | cw09ii ¶153 (pdf p108) |
| Renaissance · approximate display marker | The Renaissance turns outward | No single earthly point asserted | cw09ii ¶149 (pdf p106) |
| 16th century · approximate midpoint | The Reformation threshold | No single earthly point asserted | cw09ii ¶149 (pdf p105) |
| 27 June 1558 · letter to Henry II | Nostradamus writes to Henry II | France (letter of June 27, 1558, to Henry II) | cw09ii ¶151 (pdf p107) |
| Second half of the 16th century · existing field dating | Dorn’s living stone | Germany (2nd half 16th c.) | cw09ii ¶264 (pdf p182) |
| Late 16th century · approximate marker | Lambspringk’s reversed fishes | Frankfurt · later 1678 print | cw09ii pdf p162 |
| 16th–17th centuries · approximate midpoint | Alchemy gives birth to science | No single earthly point asserted | cw09ii ¶267 (pdf p185) |
| 18th century · approximate midpoint | Faith and knowledge separate | No single earthly point asserted | cw09ii ¶268 (pdf p185) |
| 22 September 1792 · as cited by Jung | The revolutionary calendar | France · revolutionary calendar | cw09ii ¶156 (pdf p110) |
| After the Second World War · 1945 display marker | The aftermath of the Second World War | No single earthly point asserted | cw09ii ¶68 (pdf p48); cw09ii ¶126 (pdf p82–83) |
| 1997 CE · conditional calculation in Jung’s footnote | Aquarius from the earlier reference star | No single earthly point asserted | cw09ii ¶149, n.84 (pdf p106) |
| 2154 CE · conditional calculation in Jung’s footnote | Aquarius from the later reference star | No single earthly point asserted | cw09ii ¶149, n.84 (pdf p106) |

Located field links use existing field IDs and their standing approximate geographical placement. Later locations are labelled: Naples is the Farnese copy’s museum location; Carcassonne is the transmitted text’s archive, not Basilius’s 1111 confession venue; Frankfurt belongs to a later 1678 print, not a proven original location for Lambspringk’s image. Region-level coordinates identify a tradition’s location, not the precise site of an event. The atlas adds rounded conventional city positions for Alexandria, Monte Cassino, Rome and Paris where Jung himself names the city, monastery or council; these coordinates are geographical display aids.

The data intentionally follows Jung’s 1558 letter to Henry II rather than the interrupted prompt’s suggested 1555 date. It does not claim that the letter’s origin is a fixed point at Salon-de-Provence: the field’s standing regional France placement is used. Likewise, collective developments such as the Renaissance, Reformation and rise of science receive approximate period markers without inventing a single originating city.

## Threads and unproven connections

The Christ/Antichrist thread follows the excluded counterpart, reversal and demand for a relation between opposites. The fish thread compares historical forms; the line does not establish direct transmission. The alchemical countercurrent follows Jung’s reading of nature, inner work and unity. The living-spirit thread follows the Holy Ghost motif and its ambivalent mediation. All four lists are ordered by the actual event years.

Jung explicitly says no connection between Christ and the astrological inception can be proved (Aion ¶148). The summary retains that distinction. He also states that he found no text proving assimilation of the Cathar fish into alchemy (PDF p162). The Cathar/Lambspringk juxtaposition is comparison, not a documented genealogy. His interpretation of the Bogomil fishes as Satanael and Christ is presented as a conjecture.

Not included as fabricated events: a precise Taurus boundary attributed to Jung; a fixed first birth year for Christ; a literal fulfilled Aquarian prophecy; a proven Cathar-to-Lambspringk transmission; an accomplished 1260 replacement of the gospel; precise cities or founding dates for collective scientific and religious transformations. No owner-authored Antichrist material is inserted into Jung’s reading.

## Further authored readings

A later reading belongs in its own file under `curation/aion/`, with its own sources, source bindings and `readings` array. It names `extends: "jung-aion"` and carries its own author, epochs, events and threads on the same year axis. The generator discovers these files and validates the extension relation while preserving Jung’s curation. IDs are scoped to each reading, so an extension must resolve its own epochs and thread events rather than modifying Jung’s objects.

An extension is an additional authored interpretation. Its presence or source claims must not be silently presented as Jung’s. The owner’s Antichrist material can be added later through this contract after source and attribution are recovered.
