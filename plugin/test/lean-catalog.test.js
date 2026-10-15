// הקטלוג האמיתי גדול (123 אלף גיליונות, 70MB): האינדקס רזה, הכתובות נקראות לפי
// דרישה, ורק חלק מהשרדים נטען אוטומטית ונשמר במטמון.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { makeCatalog } = require('./helpers/fixture');
const { buildFiles, DEFAULT_SOURCES } = require('./helpers/catalog-files');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const Core = A.Core;
const { CatalogIndex } = A.Index;
const { Catalog, CACHE_CAP, WARM_BYTES } = A.Catalog;
const { createRuntime } = A.Runtime;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };
const noSleep = async () => {};

test('ירושה: שפה חסרה בגיליון = שפת הסדרה, וכותרת חסרה = כותרת הסדרה (חוזה הדחיסה)', () => {
  const idx = new CatalogIndex({ source: (id) => id });
  idx.setSeries([{ id: 's_yi', title: 'הבינני', lang: 'yi' }, { id: 's_he', title: 'הבינני', lang: 'he' }]);
  idx.addIssues([
    { id: 'i_1', series: 's_yi', hy: 5787, parasha: ['noach'], assets: [{ src: 'a', ext: '1' }] },
    { id: 'i_2', series: 's_he', hy: 5787, parasha: ['noach'], assets: [{ src: 'a', ext: '2' }] },
    { id: 'i_3', series: 's_yi', title: 'כותרת אחרת', lang: 'he', hy: 5787, parasha: ['noach'], assets: [{ src: 'a', ext: '3' }] },
  ]);
  assert.equal(idx.get('i_1').lang, 'yi');
  assert.equal(idx.get('i_1').title, 'הבינני');
  assert.equal(idx.get('i_2').lang, 'he');
  assert.equal(idx.get('i_3').lang, 'he', 'ערך מפורש גובר');
  assert.equal(idx.get('i_3').title, 'כותרת אחרת');
  assert.equal(idx.search('lang:yi', {}, {}, {}).total, 1);
  assert.equal(idx.search('', { lang: 'yi' }, {}, {}).total, 1);
  assert.equal(idx.search('', { lang: 'he' }, {}, {}).total, 2);
  assert.equal(idx.facets().langs.get('yi'), 1);
  // סדרה שהגיעה אחרי הגיליונות שלה (סדר טעינה): השפה והכותרת מתעדכנות.
  const late = new CatalogIndex({ source: (id) => id });
  late.addIssues([{ id: 'i_9', series: 's_yi', hy: 5787, parasha: ['noach'], assets: [{ src: 'a', ext: '9' }] }]);
  late.setSeries([{ id: 's_yi', title: 'הבינני', lang: 'yi' }]);
  assert.equal(late.get('i_9').lang, 'yi');
  assert.equal(late.search('הבינני', {}, {}, {}).total, 1);
});

test('אינדקס רזה: אין כתובות בגיליון, יש סימון noUrl, והפרטים המלאים נשארים בשרד', () => {
  const idx = new CatalogIndex({ source: (id) => id });
  idx.setSeries([{ id: 's', title: 'סדרה', lang: 'he' }]);
  idx.addIssues([{ id: 'i_aaaaaaaaaaaa', series: 's', title: 'סדרה', date: '2026-10-17', hy: 5787, parasha: ['noach'], assets: [{ src: 'ladaat', ext: '1', url: 'https://ladaat.co/gilyonot/uploads/x.pdf', page: 'https://ladaat.co/p', bytes: 3 * 1024 * 1024, pages: 8 }, { src: 'linksrc', ext: '2', page: 'https://linksrc.example/' }] }], '5787');
  const item = idx.get('i_aaaaaaaaaaaa');
  assert.equal(item.assets[0].url, undefined);
  assert.equal(item.assets[0].page, undefined);
  assert.equal(item.assets[0].noUrl, false);
  assert.equal(item.assets[1].noUrl, true);
  assert.equal(item.assets[0].bytes, 3 * 1024 * 1024);
  assert.equal(item._shard, '5787');
  assert.equal(item.date, '2026-10-17');
  assert.deepEqual(item.parasha, ['noach']);
});

test('הוספת שרדים בזה אחר זה נותנת אותו סדר ותוצאות כמו בנייה אחת (מיזוג סדרים)', () => {
  const { series, issues } = makeCatalog(3000, 40, 21);
  const byYear = new Map();
  for (const it of issues) (byYear.get(it.hy) || byYear.set(it.hy, []).get(it.hy)).push(it);
  const incremental = new CatalogIndex({ source: (id) => id });
  incremental.setSeries(series);
  for (const [hy, list] of byYear) {
    incremental.search('', {}, {}, { sort: 'date' });
    incremental.search('', {}, {}, { sort: 'alpha' });
    incremental.search('', {}, {}, { sort: 'size' });
    incremental.addIssues(JSON.parse(JSON.stringify(list)), String(hy));
  }
  const once = new CatalogIndex({ source: (id) => id });
  once.setSeries(series);
  once.addIssues(JSON.parse(JSON.stringify(issues)));
  for (const sort of ['date', 'new', 'alpha', 'size']) {
    const a = incremental.search('', {}, {}, { sort }).idx.map((i) => incremental.ids[i]);
    const b = once.search('', {}, {}, { sort }).idx.map((i) => once.ids[i]);
    // מיון לא יציב בין מבנים זהים רק בתיקו מלא: משווים לפי מפתח המיון.
    assert.equal(a.length, b.length, sort);
    const key = (idx, id) => { const it = idx.get(id); return sort === 'alpha' ? it._ns : sort === 'size' ? it._bytes : sort === 'new' ? it._added : it._date; };
    assert.deepEqual(a.map((id) => key(incremental, id)), b.map((id) => key(once, id)), sort);
  }
});

test('גיליון שהוחלף (אותו id בשרד) מעדכן ואינו מכפיל', () => {
  const idx = new CatalogIndex({ source: (id) => id });
  idx.setSeries([{ id: 's', title: 'סדרה', lang: 'he' }]);
  idx.addIssues([{ id: 'i_1', series: 's', title: 'סדרה', hy: 5787, parasha: ['noach'], assets: [{ src: 'ladaat' }] }], 'recent');
  idx.addIssues([{ id: 'i_1', series: 's', title: 'סדרה', hy: 5787, parasha: ['noach'], date: '2026-10-17', assets: [{ src: 'ladaat' }, { src: 'tashma' }] }], '5787');
  assert.equal(idx.size, 1);
  assert.equal(idx.get('i_1')._shard, '5787');
  assert.equal(idx.get('i_1').assets.length, 2);
  assert.equal(idx.search('', {}, {}, {}).total, 1);
  assert.equal(idx.search('tashma', {}, {}, {}).total, 1);
});

function bigCatalog() {
  // שרדים של 6MB כל אחד (לפי המניפסט): אחרי 40MB השאר "קרים".
  const { series, issues } = makeCatalog(900, 20, 3);
  const { files, manifest } = buildFiles({ series, issues, weeks: [], sources: DEFAULT_SOURCES, recentCount: 20 });
  for (const shard of manifest.shards) shard.bytes = 9 * 1024 * 1024;
  files['manifest.json'] = JSON.stringify(manifest);
  return { files, manifest };
}

test('שרדים חמים וקרים: נטענים אוטומטית רק החדשים, והשאר לפי דרישה', async () => {
  const { files, manifest } = bigCatalog();
  const sdk = createFakeSdk({ catalog: files });
  const catalog = new Catalog(createRuntime(sdk, { logger: quiet, sleep: noSleep }), { log: quiet, sleep: noSleep });
  const events = [];
  catalog.onData((e) => events.push(e));
  catalog.manifest = manifest;
  const warm = catalog.warmShards();
  const bytes = warm.reduce((n, x) => n + x.bytes, 0);
  assert.ok(bytes <= WARM_BYTES + 6 * 1024 * 1024 && warm.length >= 2 && warm.length < manifest.shards.length, 'חם: ' + warm.length + '/' + manifest.shards.length);
  assert.ok(catalog.coldShards().length > 0);
  // החדש ביותר חם: לפי תאריך השבת האחרון.
  const newest = [...manifest.shards].sort((a, b) => String(b.to).localeCompare(String(a.to)))[0];
  assert.equal(warm[0].id, newest.id);
  await catalog.sync();
  const loadedShards = events.filter((e) => e.kind === 'shard').map((e) => e.id);
  assert.deepEqual(new Set(loadedShards), new Set(warm.map((x) => x.id)), 'רק החמים נטענו');
  assert.ok(catalog.coldPending().shards > 0);
  assert.ok(events.find((e) => e.kind === 'recent').id === 'recent');
  const coldYear = catalog.coldShards()[0].id.slice(0, 4);
  await catalog.ensureYear(Number(coldYear));
  assert.ok(events.some((e) => e.kind === 'shard' && e.id.startsWith(coldYear)), 'שרד קר נטען לפי דרישה');
  let progress = 0;
  await catalog.loadCold(() => progress++);
  assert.equal(catalog.coldPending().shards, 0);
  assert.ok(progress > 0);
});

test('מטמון LRU: מתחת לתקרה של 50MB, מוחק קר ושלא בשימוש, ושומר את שני החדשים', async () => {
  const { files, manifest } = bigCatalog();
  const sdk = createFakeSdk({ catalog: files });
  const catalog = new Catalog(createRuntime(sdk, { logger: quiet, sleep: noSleep }), { log: quiet, sleep: noSleep });
  catalog.manifest = manifest;
  await catalog.sync();
  for (const shard of catalog.coldShards()) await catalog.ensureShard(shard);
  await catalog._evictIfNeeded();
  const cached = manifest.shards.filter((x) => catalog.meta.sha['issues/' + x.id + '.json']);
  const total = cached.reduce((n, x) => n + x.bytes, 0) + catalog._baseBytes();
  assert.ok(total <= CACHE_CAP, 'נפח המטמון ' + total + ' ≤ ' + CACHE_CAP);
  const newest = [...manifest.shards].sort((a, b) => String(b.to).localeCompare(String(a.to))).slice(0, 2);
  for (const x of newest) assert.ok(sdk.privateFs.has('catalog/issues/' + x.id + '.json'), 'החדש נשמר: ' + x.id);
  assert.ok(cached.length < manifest.shards.length, 'חלק נמחק');
});

test('hydrate: כתובות מהשרד לפי דרישה (גם גיליון מ-recent, וגם דרך שנה)', async () => {
  const { files, manifest } = (() => {
    const { series, issues } = makeCatalog(120, 6, 8);
    return buildFiles({ series, issues, weeks: [], sources: DEFAULT_SOURCES, recentCount: 10 });
  })();
  const sdk = createFakeSdk({ catalog: files });
  const catalog = new Catalog(createRuntime(sdk, { logger: quiet, sleep: noSleep }), { log: quiet, sleep: noSleep });
  const idx = new CatalogIndex({ source: (id) => id });
  catalog.onData((e) => {
    if (e.kind === 'series') idx.setSeries(e.data);
    else if (e.kind !== 'weeks') idx.addIssues(e.data, e.id);
  });
  await catalog.init();
  const item = idx.item(5);
  assert.equal(item.assets[0].url, undefined);
  const full = await catalog.hydrate(item);
  assert.ok(full._full);
  assert.match(full.assets[0].url, /^https:\/\/ladaat\.co\/gilyonot\/uploads\//);
  assert.equal(full.id, item.id);
  // פריט "מדומה" (מועדף בלי שרד): מוצא לפי השנה.
  const pseudo = { id: item.id, hy: item.hy, assets: [] };
  assert.ok((await catalog.hydrate(pseudo)).assets.length > 0);
  assert.equal(await catalog.hydrate({ id: 'i_missing', hy: 5785, assets: [] }), null);
  // תבנית מהמניפסט: כתובת חסרה נבנית מ-urlTemplates.
  const raw = JSON.parse(files['issues/' + item._shard + '.json']).find((x) => x.id === item.id);
  catalog.manifest = { ...manifest, sources: [{ id: raw.assets[0].src, urlTemplates: { url: 'https://ladaat.co/gilyonot/uploads/{ext}.pdf' } }] };
  delete raw.assets[0].url;
  catalog._parsed = new Map();
  sdk.privateFs.set('catalog/issues/' + item._shard + '.json', { content: JSON.stringify([raw]), size: 100 });
  const templated = await catalog.hydrate(item);
  assert.equal(templated.assets[0].url, 'https://ladaat.co/gilyonot/uploads/' + raw.assets[0].ext + '.pdf');
});
