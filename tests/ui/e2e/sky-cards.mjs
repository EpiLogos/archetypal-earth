// Gate (Phase 2): bodies that mean. Picking a body opens its card; every tie is basis-tagged and cited or honestly the
// atlas's; field links descend to the Earth; culture reprojection is labelled; Sun and Moon carry the pair reading with
// passages that expand in place; a family's reveal shows the quiet glyph; inactive panels are out of the keyboard path.
//   npx vite --port 5183 --strictPort &
//   node tests/ui/e2e/sky-cards.mjs [chromium|webkit]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__earth.ctl.state)));
const settle = async (page) => { for (let i = 0; i < 240; i++) { await page.waitForTimeout(150); if (!(await page.evaluate(() => window.__earth.engine.rig.flying))) break; } await page.waitForTimeout(500); };

const browser = await launch(kind, { headed: false });
try {
  // ── Earth mode: the sky's panels are out of the keyboard path and the accessibility tree ──
  {
    const { page } = await open(browser, { width: 1280, height: 800 });
    const inert = await page.evaluate(() => ({
      card: document.querySelector('.sky-card')?.inert, cardHidden: document.querySelector('.sky-card')?.getAttribute('aria-hidden'),
      layer: document.querySelector('.sky-layer')?.inert, culture: document.querySelector('.sky-culture')?.inert,
    }));
    check(inert.card === true && inert.cardHidden === 'true' && inert.layer === true && inert.culture === true, 'in Earth mode the sky card, labels and culture selector are inert and hidden from the tree', JSON.stringify(inert));
    await page.context().close();
  }

  // ── pick a body, read the card ──
  const { page, logs } = await open(browser, { width: 1280, height: 800 });
  await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); window.__earth.ctl.toggleSky(); });
  await settle(page);
  const marsPt = await page.evaluate(() => { const b = window.__earth.engine.sky.screenBodies().find((x) => x.key === 'mars'); return [b.x, b.y]; });
  await page.mouse.click(marsPt[0], marsPt[1]);
  await page.waitForTimeout(1500);
  let s = await state(page);
  check(s.sky?.body === 'mars', 'clicking Mars in the scene selects it', JSON.stringify(s.sky));
  const card = await page.evaluate(() => {
    const c = document.querySelector('.sky-card');
    return { on: c.classList.contains('on'), inert: c.inert, name: c.querySelector('.rv-name')?.textContent, position: c.querySelector('.sky-position')?.textContent,
      ties: [...c.querySelectorAll('.sky-tie')].map((t) => ({ name: t.querySelector('.link-quiet')?.textContent, basis: t.querySelector('.sky-basis')?.textContent, hasPassage: !!t.querySelector('details blockquote') })) };
  });
  check(card.on && !card.inert && card.name === 'Mars', 'the card opens under the default name', `"${card.name}"`);
  check(/^(Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces) \d+°\d\d′ — tropical, ecliptic of date · as of \d{4}-\d\d-\d\d \d\d:\d\d UTC$/.test(card.position ?? ''), 'its position is a sign and degree, labelled tropical, with its moment', card.position);
  check(card.ties.length > 0 && card.ties.every((t) => ['Jung', 'inferred', 'read here'].includes(t.basis)), 'every displayed tie carries its basis', JSON.stringify(card.ties.map((t) => `${t.name}:${t.basis}`)));
  check(card.ties.filter((t) => t.basis === 'Jung').every((t) => t.hasPassage), 'every tie that claims Jung shows his passage');
  check(card.ties.filter((t) => t.basis === 'read here').every((t) => !t.hasPassage), 'no tie of the atlas\'s own is dressed with a quotation');

  // the tooltip explains the basis
  const title = await page.evaluate(() => document.querySelector('.sky-card .sky-basis')?.title);
  check(!!title && title.length > 20, 'the basis chip explains itself', title);

  // ── the dossier: a key passage leads, open; the hero is there; the order is the card's ──
  const lead = await page.evaluate(() => {
    const c = document.querySelector('.sky-card');
    const text = c.querySelector('.rv-text');
    const first = [...c.querySelectorAll('blockquote')][0];
    const r = first?.getBoundingClientRect();
    const hero = c.querySelector('.rv-body > .rv-hero');
    const known = ['rv-name', 'rv-line', 'sky-reproject', 'sky-key', 'rv-para', 'sky-burt', 'sky-ties', 'sky-earth', 'sky-position', 'sky-syzygy', 'sky-reading', 'sky-body-sources'];
    const order = [...text.children].map((n) => known.find((k) => n.classList.contains(k)) ?? n.tagName.toLowerCase());
    return {
      firstIsKey: !!first && first.matches('blockquote.dp-def') && first.parentElement === text,
      visible: !!r && r.height > 0 && !first.closest('details:not([open])'),
      quote: first?.querySelector('p')?.textContent ?? '', footer: first?.querySelector('footer')?.textContent?.trim() ?? '',
      hero: !!hero && hero.getBoundingClientRect().height > 0, heroKind: hero?.classList.contains('sky-portrait') ? 'orb' : 'image',
      order, text: c.textContent,
    };
  });
  check(lead.firstIsKey && lead.visible, 'the card leads with an open key passage, visible without interaction', lead.quote.slice(0, 60));
  check(/^Kathleen Burt · Archetypes of the Zodiac · p\. \d+$/.test(lead.footer), 'the key passage is footed in Burt’s own name and page', lead.footer);
  check(lead.hero, 'the card has its hero', lead.heroKind);
  const at = (k) => lead.order.indexOf(k);
  check(at('rv-name') < at('rv-line') && at('rv-line') < at('sky-key') && at('sky-key') < at('rv-para') && at('rv-para') < at('sky-ties') && at('sky-ties') < at('sky-position') && at('sky-position') < at('sky-body-sources') && lead.order.at(-1) === 'sky-body-sources',
    'the dossier runs name, kind, key passage, one line, field, position, sources last', lead.order.join(' › '));
  check(!/generated|vault|sidecar|npm run|\(S\)/i.test(lead.text), 'no jargon on the Mars card (no "generated", "vault", "sidecar", "npm run", "(S)")');

  // ── culture reprojection is visible and truthful ──
  await page.selectOption('.sky-culture select', 'indian');
  await page.waitForTimeout(1200);
  const re = await page.evaluate(() => ({
    name: document.querySelector('.sky-card .rv-name')?.textContent, note: document.querySelector('.sky-reproject')?.textContent,
    chip: document.querySelector('.sky-reproject .sky-basis')?.title ?? '',
    label: [...document.querySelectorAll('.sky-label.on')].map((l) => l.textContent), hash: location.hash, sel: document.querySelector('.sky-culture-note')?.textContent,
  }));
  check(re.name === 'Mangala' && /^Read through Indian: Mangala \S+\. The character below is the default one \(Mars\)\.$/.test(re.note ?? ''), 'reprojected card reads through the culture and says the character is the default, with no source clause in the text', re.note);
  check(/Source: .+/.test(re.chip) && !/\bafter\b/.test(re.note ?? '') && !/\bcw\d/i.test(re.note ?? ''), 'the table the reading comes from is the basis chip\'s tooltip, not the text', re.chip.slice(0, 120));
  check(re.label.includes('Mangala'), 'the scene\'s labels follow the culture', re.label.join(', '));
  check(re.hash.endsWith('/c/indian'), 'the culture is part of the link', re.hash);
  check(/Names read through Indian/.test(re.sel ?? ''), 'the selector names what it is doing');
  await page.selectOption('.sky-culture select', '');
  await page.waitForTimeout(600);
  check((await state(page)).sky.culture === undefined, 'returning to the default drops the culture');

  // Chinese has no cell for the luminaries: absence is said, not filled
  await page.selectOption('.sky-culture select', 'chinese');
  await page.evaluate(() => window.__earth.ctl.openBody('sun'));
  await page.waitForTimeout(1300);
  const cn = await page.evaluate(() => ({ name: document.querySelector('.sky-card .rv-name')?.textContent, note: document.querySelector('.sky-reproject')?.textContent }));
  check(cn.name === 'Sol' && /gives Sol no name of its own/.test(cn.note ?? ''), 'a culture with no cell for the Sun says so and keeps the default name', cn.note);
  await page.selectOption('.sky-culture select', '');
  await page.waitForTimeout(500);

  // ── Sun: the syzygy / coniunctio reading, passages expand in place ──
  const reading = await page.evaluate(() => {
    const r = document.querySelector('.sky-reading');
    const d = r?.querySelector('details');
    const events = [...document.querySelectorAll('.sky-syzygy .sky-event')].map((e) => ({ fact: e.querySelector('.sky-fact')?.textContent, links: [...e.querySelectorAll('.aion-links button')].map((b) => b.textContent) }));
    return { has: !!r, h: r?.querySelector('.sky-h')?.textContent, links: [...(r?.querySelectorAll('.aion-links button') ?? [])].map((b) => b.textContent), events, open0: d?.open, bq0: d?.querySelectorAll('blockquote').length };
  });
  check(reading.has && /coniunctio/i.test(reading.h ?? '') && reading.h.includes('Jung'), 'the Sun carries the pair reading with its basis', JSON.stringify(reading.h));
  check(reading.events.length === 2 && reading.events.every((e) => e.links.length === 3), 'each of the next conjunction and opposition links the three field entries Jung\u2019s reading names', JSON.stringify(reading.events));
  // the Sun leads with Jung's pair reading, not with Burt; her definitions wait in her own disclosure
  const sunLead = await page.evaluate(() => { const f = document.querySelector('.sky-card blockquote.sky-key'); return { cls: f?.className ?? '', footer: f?.querySelector('footer')?.textContent?.trim() ?? '' }; });
  check(/sky-key-jung/.test(sunLead.cls) && /^Jung · /.test(sunLead.footer), 'the Sun leads with Jung’s pair reading, footed in the field’s voice', sunLead.footer);
  const sunMore = await page.evaluate(() => [...document.querySelectorAll('.sky-card details.aion-sources > summary')].map((x) => x.textContent.trim()).filter((t) => /^More/.test(t)));
  check(sunMore.length > 1 && sunMore.every((t) => /^More on \S/.test(t)), 'the Sun has several passage disclosures, and each is named for what it adds to', sunMore.join(' | '));
  await page.click('.sky-reading summary');
  const after = await page.evaluate(() => ({ open: document.querySelector('.sky-reading details').open, quote: document.querySelector('.sky-reading blockquote p')?.textContent, cite: document.querySelector('.sky-reading blockquote cite')?.textContent }));
  // the pair reading's first cite leads the card above, so the disclosure holds the reading's other cite, not a repeat of it
  check(after.open && /union of conscious/.test(after.quote ?? '') && /Aion/.test(after.cite ?? '') && /¶426/.test(after.cite ?? '') && !/coniunctio oppositorum/.test(after.quote ?? ''),
    'passages expand in place, quoted and cited; the cite the card leads with is not repeated beneath it', `${after.quote?.slice(0, 60)}… ${after.cite}`);
  await page.evaluate(() => window.__earth.ctl.openBody('moon'));
  await page.waitForTimeout(1300);
  check(await page.evaluate(() => !!document.querySelector('.sky-card .sky-reading')), 'the Moon carries it too');

  // ── a body with site ties only: the Earth's own card, whose two ties are the atlas's, never Jung's ──
  await page.evaluate(() => window.__earth.ctl.openBody('earth'));
  await page.waitForTimeout(1300);
  const earth = await page.evaluate(() => {
    const c = document.querySelector('.sky-card');
    return { on: c.classList.contains('on'), name: c.querySelector('.rv-name')?.textContent, ties: [...c.querySelectorAll('.sky-tie')].map((t) => ({
      basis: t.querySelector('.sky-basis')?.textContent, hasPassage: !!t.querySelector('details blockquote'), note: t.querySelector('.sky-tie-note')?.textContent ?? null })) };
  });
  check(earth.on && earth.name === 'Terra' && earth.ties.length === 2, 'the Earth opens its card through its two site ties', JSON.stringify(earth));
  check(earth.ties.every((t) => t.basis === 'read here' && !t.hasPassage), 'each atlas tie is chipped "read here" and quotes nothing', JSON.stringify(earth.ties.map((t) => t.basis)));
  check(earth.ties.every((t) => t.note && !/vault|by inference/i.test(t.note)), 'the atlas\'s own ties say in plain words what they are', earth.ties.map((t) => t.note).join(' | '));

  // ── descend to the Earth through a field link ──
  await page.evaluate(() => window.__earth.ctl.openBody('mercury'));
  await page.waitForTimeout(1300);
  await page.click('.sky-card .sky-tie .link-quiet');
  await page.waitForTimeout(1200);
  s = await state(page);
  check(s.view.kind === 'focus' && s.view.subject.type === 'family' && s.sky === undefined, 'a family link descends to the field and leaves the sky', JSON.stringify(s.view));
  const { sky: _x, ...rest } = s;
  await page.goBack();
  await page.waitForTimeout(800);
  s = await state(page);
  check(!!s.sky || s.view.kind === 'world', 'Back from the field returns to where it came from', JSON.stringify(s));

  // ── the glyph on a family's reveal ──
  await page.evaluate(() => {
    const { ctl } = window.__earth;
    const m = ctl.m;
    const fam = m.field.families.find((f) => f.id === 'mercurius');
    const occ = fam.occurrenceIds.map((id) => m.occIndex.get(id)).find((i) => m.located[i]);
    ctl.navigate({ view: { kind: 'world' }, deep: false });
    window.__occ = m.occ[occ].id;
    ctl.openOccurrenceId(m.occ[occ].id);
  });
  await page.waitForTimeout(1800);
  const g = await page.evaluate(() => { const r = document.querySelector('.reveal:not(.sky-card) .rv-sky'); return r && !r.hidden ? { text: r.textContent, glyph: r.querySelector('.rv-sky-glyph')?.textContent } : null; });
  check(!!g && /Mercury|Mercurius/.test(g.text) && /☿/.test(g.glyph), 'a Mercurius occurrence shows the quiet glyph for its body', JSON.stringify(g));
  await page.click('.reveal:not(.sky-card) .rv-sky-body');
  await settle(page);
  s = await state(page);
  check(s.sky?.body === 'mercury', 'the glyph opens the body in the sky', JSON.stringify(s.sky));

  // ── keyboard: visible labels are real buttons in the tab order ──
  const tab = await page.evaluate(() => [...document.querySelectorAll('.sky-label.on')].map((l) => l.tabIndex));
  check(tab.length > 3 && tab.every((t) => t === 0), 'visible body labels are reachable by keyboard', `${tab.length} labels`);

  // ── a tie whose note only restates its basis chip is not drawn; the others are, in plain words ──
  await page.evaluate(() => window.__earth.ctl.openBody('saturn'));
  await page.waitForTimeout(1300);
  const sat = await page.evaluate(() => {
    const ties = [...document.querySelectorAll('.sky-card .sky-tie')];
    return { n: ties.length, notes: ties.map((t) => t.querySelector('.sky-tie-note')?.textContent ?? null) };
  });
  const drawn = sat.notes.filter((n) => n !== null);
  check(drawn.length > 0 && drawn.length < sat.n, 'Saturn’s restating tie shows no note; the others show theirs', `${drawn.length} of ${sat.n} notes drawn`);
  check(!drawn.some((n) => /vault|generated|sidecar|npm run|\(S\)/i.test(n)), 'no drawn tie note speaks of the vault, the tables or the scripts');

  // ── the cards as a reader sees them: Mercury, Saturn, Sun ──
  const shots = fileURLToPath(new URL('../../../.cache/screens/remediation-2026-10-09/sky/', import.meta.url));
  mkdirSync(shots, { recursive: true });
  for (const k of ['mercury', 'saturn', 'sun']) {
    await page.evaluate((x) => window.__earth.ctl.openBody(x), k);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${shots}/card-${k}.png` });
    const word = await page.evaluate(() => document.querySelector('.sky-card .rv-name')?.textContent);
    console.log(`  screenshot card-${k}.png (${word})`);
  }
  check(!logs.some((l) => /error/i.test(l)), 'no console errors', logs.join(' | ').slice(0, 300));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
