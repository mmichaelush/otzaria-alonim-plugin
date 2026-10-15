// תיקוני הביקורת (קטלוג): מרוצים והבטחות שלא נדחות. כל בדיקה כאן נכשלה לפני התיקון.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { makeCatalog } = require('./helpers/fixture');
const { buildFiles, DEFAULT_SOURCES } = require('./helpers/catalog-files');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { Catalog } = A.Catalog;
const { createRuntime } = A.Runtime;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };
const noSleep = async () => {};

function bigCatalog() {
  const { series, issues } = makeCatalog(900, 20, 3);
  const { files, manifest } = buildFiles({
    series,
    issues,
    weeks: [{ date: '2026-10-17', hy: 5787, parasha: ['noach'], label: 'נח' }],
    sources: DEFAULT_SOURCES,
    recentCount: 20,
  });
  for (const shard of manifest.shards) shard.bytes = 9 * 1024 * 1024;
  files['manifest.json'] = JSON.stringify(manifest);
  return { files, manifest };
}

function make(files, extra) {
  const sdk = createFakeSdk({ catalog: files, ...extra });
  const catalog = new Catalog(createRuntime(sdk, { logger: quiet, sleep: noSleep }), {
    log: quiet,
    sleep: noSleep,
  });
  return { sdk, catalog };
}

test('loadCold: שרד קר שלא נטען (404) אינו נחשב הצלחה', async () => {
  const { files, manifest } = bigCatalog();
  const { catalog } = make(files);
  await catalog.sync();
  const cold = catalog.coldShards();
  assert.ok(cold.length > 1);
  delete files['issues/' + cold[0].id + '.json'];
  let progress = 0;
  const ok = await catalog.loadCold(() => progress++);
  assert.equal(ok, false, 'ההודעה "חלק מהשנים לא נטענו" נשענת על זה');
  assert.equal(progress, cold.length, 'ההתקדמות ממשיכה לשאר השרדים');
  assert.ok(manifest.shards.length > cold.length);
});

test('ensureWeeksArchive: קריאות מקבילות חולקות הורדה אחת', async () => {
  const { files, manifest } = bigCatalog();
  manifest.files.weeksArchive = { path: 'weeks-archive.json', bytes: 40, sha256: '' };
  files['manifest.json'] = JSON.stringify(manifest);
  files['weeks-archive.json'] = JSON.stringify([{ date: '2001-01-06', hy: 5761, label: 'שבת' }]);
  const { sdk, catalog } = make(files);
  await catalog.sync();
  const before = sdk.streams;
  const results = await Promise.all([
    catalog.ensureWeeksArchive(),
    catalog.ensureWeeksArchive(),
    catalog.ensureWeeksArchive(),
  ]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(sdk.streams - before, 1);
});

test('_loadJob: שרד שנטען בסנכרון ובדרישה בו-זמנית יורד פעם אחת', async () => {
  const { files } = bigCatalog();
  const { sdk, catalog } = make(files, { netDelay: 5 });
  const syncing = catalog.sync();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const shard = catalog.warmShards()[0];
  const events = [];
  catalog.onData((e) => e.kind === 'shard' && events.push(e.id));
  await Promise.all([syncing, catalog.ensureShard(shard)]);
  const downloads = sdk.calls.filter(
    (c) => c.method === 'network.fetchStream' && String(c.payload.url).includes('/' + shard.path),
  ).length;
  assert.ok(downloads <= 1, 'הורדות לשרד ' + shard.id + ': ' + downloads);
  assert.ok(events.filter((id) => id === shard.id).length <= 1, 'נשלח לאינדקס פעם אחת');
});

test('סנכרון שהושהה באמצע אינו נרשם כהצלחה, וחזרה מההשהיה מסנכרנת מחדש', async () => {
  const { files } = bigCatalog();
  const { sdk, catalog } = make(files, { netDelay: 2 });
  const syncing = catalog.sync();
  // משהים אחרי שהמניפסט ירד ולפני שכל הקבצים ירדו
  while (!catalog.manifest) await new Promise((resolve) => setTimeout(resolve, 1));
  catalog.suspend();
  await syncing;
  assert.equal(catalog.status.lastOkAt, 0, 'לא נרשמה הצלחה');
  assert.equal(catalog.meta.catalogVersion, 0);
  assert.equal(catalog.interrupted, true);
  const before = sdk.streams;
  catalog.resume();
  await catalog.syncing;
  assert.ok(sdk.streams > before, 'חזרה מהשהיה מסנכרנת גם כשהבדיקה האחרונה טרייה');
  assert.equal(catalog.interrupted, false);
  assert.ok(catalog.status.lastOkAt > 0);
});

test('sync: תקלה בלתי צפויה אינה הופכת לדחייה שאיש אינו תופס', async () => {
  const { files } = bigCatalog();
  const { catalog } = make(files);
  catalog._sync = async () => {
    throw new Error('unexpected');
  };
  const result = await catalog.sync();
  assert.equal(result, false);
  assert.equal(catalog.status.phase, 'error');
  assert.equal(catalog.syncing, null);
});

test('hydrate: בקשות מקבילות לאותו שרד קוראות ומפענחות פעם אחת', async () => {
  const { files } = bigCatalog();
  const { sdk, catalog } = make(files);
  await catalog.sync();
  const item = { id: 'x', _shard: catalog.warmShards()[0].id, hy: 0 };
  catalog._parsed = new Map();
  const reads = [];
  const orig = catalog._read.bind(catalog);
  catalog._read = (path) => (reads.push(path), orig(path));
  await Promise.all([catalog.hydrate(item), catalog.hydrate(item), catalog.hydrate(item)]);
  const shardReads = reads.filter((p) => p.startsWith('issues/'));
  assert.equal(new Set(shardReads).size, shardReads.length, 'כל קובץ נקרא פעם אחת: ' + shardReads);
  assert.ok(sdk);
});
