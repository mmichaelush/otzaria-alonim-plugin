// normalizeKey: the single comparison key shared by catalog and plugin.
// The plugin keeps a byte-identical copy (plugin/js/alonim-normalize.js); the
// vectors in test/fixtures/normalize-vectors.json guard the two against drift.
// Output is for matching only, never for display.

// Deleted outright: zero-width/bidi/format marks (U+200B-U+200F, U+202A-U+202E,
// U+2060-U+2069, U+FEFF) plus quotes and geresh/gershayim (U+05F3, U+05F4), so
// "ר'" and "תשפ\"ז" match "ר" and "תשפז".
const DELETE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF'"`\u00B4\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u05F3\u05F4\u02BC]/g;
// Maqaf (U+05BE), hyphens/dashes (U+2010-U+2015, U+2212), slashes and
// underscore become a space so "לך־לך" == "לך לך".
const SPACE_RE = /[\u05BE\u2010-\u2015\u2212\-/\_]/g;
// Niqqud and cantillation (U+0591-U+05C7).
const NIQQUD_RE = /[\u0591-\u05C7]/g;
const FINALS = { '\u05DA': '\u05DB', '\u05DD': '\u05DE', '\u05DF': '\u05E0', '\u05E3': '\u05E4', '\u05E5': '\u05E6' };

export function normalizeKey(s) {
  if (s == null) return '';
  let t = String(s).normalize('NFKC');
  // Maqaf lives inside the niqqud range, so spaces are inserted first.
  t = t.replace(SPACE_RE, ' ').replace(DELETE_RE, '').replace(NIQQUD_RE, '');
  t = t.replace(/[\u05DA\u05DD\u05DF\u05E3\u05E5]/g, (c) => FINALS[c]);
  t = t.toLowerCase();
  // Any remaining punctuation or symbol separates words.
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
