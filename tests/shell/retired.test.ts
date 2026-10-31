// H7: what the pane, the dock and the View control replaced is gone, and stays gone. The old cards and sheets (the lens panel), the
// Options hamburger, the "Show the whole field" link and the graph's mode switch must not be in src/ by file or by name, and no
// stylesheet rule may stand on a class that no code in src/ ever sets.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..', '..', 'src');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(SRC);
// the page itself (index.html) sets classes too
const code = [...files.filter((f) => /\.(ts|html)$/.test(f)), path.resolve(SRC, '..', 'index.html')];
const styles = files.filter((f) => f.endsWith('.css'));
const read = (f: string) => fs.readFileSync(f, 'utf8');
const rel = (f: string) => path.relative(SRC, f);

const RETIRED_FILES = ['graph/switch.ts', 'shell/panel.ts', 'shell/panel-state.ts'];
const RETIRED_NAMES = [
  'mode-switch', 'lens-panel', 'mode-options', 'mode-opt-btn', 'sh-scope', 'Show the whole field',
  'setLensOptions', 'modeOptions', 'sheetAction', 'class: \'lp-body\'',
  // the filter's button floated over the globe in the dock row and opened a toast-style popover; the panels have one head and one handle
  'dock-add', 'filter-pop', 'fp-head', 'sm-grab', 'mode-opt-grab',
];

describe('the retired surfaces', () => {
  it.each(RETIRED_FILES)('%s is gone', (f) => {
    expect(fs.existsSync(path.join(SRC, f))).toBe(false);
  });

  it.each(RETIRED_NAMES)('%s appears nowhere in src', (name) => {
    const at = [...code, ...styles].filter((f) => read(f).includes(name)).map(rel);
    expect(at).toEqual([]);
  });
});

describe('the stylesheets', () => {
  // classes the code builds from a template (`kind-${type}`), not as a whole word
  const BUILT = [/^kind-/, /^sky-chart-/, /^q\d+$/];
  const words = new Set(code.flatMap((f) => read(f).match(/[A-Za-z_][\w-]*/g) ?? []));
  const dead = (f: string) => {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    const classes = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
    return [...classes].filter((c) => !words.has(c) && !BUILT.some((r) => r.test(c))).sort();
  };
  it.each(styles.map(rel))('%s has no rule on a class that src/ never sets', (name) => {
    expect(dead(path.join(SRC, name))).toEqual([]);
  });
});
