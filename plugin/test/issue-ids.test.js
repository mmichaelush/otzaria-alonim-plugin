'use strict';

// גיליון שמזההו השתנה (`previousIds`): מצב המשתמש עובר למזהה החדש, ללא אובדן ובאופן
// אידמפוטנטי; קובץ שהורד תחת המזהה הישן עדיין מזוהה כהורד.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { State } = A.State;
const { CatalogIndex } = A.Index;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };

const snap = (id, extra) => ({ id, series: 's1', seriesTitle: 'עלון', title: 'כותרת', hy: 5787, date: '2026-10-17', parasha: ['noach'], ...extra });

async function stateWithHistory(clock) {
  const state = new State(A.Runtime.createRuntime(createFakeSdk(), { logger: quiet }), { saveDelay: 0, log: quiet, now: () => clock.t });
  await state.load();
  return state;
}

test('index: previousIds נרשמים, מזהה ישן נפתר לנוכחי, וגם שרשרת', () => {
  const index = new CatalogIndex();
  index.setSeries([{ id: 's1', title: 'עלון', lang: 'he' }]);
  index.addIssues([{ id: 'i_bbbbbbbbbbbb', series: 's1', title: 'x', hy: 5787, assets: [], previousIds: ['i_aaaaaaaaaaaa'] }], 'x');
  index.addIssues([{ id: 'i_cccccccccccc', series: 's1', title: 'y', hy: 5787, assets: [], previousIds: ['i_bbbbbbbbbbbb'] }], 'x');
  assert.equal(index.resolveIssueId('i_aaaaaaaaaaaa'), 'i_cccccccccccc', 'שרשרת א ← ב ← ג');
  assert.equal(index.resolveIssueId('i_bbbbbbbbbbbb'), 'i_cccccccccccc');
  assert.equal(index.resolveIssueId('i_unknown'), 'i_unknown');
  assert.deepEqual(index.previousIdsOf('i_bbbbbbbbbbbb'), ['i_aaaaaaaaaaaa']);
  const version = index.aliasVersion;
  index.addIssues([{ id: 'i_bbbbbbbbbbbb', series: 's1', title: 'x', hy: 5787, assets: [], previousIds: ['i_aaaaaaaaaaaa'] }], 'x');
  assert.equal(index.aliasVersion, version, 'טעינה חוזרת של אותו שרד אינה מגדילה את הגרסה');
  // שם גיליון בקבצים שירדו: הקידומת הישנה מובילה לגיליון הנוכחי
  assert.equal(index.byFragment(A.Core.idFragment('i_aaaaaaaaaaaa')).id, 'i_cccccccccccc');
});

test('state.migrateIssueIds: מעביר מועדפים, נקרא, אוספים, המשך קריאה, היסטוריה וכללים', async () => {
  const clock = { t: 1000 };
  const s = await stateWithHistory(clock);
  s.toggleFavorite(snap('i_old'));
  s.markRead(snap('i_old'), true);
  clock.t = 2000;
  const list = s.createList('רשימה');
  s.addToList(list.id, snap('i_old'));
  s.addToList(list.id, snap('i_other'));
  s.addOpened(snap('i_old'));
  s.logEvent('opened', snap('i_old'));
  s.addRule({ action: 'hide', field: 'issue', value: 'i_old', label: 'x' });
  const moved = s.migrateIssueIds((id) => (id === 'i_old' ? 'i_new' : id));
  assert.ok(moved >= 6, 'הועברו ' + moved);
  assert.equal(s.isFavorite('i_old'), false);
  assert.equal(s.isFavorite('i_new'), true);
  assert.equal(s.favoriteSnaps()[0].id, 'i_new');
  assert.equal(s.isRead('i_new'), true);
  assert.equal(s.isRead('i_old'), false);
  assert.deepEqual(s.lists[0].entries.map((e) => e.id), ['i_new', 'i_other']);
  assert.equal(s.data.opened.items[0].id, 'i_new');
  assert.equal(s.historyEvents()[0].id, 'i_new');
  assert.equal(s.rules.rules.find((r) => r.field === 'issue').value, 'i_new');
  // אידמפוטנטי
  assert.equal(s.migrateIssueIds((id) => (id === 'i_old' ? 'i_new' : id)), 0);
});

test('state.migrateIssueIds: כשיש מצב גם למזהה הישן וגם לחדש — ממוזגים ולא אובדים', async () => {
  const clock = { t: 5000 };
  const s = await stateWithHistory(clock);
  s.toggleFavorite(snap('i_old', { title: 'ישן' }));
  clock.t = 9000;
  s.toggleFavorite(snap('i_new', { title: 'חדש' }));
  s.markRead(snap('i_old'), true);
  clock.t = 12000;
  s.markRead(snap('i_new'), true);
  const list = s.createList('רשימה');
  s.addToList(list.id, snap('i_old'));
  s.addToList(list.id, snap('i_new'));
  s.addOpened(snap('i_old'));
  s.addOpened(snap('i_new'));
  s.migrateIssueIds((id) => (id === 'i_old' ? 'i_new' : id));
  assert.equal(s.favoriteSnaps().length, 1, 'מועדף אחד');
  assert.equal(s.favoriteSnaps()[0].ti, 'חדש', 'הרשומה של המזהה החדש גוברת');
  assert.equal(s.data.read.items.i_new, 12000, 'זמן הקריאה המאוחר');
  assert.deepEqual(s.lists[0].entries.map((e) => e.id), ['i_new'], 'בלי כפילות באוסף');
  assert.equal(s.data.opened.items.length, 1);
});

test('state.migrateIssueIds: מזהה שאינו בשימוש או שאינו משתנה — בלי שינוי ובלי כתיבה', async () => {
  const clock = { t: 1 };
  const s = await stateWithHistory(clock);
  s.toggleFavorite(snap('i_stay'));
  await s.flush();
  s.dirty.clear();
  assert.equal(s.migrateIssueIds((id) => id), 0);
  assert.equal(s.dirty.size, 0, 'לא סימן דבר לשמירה');
});

test('files: קובץ שירד תחת מזהה קודם עדיין נחשב כהורד, ונפתח בלי הורדה חדשה', () => {
  const sdk = createFakeSdk();
  const index = new CatalogIndex();
  index.setSeries([{ id: 's1', title: 'עלון', lang: 'he' }]);
  index.addIssues([{ id: 'i_nnnnnnnnnnnn', series: 's1', title: 'x', hy: 5787, assets: [], previousIds: ['i_oooooooooooo'] }], 'x');
  const files = new A.Files.Files(A.Runtime.createRuntime(sdk, { logger: quiet }), { log: quiet, previousIds: (id) => index.previousIdsOf(id), getFolder: () => ({ token: 't', name: 'n', path: '/f' }) });
  const item = { id: 'i_nnnnnnnnnnnn' };
  assert.equal(files.isDownloaded(item), false);
  files.disk.set(A.Core.idFragment('i_oooooooooooo'), { path: '5787/עלון/x [oooooooo].pdf', name: 'x [oooooooo].pdf', size: 10, modified: null });
  assert.equal(files.isDownloaded(item), true);
  assert.equal(files.diskEntry(item).path, '5787/עלון/x [oooooooo].pdf');
  assert.equal(files.fragmentOf(item), 'oooooooo');
  files.disk.set(A.Core.idFragment('i_nnnnnnnnnnnn'), { path: 'new.pdf', name: 'new.pdf', size: 1, modified: null });
  assert.equal(files.fragmentOf(item), 'nnnnnnnn', 'אם יש גם קובץ תחת המזהה החדש — הוא גובר');
});
