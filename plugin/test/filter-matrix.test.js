'use strict';

// מטריצת סינון אוטומטית: לכל מסנן ולכל שילוב (אקראי אך דטרמיניסטי) התוצאה של
// האינדקס חייבת להיות זהה לסינון נאיבי על הרשומות הגולמיות (helpers/oracle.js), כולל
// הספירות (`facetCounts`), ההסתרה והסדר. רץ על קטלוג סינתטי מגוון תמיד, ועל הקטלוג
// האמיתי (catalog/out) כשהוא נמצא. כשל מדפיס את המסנן המדויק לשחזור.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');
const { makeCatalog, rng } = require('./helpers/fixture');
const { findCatalog, loadRaw, SOURCE_NAMES } = require('./helpers/real-catalog');
const oracle = require('./helpers/oracle');

const A = loadPlugin();
const { CatalogIndex, parseQuery, dayOf } = A.Index;
const { Filters, Rules, Core } = A;

// ------------------------------------------------------------ נתונים

/** קטלוג סינתטי עם כל המקרים הקשים: אירועים, פרשה כפולה, בלי תאריך/שנה/שפה/עמודים, עותקים. */
function variedCatalog(size, seed) {
  const { series, issues } = makeCatalog(size, 60, seed);
  const rand = rng(seed * 7 + 1);
  const events = Object.keys(Core.EVENTS);
  const parashot = Object.keys(Core.PARASHOT);
  const langs = ['he', 'yi', 'en', 'fr', 'ru'];
  series.forEach((s, k) => {
    s.circle = k % 5 === 0 ? '' : ['כללי', 'חסידי', 'ליטאי', 'בעלזא', 'חב"ד'][k % 5];
    s.lang = langs[k % langs.length];
    if (k % 7 === 0) s.aliases = ['כינוי ' + k];
  });
  const byId = new Map(series.map((s) => [s.id, s]));
  for (const it of issues) {
    const s = byId.get(it.series);
    if (rand() < 0.4) delete it.lang;
    else it.lang = langs[Math.floor(rand() * langs.length)];
    if (rand() < 0.12) it.event = events[Math.floor(rand() * events.length)];
    if (rand() < 0.1) it.parasha = [it.parasha[0], parashot[Math.floor(rand() * parashot.length)]];
    if (rand() < 0.04) it.parasha = [];
    if (rand() < 0.07) delete it.date;
    if (rand() < 0.03) delete it.hy;
    if (rand() < 0.1) for (const a of it.assets) delete a.pages;
    if (rand() < 0.08) for (const a of it.assets) delete a.bytes;
    if (rand() < 0.15) it.title = s.title + ' - ' + Core.PARASHOT[it.parasha[0]] + ' ' + it.no;
    if (rand() < 0.1) it.no = 0;
    if (rand() < 0.15) it.archive = true;
  }
  const byYear = new Map();
  for (const it of issues) {
    const key = String(it.hy || 'undated');
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(it);
  }
  return { series, weeks: [], manifest: {}, shards: [...byYear].map(([id, list]) => ({ id, list })) };
}

function buildIndex(raw, rules) {
  const index = new CatalogIndex({ source: (id) => SOURCE_NAMES[id] || id });
  index.setSeries(raw.series);
  for (const shard of raw.shards) index.addIssues(shard.list, shard.id);
  if (rules) index.setRules(rules);
  return index;
}

// -------------------------------------------------------- מחולל מקרים

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const some = (rand, list, max) => {
  const n = 1 + Math.floor(rand() * max);
  const out = [];
  for (let k = 0; k < n; k++) {
    const v = pick(rand, list);
    if (!out.includes(v)) out.push(v);
  }
  return out;
};

function universe(data) {
  const set = (fn) => [...new Set(data.records.flatMap(fn).filter((v) => v !== '' && v !== 0 && v !== undefined))];
  return {
    hy: set((r) => [r.hy]),
    lang: set((r) => [r.lang]),
    source: set((r) => r.sources),
    parasha: set((r) => r.parasha),
    event: set((r) => [r.event]),
    circle: set((r) => [r.series.circle]),
    series: [...new Set(data.records.map((r) => r.series.id))],
    dates: set((r) => [r.date]).sort(),
  };
}

/** מסנן אקראי: 0-5 סוגי מסננים, כל אחד עם 1-3 ערכים (וגם ערך שאינו קיים). */
function randomFilters(rand, u) {
  const f = {};
  const kinds = ['hy', 'lang', 'source', 'parasha', 'event', 'circle', 'series', 'date', 'years', 'pages', 'size', 'multi', 'flags'];
  const count = Math.floor(rand() * 5);
  for (let k = 0; k < count; k++) {
    const kind = pick(rand, kinds);
    if (kind === 'date') {
      const [a, b] = [pick(rand, u.dates), pick(rand, u.dates)].sort();
      const mode = rand();
      if (mode < 0.4) (f.dateFrom = a), (f.dateTo = b);
      else if (mode < 0.7) f.dateFrom = a;
      else f.dateTo = b;
    } else if (kind === 'years') {
      const [a, b] = [pick(rand, u.hy), pick(rand, u.hy)].sort((x, y) => x - y);
      if (rand() < 0.6) (f.hyFrom = a), (f.hyTo = b);
      else if (rand() < 0.5) f.hyFrom = a;
      else f.hyTo = b;
    } else if (kind === 'pages') {
      if (rand() < 0.5) f.pagesMin = 1 + Math.floor(rand() * 30);
      if (rand() < 0.5) f.pagesMax = 5 + Math.floor(rand() * 40);
    } else if (kind === 'size') {
      if (rand() < 0.5) f.sizeMin = Math.floor(rand() * 8) + 1;
      if (rand() < 0.5) f.sizeMax = Math.floor(rand() * 20) + 1;
    } else if (kind === 'multi') f.multi = true;
    else if (kind === 'flags') {
      const flags = ['favorite', 'followed', 'downloaded', 'inList', 'unread', 'isNew', 'sinceVisit', 'hiddenOnly'];
      f[pick(rand, flags)] = true;
    } else {
      const values = some(rand, u[kind], 3);
      if (rand() < 0.1) values.push(kind === 'hy' ? 1234 : 'no-such-value');
      f[kind] = values;
    }
  }
  return f;
}

function randomQuery(rand, data) {
  const rec = pick(rand, data.records);
  const words = (text) => text.split(/\s+/).filter(Boolean);
  const termOf = () => {
    const r = rand() < 0.5 ? rec : pick(rand, data.records);
    const w = pick(rand, words(r.series.title).concat(['נח', 'שבת', 'עלון', 'ב', 'zzz']));
    const kinds = [
      () => w,
      () => w.slice(0, Math.max(1, w.length - 1)),
      () => '"' + words(r.series.title).slice(0, 2).join(' ') + '"',
      () => 'series:' + w,
      () => 'series:"' + r.series.title + '"',
      () => (r.hy ? 'year:' + r.hy : 'year:5787'),
      () => (r.hy ? 'year:' + Core.hyLetters(r.hy) : 'year:תשפ"ז'),
      () => 'year:' + (r.hy || 5785) + '-' + ((r.hy || 5785) + 2),
      () => 'year:' + Core.hyLetters((r.hy || 5785) - 1) + '-' + Core.hyLetters((r.hy || 5785) + 1),
      () => (r.parasha[0] ? 'parasha:' + Core.parashaName(r.parasha[0]) : 'parasha:נח'),
      () => (r.parasha[0] ? 'parasha:' + r.parasha[0] : 'parasha:noach'),
      () => 'parasha:' + w,
      () => (r.event ? 'event:' + Core.eventName(r.event) : 'event:חנוכה'),
      () => 'event:' + pick(rand, ['purim', 'שבת', 'פסח', 'zzz']),
      () => 'lang:' + pick(rand, ['he', 'yi', 'en', 'אידיש', 'אנגלית', 'עברית', 'fr']),
      () => 'source:' + pick(rand, ['ladaat', 'tashma', 'לדעת', 'תשמע', 'gilyoines', 'גיליונס', 'alonolam']),
      () => (r.series.circle ? 'circle:' + words(r.series.circle)[0] : 'circle:חסידי'),
    ];
    return pick(rand, kinds)();
  };
  const clauses = [];
  const n = 1 + Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) {
    let term = termOf();
    if (rand() < 0.2) term = '-' + term;
    if (rand() < 0.25 && k > 0) term = 'OR ' + term;
    clauses.push(term);
  }
  return clauses.join(' ');
}

/** חברות בקבוצה לפי גיבוב של המזהה: דטרמיניסטי וזול גם על 123 אלף רשומות. */
const hash = (text) => {
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 16777619);
  return (h >>> 0) / 4294967296;
};
const bag = (seed, p) => ({ has: (id) => hash(seed + id) < p });

function randomState(seed, data) {
  const added = data.records.map((r) => r.added).sort((a, b) => a - b);
  return {
    favorite: bag('f' + seed, 0.05),
    read: bag('r' + seed, 0.3),
    downloaded: bag('d' + seed, 0.03),
    inList: bag('l' + seed, 0.02),
    newSet: bag('n' + seed, 0.04),
    followed: bag('s' + seed, 0.03),
    lastVisit: added[Math.floor(added.length / 2)] || 0,
  };
}

const ctxOf = (state) => ({
  isFavorite: (it) => state.favorite.has(it.id),
  isFollowed: (it) => state.followed.has(it.series),
  isDownloaded: (it) => state.downloaded.has(it.id),
  inList: (it) => state.inList.has(it.id),
  isRead: (it) => state.read.has(it.id),
  isNew: (it) => state.newSet.has(it.id),
  lastVisit: state.lastVisit,
});

// ------------------------------------------------------------- ההשוואה

function runMatrix(name, raw, count, seed) {
  const data = oracle.prepare(A, raw);
  const u = universe(data);
  const hideLang = u.lang.includes('yi') ? 'yi' : u.lang[0];
  const hideSeries = u.series[3];
  const rules = { ...Rules.emptyRules(), rules: [Rules.cleanRule({ action: 'hide', field: 'lang', value: hideLang }), Rules.cleanRule({ action: 'hide', field: 'series', value: hideSeries })] };
  const index = buildIndex(raw, rules);
  const hiddenIds = new Set(data.records.filter((r) => r.lang === hideLang || r.series.id === hideSeries).map((r) => r.id));
  assert.equal(index.size, data.records.length, name + ': כל הרשומות באינדקס');
  assert.ok(hiddenIds.size > 0 && hiddenIds.size < data.records.length, name + ': יש מוסתרים ויש מוצגים');
  const rand = rng(seed);
  let compared = 0;
  let nonEmpty = 0;
  let withText = 0;
  const failures = [];
  const idsOf = (res) => res.idx.map((i) => index.ids[i]);

  for (let n = 0; n < count && failures.length < 3; n++) {
    const state = randomState(seed * 1000 + n, data);
    const filters = randomFilters(rand, u);
    const query = rand() < 0.6 ? randomQuery(rand, data) : '';
    const includeHidden = rand() < 0.25;
    const sort = pick(rand, ['date', 'new', 'size', 'alpha']);
    const spec = JSON.stringify({ n, query, filters, includeHidden, sort });
    const clean = Filters.clean(filters);
    const q = parseQuery(query);
    const expected = oracle.filter(A, data, q, clean, state, hiddenIds, { includeHidden });
    const got = index.search(query, filters, ctxOf(state), { includeHidden, sort });
    const gotIds = idsOf(got);
    if (query) withText++;
    if (gotIds.length) nonEmpty++;
    const expectedSet = new Set(expected.ids);
    const gotSet = new Set(gotIds);
    const same = gotSet.size === gotIds.length && gotIds.length === expected.ids.length && gotIds.every((id) => expectedSet.has(id));
    if (!same || got.hidden !== expected.hidden) {
      const miss = expected.ids.filter((id) => !gotSet.has(id)).length;
      const extra = gotIds.filter((id) => !expectedSet.has(id)).length;
      failures.push(`תוצאות שונות (חסרים ${miss}, מיותרים ${extra}, hidden ${got.hidden}/${expected.hidden}): ${spec}`);
      continue;
    }
    // הסדר: מיון לפי תאריך נבדק מול מיון נאיבי; השאר — מונוטוני לפי המפתח.
    if (sort === 'date') {
      const key = (id) => {
        const rec = data.records[data.index.get(id)];
        return [dayOf(rec.date), rec.addedRaw, -data.index.get(id)];
      };
      const sorted = [...expected.ids].sort((a, b) => {
        const x = key(a);
        const y = key(b);
        return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
      });
      if (sorted.join() !== gotIds.join()) failures.push('סדר לפי תאריך שגוי: ' + spec);
    }
    const expectedFacets = oracle.facets(A, data, q, clean, state, hiddenIds, { includeHidden });
    const gotFacets = index.facetCounts(query, filters, ctxOf(state), { includeHidden });
    if (gotFacets.total !== expectedFacets.total) failures.push(`ספירת סך הכל ${gotFacets.total}/${expectedFacets.total}: ${spec}`);
    for (const key of ['parasha', 'event', 'hy', 'lang', 'source', 'circle']) {
      const a = [...gotFacets[key]].sort().join('|');
      const b = [...expectedFacets[key]].sort().join('|');
      if (a !== b) failures.push(`ספירות ${key} שונות: ${spec}\n  index:  ${a.slice(0, 300)}\n  oracle: ${b.slice(0, 300)}`);
    }
    // הספירה ליד ערך = מה שהחיפוש מחזיר אם בוחרים רק בו (בנוסף לשאר המסננים).
    if (n % 5 === 0) {
      for (const key of ['lang', 'source']) {
        const values = [...gotFacets[key].keys()].slice(0, 2);
        for (const v of values) {
          const f2 = { ...clean, [key]: [v] };
          const r = index.search(query, f2, ctxOf(state), { includeHidden });
          if (r.total !== gotFacets[key].get(v)) failures.push(`ספירה ליד ${key}=${v}: ${gotFacets[key].get(v)} אך החיפוש מחזיר ${r.total}: ${spec}`);
        }
      }
    }
    compared++;
  }
  assert.deepEqual(failures, [], name);
  assert.equal(compared, count);
  assert.ok(nonEmpty > count * 0.3, `${name}: מעט מדי מקרים עם תוצאות (${nonEmpty}/${count})`);
  assert.ok(withText > count * 0.4, name + ': מעט מדי שאילתות טקסט');
  return { compared, nonEmpty, withText };
}

// מיפוי מזהה ← מקום, להשוואת סדר
const withIndexMap = (data) => {
  data.index = new Map(data.records.map((r, k) => [r.id, k]));
  return data;
};
const prepareOriginal = oracle.prepare;
oracle.prepare = (a, raw) => withIndexMap(prepareOriginal(a, raw));

test('מטריצת סינון: קטלוג סינתטי מגוון (6,000 גיליונות)', () => {
  const count = Number(process.env.ALONIM_MATRIX_N || 400);
  const result = runMatrix('synthetic', variedCatalog(6000, 11), count, 2024);
  assert.equal(result.compared, count);
});

test('מטריצת סינון: קטלוג סינתטי שני (זרע אחר, 3,000 גיליונות)', () => {
  const result = runMatrix('synthetic-2', variedCatalog(3000, 29), 250, 77);
  assert.equal(result.compared, 250);
});

test('מטריצת סינון: הקטלוג האמיתי (123 אלף גיליונות)', { timeout: 600000 }, (t) => {
  const dir = findCatalog();
  if (!dir) return t.skip('אין catalog/out (קבעו ALONIM_CATALOG)');
  const raw = loadRaw(dir);
  const count = Number(process.env.ALONIM_MATRIX_REAL_N || 30);
  const result = runMatrix('real', raw, count, 5);
  assert.equal(result.compared, count);
});
