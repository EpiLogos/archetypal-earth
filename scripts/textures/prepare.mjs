// Prepares the globe's base imagery from NASA public-domain data.
//
//   npm run textures
//
// Source: NASA Earth Observatory / Visible Earth, "The Blue Marble: Next
// Generation w/ Topography and Bathymetry" (July 2004 composite, 21600x10800).
// Visible Earth image 73751, credit NASA Earth Observatory (Reto Stöckli,
// Robert Simmon). NASA imagery is not copyrighted (NASA media usage
// guidelines). The July month is snow-free across the northern continents and
// matches the BlueMarble_ShadedRelief_Bathymetry tiles served by NASA GIBS,
// which the tile layer streams for close zoom — so base and tiles agree.
//
// Output (public/textures/):
//   earth-2k.jpg   first-paint texture, loaded at boot
//   earth-4k.jpg   fallback for GPUs/devices without 8k textures
//   earth-8k.jpg   the hi-res base, swapped in once loaded
// The 21600x10800 download is cached in .cache/tex-src/ (not committed).
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_URL = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x21600x10800.jpg';
const SRC = join(root, '.cache', 'tex-src', 'world.topo.bathy.200407.jpg');
const OUT = join(root, 'public', 'textures');

const targets = [
  { name: 'earth-2k.jpg', w: 2048, quality: 88 },
  { name: 'earth-4k.jpg', w: 4096, quality: 90 },
  { name: 'earth-8k.jpg', w: 8192, quality: 90 },
];

async function download() {
  if (existsSync(SRC) && statSync(SRC).size > 20e6) return;
  mkdirSync(dirname(SRC), { recursive: true });
  console.log(`downloading ${SRC_URL}`);
  const res = await fetch(SRC_URL);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const tmp = `${SRC}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, SRC);
}

await download();
mkdirSync(OUT, { recursive: true });
for (const t of targets) {
  const out = join(OUT, t.name);
  await sharp(SRC, { limitInputPixels: false })
    .resize(t.w, t.w / 2, { kernel: 'lanczos3' })
    .jpeg({ quality: t.quality, progressive: true, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toFile(out);
  console.log(`${t.name}  ${(statSync(out).size / 1e6).toFixed(2)} MB`);
}
