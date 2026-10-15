'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPlugin } = require('./helpers/load');

const A = loadPlugin();
const { Weeks, HebCal, Core } = A;

/** צילום של `weeks.json` האמיתי של הקטלוג (5786-5788). */
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weeks-real.json'), 'utf8'));
const il = Weeks.build(rows, { diaspora: false });
const diaspora = Weeks.build(rows, { diaspora: true });
const at = (views, date) => views.find((v) => v.date === date);

test('weeks: כל שבת בלוח היא יום שבת, וה-hy שבקטלוג זהה לחישוב של התוסף', () => {
  assert.ok(rows.length > 100);
  for (const row of rows) {
    const date = Core.parseYmd(row.date);
    if (row.shabbat !== false) assert.equal(date.getDay(), 6, row.date);
    assert.equal(HebCal.fromDate(date).year, row.hy, row.date + ' hy');
  }
});

test('weeks: תאריכי החגים בלוח הקטלוג תואמים לתאריך העברי המחושב', () => {
  const expected = {
    'rosh-hashana': ['tishri', 1],
    'yom-kippur': ['tishri', 10],
    sukkot: ['tishri', 15],
    'shemini-atzeret': ['tishri', 22],
    chanukah: ['kislev', 24], // השורה מתוארכת בערב הנר הראשון
    'tu-bishvat': ['shevat', 15],
    pesach: ['nisan', 15],
    'lag-baomer': ['iyar', 18],
    shavuot: ['sivan', 6],
    'tisha-bav': ['av', 9],
  };
  let checked = 0;
  for (const row of rows.filter((r) => r.shabbat === false)) {
    const h = HebCal.fromDate(Core.parseYmd(row.date));
    if (row.event === 'purim') {
      assert.equal(h.day, 14, row.date);
      assert.ok(h.month === 'adar' || h.month === 'adar2', row.date);
      checked++;
    } else if (expected[row.event]) {
      assert.deepEqual([h.month, h.day], expected[row.event], row.event + ' ' + row.date);
      checked++;
    }
  }
  assert.ok(checked >= 15, 'נבדקו ' + checked);
});

test('weeks: סוגי שורות ושמות', () => {
  const noach = at(il, '2026-10-17');
  assert.equal(noach.kind, 'shabbat');
  assert.equal(noach.title, 'פרשת נח');
  const shekalim = at(il, '2027-03-06');
  assert.equal(shekalim.kind, 'special');
  assert.equal(shekalim.title, 'פרשת ויקהל');
  assert.equal(shekalim.eventLabel, 'שבת שקלים');
  const yk = at(il, '2026-09-21');
  assert.equal(yk.kind, 'holiday');
  assert.equal(yk.title, 'יום כיפור');
  const rh = at(il, '2026-09-12');
  assert.equal(rh.kind, 'special', 'ראש השנה שחל בשבת: שבת עם אירוע, בלי פרשה');
  assert.equal(rh.title, 'ראש השנה');
  const double = at(il, '2027-07-31');
  assert.equal(double.title, 'פרשת מטות־מסעי');
  assert.equal(at(il, '2026-12-05').eventLabel, 'חנוכה');
});

test('weeks: ארץ ישראל מול חוץ לארץ (שבועות בשבת, 2027-06-12)', () => {
  const inIsrael = at(il, '2027-06-12');
  assert.equal(inIsrael.title, 'פרשת נשא');
  assert.equal(inIsrael.kind, 'shabbat');
  assert.equal(inIsrael.event, null, 'בארץ זו שבת רגילה');
  const abroad = at(diaspora, '2027-06-12');
  assert.equal(abroad.title, 'שבועות');
  assert.equal(abroad.kind, 'special');
  // אחריה הפרשות מוסטות: נשא בארץ בשבת הזו, ובחו"ל בשבוע שאחריה.
  assert.equal(at(il, '2027-06-19').title, 'פרשת בהעלותך');
  assert.equal(at(diaspora, '2027-06-19').title, 'פרשת נשא');
  // שבתות שבהן אין הבדל זהות בשני המצבים.
  assert.equal(at(il, '2026-10-17').title, at(diaspora, '2026-10-17').title);
});

test('weeks: שורות חג באמצע השבוע נשארות שורות נפרדות', () => {
  const holidays = il.filter((v) => v.kind === 'holiday');
  assert.ok(holidays.length >= 14);
  assert.ok(holidays.every((v) => !v.shabbat && v.parasha.length === 0));
  assert.ok(holidays.some((v) => v.event === 'purim'));
  assert.ok(holidays.some((v) => v.event === 'pesach'));
});

test('weeks.current: השבת הקרובה לפי היום, או החג שקודם לה', () => {
  const on = (day) => il[Weeks.current(il, day).index];
  assert.equal(on('2026-10-15').date, '2026-10-17', 'חמישי: שבת נח');
  assert.equal(on('2026-10-17').date, '2026-10-17', 'בשבת עצמה: השבת הזו');
  assert.equal(on('2026-10-18').date, '2026-10-24', 'ראשון: השבת הבאה');
  assert.equal(on('2026-09-20').date, '2026-09-21', 'ראשון לפני יום כיפור: החג שקודם לשבת');
  assert.equal(on('2026-09-22').date, '2026-09-26', 'אחרי יום כיפור: שבת סוכות');
  assert.equal(on('2026-12-03').date, '2026-12-04', 'חנוכה: שורת החג קודמת לשבת');
  assert.equal(on('2026-12-05').date, '2026-12-05');
  assert.equal(Weeks.current(il, '2026-10-15').status, 'ok');
});

test('weeks.current: מחוץ לטווח הלוח', () => {
  assert.deepEqual(Weeks.current(il, '2031-01-01'), { index: il.length - 1, status: 'after' });
  assert.equal(Weeks.current(il, '2020-01-01').status, 'before');
  assert.equal(Weeks.current(il, '2020-01-01').index, 0);
  assert.deepEqual(Weeks.current([], '2026-10-15'), { index: -1, status: 'empty' });
});

test('weeks.indexForDate: תאריך מדויק, או השבת הבאה (לא חג)', () => {
  assert.equal(il[Weeks.indexForDate(il, '2026-10-17')].date, '2026-10-17');
  assert.equal(il[Weeks.indexForDate(il, '2026-10-20')].date, '2026-10-24');
  assert.equal(il[Weeks.indexForDate(il, '2027-03-21')].date, '2027-03-27', 'ביום ראשון שאחרי פורים — לא קופצים לחג שכבר עבר');
  assert.equal(il[Weeks.indexForDate(il, '2027-03-23')].date, '2027-03-23', 'פורים עצמו');
  assert.equal(il[Weeks.indexForDate(il, '2040-01-01')].date, il[il.length - 1].date);
  assert.equal(Weeks.indexForDate([], '2026-10-15'), -1);
});

test('weeks.relation: עתיד, עבר ומרחק בשבועות', () => {
  const now = Weeks.current(il, '2026-10-15').index;
  assert.deepEqual(Weeks.relation(il, now, now), { kind: 'current', weeks: 0 });
  assert.deepEqual(Weeks.relation(il, now + 1, now), { kind: 'future', weeks: 1 });
  assert.deepEqual(Weeks.relation(il, now - 1, now), { kind: 'past', weeks: 1 });
  const far = il.findIndex((v) => v.date === '2027-03-06');
  assert.equal(Weeks.relation(il, far, now).weeks, 20);
});

test('weeks.years ו-ofYear', () => {
  const years = Weeks.years(il);
  assert.deepEqual(years.map((y) => y.hy), [5788, 5787, 5786]);
  assert.equal(Weeks.ofYear(il, 5787).length, years.find((y) => y.hy === 5787).count);
  assert.ok(Weeks.ofYear(il, 5787).every((v) => v.hy === 5787));
});

test('weeks.displayDay: תאריך השורה כמות שהוא', () => {
  for (const v of il.slice(0, 40)) assert.equal(Core.ymd(Weeks.displayDay(v)), v.date);
});

test('weeks: הטקסט העברי שבקטלוג זהה לחישוב של התוסף (כל שורות הלוח והארכיון)', () => {
  const archive = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weeks-archive-real.json'), 'utf8'));
  let checked = 0;
  for (const row of rows.concat(archive)) {
    assert.equal(HebCal.formatHebrew(Core.parseYmd(row.date)), row.hebrew, row.date);
    checked++;
  }
  assert.ok(checked > 2700, 'נבדקו ' + checked);
});

test('weeks: מועדים חדשים — שורות ראש חודש וצום, שמות, אירועים משניים, וסלאג לא מוכר שורד', () => {
  const rc = il.find((v) => v.event === 'rosh-chodesh');
  assert.equal(rc.kind, 'holiday');
  assert.match(rc.title, /^ראש חודש /, 'התווית מהקטלוג נושאת את החודש');
  assert.equal(rc.hebrew, rc.row.hebrew);
  const mevarchim = il.find((v) => v.secondary.includes('shabbat-mevarchim'));
  assert.equal(mevarchim.kind, 'shabbat', 'אירוע משני אינו הופך שבת רגילה למיוחדת');
  assert.equal(mevarchim.event, null);
  for (const slug of Object.keys(A.Core.EVENTS)) assert.ok(A.Core.eventName(slug), slug);
  const odd = Weeks.build([{ date: '2026-10-21', hy: 5787, parasha: [], parashaIL: [], label: 'מועד חדש', event: 'brand-new-event', shabbat: false }], {})[0];
  assert.equal(odd.kind, 'holiday');
  assert.equal(odd.title, 'מועד חדש', 'תווית הקטלוג');
  const noLabel = Weeks.build([{ date: '2026-10-21', hy: 5787, parasha: [], parashaIL: [], event: 'brand-new-event', shabbat: false }], {})[0];
  assert.equal(noLabel.title, 'brand new event', 'בלי תווית: הסלאג קריא');
  A.I18n.configure('en');
  try {
    const en = Weeks.build([rc.row], {})[0];
    assert.equal(en.title, 'Rosh Chodesh', 'באנגלית — השם המתורגם, לא תווית עברית');
  } finally {
    A.I18n.configure('he');
  }
});

test('weeks.current: מועד קטן (ראש חודש, צום) אינו "השבוע"', () => {
  const on = (day) => il[Weeks.current(il, day).index];
  assert.equal(on('2025-10-20').date, '2025-10-25', 'שני לפני ראש חודש: השבת');
  assert.equal(on('2026-03-01').date, '2026-03-03', 'ראשון לפני תענית אסתר ופורים: פורים (חג)');
  assert.equal(on('2025-12-29').date, '2026-01-03', 'לפני עשרה בטבת: השבת הבאה');
  assert.equal(on('2026-03-04').date, '2026-03-07', 'שושן פורים: השבת');
  // אפשר עדיין לבחור אותם בבורר
  assert.equal(il[Weeks.indexForDate(il, '2025-10-22')].event, 'rosh-chodesh');
});

test('weeks.build: מסיר כפילויות וממיין, ומתעלם משורות פגומות', () => {
  const views = Weeks.build(
    [
      { date: '2026-10-24', hy: 5787, parasha: ['lech-lecha'] },
      { date: '2026-10-17', hy: 5787, parasha: ['noach'] },
      { date: '2026-10-17', hy: 5787, parasha: ['noach'] },
      null,
      { hy: 5787 },
    ],
    {},
  );
  assert.deepEqual(views.map((v) => v.date), ['2026-10-17', '2026-10-24']);
  assert.deepEqual(views.map((v) => v.i), [0, 1]);
});

test('index.allWeeks: שורות נגזרות מגיליונות לשנים שמחוץ ללוח', () => {
  const index = new A.Index.CatalogIndex();
  index.setSeries([{ id: 's1', title: 'עלון', lang: 'he' }]);
  index.setWeeks(rows);
  index.addIssues(
    [
      { id: 'a1', series: 's1', date: '2024-10-26', hy: 5785, parasha: ['noach'], assets: [] },
      { id: 'a2', series: 's1', date: '2024-10-26', hy: 5785, parasha: ['noach'], assets: [] },
      { id: 'a3', series: 's1', date: '2024-10-29', hy: 5785, assets: [] },
      { id: 'a4', series: 's1', date: '2026-10-17', hy: 5787, parasha: ['noach'], assets: [] },
    ],
    'recent',
  );
  const derived = index.derivedWeeks();
  assert.deepEqual(derived.map((r) => r.date), ['2024-10-26'], 'רק שבת מחוץ ללוח; יום חול בלי אירוע ושורה בתוך הלוח לא נספרים');
  assert.equal(derived[0].derived, true);
  const all = index.allWeeks();
  assert.equal(all.length, rows.length + 1);
  assert.equal(all[0].date, '2024-10-26');
  const views = Weeks.build(all, {});
  assert.equal(views[0].title, 'פרשת נח');
  assert.equal(views[0].derived, true);
  assert.equal(index.forWeek(derived[0]).length, 2);
});
