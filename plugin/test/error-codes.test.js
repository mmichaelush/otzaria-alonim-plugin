'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPlugin } = require('./helpers/load');

const A = loadPlugin();
const { Errors, Boundary } = A;
const dir = path.join(__dirname, '..', 'js');
const sources = fs
  .readdirSync(dir)
  .map((name) => ({ name, code: fs.readFileSync(path.join(dir, name), 'utf8') }));

/** קודי שגיאה שהקוד יוצר: FileError('x'), NetError('x'), `code: 'x'` ב-throw/Object.assign. */
function usedCodes() {
  const used = new Map();
  const add = (code, where) => used.set(code, (used.get(code) || []).concat(where));
  for (const { name, code } of sources) {
    for (const m of code.matchAll(/(?:FileError|NetError)\('([a-z_]+)'/g)) add(m[1], name);
    for (const m of code.matchAll(
      /Object\.assign\(new Error\([^)]*\),\s*\{\s*code:\s*'([a-z_]+)'/g,
    ))
      add(m[1], name);
    for (const m of code.matchAll(/_fail\(\{\s*code:\s*'([a-z_]+)'/g)) add(m[1], name);
  }
  return used;
}

test('רישום הקודים: כל קוד שהקוד יוצר רשום, עם תחום וטקסט', () => {
  const used = usedCodes();
  assert.ok(used.size >= 15, [...used.keys()].join(','));
  const missing = [...used.keys()].filter((code) => !Errors.known(code));
  assert.deepEqual(missing, [], 'קודים שלא ברישום');
  for (const [code, entry] of Object.entries(Errors.CODES)) {
    assert.ok(['files', 'net', 'catalog', 'ui'].includes(entry.area), code);
    assert.ok(entry.text && typeof entry.retry === 'boolean', code);
  }
});

test('רישום הקודים: אין קוד רשום שאיש אינו משתמש בו (חוץ מקודי ממשק וחיבורים)', () => {
  const used = usedCodes();
  const allCode = sources.map((s) => s.code).join('\n');
  const unused = Object.keys(Errors.CODES).filter(
    (code) =>
      !used.has(code) &&
      !new RegExp('[\'"]' + code + '[\'"]').test(allCode.replace(/\/\/.*$/gm, '')),
  );
  assert.deepEqual(unused, []);
});

test('Errors.text/retryable: קוד לא מוכר אינו שובר, ותרגום לאנגלית', () => {
  assert.equal(Errors.text('no_such_code'), Errors.text('failed'));
  assert.equal(Errors.retryable('no_such_code'), true);
  assert.equal(Errors.retryable('blocked'), false);
  assert.equal(Errors.retryable('timeout'), true);
  A.I18n.configure('en');
  try {
    assert.match(Errors.text('timeout'), /took too long/);
    assert.match(Errors.text('screen_failed'), /went wrong/);
  } finally {
    A.I18n.configure('he');
  }
});

test('Boundary.protect: כשל סינכרוני ואסינכרוני נתפסים, התוצאה התקינה עוברת, ועטיפה כפולה בטוחה', async () => {
  class Screen {
    constructor() {
      this.calls = 0;
    }
    render() {
      this.calls++;
      return 'ok';
    }
    mount() {
      throw new Error('boom mount');
    }
    async refresh() {
      throw new Error('boom async');
    }
    other() {
      throw new Error('not guarded');
    }
  }
  const failures = [];
  Boundary.protect(Screen, (screen, method, error) => failures.push(method + ':' + error.message));
  Boundary.protect(Screen, () => failures.push('SECOND'));
  const s = new Screen();
  assert.equal(s.render(), 'ok');
  assert.equal(s.calls, 1, 'נקראה פעם אחת (בלי עטיפה כפולה)');
  assert.equal(s.mount(), undefined);
  await s.refresh();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(failures, ['mount:boom mount', 'refresh:boom async']);
  assert.throws(() => s.other(), /not guarded/, 'שיטה שאינה ברשימה לא נעטפת');
});
