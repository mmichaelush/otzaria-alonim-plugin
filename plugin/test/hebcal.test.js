'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');

const A = loadPlugin();
const H = A.HebCal;
const local = (y, m, d) => new Date(y, m - 1, d, 12);

test('gematria: מספרים כאותיות עם גרש וגרשיים', () => {
  const cases = [
    [1, 'א׳'],
    [5, 'ה׳'],
    [9, 'ט׳'],
    [10, 'י׳'],
    [11, 'י״א'],
    [14, 'י״ד'],
    [15, 'ט״ו'],
    [16, 'ט״ז'],
    [17, 'י״ז'],
    [20, 'כ׳'],
    [27, 'כ״ז'],
    [29, 'כ״ט'],
    [30, 'ל׳'],
    [100, 'ק׳'],
    [115, 'קט״ו'],
    [116, 'קט״ז'],
    [200, 'ר׳'],
    [300, 'ש׳'],
    [400, 'ת׳'],
    [500, 'ת״ק'],
    [600, 'ת״ר'],
    [700, 'ת״ש'],
    [800, 'ת״ת'],
    [900, 'תת״ק'],
    [999, 'תתקצ״ט'],
    [345, 'שמ״ה'],
    [770, 'תש״ע'],
  ];
  for (const [n, expected] of cases) assert.equal(H.numeral(n), expected, String(n));
});

test('gematria: ט״ו וט״ז במקום י״ה וי״ו, בכל מאה', () => {
  for (const hundreds of [0, 100, 200, 300, 400, 700]) {
    for (const [tail, forbidden] of [
      [15, 'יה'],
      [16, 'יו'],
    ]) {
      const text = H.numeral(hundreds + tail).replace(/[׳״]/g, '');
      assert.ok(!text.endsWith(forbidden), hundreds + tail + ' ' + text);
      assert.ok(text.endsWith(tail === 15 ? 'טו' : 'טז'), text);
    }
  }
});

test('gematria: שנים 5780 עד 5800 (בלי אלפים), ועם אלפים', () => {
  const expected = {
    5780: 'תש״פ',
    5781: 'תשפ״א',
    5782: 'תשפ״ב',
    5783: 'תשפ״ג',
    5784: 'תשפ״ד',
    5785: 'תשפ״ה',
    5786: 'תשפ״ו',
    5787: 'תשפ״ז',
    5788: 'תשפ״ח',
    5789: 'תשפ״ט',
    5790: 'תש״צ',
    5791: 'תשצ״א',
    5792: 'תשצ״ב',
    5793: 'תשצ״ג',
    5794: 'תשצ״ד',
    5795: 'תשצ״ה',
    5796: 'תשצ״ו',
    5797: 'תשצ״ז',
    5798: 'תשצ״ח',
    5799: 'תשצ״ט',
    5800: 'ת״ת',
  };
  for (const [year, letters] of Object.entries(expected)) {
    assert.equal(H.yearLetters(Number(year)), letters, year);
    assert.equal(H.yearLetters(Number(year), { thousands: true }), 'ה׳' + letters, year);
  }
  assert.equal(H.numeral(5000), 'ה׳');
  assert.equal(H.numeral(5000, { thousands: true }), 'ה׳');
  assert.equal(H.numeral(6001, { thousands: true }), 'ו׳א׳');
});

test('gematria: ערכים שאינם מספר תקין', () => {
  for (const bad of [0, -3, NaN, null, undefined, 'x', 10000])
    assert.equal(H.numeral(bad), '', String(bad));
});

test('gematria: מעגל שלם (numeral ← parseNumeral) לכל 1..999', () => {
  for (let n = 1; n <= 999; n++) assert.equal(H.parseNumeral(H.numeral(n)), n, String(n));
  assert.equal(H.parseNumeral('תשפז'), 787);
  assert.equal(H.parseNumeral('תשפ"ז'), 787);
  assert.equal(H.parseNumeral('abc'), null);
});

test('לוח: שנה מעוברת לפי מחזור 19 (שנות ג, ו, ח, יא, יד, יז, יט)', () => {
  const leap = [];
  for (let y = 5779; y <= 5797; y++) if (H.isLeap(y)) leap.push(y);
  assert.deepEqual(leap, [5779, 5782, 5784, 5787, 5790, 5793, 5795]);
  assert.equal(H.isLeap(5786), false);
  assert.equal(H.monthsOf(5784).length, 13);
  assert.equal(H.monthsOf(5786).length, 12);
  assert.deepEqual(H.monthsOf(5784).slice(5, 7), ['adar1', 'adar2']);
  assert.deepEqual(H.monthsOf(5786).slice(5, 6), ['adar']);
});

test('לוח: תאריכי עוגן ידועים', () => {
  const at = (y, m, d) => {
    const h = H.fromDate(local(y, m, d));
    return `${h.day} ${h.month} ${h.year}`;
  };
  assert.equal(at(2026, 9, 12), '1 tishri 5787'); // ראש השנה תשפ״ז
  assert.equal(at(2026, 9, 21), '10 tishri 5787'); // יום כיפור
  assert.equal(at(2026, 11, 7), '27 cheshvan 5787');
  assert.equal(at(2026, 12, 4), '24 kislev 5787'); // ערב חנוכה (השורה בקטלוג מתוארכת כך)
  assert.equal(at(2027, 3, 23), '14 adar2 5787'); // פורים (5787 מעוברת)
  assert.equal(at(2027, 2, 21), '14 adar1 5787'); // פורים קטן
  assert.equal(at(2027, 4, 22), '15 nisan 5787'); // פסח
  assert.equal(at(2024, 2, 23), '14 adar1 5784'); // פורים קטן
  assert.equal(at(2024, 3, 24), '14 adar2 5784'); // פורים
  assert.equal(at(2025, 9, 23), '1 tishri 5786');
  assert.equal(at(2027, 10, 2), '1 tishri 5788');
});

test('לוח: עיצוב עברי מלא, כמו שכותבים', () => {
  const f = (y, m, d, o) => H.format(local(y, m, d), o);
  assert.equal(f(2026, 11, 7, { weekday: true }), 'שבת, כ״ז בחשוון תשפ״ז · 7 בנובמבר 2026');
  assert.equal(f(2026, 9, 12), 'א׳ בתשרי תשפ״ז · 12 בספטמבר 2026');
  assert.equal(f(2027, 3, 23, { weekday: true }), 'יום שלישי, י״ד באדר ב׳ תשפ״ז · 23 במרץ 2027');
  assert.equal(f(2024, 2, 23), 'י״ד באדר א׳ תשפ״ד · 23 בפברואר 2024');
  assert.equal(f(2026, 3, 3), 'י״ד באדר תשפ״ו · 3 במרץ 2026'); // שנה פשוטה: אדר בלי א׳/ב׳
  assert.equal(f(2024, 3, 24), 'י״ד באדר ב׳ תשפ״ד · 24 במרץ 2024');
  assert.equal(f(2027, 4, 22, { gregorian: false }), 'ט״ו בניסן תשפ״ז');
  assert.equal(f(2026, 11, 7, { hebrew: false, short: true }), '7.11.2026');
  assert.equal(f(2026, 11, 7, { year: false, weekday: true }), 'שבת, כ״ז בחשוון · 7 בנובמבר');
  assert.equal(f(2026, 11, 7, { hebrew: false, gregorian: false, weekday: true }), 'שבת');
  // ט״ו וט״ז בחודש
  assert.equal(H.formatHebrew(local(2027, 4, 22)), 'ט״ו בניסן תשפ״ז');
  assert.equal(H.formatHebrew(local(2027, 4, 23)), 'ט״ז בניסן תשפ״ז');
  assert.equal(H.format(new Date(NaN)), '');
});

test('לוח: אנגלית — שמות חודשים לטיניים וספרות', () => {
  A.I18n.configure('en');
  try {
    assert.equal(H.formatHebrew(local(2026, 11, 7), { lang: 'en' }), '27 Cheshvan 5787');
    assert.equal(H.formatHebrew(local(2024, 3, 24), { lang: 'en' }), '14 Adar II 5784');
    assert.match(
      H.format(local(2026, 11, 7), { lang: 'en', weekday: true }),
      /^Saturday, 27 Cheshvan 5787 · /,
    );
  } finally {
    A.I18n.configure('he');
  }
});

test('לוח: toDate הוא ההפוך של fromDate, ודוחה תאריכים שאינם קיימים', () => {
  assert.equal(H.toDate(5787, 'cheshvan', 27).getDate(), 7);
  assert.equal(H.toDate(5786, 'adar1', 1), null, 'אדר א׳ אינו קיים בשנה פשוטה');
  assert.equal(H.toDate(5784, 'adar', 1), null, 'אדר רגיל אינו קיים בשנה מעוברת');
  assert.equal(H.toDate(5787, 'tevet', 30), null);
  assert.equal(H.toDate(5787, 'tishri', 0), null);
  assert.equal(H.toDate(5787, 'nope', 1), null);
});

test('לוח: אורך שנה תקין (353/354/355 או 383/384/385) ואורך חודשים מסתכם אליו', () => {
  for (let y = 5700; y <= 5900; y++) {
    const length = H.daysInYear(y);
    assert.ok(
      H.isLeap(y) ? [383, 384, 385].includes(length) : [353, 354, 355].includes(length),
      `${y}: ${length}`,
    );
    const sum = H.monthsOf(y).reduce((n, m) => n + H.daysInMonth(y, m), 0);
    assert.equal(sum, length, String(y));
  }
});

test('לוח: מעגל שלם לכל יום מ-1900 עד 2100', () => {
  const start = local(1900, 1, 1);
  let previous = null;
  for (let i = 0; i < 73000; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12);
    const h = H.fromDate(date);
    const back = H.toDate(h.year, h.month, h.day);
    assert.ok(back && H.dayNumber(back) === H.dayNumber(date), date.toDateString());
    if (previous) {
      // יום אחרי יום: היום עולה ב-1, או שהחודש מתחלף ביום 1.
      const next =
        h.day === previous.day + 1 && h.month === previous.month && h.year === previous.year;
      const rollover = h.day === 1;
      assert.ok(next || rollover, date.toDateString());
    }
    previous = h;
  }
});

// Intl הוא האורקל: שמות החודשים באנגלית, ללא תלות בכתיב עברי.
const INTL_MONTHS = {
  Tishri: 'tishri',
  Heshvan: 'cheshvan',
  Cheshvan: 'cheshvan',
  Kislev: 'kislev',
  Tevet: 'tevet',
  Shevat: 'shevat',
  'Adar I': 'adar1',
  Adar: 'adar',
  'Adar II': 'adar2',
  Nisan: 'nisan',
  Iyar: 'iyar',
  Sivan: 'sivan',
  Tamuz: 'tamuz',
  Tammuz: 'tamuz',
  Av: 'av',
  Elul: 'elul',
};

test('לוח: תואם ל-Intl (en-u-ca-hebrew) בכל יום מ-1950 עד 2100', (t) => {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-u-ca-hebrew', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    formatter.formatToParts(new Date(0));
  } catch (error) {
    return t.skip('Intl בלי לוח עברי');
  }
  let checked = 0;
  for (let day = H.dayNumber(local(1950, 1, 1)); day <= H.dayNumber(local(2100, 12, 31)); day++) {
    const parts = formatter.formatToParts(new Date(day * 86400000 + 43200000));
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const date = H.dateOfDayNumber(day);
    const h = H.fromDate(date);
    const year = Number(get('relatedYear') || get('year'));
    assert.deepEqual(
      { year: h.year, month: h.month, day: h.day },
      { year, month: INTL_MONTHS[get('month')], day: Number(get('day')) },
      date.toDateString(),
    );
    checked++;
  }
  assert.ok(checked > 54000);
});
