'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPlugin } = require('./helpers/load');

const A = loadPlugin();
const { normalizeKey, searchKey, highlightSpans } = A.Normalize;
const Core = A.Core;

test('normalizeKey: ניקוד, מקפים, מרכאות, סופיות, אותיות לטיניות', () => {
  assert.equal(normalizeKey('בְּרֵאשִׁית'), 'בראשית');
  assert.equal(normalizeKey('רש"י'), 'רשי');
  assert.equal(normalizeKey("ה'תשפ״ז"), 'התשפז');
  assert.equal(normalizeKey('לך־לך'), 'לכ לכ');
  assert.equal(normalizeKey('לך-לך / שבת'), 'לכ לכ שבת');
  assert.equal(normalizeKey('  The   WEEKLY  '), 'the weekly');
  assert.equal(normalizeKey('סוף מלך'), 'סופ מלכ');
  assert.equal(normalizeKey(null), '');
});

test('searchKey: פיסוק הופך לרווח', () => {
  assert.equal(searchKey('נח, (תשפ"ז)'), 'נח תשפז');
});

test('highlightSpans: מיקום במחרוזת המקורית, גם עם ניקוד ומרכאות', () => {
  const spans = highlightSpans('אסיפת גליונות - נח', ['נח']);
  assert.deepEqual(spans, [[16, 18]]);
  assert.deepEqual(highlightSpans('רש"י על התורה', ['רשי']), [[0, 4]]);
  assert.deepEqual(highlightSpans('abc', ['zz']), []);
  // התאמה רק בתחילת מילה.
  assert.deepEqual(highlightSpans('בנח', ['נח']), []);
});

test('זהות normalizeKey מול catalog/lib/normalize.mjs (כשהקובץ קיים)', async (t) => {
  const file = path.join(__dirname, '..', '..', 'catalog', 'lib', 'normalize.mjs');
  if (!fs.existsSync(file)) {
    t.skip('catalog/lib/normalize.mjs עדיין לא קיים בריפו הזה');
    return;
  }
  const { normalizeKey: catalogKey } = await import(require('node:url').pathToFileURL(file).href);
  const samples = ['בְּרֵאשִׁית', 'רש"י', "ה'תשפ״ז", 'לך־לך', 'a/b\\c_d', 'The  WEEKLY', 'סוף מלך', 'ﬁne', '“שבת”', '—', 'אסיפת גליונות - נח', '[37] אסיפה', 'x\u200Fy', 'a.b,c;d(e)'];
  for (const s of samples) assert.equal(normalizeKey(s), catalogKey(s), JSON.stringify(s));
});

test('hyLetters ו-parseYear הפוכים זה לזה', () => {
  assert.equal(Core.hyLetters(5787), 'תשפ"ז');
  assert.equal(Core.hyLetters(5775), 'תשע"ה');
  assert.equal(Core.hyLetters(5715), 'תשט"ו');
  assert.equal(Core.parseYear('תשפ"ז'), 5787);
  assert.equal(Core.parseYear('תשפז'), 5787);
  assert.equal(Core.parseYear('5787'), 5787);
  assert.equal(Core.parseYear('787'), 5787);
  assert.equal(Core.parseYear('נח'), null);
  for (let y = 5700; y < 5800; y++) assert.equal(Core.parseYear(Core.hyLetters(y)), y);
});

test('כתובות: https בלבד, דומיין ונתיב ברשימה', () => {
  const ok = 'https://ladaat.co/gilyonot/uploads/2026-10-17/files/[37]-אסיפת-גליונות-נח.pdf';
  assert.equal(Core.isDownloadUrl(ok), true);
  assert.equal(Core.isDownloadUrl('http://ladaat.co/gilyonot/uploads/a.pdf'), false);
  assert.equal(Core.isDownloadUrl('https://ladaat.co/gilyonot/uploadsX/a.pdf'), false, 'גבול נתיב');
  assert.equal(Core.isDownloadUrl('https://ladaat.co/other/a.pdf'), false);
  assert.equal(Core.isDownloadUrl('https://evil.example/gilyonot/uploads/a.pdf'), false);
  assert.equal(Core.isDownloadUrl('https://user:pw@ladaat.co/gilyonot/uploads/a.pdf'), false);
  assert.equal(Core.isDownloadUrl('https://127.0.0.1/gilyonot/uploads/a.pdf'), false);
  assert.equal(Core.isDownloadUrl('file:///c:/x.pdf'), false);
  assert.equal(Core.isDownloadUrl('https://gilyoines.com/storage/x.pdf'), true);
  assert.equal(Core.isSiteUrl('https://ladaat.co/gilyonot/view/5'), true);
  assert.equal(Core.isSiteUrl('https://www.tashma.co.il/'), true);
  assert.equal(Core.isSiteUrl('https://evil.example/'), false);
  assert.equal(Core.isSiteUrl('https://beinenu.example/', ['beinenu.example']), true);
  assert.equal(Core.isSiteUrl('javascript:alert(1)'), false);
});

test('sanitizeFileName: בלי נתיב, בלי .., בלי שמות שמורים', () => {
  assert.equal(Core.sanitizeFileName('../../etc/passwd'), 'etc passwd');
  assert.equal(Core.sanitizeFileName('a<b>c:"d"|e?f*'), 'a b c d e f');
  assert.equal(Core.sanitizeFileName('con'), '_con');
  assert.equal(Core.sanitizeFileName('...'), '_');
  assert.equal(Core.sanitizeFileName('שם. '), 'שם');
  assert.ok(Core.sanitizeFileName('x'.repeat(300), 50).length <= 50);
  assert.equal(/[\\/:*?"<>|]/.test(Core.sanitizeFileName('a/b\\c')), false);
});

test('downloadPath: שנה/סדרה/קובץ עם מזהה, ואפשר לחלץ אותו חזרה', () => {
  const item = { id: 'i_8c11d0e47a93', hy: 5787, title: 'אסיפת גליונות', parasha: ['noach'], no: 21, date: '2026-10-17' };
  const p = Core.downloadPath(item, 'אסיפת גליונות');
  assert.equal(p.dir, '5787/אסיפת גליונות');
  assert.match(p.file, /^אסיפת גליונות - נח - #21 \[8c11d0e4\]\.pdf$/);
  assert.equal(Core.fragmentFromFile(p.file), '8c11d0e4');
  assert.equal(Core.downloadPath({ ...item, hy: null }, 'x').dir.startsWith('ללא שנה/'), true);
});

test('upcomingShabbat', () => {
  assert.equal(Core.ymd(Core.upcomingShabbat(new Date(2026, 9, 15, 12))), '2026-10-17');
  assert.equal(Core.ymd(Core.upcomingShabbat(new Date(2026, 9, 17, 12))), '2026-10-17');
  assert.equal(Core.ymd(Core.upcomingShabbat(new Date(2026, 9, 18, 12))), '2026-10-24');
});

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

test('normalizeKey עובר את הווקטורים המשותפים עם הקטלוג (normalize-vectors.json)', () => {
  for (const [input, expected] of readJson('normalize-vectors.json')) assert.equal(normalizeKey(input), expected, JSON.stringify(input));
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey('מטות־מסעי'), 'מטות מסעי');
});

test('כתובות: הווקטורים המשותפים עם הקטלוג (url-vectors.json)', () => {
  const v = readJson('url-vectors.json');
  for (const [input, expected] of v.encodeNonAscii) assert.equal(Core.encodeNonAscii(input), expected, input);
  for (const [input, expected] of v.decodeNonAscii) assert.equal(Core.decodeNonAscii(input), expected, input);
  for (const c of v.resolve) assert.deepEqual(Core.resolveAssetUrls(c.asset, c.source), c.expect, c.name);
});

test('keyIs: אות לטינית לפי key, ובפריסה עברית לפי המקש הפיזי (code)', () => {
  assert.equal(Core.keyIs({ key: 'k', code: 'KeyK' }, 'k'), true);
  assert.equal(Core.keyIs({ key: 'K', code: 'KeyK' }, 'k'), true);
  assert.equal(Core.keyIs({ key: 'ל', code: 'KeyK' }, 'k'), true, 'פריסה עברית: ל על המקש K');
  assert.equal(Core.keyIs({ key: 'ל', code: 'KeyK' }, 'd'), false);
  // Dvorak: המקש הפיזי KeyK מפיק 't', ולכן אינו K
  assert.equal(Core.keyIs({ key: 't', code: 'KeyK' }, 'k'), false);
  assert.equal(Core.keyIs({ key: 'Enter', code: 'Enter' }, 'k'), false);
  assert.equal(Core.keyIs({}, 'k'), false);
});
