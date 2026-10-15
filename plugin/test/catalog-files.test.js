'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { makeCatalog } = require('./helpers/fixture');
const { buildFiles, DEFAULT_SOURCES } = require('./helpers/catalog-files');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { createRuntime } = A.Runtime;
const { Catalog } = A.Catalog;
const { Files, pickAsset, FileError } = A.Files;
const Core = A.Core;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };
const noSleep = async () => {};

function data() {
  const { series, issues } = makeCatalog(300, 10, 11);
  return buildFiles({ series, issues, weeks: [{ date: '2026-10-17', hy: 5787, parasha: ['noach'], label: 'נח' }], sources: DEFAULT_SOURCES, recentCount: 20 });
}

function setup(scenario, extra) {
  const { files, manifest } = data();
  const sdk = createFakeSdk({ scenario, catalog: files, ...extra });
  const runtime = createRuntime(sdk, { logger: quiet, sleep: noSleep });
  const catalog = new Catalog(runtime, { log: quiet, sleep: noSleep, online: () => (scenario === 'offline' ? false : true) });
  const events = [];
  catalog.onData((e) => events.push(e));
  return { sdk, runtime, catalog, events, files, manifest };
}

test('ביקור ראשון: recent קודם, אחר כך כל השרדים; המטמון נכתב; סטטוס idle', async () => {
  const { catalog, events, sdk, manifest } = setup();
  await catalog.init();
  const kinds = events.map((e) => e.kind).filter((k) => k !== 'sources');
  assert.equal(kinds[0], 'recent', 'הציור הראשון מ-recent');
  assert.ok(kinds.includes('series') && kinds.includes('weeks'));
  assert.equal(events.filter((e) => e.kind === 'shard').length, manifest.shards.length);
  assert.equal(catalog.status.phase, 'idle');
  assert.ok(sdk.privateFs.has('catalog/manifest.json'));
  assert.ok(sdk.privateFs.has('catalog/issues/5785.json'));
  assert.equal(catalog.meta.catalogVersion, manifest.catalogVersion);
});

test('ביקור שני: ציור מהמטמון בלי רשת, ואין הורדה כשלא השתנה דבר', async () => {
  const first = setup();
  await first.catalog.init();
  // אותו מארח, תוסף "חדש": המטמון הפרטי נשאר.
  const runtime = createRuntime(first.sdk, { logger: quiet, sleep: noSleep });
  const catalog = new Catalog(runtime, { log: quiet, sleep: noSleep });
  const events = [];
  catalog.onData((e) => events.push(e));
  const before = first.sdk.streams;
  const cached = await catalog.loadCache();
  assert.equal(cached, true);
  assert.deepEqual(events.map((e) => e.kind).sort(), ['recent', 'series', 'sources', 'weeks']);
  assert.ok(events.every((e) => e.cached));
  assert.equal(first.sdk.streams, before, 'ציור מהמטמון אינו נוגע ברשת');
  await catalog.loadCachedShards();
  const cachedShards = events.filter((e) => e.kind === 'shard').length;
  assert.equal(cachedShards, first.manifest.shards.length);
  const streamsBefore = first.sdk.streams;
  await catalog.sync();
  assert.equal(first.sdk.streams - streamsBefore, 1, 'רק המניפסט נבדק');
});

test('שינוי באחד השרדים מוריד רק אותו', async () => {
  const s = setup();
  await s.catalog.init();
  const changed = JSON.parse(s.files['issues/5785.json']);
  changed[0].title = 'שונה';
  const text = JSON.stringify(changed);
  s.files['issues/5785.json'] = text;
  const manifest = JSON.parse(s.files['manifest.json']);
  const entry = manifest.shards.find((x) => x.id === '5785');
  entry.sha256 = require('./helpers/catalog-files').sha(text);
  manifest.catalogVersion++;
  s.files['manifest.json'] = JSON.stringify(manifest);
  const before = s.sdk.streams;
  await s.catalog.sync();
  assert.equal(s.sdk.streams - before, 2, 'מניפסט + שרד אחד');
});

test('גיבוב לא תואם (מטמון CDN ישן): ניסיון חוזר, ואז כשל בלי לפגוע במטמון', async () => {
  const s = setup();
  await s.catalog.init();
  const manifest = JSON.parse(s.files['manifest.json']);
  manifest.shards[0].sha256 = '0'.repeat(64);
  manifest.catalogVersion++;
  s.files['manifest.json'] = JSON.stringify(manifest);
  s.catalog.emitted.clear();
  const cachedBefore = s.sdk.privateFs.get('catalog/issues/' + manifest.shards[0].id + '.json').content;
  await s.catalog.sync();
  assert.equal(s.catalog.status.phase, 'partial');
  assert.equal(s.catalog.status.error, 'hash');
  assert.equal(s.sdk.privateFs.get('catalog/issues/' + manifest.shards[0].id + '.json').content, cachedBefore);
});

test('ללא רשת: המטמון עובד והסטטוס offline; allowlist חסום: error forbidden', async () => {
  const warm = setup();
  await warm.catalog.init();
  const offlineSdk = createFakeSdk({ scenario: 'offline', catalog: warm.files });
  offlineSdk.privateFs = warm.sdk.privateFs;
  const catalog = new Catalog(createRuntime(offlineSdk, { logger: quiet, sleep: noSleep }), { log: quiet, sleep: noSleep, online: () => false });
  const events = [];
  catalog.onData((e) => events.push(e));
  await catalog.init();
  assert.equal(catalog.status.phase, 'offline');
  assert.ok(events.length >= 3, 'נתונים מהמטמון');

  const blocked = setup('blocked');
  await blocked.catalog.sync();
  assert.equal(blocked.catalog.status.phase, 'error');
  assert.equal(blocked.catalog.status.error, 'forbidden');
  assert.equal(blocked.catalog.retryTimer, null, 'חסימה קבועה אינה מנסה שוב ושוב');
});

test('סכימה חדשה מהתוסף: הודעה, והמטמון נשאר', async () => {
  const s = setup('bad-schema');
  await s.catalog.sync();
  assert.equal(s.catalog.status.schemaTooNew, true);
  assert.equal(s.events.length, 0);
});

test('ensureYear טוען שרד לפי דרישה', async () => {
  const s = setup();
  s.catalog.manifest = s.manifest;
  await s.catalog.ensureYear(5783);
  assert.equal(s.events.filter((e) => e.kind === 'shard' && e.id === '5783').length, 1);
});

// ------------------------------------------------------------------- Files

function filesFor(sdk, extra) {
  const runtime = createRuntime(sdk, { logger: quiet, sleep: noSleep });
  let folder = null;
  const files = new Files(runtime, { log: quiet, sleep: noSleep, getFolder: () => folder, setFolder: (f) => (folder = f), fetch: null, ...extra });
  return files;
}

const ISSUE = {
  id: 'i_8c11d0e47a93',
  series: 's_1',
  seriesTitle: 'אסיפת גליונות',
  title: 'אסיפת גליונות',
  hy: 5787,
  date: '2026-10-17',
  parasha: ['noach'],
  no: 21,
  assets: [
    { src: 'ladaat', ext: '1', url: 'https://ladaat.co/gilyonot/uploads/2026-10-17/files/a.pdf', page: 'https://ladaat.co/gilyonot/view/1', bytes: 2300 },
    { src: 'tashma', ext: '2', url: 'https://tashma.co.il/gilyonot/file/2', bytes: 2300 },
  ],
};

test('pickAsset: מקור מועדף, מקורות מוסתרים, ואין עותק מותר', () => {
  assert.equal(pickAsset(ISSUE, 'tashma').asset.src, 'tashma');
  assert.equal(pickAsset(ISSUE, '').asset.src, 'ladaat');
  assert.equal(pickAsset(ISSUE, '', ['ladaat']).asset.src, 'tashma');
  assert.equal(pickAsset({ assets: [{ src: 'beinenu', page: 'https://x.example' }] }).reason, 'no_link');
  assert.equal(pickAsset({ assets: [{ src: 'x', url: 'https://evil.example/a.pdf' }] }).reason, 'blocked');
});

test('שמירה: בוחרים תיקייה, מורידים לנתיב שנה/סדרה/קובץ, מאמתים, והמצב נגזר מהדיסק', async () => {
  const sdk = createFakeSdk();
  const files = filesFor(sdk);
  assert.equal((await files.pickFolder()).ok, true);
  const job = files.enqueue(ISSUE, 'save');
  const done = await job.done;
  assert.equal(done.status, 'done', JSON.stringify(done.error));
  const rel = files.relPath(ISSUE);
  assert.equal(rel, '5787/אסיפת גליונות/אסיפת גליונות - נח - #21 [8c11d0e4].pdf');
  assert.ok(sdk.userFs.has(sdk.folderRoot + '/' + rel));
  assert.equal(sdk.downloads[0].resume, true);
  assert.ok(sdk.downloads[0].destPath.startsWith(sdk.folderRoot + '/5787/'));
  // סריקה מחדש בלי מצב שמור: אותו מצב "הורד".
  const fresh = filesFor(sdk, { getFolder: () => files.folder });
  await fresh.scan();
  assert.equal(fresh.isDownloaded(ISSUE), true);
  sdk.userFs.delete(sdk.folderRoot + '/' + rel);
  await fresh.scan();
  assert.equal(fresh.isDownloaded(ISSUE), false, 'נמחק בדיסק = לא הורד');
});

test('קריאה: יורד ל-_קריאה, לא נספר כ"הורד"; שמירה אחר כך מזיזה בלי להוריד שוב', async () => {
  const sdk = createFakeSdk();
  const files = filesFor(sdk);
  await files.pickFolder();
  const opened = await files.openForReading(ISSUE);
  assert.match(opened.rel, /^_קריאה\/8c11d0e4\.pdf$/);
  assert.ok(opened.url);
  assert.equal(files.isDownloaded(ISSUE), false);
  assert.equal(sdk.downloads.length, 1);
  const saved = await files.enqueue(ISSUE, 'save').done;
  assert.equal(saved.status, 'done');
  assert.equal(sdk.downloads.length, 1, 'הועבר, לא הורד מחדש');
  assert.equal(files.isDownloaded(ISSUE), true);
  assert.ok(!sdk.userFs.has(sdk.folderRoot + '/_קריאה/8c11d0e4.pdf'));
  // סריקה מתעלמת מ-_קריאה.
  await files.scan();
  assert.equal(files.diskState.count, 1);
});

test('כשלים: חסימת allowlist, בלי קישור, בלי תיקייה, HTML שנשמר בטעות נמחק', async () => {
  const blocked = filesFor(createFakeSdk({ scenario: 'download-blocked' }));
  await blocked.pickFolder();
  const a = await blocked.enqueue(ISSUE, 'save').done;
  assert.deepEqual([a.status, a.error.code], ['failed', 'blocked']);

  const none = filesFor(createFakeSdk());
  const b = await none.enqueue(ISSUE, 'save').done;
  assert.equal(b.error.code, 'no_folder');
  await assert.rejects(none.openForReading(ISSUE), (e) => e instanceof FileError && e.code === 'no_folder');

  const sdk = createFakeSdk();
  const noLink = filesFor(sdk);
  await noLink.pickFolder();
  const c = await noLink.enqueue({ ...ISSUE, id: 'i_2', assets: [{ src: 'beinenu', page: 'https://beinenu.example/x' }] }, 'save').done;
  assert.equal(c.error.code, 'no_direct_link');

  const html = createFakeSdk({ scenario: 'download-html' });
  const htmlFiles = filesFor(html, { fetch: async () => ({ arrayBuffer: async () => new TextEncoder().encode('<html>').buffer }) });
  await htmlFiles.pickFolder();
  const d = await htmlFiles.enqueue(ISSUE, 'save').done;
  assert.equal(d.error.code, 'not_pdf');
  assert.equal(html.userFs.size, 0, 'הקובץ הפגום נמחק');
});

test('תור: שתי הורדות במקביל לכל היותר, וביטול של ממתינה', async () => {
  const sdk = createFakeSdk({ downloadDelay: 30 });
  const files = filesFor(sdk, { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) });
  await files.pickFolder();
  let maxActive = 0;
  files.onChange(() => {
    maxActive = Math.max(maxActive, files.list().filter((j) => j.status === 'active').length);
  });
  const jobs = [1, 2, 3, 4, 5].map((n) => files.enqueue({ ...ISSUE, id: 'i_00000000000' + n }, 'save'));
  files.cancel(jobs[4].id);
  await Promise.all(jobs.map((j) => j.done));
  assert.ok(maxActive <= 2, 'מקסימום פעילות ' + maxActive);
  assert.equal(jobs[4].status, 'cancelled');
  assert.equal(jobs.filter((j) => j.status === 'done').length, 4);
  const failed = filesFor(createFakeSdk({ scenario: 'download-blocked' }));
  await failed.pickFolder();
  const j = failed.enqueue(ISSUE, 'save');
  await j.done;
  assert.ok(['queued', 'active'].includes(failed.retry(j.id).status), 'חזרה אחרי כשל');
});

test('ביטול בזמן הורדה פעילה מוחק את מה שירד', async () => {
  const sdk = createFakeSdk({ downloadDelay: 20 });
  const files = filesFor(sdk);
  await files.pickFolder();
  const job = files.enqueue(ISSUE, 'save');
  await new Promise((r) => setTimeout(r, 5));
  files.cancel(job.id);
  await job.done;
  assert.equal(job.status, 'cancelled');
  assert.equal(sdk.userFs.size, 0);
});

test('תיקייה שנעלמה או בוטלה: הסריקה מדווחת ואינה מוחקת את המצב', async () => {
  const sdk = createFakeSdk();
  const files = filesFor(sdk);
  await files.pickFolder();
  await files.enqueue(ISSUE, 'save').done;
  assert.equal(files.disk.size, 1);
  sdk.folders.clear();
  const state = await files.scan();
  assert.equal(state.status, 'revoked');
  const gone = createFakeSdk({ scenario: 'folder-gone' });
  const f2 = filesFor(gone);
  await f2.pickFolder();
  assert.equal((await f2.scan()).status, 'missing');
});

test('הדפסה: מסלול ה-iframe נחסם (cross-origin) ולא זורק; קורא אוצריא; הרשאה חסרה', async () => {
  const sdk = createFakeSdk();
  const files = filesFor(sdk);
  await files.pickFolder();
  const blockedFrame = { get contentWindow() { throw new Error('SecurityError'); } };
  assert.equal(files.printViaFrame(blockedFrame), false);
  let printed = 0;
  assert.equal(files.printViaFrame({ contentWindow: { focus() {}, print: () => printed++ } }), true);
  assert.equal(printed, 1);
  assert.equal((await files.openInReader(ISSUE)).reason, 'not_saved');
  await files.enqueue(ISSUE, 'save').done;
  assert.deepEqual(await files.openInReader(ISSUE), { ok: true, reason: null });
  const denied = filesFor(createFakeSdk({ scenario: 'reader-permission' }));
  await denied.pickFolder();
  await denied.enqueue(ISSUE, 'save').done;
  assert.equal((await denied.openInReader(ISSUE)).reason, 'permission');
});

test('פתיחה באתר: רק כתובת https מדומיין ברשימה', async () => {
  const sdk = createFakeSdk();
  const files = filesFor(sdk);
  assert.equal(await files.openOnSite('https://ladaat.co/gilyonot/view/1'), true);
  assert.equal(await files.openOnSite('http://ladaat.co/x'), false);
  assert.equal(await files.openOnSite('https://evil.example/'), false);
  assert.equal(await files.openOnSite('javascript:alert(1)'), false);
  assert.deepEqual(sdk.openedUrls, ['https://ladaat.co/gilyonot/view/1']);
  assert.ok(Core.isSiteUrl('https://ladaat.co/'));
});

test('ביקור שני עם start(): טעינת שרדים מהמטמון בו-זמנית לסנכרון אינה מורידה אותם שוב', async () => {
  const first = setup();
  await first.catalog.init();
  const runtime = createRuntime(first.sdk, { logger: quiet, sleep: noSleep });
  const catalog = new Catalog(runtime, { log: quiet, sleep: noSleep });
  const before = first.sdk.streams;
  await catalog.start();
  // ממתינים לטעינת השרדים מהמטמון שרצה במקביל.
  await catalog.loadCachedShards();
  assert.equal(first.sdk.streams - before, 1, 'רק המניפסט נבדק: שרד שכבר נטען מהמטמון אינו יורד שוב');
});

test('_loadJob מדלג על קובץ שכבר נטען מהמטמון בגיבוב זהה, אלא אם force', async () => {
  const first = setup();
  await first.catalog.init();
  const runtime = createRuntime(first.sdk, { logger: quiet, sleep: noSleep });
  const catalog = new Catalog(runtime, { log: quiet, sleep: noSleep });
  await catalog.loadCache();
  await catalog.loadCachedShards();
  const shard = first.manifest.shards[0];
  const job = { kind: 'shard', id: shard.id, path: shard.path, entry: shard, cachePath: 'issues/' + shard.id + '.json' };
  const before = first.sdk.streams;
  await catalog._loadJob(job);
  assert.equal(first.sdk.streams, before, 'כבר בזיכרון בגיבוב תואם: בלי רשת');
  await catalog._loadJob({ ...job, force: true });
  assert.equal(first.sdk.streams - before, 1, 'force מוריד שוב');
});
