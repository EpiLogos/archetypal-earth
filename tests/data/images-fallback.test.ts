import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script
import { acceptFallback, wholeWordIn, MIN_FALLBACK_SCORE } from '../../scripts/lib/image-fallback.mjs';

// No network. The file titles below are the ones the family batch logged as wrong picks
// (batch logs: "Seven Sisters 3.jpg" for seven, "Ether Dome Daguerreotype No. 1.png" for ether,
// "OL ONAL DIGIT EIGHT.jpg", "Prince at Coachella (cropped).jpg", "Sarcophagus of Princess Sophia").
// Only the titles are real. Where a case needs a description or categories, the test says so.

type Cand = { title: string; descr?: string; cats?: string[]; objectName?: string };
const cand = (c: Cand) => ({ descr: '', cats: [], objectName: '', ...c });

describe('wholeWordIn', () => {
  it('matches the name as a whole word, folded, with an optional plural', () => {
    expect(wholeWordIn('Ether, the fifth element', 'ether')).toBe(true);
    expect(wholeWordIn('Lions at the gate', 'lion')).toBe(true);
    expect(wholeWordIn('The Lion of Judah', 'the Lion')).toBe(true);
    // accents fold: the same word in another spelling
    expect(wholeWordIn('Aéthér study', 'aether')).toBe(true);
  });

  it('does not match a name inside a longer word', () => {
    expect(wholeWordIn('Whether the stars wheel', 'ether')).toBe(false);
    expect(wholeWordIn('Together we stand', 'ether')).toBe(false);
    expect(wholeWordIn('Eighteenth-century plate', 'eight')).toBe(false);
    expect(wholeWordIn('Leonardo study', 'leo')).toBe(false);
  });
});

describe('acceptFallback: wrong picks from the batch are rejected', () => {
  it('rejects "Seven Sisters" for the node seven (a proper name starts after the word)', () => {
    const r = acceptFallback(cand({ title: 'File:Seven Sisters 3.jpg' }), { names: ['Seven'], score: 85 });
    expect(r.ok).toBe(false);
    expect((r as { why: string }).why).toMatch(/proper name/);
  });

  it('rejects the Ether Dome daguerreotype for the node ether', () => {
    const r = acceptFallback(cand({ title: 'File:Ether Dome Daguerreotype No. 1.png' }), {
      names: ['Ether', 'aether'],
      score: 85,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects the satirical print for intuition', () => {
    const title =
      'File:Lessons of love or architecture taught by intuition ot the carpenters soliloquy (BM 1868,0808.6059).jpg';
    // title only: no art vocabulary in what the file says of itself
    expect(acceptFallback(cand({ title }), { names: ['Intuition'], score: 96 }).ok).toBe(false);
    // assumed description of a satirical print (not fetched): satire is refused outright
    const withSatire = acceptFallback(cand({ title, descr: 'Satirical engraving, engraving on paper' }), {
      names: ['Intuition'],
      score: 96,
    });
    expect(withSatire.ok).toBe(false);
    expect((withSatire as { why: string }).why).toMatch(/satire/);
  });

  it('rejects the digit-eight photograph for the node eight', () => {
    const r = acceptFallback(cand({ title: 'File:OL ONAL DIGIT EIGHT.jpg', descr: 'digit eight' }), {
      names: ['Eight'],
      score: 82,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a Coachella photograph for a court card named Prince', () => {
    const r = acceptFallback(cand({ title: 'File:Prince at Coachella (cropped).jpg' }), { names: ['Prince'], score: 85 });
    expect(r.ok).toBe(false);
  });

  it('rejects a sarcophagus of Princess Sophia for the node princess', () => {
    const r = acceptFallback(cand({ title: 'File:02020 0691 Sarcophagus of Princess Sophia.jpg' }), {
      names: ['Princess'],
      score: 86,
    });
    expect(r.ok).toBe(false);
    expect((r as { why: string }).why).toMatch(/proper name/);
  });

  it('rejects the George I medal for the node leo (no whole word leo in the file)', () => {
    const r = acceptFallback(
      cand({ title: 'File:Great Britain Accession Medal George I 1714, Georg Wilhelm Vestner (rev)-0591.jpg' }),
      { names: ['Leo', 'the Lion'], score: 85 },
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a name that is only a substring of a longer word', () => {
    const r = acceptFallback(cand({ title: 'File:Whether the stars wheel, engraving.jpg', descr: 'engraving' }), {
      names: ['ether'],
      score: 90,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a plate below the score floor, even when the name matches', () => {
    const c = cand({ title: 'File:Allegory of Air, oil on panel.jpg', descr: 'oil on panel' });
    expect(acceptFallback(c, { names: ['Air'], score: MIN_FALLBACK_SCORE - 1 }).ok).toBe(false);
  });
});

describe('acceptFallback: a correct pick is accepted', () => {
  it('accepts an allegory of air for the node air', () => {
    // title: real, logged as a correct pick. descr and cats: illustrative of a Commons painting page.
    const r = acceptFallback(
      cand({
        title: 'File:Follower of Jan Brueghel (I) - An Allegory of Air.jpg',
        descr: 'Oil on panel. An allegory of the element air.',
        cats: ['Paintings of allegories'],
      }),
      { names: ['Air'], score: 93 },
    );
    expect(r).toEqual({ ok: true });
  });

  it('accepts an allegory of earth when the name is a whole word and the score meets the floor', () => {
    const c = cand({
      title:
        'File:Jan Brueghel the Younger, Hendrik van Balen - Landscape with Ceres (Allegory of Earth) - 71.PB.29 - J. Paul Getty Museum.jpg',
      cats: ['Paintings in the J. Paul Getty Museum'],
    });
    expect(acceptFallback(c, { names: ['Earth'], score: MIN_FALLBACK_SCORE }).ok).toBe(true);
  });

  it('accepts a museum object whose title carries the node name', () => {
    const c = { title: 'Met:12345', descr: 'Alchemical emblem of the Quintessence', cats: ['Prints'], objectName: 'Print' };
    expect(acceptFallback(c, { names: ['Quintessence'], score: 75 }).ok).toBe(true);
  });

  it('refuses a candidate with no names to test', () => {
    const c = cand({ title: 'File:Allegory of Air, oil on panel.jpg', descr: 'oil on panel' });
    expect(acceptFallback(c, { names: [], score: 99 }).ok).toBe(false);
  });
});
