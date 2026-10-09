// The reader's words in the Aion history: the curation is what the vault-side generator reads, and public/data/history.json
// is the copy the app ships; they must say the same. And no table jargon, footnote tag or work-status tag reaches a reader.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { History } from '../../src/types/history';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const history: History = read('public/data/history.json');
const curated = ['jung-aion.json', 'the-turn.json', 'aquarius-horizon.json'].flatMap((f) => read(`curation/aion/${f}`).readings as History['readings']);

type Item = { id: string; kind: 'epoch' | 'event' | 'thread'; body?: string[]; text: string[] };
function items(readings: History['readings']): Item[] {
  const out: Item[] = [];
  for (const r of readings) {
    for (const e of r.epochs) out.push({ id: e.id, kind: 'epoch', body: e.body, text: [e.name, e.oneLine, ...e.body] });
    for (const e of r.events) out.push({ id: e.id, kind: 'event', body: e.body, text: [e.name, e.yearDisplay, e.place ?? '', e.oneLine, ...e.body] });
    for (const t of r.threads) out.push({ id: t.id, kind: 'thread', text: [t.name, t.oneLine] });
  }
  return out;
}

describe('the Aion curation and the shipped history say the same', () => {
  it('every reading, epoch, event and thread in curation/aion matches public/data/history.json', () => {
    expect(curated.map((r) => r.id).sort()).toEqual(history.readings.map((r) => r.id).sort());
    for (const r of history.readings) {
      const c = curated.find((x) => x.id === r.id)!;
      for (const key of Object.keys(r) as (keyof typeof r)[]) {
        if (key === 'epochs' || key === 'events' || key === 'threads') {
          expect(r[key].length, `${r.id} ${key}`).toBe(c[key].length);
          for (const x of r[key]) expect(JSON.stringify(x), `${r.id}/${x.id}`).toBe(JSON.stringify(c[key].find((y: { id: string }) => y.id === x.id)));
        } else expect(JSON.stringify(r[key]), `${r.id}.${key}`).toBe(JSON.stringify(c[key]));
      }
    }
  });
});

/** Table jargon and tags a reader must never see. Each entry names the one place it is still allowed, and why. */
const JARGON = [/\brows?\b/i, /\bfn\d+/i, /\(S[,)]/, /\(J[,)]/, /\(not in (the )?corpus\)/i, /\bthe atlas\b/i, /\bthe vault\b/i];
const OPEN: Record<string, { pattern: RegExp; why: string }> = {};

describe('the reader sees finished sentences, free of table jargon and tags', () => {
  it('no reader-facing Aion string carries table jargon, a footnote tag or a work-status tag (named exceptions only)', () => {
    const hits: string[] = [];
    for (const it_ of items(history.readings)) for (const text of it_.text) for (const re of JARGON) {
      if (!re.test(text)) continue;
      const open = OPEN[it_.id];
      if (open && open.pattern.test(text) && re.source === /\brows?\b/i.source) continue;
      hits.push(`${it_.id}: ${re} in "${text.slice(0, 80)}"`);
    }
    expect(hits).toEqual([]);
  });

  it('every body paragraph ends in a terminal stop (or a quotation closed after one), opens with a capital, and never ends in a semicolon', () => {
    const bad: string[] = [];
    for (const it_ of items(history.readings)) for (const p of it_.body ?? []) {
      const t = p.trim();
      if (/;$/.test(t) || !/[.!?…]["”’)\]]*$/.test(t) || /^[a-z]/.test(t)) bad.push(`${it_.id}: "${t.slice(0, 70)}"`);
    }
    expect(bad).toEqual([]);
  });

  it('the one open word is exactly where the exception says it is, and nowhere else', () => {
    for (const [id, { pattern }] of Object.entries(OPEN)) {
      const it_ = items(history.readings).find((x) => x.id === id)!;
      expect(it_.text.some((t) => pattern.test(t)), id).toBe(true);
    }
  });
});
