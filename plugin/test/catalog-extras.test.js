'use strict';

// הרחבות החוזה: לוח שנים ישנות לפי בקשה (weeks-archive.json), גיליון עם archive,
// סדרה עם years, ו-previousIds בגיליון.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { makeCatalog } = require('./helpers/fixture');
const { buildFiles, DEFAULT_SOURCES } = require('./helpers/catalog-files');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { createRuntime } = A.Runtime;
const { Catalog } = A.Catalog;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };
const noSleep = async () => {};

const ARCHIVE = [
  {
    date: '2020-10-17',
    hy: 5781,
    hebrew: 'כ״ט בתשרי תשפ״א',
    parasha: ['noach'],
    parashaIL: ['noach'],
    label: 'נח',
    event: null,
  },
  {
    date: '2020-10-24',
    hy: 5781,
    hebrew: 'ו׳ בחשוון תשפ״א',
    parasha: ['lech-lecha'],
    parashaIL: ['lech-lecha'],
    label: 'לך לך',
    event: null,
  },
];

function setup(extra) {
  const { series, issues } = makeCatalog(200, 8, 3);
  const { files, manifest } = buildFiles({
    series,
    issues,
    weeks: [{ date: '2026-10-17', hy: 5787, parasha: ['noach'], label: 'נח' }],
    weeksArchive: ARCHIVE,
    sources: DEFAULT_SOURCES,
    recentCount: 20,
  });
  const sdk = createFakeSdk({ catalog: files, ...(extra || {}) });
  const runtime = createRuntime(sdk, { logger: quiet, sleep: noSleep });
  const catalog = new Catalog(runtime, { log: quiet, sleep: noSleep, online: () => true });
  const events = [];
  catalog.onData((e) => events.push(e));
  return { sdk, runtime, catalog, events, files, manifest };
}

test('לוח ארכיון: אינו יורד בסנכרון, וניתן לטעון אותו לפי בקשה', async () => {
  const s = setup();
  await s.catalog.init();
  assert.equal(s.catalog.hasWeeksArchive(), true);
  assert.equal(s.catalog.weeksArchiveLoaded(), false);
  assert.ok(!s.events.some((e) => e.kind === 'weeksArchive'), 'לא נטען אוטומטית');
  assert.ok(!s.sdk.privateFs.has('catalog/weeks-archive.json'));
  const streams = s.sdk.streams;
  assert.equal(await s.catalog.ensureWeeksArchive(), true);
  assert.equal(s.sdk.streams - streams, 1, 'קובץ אחד מהרשת');
  const event = s.events.find((e) => e.kind === 'weeksArchive');
  assert.equal(event.data.length, 2);
  assert.ok(s.sdk.privateFs.has('catalog/weeks-archive.json'), 'נשמר במטמון');
  assert.equal(await s.catalog.ensureWeeksArchive(), true, 'קריאה חוזרת: כבר בזיכרון');
  assert.equal(s.sdk.streams - streams, 1);
});

test('לוח ארכיון: ביקור הבא טוען אותו מהמטמון, וסנכרון מעדכן אותו רק אם נטען', async () => {
  const first = setup();
  await first.catalog.init();
  await first.catalog.ensureWeeksArchive();
  const runtime = createRuntime(first.sdk, { logger: quiet, sleep: noSleep });
  const next = new Catalog(runtime, { log: quiet, sleep: noSleep, online: () => true });
  const events = [];
  next.onData((e) => events.push(e));
  await next.loadCache();
  assert.ok(
    events.some((e) => e.kind === 'weeksArchive' && e.cached),
    'מהמטמון בלי רשת',
  );
  // שינוי בארכיון בשרת: נמשך בסנכרון, כי המשתמש כבר ביקש אותו
  const changed = ARCHIVE.concat([
    {
      date: '2020-10-31',
      hy: 5781,
      hebrew: 'י״ג בחשוון תשפ״א',
      parasha: ['vayera'],
      parashaIL: ['vayera'],
      label: 'וירא',
      event: null,
    },
  ]);
  const text = JSON.stringify(changed);
  first.files['weeks-archive.json'] = text;
  const manifest = JSON.parse(first.files['manifest.json']);
  manifest.files.weeksArchive = {
    ...manifest.files.weeksArchive,
    sha256: require('./helpers/catalog-files').sha(text),
    bytes: Buffer.byteLength(text),
  };
  first.files['manifest.json'] = JSON.stringify(manifest);
  await next.sync();
  assert.equal(events.filter((e) => e.kind === 'weeksArchive').pop().data.length, 3);
});

test('לוח ארכיון: בלי רשת וללא מטמון — נכשל בנימוס, ובלי ארכיון במניפסט — אין', async () => {
  const offline = setup();
  await offline.catalog.init();
  offline.catalog.online = () => false;
  assert.equal(await offline.catalog.ensureWeeksArchive(), false);
  const none = setup();
  const manifest = JSON.parse(none.files['manifest.json']);
  delete manifest.files.weeksArchive;
  none.files['manifest.json'] = JSON.stringify(manifest);
  await none.catalog.init();
  assert.equal(none.catalog.hasWeeksArchive(), false);
  assert.equal(await none.catalog.ensureWeeksArchive(), false);
});

test('index.setWeeksArchive: הארכיון מצטרף ללוח, ושורות נגזרות רק לפני תחילתו', () => {
  const index = new A.Index.CatalogIndex();
  index.setSeries([{ id: 's1', title: 'עלון', lang: 'he' }]);
  index.setWeeks([{ date: '2026-10-17', hy: 5787, parasha: ['noach'], parashaIL: ['noach'] }]);
  index.addIssues(
    [
      { id: 'a1', series: 's1', date: '2020-10-17', hy: 5781, parasha: ['noach'], assets: [] },
      { id: 'a2', series: 's1', date: '2019-10-26', hy: 5780, parasha: ['noach'], assets: [] },
    ],
    'x',
  );
  assert.deepEqual(
    index.allWeeks().map((r) => r.date),
    ['2019-10-26', '2020-10-17', '2026-10-17'],
    'בלי ארכיון: שתי שורות נגזרות',
  );
  assert.ok(
    index
      .allWeeks()
      .slice(0, 2)
      .every((r) => r.derived),
  );
  index.setWeeksArchive(ARCHIVE);
  const all = index.allWeeks();
  assert.deepEqual(
    all.map((r) => r.date),
    ['2019-10-26', '2020-10-17', '2020-10-24', '2026-10-17'],
  );
  assert.equal(all.find((r) => r.date === '2020-10-17').derived, undefined, 'מהארכיון, לא נגזרת');
  assert.equal(
    all.find((r) => r.date === '2019-10-26').derived,
    true,
    'לפני תחילת הארכיון: עדיין נגזרת',
  );
  assert.equal(index.forWeek(all.find((r) => r.date === '2020-10-17')).length, 1);
});
