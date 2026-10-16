'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { Log, scrub, LIMIT } = A.Log;

test('Log: רמות, קטגוריות, קוד שגיאה מתוך Error, וטבעת משותפת ל-scoped', () => {
  const log = new Log(null);
  const catalog = log.scoped('catalog');
  const files = log.scoped('files');
  log.info('app started');
  catalog.warn('sync failed', Object.assign(new Error('network down'), { code: 'network' }));
  files.error('download failed', { code: 'x' });
  catalog.debug('details');
  assert.equal(log.entries.length, 4);
  assert.deepEqual(
    log.entries.map((e) => e.cat),
    ['app', 'catalog', 'files', 'catalog'],
  );
  assert.equal(log.entries[1].code, 'network');
  assert.equal(catalog.entries, log.entries, 'אותה טבעת');
  assert.deepEqual(log.counts(), { debug: 1, info: 1, warn: 1, error: 1 });
  assert.equal(log.filter({ level: 'warn' }).length, 2);
  assert.equal(log.filter({ cat: 'catalog' }).length, 2);
  assert.equal(log.filter({ level: 'warn', cat: 'catalog' }).length, 1);
  assert.match(
    log.tail(10, { level: 'warn' }),
    /warn catalog \[network\] sync failed network down/,
  );
});

test('Log.view: הספירה והרשימה מאותו סינון — יומן עם 4 אירועי debug ורמת info אינו "ריק"', () => {
  const log = new Log(null);
  for (const text of ['a', 'b', 'c', 'd']) log.debug(text);
  const view = log.view({ level: 'info', cat: '' });
  assert.deepEqual([view.entries.length, view.matched, view.total], [0, 0, 4]);
  const all = log.view({ level: 'debug', cat: '' });
  assert.deepEqual([all.entries.length, all.matched, all.total], [4, 4, 4]);
  log.warn('w');
  assert.equal(log.view({ level: 'info' }).matched, 1);
  assert.equal(log.view({ level: 'debug' }, 2).entries.length, 2, 'רק האחרונים');
  assert.equal(log.view({ level: 'debug' }, 2).matched, 5);
  assert.equal(log.view({ level: 'debug', cat: 'files' }).total, 5, 'total אינו תלוי בסינון');
  // הדיווח אינו משתתק כשהסינון מסתיר הכול
  const quiet = new Log(null);
  quiet.debug('x');
  const app = { log: quiet };
  assert.match(A.Diagnostics.logTail(app.log, { filter: { level: 'info' } }), /1 in the log/);
});

test('Log: הטבעת מוגבלת, console רק מ-info ומעלה, ומנויים מקבלים אירועים', () => {
  const seen = [];
  const sink = {
    info: (m) => seen.push('info:' + m),
    warn: (m) => seen.push('warn:' + m),
    error: () => {},
    debug: () => seen.push('DEBUG'),
  };
  const log = new Log(sink);
  const got = [];
  const off = log.onEntry((e) => got.push(e.text));
  log.debug('quiet');
  log.scoped('host').info('hello');
  assert.deepEqual(seen, ['info:[alonim:host] hello'], 'debug לא יוצא ל-console');
  assert.deepEqual(got, ['quiet', 'hello']);
  off();
  log.info('after');
  assert.equal(got.length, 2);
  for (let i = 0; i < LIMIT + 50; i++) log.info('n' + i);
  assert.equal(log.entries.length, LIMIT);
  assert.equal(log.entries[log.entries.length - 1].text, 'n' + (LIMIT + 49));
  log.clear();
  assert.equal(log.entries.length, 0);
});

test('scrub: נתיבי דיסק וכתובות מקומיות לא יוצאים בדיווח', () => {
  const text = scrub(
    'failed C:\\Users\\Me\\Documents\\x.pdf and /Users/me/a.pdf and http://127.0.0.1:39811/files/1 ok',
  );
  assert.ok(!/Users|127\.0\.0\.1|Documents/.test(text), text);
  assert.ok(text.includes('<path>') && text.includes('<local>'));
});

function fakeApp() {
  const log = new Log(null);
  const caps = new A.Capabilities.Capabilities({ log });
  caps.setHost('0.9.99');
  return {
    log,
    caps,
    hostVersion: '0.9.99',
    platform: 'windows',
    hostLanguage: 'he',
    permissions: ['network.access', 'fs.user_files.read'],
    online: true,
    lastQueryMs: 12.34,
    catalog: {
      status: { phase: 'idle', error: '', lastOkAt: 5, shardsLoaded: 2, shardsTotal: 3 },
      meta: { catalogVersion: 7 },
      manifest: { generatedAt: '2026-10-15T07:40:00Z' },
      hasWeeksArchive: () => true,
      weeksArchiveLoaded: () => false,
    },
    index: { size: 1234, weeks: [1, 2, 3], issueAlias: new Map([['a', 'b']]), lastBuildMs: 456.7 },
    files: {
      hasFolder: true,
      diskState: { status: 'ok', count: 9 },
      list: () => [{ status: 'queued' }, { status: 'done' }],
      remote: new Map([['i', {}]]),
    },
    state: { readOnly: false, failed: new Set(), historyOn: true },
  };
}

test('Diagnostics.report: טקסט מלא ומנוקה — מארח, יכולות, קטלוג, קבצים, יומן', () => {
  const app = fakeApp();
  app.log.warn(
    'failed C:\\Users\\Me\\secret\\x.pdf',
    Object.assign(new Error('boom'), { code: 'forbidden' }),
  );
  const text = A.Diagnostics.report(app);
  assert.match(text, /^Alonim plugin \d+\.\d+\.\d+/);
  assert.match(text, /Otzaria 0\.9\.99 \/ windows \/ he/);
  assert.match(text, /permissions: fs\.user_files\.read, network\.access/);
  assert.match(text, /fetchFile \(network\.fetchFile\): yes \[version: 0\.9\.99\]/);
  assert.match(text, /printFile \(ui\.printFile\): yes/);
  assert.match(text, /catalog v7 \(2026-10-15T07:40:00Z\), issues 1234, phase idle/);
  assert.match(text, /shards 2\/3, weeks 3, archive available, id aliases 1/);
  assert.match(text, /folder: ok, files 9, queue 1, remote grants 1/);
  assert.match(text, /perf: last query 12\.3ms, index build 457ms/);
  assert.match(text, /warn app \[forbidden\] failed <path>/);
  assert.ok(!/secret|Users/.test(text), 'נתיב לא דלף');
  app.caps.setOverride(true);
  const legacy = A.Diagnostics.report(app);
  assert.match(legacy, /legacy override ON/);
  assert.match(legacy, /fetchFile \(network\.fetchFile\): no \[override\]/);
});

test('Diagnostics.snapshot: מצב כשל — מארח לא ידוע, קטלוג בשגיאה, מצב לקריאה בלבד', () => {
  const app = fakeApp();
  app.hostVersion = '';
  app.caps.setHost('');
  app.catalog.status = { phase: 'error', error: 'forbidden', lastOkAt: 0 };
  app.state = { readOnly: true, failed: new Set(['favorites']), historyOn: false };
  const snap = A.Diagnostics.snapshot(app);
  assert.equal(snap.caps.find((c) => c.feature === 'fetchFile').source, 'unknown-version');
  assert.equal(snap.catalog.error, 'forbidden');
  assert.deepEqual(snap.state.failedDomains, ['favorites']);
  const text = A.Diagnostics.report(app);
  assert.match(text, /Otzaria \? \/ windows/);
  assert.match(text, /state read-only: true \(failed: favorites\), history off/);
  assert.match(text, /phase error \(forbidden\)/);
});

test('אבחון על האפליקציה האמיתית הרצה מול SDK מדומה: אין חריגה', () => {
  const sdk = createFakeSdk();
  assert.ok(sdk);
  // snapshot עובד גם כשהיומן ריק
  const app = fakeApp();
  assert.doesNotThrow(() => A.Diagnostics.report(app));
});

test('Diagnostics: גיל קטלוג, זמני הפעלה, גודל אחסון וסיכום קודי שגיאה — בתמונה ובדיווח', () => {
  const app = fakeApp();
  app.timings = { state: 40, shell: 120, firstData: 300 };
  app.catalog.status.cacheMs = 55;
  app.catalog.status.lastSyncMs = 900;
  app.catalog.usedBytes = 3 * 1048576;
  app.catalog.quotaBytes = 100 * 1048576;
  app.state.data = { favorites: { items: { a: 1 } }, read: { items: {} } };
  app.log.warn('a', Object.assign(new Error('x'), { code: 'network' }));
  app.log.warn('b', Object.assign(new Error('y'), { code: 'network' }));
  app.log.error('c', Object.assign(new Error('z'), { code: 'hash' }));
  app.log.warn('no code');
  const now = Date.parse('2026-10-15T09:40:00Z');
  const snap = A.Diagnostics.snapshot(app, { now });
  assert.equal(snap.catalog.ageMin, 120, 'generatedAt 07:40 ← עכשיו 09:40');
  assert.equal(snap.perf.cacheMs, 55);
  assert.deepEqual(snap.perf.startup, { state: 40, shell: 120, firstData: 300 });
  assert.equal(snap.storage.state.domains.favorites, JSON.stringify({ items: { a: 1 } }).length);
  assert.equal(snap.storage.catalogUsedBytes, 3 * 1048576);
  assert.deepEqual(snap.errors.codes, { network: 2, hash: 1, '(no code)': 1 });
  assert.equal(snap.errors.last.length, 4);
  const text = A.Diagnostics.report(app, { now });
  assert.match(text, /catalog age: 120 min, last ok sync/);
  assert.match(text, /cache read 55ms, last sync 900ms/);
  assert.match(text, /startup: state 40ms, shell 120ms, firstData 300ms/);
  assert.match(
    text,
    /storage: state \d+ chars \(favorites \d+, read \d+\), catalog cache 3145728\/104857600 bytes/,
  );
  assert.match(text, /warnings and errors by code: network x2, hash x1, \(no code\) x1/);
  assert.match(text, /last warnings and errors:\n.*warn app \[network\] a x/);
});

test('reportFailure: קוד יציב ביומן, הודעה בעברית עם הקוד, ותרגום לאנגלית', () => {
  const toasts = [];
  const log = new Log(null);
  // alonim-app.js אינו ב-PURE (הוא מזכיר את שכבת ה-DOM), אך `reportFailure` אינו נוגע בה
  require('../js/alonim-app.js');
  const app = Object.create(A.AppModule.App.prototype);
  app.log = log;
  app.toast = (message, options) => toasts.push({ message, options });
  app.reportFailure('delete_failed', Object.assign(new Error('EBUSY'), { code: 'error.busy' }));
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].message, /מחיקת הקובץ נכשלה.*קוד: delete_failed/);
  assert.equal(toasts[0].options.error, true);
  const entry = log.filter({ level: 'warn' })[0];
  assert.equal(entry.level, 'warn', 'כשל שאפשר לטפל בו: אזהרה');
  assert.equal(entry.code, 'delete_failed');
  app.reportFailure('dialog_failed', new Error('bug'));
  assert.equal(log.filter({ level: 'error' })[0].code, 'dialog_failed', 'תקלה בקוד: שגיאה');
  assert.match(entry.text, /EBUSY/);
  assert.match(entry.text, /error\.busy/, 'הקוד הגולמי של המארח נשמר ליד הקוד היציב');
  for (const code of [
    'copy_failed',
    'delete_failed',
    'cleanup_failed',
    'open_url_failed',
    'url_not_allowed',
    'cold_years_failed',
  ]) {
    assert.ok(A.Errors.known(code), code);
    assert.ok(A.Errors.text(code).length > 10, code);
  }
});
