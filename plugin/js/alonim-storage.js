// חישובי אחסון (טהורים): קבצים שהורדו ממוינים לפי תאריך ומקובצים לחודשים, ותכנית
// ניקוי של קבצים ישנים שאינה נוגעת במה שהמשתמש שמר במפורש (מועדפים, אוספים).
// ה-UI ב-`alonim-ui-storage.js`; המחיקה עצמה ב-`Files.deleteDownloaded`.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;

  const DAY_MS = 86400000;

  /**
   * שורות מהמפה `files.disk` (מזהה קצר ← רשומה): `{ fragment, entry, ts, size }`,
   * מהחדש לישן. `ts` — זמן השינוי באלפיות שנייה, או 0 כשאינו ידוע.
   */
  function rows(disk) {
    const out = [];
    for (const [fragment, entry] of disk) {
      const ts = entry.modified ? Date.parse(entry.modified) || 0 : 0;
      out.push({ fragment, entry, ts, size: entry.size || 0 });
    }
    return out.sort((a, b) => b.ts - a.ts || (a.fragment < b.fragment ? -1 : 1));
  }

  /** `YYYY-MM` לפי הזמן המקומי; `''` כשהזמן אינו ידוע. */
  function monthKey(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /** שורות (כבר ממוינות מהחדש לישן) מקובצות לחודשים: `[{ key, rows, bytes }]`. */
  function groupByMonth(list) {
    const groups = [];
    for (const row of list) {
      const key = monthKey(row.ts);
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) {
        group = { key, rows: [], bytes: 0 };
        groups.push(group);
      }
      group.rows.push(row);
      group.bytes += row.size;
    }
    return groups;
  }

  /**
   * המזהים הקצרים שאין למחוק: גיליונות מועדפים או באוסף כלשהו. נגזר ממזהי הגיליון
   * שנשמרו (לא תלוי בקטלוג שנטען), וכולל מזהים קודמים (`previousIds`) של אותם גיליונות.
   */
  function protectedFragments(ids, previousIdsOf) {
    const out = new Set();
    for (const id of ids) {
      out.add(Core.idFragment(id));
      for (const old of (previousIdsOf && previousIdsOf(id)) || []) out.add(Core.idFragment(old));
    }
    return out;
  }

  /**
   * תכנית ניקוי: קבצים ישנים מ-[days] ימים שאינם מוגנים. קובץ בלי זמן ידוע לא
   * נמחק (אי אפשר לדעת את גילו). מחזיר `{ remove, keep, protectedRows, unknownAge, bytes }`.
   */
  function cleanupPlan(list, options) {
    const o = options || {};
    const cutoff = (o.now || Date.now()) - Math.max(0, o.days || 0) * DAY_MS;
    const guard = o.protectedFragments || new Set();
    const plan = { remove: [], keep: [], protectedRows: [], unknownAge: [], bytes: 0 };
    for (const row of list) {
      if (!row.ts) plan.unknownAge.push(row);
      else if (row.ts >= cutoff) plan.keep.push(row);
      else if (guard.has(row.fragment)) plan.protectedRows.push(row);
      else {
        plan.remove.push(row);
        plan.bytes += row.size;
      }
    }
    return plan;
  }

  A.Storage = { rows, monthKey, groupByMonth, protectedFragments, cleanupPlan };
  if (typeof module === 'object' && module.exports) module.exports = A.Storage;
})(typeof self !== 'undefined' ? self : globalThis);
