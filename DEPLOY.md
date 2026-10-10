# Deploy — An Archetypal Earth at jung.epi-logos.org

## Model
- **App on Vercel** (static Vite build; framework auto-detected as Vite, build `npm run build`, output `dist`).
- **Data is baked, not read at runtime.** The ingest scripts read the local vault; Vercel cannot. So: run `VAULT=~/Documents/Books/jung-archetypal-field npm run data` locally, commit the regenerated `public/data/*.json`, then deploy. Redeploy whenever the vault's reading runs add material.
- **Downloads on GitHub Releases** (no repo bloat, no Vercel size limits): `./scripts/package-downloads.sh` → upload `dist-downloads/*.zip` + `SHA256SUMS` to a Release tagged e.g. `field-v1`; the landing Downloads button already points at the Releases URL.
- **Big media (plates, future audio/video)**: self-host on omarchy behind a Cloudflare Tunnel if ever needed — the app references external URLs, so no redeploy required.

## Steps
1. Push this repo to GitHub (owner sets the final name/visibility).
2. Replace `OWNER` in `index.html` (3 links: Releases ×1, Issues ×2) with the real owner.
3. Vercel → Add New Project → import the repo → framework: Vite → deploy.
4. Vercel project → Settings → Domains → add `jung.epi-logos.org`.
5. DNS (wherever epi-logos.org is managed): CNAME `jung` → `cname.vercel-dns.com`.
6. Downloads: `./scripts/package-downloads.sh`, then `gh release create field-v1 dist-downloads/* --title "The field, v1" --notes "..."`.

## Notes
- `public/img/` archetype/family/occurrence images follow the repo's Commons-only law via `npm run images`.
- The landing (one line and "Start at the Self") shows once per browser (localStorage `aae.landing.seen`); clear that key to see it again.
