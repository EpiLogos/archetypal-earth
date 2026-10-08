// Text helpers: link stripping, label derivation, instance body parsing, one-liners.
import { stripLinks, linkTargets } from './vault.mjs';

export function collapse(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** Plain prose from vault markdown: no wikilinks, emphasis markers, pdf-page noise. */
export function plain(s) {
  let t = stripLinks(String(s));
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, '$1$2');
  t = t.replace(/`([^`]+)`/g, '$1');
  // pdf page locators are bookkeeping, not prose
  t = t.replace(/\s*\(\s*(?:[\w .]*,\s*)?pdf pp?\.?\s*[\d\-–—, pf.]+\)/gi, '');
  t = t.replace(/\s*[,;]\s*pdf pp?\.?\s*[\d\-–—, pf.]+/gi, '');
  t = t.replace(/\(\s*\)/g, '').replace(/\(\s*[,;]\s*/g, '(').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(');
  return collapse(t);
}

const STOP_TAIL = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'with', 'from', 'by', 'for', 'as', 'into', 'its', 'his', 'her', 'their']);

const BREAK_BEFORE = new Set(['to', 'in', 'of', 'by', 'with', 'and', 'or', 'for', 'from', 'at', 'as', 'who', 'that', 'which', 'between', 'on', 'after', 'before', 'into', 'whose', 'where', 'while', 'when', 'against', 'beside', 'under', 'over', 'through']);

function fixQuotes(s) {
  let t = s;
  for (const q of ["'", '"', '\u201c', '\u2018']) void q;
  // drop unmatched straight quotes at the ends (apostrophes inside words are left alone)
  const dq = (t.match(/"/g) || []).length;
  if (dq % 2) t = t.replace(/^"|"$/g, '');
  if (/^'[^']*$/.test(t)) t = t.slice(1);
  if (/^[^']*'$/.test(t) && !/\w's$/.test(t)) t = t.slice(0, -1);
  if (/'/.test(t) && !/\w'\w|\w'\s|s'\s/.test(t) && (t.match(/'/g) || []).length === 1) t = t.replace(/'/g, '');
  return t.trim();
}

function cutAtWord(s, max, minKeep = 28) {
  if (s.length <= max) return s;
  const words = s.slice(0, max + 1).split(' ');
  // last word may be partial: drop it unless the cut fell exactly on a boundary
  if (s[max] !== ' ') words.pop();
  let cut = words.join(' ');
  // prefer to end before a connective word so the label closes on a noun phrase
  const ws = cut.split(' ');
  for (let i = ws.length - 1; i >= 1; i--) {
    if (BREAK_BEFORE.has(ws[i].toLowerCase().replace(/[^a-z]/g, '')) && ws.slice(0, i).join(" ").length >= minKeep) {
      cut = ws.slice(0, i).join(' ');
      break;
    }
  }
  cut = cut.replace(/[\s,;:—–\-(]+$/, '');
  const out = cut.split(' ');
  while (out.length > 2 && (STOP_TAIL.has(out[out.length - 1].toLowerCase()) || /^[("']$/.test(out[out.length - 1]))) out.pop();
  return out.join(' ');
}

function balanced(s) {
  return (s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length;
}

/** Short evocative label (<= 48 chars) from a long vault title. */
export function shortLabel(title, max = 48) {
  return fixQuotes(shortLabelRaw(title, max));
}

function shortLabelRaw(title, max) {
  let t = collapse(stripLinks(title)).replace(/^["']|["']$/g, '');
  if (t.length <= max) return t;
  const noParen = collapse(t.replace(/\s*\([^()]*\)/g, ''));
  if (noParen.length <= max && noParen.length >= 8) return noParen;
  const segs = noParen.split(/\s+[—–]\s+|:\s+|;\s+/).map((x) => x.trim()).filter(Boolean);
  const head = segs[0] || noParen;
  const tail = segs.length > 1 ? segs[segs.length - 1] : '';
  const tryList = [];
  if (segs.length > 1) {
    tryList.push(`${head} — ${segs[1]}`);
    if (tail !== segs[1]) tryList.push(`${head} — ${tail}`);
  }
  for (const c of tryList) if (c.length <= max) return c;
  if (head.length <= max && head.length >= 18) return head;
  if (head.length <= max && head.length >= 6 && segs.length > 1) {
    const room = max - head.length - 4;
    if (room >= 10) {
      const piece = cutAtWord(segs[1], room, 8);
      if (piece.length >= 8) return `${head} — ${piece}${piece.length < segs[1].length ? '…' : ''}`;
    }
    return head;
  }
  const base = head.length >= 14 ? head : noParen;
  let out = cutAtWord(base, max - 1);
  if (!balanced(out)) out = out.replace(/\s*\([^)]*$/, '');
  return `${out}…`;
}

/** Strip a trailing bibliographic parenthetical from a quote line. */
function unquote(line) {
  let t = line.trim();
  t = t.replace(/\s*\((?:[^()]*(?:cw\d|¶|pdf|fig\.|par\.)[^()]*)\)\s*\.?$/i, '').trim();
  const m = t.match(/^[“"'‘](.+)[”"'’][.,;:]?$/s);
  if (m) t = m[1];
  else {
    const first = t.search(/["“]/);
    const last = Math.max(t.lastIndexOf('"'), t.lastIndexOf('”'));
    if (first === 0 && last > first) t = t.slice(1, last);
  }
  return collapse(t.replace(/^[“"']|[”"']$/g, ''));
}

function capQuote(q, max = 320) {
  if (q.length <= max) return q;
  const slice = q.slice(0, max);
  const end = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '), slice.lastIndexOf('? '));
  if (end > max * 0.45) return slice.slice(0, end + 1);
  return `${cutAtWord(q, max - 1)}…`;
}

/** Split an instance note body into paragraphs / first quote / parallels. */
export function parseInstanceBody(body) {
  const lines = String(body).split(/\r?\n/);
  const paras = [];
  const quotes = [];
  let parallels = [];
  let cur = [];
  let qcur = [];
  const flush = () => {
    if (cur.length) paras.push(cur.join(' '));
    cur = [];
  };
  const qflush = () => {
    if (qcur.length) quotes.push(qcur.join(' '));
    qcur = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('>')) {
      flush();
      qcur.push(line.replace(/^>+\s?/, ''));
      continue;
    }
    qflush();
    if (!line) {
      flush();
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flush();
      continue;
    }
    if (/^\W*Parallels?\b\W*:/i.test(line)) {
      flush();
      parallels = parallels.concat(linkTargets(line.replace(/^[^:]*:/, '').match(/\[{2,3}[^\]]+\]{2,3}/g) || []));
      continue;
    }
    if (/^\W*Pins?\b\W*:/i.test(line)) {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  qflush();
  const bodyParas = paras.map(plain).filter((p) => p.length > 0);
  let quote;
  if (quotes.length) {
    const q = unquote(plain(quotes[0]));
    if (q.length >= 12) quote = capQuote(q);
  }
  return { body: bodyParas, quote, parallels: [...new Set(parallels)] };
}

/** "Form" line of an image note -> short orienting line (<= 90 chars) or null if unusable. */
export function oneLineFromForm(body, maxTotal = 90) {
  const max = maxTotal - 1; // room for the closing period
  const m = String(body).match(/^\s*\*{0,2}Form\b[.:]?\*{0,2}[.:]?\s*(.+)$/im);
  if (!m) return null;
  let t = plain(m[1]);
  t = t.replace(/\s*\((?:[^()]*(?:cw\s?\d|¶|par\.|fig\.|pl\.)[^()]*)\)/gi, '');
  t = t.replace(/,?\s*\b(?:cw\s?\d+[a-z]*\s*)?¶+[\d\-–,\s/f.]*/gi, '');
  t = collapse(t);
  // first sentence, then first clause that fits
  const sentence = t.split(/(?<=[a-z)"”])\.\s+(?=[A-Z])/)[0].replace(/\.$/, '');
  const clauses = sentence.split(/\s*[;—–]\s*|:\s+/);
  let out = clauses[0];
  for (let i = 1; i < clauses.length; i++) {
    const cand = `${out}; ${clauses[i]}`;
    if (cand.length <= max) out = cand;
    else break;
  }
  if (out.length > max) {
    const cutIdx = out.slice(0, max).lastIndexOf(',');
    if (cutIdx > 30) out = out.slice(0, cutIdx);
    else out = cutAtWord(out, max - 1);
  }
  out = out.replace(/[,;:\s—–-]+$/, '');
  if (out.length < 18 || out.length > max || !balanced(out) || /[¶]|\bcw\s?\d/i.test(out) || (out.match(/["“”]/g) || []).length % 2) return null;
  return out.charAt(0).toUpperCase() + out.slice(1) + '.';
}
