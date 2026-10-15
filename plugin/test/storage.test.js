'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { Storage, Core } = A;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };

const NOW = Date.parse('2026-10-15T12:00:00Z');
const ago = (days) => new Date(NOW - days * 86400000).toISOString();

function disk() {
  return new Map([
    [
      'aaaaaaaa',
      { path: '5787/a/x [aaaaaaaa].pdf', name: 'x [aaaaaaaa].pdf', size: 1000, modified: ago(2) },
    ],
    [
      'bbbbbbbb',
      { path: '5786/a/y [bbbbbbbb].pdf', name: 'y [bbbbbbbb].pdf', size: 2000, modified: ago(40) },
    ],
    [
      'cccccccc',
      { path: '5786/a/z [cccccccc].pdf', name: 'z [cccccccc].pdf', size: 3000, modified: ago(100) },
    ],
    [
      'dddddddd',
      { path: '5785/a/w [dddddddd].pdf', name: 'w [dddddddd].pdf', size: 4000, modified: ago(400) },
    ],
    [
      'eeeeeeee',
      { path: '5785/a/v [eeeeeeee].pdf', name: 'v [eeeeeeee].pdf', size: 5000, modified: null },
    ],
  ]);
}

test('rows: ממוין מהחדש לישן, זמן לא ידוע בסוף', () => {
  const list = Storage.rows(disk());
  assert.deepEqual(
    list.map((r) => r.fragment),
    ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee'],
  );
  assert.equal(list[4].ts, 0);
});

test('groupByMonth: קבוצות רצופות לפי חודש, עם סכום בייטים', () => {
  const groups = Storage.groupByMonth(Storage.rows(disk()));
  assert.ok(groups.length >= 3);
  assert.equal(
    groups.reduce((n, g) => n + g.rows.length, 0),
    5,
  );
  assert.equal(
    groups.reduce((n, g) => n + g.bytes, 0),
    15000,
  );
  assert.equal(groups[groups.length - 1].key, '', 'בלי תאריך — בסוף');
  assert.equal(Storage.monthKey(Date.parse('2026-03-05T10:00:00')), '2026-03');
});

test('cleanupPlan: ישנים מ-N ימים שאינם מוגנים; מועדפים ואוספים לא נמחקים; גיל לא ידוע לא נמחק', () => {
  const list = Storage.rows(disk());
  const guard = new Set(['cccccccc']);
  const plan = Storage.cleanupPlan(list, { days: 30, now: NOW, protectedFragments: guard });
  assert.deepEqual(
    plan.remove.map((r) => r.fragment),
    ['bbbbbbbb', 'dddddddd'],
  );
  assert.deepEqual(
    plan.protectedRows.map((r) => r.fragment),
    ['cccccccc'],
  );
  assert.deepEqual(
    plan.keep.map((r) => r.fragment),
    ['aaaaaaaa'],
  );
  assert.deepEqual(
    plan.unknownAge.map((r) => r.fragment),
    ['eeeeeeee'],
  );
  assert.equal(plan.bytes, 6000);
  // כל הקבצים מחולקים לקטגוריה אחת בדיוק
  assert.equal(
    plan.remove.length + plan.keep.length + plan.protectedRows.length + plan.unknownAge.length,
    list.length,
  );
  assert.equal(
    Storage.cleanupPlan(list, { days: 3650, now: NOW }).remove.length,
    0,
    'אין כל כך ישנים',
  );
  assert.equal(
    Storage.cleanupPlan(list, { days: 0, now: NOW }).remove.length,
    4,
    '0 ימים: כולם שיש להם גיל',
  );
});

test('protectedFragments: ממזהי גיליון, כולל מזהים קודמים', () => {
  const set = Storage.protectedFragments(['i_aaaaaaaa1111', 'i_bbbbbbbb2222'], (id) =>
    id === 'i_aaaaaaaa1111' ? ['i_oooooooo9999'] : [],
  );
  assert.deepEqual([...set].sort(), ['aaaaaaaa', 'bbbbbbbb', 'oooooooo']);
  assert.equal(Core.idFragment('i_aaaaaaaa1111'), 'aaaaaaaa');
});

test('files: readCacheInfo ו-clearReadCache סופרים ומוחקים רק את _קריאה', async () => {
  const sdk = createFakeSdk();
  let folder = null;
  const files = new A.Files.Files(A.Runtime.createRuntime(sdk, { logger: quiet }), {
    log: quiet,
    getFolder: () => folder,
    setFolder: (f) => (folder = f),
  });
  await files.pickFolder();
  sdk.putFile('_קריאה/aaaaaaaa.pdf', 'x'.repeat(100));
  sdk.putFile('_קריאה/bbbbbbbb.pdf', 'x'.repeat(50));
  sdk.putFile('5787/a/x [cccccccc].pdf', 'x'.repeat(10));
  const info = await files.readCacheInfo();
  assert.equal(info.count, 2);
  assert.equal(info.bytes, 150);
  assert.equal(await files.clearReadCache(), 2);
  assert.ok(![...sdk.userFs.keys()].some((k) => k.includes('_קריאה/')));
  assert.ok(
    [...sdk.userFs.keys()].some((k) => k.includes('[cccccccc]')),
    'קבצים שנשמרו לא נוגעים',
  );
  assert.equal((await files.readCacheInfo()).count, 0);
});
