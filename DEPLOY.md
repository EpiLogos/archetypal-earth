# Deploy — An Archetypal Earth at jung.epi-logos.org

## Model
- **App on Vercel** (static Vite build; framework auto-detected as Vite, build `npm run build`, output `dist`).
- **Data is baked, not read at runtime.** The ingest scripts read the local vault; Vercel cannot. So: run `VAULT=~/Documents/Books/jung-archetypal-field npm run data` locally, check with `npm run typecheck && npm test && npm run build`, commit the regenerated `public/data/*.json` (field, corpus, history, redbook, theory, astrology, practice, depth, dynamics), then deploy. Redeploy whenever the vault's reading runs add material.
- **The texts are local-only (owner's ruling, 2026-10-10).** `public/data/corpus/` — the flattened copyrighted translations the ingest bakes for the citation deep links — is served only by the dev server on this machine; `npm run build` strips it from `dist` (see `localCorpusOnly` in `vite.config.ts`). A deployed build shows every quotation with its citation but no deep link into the work: the loader degrades to "no link", never to an invented passage. The vault itself (the wiki) stays local regardless.
- **Downloads on GitHub Releases** (no repo bloat, no Vercel size limits): `./scripts/package-downloads.sh` → upload `dist-downloads/*.zip` + `SHA256SUMS` to a Release tagged e.g. `field-v1`; the menu's Downloads link already points at the Releases URL.
- **Big media (plates, future audio/video)**: self-host on omarchy behind a Cloudflare Tunnel if ever needed — the app references external URLs, so no redeploy required.

## Steps
1. Push this repo to GitHub (owner sets the final name/visibility).
2. If the repository moves, change `REPO_URL` in `src/shell/shell.ts` (the GitHub icon, Downloads, Report a problem and Source all derive from it).
3. Vercel → Add New Project → import the repo → framework: Vite → deploy.
4. Vercel project → Settings → Domains → add `jung.epi-logos.org`.
5. DNS (wherever epi-logos.org is managed): CNAME `jung` → `cname.vercel-dns.com`.
6. Downloads: `./scripts/package-downloads.sh`, then `gh release create field-v1 dist-downloads/* --title "The field, v1" --notes "..."`.

## Notes
- `public/img/` archetype/family/occurrence images follow the repo's Commons-only law via `npm run images`.
- The landing (one line and "Start at the Self") shows once per browser (localStorage `aae.landing.seen`); clear that key to see it again.
- Personal data (birth charts, dreams, coincidences) never reaches the server: it lives in the visitor's localStorage. Nothing to configure, nothing to back up server-side.
- The Red Book plates are served only by the dev server from the vault; a deployed build shows a cited note instead (see `vite.config.ts`).
