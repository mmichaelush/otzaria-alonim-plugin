'use strict';

// docs/DEBUGGING.md מתעד כל קוד שגיאה: אותם קודים, אותו תחום, ואותה התנהגות "חוזר?" כמו ברישום.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPlugin } = require('./helpers/load');

const A = loadPlugin();
const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'DEBUGGING.md'), 'utf8');
const AREA = { files: 'קבצים', net: 'רשת', catalog: 'קטלוג', ui: 'ממשק' };

/** שורות הטבלה "קודי שגיאה": `code` | תחום | חוזר? */
function documented() {
  const rows = new Map();
  for (const line of doc.split(/\r?\n/)) {
    const m = /^\|\s*`([a-z_]+)`\s*\|\s*([^|]+?)\s*\|\s*(כן|לא)\s*\|/.exec(line);
    if (m) rows.set(m[1], { area: m[2], retry: m[3] === 'כן' });
  }
  return rows;
}

test('DEBUGGING.md: כל קוד שגיאה רשום בטבלה, בלי קודים שאינם ברישום', () => {
  const rows = documented();
  const registry = Object.keys(A.Errors.CODES).sort();
  assert.deepEqual([...rows.keys()].sort(), registry);
});

test('DEBUGGING.md: התחום וניסיון החוזר בטבלה זהים לרישום', () => {
  const rows = documented();
  for (const [code, entry] of Object.entries(A.Errors.CODES)) {
    assert.equal(rows.get(code).area, AREA[entry.area], code + ' area');
    assert.equal(rows.get(code).retry, entry.retry, code + ' retry');
  }
});

test('DEBUGGING.md: התרחישים של ה-SDK המדומה שמוזכרים קיימים בו', () => {
  const sdk = fs.readFileSync(
    path.join(__dirname, '..', '..', 'tools', 'preview', 'fake-sdk.js'),
    'utf8',
  );
  const section = doc.slice(doc.indexOf('| `scenario=`'), doc.indexOf('בדף: `window.__alonimApp`'));
  const names = [...section.matchAll(/`([a-z][a-z-]+)`/g)]
    .map((m) => m[1])
    .filter((n) => n !== 'scenario');
  assert.ok(names.length >= 15, names.join(','));
  for (const name of names) {
    if (name === 'host') continue;
    assert.ok(sdk.includes("'" + name + "'") || sdk.includes(name), 'תרחיש ' + name);
  }
});
