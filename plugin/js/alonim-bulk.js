// פעולות על כמה גיליונות יחד (מצב בחירה, ייצוא רשימה): הורדה, מועדפים, נקרא,
// הסתרת סדרות, העתקה כטקסט. כל פעולה מקבלת את ה-`app` ורשימת גיליונות, ומחזירה
// תוצאה שאפשר לבדוק; ההודעות למשתמש נשלחות דרך `app.toast`.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;
  const I18n = A.I18n;
  const t = (text, vars) => I18n.t(text, vars);

  /** מעל כמה גיליונות לא קוראים כתובות אתר לייצוא (כל כתובת = קריאת קובץ שרד). */
  const MAX_LINKED_EXPORT = 150;

  /** שורת טקסט לגיליון: "סדרה · שבוע · שנה (תאריך) — כתובת". */
  function exportLine(item, url) {
    const week = Core.weekLabel(item);
    const parts = [item.seriesTitle || item.title, week, item.hy ? Core.hyLetters(item.hy) : ''].filter(Boolean);
    let line = parts.join(' · ');
    if (item.date) line += ' (' + Core.dateText(item.date, { short: true }) + ')';
    return url ? line + ' — ' + url : line;
  }

  /**
   * הטקסט של רשימה: שורה לכל גיליון, עם כתובת דף המקור כשאפשר. מעל
   * `MAX_LINKED_EXPORT` גיליונות — בלי כתובות. מחזיר `{ text, linked }`.
   */
  async function exportText(app, items) {
    const linked = items.length <= MAX_LINKED_EXPORT;
    const lines = [];
    for (const item of items) {
      let url = '';
      if (linked) {
        const full = await app.full(item);
        const asset = full && app.pickSiteAsset(full);
        url = (asset && (asset.page || asset.url)) || '';
      }
      lines.push(exportLine(item, url));
    }
    return { text: lines.join('\n'), linked };
  }

  /** מוסיף להורדה את מה שעדיין לא הורד. מחזיר כמה נוספו. */
  async function download(app, items) {
    if (!app.files.hasFolder) {
      app.emit('need-folder', { then: () => download(app, items) });
      return 0;
    }
    let n = 0;
    for (const item of items) {
      if (app.files.isDownloaded(item)) continue;
      const job = await app.queueSave(item);
      if (job) n++;
    }
    app.toast(n ? t('{n} גיליונות נוספו להורדה', { n }) : t('כל הגיליונות שנבחרו כבר הורדו'));
    return n;
  }

  /** מועדף / לא מועדף לכולם. מחזיר כמה השתנו. */
  function favorite(app, items, on) {
    let n = 0;
    for (const item of items) {
      if (app.state.isFavorite(item.id) === on) continue;
      app.state.setFavorite(item, on);
      n++;
    }
    app.toast(on ? t('{n} גיליונות נוספו למועדפים', { n }) : t('{n} גיליונות הוסרו מהמועדפים', { n }));
    return n;
  }

  /** נקרא / לא נקרא לכולם. מחזיר כמה השתנו. */
  function read(app, items, on) {
    const changed = [];
    for (const item of items) {
      if (app.state.isRead(item.id) === on) continue;
      app.state.markRead(item, on);
      if (on) app.state.logEvent('read', item);
      changed.push(item);
    }
    const n = changed.length;
    app.toast(on ? t('{n} גיליונות סומנו כנקראו', { n }) : t('{n} גיליונות סומנו כלא נקראו', { n }), {
      action: n ? { label: t('ביטול הפעולה'), run: () => changed.forEach((item) => app.state.markRead(item, !on)) } : undefined,
    });
    return n;
  }

  /** כלל הסתרה לכל סדרה (פעם אחת לסדרה), עם ביטול אחד לכולן. */
  function hideSeries(app, items) {
    const seen = new Set();
    const rules = [];
    for (const item of items) {
      if (seen.has(item.series)) continue;
      seen.add(item.series);
      const rule = app.state.addRule({ action: 'hide', field: 'series', value: item.series, label: item.seriesTitle || item.title });
      if (rule) rules.push(rule);
    }
    if (rules.length) {
      app.toast(t('{n} סדרות הוסתרו', { n: rules.length }), { action: { label: t('ביטול הפעולה'), run: () => rules.forEach((r) => app.state.removeRule(r.id)) } });
    }
    return rules.length;
  }

  A.Bulk = { exportLine, exportText, download, favorite, read, hideSeries, MAX_LINKED_EXPORT };
  if (typeof module === 'object' && module.exports) module.exports = A.Bulk;
})(typeof self !== 'undefined' ? self : globalThis);
