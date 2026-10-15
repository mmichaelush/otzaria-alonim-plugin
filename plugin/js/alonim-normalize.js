// `normalizeKey`: מפתח השוואה בלבד, לעולם לא לתצוגה. החוזה (docs/CATALOG_FORMAT.md)
// מחייב שהוא זהה לזה של הקטלוג (`catalog/lib/normalize.mjs`): אותו מימוש, ושני
// הצדדים עוברים את `normalize-vectors.json` (`test/normalize-core.test.js` בודק
// גם זהות ישירה מול הקובץ של הקטלוג כשהוא קיים). כל שינוי כאן הוא שינוי בשני הצדדים.
//
// בנוסף: `highlightSpans` (מיקומי ההתאמה בטקסט המקורי, להדגשה).
(function (root) {
  'use strict';

  // נמחקים: סימני כיווניות ורוחב אפס, מרכאות מכל סוג וגרש/גרשיים (ר' = ר, תשפ"ז = תשפז).
  const DELETE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF'"`\u00B4\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u05F3\u05F4\u02BC]/g;
  // מקף עברי, מקפי יוניקוד, מינוס, לוכסן וקו תחתון: רווח (לך־לך = לך לך).
  // eslint-disable-next-line no-useless-escape -- זהה לקטלוג (catalog/lib/normalize.mjs), גם בכתיב
  const SPACE_RE = /[\u05BE\u2010-\u2015\u2212\-/\_]/g;
  // ניקוד וטעמים (המקף העברי נמצא בטווח הזה, ולכן הרווחים קודם).
  const NIQQUD_RE = /[\u0591-\u05C7]/g;
  const FINALS = { '\u05DA': '\u05DB', '\u05DD': '\u05DE', '\u05DF': '\u05E0', '\u05E3': '\u05E4', '\u05E5': '\u05E6' };

  function normalizeKey(s) {
    if (s === null || s === undefined) return '';
    let t = String(s).normalize('NFKC');
    t = t.replace(SPACE_RE, ' ').replace(DELETE_RE, '').replace(NIQQUD_RE, '');
    t = t.replace(/[\u05DA\u05DD\u05DF\u05E3\u05E5]/g, (c) => FINALS[c]);
    t = t.toLowerCase();
    // כל פיסוק או סמל שנשאר מפריד בין מילים.
    t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
    return t.replace(/\s+/g, ' ').trim();
  }

  /** שם נפרד לקריאות חיפוש: אותו דבר (הפיסוק כבר רווח). */
  const searchKey = normalizeKey;

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
  const IS_DELETE = new RegExp(DELETE_RE.source);
  const IS_SPACE = new RegExp(SPACE_RE.source);
  const IS_NIQQUD = new RegExp(NIQQUD_RE.source);
  const IS_OTHER = /[^\p{L}\p{N}\s]/u;

  /**
   * מיקומי ההתאמה של [tokens] (כבר מנורמלים) בתוך [text] המקורי, כזוגות
   * `[start, end)`, ממוזגים וממוינים. התאמה בתחילת מילה בלבד, כמו החיפוש.
   * כשהנרמול משנה אורך (ליגטורות) מחזיר ריק: עדיף בלי הדגשה מהדגשה במקום הלא נכון.
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
      if (IS_SPACE.test(ch)) out = ' ';
      else if (IS_DELETE.test(ch) || IS_NIQQUD.test(ch)) continue;
      if (IS_OTHER.test(out)) out = ' ';
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
