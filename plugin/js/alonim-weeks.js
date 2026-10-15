// לוח השבועות: שורות `weeks.json` (שבתות, שבתות מיוחדות וחגים באמצע השבוע) כמודל
// תצוגה אחד, וההכרעות שמסך "השבוע" נשען עליהן: מה "השבוע" היום, איפה נמצא תאריך,
// ומה היחס בין שבוע מוצג לשבוע הנוכחי. פונקציות טהורות (בלי DOM), נבדקות מול
// `weeks.json` האמיתי (test/weeks.test.js).
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;
  const I18n = A.I18n;
  const t = (text, vars) => I18n.t(text, vars);

  /** חגים שבהם אין "פרשת השבוע" בחוץ לארץ, ובארץ ישראל לעיתים כן (יום טוב שני של גלויות). */
  const CHAG_EVENTS = Object.freeze(['rosh-hashana', 'yom-kippur', 'sukkot', 'shemini-atzeret', 'simchat-torah', 'pesach', 'shavuot']);

  /**
   * מועדים קטנים: ראש חודש, צומות וחול המועד. הם שורות בלוח (אפשר לבחור אותם),
   * אבל "השבוע" אינו נעצר עליהם: היום שלפני שבת רגילה מציג את השבת.
   */
  const MINOR_EVENTS = Object.freeze([
    'rosh-chodesh',
    'tzom-gedaliah',
    'asara-btevet',
    'taanit-esther',
    'shushan-purim',
    'shiva-asar-btammuz',
    'chol-hamoed-sukkot',
    'chol-hamoed-pesach',
    'hoshana-raba',
    'shvii-shel-pesach',
  ]);

  /** סוגי שורה: פרשה רגילה, שבת מיוחדת (או שבת חג), וחג באמצע השבוע. */
  const KINDS = Object.freeze({ shabbat: 'shabbat', special: 'special', holiday: 'holiday' });

  const DAY_MS = 86400000;

  const slugsOf = (list) => (Array.isArray(list) ? list.filter(Boolean) : []);

  /**
   * שורת לוח ← מודל תצוגה, לפי העדפת ארץ ישראל / חוץ לארץ ([diaspora]).
   * בשבת שבה בחוץ לארץ חג ובארץ קוראים פרשה (למשל שבועות שחל בשבת), בארץ זו שבת
   * רגילה: האירוע נשמט.
   */
  function view(row, options) {
    const diaspora = Boolean(options && options.diaspora);
    const isShabbat = row.shabbat !== false;
    const dSlugs = slugsOf(row.parasha);
    const ilSlugs = Array.isArray(row.parashaIL) ? slugsOf(row.parashaIL) : dSlugs;
    const parasha = isShabbat ? (diaspora ? dSlugs : ilSlugs) : [];
    let event = row.event || null;
    // כל האירועים של היום; המשניים (שבת מברכים, עשרת ימי תשובה) רק ב-`events`.
    const all = Array.isArray(row.events) ? row.events.filter(Boolean) : event ? [event] : [];
    if (isShabbat && !diaspora && event && CHAG_EVENTS.includes(event) && !dSlugs.length && ilSlugs.length) event = null;
    let kind = KINDS.shabbat;
    if (!isShabbat) kind = KINDS.holiday;
    else if (event || !parasha.length) kind = KINDS.special;
    const eventLabel = event ? Core.eventName(event) : '';
    const parashaLabel = parasha.length ? Core.parashaLabel(parasha) : '';
    let title;
    // בשורת חג בעברית התווית מהקטלוג גוברת ("ראש חודש חשוון" נושא את החודש).
    if (kind === KINDS.holiday) title = (row.label && I18n.language === 'he' ? row.label : eventLabel) || eventLabel;
    else if (parashaLabel) title = t('פרשת {name}', { name: parashaLabel });
    else title = eventLabel || t('שבת');
    return {
      row,
      date: row.date,
      hy: row.hy || 0,
      kind,
      shabbat: isShabbat,
      parasha,
      event,
      eventLabel,
      secondary: all.filter((e) => e !== (row.event || null)),
      /** תאריך עברי מוכן מהקטלוג (אם יש); ריק = לחשב. */
      hebrew: typeof row.hebrew === 'string' ? row.hebrew : '',
      parashaLabel,
      title,
      /** השורה נגזרה מהגיליונות עצמם (שנה שאין לה לוח), לא מ-`weeks.json`. */
      derived: Boolean(row.derived),
      day: Core.parseYmd(row.date),
    };
  }

  /** שורות ← תצוגות (ממוינות לפי תאריך, יום אחד = שורה אחת). */
  function build(rows, options) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.date && !seen.has(row.date + '|' + row.shabbat) && seen.add(row.date + '|' + row.shabbat))
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.shabbat === false ? -1 : 1))
      .map((row, i) => ({ ...view(row, options), i }));
  }

  /** `YYYY-MM-DD` ← מספר ימים (להפרשים). */
  const dayNumber = (text) => {
    const d = Core.parseYmd(text);
    return d ? Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS) : 0;
  };

  /**
   * "השבוע" לפי היום: השורה הראשונה שתאריכה מהיום והלאה (שבת, או חג שקודם לה;
   * מועד קטן — ראש חודש, צום, חול המועד — אינו נחשב).
   * מחזיר `{ index, status }`: `ok`; `after` — היום אחרי סוף הלוח (נבחרת האחרונה);
   * `before` — לפני תחילתו (נבחרת הראשונה); `empty` — אין שורות.
   */
  function current(views, todayYmd) {
    if (!views.length) return { index: -1, status: 'empty' };
    const i = views.findIndex((v) => v.date >= todayYmd && !(v.kind === KINDS.holiday && MINOR_EVENTS.includes(v.event)));
    if (i < 0) return { index: views.length - 1, status: 'after' };
    const gap = dayNumber(views[i].date) - dayNumber(todayYmd);
    return { index: i, status: i === 0 && gap > 8 ? 'before' : 'ok' };
  }

  /** האינדקס של תאריך: שורה בדיוק בתאריך; אחרת השבת (לא חג) הקרובה אחריו; אחרת האחרונה. */
  function indexForDate(views, ymd) {
    if (!views.length) return -1;
    const exact = views.findIndex((v) => v.date === ymd);
    if (exact >= 0) return exact;
    const next = views.findIndex((v) => v.shabbat && v.date >= ymd);
    return next >= 0 ? next : views.length - 1;
  }

  /**
   * היחס של השבוע המוצג ([index]) לשבוע הנוכחי ([currentIndex]):
   * `{ kind: 'current'|'future'|'past', weeks }`, כשהמרחק במספר שבועות (לפחות 1).
   */
  function relation(views, index, currentIndex) {
    if (index < 0 || currentIndex < 0 || index === currentIndex) return { kind: 'current', weeks: 0 };
    const days = dayNumber(views[index].date) - dayNumber(views[currentIndex].date);
    const weeks = Math.max(1, Math.round(Math.abs(days) / 7));
    return { kind: days > 0 ? 'future' : 'past', weeks };
  }

  /** השנים שבלוח, מהחדשה לישנה, עם מספר השורות. */
  function years(views) {
    const counts = new Map();
    for (const v of views) if (v.hy) counts.set(v.hy, (counts.get(v.hy) || 0) + 1);
    return [...counts].map(([hy, count]) => ({ hy, count })).sort((a, b) => b.hy - a.hy);
  }

  const ofYear = (views, hy) => views.filter((v) => v.hy === hy);

  /** השורה שעליה מצביע `weekDate` (תאריך מדויק), או -1. */
  const indexOfDate = (views, ymd) => views.findIndex((v) => v.date === ymd);

  /** התאריך להצגה: תאריך השורה (החג מתוארך ביום שבו הוא מתחיל, חנוכה בערב הנר הראשון). */
  const displayDay = (v) => v.day;

  const api = { CHAG_EVENTS, MINOR_EVENTS, KINDS, view, build, current, indexForDate, indexOfDate, relation, years, ofYear, displayDay };
  A.Weeks = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
