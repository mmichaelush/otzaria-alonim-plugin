// תיקוני הביקורת (קבצים וצפיין): הענקות (tokens) שדלפו, מרוץ סריקה והחלפת תיקייה, תור שגדל.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { createRuntime } = A.Runtime;
const { Files } = A.Files;
const { Capabilities } = A.Capabilities;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

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
      bytes: 3000,
    },
  ],
});

async function setup(options) {
  const o = options || {};
  const sdk = createFakeSdk(o.sdk);
  let now = 1_000_000;
  const runtime = createRuntime(sdk, { logger: quiet, sleep: async () => {} });
  const caps = new Capabilities({ log: quiet });
  caps.setHost('0.9.99');
  let folder = null;
  const files = new Files(runtime, {
    log: quiet,
    sleep: async () => {},
    now: () => now,
    caps,
    getFolder: () => folder,
    setFolder: (f) => (folder = f),
  });
  if (o.folder !== false) await files.pickFolder();
  return { sdk, files, advance: (ms) => (now += ms) };
}

test('openRemote: פתיחה והכנה מראש במקביל מורידות פעם אחת, ואין token יתום', async () => {
  const { sdk, files } = await setup({ folder: false, sdk: { netDelay: 0 } });
  const [a, b, c] = await Promise.all([
    files.openForReading(item(1)),
    files.openForReading(item(1)),
    files.openForReading(item(1)),
  ]);
  assert.equal(sdk.fetchedFiles.length, 1);
  assert.equal(a.token, b.token);
  assert.equal(b.token, c.token);
  await tick();
  assert.equal(sdk.revoked.length, 0);
});

test('openRemote: ענקה שפגה (TTL) מוחלפת, והישנה מבוטלת', async () => {
  const { sdk, files, advance } = await setup({ folder: false });
  const first = await files.openForReading(item(1));
  advance(11 * 60 * 1000);
  const second = await files.openForReading(item(1));
  assert.notEqual(first.token, second.token);
  await tick();
  assert.deepEqual(sdk.revoked, [first.token]);
  assert.equal(files.remote.size, 1);
});

test('releaseFile: token של קובץ מהתיקייה מבוטל; קובץ מרוחק נשאר במטמון', async () => {
  const remote = await setup({ folder: false });
  const r = await remote.files.openForReading(item(1));
  remote.files.releaseFile(r);
  await tick();
  assert.equal(remote.sdk.revoked.length, 0, 'מרוחק: ללא ביטול');

  const local = await setup();
  const it = item(2);
  local.files.disk.set(A.Core.idFragment(it.id), {
    path: '5787/עלון/x [000000000002].pdf',
    name: 'x [000000000002].pdf',
    size: 3000,
  });
  local.sdk.userFs.set(local.files.absolute('5787/עלון/x [000000000002].pdf'), {
    type: 'file',
    size: 3000,
    content: '%PDF-1.4 ' + 'x'.repeat(3000),
  });
  const f = await local.files.openForReading(it);
  assert.equal(f.remote, undefined);
  local.files.releaseFile(f);
  await tick();
  assert.deepEqual(local.sdk.revoked, [f.token]);
  local.files.releaseFile(null);
  local.files.releaseFile(undefined);
});

test('סריקת דיסק: החלפת תיקייה באמצע לא דורסת את המפה החדשה', async () => {
  const { files } = await setup();
  files._list = async (path) => {
    await tick();
    if (!path) return { entries: [{ type: 'dir', name: '5787', path: '5787' }] };
    if (path === '5787') return { entries: [{ type: 'dir', name: 'עלון', path: '5787/עלון' }] };
    return {
      entries: [
        {
          type: 'file',
          name: 'a [' + A.Core.idFragment(item(1).id) + '].pdf',
          path: '5787/עלון/a [' + A.Core.idFragment(item(1).id) + '].pdf',
          size: 3000,
        },
      ],
    };
  };
  const scanning = files.scan();
  // המשתמש בוחר תיקייה אחרת לפני שהסריקה של הקודמת מסתיימת
  files.setFolder({ token: 'other-folder', path: 'C:/Other', name: 'Other' });
  files.disk = new Map();
  const state = await scanning;
  assert.equal(files.disk.size, 0, 'התוצאה של התיקייה הישנה נזרקה');
  assert.notEqual(state.status, 'ok');
  // סריקה של התיקייה הנוכחית עובדת כרגיל
  assert.equal((await files.scan()).status, 'ok');
  assert.equal(files.disk.size, 1);
});

test('תור: עבודות שהסתיימו אינן גדלות בלי גבול', async () => {
  const { files } = await setup();
  for (let n = 1; n <= 260; n++) {
    const job = files.enqueue(item(n), 'save');
    files.cancel(job.id);
  }
  await tick();
  const finished = files.list().filter((j) => j.status !== 'queued' && j.status !== 'active');
  assert.ok(finished.length <= 200, 'נשארו ' + finished.length);
  assert.equal(files.order.length, files.jobs.size, 'order ו-jobs עקביים');
});

test('כותרת הקובץ שנבדקת אחרי הורדה לא משאירה token מוענק', async () => {
  const { sdk, files } = await setup();
  const job = files.enqueue(item(3), 'save');
  await job.done;
  await tick();
  assert.equal(job.status, 'done');
  // כל token שנפתח לבדיקת הכותרת בוטל
  const opened = sdk.calls.filter((c) => c.method === 'fs.openFolderFile').length;
  assert.equal(sdk.revoked.length, opened);
});
