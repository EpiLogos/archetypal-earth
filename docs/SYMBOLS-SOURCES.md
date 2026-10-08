# The Book of Symbols source layer

This layer adds reviewed site paraphrases from *The Book of Symbols: Reflections on Archetypal Images* (ARAS; TASCHEN, 2010), edited by Ami Ronnberg (editor-in-chief) and Kathleen Martin (editor). It remains distinct from Jung quotations, Jung's Aion reading, and the atlas's canonical archetype ties. The title page is PDF page 7; the 2010 imprint is PDF page 812. The book is a collective ARAS work, not a new book by Jung, even when an essay discusses his writings.

The user supplied this private local PDF:

`/Users/admin/Documents/The Book of Symbols. Reflections on Archetypal Images (Ami Ronnberg) (z-library.sk, 1lib.sk, z-lib.sk).pdf`

The reviewed file has 816 PDF pages and SHA-256 `097b906f6bed45bb20eea41440c2da83d59ffd1cbdc8936bce2d304282361e23`. Its PDF pages are numbered from one. The cited printed pages have a four-page offset; the two missing Fire pages described below are excluded. The private PDF, plates, and extracted page text are not served or distributed with the site.

## Reviewable curation and generation

`curation/symbols/book-of-symbols.json` is the reviewed source. Each note has the actual entry title, separate printed/PDF citations, substantive paraphrases, and editorial comparisons with existing family IDs. The private evidence for each cited content page includes its normalized text fingerprint and a short source witness. `public/data/symbols.json` is generated and omits those private evidence fields.

```sh
npm run symbols
npm run symbols:check
npx vitest run tests/data/symbols.test.ts
```

The equivalent generator command is `node scripts/symbols.mjs [--check]`. `SYMBOLS_PDF` relocates the same reviewed PDF without changing the curation's provenance. `SYMBOLS_PYTHON` can point to a Python executable with `pypdf`. The generator first tries the selected/default Python and then discovers a bundled dependency Python from an installed `pdfinfo` tool directory. It never installs dependencies.

Generation reads the actual private PDF, checks its revision and page count, verifies the title/imprint witnesses, checks each cited content page's text identity and witness, and rejects nonexistent families, broken comparisons, missing prose, wrong pagination or absent evidence. `--check` also compares the existing public file byte for byte with the reviewed curation, without writing. Source acceptance fails when the source is unavailable; tests do not substitute fixtures or skip the check.

Fingerprints establish page identity. They do not mechanically prove that a paraphrase is a fair reading: substantive editorial review remains necessary. These notes were written after reading the named source sections. Representative source pages were also rendered for inspection, including Tree (printed 128), Fish (202), Mandala (712), and the anomalous Fire scan (PDF 86, visibly printed 84). Temporary local renders and extracted text belong in the gitignored `.cache/symbols/` directory.

## Coverage and page bindings

Only content pages used for the paraphrases are cited; intervening plate pages are not implicitly redistributed or treated as additional text evidence.

| Existing family | Named book entry | Printed content pages | 1-based PDF pages |
| --- | --- | --- | --- |
| philosophers-egg | Egg | 14 | 18 |
| star | Star | 18, 20 | 22, 24 |
| sun | Sun | 22, 24 | 26, 28 |
| moon | Moon | 26, 28 | 30, 32 |
| water | Ocean / River | 36, 38, 40, 42 | 40, 42, 44, 46 |
| wind | Wind | 60 | 64 |
| fire | Fire, surviving continuation | 84 | 88 |
| stone | Stone | 104, 106 | 108, 110 |
| mountain | Mountain | 108 | 112 |
| cave | Cave | 112 | 116 |
| salt | Salt | 114 | 118 |
| tree | Tree | 128, 130 | 132, 134 |
| garden | Garden | 146, 148 | 150, 152 |
| lotus | Lotus | 158 | 162 |
| rose | Rose | 162, 164 | 166, 168 |
| serpent | Snake | 194, 196 | 198, 200 |
| fish | Fish | 202 | 206 |
| bird | Bird | 238, 240 | 242, 244 |
| dove | Dove | 244, 246 | 248, 250 |
| raven | Crow / Raven | 248, 250 | 252, 254 |
| eagle | Eagle | 256, 258 | 260, 262 |
| peacock | Peacock | 260 | 264 |
| king-queen-pair | King / Queen | 470 | 474 |
| crown | Crown | 540 | 544 |
| dragon | Dragon | 704 | 708 |
| mandala | Mandala / Labyrinth | 712, 714 | 716, 718 |
| cross | Crucifixion | 744 | 748 |
| pearl | Pearl | 784 | 788 |
| grail | Grail | 786 | 790 |

There are 29 family notes, grounded in 45 distinct content pages. The Egg entry has a wider scope than the atlas's philosophical egg; its note explicitly connects the generic form to the alchemical development. Water combines two named entries to distinguish encompassing depth from directed current. The existing atlas has no separate labyrinth family, so Mandala presents a clearly labelled editorial comparison of the book's neighboring Mandala and Labyrinth entries. Cross cites the specifically Christian Crucifixion essay, not an imagined generic Cross entry. These mappings do not create new corpus records.

## Source limitations and reading discipline

This supplied PDF contains a scan defect: PDF pages 86–87 repeat the content of printed pages 84–85, also present at PDF pages 88–89. The expected printed 82–83 opening of Fire is missing. The duplicate OCR streams differ in character recognition and ordering, so the validator checks visible source witnesses rather than falsely asserting equal OCR bytes. Fire cites the surviving printed 84 at PDF 88 and explicitly states that its missing opening was not reconstructed.

The book's preface (printed 6, PDF 10) and introduction (printed 8, PDF 12) explain its use of particular images and its resistance to fixed symbol equations. The notes preserve tensions such as nurture/danger, radiance/inflation, containment/confinement and ascent/return. Cultural settings stay visible: a Tantric Buddhist mandala is not silently equated with a Christian labyrinth; a Chinese rain dragon is not simply the monster confronted by a European saint.

The prose is an editorial paraphrase of the book's interpretive essays. It does not promote their occasional historical, biological, medical or etymological assertions into independently verified facts. Legendary transformations, alchemical operations and the language of healing are presented as symbolic readings. Related-family links are comparisons for exploration, not claims of direct historical transmission or new authoritative archetype assignments.

No direct book quotations appear in the public notes. Short curation witnesses and hashes are retained for verification; complete extracted pages and licensed plates remain private. Broader source coverage and the growing Jung corpus remain deferred as the user requested.
