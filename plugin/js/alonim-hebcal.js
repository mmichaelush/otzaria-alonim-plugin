// לוח שנה עברי וגימטריה, כפונקציות טהורות (בלי DOM, בלי SDK, בלי תלות ב-Intl).
//
// למה לא `Intl` ... `he-u-ca-hebrew`: הוא כותב "27 בחשוון 5787" (ספרות ולא אותיות),
// אינו מחליף כיוון (עברי ← לועזי), וה-ICU של ה-WebView עשוי להיות חסר או שונה.
// החישוב כאן הוא האלגוריתם החשבוני של הלוח הקבוע (מולד, דחיות, אורך שנה), ונבדק
// מול `Intl` של Node ושל הדפדפן בכל יום בטווח של 150 שנה (test/hebcal.test.js,
// tools/preview/smoke.mjs). תאריך עברי מתחלף בשקיעה; כאן הוא מתחלף בחצות.
(function (root) {
  'use strict';

  const A = (root.Alonim = root.Alonim || {});
  const I18n = A.I18n;
  const GERESH = '׳';
  const GERSHAYIM = '״';
  const DAY = 86400000;

  // ------------------------------------------------------------ גימטריה

  const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const HUNDREDS = ['', 'ק', 'ר', 'ש'];

  /** האותיות של 1..999 בלי פיסוק: ט"ו וט"ז במקום י"ה וי"ו. */
  function letters(n) {
    let rest = n;
    let out = '';
    while (rest >= 400) {
      out += 'ת';
      rest -= 400;
    }
    out += HUNDREDS[Math.floor(rest / 100)];
    rest %= 100;
    if (rest === 15) return out + 'טו';
    if (rest === 16) return out + 'טז';
    return out + TENS[Math.floor(rest / 10)] + ONES[rest % 10];
  }

  /** גרש באות בודדת, גרשיים לפני האות האחרונה. */
  function punctuate(text) {
    if (!text) return '';
    return text.length === 1 ? text + GERESH : text.slice(0, -1) + GERSHAYIM + text.slice(-1);
  }

  /**
   * מספר כאותיות עבריות: 27 ← כ״ז, 15 ← ט״ו, 5 ← ה׳, 5787 ← תשפ״ז.
   * אלפים רק עם `thousands` (ה׳תשפ״ז); בלעדיו שנה נכתבת בלי האלף, כנהוג.
   * מחוץ ל-1..9999 — `''`.
   */
  function numeral(value, options) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1 || n > 9999) return '';
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    if (thousands && options && options.thousands) {
      return ONES[thousands] + GERESH + punctuate(letters(rest));
    }
    if (!rest) return ONES[thousands] + GERESH; // 5000: אין מה לכתוב בלי האלף
    return punctuate(letters(rest));
  }

  /** שנה עברית באותיות: 5787 ← תשפ״ז. */
  const yearLetters = (year, options) => numeral(year, options);

  /** אותיות עבריות ← מספר (תשפ"ז, תשפז, כ״ז); `null` כשאינו מספר. */
  function parseNumeral(text) {
    const s = String(text || '').replace(/["'׳״]/g, '');
    if (!s || !/^[א-ת]+$/.test(s)) return null;
    const finals = { ך: 20, ם: 40, ן: 50, ף: 80, ץ: 90 };
    const alphabet = 'אבגדהוזחטיכלמנסעפצקרשת';
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400];
    let n = 0;
    for (const ch of s) {
      const v = finals[ch] || values[alphabet.indexOf(ch)];
      if (!v) return null;
      n += v;
    }
    return n;
  }

  // ----------------------------------------------------------- לוח שנה

  /** ימים מ-1970 ל-1 בתשרי של השנה, פחות היסט הלוח (ראו `RH`). */
  function elapsedDays(year) {
    const months = Math.floor((235 * year - 234) / 19);
    const parts = 12084 + 13753 * months;
    let day = months * 29 + Math.floor(parts / 25920);
    if ((3 * (day + 1)) % 7 < 3) day++; // גט"ר ד"ו / בט"ו תקפ"ט: ראש השנה לא בימים א, ד, ו
    return day;
  }

  /** דחיות לפי אורך שנה (גטר"ד, בטו"תקפט). */
  function yearDelay(year) {
    const before = elapsedDays(year - 1);
    const now = elapsedDays(year);
    const after = elapsedDays(year + 1);
    if (after - now === 356) return 2;
    if (now - before === 382) return 1;
    return 0;
  }

  /** היסט שמצמיד את הספירה ליום מ-1970 (נבדק: 5787 ← 12.9.2026). */
  const EPOCH_OFFSET = -2092590;

  /** מספר היום (מ-1970) של 1 בתשרי. */
  const roshHashana = (year) => elapsedDays(year) + yearDelay(year) + EPOCH_OFFSET;

  const isLeap = (year) => (7 * year + 1) % 19 < 7;
  const daysInYear = (year) => roshHashana(year + 1) - roshHashana(year);

  const MONTHS = Object.freeze({
    tishri: { he: 'תשרי', en: 'Tishrei', days: 30 },
    cheshvan: { he: 'חשוון', en: 'Cheshvan', days: 29 },
    kislev: { he: 'כסלו', en: 'Kislev', days: 30 },
    tevet: { he: 'טבת', en: 'Tevet', days: 29 },
    shevat: { he: 'שבט', en: 'Shevat', days: 30 },
    adar1: { he: 'אדר א׳', en: 'Adar I', days: 30 },
    adar: { he: 'אדר', en: 'Adar', days: 29 },
    adar2: { he: 'אדר ב׳', en: 'Adar II', days: 29 },
    nisan: { he: 'ניסן', en: 'Nisan', days: 30 },
    iyar: { he: 'אייר', en: 'Iyar', days: 29 },
    sivan: { he: 'סיוון', en: 'Sivan', days: 30 },
    tamuz: { he: 'תמוז', en: 'Tammuz', days: 29 },
    av: { he: 'אב', en: 'Av', days: 30 },
    elul: { he: 'אלול', en: 'Elul', days: 29 },
  });

  /** מזהי החודשים של שנה, לפי סדר השנה (מתשרי), כולל אדר א׳ וב׳ בשנה מעוברת. */
  function monthsOf(year) {
    const adar = isLeap(year) ? ['adar1', 'adar2'] : ['adar'];
    return ['tishri', 'cheshvan', 'kislev', 'tevet', 'shevat', ...adar, 'nisan', 'iyar', 'sivan', 'tamuz', 'av', 'elul'];
  }

  function daysInMonth(year, month) {
    const base = MONTHS[month] ? MONTHS[month].days : 0;
    if (month === 'cheshvan') return daysInYear(year) % 10 === 5 ? 30 : 29;
    if (month === 'kislev') return daysInYear(year) % 10 === 3 ? 29 : 30;
    return base;
  }

  /** מספר יום מ-1970 של תאריך לועזי מקומי (בלי קפיצות שעון קיץ). */
  const dayNumber = (date) => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);

  /** `Date` מקומי בצהריים של מספר יום מ-1970. */
  function dateOfDayNumber(day) {
    const u = new Date(day * DAY);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12);
  }

  /** תאריך לועזי ← `{ year, month, day, leap, months }` עבריים. */
  function fromDate(date) {
    const day = dayNumber(date);
    let year = Math.floor((day - roshHashana(5000)) / 365.2468) + 5000;
    while (roshHashana(year + 1) <= day) year++;
    while (roshHashana(year) > day) year--;
    let left = day - roshHashana(year);
    const months = monthsOf(year);
    for (const month of months) {
      const length = daysInMonth(year, month);
      if (left < length) return { year, month, day: left + 1, leap: isLeap(year) };
      left -= length;
    }
    return { year, month: 'elul', day: 29, leap: isLeap(year) };
  }

  /** תאריך עברי ← `Date` מקומי; `null` אם החודש או היום אינם קיימים בשנה. */
  function toDate(year, month, day) {
    const months = monthsOf(year);
    const at = months.indexOf(month);
    if (at < 0 || !Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;
    let offset = 0;
    for (let i = 0; i < at; i++) offset += daysInMonth(year, months[i]);
    return dateOfDayNumber(roshHashana(year) + offset + day - 1);
  }

  // ----------------------------------------------------------- עיצוב

  const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const GREGORIAN_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  const isHebrewUi = (lang) => !lang || lang === 'he';

  function monthName(month, lang) {
    const m = MONTHS[month];
    if (!m) return '';
    return isHebrewUi(lang) ? m.he : m.en;
  }

  /** שם היום: "שבת" או "יום שלישי". */
  function weekdayName(date, lang) {
    const name = WEEKDAYS[date.getDay()];
    if (isHebrewUi(lang)) return date.getDay() === 6 ? name : 'יום ' + name;
    try {
      return new Intl.DateTimeFormat(I18n && I18n.locale ? I18n.locale() : 'en', { weekday: 'long' }).format(date);
    } catch (error) {
      return name;
    }
  }

  /** "כ״ז בחשוון תשפ״ז" (עברית) או "27 Cheshvan 5787" (שפות אחרות). */
  function formatHebrew(date, options) {
    const o = options || {};
    const h = fromDate(date);
    const lang = o.lang;
    const withYear = o.year !== false;
    if (isHebrewUi(lang)) {
      const text = numeral(h.day) + ' ב' + MONTHS[h.month].he;
      return withYear ? text + ' ' + yearLetters(h.year, { thousands: o.thousands }) : text;
    }
    const text = h.day + ' ' + MONTHS[h.month].en;
    return withYear ? text + ' ' + h.year : text;
  }

  /** "7 בנובמבר 2026" (עברית) / "7 November 2026"; `short`: 7.11.2026. */
  function formatGregorian(date, options) {
    const o = options || {};
    const d = date.getDate();
    const m = date.getMonth();
    const y = date.getFullYear();
    if (o.short) return d + '.' + (m + 1) + (o.year === false ? '' : '.' + y);
    if (isHebrewUi(o.lang)) return d + ' ב' + GREGORIAN_MONTHS[m] + (o.year === false ? '' : ' ' + y);
    try {
      const locale = I18n && I18n.locale ? I18n.locale() : 'en';
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: o.year === false ? undefined : 'numeric' }).format(date);
    } catch (error) {
      return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
  }

  /**
   * שורת תאריך מלאה: "שבת, כ״ז בחשוון תשפ״ז · 7 בנובמבר 2026".
   * `weekday`: להוסיף שם יום; `hebrew`/`gregorian`: להשמיט (כברירת מחדל שניהם);
   * `short`: לועזי מקוצר; `year: false`: בלי שנה (בתוך שנה שכבר ידועה).
   */
  function format(date, options) {
    const o = options || {};
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const hebrew = o.hebrew === false ? '' : formatHebrew(date, o);
    const gregorian = o.gregorian === false ? '' : formatGregorian(date, o);
    const day = o.weekday ? weekdayName(date, o.lang) : '';
    const body = [hebrew, gregorian].filter(Boolean).join(' · ');
    return day ? (body ? day + ', ' + body : day) : body;
  }

  const api = {
    numeral,
    yearLetters,
    parseNumeral,
    isLeap,
    daysInYear,
    daysInMonth,
    monthsOf,
    monthName,
    roshHashana,
    fromDate,
    toDate,
    dayNumber,
    dateOfDayNumber,
    weekdayName,
    formatHebrew,
    formatGregorian,
    format,
    MONTHS,
    GERESH,
    GERSHAYIM,
  };
  A.HebCal = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
