// The engagement year of a cite: the first four-digit year in the string Jung's cite carries as `year` ("1936/44" -> 1936,
// "1911–12/1952" -> 1911, "1970 (English 1974)" -> 1970). A string with no such year ("index", a title, "pin tbd") has none,
// and says so: it is listed by scripts/verify-cite-years.mjs, never given a guessed year.
const YEAR = /\b1[5-9]\d\d\b|\b20\d\d\b/;

export function citeYear(text) {
  const m = YEAR.exec(String(text ?? ''));
  return m ? Number(m[0]) : null;
}
