// מה שהמניפסט, הקוד, התיעוד וה-HTML חייבים להסכים עליו. כל אחד נכתב במקום אחר,
// ושגיאה ביניהם שקטה: כתובת שלא באישור, הרשאה מיותרת, סקריפט שלא נטען.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPlugin } = require('./helpers/load');

const A = loadPlugin();
const Core = A.Core;
const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

test('גרסת התוסף במניפסט זהה לקבוע בקוד', () => {
  assert.equal(manifest.version, Core.PLUGIN_VERSION);
  assert.equal(manifest.id, Core.PLUGIN_ID);
});

test('שם התוסף עד 14 תווים ושווה לכותרת הלשונית', () => {
  assert.ok(manifest.name.length <= 14, manifest.name);
  assert.equal(manifest.contributes.toolTab.title, manifest.name);
});

// הוולידטור הרשמי חוסם תיאור ארוך מזה, ושם זה מתגלה רק ב-CI.
test('תיאור קצר: עד 150 תווים', () => {
  assert.ok(manifest.description.length <= 150, String(manifest.description.length));
});

test('הרשאות מינימליות: רשת, קבצי משתמש, פתיחת כתובת, וקורא אוצריא (להדפסה)', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['app.open_url', 'fs.user_files.read', 'library.books.read', 'library.refresh', 'network.access', 'reader.open']);
  // הרשאות בסיס (storage, theme.changed) ניתנות אוטומטית ואינן מוצהרות.
  for (const p of manifest.permissions) assert.ok(!/^plugin\.storage|^events\.subscribe|^app\.info/.test(p), p);
  assert.equal(manifest.network.enabled, true);
  assert.equal(manifest.minAppVersion, '0.9.98');
});

test('כתובות הקבצים בקוד זהות ל-network.allowlist (פרט לקטלוג)', () => {
  const list = manifest.network.allowlist;
  assert.ok(list.includes(Core.CATALOG_BASE.replace(/\/$/, '')), 'ערך הקטלוג');
  for (const prefix of Core.FILE_PREFIXES) assert.ok(list.includes(prefix), prefix + ' חסר במניפסט');
  assert.deepEqual(
    list.filter((x) => !Core.FILE_PREFIXES.includes(x)),
    [Core.CATALOG_BASE.replace(/\/$/, '')],
  );
  // קידומת מדויקת (לא דומיין גנרי), https, בלי / בסוף.
  for (const entry of list) {
    assert.match(entry, /^https:\/\/[a-z0-9.-]+\/.+[^/]$/, entry);
  }
});

test('docs/ALLOWLIST_REQUEST.md: הבלוק להדבקה זהה למניפסט, שורה לכל קידומת עם הערה', () => {
  const doc = fs.readFileSync(path.join(root, '..', 'docs', 'ALLOWLIST_REQUEST.md'), 'utf8');
  const block = /```text allowlist\n([\s\S]*?)```/.exec(doc)[1].trim().split('\n');
  const entries = block.filter((l) => !l.startsWith('#'));
  assert.deepEqual(entries.sort(), [...manifest.network.allowlist].sort());
  // כל ערך מקדים הערה.
  block.forEach((line, i) => {
    if (!line.startsWith('#')) assert.ok(block[i - 1] && block[i - 1].startsWith('#'), 'אין הערה לפני ' + line);
  });
});

test('אייקון הלשונית בפורמט התקני, והסמל הוא PNG 64x64', () => {
  assert.match(manifest.contributes.toolTab.iconName, /_24_(regular|filled)$/);
  const png = fs.readFileSync(path.join(root, manifest.icon));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(png.readUInt32BE(20), 64);
});

test('כל סקריפט ב-HTML קיים, כל קובץ ב-js/ נטען, והסדר מקיים את התלויות', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of scripts) assert.ok(fs.existsSync(path.join(root, src)), src);
  for (const name of fs.readdirSync(path.join(root, 'js'))) assert.ok(scripts.includes('js/' + name), 'נטען ב-index.html: ' + name);
  const order = (name) => scripts.findIndex((src) => src.endsWith(name));
  const before = (a, b) => assert.ok(order(a) >= 0 && order(a) < order(b), a + ' לפני ' + b);
  before('alonim-i18n.js', 'en.js');
  before('en.js', 'alonim-core.js');
  before('alonim-core.js', 'alonim-normalize.js');
  before('alonim-normalize.js', 'alonim-rules.js');
  before('alonim-rules.js', 'alonim-index.js');
  before('alonim-runtime.js', 'alonim-state.js');
  before('alonim-icons.js', 'alonim-ui.js');
  before('alonim-ui.js', 'alonim-ui-cards.js');
  before('alonim-ui-cards.js', 'alonim-ui-week.js');
  before('alonim-app.js', 'alonim-ui-shell.js');
  before('alonim-ui-shell.js', 'alonim-main.js');
  assert.equal(scripts[scripts.length - 1], 'js/alonim-main.js');
});

test('אין בחבילה קבצי פיתוח', () => {
  assert.match(read('.otzignore'), /^test\/$/m);
});

test('אין שום כתובת קשיחה לשרת שאינו בהצהרת הרשת (קוד התוסף)', () => {
  const allowed = new Set(['raw.githubusercontent.com', 'ladaat.co', 'tashma.co.il', 'gilyoines.com', 'alonolam.com', 'beinenu.com', 'github.com', 'www.w3.org']);
  for (const name of fs.readdirSync(path.join(root, 'js'))) {
    if (name === 'alonim-icons.js') continue;
    const code = read('js', name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) assert.ok(allowed.has(m[1].toLowerCase()), name + ': ' + m[0]);
  }
});
