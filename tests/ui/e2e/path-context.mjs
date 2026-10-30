// H4: the Path's crumbs are each a way up (`back`, as many steps as the crumb stands from here), and Context answers the
// same verbs for every subject: an archetype, a family, a theoretic, a Work, a Person, You.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/path-context.mjs
import { launch, open } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };
const b = await launch('chromium');
const settle = (page, ms = 2200) => page.waitForTimeout(ms);
const where = (page) => page.evaluate(() => { const s = window.__earth.ctl.state; return { hash: location.hash, kind: s.view.kind, subject: s.view.subject ? `${s.view.subject.type}:${s.view.subject.id}` : null, deep: s.deep }; });
const crumbs = (page) => page.evaluate(() => [...document.querySelectorAll('.focus-label .fl-up .link-quiet')].map((e) => e.textContent.replace(/^‹\s*/, '')));
const clickTie = async (page, text) => { await page.locator('.focus-label .fl-ties .link-quiet', { hasText: text }).first().click(); await settle(page); };

{
  const { ctx, page, logs } = await open(b, { width: 1440, height: 900, hash: '#/a/anima' });
  await settle(page, 3000);
  let w = await where(page);
  ok(w.subject === 'archetype:anima', `the drill starts at Anima (${w.subject})`);
  let c = await crumbs(page);
  ok(c.length === 1 && c[0] === 'the whole field', `at the top of a route the only crumb is the whole field (${JSON.stringify(c)})`);

  // Anima › a family › an archetype of that family
  const famText = await page.locator('.focus-label .fl-ties .link-quiet').first().textContent();
  await clickTie(page, famText);
  w = await where(page);
  ok(w.subject?.startsWith('family:'), `a tie opens a family (${w.subject})`);
  const fam = w.subject;
  const archText = await page.locator('.focus-label .fl-ties .link-quiet').nth(1).textContent().catch(() => null) ?? await page.locator('.focus-label .fl-ties .link-quiet').first().textContent();
  await clickTie(page, archText);
  w = await where(page);
  const third = w.subject;
  c = await crumbs(page);
  ok(c.length >= 3 && c[c.length - 1] === 'the whole field', `three levels down the path reads nearest first and ends at the whole field (${JSON.stringify(c)})`);

  // a crumb that is not the nearest is one move to that place, not one step
  const far = c.length - 2;
  const target = c[far];
  await page.locator('.focus-label .fl-up .link-quiet').nth(far).click();
  await settle(page);
  w = await where(page);
  const tName = await page.evaluate((id) => { const [t, i] = id.split(':'); const m = window.__earth.model; return t === 'archetype' ? m.archById.get(i)?.name : t === 'family' ? m.famById.get(i)?.name : i; }, w.subject);
  ok(tName === target, `the second crumb goes straight there (clicked "${target}", stands at "${tName}")`);

  // the nearest crumb is exactly what Escape does
  await clickTie(page, famText);
  const beforeEsc = await where(page);
  await page.keyboard.press('Escape');
  await settle(page);
  const afterEsc = await where(page);
  await page.goto(page.url().replace(/#.*$/, beforeEsc.hash)); await settle(page, 3500);
  ok(afterEsc.hash !== beforeEsc.hash, `Escape goes up one (${beforeEsc.hash} → ${afterEsc.hash})`);

  // with a reading open the whole field is two steps (the reading, then the route): one move, to the field
  await page.evaluate(() => { const c = window.__earth.ctl; c.navigate({ ...c.state, deep: true }); });
  await settle(page);
  const up = await page.locator('.focus-label .fl-up .link-quiet').count();
  ok(up >= 1, 'the path stands beside an open reading');
  await page.locator('.focus-label .fl-up .link-quiet').last().click();
  await settle(page, 2800);
  w = await where(page);
  ok(w.kind === 'world' && !w.deep, `the whole field crumb closes the reading and leaves for the field in one move (${w.hash})`);
  ok(logs.length === 0, `no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// Context: the same three verbs for every subject
{
  const { ctx, page, logs } = await open(b, { width: 1440, height: 900, hash: '#/' });
  await settle(page, 3000);
  const kinds = await page.evaluate(() => {
    const { ctl, model: m } = window.__earth;
    const out = {};
    const subjects = {
      archetype: { type: 'archetype', id: 'anima' }, family: { type: 'family', id: [...m.famById.keys()][0] }, theoretic: { type: 'theoretic', id: [...m.theoById.keys()][0] },
      work: { type: 'work', id: [...m.workById.keys()][0] }, person: { type: 'person', id: m.personById.has('jung') ? 'jung' : [...m.personById.keys()][0] }, you: { type: 'you', id: 'you' },
    };
    for (const [k, s] of Object.entries(subjects)) out[k] = ctl.contextVerbs(s).map((v) => `${v.id}${v.offered ? '+' : '-'}`);
    return out;
  });
  for (const [k, v] of Object.entries(kinds)) ok(v.map((x) => x.slice(0, -1)).join() === 'sky,thread,reading' && v[2].endsWith('+'), `${k} answers sky, thread, reading, and the Reading is offered (${v.join(' ')})`);

  // a Work: its label offers the verbs it answers, and its Reading is the pane
  await page.evaluate(() => { const c = window.__earth.ctl; c.openSubject({ type: 'work', id: [...window.__earth.model.workById.keys()][0] }); });
  await settle(page, 2800);
  let s = await page.evaluate(() => ({ deep: window.__earth.ctl.state.deep, pane: !!document.querySelector('section.deep.pane:not([hidden])'), links: [...document.querySelectorAll('.focus-label .fl-links .link-quiet')].map((e) => e.textContent), title: document.querySelector('.deep .dp-title')?.textContent }));
  ok(s.deep && s.pane && s.title, `a Work's reading opens in the pane (${s.title})`);
  await page.keyboard.press('Escape');
  await settle(page, 2600);
  s = await page.evaluate(() => ({ deep: window.__earth.ctl.state.deep, view: window.__earth.ctl.state.view.kind, subject: window.__earth.ctl.state.view.subject?.type, links: [...document.querySelectorAll('.focus-label .fl-links .link-quiet')].map((e) => e.textContent) }));
  ok(!s.deep && s.view === 'focus' && s.subject === 'work', `Escape closes the Work's reading and stays on the Work (${s.view} ${s.subject})`);
  ok(s.links.includes('Reading'), `its label offers the Reading (${JSON.stringify(s.links)})`);
  await page.locator('.focus-label .fl-links .link-quiet', { hasText: 'Reading' }).click();
  await settle(page, 2000);
  ok(await page.evaluate(() => window.__earth.ctl.state.deep), 'and the Reading verb opens it again');

  // a Person
  await page.evaluate(() => { const c = window.__earth.ctl; c.openSubject({ type: 'person', id: window.__earth.model.personById.has('jung') ? 'jung' : [...window.__earth.model.personById.keys()][0] }); });
  await settle(page, 2800);
  await page.keyboard.press('Escape');
  await settle(page, 2600);
  s = await page.evaluate(() => ({ view: window.__earth.ctl.state.view.kind, subject: window.__earth.ctl.state.view.subject?.type, links: [...document.querySelectorAll('.focus-label .fl-links .link-quiet')].map((e) => e.textContent) }));
  ok(s.subject === 'person' && s.links.includes('Reading'), `a Person's label answers the verbs it has (${JSON.stringify(s.links)})`);
  const sky = s.links.find((t) => /^See in sky/.test(t));
  if (sky) {
    await page.locator('.focus-label .fl-links .link-quiet', { hasText: 'See in sky' }).click();
    await settle(page, 3000);
    ok(await page.evaluate(() => !!window.__earth.ctl.state.sky || /astrology|sky/.test(location.hash)), `the Person's sky door opens the sky (${sky})`);
  } else ok(true, 'this Person has no chart or single sky place: the sky verb is answered as not offered');

  // You: the Reading verb opens the visitor's page; the same verbs stand there
  await page.evaluate(() => { const c = window.__earth.ctl; c.navigate({ view: { kind: 'world' }, deep: false }); });
  await settle(page, 3500);
  await page.evaluate(() => { const c = window.__earth.ctl; const v = c.contextVerbs({ type: 'you', id: 'you' }).find((x) => x.id === 'reading'); c.runVerb({ type: 'you', id: 'you' }, v); });
  await settle(page, 1500);
  ok(await page.evaluate(() => window.__earth.ctl.you.isOpen && !!document.querySelector('.you-sheet .dp-title')), 'You: the Reading verb opens the visitor’s page');
  await page.keyboard.press('Escape');
  await settle(page, 1500);
  ok(await page.evaluate(() => !window.__earth.ctl.you.isOpen), 'and Escape closes it');
  ok(logs.length === 0, `no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}
await b.close();
console.log(fails.length ? `${fails.length} failed` : 'all ok');
process.exit(fails.length ? 1 : 0);
