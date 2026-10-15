// `normalizeKey`: מחרוזת להשוואה בלבד, לעולם לא לתצוגה. החוזה
// (docs/CATALOG_FORMAT.md) מחייב שהוא זהה לזה של הקטלוג
// (`catalog/lib/normalize.mjs`); `test/normalize.test.js` בודק זהות כשהקובץ
// קיים בריפו. כל שינוי כאן הוא שינוי בשני הצדדים.
//
// בנוסף: `searchKey` (נרמול לחיפוש, מוסיף הסרת פיסוק) ו-`highlightSpans`
// (מיקומי ההתאמה בטקסט המקורי, להדגשה).
(function (root) {
  'use strict';

  // מקף עברי (U+05BE), מקפי יוניקוד (U+2010-2015), מינוס (U+2212), "fraction
  // slash" ולוכסנים: מפרידים בין מילים.
  const SPACE_SET = '\\u05BE\\-\\u2010-\\u2015\\u2212\\u2044/\\\\';
  // גרש (U+05F3), גרשיים (U+05F4) ומרכאות מכל סוג: נמחקים (רש"י = רשי,
  // ה'תשפ"ז = התשפז).
  const NOTHING_SET = '\\u05F3\\u05F4"\'`\\u00B4\\u2018-\\u201F\\u00AB\\u00BB\\u02BB\\u02BC\\u2032\\u2033';
  // ניקוד וטעמים (U+05BE כבר הפך לרווח).
  const MARKS_SET = '\\u0591-\\u05C7';

  const TO_SPACE = new RegExp('[' + SPACE_SET + ']', 'g');
  const TO_NOTHING = new RegExp('[' + NOTHING_SET + ']', 'g');
  const MARKS = new RegExp('[' + MARKS_SET + ']', 'g');
  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  const FINAL_LETTERS = /[ךםןףץ]/g;
  const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;

  function normalizeKey(value) {
    return String(value === null || value === undefined ? '' : value)
      .normalize('NFKC')
      .replace(TO_SPACE, ' ')
      .replace(TO_NOTHING, '')
      .replace(MARKS, '')
      .replace(FINAL_LETTERS, (letter) => FINALS[letter])
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** כמו `normalizeKey`, ופיסוק נשאר רווח: "נח," ו-"נח" הם אותה מילה. */
  function searchKey(value) {
    return normalizeKey(value).replace(PUNCTUATION, ' ').replace(/\s+/g, ' ').trim();
  }

  /** פונקציה טהורה עם מטמון, לכותרות שחוזרות עשרות אלפי פעמים. */
  function memoized(fn, limit) {
    const cache = new Map();
    return (value) => {
      const key = value === null || value === undefined ? '' : String(value);
      let out = cache.get(key);
      if (out === undefined) {
        out = fn(key);
        if (cache.size >= (limit || 50000)) cache.clear();
        cache.set(key, out);
      }
      return out;
    };
  }

  // גרסאות בלי דגל `g` לבדיקת תו בודד: ל-`test` עם `g` יש מצב.
  const IS_SPACE = new RegExp('[' + SPACE_SET + ']');
  const IS_NOTHING = new RegExp('[' + NOTHING_SET + ']');
  const IS_MARK = new RegExp('[' + MARKS_SET + ']');
  const IS_PUNCTUATION = /[^\p{L}\p{N}\s]/u;

  /**
   * מיקומי ההתאמה של [tokens] (כבר מנורמלים ב-`searchKey`) בתוך [text] המקורי,
   * כזוגות `[start, end)`, ממוזגים וממוינים. התאמה בתחילת מילה בלבד, כמו
   * החיפוש. כשהנרמול משנה אורך (ליגטורות) מחזיר ריק: עדיף בלי הדגשה מהדגשה
   * במקום הלא נכון.
   */
  function highlightSpans(text, tokens) {
    const source = String(text || '');
    if (!source || !tokens || !tokens.length) return [];
    const nfkc = source.normalize('NFKC');
    if (nfkc.length !== source.length) return [];
    let norm = '';
    const origin = [];
    for (let i = 0; i < nfkc.length; i++) {
      const ch = nfkc[i];
      let out = ch;
      if (IS_NOTHING.test(ch) || IS_MARK.test(ch)) continue;
      if (IS_SPACE.test(ch) || IS_PUNCTUATION.test(ch)) out = ' ';
      out = (FINALS[out] || out).toLowerCase();
      norm += out;
      origin.push(i);
    }
    const spans = [];
    for (const token of tokens) {
      if (!token) continue;
      let from = 0;
      for (;;) {
        const at = norm.indexOf(token, from);
        if (at < 0) break;
        from = at + token.length;
        if (at > 0 && norm[at - 1] !== ' ') continue;
        spans.push([origin[at], origin[at + token.length - 1] + 1]);
      }
    }
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const span of spans) {
      const prev = merged[merged.length - 1];
      if (prev && span[0] <= prev[1]) prev[1] = Math.max(prev[1], span[1]);
      else merged.push([span[0], span[1]]);
    }
    return merged;
  }

  const api = { normalizeKey, searchKey, memoized, highlightSpans };
  const A = (root.Alonim = root.Alonim || {});
  A.Normalize = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
