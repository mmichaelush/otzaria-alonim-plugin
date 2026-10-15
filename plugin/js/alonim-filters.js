// מודל המסננים של "כל העלונים": צורה קנונית, ניקוי קלט, ספירה, הוספה והסרה של ערך.
// טהור (בלי DOM). האינדקס (`CatalogIndex.search`) מבצע את הסינון עצמו; כאן רק המבנה.
//
// הסמנטיקה (נכתבת גם בממשק ובמסמכים):
//   * בתוך מסנן מרובה ערכים (פרשה, אירוע, שנה, שפה, מקור, חוג, סדרה): או — מספיק
//     שהגיליון מתאים לאחד הערכים.
//   * בין מסננים שונים, וגם בינם לבין טקסט החיפוש: וגם — כולם חייבים להתקיים.
//   * טווחים (תאריך, שנים, עמודים, גודל): גיליון בלי הערך (בלי תאריך, בלי מספר
//     עמודים) אינו עובר טווח שהופעל. גבול אחד מספיק (מ-, עד-).
//   * מקור: גיליון עובר אם לאחד מעותקיו מקור מהרשימה.
//   * דגלי מצב (מועדפים, הורדו…): כשהם דלוקים הגיליון חייב להתאים.
(function (root) {
  'use strict';

  const A = root.Alonim;

  /** מסננים מרובי ערכים: מערך בצורה הקנונית. */
  const LIST_KEYS = Object.freeze(['parasha', 'event', 'hy', 'lang', 'source', 'circle', 'series']);
  /** טווחים: [מפתח מינימום, מפתח מקסימום, סוג]. */
  const RANGES = Object.freeze([
    ['dateFrom', 'dateTo', 'date'],
    ['hyFrom', 'hyTo', 'year'],
    ['pagesMin', 'pagesMax', 'pages'],
    ['sizeMin', 'sizeMax', 'size'],
  ]);
  /** דגלי כן/לא. */
  const FLAGS = Object.freeze(['multi', 'favorite', 'followed', 'downloaded', 'inList', 'unread', 'isNew', 'sinceVisit', 'hiddenOnly']);
  const NUMERIC_LISTS = new Set(['hy']);

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function cleanList(key, value) {
    const list = Array.isArray(value) ? value : value === undefined || value === null || value === '' || value === false ? [] : [value];
    const out = [];
    for (const raw of list) {
      const v = NUMERIC_LISTS.has(key) ? Number(raw) : String(raw);
      if (NUMERIC_LISTS.has(key) ? !Number.isFinite(v) || v <= 0 : !v) continue;
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }

  /**
   * צורה קנונית: רק מפתחות פעילים. רשימות מערכים (ערך בודד מהצורה הישנה נעטף),
   * מספרים מספריים, תאריכים `YYYY-MM-DD` תקינים בלבד, וטווח הפוך מתהפך.
   */
  function clean(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const out = {};
    for (const key of LIST_KEYS) {
      const list = cleanList(key, raw[key]);
      if (list.length) out[key] = list;
    }
    for (const [lo, hi, kind] of RANGES) {
      let a = raw[lo];
      let b = raw[hi];
      if (kind === 'date') {
        a = DATE_RE.test(String(a || '')) ? String(a) : '';
        b = DATE_RE.test(String(b || '')) ? String(b) : '';
      } else {
        a = Number(a) > 0 ? Number(a) : 0;
        b = Number(b) > 0 ? Number(b) : 0;
      }
      if (a && b && a > b) [a, b] = [b, a];
      if (a) out[lo] = a;
      if (b) out[hi] = b;
    }
    for (const key of FLAGS) if (raw[key] === true) out[key] = true;
    return out;
  }

  /** מספר הערכים הפעילים (ערך ברשימה = אחד; טווח = אחד; דגל = אחד). */
  function count(filters) {
    const f = clean(filters);
    let n = 0;
    for (const key of LIST_KEYS) n += (f[key] || []).length;
    for (const [lo, hi] of RANGES) if (f[lo] || f[hi]) n++;
    for (const key of FLAGS) if (f[key]) n++;
    return n;
  }

  const isEmpty = (filters) => count(filters) === 0;

  /** מוסיף או מסיר [value] ברשימה (החלפת מצב). מחזיר אובייקט חדש. */
  function toggle(filters, key, value) {
    const f = clean(filters);
    if (!LIST_KEYS.includes(key)) {
      if (f[key]) delete f[key];
      else f[key] = true;
      return clean(f);
    }
    const list = (f[key] || []).slice();
    const v = NUMERIC_LISTS.has(key) ? Number(value) : String(value);
    const at = list.indexOf(v);
    if (at >= 0) list.splice(at, 1);
    else list.push(v);
    if (list.length) f[key] = list;
    else delete f[key];
    return f;
  }

  /** מחליף את כל רשימת [key]. */
  function setList(filters, key, values) {
    const f = clean(filters);
    const list = cleanList(key, values);
    if (list.length) f[key] = list;
    else delete f[key];
    return f;
  }

  /** מגדיר טווח (`'date'|'year'|'pages'|'size'`); ערכים ריקים מסירים אותו. */
  function setRange(filters, name, from, to) {
    const [lo, hi] = RANGES.find(([, , kind]) => kind === name);
    const f = clean(filters);
    delete f[lo];
    delete f[hi];
    return clean({ ...f, [lo]: from, [hi]: to });
  }

  /** מסיר מסנן שלם: מפתח רשימה, שם טווח, או דגל. */
  function remove(filters, key, value) {
    const f = clean(filters);
    if (LIST_KEYS.includes(key)) {
      if (value === undefined) {
        delete f[key];
        return f;
      }
      const v = NUMERIC_LISTS.has(key) ? Number(value) : String(value);
      const rest = (f[key] || []).filter((x) => x !== v);
      if (rest.length) f[key] = rest;
      else delete f[key];
      return f;
    }
    const range = RANGES.find(([lo, hi, kind]) => kind === key || lo === key || hi === key);
    if (range) {
      delete f[range[0]];
      delete f[range[1]];
      return f;
    }
    delete f[key];
    return f;
  }

  /**
   * רשימת תגיות להסרה: `{ id, key, value, label }`. [label] ממיר `(key, value)`
   * לטקסט קריא (שמות פרשות וכו'); טווחים וסימנים מקבלים `(rangeName, {from,to})`.
   */
  function chips(filters, label) {
    const f = clean(filters);
    const out = [];
    for (const key of LIST_KEYS) {
      for (const value of f[key] || []) out.push({ id: key + ':' + value, key, value, label: label(key, value) });
    }
    for (const [lo, hi, kind] of RANGES) {
      if (f[lo] || f[hi]) out.push({ id: 'range:' + kind, key: kind, value: { from: f[lo] || '', to: f[hi] || '' }, label: label(kind, { from: f[lo] || '', to: f[hi] || '' }) });
    }
    for (const key of FLAGS) if (f[key]) out.push({ id: 'flag:' + key, key, value: true, label: label(key, true) });
    return out;
  }

  /** האם שני מסננים שקולים (בלי תלות בסדר הערכים). */
  function equals(a, b) {
    const x = clean(a);
    const y = clean(b);
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const key of keys) {
      const p = x[key];
      const q = y[key];
      if (Array.isArray(p) || Array.isArray(q)) {
        const s = new Set(p || []);
        if (!q || !p || s.size !== q.length || !q.every((v) => s.has(v))) return false;
      } else if (p !== q) return false;
    }
    return true;
  }

  const api = { LIST_KEYS, RANGES, FLAGS, clean, count, isEmpty, toggle, setList, setRange, remove, chips, equals };
  A.Filters = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
