'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { createRuntime } = A.Runtime;
const { State } = A.State;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };
const item = (n) => ({
  id: 'i_' + n,
  series: 's_1',
  seriesTitle: 'עלון',
  title: 'עלון ' + n,
  hy: 5787,
  date: '2026-10-17',
  parasha: ['noach'],
});

function make(sdk, clock) {
  const state = new State(createRuntime(sdk || createFakeSdk(), { logger: quiet }), {
    saveDelay: 0,
    log: quiet,
    now: () => clock.t,
  });
  return state;
}

test('היסטוריה: אירועים מהחדש לישן, כפילות באותה דקה נספרת פעם אחת', async () => {
  const clock = { t: 1_000_000 };
  const s = make(null, clock);
  await s.load();
  s.logEvent('opened', item(1));
  clock.t += 5000;
  s.logEvent('opened', item(1));
  assert.equal(s.historyEvents().length, 1, 'אותו גיליון ואותו סוג בתוך דקה');
  clock.t += 5000;
  s.logEvent('read', item(1));
  clock.t += 120000;
  s.logEvent('opened', item(1));
  clock.t += 1;
  s.logEvent('downloaded', item(2));
  s.logEvent('printed', item(2));
  assert.deepEqual(
    s.historyEvents().map((e) => e.k),
    ['printed', 'downloaded', 'opened', 'read', 'opened'],
  );
  assert.deepEqual(
    s.historyEvents('opened').map((e) => e.id),
    ['i_1', 'i_1'],
  );
  s.logEvent('bogus', item(3));
  assert.equal(s.historyEvents().length, 5, 'סוג לא מוכר נדחה');
});

test('היסטוריה: מחיקת אירוע בודד, ניקוי וביטול הניקוי', async () => {
  const clock = { t: 1 };
  const s = make(null, clock);
  await s.load();
  for (let n = 0; n < 4; n++) {
    clock.t += 100000;
    s.logEvent('opened', item(n));
  }
  const [newest] = s.historyEvents();
  s.removeEvent(newest);
  assert.equal(s.historyEvents().length, 3);
  const old = s.clearEvents();
  assert.equal(s.historyEvents().length, 0);
  s.restoreEvents(old);
  assert.equal(s.historyEvents().length, 3);
  assert.ok(s.historyEvents()[0].t > s.historyEvents()[2].t, 'הסדר נשמר');
});

test('היסטוריה: תקרת 300 אירועים', async () => {
  const clock = { t: 1 };
  const s = make(null, clock);
  await s.load();
  for (let n = 0; n < 330; n++) {
    clock.t += 100000;
    s.logEvent('opened', item(n));
  }
  assert.equal(s.historyEvents().length, 300);
  assert.equal(s.historyEvents()[0].id, 'i_329');
});

test('חיפושים אחרונים: ייחודיים, האחרון ראשון, קצרים נדחים, מחיקה וניקוי', async () => {
  const clock = { t: 1 };
  const s = make(null, clock);
  await s.load();
  s.addSearch('נח');
  s.addSearch('א');
  s.addSearch('  אסיפת גליונות ');
  s.addSearch('נח');
  assert.deepEqual(
    s.searches.map((x) => x.q),
    ['נח', 'אסיפת גליונות'],
  );
  s.removeSearch('נח');
  assert.deepEqual(
    s.searches.map((x) => x.q),
    ['אסיפת גליונות'],
  );
  for (let n = 0; n < 40; n++) s.addSearch('חיפוש ' + n);
  assert.equal(s.searches.length, 25);
  s.clearSearches();
  assert.equal(s.searches.length, 0);
});

test('סדרות שנצפו לאחרונה', async () => {
  const clock = { t: 1 };
  const s = make(null, clock);
  await s.load();
  s.viewSeries('s_a');
  s.viewSeries('s_b');
  s.viewSeries('s_a');
  assert.deepEqual(
    s.recentSeries().map((x) => x.id),
    ['s_a', 's_b'],
  );
});

test('כיבוי ההיסטוריה: לא נרשם דבר (גם לא המשך קריאה), והנתונים הקיימים נשארים עד ניקוי', async () => {
  const clock = { t: 1 };
  const s = make(null, clock);
  await s.load();
  s.logEvent('opened', item(1));
  s.addOpened(item(1));
  s.setPref('history', false);
  assert.equal(s.historyOn, false);
  s.logEvent('opened', item(2));
  s.addSearch('לא יירשם');
  s.viewSeries('s_x');
  s.addOpened(item(2));
  assert.equal(s.historyEvents().length, 1);
  assert.equal(s.searches.length, 0);
  assert.equal(s.recentSeries().length, 0);
  assert.equal(s.continueReading().length, 1, 'ההמשך קריאה הקיים לא נמחק');
  s.clearHistory();
  assert.equal(s.historyEvents().length, 0);
  assert.equal(s.continueReading().length, 0);
});

test('היסטוריה: נשמרת ונטענת, ואינה בייצוא', async () => {
  const clock = { t: 5 };
  const sdk = createFakeSdk();
  const s = make(sdk, clock);
  await s.load();
  s.logEvent('read', item(1));
  s.addSearch('נח');
  await s.flush();
  const again = make(sdk, clock);
  await again.load();
  assert.equal(again.historyEvents().length, 1);
  assert.equal(again.searches[0].q, 'נח');
  const exported = JSON.stringify(s.exportSettings());
  assert.ok(!exported.includes('i_1'), 'אין אירועי היסטוריה בייצוא');
  assert.ok(!exported.includes('"searches"'));
});

test('נתוני היסטוריה פגומים מנוקים בטעינה', async () => {
  const sdk = createFakeSdk();
  sdk.storage.set('state_history', {
    v: 1,
    events: [{ id: 'i_1', k: 'opened', t: 5 }, { id: 'i_2', k: 'weird', t: 1 }, 7, null],
    searches: [{ q: 'ok', t: 1 }, { q: '', t: 2 }, 'x'],
    series: [{ id: 's', t: 1 }, {}],
  });
  const s = make(sdk, { t: 1 });
  await s.load();
  assert.deepEqual(
    s.historyEvents().map((e) => e.id),
    ['i_1'],
  );
  assert.deepEqual(
    s.searches.map((x) => x.q),
    ['ok'],
  );
  assert.deepEqual(
    s.recentSeries().map((x) => x.id),
    ['s'],
  );
});

test('שני חלונות: שמירה באיבוד מיקוד וקריאה מחדש במיקוד — שינוי של חלון אחד אינו נדרס בחלון השני', async () => {
  const clock = { t: 1_000_000 };
  const sdk = createFakeSdk();
  const a = make(sdk, clock);
  const b = make(sdk, clock);
  await a.load();
  await b.load();
  a.setFavorite(item(1), true);
  await a.flush();
  // בלי רענון, b היה כותב את התחום כולו בלי המועדף של a. הרענון (מיקוד) מביא אותו קודם.
  const changed = await b.refresh();
  assert.deepEqual(changed, ['favorites']);
  assert.equal(b.isFavorite('i_1'), true);
  b.setFavorite(item(2), true);
  await b.flush();
  await a.refresh();
  assert.equal(a.isFavorite('i_2'), true);
  const stored = sdk.storage.get('state_favorites');
  assert.deepEqual(Object.keys(stored.items).sort(), ['i_1', 'i_2'], 'שניהם נשמרו');
});

test('refresh: תחום עם שינוי מקומי שלא נשמר אינו נדרס; תחום שנכשלה קריאתו אינו נקרא; views אינו מתרענן', async () => {
  const clock = { t: 1_000_000 };
  const sdk = createFakeSdk();
  const a = make(sdk, clock);
  const b = make(sdk, clock);
  await a.load();
  await b.load();
  a.setFavorite(item(1), true);
  await a.flush();
  b.delay = 60000; // שינוי ממתין לשמירה
  b.setFavorite(item(2), true);
  assert.ok(b.dirty.has('favorites'));
  assert.ok(!(await b.refresh()).includes('favorites'), 'השינוי המקומי נשמר בזיכרון');
  assert.equal(b.isFavorite('i_1'), false);
  clearTimeout(b.timer);
  await b.flush();
  b.failed.add('read');
  sdk.storage.set('state_read', { v: 1, items: { i_9: { id: 'i_9', t: 1 } } });
  assert.ok(!(await b.refresh()).includes('read'), 'תחום שנכשל אינו נקרא');
  b.failed.delete('read');
  const viewsBefore = JSON.stringify(b.data.views);
  sdk.storage.set('state_views', {
    v: 1,
    tabs: { all: { query: 'x' } },
    presets: [],
    lastSeen: 5,
    visitBase: 5,
  });
  await b.refresh();
  assert.equal(JSON.stringify(b.data.views), viewsBefore, 'מצב מסך אינו מתרענן');
});
