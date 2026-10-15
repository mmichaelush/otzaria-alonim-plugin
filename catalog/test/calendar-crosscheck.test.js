// The calendar we ship (plugin/js/alonim-hebcal.js and catalog/lib/calendar.mjs on @hebcal/core) against
// references we did not write: ICU's Hebrew calendar and the KosherJava year tables. The tool
// catalog/tools/verify-calendar.mjs runs the same checks over 1800-2300; the test keeps to 1950-2100 for speed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCalendar, oracleYearType, intlDay } from '../tools/verify-calendar.mjs';

test('Hebrew dates, festivals, fasts, Rosh Chodesh, special Shabbatot and the weekly portion agree with the references (1950-2100)', () => {
  const result = verifyCalendar({ from: 1950, to: 2100 });
  assert.ok(result.years >= 150 && result.days > 55000, `${result.years} years, ${result.days} days`);
  assert.deepEqual(result.problems.slice(0, 20), []);
});

test('the reference itself: ICU knows the anchors the project relies on', () => {
  const day = (iso) => intlDay(Math.floor(Date.parse(`${iso}T12:00:00Z`) / 86400000));
  assert.deepEqual([day('2026-09-12').d, day('2026-09-12').m, day('2026-09-12').y], [1, 'Tishri', 5787]);
  assert.deepEqual([day('2027-03-23').d, day('2027-03-23').m], [14, 'Adar II']);
  assert.deepEqual([day('2026-03-03').d, day('2026-03-03').m], [14, 'Adar']);
});

test('the oracle year types: Shabbat Rosh Hashana of a long leap year differs for Israel (Gimel)', () => {
  const base = { rhDow: 6, leap: true, cheshvanLong: true, kislevShort: false };
  assert.equal(oracleYearType({ ...base, israel: false }), 11);
  assert.equal(oracleYearType({ ...base, israel: true }), 16);
  // impossible combinations (Rosh Hashana never on Sunday, Wednesday or Friday)
  assert.equal(oracleYearType({ ...base, rhDow: 0, israel: false }), -1);
});
