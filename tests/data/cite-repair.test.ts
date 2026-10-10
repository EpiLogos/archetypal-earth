// The citation rules that repair instead of omitting: a ¶ marker the scan lost, words the scan ran together, a printed
// page shown only when its label agrees with its neighbours, and an external work's running heads read as page labels.
import { describe, expect, it } from 'vitest';
import { locate, trustedPrint, verify } from '../../scripts/lib/cite.mjs';
import { splitHead } from '../../scripts/lib/external.mjs';

/** A loader over one fake work: pages of text with optional ¶ markers inline, as the flattened corpus holds them. */
function fakeLoader(pages: { page: number; print?: string; text: string }[]) {
  let flat = '';
  const ps: { page: number; print: string | null; at: number }[] = [];
  const marks: { n: number; at: number }[] = [];
  for (const p of pages) {
    ps.push({ page: p.page, print: p.print ?? null, at: flat.length });
    for (const part of p.text.split(/(\[¶\d+\])/)) {
      const m = /^\[¶(\d+)\]$/.exec(part);
      if (m) marks.push({ n: Number(m[1]), at: flat.length });
      else flat += part;
    }
    flat += '\n';
  }
  const work = { text: flat, pages: ps, marks };
  return () => work;
}

describe('a ¶ the scan lost', () => {
  const load = fakeLoader([
    { page: 10, text: '[¶869] The first paragraph runs here and ends. These structures not only express order, they also create it, as the text says.' },
    { page: 11, text: '[¶871] The next paragraph has its marker.' },
  ]);
  it('stands when the corpus leaves room for it and holds no marker for it anywhere', () => {
    const r = locate(load, 'w', 'These structures not only express order, they also create it', { para: 870 });
    expect(r.locator).toBe('¶870 (pdf p10)');
    expect(r.warning).toBeUndefined();
    expect(r.note).toMatch(/missing from the scan, between ¶869 and ¶871/);
  });
  it('does not stand when the corpus contradicts it', () => {
    const r = locate(load, 'w', 'These structures not only express order, they also create it', { para: 875 });
    expect(r.locator).toBe('¶869 (pdf p10)'); // the corpus marker is kept…
    expect(r.warning).toMatch(/cites ¶875/); // …and the disagreement is reported
  });
});

describe('words the scan ran together', () => {
  const load = fakeLoader([
    { page: 40, text: 'Pluto, forexample, is a reclusive planet which can, in the chart for a scientist, help Mars sublimate.' },
    { page: 41, text: 'For Leo the issue is seifcontrol-self-mastery is the road.' },
  ]);
  it('are read through on the curated page, and said so', () => {
    const r = locate(load, 'w', 'Pluto, for example, is a reclusive planet which can, in the chart for a scientist', { page: 40 });
    expect(r.locator).toBe('pdf p40');
    expect(r.scan).toBe(true);
    expect(verify(load, { work: 'w', locator: 'pdf p40', quote: 'Pluto, for example, is a reclusive planet which can, in the chart for a scientist' })).toBeNull();
  });
  it('allow only the l/i/1 misread, never another letter', () => {
    expect(locate(load, 'w', 'For Leo the issue is self-control—self-mastery is the road', { page: 41 }).scan).toBe(true);
    expect(locate(load, 'w', 'For Leo the issue is sell-control—self-mastery is the road', { page: 41 }).error).toBeTruthy();
  });
  it('are never searched without a curated page', () => {
    expect(locate(load, 'w', 'Pluto, for example, is a reclusive planet which can, in the chart for a scientist').error).toBeTruthy();
  });
});

describe('printed pages', () => {
  const pages = (labels: (string | null)[]) => ({ pages: labels.map((print, i) => ({ page: i + 10, print })) });
  it('are shown when the label agrees with its neighbours', () => {
    const c = pages(['8', '9', '10', '11', '12']);
    expect(trustedPrint(c, 2)).toBe('10');
  });
  it('are not shown for a lone or out-of-step label (a ¶ number misread as a folio)', () => {
    expect(trustedPrint(pages([null, null, '10', null, null]), 2)).toBeNull();
    expect(trustedPrint(pages(['8', '9', '412', '11', '12']), 2)).toBeNull();
  });
});

describe('an external work’s running heads', () => {
  it('are taken out of the text and kept as the printed label', () => {
    expect(splitHead('44 Chaos\nhe combined scientific rigor')).toEqual({ text: 'he combined scientific rigor', print: '44' });
    expect(splitHead('The Shadow Side of Symbols 89\ndiachronic dynamics')).toEqual({ text: 'diachronic dynamics', print: '89' });
    expect(splitHead('112\nThe oscillatory nature')).toEqual({ text: 'The oscillatory nature', print: '112' });
    expect(splitHead('Psychodynamics\n29\nthe image of a certain')).toEqual({ text: 'Psychodynamics\nthe image of a certain', print: '29' });
    expect(splitHead('Preface\nHow can we deal with chaos\n11\n')).toEqual({ text: 'Preface\nHow can we deal with chaos', print: '11' });
  });
  it('leave a numbered heading as text', () => {
    expect(splitHead('Appendix 1\nSensitive Dependence').print).toBeNull();
  });
});
