'use strict';

// חיפוש בהקלדה בקטלוג גדול: מסכות התאמה למילים (alonim-index-search.js `_termMask`) חייבות לתת בדיוק את מה
// שנותן חיפוש מחרוזת בכל גיליון, גם כשמרחיבים מילה (הקלדה), גם כשהנתונים משתנים בין הקשה להקשה, וגם עם מסננים.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { makeCatalog } = require('./helpers/fixture');

const A = loadPlugin();
const { CatalogIndex, parseQuery } = A.Index;

const { series, issues } = makeCatalog(6000, 80, 11);
const build = (list) => {
  const index = new CatalogIndex({ source: (id) => id });
  index.setSeries(series);
  index.addIssues(list, '5787');
  return index;
};

/** תוצאה נאיבית: כל הגיליונות שכל מילה (תחילת מילה) מופיעה במחרוזת החיפוש שלהם, בסדר הרשימה. */
function naive(index, text) {
  const q = parseQuery(text);
  const hit = new Set();
  for (let i = 0; i < index.n; i++)
    if (
      q.clauses.every((c) =>
        c.alts.some((t) =>
          t.neg ? !index.hay[i].includes(t.needle) : index.hay[i].includes(t.needle),
        ),
      )
    )
      hit.add(i);
  return hit;
}

const sameSet = (index, text, filters) => {
  const got = new Set(
    index.search(text, filters || {}, {}, { sort: 'date', includeHidden: true }).idx,
  );
  const want = naive(index, text);
  if (!filters)
    assert.deepEqual(
      [...got].sort((a, b) => a - b),
      [...want].sort((a, b) => a - b),
      JSON.stringify(text),
    );
  return got;
};

test('הקלדה אות אחרי אות: כל שלב שווה לחיפוש נאיבי, והשלבים מצטמצמים', () => {
  const index = build(issues);
  assert.ok(index.n >= 4096, 'מעל סף המסכות');
  let previous = null;
  for (const text of ['נ', 'נח', 'נחמ', 'נחמו', 'ל', 'לך', 'לך ל', 'לך לך']) {
    const got = sameSet(index, text);
    if (previous && text.startsWith(previous.text)) {
      for (const i of got) assert.ok(previous.set.has(i), text + ' ⊆ ' + previous.text);
    }
    previous = { text, set: got };
  }
  assert.ok(index._masks.size >= 3 && index._masks.size <= 8, 'מסכות נשמרות, בגבול');
});

test('מסכה שנבנתה מהקודמת שווה לזו שנבנתה מסריקה מלאה', () => {
  const index = build(issues);
  index.search('נ', {}, {}, {});
  const narrowed = index._termMask(' נח');
  index._masks.clear();
  const full = index._termMask(' נח');
  assert.deepEqual([...narrowed], [...full]);
});

test('שינוי נתונים בין הקשות (שרד חדש) מבטל את המסכות', () => {
  const index = build(issues.slice(0, 5000));
  const before = index.search('נח', {}, {}, {}).total;
  const maskBefore = index._termMask(' נח');
  index.addIssues(issues.slice(5000), '5788');
  assert.equal(index.n, 6000);
  const after = sameSet(index, 'נח');
  assert.ok(after.size >= before);
  assert.notEqual(index._termMask(' נח'), maskBefore, 'מסכה חדשה אחרי שינוי');
  assert.equal(index._termMask(' נח').length, 6000);
});

test('שאילתות מורכבות (OR, שלילה, שדה, מסננים) נשארות נכונות לצד המסכות', () => {
  const index = build(issues);
  sameSet(index, 'נח OR וירא');
  sameSet(index, 'נח -עלון');
  const a = index.search('נח', { lang: ['he'] }, {}, { sort: 'date' });
  const b = index.search('נח', {}, {}, { sort: 'date' });
  const he = new Set(b.idx.filter((i) => index._lang(i) === index.langs.map.get('he')));
  assert.deepEqual(
    [...a.idx].sort((x, y) => x - y),
    [...he].sort((x, y) => x - y),
  );
  // סדר ורלוונטיות: אותו סדר כמו קודם (הניקוד נשאר)
  const rel = index.search('נח', {}, {}, { sort: 'relevance' });
  assert.equal(rel.total, b.total);
});
