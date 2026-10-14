import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The README is the product's front door, not a build report. This keeps its figures and lens names the app's own, so
// "update the README" is a matter of re-running this, not of rewriting it. The contract is in AGENTS.md.
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const readme = read('README.md');

describe('README', () => {
  it('links the live site and shows the image it names', () => {
    expect(readme).toContain('https://jung.epi-logos.org');
    const img = /!\[[^\]]*\]\(([^)]+\.(?:jpg|png))\)/.exec(readme)?.[1];
    expect(img, 'a screenshot of the app').toBeTruthy();
    expect(existsSync(new URL(`../${img}`, import.meta.url))).toBe(true);
  });

  it("states the field's own counts", () => {
    const c = JSON.parse(read('public/data/field.stats.json')).counts as Record<string, number>;
    const fmt = (n: number) => n.toLocaleString('en-US');
    for (const key of ['archetypes', 'theoretics', 'families', 'occurrences']) {
      expect(readme, `${key}: ${c[key]}`).toContain(`**${fmt(c[key])} `);
    }
  });

  it('names every lens the menu offers, in the app’s own words', () => {
    const src = read('src/shell/lens.ts');
    const lenses = [...src.matchAll(/id: '[a-z]+', label: '([^']+)'[^\n]*blurb: '([^']+)'/g)];
    expect(lenses.length).toBeGreaterThanOrEqual(9);
    for (const [, label, blurb] of lenses) {
      expect(readme).toContain(`**${label}**`);
      expect(readme.replace(/’/g, "'")).toContain(blurb.replace(/’/g, "'"));
    }
  });

  it('is not the vault’s README or a build report', () => {
    expect(readme).not.toMatch(/obsidian|dataview|open the folder|LEDGER\.md/i);
  });
});
