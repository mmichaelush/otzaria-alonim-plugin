'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { Bulk } = A;
const { State } = A.State;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };

const item = (n, over) => ({
  id: 'i_' + n,
  series: 's_' + (n % 2),
  seriesTitle: 'סדרה ' + (n % 2),
  title: 'כותרת ' + n,
  hy: 5787,
  date: '2026-10-17',
  parasha: ['noach'],
  assets: [{ src: 'ladaat', page: 'https://ladaat.co/gilyonot/view/' + n }],
  ...over,
});

async function fakeApp(extra) {
  const state = new State(A.Runtime.createRuntime(createFakeSdk(), { logger: quiet }), { saveDelay: 0, log: quiet });
  await state.load();
  const toasts = [];
  const events = [];
  const queued = [];
  const app = {
    state,
    toasts,
    events,
    queued,
    toast: (m, o) => toasts.push({ m, o }),
    emit: (name, payload) => events.push({ name, payload }),
    files: { hasFolder: true, isDownloaded: (it) => it.id === 'i_2' },
    full: async (it) => it,
    pickSiteAsset: (it) => it.assets[0],
    queueSave: async (it) => {
      queued.push(it.id);
      return { id: it.id };
    },
    ...extra,
  };
  return app;
}

test('exportLine: סדרה · שבוע · שנה (תאריך) — כתובת', () => {
  const line = Bulk.exportLine(item(1), 'https://x.example/1');
  assert.equal(line, 'סדרה 1 · נח · תשפ״ז (ו׳ בחשוון תשפ״ז · 17.10.2026) — https://x.example/1');
  assert.equal(Bulk.exportLine(item(1, { date: null, hy: 0, parasha: [] }), ''), 'סדרה 1');
});

test('exportText: שורה לגיליון עם כתובת דף המקור; מעל התקרה — בלי כתובות', async () => {
  const app = await fakeApp();
  const small = await Bulk.exportText(app, [item(1), item(2)]);
  assert.equal(small.linked, true);
  assert.equal(small.text.split('\n').length, 2);
  assert.ok(small.text.includes('https://ladaat.co/gilyonot/view/1'));
  const many = Array.from({ length: Bulk.MAX_LINKED_EXPORT + 1 }, (_, k) => item(k));
  const big = await Bulk.exportText(app, many);
  assert.equal(big.linked, false);
  assert.ok(!big.text.includes('https://'));
  assert.equal(big.text.split('\n').length, many.length);
});

test('exportText: כשהפרטים המלאים אינם זמינים — שורה בלי כתובת', async () => {
  const app = await fakeApp({ full: async () => null });
  const result = await Bulk.exportText(app, [item(1)]);
  assert.ok(!result.text.includes('https://'));
  assert.ok(result.text.startsWith('סדרה 1'));
});

test('download: מדלג על שהורד, ומבקש תיקייה כשאין', async () => {
  const app = await fakeApp();
  const n = await Bulk.download(app, [item(1), item(2), item(3)]);
  assert.equal(n, 2);
  assert.deepEqual(app.queued, ['i_1', 'i_3']);
  const noFolder = await fakeApp({ files: { hasFolder: false, isDownloaded: () => false } });
  assert.equal(await Bulk.download(noFolder, [item(1)]), 0);
  assert.equal(noFolder.events[0].name, 'need-folder');
  assert.equal(noFolder.queued.length, 0);
});

test('favorite ו-read: משנים רק את מה שצריך וסופרים נכון', async () => {
  const app = await fakeApp();
  assert.equal(Bulk.favorite(app, [item(1), item(2)], true), 2);
  assert.equal(Bulk.favorite(app, [item(1), item(2), item(3)], true), 1, 'שניים כבר מועדפים');
  assert.equal(Bulk.favorite(app, [item(1)], false), 1);
  assert.equal(app.state.isFavorite('i_1'), false);
  assert.equal(app.state.isFavorite('i_2'), true);
  assert.equal(Bulk.read(app, [item(1), item(2)], true), 2);
  assert.equal(Bulk.read(app, [item(1), item(2)], true), 0);
  assert.equal(Bulk.read(app, [item(1)], false), 1);
  assert.equal(app.state.isRead('i_1'), false);
  assert.equal(app.state.isRead('i_2'), true);
  assert.deepEqual(app.state.historyEvents('read').map((e) => e.id).sort(), ['i_1', 'i_2']);
});

test('hideSeries: כלל אחד לכל סדרה, וביטול אחד מסיר את כולם', async () => {
  const app = await fakeApp();
  const n = Bulk.hideSeries(app, [item(1), item(2), item(3), item(4)]);
  assert.equal(n, 2, 'שתי סדרות שונות');
  assert.equal(app.state.rules.rules.filter((r) => r.field === 'series').length, 2);
  const undo = app.toasts[app.toasts.length - 1].o.action;
  undo.run();
  assert.equal(app.state.rules.rules.length, 0);
});

test('state.setFavorite: קובע במפורש ואינו מחליף מצב', async () => {
  const app = await fakeApp();
  app.state.setFavorite(item(1), true);
  app.state.setFavorite(item(1), true);
  assert.equal(app.state.isFavorite('i_1'), true);
  app.state.setFavorite(item(1), false);
  app.state.setFavorite(item(1), false);
  assert.equal(app.state.isFavorite('i_1'), false);
});
