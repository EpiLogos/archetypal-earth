// The owner's ruling: no provenance or decision residue in what ships. A tie, a link or an orbit is shown by its name; no label,
// tooltip or disclosure says whose word it is, how the atlas arrived at it, or where it was read in. This reads every source file of
// `src` (comments left out: they are the developers') for the phrases that did, and for the label keys that carried them.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = process.env.SRC_DIR ?? path.resolve(__dirname, '..', '..', 'src');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|css)$/.test(e.name) ? [p] : [];
  });
}

/** The code with its comments taken out (a `//` that opens a comment follows whitespace or starts the line; `://` in a URL does not). */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const apos = (s: string) => s.replace(/’/g, "['’]");
const PHRASES = [
  'atlas’s inference', 'atlas’s own link', 'A link the atlas draws', 'Links the atlas draws', '(read here)', 'tie basis',
  'placed by the field’s joins', 'inferred by the vault', 'linked by this site',
];
const KEYS = ['tieOwnNote', 'tieOwnLink', 'astrologyOtherTies', 'astrologyOtherTiesOnly', 'amplifyTieOwn'];

describe('no provenance label ships', () => {
  const code = files(SRC).map((f) => ({ f: path.relative(SRC, f), text: withoutComments(fs.readFileSync(f, 'utf8')) }));

  it('reads the source tree', () => {
    expect(code.length).toBeGreaterThan(100);
  });

  for (const phrase of PHRASES) {
    it(`no source says “${phrase}”`, () => {
      const re = new RegExp(apos(phrase).replace(/[()]/g, '\\$&'), 'i');
      expect(code.filter((c) => re.test(c.text)).map((c) => c.f)).toEqual([]);
    });
  }

  for (const key of KEYS) {
    it(`the label key ${key} is gone`, () => {
      expect(code.filter((c) => c.text.includes(key)).map((c) => c.f)).toEqual([]);
    });
  }
});
