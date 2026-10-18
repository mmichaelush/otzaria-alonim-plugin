// חוזה סטטי בין הקוד שבונה את ה-DOM לבין style.css: מחלקה בלי עיצוב היא רכיב שנראה
// שבור, ועיצוב בלי מחלקה הוא קוד מת. (מחלקות שמורכבות בזמן ריצה נבדקות גם
// ב-tools/preview/smoke.mjs: כל מחלקה שמופיעה ב-DOM חייבת להיות מעוצבת.)
// בנוסף: כללי האבטחה והארכיטקטורה מ-AGENTS.md.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const css = read('css', 'style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const html = read('index.html');
const files = fs.readdirSync(path.join(root, 'js')).filter((name) => name.endsWith('.js'));
const sources = Object.fromEntries(files.map((name) => [name, read('js', name)]));
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const scripts = Object.values(sources).map(stripComments).join('\n');

/** מחלקות שמשמשות רק כווי לקוד או לסימון, ואין להן עיצוב משלהן. */
const HOOKS = new Set([
  'week-page',
  'all-page',
  'mine-page',
  'settings-page',
  'builder-host',
  'select-sort',
  'select-value',
  'results-list',
  'series-list',
  'series-issues',
  'live-region',
  'cycle-hero',
  'topic-page',
  'topic-title',
  'topic-when-text',
  'topic-filters',
  'topic-list',
  'is-unread',
  'dialog-close',
]);

/** כל מילה בתוך מחרוזת ליטרלית בקוד, וגם קידומות ('chip-' + kind). */
function tokensInCode() {
  const tokens = new Set();
  const prefixes = new Set();
  for (const m of scripts.matchAll(
    /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g,
  )) {
    const text = m[1] ?? m[2] ?? m[3] ?? '';
    for (const word of text.split(/\s+/)) {
      if (/^[a-z][a-z0-9-]*$/.test(word)) tokens.add(word);
      if (/^[a-z][a-z0-9-]*-$/.test(word)) prefixes.add(word);
    }
  }
  for (const m of html.matchAll(/class="([^"]+)"/g))
    for (const word of m[1].split(/\s+/)) tokens.add(word);
  return { tokens, prefixes };
}

const styled = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]));

/** שמות מחלקה שהקוד מציב: class: '…', className: '…', classList.*, ' is-…'. */
function classesUsed() {
  const used = new Set();
  const add = (list) =>
    list
      .split(/\s+/)
      .filter(Boolean)
      .forEach((name) => used.add(name));
  for (const m of html.matchAll(/class="([^"]+)"/g)) add(m[1]);
  for (const m of scripts.matchAll(/class:\s*'([^']+)'/g)) add(m[1]);
  for (const m of scripts.matchAll(/className:\s*'([^']+)'/g)) add(m[1]);
  for (const m of scripts.matchAll(/' (is-[a-z-]+)'/g)) add(m[1]);
  for (const m of scripts.matchAll(/classList\.(?:add|toggle|remove)\('([^']+)'/g)) add(m[1]);
  for (const m of scripts.matchAll(/setAttribute\('class', '([a-z -]+)'\)/g)) add(m[1]);
  for (const kind of ['filled', 'tonal', 'outlined', 'text', 'danger']) used.add('button-' + kind);
  for (const name of [...used]) if (name.endsWith('-')) used.delete(name);
  return used;
}

test('כל מחלקה שהקוד מציב מעוצבת', () => {
  const missing = [...classesUsed()].filter((name) => !styled.has(name) && !HOOKS.has(name));
  assert.deepEqual(missing, []);
});

test('אין ב-style.css מחלקות שאף רכיב אינו משתמש בהן', () => {
  const { tokens, prefixes } = tokensInCode();
  const orphans = [...styled].filter(
    (name) => !tokens.has(name) && ![...prefixes].some((p) => name.startsWith(p)),
  );
  assert.deepEqual(orphans, []);
});

test('כל אייקון שהקוד מבקש קיים בקובץ האייקונים', () => {
  const available = new Set(
    [...read('js', 'alonim-icons.js').matchAll(/^ {4}([a-z0-9_]+): \{ path/gm)].map((m) => m[1]),
  );
  const requested = new Set(
    [...scripts.matchAll(/'([a-z0-9_]+_24_(?:regular|filled))'/g)].map((m) => m[1]),
  );
  const missing = [...requested].filter((name) => !available.has(name));
  assert.deepEqual(missing, []);
  assert.ok(requested.size > 20);
});

test('לכל כפתור אייקון יש תווית נגישה (ארגומנט שני שאינו ריק)', () => {
  for (const m of scripts.matchAll(/iconButton\(\s*[^,()]+,\s*([^,]+),/g))
    assert.ok(m[1].trim() !== "''" && m[1].trim() !== '""', m[0]);
  assert.match(scripts, /'aria-label': label/);
});

// ---------------------------------------------------------------- אבטחה

test('אין innerHTML, outerHTML, insertAdjacentHTML, document.write, eval או new Function', () => {
  for (const [name, text] of Object.entries(sources)) {
    const code = stripComments(text);
    assert.equal(
      /\.(?:innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(
        code,
      ),
      false,
      name,
    );
  }
});

test('קריאות SDK רק דרך alonim-runtime.js (וחיבור האירועים ב-alonim-main.js)', () => {
  for (const [name, text] of Object.entries(sources)) {
    if (name === 'alonim-runtime.js' || name === 'alonim-main.js') continue;
    const code = stripComments(text);
    assert.equal(
      /\bOtzaria\s*\.\s*(?:call|on|off)\b|window\.Otzaria/.test(code),
      false,
      name + ' פונה ל-Otzaria ישירות',
    );
    assert.equal(/\.bridge\.call\(/.test(code), false, name);
  }
});

test('אין טלמטריה ואין fetch חיצוני: רשת רק דרך network.* ו-fetchText', () => {
  for (const [name, text] of Object.entries(sources)) {
    const code = stripComments(text);
    // `fetch` מותר רק לקריאת כותרת קובץ מקומי ב-alonim-files.js (כתובת מ-openFolderFile).
    if (name === 'alonim-files.js') continue;
    assert.equal(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket\(/.test(code), false, name);
  }
});

test('כל פתיחת כתובת עוברת אימות: app.openUrl רק מ-alonim-files.js (openOnSite)', () => {
  for (const [name, text] of Object.entries(sources)) {
    const code = stripComments(text);
    if (name === 'alonim-files.js') continue;
    assert.equal(/app\.openUrl/.test(code), false, name);
    assert.equal(/window\.open\(|location\.href\s*=/.test(code), false, name);
  }
  assert.match(
    sources['alonim-files.js'],
    /isSiteUrl\(url, extraHosts\) && !Core\.isDownloadUrl|!Core\.isSiteUrl\(url, extraHosts\) && !Core\.isDownloadUrl/,
  );
});

test('טקסט מהקטלוג נכנס רק דרך textContent / צמתי טקסט', () => {
  // `el(...)` מוסיף מחרוזות כצמתי טקסט; אסור לבנות HTML ממחרוזת.
  assert.match(sources['alonim-ui.js'], /createTextNode/);
  for (const [name, text] of Object.entries(sources)) {
    assert.equal(
      /<\w+[^>]*>\s*['"`]\s*\+|\+\s*['"`]<\/?\w+/.test(stripComments(text)),
      false,
      name + ': בניית HTML ממחרוזות',
    );
  }
});
