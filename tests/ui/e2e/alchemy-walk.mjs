// The Alchemy lens in a real browser: the opus on its circle, the four stages walked with the rail, an operation opened,
// and a subject followed into the field. Needs public/data/alchemy.json (npm run alchemy, after the curation is in place).
// Run: npx vite --port 5183 --strictPort & then node tests/ui/e2e/alchemy-walk.mjs
import fs from 'node:fs';
import { launch, open, revealSheet } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };
const hash = (page) => page.evaluate(() => location.hash);

// the operation followed into the field is one the curation ties to both a stage and a field node (Calcinatio has a stage
// and, honestly, no node of its own; the page then offers the stage link alone)
const alchemy = JSON.parse(fs.readFileSync(new URL('../../../public/data/alchemy.json', import.meta.url), 'utf8'));
const withSubject = alchemy.operations.find((o) => o.stage && o.subjects.length);
if (!withSubject) { console.log(' FAIL  no operation in public/data/alchemy.json has both a stage and a field subject'); process.exit(1); }

const b = await launch('chromium');
const shots = '.cache/screens/alchemy';
fs.mkdirSync(shots, { recursive: true });

// 1. the overview: the four stages on their circle, and the stage list beneath
{
  const { ctx, page, logs } = await open(b, { hash: '#/alchemy' });
  await revealSheet(page, 'Alchemy');
  await page.waitForSelector('.ql-wheel .ql-stop', { timeout: 15000 }).catch(() => {});
  const stops = await page.$$eval('.ql-wheel .ql-stop', (els) => els.map((e) => e.getAttribute('aria-label')));
  ok(stops.length === 4, `the opus shows four stage stops on its circle (got ${stops.length})`);
  ok(stops.length === 4 && /nigredo/i.test(stops[0]) && /rubedo/i.test(stops[3]), `the stops run nigredo to rubedo (got ${JSON.stringify(stops)})`);
  const tabs = await page.$$eval('.th-nav .th-tab', (els) => els.map((e) => e.textContent.trim()));
  ok(JSON.stringify(tabs) === JSON.stringify(['Opus', 'Operations', 'Matter', 'Elements']), `the four sections are the tabs (got ${JSON.stringify(tabs)})`);
  await page.screenshot({ path: `${shots}/01-opus-overview.png` });
  ok(logs.length === 0, `no console errors on the overview (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 2. the walk: the first stage by its stop, then the rail to the last, each stage named in the panel
{
  const { ctx, page, logs } = await open(b, { hash: '#/alchemy' });
  await revealSheet(page, 'Alchemy');
  await page.waitForSelector('.ql-wheel .ql-stop', { timeout: 15000 });
  await page.click('.ql-wheel .ql-stop >> nth=0');
  await page.waitForTimeout(400);
  ok((await hash(page)) === '#/alchemy/opus/nigredo', `the first stop opens the nigredo stage (got ${await hash(page)})`);
  ok((await page.textContent('.rb-progress')) === '1 / 4', 'the rail reads "1 / 4" at the first stage');
  const names = [];
  for (let i = 0; i < 4; i++) {
    names.push((await page.textContent('.ql-head .ql-big'))?.trim());
    await page.screenshot({ path: `${shots}/02-stage-${i + 1}.png` });
    if (i < 3) { await page.click('.rb-rail button[aria-label="Next"]'); await page.waitForTimeout(300); }
  }
  ok(JSON.stringify(names) === JSON.stringify(['Nigredo', 'Albedo', 'Citrinitas', 'Rubedo']), `the rail walks the four stages in order (got ${JSON.stringify(names)})`);
  ok((await page.textContent('.rb-progress')) === '4 / 4', 'the rail reads "4 / 4" at the last stage');
  ok(/^#\/alchemy\/opus\/rubedo$/.test(await hash(page)), `the hash follows the walk (got ${await hash(page)})`);
  ok(logs.length === 0, `no console errors on the walk (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 3. an operation opened from the Operations section, and its stage link
{
  const { ctx, page, logs } = await open(b, { hash: '#/alchemy/operations' });
  await revealSheet(page, 'Alchemy');
  await page.waitForSelector('.th-link', { timeout: 15000 });
  await page.click('.th-link >> nth=0');
  await page.waitForTimeout(300);
  const h = await hash(page);
  ok(/^#\/alchemy\/operations\/[a-z-]+$/.test(h), `an operation opens on its own route (got ${h})`);
  ok((await page.$('.ql-head .ql-big')) !== null, 'the operation page names the operation');
  await page.screenshot({ path: `${shots}/03-operation.png` });
  ok(logs.length === 0, `no console errors on the operation (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 4. a subject followed from the panel into the field: the hash leaves the lens for the node
{
  const { ctx, page, logs } = await open(b, { hash: `#/alchemy/operations/${withSubject.id}` });
  await revealSheet(page, 'Alchemy');
  await page.waitForSelector('.th-link', { timeout: 15000 });
  // the subject links are the buttons after the stage link; the last one is a subject of the operation
  const subjects = await page.$$('.th-link');
  ok(subjects.length >= 2, `${withSubject.name} links to its stage and a subject (got ${subjects.length} links)`);
  await subjects[subjects.length - 1].click();
  await page.waitForTimeout(1200);
  const h = await hash(page);
  ok(/^#\/(f|a|th)\//.test(h), `a subject opens its node in the field (got ${h})`);
  await page.screenshot({ path: `${shots}/04-subject-node.png` });
  ok(logs.length === 0, `no console errors following the subject (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nalchemy walk: all green');
process.exit(fails.length ? 1 : 0);
