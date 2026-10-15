'use strict';

// תקציב ביצועים כבדיקת יחידה (בלי דפדפן): נסיגה גסה באינדקס, בחיפוש, בסינון או בספירות
// נתפסת בכל ריצת בדיקות. הגבולות נדיבים (פי 5 ומעלה מהמדידה) כדי לא להיות רגישים למחשב
// איטי; המדידה המדויקת בדפדפן ב-`tools/preview/perf.mjs`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { makeCatalog } = require('./helpers/fixture');

const A = loadPlugin();
const { CatalogIndex } = A.Index;

const BUDGET = Object.freeze({
  buildMs: 4000,
  searchMs: 150,
  filteredSearchMs: 150,
  facetMs: 400,
  groupMs: 300,
});
const timeIt = (fn, rounds = 3) => {
  fn();
  const start = performance.now();
  for (let i = 0; i < rounds; i++) fn();
  return (performance.now() - start) / rounds;
};

const { series, issues } = makeCatalog(30000, 600, 5);
const built = (() => {
  const start = performance.now();
  const index = new CatalogIndex({ source: (id) => id });
  index.setSeries(series);
  index.addIssues(issues, 'all');
  return { index, ms: performance.now() - start };
})();
const { index } = built;

test('תקציב: בניית אינדקס של 30,000 גיליונות', () => {
  assert.equal(index.size, 30000);
  assert.ok(built.ms < BUDGET.buildMs, `בנייה ${Math.round(built.ms)}ms (תקציב ${BUDGET.buildMs})`);
});

test('תקציב: חיפוש טקסט, שאילתת שדות, ושלילה', () => {
  for (const q of [
    'נח',
    'אסיפת גליונות נח',
    'year:5786 parasha:noach',
    'שבת OR נח -עלון',
    'torah',
  ]) {
    const ms = timeIt(() => index.search(q, {}, {}, { sort: 'relevance' }));
    assert.ok(ms < BUDGET.searchMs, `"${q}": ${ms.toFixed(1)}ms (תקציב ${BUDGET.searchMs})`);
  }
});

test('תקציב: חיפוש עם כמה מסננים וטווחים, ומיון בכל סוג', () => {
  const filters = {
    lang: ['he', 'yi'],
    source: ['ladaat', 'tashma'],
    hy: [5785, 5786, 5787],
    pagesMin: 4,
    dateFrom: '2022-01-01',
  };
  for (const sort of ['relevance', 'new', 'date', 'alpha', 'size']) {
    const ms = timeIt(() => index.search('נח', filters, {}, { sort }));
    assert.ok(ms < BUDGET.filteredSearchMs, `${sort}: ${ms.toFixed(1)}ms`);
  }
});

test('תקציב: ספירות המסננים (facetCounts) וקיבוץ התוצאות', () => {
  const facet = timeIt(() => index.facetCounts('', { lang: ['he'] }, {}, {}));
  assert.ok(facet < BUDGET.facetMs, `facetCounts ${facet.toFixed(1)}ms (תקציב ${BUDGET.facetMs})`);
  const all = index.search('', {}, {}, {}).idx;
  for (const kind of A.Index.GROUPS) {
    const ms = timeIt(() => index.groupResults(all, kind));
    assert.ok(ms < BUDGET.groupMs, `קיבוץ ${kind}: ${ms.toFixed(1)}ms`);
  }
});

test('תקציב: item() ממומש לפי דרישה — חיפוש לא בונה אובייקט לכל גיליון', () => {
  index._mat.clear();
  index.search('נח', { lang: ['he'] }, {}, { sort: 'date' });
  assert.equal(index._mat.size, 0, 'חיפוש רגיל אינו ממש גיליונות');
  index.search('', { favorite: true }, { isFavorite: () => false }, {});
  assert.ok(index._mat.size <= 800, 'מסנן מצב ממש גיליונות רק במטמון החסום');
});
