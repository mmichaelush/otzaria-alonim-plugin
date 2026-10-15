'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPlugin } = require('./helpers/load');
const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');

const A = loadPlugin();
const { Capabilities, UnsupportedError, FEATURES, MIN_VERSION, versionAtLeast } = A.Capabilities;
const { createRuntime } = A.Runtime;
const quiet = { warn() {}, error() {}, debug() {}, info() {} };

test('גרסאות: השוואה מספרית, גרסה חסרה או עם סיומת', () => {
  assert.equal(versionAtLeast('0.9.99', '0.9.99'), true);
  assert.equal(versionAtLeast('0.9.100', '0.9.99'), true, '100 > 99 (לא השוואת מחרוזות)');
  assert.equal(versionAtLeast('0.9.98', '0.9.99'), false);
  assert.equal(versionAtLeast('1.0.0', '0.9.99'), true);
  assert.equal(versionAtLeast('0.9.99-dev', '0.9.99'), true);
  assert.equal(versionAtLeast('', '0.9.99'), false);
  assert.equal(versionAtLeast('0.10', '0.9.99'), true);
});

test('הכרעה: גרסה לא ידועה או ישנה — אין; ≥0.9.99 — יש', () => {
  const caps = new Capabilities({ log: quiet });
  assert.deepEqual(caps.status('fetchFile'), {
    available: false,
    source: 'unknown-version',
    detail: '',
  });
  caps.setHost('0.9.98');
  assert.equal(caps.has('fetchFile'), false);
  assert.equal(caps.status('printFile').source, 'old-version');
  caps.setHost('0.9.99');
  for (const feature of Object.keys(FEATURES)) assert.equal(caps.has(feature), true, feature);
  assert.equal(caps.has('nonexistent'), false);
  assert.equal(caps.report().length, Object.keys(FEATURES).length);
  assert.ok(caps.report().every((r) => r.available && r.source === 'version'));
});

test('ביטול ידני (תאימות לאחור) גובר על הגרסה, וניתן להחזרה', () => {
  const caps = new Capabilities({ log: quiet });
  caps.setHost('0.9.99');
  caps.setOverride(true);
  assert.equal(caps.has('fetchFile'), false);
  assert.equal(caps.status('fetchFile').source, 'override');
  caps.setOverride(false);
  assert.equal(caps.has('fetchFile'), true);
});

test('call: מארח חדש — עובר; מארח ישן — UnsupportedError בלי קריאה; unknown_method נלמד', async () => {
  const sdk = createFakeSdk();
  const runtime = createRuntime(sdk, { logger: quiet });
  const caps = new Capabilities({ log: quiet });
  caps.setHost('0.9.99');
  const data = await caps.call('fetchFile', runtime, {
    url: 'https://ladaat.co/gilyonot/uploads/x.pdf',
  });
  assert.ok(data.token && data.url);
  assert.equal((await caps.call('printFile', runtime, { token: data.token })).printed, true);

  const old = new Capabilities({ log: quiet });
  old.setHost('0.9.98');
  const before = sdk.calls.length;
  await assert.rejects(
    old.call('fetchFile', runtime, { url: 'x' }),
    (e) => e instanceof UnsupportedError && e.feature === 'fetchFile',
  );
  assert.equal(sdk.calls.length, before, 'מארח ישן: אין קריאה בכלל');

  // הגרסה אומרת "יש" אבל המארח אומר "אין שיטה": נלמד, ולא מנסים שוב
  const legacy = createFakeSdk({ legacyHost: true });
  const lie = new Capabilities({ log: quiet });
  lie.setHost('0.9.99');
  const legacyRuntime = createRuntime(legacy, { logger: quiet });
  await assert.rejects(lie.call('fetchFile', legacyRuntime, { url: 'x' }), UnsupportedError);
  assert.equal(lie.status('fetchFile').source, 'learned');
  const calls = legacy.calls.length;
  await assert.rejects(lie.call('fetchFile', legacyRuntime, { url: 'x' }), UnsupportedError);
  assert.equal(legacy.calls.length, calls, 'אחרי הלמידה אין קריאה נוספת');
  assert.equal(lie.has('printFile'), true, 'יכולת אחרת לא נפגעת');
  lie.reset('fetchFile');
  assert.equal(lie.has('fetchFile'), true);
});

test('call: שגיאה אחרת (חסימת allowlist) עוברת כמות שהיא ואינה נלמדת כחסר יכולת', async () => {
  const sdk = createFakeSdk();
  const runtime = createRuntime(sdk, { logger: quiet });
  const caps = new Capabilities({ log: quiet });
  caps.setHost('0.9.99');
  await assert.rejects(
    caps.call('fetchFile', runtime, { url: 'https://evil.example/x.pdf' }),
    (e) => e.code === 'error.forbidden' && !e.isUnsupported,
  );
  assert.equal(caps.has('fetchFile'), true);
});

test('השיטות החדשות רשומות כאופציונליות, מהגרסה הנכונה, עם הרשאה מוצהרת', () => {
  const sdk = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'sdk-methods.json'), 'utf8'),
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  for (const [feature, spec] of Object.entries(FEATURES)) {
    if (!spec.method) continue;
    const info = sdk.optional.methods[spec.method];
    assert.ok(info, feature + ': חסר ב-sdk-methods.json (optional)');
    assert.equal(info.since, MIN_VERSION);
    if (info.permission)
      assert.ok(
        manifest.permissions.includes(info.permission),
        spec.method + ' דורש ' + info.permission,
      );
  }
  assert.ok(
    versionAtLeast(MIN_VERSION, manifest.minAppVersion),
    'minAppVersion אינו מחייב את המארח החדש: היכולות אופציונליות',
  );
  assert.notEqual(manifest.minAppVersion, MIN_VERSION);
});

test('המוצר אינו פונה ל-localhost: אין כתובת 127.0.0.1 או localhost בקוד התוסף (כלי ה-QA בלבד)', () => {
  const dir = path.join(__dirname, '..', 'js');
  for (const name of fs.readdirSync(dir)) {
    const code = fs
      .readFileSync(path.join(dir, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // רק כתובת ממשית (http://127.0.0.1…) או שער ה-QA; בדיקות הגנה ("לא localhost") מותרות.
    assert.ok(
      !/https?:\/\/(?:127\.0\.0\.1|localhost)|:39811/.test(code),
      name + ' מזכיר כתובת localhost',
    );
  }
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8');
  assert.ok(!/127\.0\.0\.1|localhost|39811/.test(manifest), 'המניפסט מזכיר localhost');
});
