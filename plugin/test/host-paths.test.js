'use strict';

// שני מסלולי המארח: חדש (0.9.99: קובץ מרוחק בלי הורדה, הדפסת קובץ) וישן (Blob,
// הורדה לתיקייה). אותה לוגיקה, שני מארחים מדומים.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { createRuntime } = A.Runtime;
const { Files, FileError } = A.Files;
const { Capabilities } = A.Capabilities;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };

const item = (n) => ({
  id: 'i_' + String(n).padStart(12, '0'),
  series: 's1',
  seriesTitle: 'עלון',
  title: 'כותרת ' + n,
  hy: 5787,
  date: '2026-10-17',
  parasha: ['noach'],
  assets: [
    {
      src: 'ladaat',
      ext: String(n),
      url: 'https://ladaat.co/gilyonot/uploads/2026-10-17/files/' + n + '.pdf',
      page: 'https://ladaat.co/gilyonot/view/' + n,
      bytes: 3000,
      pages: 2,
    },
  ],
});

async function setup(options) {
  const o = options || {};
  const sdk = createFakeSdk(o.sdk);
  const runtime = createRuntime(sdk, { logger: quiet, sleep: async () => {} });
  const caps = new Capabilities({ log: quiet });
  caps.setHost(o.version === undefined ? '0.9.99' : o.version);
  let folder = null;
  const files = new Files(runtime, {
    log: quiet,
    sleep: async () => {},
    caps,
    getFolder: () => folder,
    setFolder: (f) => (folder = f),
  });
  if (o.folder !== false) await files.pickFolder();
  return { sdk, runtime, caps, files };
}

test('מארח חדש: קריאה בלי הורדה — fetchFile, בלי כתיבה לתיקיית המשתמש, וגם בלי תיקייה בכלל', async () => {
  const { sdk, files } = await setup({ folder: false });
  assert.equal(files.canReadRemote, true);
  const file = await files.openForReading(item(1));
  assert.equal(file.remote, true);
  assert.equal(file.saved, false);
  assert.ok(file.token && file.url);
  assert.equal(sdk.fetchedFiles.length, 1);
  // התקרה של המארח האמיתי (100MB) נדחית ולא נחתכת: ערך גדול ממנה שבר קריאה חיה באוצריא 0.9.99.
  assert.ok(sdk.fetchedFiles[0].maxBytes <= 100 * 1024 * 1024, 'maxBytes בתוך תקרת המארח');
  assert.equal(sdk.downloads.length, 0, 'לא הורד לתיקייה');
  assert.equal(sdk.userFs.size, 0, 'לא נכתב דבר בתיקיית המשתמש');
  // אותה קריאה שוב: ממטמון ההענקה, בלי בקשה נוספת
  await files.openForReading(item(1));
  assert.equal(sdk.fetchedFiles.length, 1);
});

test('מארח חדש: קובץ שכבר בתיקייה נפתח משם, בלי fetchFile', async () => {
  const { sdk, files } = await setup();
  files.disk.set(A.Core.idFragment(item(2).id), {
    path: '5787/עלון/x [000000000002].pdf',
    name: 'x.pdf',
    size: 3000,
    modified: null,
  });
  sdk.putFile('5787/עלון/x [000000000002].pdf');
  const file = await files.openForReading(item(2));
  assert.ok(!file.remote);
  assert.equal(sdk.fetchedFiles.length, 0);
});

test('מארח ישן: אין fetchFile — קריאה מורידה ל-_קריאה, ובלי תיקייה נכשלת בנימוס', async () => {
  const { sdk, files, caps } = await setup({ version: '0.9.98' });
  assert.equal(files.canReadRemote, false);
  const file = await files.openForReading(item(3));
  assert.ok(!file.remote);
  assert.equal(sdk.fetchedFiles.length, 0, 'לא נקרא לשיטה חדשה');
  assert.equal(sdk.downloads.length, 1, 'ירד לתיקיית הקריאה');
  assert.match(sdk.downloads[0].destPath, /_קריאה/);
  assert.equal(caps.has('fetchFile'), false);
  const noFolder = await setup({ version: '0.9.98', folder: false });
  await assert.rejects(
    noFolder.files.openForReading(item(4)),
    (e) => e instanceof FileError && e.code === 'no_folder',
  );
});

test('מארח שמצהיר 0.9.99 אך חסרה בו השיטה (legacyHost): נופל להורדה ולומד', async () => {
  const { sdk, files, caps } = await setup({ sdk: { legacyHost: true } });
  assert.equal(caps.has('fetchFile'), true, 'לפני הניסיון');
  const file = await files.openForReading(item(5));
  assert.ok(!file.remote);
  assert.equal(sdk.downloads.length, 1, 'נפל להורדה');
  assert.equal(caps.has('fetchFile'), false, 'נלמד שחסר');
});

test('fetchFile: כשלים ממופים לקודי FileError (חסום, HTML במקום PDF, בלי קישור)', async () => {
  const blocked = await setup({ sdk: { scenario: 'fetchfile-blocked' } });
  await assert.rejects(blocked.files.openForReading(item(6)), (e) => e.code === 'blocked');
  const html = await setup({ sdk: { scenario: 'fetchfile-html' } });
  await assert.rejects(html.files.openForReading(item(7)), (e) => e.code === 'not_pdf');
  assert.equal(html.sdk.revoked.length, 1, 'ההענקה של קובץ ה-HTML בוטלה');
  const noLink = await setup();
  const it = item(8);
  delete it.assets[0].url;
  await assert.rejects(noLink.files.openForReading(it), (e) => e.code === 'no_direct_link');
  const outside = await setup();
  const odd = item(9);
  odd.assets[0].url = 'https://other.example/x.pdf';
  await assert.rejects(
    outside.files.openForReading(odd),
    (e) => e.code === 'blocked',
    'מחוץ ל-allowlist של התוסף: חסום עוד לפני הבקשה',
  );
  assert.equal(outside.sdk.fetchedFiles.length, 0);
});

test('הענקות מרוחקות: עד 6 במקביל, והישנות מבוטלות; releaseRemote מבטל הכול', async () => {
  const { sdk, files } = await setup({ folder: false });
  for (let n = 1; n <= 8; n++) await files.openForReading(item(n));
  assert.equal(files.remote.size, 6);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sdk.revoked.length, 2, 'שתי הישנות בוטלו');
  files.releaseRemote();
  assert.equal(files.remote.size, 0);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sdk.revoked.length, 8);
});

test('הדפסה: ui.printFile על token של קובץ מרוחק; ביטול המשתמש; מארח ישן — UnsupportedError', async () => {
  const { sdk, files } = await setup({ folder: false });
  const file = await files.openForReading(item(1));
  assert.deepEqual(await files.printToken(file.token, 'עלון · נח'), { printed: true });
  assert.equal(sdk.printed[0].jobName, 'עלון · נח');
  const cancel = await setup({ folder: false, sdk: { scenario: 'print-cancel' } });
  const f2 = await cancel.files.openForReading(item(1));
  assert.deepEqual(await cancel.files.printToken(f2.token), { printed: false });
  const old = await setup({ version: '0.9.98' });
  await assert.rejects(old.files.printToken('x'), (e) => e.name === 'UnsupportedError');
  assert.equal(old.sdk.printed.length, 0);
});

test('Bulk.printSequence: מדפיס ברצף, עוצר בביטול, וממשיך מהמקום שעצר', async () => {
  const { sdk, files, caps } = await setup({ folder: false });
  const app = {
    files,
    caps,
    state: { logEvent: () => {} },
    full: async (it) => it,
  };
  const items = [item(1), item(2), item(3)];
  const log = [];
  const done = await A.Bulk.printSequence(app, items, (k, s) => log.push(k + ':' + s));
  assert.deepEqual(done, { done: 3, stoppedAt: -1, reason: '' });
  assert.deepEqual(log, [
    '0:printing',
    '0:printed',
    '1:printing',
    '1:printed',
    '2:printing',
    '2:printed',
  ]);
  assert.equal(sdk.printed.length, 3);

  const cancelling = await setup({ folder: false, sdk: { scenario: 'print-cancel' } });
  const app2 = {
    files: cancelling.files,
    caps: cancelling.caps,
    state: { logEvent: () => {} },
    full: async (it) => it,
  };
  const stopped = await A.Bulk.printSequence(app2, items, () => {});
  assert.deepEqual(stopped, { done: 0, stoppedAt: 0, reason: 'cancelled' });
  const single = await A.Bulk.printSequence(app, items, () => {}, { from: 1, single: true });
  assert.deepEqual(single, { done: 1, stoppedAt: -1, reason: '' });
  assert.equal(A.Bulk.canPrint(app), true);
  assert.equal(A.Bulk.canPrint({ caps: new Capabilities({ log: quiet }) }), false);
});
