'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { createRuntime, SdkError, NetError } = A.Runtime;
const { State } = A.State;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };

function runtimeFor(sdk, extra) {
  return createRuntime(sdk, { logger: quiet, ...extra });
}

test('call מחזיר data, וכשל הופך ל-SdkError עם הקוד', async () => {
  const sdk = createFakeSdk();
  const rt = runtimeFor(sdk);
  assert.equal(await rt.call('storage.get', { key: 'x' }), null);
  await assert.rejects(
    rt.call('nope.method'),
    (e) => e instanceof SdkError && e.code === 'error.unknown_method' && e.isUnsupported,
  );
  assert.equal(await rt.callSoft('nope.method', {}, 7), 7);
});

test('פרץ של 200 קריאות עובר דרך מגביל הקצב בלי להידחות', async () => {
  const sdk = createFakeSdk({ noInjectedLimit: true });
  const rt = runtimeFor(sdk);
  const results = await Promise.all(
    Array.from({ length: 200 }, (_, i) => rt.call('storage.set', { key: 'k' + i, value: i })),
  );
  assert.equal(results.length, 200);
  assert.equal(sdk.rateLimited, 0, 'המגביל המקומי מנע דחייה אצל המארח');
});

test('ללא מגביל מקומי הצוק של אוצריא נופל בקריאה ה-51 (הבסיס לבדיקה הקודמת)', async () => {
  const sdk = createFakeSdk({ noInjectedLimit: true, now: () => 0 });
  let rejected = 0;
  for (let i = 0; i < 80; i++) {
    const res = await sdk.call('storage.get', { key: 'k' });
    if (!res.success) rejected++;
  }
  assert.equal(rejected, 30);
});

test('fetchText: טקסט, 404, והודעת allowlist הופכת ל-forbidden', async () => {
  const base = 'https://raw.githubusercontent.com/mmichaelush/otzaria-alonim-plugin/data/';
  const sdk = createFakeSdk({ catalog: { 'a.json': '[1,2,3]' } });
  const rt = runtimeFor(sdk);
  assert.equal((await rt.fetchText(base + 'a.json')).text, '[1,2,3]');
  await assert.rejects(
    rt.fetchText(base + 'missing.json'),
    (e) => e instanceof NetError && e.code === 'http' && e.status === 404,
  );
  await assert.rejects(rt.fetchText('https://other.example/x'), (e) => e.code === 'forbidden');
  const offline = runtimeFor(createFakeSdk({ scenario: 'offline' }));
  await assert.rejects(offline.fetchText(base + 'a.json'), (e) => e.code === 'network');
  await assert.rejects(
    rt.fetchText(base + 'a.json', { maxBytes: 3 }),
    (e) => e.code === 'too_large',
  );
});

test('on: חריגה במטפל נרשמת ואינה בורחת כדחייה', async () => {
  const errors = [];
  const sdk = createFakeSdk();
  const rt = createRuntime(sdk, { logger: { ...quiet, error: (...a) => errors.push(a) } });
  rt.on('plugin.boot', () => {
    throw new Error('boom');
  });
  await sdk.emit('plugin.boot', {});
  assert.equal(errors.length, 1);
});

// ------------------------------------------------------------------- State

function stateFor(sdk) {
  return new State(runtimeFor(sdk), { saveDelay: 0, log: quiet });
}

test('State: שמירה וטעינה חוזרת של כל התחומים', async () => {
  const sdk = createFakeSdk();
  const s = stateFor(sdk);
  await s.load();
  const item = {
    id: 'i_1',
    series: 's_1',
    seriesTitle: 'סדרה',
    title: 'סדרה',
    hy: 5787,
    date: '2026-10-17',
    parasha: ['noach'],
  };
  assert.equal(s.toggleFavorite(item), true);
  s.markRead(item, true);
  s.setSeries('s_1', { follow: true, src: 'ladaat' });
  s.addRule({ action: 'hide', field: 'lang', value: 'yi' });
  const list = s.createList('לשבת');
  s.addToList(list.id, item);
  s.setPref('scale', 1.2);
  s.addOpened(item);
  await s.flush();
  const again = stateFor(sdk);
  await again.load();
  assert.equal(again.isFavorite('i_1'), true);
  assert.equal(again.isRead('i_1'), true);
  assert.equal(again.isFollowed('s_1'), true);
  assert.equal(again.preferredSource('s_1'), 'ladaat');
  assert.equal(again.rules.rules.length, 1);
  assert.equal(again.lists[0].entries[0].id, 'i_1');
  assert.equal(again.prefs.scale, 1.2);
  assert.equal(again.continueReading().length, 0, 'נקרא: לא ב"המשך קריאה"');
});

test('State: קריאה שנכשלה אינה מצב ריק — לא דורסים את המצב השמור', async () => {
  const sdk = createFakeSdk();
  sdk.storage.set('state_favorites', { v: 1, items: { i_9: { id: 'i_9', ti: 'שמור', t: 1 } } });
  const realCall = sdk.call;
  let failReads = true;
  sdk.call = async (method, payload) => {
    if (failReads && method === 'storage.get' && payload.key === 'state_favorites') {
      return { success: false, error: { code: 'error.internal' } };
    }
    return realCall(method, payload);
  };
  const s = stateFor(sdk);
  await s.load();
  assert.equal(s.readOnly, true);
  s.toggleFavorite({ id: 'i_new', title: 'חדש' });
  await s.flush();
  assert.deepEqual(
    Object.keys(sdk.storage.get('state_favorites').items),
    ['i_9'],
    'המצב השמור לא נדרס',
  );
  failReads = false;
  assert.equal(await s.retryFailed(), true);
  assert.equal(s.isFavorite('i_9'), true);
});

test('State: עקוב והשתק סותרים, וסדרה בלי מצב נמחקת', () => {
  const s = new State(runtimeFor(createFakeSdk()), { saveDelay: 0, log: quiet });
  s.setSeries('a', { follow: true });
  s.setSeries('a', { mute: true });
  assert.equal(s.isFollowed('a'), false);
  assert.equal(s.isMuted('a'), true);
  s.setSeries('a', { mute: false });
  assert.equal(s.data.series.items.a, undefined);
});

test('State: ייצוא וייבוא — סכימה, גרסה, ניקוי, מיזוג והחלפה', async () => {
  const sdk = createFakeSdk();
  const s = stateFor(sdk);
  await s.load();
  s.setPref('folder', { token: 't', name: 'n', path: 'C:/x' });
  s.addRule({ action: 'hide', field: 'lang', value: 'yi' });
  s.setSeries('s_1', { follow: true });
  const exported = JSON.parse(JSON.stringify(s.exportSettings()));
  assert.equal(exported.prefs.folder, null, 'ה-token של התיקייה אינו מיוצא');
  const target = stateFor(createFakeSdk());
  const preview = target.previewImport(JSON.stringify(exported));
  assert.equal(preview.ok, true);
  assert.equal(preview.summary.rules, 1);
  assert.equal(preview.summary.series, 1);
  target.applyImport(preview, 'merge');
  assert.equal(target.rules.rules.length, 1);
  target.applyImport(target.previewImport(JSON.stringify(exported)), 'merge');
  assert.equal(target.rules.rules.length, 1, 'מיזוג אינו מכפיל כללים');
  assert.equal(target.isFollowed('s_1'), true);

  assert.equal(target.previewImport('').error, 'empty');
  assert.equal(target.previewImport('{nope').error, 'json');
  assert.equal(target.previewImport('{"format":"other"}').error, 'format');
  assert.equal(target.previewImport(JSON.stringify({ ...exported, v: 9 })).error, 'too_new');
  const evil = target.previewImport(
    JSON.stringify({
      ...exported,
      rules: {
        v: 1,
        rules: [
          { action: 'hide', field: '__proto__', value: 'x' },
          { action: 'hide', field: 'lang', value: 'x'.repeat(5000) },
        ],
      },
    }),
  );
  assert.equal(evil.ok, true);
  assert.equal(evil.summary.rules, 1);
  assert.equal(evil.sections.rules.rules[0].value.length, 200);
});

test('State: מעבר מזהה סדרה ישן לחדש (previousIds)', () => {
  const s = new State(runtimeFor(createFakeSdk()), { saveDelay: 0, log: quiet });
  s.setSeries('old', { follow: true });
  s.addRule({ action: 'hide', field: 'series', value: 'old' });
  s.migrateSeriesIds((id) => (id === 'old' ? 'new' : id));
  assert.equal(s.isFollowed('new'), true);
  assert.equal(s.isFollowed('old'), false);
  assert.equal(s.rules.rules[0].value, 'new');
});
