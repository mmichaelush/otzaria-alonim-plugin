'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { makeCatalog } = require('./helpers/fixture');

const A = loadPlugin();
const { CatalogIndex, parseQuery } = A.Index;
const Rules = A.Rules;

function build(issues, series) {
  const idx = new CatalogIndex({ source: (id) => ({ ladaat: 'לדעת', tashma: 'תשמע', gilyoines: 'גיליונס', alonolam: 'עלון עולם' })[id] });
  idx.setSeries(series);
  idx.addIssues(issues);
  return idx;
}

const SMALL = () => makeCatalog(600, 14, 7);
const titles = (idx, r) => r.idx.map((i) => idx.item(i));

test('parseQuery: מילים, ביטוי, שלילה, OR ושדות', () => {
  const q = parseQuery('אסיפה "נח ויחי" -שבת series:עלון year:5787 OR year:5786');
  assert.equal(q.clauses.length, 5);
  assert.equal(q.clauses[0].alts[0].norm, 'אסיפה');
  assert.equal(q.clauses[1].alts[0].phrase, true);
  assert.equal(q.clauses[2].alts[0].neg, true);
  assert.equal(q.clauses[3].alts[0].field, 'series');
  assert.equal(q.clauses[4].alts.length, 2, 'OR מצרף לסעיף הקודם');
  assert.deepEqual(q.tokens.slice(0, 2), ['אסיפה', 'נח']);
  assert.equal(parseQuery('   ').clauses.length, 0);
  assert.equal(parseQuery('http://x').clauses.length, 1, 'שדה לא מוכר = טקסט');
});

test('חיפוש: מילה, תחילית, אחרי נרמול (ניקוד/סופיות), מינוס, OR', () => {
  const { series, issues } = SMALL();
  const idx = build(issues, series);
  const all = idx.search('', {}, {}, {});
  assert.equal(all.total, 600);
  const noach = idx.search('נח', {}, {}, {});
  assert.ok(noach.total > 0 && noach.total < 600);
  for (const it of titles(idx, noach)) assert.ok(it.parasha.includes('noach'));
  const withPrefix = idx.search('נ', {}, {}, {});
  assert.ok(withPrefix.total >= noach.total, 'תחילית');
  const minus = idx.search('נח -אסיפת', {}, {}, {});
  for (const it of titles(idx, minus)) assert.ok(!it.seriesTitle.includes('אסיפת'));
  const either = idx.search('נח OR וירא', {}, {}, {});
  assert.ok(either.total > noach.total);
  const phrase = idx.search('"אסיפת גליונות"', {}, {}, {});
  for (const it of titles(idx, phrase)) assert.equal(it.seriesTitle, 'אסיפת גליונות');
  assert.equal(idx.search('זזזזזז', {}, {}, {}).total, 0);
});

test('שדות: series year parasha lang source', () => {
  const { series, issues } = SMALL();
  const idx = build(issues, series);
  for (const it of titles(idx, idx.search('year:תשפ"ו', {}, {}, {}))) assert.equal(it.hy, 5786);
  for (const it of titles(idx, idx.search('year:5785-5786', {}, {}, {}))) assert.ok(it.hy === 5785 || it.hy === 5786);
  for (const it of titles(idx, idx.search('lang:en', {}, {}, {}))) assert.equal(it.lang, 'en');
  for (const it of titles(idx, idx.search('lang:אנגלית', {}, {}, {}))) assert.equal(it.lang, 'en');
  for (const it of titles(idx, idx.search('parasha:vayera', {}, {}, {}))) assert.ok(it.parasha.includes('vayera'));
  for (const it of titles(idx, idx.search('source:לדעת', {}, {}, {}))) assert.ok(it.assets.some((a) => a.src === 'ladaat'));
  for (const it of titles(idx, idx.search('series:"עלון שבת"', {}, {}, {}))) assert.equal(it.seriesTitle, 'עלון שבת');
});

test('מסננים ומיון', () => {
  const { series, issues } = SMALL();
  const idx = build(issues, series);
  const r = idx.search('', { hy: 5785, lang: 'he' }, {}, { sort: 'size' });
  const sizes = titles(idx, r).map((it) => it._bytes);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
  const byDate = titles(idx, idx.search('', {}, {}, { sort: 'date' })).map((it) => it._date);
  assert.deepEqual(byDate, [...byDate].sort((a, b) => b - a));
  const alpha = titles(idx, idx.search('', {}, {}, { sort: 'alpha' })).map((it) => it._ns);
  assert.deepEqual(alpha, [...alpha].sort());
  const fav = idx.search('', { favorite: true }, { isFavorite: (it) => it.no === 3 }, {});
  for (const it of titles(idx, fav)) assert.equal(it.no, 3);
});

test('רלוונטיות: התאמה בתחילת שם הסדרה לפני התאמה במקום אחר', () => {
  const { series, issues } = SMALL();
  const idx = build(issues, series);
  const r = idx.search('שערי', {}, {}, { sort: 'relevance' });
  assert.ok(r.total > 0);
  assert.ok(idx.item(r.idx[0]).seriesTitle.startsWith('שערי'));
});

test('כללים: חסימה מפורשת > הרשאה מפורשת > כלל סדרה > מקור/שפה > ברירת מחדל', () => {
  const { series, issues } = SMALL();
  const idx = build(issues, series);
  const sample = idx.item(0);
  const base = Rules.emptyRules();
  const rule = (action, field, value) => Rules.cleanRule({ action, field, value });
  const set = (...rules) => ({ ...base, rules });

  idx.setRules(set(rule('hide', 'lang', sample.lang)));
  assert.equal(idx.isVisible(sample), false);
  assert.match(Rules.reasonText(idx.decision(sample)), /מוסתר/);

  idx.setRules(set(rule('hide', 'lang', sample.lang), rule('show', 'series', sample.series)));
  assert.equal(idx.isVisible(sample), true, 'הרשאה מפורשת גוברת על כלל שפה');

  idx.setRules(set(rule('hide', 'series', sample.series), rule('show', 'series', sample.series)));
  assert.equal(idx.isVisible(sample), false, 'חסימה מפורשת גוברת על הרשאה');

  idx.setRules(set(rule('hide', 'seriesText', sample.seriesTitle.split(' ')[0]), rule('hide', 'lang', 'xx'), rule('show', 'issue', sample.id)));
  assert.equal(idx.isVisible(sample), true, 'הרשאה על גיליון גוברת על כלל שם');

  idx.setRules({ ...base, mode: 'whitelist', rules: [rule('show', 'lang', 'yi')] });
  for (let i = 0; i < idx.size; i++) assert.equal(idx.isVisible(idx.item(i)), idx.item(i).lang === 'yi');

  idx.setRules(set());
  assert.equal(idx.search('', {}, {}, {}).total, 600);
});

test('כלל מקור: מסתיר גיליון רק כשכל העותקים ממקורות מוסתרים', () => {
  const idx = build(
    [
      { id: 'i_1', series: 's', title: 'א', parasha: ['noach'], hy: 5787, assets: [{ src: 'ladaat', ext: '1' }, { src: 'tashma', ext: '2' }] },
      { id: 'i_2', series: 's', title: 'ב', parasha: ['noach'], hy: 5787, assets: [{ src: 'ladaat', ext: '3' }] },
    ],
    [{ id: 's', title: 'סדרה', lang: 'he' }],
  );
  idx.setRules({ v: 1, mode: 'blacklist', rules: [Rules.cleanRule({ action: 'hide', field: 'source', value: 'ladaat' })] });
  assert.equal(idx.isVisible(idx.get('i_1')), true);
  assert.equal(idx.isVisible(idx.get('i_2')), false);
  assert.deepEqual(idx.decision(idx.get('i_1')).hiddenSources, ['ladaat']);
});

test('nodownload ו-pin הם דגלים ולא מסתירים', () => {
  const { series, issues } = SMALL();
  const idx = build(issues, series);
  const sample = idx.item(5);
  idx.setRules({ v: 1, mode: 'blacklist', rules: [Rules.cleanRule({ action: 'nodownload', field: 'series', value: sample.series }), Rules.cleanRule({ action: 'pin', field: 'lang', value: sample.lang })] });
  const d = idx.decision(sample);
  assert.equal(d.action, 'show');
  assert.equal(d.noDownload, true);
  assert.equal(d.pin, true);
});

test('סימולציה: כמה גיליונות ייעלמו ודוגמאות, בלי לשנות את הכללים', () => {
  const { series, issues } = SMALL();
  const idx = build(issues, series);
  const lang = idx.item(0).lang;
  let expected = 0;
  for (let i = 0; i < idx.size; i++) if (idx.item(i).lang === lang) expected++;
  const rules = Rules.emptyRules();
  const sim = idx.simulate({ action: 'hide', field: 'lang', value: lang }, 3);
  assert.equal(sim.hides, expected);
  assert.equal(sim.examples.length, 3);
  assert.equal(rules.rules.length, 0);
  const none = idx.simulate({ action: 'hide', field: 'lang', value: 'xx' });
  assert.equal(none.hides, 0);
  assert.equal(idx.simulate({ action: 'bogus', field: 'lang', value: 'x' }).total, 0);
});

test('sanitize: סכימה, גרסה גבוהה, כללים פגומים נזרקים', () => {
  assert.equal(Rules.sanitize(null).ok, false);
  assert.equal(Rules.sanitize({ v: 99, rules: [] }).tooNew, true);
  const r = Rules.sanitize({ v: 1, mode: 'whitelist', rules: [{ action: 'hide', field: 'lang', value: 'yi', evil: 1 }, { action: 'boom', field: 'lang', value: 'x' }, 7, { action: 'hide', field: 'series', value: '' }] });
  assert.equal(r.ok, true);
  assert.equal(r.rules.mode, 'whitelist');
  assert.equal(r.rules.rules.length, 1);
  assert.equal(r.dropped, 3);
  assert.equal(r.rules.rules[0].evil, undefined);
});

test('קבוצות: סדרה, שבוע, פרשה+שנה כשאין תאריך, מזהה קודם של סדרה', () => {
  const idx = build(
    [
      { id: 'i_1', series: 'old', title: 'א', date: '2026-10-17', hy: 5787, parasha: ['noach'], assets: [] },
      { id: 'i_2', series: 's_new', title: 'ב', date: null, hy: 5787, parasha: ['noach'], assets: [] },
      { id: 'i_3', series: 's_new', title: 'ג', date: '2026-10-10', hy: 5787, parasha: ['bereshit'], assets: [] },
    ],
    [{ id: 's_new', title: 'סדרה', previousIds: ['old'], lang: 'he' }],
  );
  idx.setWeeks([{ date: '2026-10-10', hy: 5787, parasha: ['bereshit'] }, { date: '2026-10-17', hy: 5787, parasha: ['noach'] }]);
  assert.equal(idx.get('i_1').series, 's_new');
  assert.equal(idx.issuesOfSeries('old').length, 3);
  assert.deepEqual(idx.forWeek(idx.weeks[1]).sort(), [0, 1]);
  assert.equal(idx.weekFor('2026-10-12'), 1);
  assert.equal(idx.weekFor('2030-01-01'), 1);
});

test('ביצועים: אינדקס וחיפוש על 50,000 גיליונות', () => {
  const { series, issues } = makeCatalog(50000, 1200, 3);
  const idx = new CatalogIndex({ source: (id) => id });
  idx.setSeries(series);
  const t0 = performance.now();
  idx.addIssues(issues);
  const build = performance.now() - t0;
  const timings = {};
  for (const q of ['נח', 'אסיפת גליונות נח', 'year:5785 parasha:noach', 'שבת OR נח -עלון', '']) {
    idx.search(q, {}, {}, { sort: 'relevance' });
    const s = performance.now();
    const r = idx.search(q, {}, {}, { sort: 'relevance' });
    timings[q || '(ריק)'] = Math.round(performance.now() - s) + 'ms/' + r.total;
  }
  console.log('index build 50k:', Math.round(build) + 'ms', JSON.stringify(timings));
  // תקרה מרווחת: מכונות CI איטיות. היעד האמיתי (50ms) נמדד ב-tools/preview/perf.mjs.
  for (const key of Object.keys(timings)) assert.ok(parseInt(timings[key], 10) < 200, key + ' ' + timings[key]);
  assert.ok(build < 4000, 'build ' + build);
});
