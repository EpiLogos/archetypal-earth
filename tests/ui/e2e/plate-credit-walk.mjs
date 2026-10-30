// S12: every picture carries its credit. In each state below, every `figure.plate img` has a figcaption with its credit text (a
// full plate shows it, with a link to the source where the register holds one; a thumb or a float keeps it for the tooltip and
// the reader), and no plate carries a word standing in for a picture that is not there.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/plate-credit-walk.mjs
import { launch, open } from './lib.mjs';

const results = [];
const check = (ok, what, detail = '') => { results.push(ok); console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` — ${detail}` : ''}`); };
const b = await launch('chromium');
const ready = async (page) => { await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 }); await page.waitForTimeout(2500); };

const audit = (page) => page.evaluate(() => {
  const figs = [...document.querySelectorAll('figure.plate')].filter((f) => f.querySelector('img'));
  const bare = figs.filter((f) => !(f.querySelector('figcaption')?.textContent ?? '').trim()).map((f) => f.className + ' ' + (f.querySelector('img')?.src ?? '').split('/').pop());
  const links = [...document.querySelectorAll('figure.plate .plate-source')].map((a) => a.getAttribute('href'));
  const residue = document.body.innerText.match(/No plate yet|Plate could not load/);
  return { n: figs.length, bare, links, thumbs: figs.filter((f) => /thumb|chip|strip|float|par-plate|rel-img/.test(f.className)).length, none: document.querySelectorAll('[data-none]').length, residue: !!residue };
});

const STATES = [
  ['the Self, floats around the globe', '#/a/self', null],
  ['a family in the field', '#/f/serpent', null],
  ['a family page (deep)', '#/f/phallus/deep', null],
  ['an archetype page (deep)', '#/a/great-mother/deep', null],
  ['the alchemy lens', '#/alchemy', null],
  ['the Red Book', '#/redbook/genesis', null],
  ['Jung’s page', '#/p/jung', null],
  ['a text', '#/texts/cw12/3', null],
];

for (const size of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const tag = size.name;
  const { ctx, page, logs } = await open(b, { ...size, hash: '#/' });
  let total = 0, thumbs = 0;
  for (const [what, hash] of STATES.map(([w, h]) => [w, h])) {
    await page.goto(page.url().replace(/#.*$/, '') + hash, { waitUntil: 'load' });
    await ready(page);
    const r = await audit(page);
    total += r.n; thumbs += r.thumbs;
    check(r.bare.length === 0 && r.none === 0 && !r.residue, `${tag}: ${what} — every plate has its credit`, `${r.n} plates, ${r.bare.length} bare ${r.bare.slice(0, 2).join(' | ')}`);
  }
  // search chips are thumbs too
  await page.keyboard.press('/');
  await page.fill('.s-input', 'serpent');
  await page.waitForTimeout(900);
  const r = await audit(page);
  total += r.n;
  check(r.bare.length === 0, `${tag}: search chips carry their credit`, `${r.n} plates, ${r.bare.slice(0, 2).join(' | ')}`);
  await page.keyboard.press('Escape');
  check(total > 10 && thumbs > 0, `${tag}: the audit saw pictures, thumbs among them`, `${total} plates, ${thumbs} thumbs`);

  // a full plate links to its source where the register holds one, in a new tab, with no opener
  await page.goto(page.url().replace(/#.*$/, '') + '#/f/phallus/deep', { waitUntil: 'load' });
  await ready(page);
  const link = await page.$eval('.deep.on figure.plate .plate-source', (a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, shown: a.getClientRects().length > 0 })).catch(() => null);
  check(!!link && /^https?:/.test(link.href) && link.target === '_blank' && /noopener/.test(link.rel) && link.shown, `${tag}: a full plate links to its source`, JSON.stringify(link));
  check(!logs.length, `${tag}: no console errors`, logs.slice(0, 3).join(' | '));
  await ctx.close();
}
await b.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} failure(s)` : '\nall checks passed');
process.exit(failed ? 1 : 0);
