'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { createRuntime } = A.Runtime;
const { State } = A.State;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };

function make(sdk, now) {
  return new State(createRuntime(sdk || createFakeSdk(), { logger: quiet }), {
    saveDelay: 0,
    log: quiet,
    now: now || (() => 1000),
  });
}

test('מצב לשונית: נשמר ונטען, מסננים מנוקים', async () => {
  const sdk = createFakeSdk();
  const s = make(sdk);
  await s.load();
  s.setViewState('all', {
    query: 'נח',
    filters: { lang: 'he', hy: [5787, 'x'], junk: 1 },
    sort: 'date',
    group: 'year',
    includeHidden: true,
  });
  await s.flush();
  const again = make(sdk);
  await again.load();
  assert.deepEqual(again.viewState('all'), {
    query: 'נח',
    filters: { lang: ['he'], hy: [5787] },
    sort: 'date',
    group: 'year',
    includeHidden: true,
  });
  assert.equal(again.viewState('nope'), null);
});

test('הגדרות חיפוש שמורות: שמירה, עדכון בשם קיים, מחיקה ושחזור', async () => {
  const s = make();
  await s.load();
  const p = s.savePreset('חסידי באידיש', {
    query: 'lang:yi',
    filters: { circle: ['חסידי'] },
    sort: 'new',
  });
  assert.ok(p.id);
  assert.equal(s.presets.length, 1);
  s.savePreset('חסידי באידיש', { query: 'lang:en', filters: {}, sort: 'date' });
  assert.equal(s.presets.length, 1, 'שם קיים מתעדכן');
  assert.equal(s.presets[0].query, 'lang:en');
  const removed = s.deletePreset(p.id);
  assert.equal(s.presets.length, 0);
  s.restorePreset(removed);
  assert.equal(s.presets.length, 1);
  assert.equal(s.savePreset('   ', { query: 'x' }).name, '—', 'שם ריק מקבל מקף');
  for (let k = 0; k < 40; k++) s.savePreset('p' + k, { query: String(k) });
  assert.equal(s.presets.length, 30, 'תקרה של 30');
});

test('ביקור: הבסיס קבוע בתוך ביקור, ועובר אחרי פער של שעות', async () => {
  let t = 1_000_000;
  const sdk = createFakeSdk();
  const s = make(sdk, () => t);
  await s.load();
  s.beginVisit();
  assert.equal(s.visitBase, 1_000_000, 'ביקור ראשון: עכשיו');
  t += 3600 * 1000;
  s.beginVisit();
  assert.equal(s.visitBase, 1_000_000, 'אותו ביקור');
  t += 7 * 3600 * 1000;
  s.beginVisit();
  assert.equal(s.visitBase, 1_000_000 + 3600 * 1000, 'ביקור חדש: הבסיס הוא הפעם האחרונה שנראה');
  s.markVisited();
  assert.equal(s.visitBase, t);
  await s.flush();
  const again = make(sdk, () => t + 10);
  await again.load();
  assert.equal(again.visitBase, t);
});

test('ייצוא וייבוא: ההגדרות השמורות עוברות, מצב הלשוניות והביקור לא', async () => {
  const s = make();
  await s.load();
  s.savePreset('א', { query: 'q1', filters: { lang: ['he'] }, sort: 'date' });
  s.setViewState('all', { query: 'x', filters: {}, sort: 'date' });
  s.beginVisit();
  const exported = JSON.parse(JSON.stringify(s.exportSettings()));
  assert.equal(exported.views.presets.length, 1);
  assert.equal(exported.views.tabs, undefined, 'מצב לשוניות אינו מיוצא');
  const other = make();
  await other.load();
  other.savePreset('ב', { query: 'q2' });
  const preview = other.previewImport(JSON.stringify(exported));
  assert.ok(preview.ok);
  assert.equal(preview.summary.presets, 1);
  other.applyImport(preview, 'merge');
  assert.deepEqual(other.presets.map((p) => p.name).sort(), ['א', 'ב']);
  other.applyImport(other.previewImport(JSON.stringify(exported)), 'merge');
  assert.equal(other.presets.length, 2, 'ייבוא חוזר אינו מכפיל');
  other.applyImport(other.previewImport(JSON.stringify(exported)), 'replace');
  assert.deepEqual(
    other.presets.map((p) => p.name),
    ['א'],
  );
  assert.equal(other.viewState('all'), null);
});

test('קריאה שנכשלה של views אינה דורסת מצב אמיתי', async () => {
  const sdk = createFakeSdk();
  sdk.storage.set('state_views', {
    v: 1,
    tabs: {},
    presets: [{ id: 'p1', name: 'שמור', query: 'q', filters: {}, sort: 'date', t: 1 }],
    lastSeen: 5,
    visitBase: 5,
  });
  const realCall = sdk.call;
  let fail = true;
  sdk.call = async (method, payload) => {
    if (fail && method === 'storage.get' && payload.key === 'state_views')
      return { success: false, error: { code: 'error.internal' } };
    return realCall(method, payload);
  };
  const s = make(sdk);
  await s.load();
  assert.equal(s.readOnly, true);
  s.savePreset('חדש', { query: 'z' });
  await s.flush();
  assert.deepEqual(
    sdk.storage.get('state_views').presets.map((p) => p.name),
    ['שמור'],
    'המצב השמור לא נדרס',
  );
  fail = false;
  assert.equal(await s.retryFailed(), true);
  assert.deepEqual(
    s.presets.map((p) => p.name),
    ['שמור'],
  );
});
