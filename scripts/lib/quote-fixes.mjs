// curation/quote-fixes.json: the reviewed layer that corrects a quotation or the page it cites, applied by scripts/ingest.mjs after
// the field is assembled (the vault is never edited; this layer is the correction, as curation/year-overrides.json is for years).
//
//   { "version": 1, "fixes": { "<record id>": { "text"?, "primary"?, "work"?, "locator"?, "cite"?, "basis" } } }
//
// Record id: an occurrence's id, or "family:<id>" / "archetype:<id>" / "theoretic:<id>" for a definition.
//   text      the corrected words, verbatim from the corpus page (the quote, or the definition's text)
//   primary   (occurrence) the index in jung[] of the cite the quotation stands on: that cite moves to the front
//   work      (occurrence) the work of the primary cite, when the fix changes it
//   locator   (occurrence) the corrected locator of the primary cite, e.g. "¶449 (pdf p240)"
//   cite      (definition) the corrected cite string, e.g. "Aion (CW9ii) ¶426"
//   demote    true: no corpus page carries these words, so the record stays and its text is LABELLED paraphrase (occurrence: quoteKind
//             "paraphrase"; definition: definition.quoteKind "paraphrase"). A demotion changes nothing else, and nothing is deleted.
//             scripts/quote-oracle.mjs skips a demoted record: it is no longer presented as a quotation.
//   basis     required: the line that proves the fix (the corpus page the words stand on)
// scripts/quote-oracle.mjs is what proves a fix: after `npm run ingest` the record must pass. Nothing here is typed from memory.

const FIELDS = new Set(['text', 'primary', 'work', 'locator', 'cite', 'demote', 'basis']);

/** Check the shape of a fixes document. Returns the list of problems (empty when valid). */
export function validateQuoteFixes(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object') return ['quote-fixes: not an object'];
  if (doc.version !== 1) problems.push('quote-fixes: "version" must be 1');
  if (!doc.fixes || typeof doc.fixes !== 'object' || Array.isArray(doc.fixes)) { problems.push('quote-fixes: "fixes" must be an object keyed by record id'); return problems; }
  for (const [id, f] of Object.entries(doc.fixes)) {
    if (!f || typeof f !== 'object') { problems.push(`${id}: not an object`); continue; }
    for (const k of Object.keys(f)) if (!FIELDS.has(k)) problems.push(`${id}: unknown field "${k}"`);
    if (typeof f.basis !== 'string' || !f.basis.trim()) problems.push(`${id}: a "basis" line is required`);
    if (f.text !== undefined && (typeof f.text !== 'string' || !f.text.trim())) problems.push(`${id}: "text" must be non-empty text`);
    for (const k of ['work', 'locator', 'cite']) if (f[k] !== undefined && (typeof f[k] !== 'string' || !f[k].trim())) problems.push(`${id}: "${k}" must be a non-empty string`);
    if (f.primary !== undefined && !(Number.isInteger(f.primary) && f.primary >= 0)) problems.push(`${id}: "primary" must be an index into jung[]`);
    if (f.demote !== undefined && f.demote !== true) problems.push(`${id}: "demote" must be true`);
    else if (f.demote === true && (f.text !== undefined || f.primary !== undefined || f.work !== undefined || f.locator !== undefined || f.cite !== undefined)) problems.push(`${id}: a demotion changes nothing else`);
    else if (f.text === undefined && f.primary === undefined && f.work === undefined && f.locator === undefined && f.cite === undefined && f.demote === undefined) problems.push(`${id}: the fix changes nothing`);
  }
  return problems;
}

/**
 * Apply the fixes to the assembled field lists in place. `workTitle(work)` names a work for a cite whose work the fix changes.
 * Returns { applied: [ids], problems: [..] }; a fix whose record is not found is a problem (a stale fix), never silently skipped.
 */
export function applyQuoteFixes({ occurrences = [], families = [], archetypes = [], theoretics = [] }, doc, { workTitle = (w) => w } = {}) {
  const problems = validateQuoteFixes(doc);
  const applied = [];
  if (problems.length) return { applied, problems };
  const occ = new Map(occurrences.map((o) => [o.id, o]));
  const defs = new Map();
  for (const [kind, list] of [['family', families], ['archetype', archetypes], ['theoretic', theoretics]]) for (const x of list) defs.set(`${kind}:${x.id}`, x);

  for (const [id, f] of Object.entries(doc.fixes)) {
    const o = occ.get(id);
    const d = defs.get(id);
    if (o) {
      if (f.demote === true) {
        if (!o.quote) { problems.push(`${id}: the occurrence has no quote to demote`); continue; }
        o.quoteKind = 'paraphrase';
        applied.push(id);
        continue;
      }
      if (f.cite !== undefined) { problems.push(`${id}: "cite" is for a definition; an occurrence takes "locator"`); continue; }
      if (f.text !== undefined) {
        if (!o.quote) { problems.push(`${id}: the occurrence has no quote to correct`); continue; }
        o.quote = f.text;
      }
      if (f.primary !== undefined || f.work !== undefined || f.locator !== undefined) {
        if (!Array.isArray(o.jung) || !o.jung.length) { problems.push(`${id}: the occurrence has no cite`); continue; }
        if (f.primary !== undefined) {
          if (f.primary >= o.jung.length) { problems.push(`${id}: primary ${f.primary} is not in jung[] (${o.jung.length} cites)`); continue; }
          const [moved] = o.jung.splice(f.primary, 1);
          o.jung.unshift(moved);
        }
        const first = o.jung[0];
        if (f.work !== undefined && f.work !== first.work) { first.work = f.work; first.workTitle = workTitle(f.work); first.year = ''; }
        if (f.locator !== undefined) first.locator = f.locator;
      }
      applied.push(id);
    } else if (d) {
      if (!d.definition) { problems.push(`${id}: no definition to correct`); continue; }
      if (f.demote === true) { d.definition.quoteKind = 'paraphrase'; applied.push(id); continue; }
      if (f.primary !== undefined || f.work !== undefined || f.locator !== undefined) { problems.push(`${id}: a definition takes "text" and "cite" only`); continue; }
      if (f.text !== undefined) d.definition.text = f.text;
      if (f.cite !== undefined) d.definition.cite = f.cite;
      applied.push(id);
    } else problems.push(`${id}: no such record (a stale fix)`);
  }
  return { applied, problems };
}
