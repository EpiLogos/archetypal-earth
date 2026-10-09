# Image register — 9 October 2026

Read-only audit of every image-bearing entity against SPEC §6 and the Commons-only licence law. Produced in a
cloud session whose egress policy denies Wikimedia Commons and NASA hosts (HTTP 403 on CONNECT); **no image was
fetched, nothing was invented**. Everything below is measured from `public/data/*.json`, `public/img/**` and
`curation/**`, or marked *to verify*. The data-side items need the owner's networked/vault pipeline
(`npm run images`).

## Coverage
| Class | Total | Own image | Fallback only | None |
|---|---|---|---|---|
| Archetypes | 13 | 13 | 0 | 0 |
| Families | 338 | 332 | 0 | 6 (3 deliberate skips; pleroma, satori, swastika unfound) |
| Occurrences | 2,745 | 97 | 2,633 via family | 15 |
| Cultures | 64 | none (no field) | 64 | 0 |
| Sky bodies | 11 | 0 | drawn orb | 11 |
| Aion epochs / events | 14 / 86 | — | 12 / 69 | 2 (Taurus, Aquarius) / 17 |
| Red Book stops | 37 | 0 | 37 via family (28 distinct images) | 0 |

No dead references: all 442 shipped files exist. `ImageRef.width/height` record the Commons *source* size, not
the shipped file (416/442 differ; aspect ratios match). Shipped long edge ≈ 800 px — soft on large screens.
`public/img/jung-portrait.jpg` (landing) has no recorded provenance in `images.json`.

## Reader-visible credit defects (display-fix shipped; data-fix pending)
The plate's credit overlay prints `credit · licence`. Found: Met Museum donor boilerplate (8), doubled
"Unknown author Unknown author" (29), raw URLs as credit (28: Wellcome ×23, Cleveland, British Museum, LACMA),
bare "Wikimedia Commons" as credit (3: greening-tree, yin-yang, cave-hal-saflieni), 87 `title` fields carrying
Wikidata `QS:` dumps. A display-time sanitiser (`src/ui/credit.ts`) cleans these without touching data; the
root cause is `scripts/images.mjs` lines ~287–288 (ObjectName / artist taken verbatim) and needs a re-fetch.
Licence checks owed on the file page: `f:izdubar` (CC0 claimed for a 1932 Larousse plate), `o:fish-abercius-
inscription-phrygia-200` (bare "Attribution"), `o:world-wheel-sidpe-korlo-tibetan-banner` (assumed author), seven
"Public domain (no known restrictions)" entries (churinga, desert, labyrinth, materialization, shepherd, two
occurrences).

## Misleading or weak heroes — replace when networked (not withheld here: SPEC §6 wants an image, the owner chooses)
**Clear mismatches:** `kabir` (modern photo of a person in the Umayyad Mosque — a pun; hero of two Red Book
stops), `desert` (Egyptian temple wall), `izdubar` (Larousse sheet of antiquities; hero of four Red Book stops),
`lapis` (three-headed monster in a flask), `greening-tree` (a grey foliate mask), `helios` (a menorah token),
`magic-mirror` (a codex text page), `radioactive-nucleus` (a Bohr diagram), `herb-of-life` (a leather binding),
`placenta` (the Capitoline wolf, duplicate of `wolf`), `circumambulatio` (calligraphy text), `death` (Holbein's
*Creation*), `serpent` (an alchemical dragon in a pot — the most-used fallback, 131 occurrences).
**Weak:** melusina, vajra, pentagram, quincunx, tortoise, soma, harpy, frog, gazelle, caduceus, philosophers-egg,
polestar, the-red-one, redeemer-figure, dioscuri/double (look swapped), incubus/black-man (both Fuseli),
uebermensch/zarathustra-figure (both Nietzsche photographs), and about twenty more small or text-heavy scans.
**Occurrences:** puri-temple-chariot (crowd photo), gilgamesh-robbed-herb (tablet on blue cloth), ripley-scrowle
composite, farnese-atlas (Pisces not visible), two Abercius base photos, two inscription-stone texts.

## Sky bodies — the eleven images (all *to verify* on the Commons file page; expected public domain, NASA)
Sun SDO/AIA · Moon LRO/Apollo · Earth Apollo 17 *Blue Marble* · Mercury MESSENGER colour mosaic · Venus Mariner 10 /
Magellan · Mars Viking Valles Marineris / Hubble · Jupiter Cassini · Saturn Cassini (equinox) · Uranus Voyager 2 ·
Neptune Voyager 2 · Pluto New Horizons true colour. Targets `public/img/sky/<key>.jpg` (1024 px) + thumb (500 px);
fill `SkyBody.image` (type and card slot already shipped) in `curation/sky/bodies.json` and `public/data/sky.json`.
ESA's OSIRIS Mars is CC BY-SA IGO (credit required) — an alternative only. Until then the card shows its drawn,
palette-lit orb (tonal plate); no image is claimed.

## Owed to the owner (cannot be done from this environment)
Replace the misfits above; re-fetch 87 titles and fix the three generic credits; hand-write credits for f:book,
f:grail, f:jewel; record shipped dimensions or add a check to `images-verify`; provenance for the portrait; the
eleven sky images; heroes for Aion's Taurus/Aquarius epochs and 17 events; a culture-level hero if wanted; the
unfound families (pleroma, satori, swastika). Network access needed: `commons.wikimedia.org`,
`upload.wikimedia.org`, `science.nasa.gov` (environment network settings → Allowed domains).
