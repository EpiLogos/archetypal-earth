// Small pure text helpers shared by data and UI.

export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('; '));
  if (stop > max * 0.55) return cut.slice(0, stop + 1);
  return cut.replace(/\s+\S*$/, '') + '…';
}

/**
 * The vault's year display is human truth and can be long prose
 * ("c. 250 (sleep begins); woke under Theodosius II"). Labels want the lead.
 */
export function eraShort(display: string, max = 24): string {
  let t = display.replace(/\s*\([^)]*\)/g, ' ').split(';')[0].replace(/\s+/g, ' ').trim();
  if (!t) t = display.trim();
  if (t.length > max) t = t.slice(0, max).replace(/[\s,.:–-]+\S*$/, '').replace(/[\s,.:–-]+$/, '') + '…';
  return t;
}
