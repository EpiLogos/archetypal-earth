# An Archetypal Earth

A globe for moving through Jung's archetypes as they recur across place and time. The spec is in [docs/SPEC.md](docs/SPEC.md).

## Run

```bash
npm install
npm run dev        # http://localhost:5181
```

## Data

The site reads the Jung archetypal-field vault at `~/Documents/books/jung-archetypal-field` and never writes to it. Set `VAULT=/path` to read a different one.

- `npm run ingest` rebuilds `public/data/field.json` from the vault. Run it after the vault's reading runs add material.
- `npm run images` fetches any images still missing from Wikimedia Commons into `public/img/`. Re-runs skip images already on disk.
- `npm run data` runs ingest, then images, then ingest again.

Choices made by the site rather than taken from the vault live in `curation/`:

- `gazetteer.json` and `cultures.json` turn the vault's free-text place descriptions into coordinates.
- `archetypes.json` sets the instinct–spirit spectrum and atmosphere colours.
- `family-ties.json` links symbols to archetypes, marked `jung`, `inferred` or `site`.
- `image-queries.json` holds the Commons search queries and pinned image choices.

The shared data contract is [src/types/field.ts](src/types/field.ts).

## Checks

```bash
npm run typecheck && npm test && npm run build
```
