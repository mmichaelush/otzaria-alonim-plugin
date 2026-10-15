'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');

const A = loadPlugin();
const { Filters, Core } = A;
const { CatalogIndex } = A.Index;

// ---------------------------------------------------------- מודל המסננים

test('Filters.clean: צורה קנונית, ערך בודד נעטף, מפתחות ריקים נמחקים', () => {
  assert.deepEqual(Filters.clean({ lang: 'he', hy: 5787, source: '', circle: [] }), {
    lang: ['he'],
    hy: [5787],
  });
  assert.deepEqual(Filters.clean({ hy: ['5787', 5786, 5787, 'x', 0, -3] }), { hy: [5787, 5786] });
  assert.deepEqual(Filters.clean(null), {});
  assert.deepEqual(Filters.clean({ favorite: true, unread: false, multi: 'yes' }), {
    favorite: true,
  });
});

test('Filters.clean: טווחים — תאריך תקין בלבד, טווח הפוך מתהפך', () => {
  assert.deepEqual(Filters.clean({ dateFrom: '2026-02-01', dateTo: '2026-01-01' }), {
    dateFrom: '2026-01-01',
    dateTo: '2026-02-01',
  });
  assert.deepEqual(Filters.clean({ dateFrom: '1/2/2026', dateTo: '2026-01-01' }), {
    dateTo: '2026-01-01',
  });
  assert.deepEqual(Filters.clean({ hyFrom: 5787, hyTo: 5785 }), { hyFrom: 5785, hyTo: 5787 });
  assert.deepEqual(Filters.clean({ pagesMin: '12', pagesMax: 0, sizeMax: -4 }), { pagesMin: 12 });
});

test('Filters.count ו-isEmpty: ערך ברשימה, טווח ודגל נספרים כל אחד פעם אחת', () => {
  assert.equal(Filters.count({}), 0);
  assert.ok(Filters.isEmpty({ lang: [] }));
  assert.equal(
    Filters.count({
      lang: ['he', 'yi'],
      hy: [5787],
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      favorite: true,
    }),
    5,
  );
});

test('Filters.toggle / setList / remove / setRange', () => {
  let f = {};
  f = Filters.toggle(f, 'lang', 'he');
  f = Filters.toggle(f, 'lang', 'yi');
  assert.deepEqual(f.lang, ['he', 'yi']);
  f = Filters.toggle(f, 'lang', 'he');
  assert.deepEqual(f.lang, ['yi']);
  f = Filters.toggle(f, 'lang', 'yi');
  assert.deepEqual(f, {});
  f = Filters.toggle(f, 'hy', '5787');
  assert.deepEqual(f.hy, [5787], 'מספר נשמר כמספר');
  f = Filters.toggle(f, 'favorite');
  assert.equal(f.favorite, true);
  f = Filters.toggle(f, 'favorite');
  assert.equal(f.favorite, undefined);
  f = Filters.setRange(f, 'date', '2026-01-01', '2026-03-01');
  assert.equal(f.dateFrom, '2026-01-01');
  f = Filters.setRange(f, 'pages', 4, 0);
  assert.deepEqual([f.pagesMin, f.pagesMax], [4, undefined]);
  f = Filters.remove(f, 'date');
  assert.equal(f.dateFrom, undefined);
  f = Filters.setList(f, 'source', ['tashma', 'ladaat']);
  f = Filters.remove(f, 'source', 'tashma');
  assert.deepEqual(f.source, ['ladaat']);
  f = Filters.remove(f, 'source', 'ladaat');
  assert.equal(f.source, undefined);
  assert.deepEqual(Filters.remove({ hy: [5786, 5787] }, 'hy'), {});
});

test('Filters.chips: תגית לכל ערך, טווח ודגל, עם הטקסט מהמתרגם', () => {
  const chips = Filters.chips(
    { lang: ['he', 'yi'], dateFrom: '2026-01-01', multi: true },
    (key, value) => key + '=' + JSON.stringify(value),
  );
  assert.deepEqual(
    chips.map((c) => c.id),
    ['lang:he', 'lang:yi', 'range:date', 'flag:multi'],
  );
  assert.equal(chips[2].label, 'date={"from":"2026-01-01","to":""}');
});

test('Filters.equals: בלי תלות בסדר הערכים', () => {
  assert.ok(Filters.equals({ lang: ['he', 'yi'] }, { lang: ['yi', 'he'] }));
  assert.ok(!Filters.equals({ lang: ['he'] }, { lang: ['he', 'yi'] }));
  assert.ok(!Filters.equals({ favorite: true }, {}));
  assert.ok(Filters.equals({}, { lang: [] }));
});

// ----------------------------------------------- אופרטורים בשאילתה

function mini() {
  const series = [
    { id: 's_a', title: 'אסיפת גליונות', lang: 'he', circle: 'חסידי', aliases: ['אסיפה'] },
    { id: 's_b', title: 'Torah Weekly', lang: 'en', circle: '' },
    { id: 's_c', title: 'דער בלאט', lang: 'yi', circle: 'בעלזא' },
  ];
  const mk = (id, s, over) => ({
    id: 'i_' + id,
    series: s,
    title: 'x',
    date: '2026-10-17',
    hy: 5787,
    parasha: ['noach'],
    assets: [{ src: 'ladaat', ext: id, bytes: 3 * 1048576, pages: 10 }],
    ...over,
  });
  const issues = [
    mk('01', 's_a', {}),
    mk('02', 's_a', { hy: 5786, date: '2025-10-18', parasha: ['bereshit'] }),
    mk('03', 's_a', { hy: 5785, date: '2024-12-21', parasha: ['miketz'], event: 'chanukah' }),
    mk('04', 's_b', {
      hy: 5785,
      date: '2025-08-23',
      parasha: ['vaetchanan'],
      event: 'shabbat-nachamu',
      assets: [{ src: 'gilyoines', ext: '4', bytes: 800000, pages: 4 }],
    }),
    mk('05', 's_c', {
      hy: 5784,
      date: '2024-04-20',
      parasha: ['tzav'],
      event: 'shabbat-hagadol',
      assets: [
        { src: 'tashma', ext: '5' },
        { src: 'ladaat', ext: '5', pages: 6 },
      ],
    }),
    mk('06', 's_c', { hy: 5780, date: undefined, parasha: ['chayei-sara'] }),
    mk('07', 's_b', { hy: 5787, date: '2026-11-07', parasha: ['chayei-sara', 'toldot'] }),
  ];
  const index = new CatalogIndex({
    source: (id) => ({ ladaat: 'לדעת', tashma: 'תשמע', gilyoines: 'גיליונס' })[id] || id,
  });
  index.setSeries(series);
  index.addIssues(issues, 'x');
  return index;
}
const ids = (index, query, filters) =>
  index
    .search(query, filters || {}, {}, { sort: 'date' })
    .idx.map((i) => index.ids[i].slice(2))
    .sort();

test('אופרטור year: שנה, מספר או אותיות, וטווח בכל שילוב (הטווח באותיות החזיר 0 לפני התיקון)', () => {
  const index = mini();
  assert.deepEqual(ids(index, 'year:5785'), ['03', '04']);
  assert.deepEqual(ids(index, 'year:תשפ״ה'), ['03', '04']);
  assert.deepEqual(ids(index, 'year:תשפ"ה'), ['03', '04']);
  assert.deepEqual(ids(index, 'year:5785-5786'), ['02', '03', '04']);
  assert.deepEqual(ids(index, 'year:תשפ״ה-תשפ״ו'), ['02', '03', '04']);
  assert.deepEqual(ids(index, 'year:תשפ"ה-תשפ"ו'), ['02', '03', '04']);
  assert.deepEqual(ids(index, 'year:5785-תשפ״ו'), ['02', '03', '04']);
  assert.deepEqual(ids(index, 'year:5786..5785'), ['02', '03', '04'], 'טווח הפוך');
  assert.deepEqual(ids(index, 'year:787'), ['01', '07']);
  assert.deepEqual(ids(index, 'year:9999'), []);
});

test('אופרטור parasha: שם מדויק קודם, ורק אחריו תחילת מילה (parasha:נח החזיר גם "נחמו" לפני התיקון)', () => {
  const index = mini();
  assert.deepEqual(ids(index, 'parasha:נח'), ['01']);
  assert.deepEqual(ids(index, 'parasha:noach'), ['01']);
  assert.deepEqual(ids(index, 'parasha:Noach'), ['01']);
  assert.deepEqual(ids(index, 'parasha:חיי'), ['06', '07'], 'תחילת מילה כשאין שם מדויק');
  assert.deepEqual(ids(index, 'parasha:"חיי שרה"'), ['06', '07']);
  assert.deepEqual(ids(index, 'parasha:תולדות'), ['07'], 'הפרשה השנייה בשבת כפולה');
  assert.deepEqual(ids(index, 'parasha:נחמו'), [], 'נחמו היא אירוע, לא פרשה');
  assert.deepEqual(ids(index, '-parasha:נח year:5787'), ['07']);
});

test('אופרטור event: אירועים לפי שם, סלאג או תחילת מילה', () => {
  const index = mini();
  assert.deepEqual(ids(index, 'event:חנוכה'), ['03']);
  assert.deepEqual(ids(index, 'event:chanukah'), ['03']);
  assert.deepEqual(ids(index, 'event:נחמו'), ['04']);
  assert.deepEqual(ids(index, 'event:שבת'), ['04', '05'], 'תחילת מילה: כל "שבת ..."');
  assert.deepEqual(ids(index, 'event:פורים'), []);
});

test('אופרטורים lang / source / circle / series', () => {
  const index = mini();
  assert.deepEqual(ids(index, 'lang:en'), ['04', '07']);
  assert.deepEqual(ids(index, 'lang:אנגלית'), ['04', '07']);
  assert.deepEqual(ids(index, 'lang:אידיש'), ['05', '06']);
  assert.deepEqual(ids(index, 'source:לדעת'), ['01', '02', '03', '05', '06', '07']);
  assert.deepEqual(ids(index, 'source:tashma'), ['05']);
  assert.deepEqual(ids(index, 'source:גיליונס'), ['04']);
  assert.deepEqual(ids(index, 'circle:בעלזא'), ['05', '06']);
  assert.deepEqual(ids(index, 'circle:חסיד'), ['01', '02', '03'], 'חוג: תת-מחרוזת');
  assert.deepEqual(ids(index, 'series:"אסיפת גליונות"'), ['01', '02', '03']);
  assert.deepEqual(ids(index, 'series:torah'), ['04', '07']);
});

test('שלילה, OR, ביטוי וטקסט חופשי משולבים עם אופרטורים', () => {
  const index = mini();
  assert.deepEqual(ids(index, 'אסיפת -year:5787'), ['02', '03']);
  assert.deepEqual(ids(index, 'year:5780 OR year:5784'), ['05', '06']);
  assert.deepEqual(ids(index, 'lang:he OR lang:en year:5787'), ['01', '07']);
  assert.deepEqual(ids(index, '"torah weekly" parasha:chayei'), ['07']);
  assert.deepEqual(ids(index, ''), ['01', '02', '03', '04', '05', '06', '07']);
  assert.deepEqual(ids(index, 'unknown:value'), [], 'שדה לא מוכר = טקסט רגיל');
  assert.deepEqual(ids(index, 'zzzz'), []);
});

// ------------------------------------------------- מסננים מרובי ערכים

test('מסננים: "או" בתוך מסנן ו"וגם" בין מסננים', () => {
  const index = mini();
  assert.deepEqual(ids(index, '', { hy: [5785, 5786] }), ['02', '03', '04']);
  assert.deepEqual(ids(index, '', { hy: [5785, 5786], lang: ['he'] }), ['02', '03']);
  assert.deepEqual(ids(index, '', { lang: ['he', 'en'], source: ['gilyoines', 'tashma'] }), ['04']);
  assert.deepEqual(ids(index, '', { parasha: ['noach', 'toldot'] }), ['01', '07']);
  assert.deepEqual(ids(index, '', { event: ['chanukah', 'shabbat-hagadol'] }), ['03', '05']);
  assert.deepEqual(ids(index, '', { circle: ['חסידי', 'בעלזא'] }), ['01', '02', '03', '05', '06']);
  assert.deepEqual(ids(index, 'year:5787', { lang: ['he', 'en'] }), ['01', '07']);
  assert.deepEqual(ids(index, '', { source: ['no-such'] }), []);
});

test('מסננים: טווחי תאריך, שנים, עמודים וגודל; חסר ערך = לא עובר טווח', () => {
  const index = mini();
  assert.deepEqual(ids(index, '', { dateFrom: '2025-01-01', dateTo: '2025-12-31' }), ['02', '04']);
  assert.deepEqual(ids(index, '', { dateFrom: '2026-10-17' }), ['01', '07']);
  assert.deepEqual(
    ids(index, '', { dateTo: '2024-12-31' }),
    ['03', '05'],
    'הגיליון בלי תאריך (06) אינו עובר',
  );
  assert.deepEqual(ids(index, '', { hyFrom: 5785, hyTo: 5786 }), ['02', '03', '04']);
  assert.deepEqual(ids(index, '', { pagesMin: 6 }), ['01', '02', '03', '05', '06', '07']);
  assert.deepEqual(ids(index, '', { pagesMax: 5 }), ['04']);
  assert.deepEqual(
    ids(index, '', { sizeMin: 2 }),
    ['01', '02', '03', '06', '07'],
    'גיליון 05 בלי גודל לא עובר',
  );
  assert.deepEqual(ids(index, '', { sizeMax: 1 }), ['04']);
  assert.deepEqual(ids(index, '', { multi: true }), ['05']);
});

test('facetCounts: הספירה ליד ערך = התוצאה כשבוחרים בו, בנוסף לשאר המסננים', () => {
  const index = mini();
  const f = index.facetCounts('', { lang: ['he'] }, {}, {});
  assert.equal(f.total, 3);
  // שפה נספרת בלי מסנן השפה עצמו: אפשר לראות כמה יש בכל שפה אחרת.
  assert.equal(f.lang.get('en'), 2);
  assert.equal(f.lang.get('he'), 3);
  // שאר המסננים נספרים לפי מסנן השפה.
  assert.equal(f.hy.get(5785), 1);
  assert.equal(f.source.get('ladaat'), 3);
  const g = index.facetCounts('year:5787', {}, {}, {});
  assert.equal(g.total, 2);
  assert.equal(g.parasha.get('noach'), 1);
  assert.equal(g.parasha.get('toldot'), 1);
  assert.equal(g.parasha.get('tzav'), undefined);
  for (const [lang, n] of g.lang)
    assert.equal(index.search('year:5787', { lang: [lang] }, {}, {}).total, n);
});

test('סינון לפי מצב: מועדפים, סדרות במעקב, ברשימה, חדשים מאז ביקור, מוסתרים בלבד', () => {
  const index = mini();
  const ctx = {
    isFavorite: (it) => it.id === 'i_01',
    isFollowed: (it) => it.series === 's_c',
    inList: (it) => it.id === 'i_04',
    isRead: (it) => it.id === 'i_02',
    isNew: (it) => it.id === 'i_07',
    isDownloaded: (it) => it.id === 'i_03',
    lastVisit: 0,
  };
  const run = (filters) =>
    index
      .search('', filters, ctx, {})
      .idx.map((i) => index.ids[i].slice(2))
      .sort();
  assert.deepEqual(run({ favorite: true }), ['01']);
  assert.deepEqual(run({ followed: true }), ['05', '06']);
  assert.deepEqual(run({ inList: true }), ['04']);
  assert.deepEqual(run({ unread: true }).includes('02'), false);
  assert.deepEqual(run({ isNew: true }), ['07']);
  assert.deepEqual(run({ downloaded: true }), ['03']);
  assert.deepEqual(run({ favorite: true, followed: true }), []);
  index.setRules({
    ...A.Rules.emptyRules(),
    rules: [A.Rules.cleanRule({ action: 'hide', field: 'lang', value: 'en' })],
  });
  assert.deepEqual(run({ hiddenOnly: true }), ['04', '07']);
  assert.equal(index.search('', {}, ctx, {}).hidden, 2);
});

test('groupResults: קבוצות לפי שבוע, סדרה, שנה, חוג ושפה, כל אחת בסדר שלה ו"ללא" בסוף', () => {
  const index = mini();
  const all = index.search('', {}, {}, { sort: 'date' }).idx;
  const keysOf = (kind) => index.groupResults(all, kind).map((g) => g.key);
  const titleOf = (key) => index.seriesArr[key].title;
  for (const kind of A.Index.GROUPS) {
    const groups = index.groupResults(all, kind);
    assert.equal(
      groups.reduce((n, g) => n + g.idx.length, 0),
      all.length,
      kind + ': כל הגיליונות בקבוצה',
    );
    assert.equal(new Set(groups.flatMap((g) => g.idx)).size, all.length, kind + ': בלי כפילויות');
  }
  assert.deepEqual(keysOf('year'), [5787, 5786, 5785, 5784, 5780], 'שנים מהחדשה לישנה');
  const weeks = keysOf('week');
  assert.equal(weeks[weeks.length - 1], 0, 'גיליון בלי תאריך בסוף');
  assert.ok(
    weeks.slice(0, -1).every((k, n, arr) => n === 0 || arr[n - 1] > k),
    'שבועות מהחדש לישן',
  );
  assert.deepEqual(
    keysOf('series').map(titleOf),
    ['Torah Weekly', 'אסיפת גליונות', 'דער בלאט'],
    'לפי א-ב, לטינית לפני עברית',
  );
  assert.deepEqual(keysOf('circle'), ['בעלזא', 'חסידי', ''], 'חוג ריק בסוף');
  const langs = keysOf('lang').map((id) => index.langs.get(id));
  assert.deepEqual(
    langs,
    ['he', 'yi', 'en'].sort((a, b) => A.Core.LANG_CODES.indexOf(a) - A.Core.LANG_CODES.indexOf(b)),
  );
  const inGroup = index
    .groupResults(all, 'year')
    .find((g) => g.key === 5785)
    .idx.map((i) => index.ids[i]);
  assert.deepEqual(inGroup.slice().sort(), ['i_03', 'i_04'], 'חברי הקבוצה');
});

test('גיליון archive: אינו "חדש", אינו מקבל עדיפות לפי added, ואינו "חדש מאז הביקור"', () => {
  const index = new CatalogIndex();
  index.setSeries([{ id: 's1', title: 'עלון', lang: 'he' }]);
  const base = { series: 's1', title: 'x', hy: 5787, parasha: ['noach'], assets: [] };
  index.addIssues(
    [
      { ...base, id: 'i_old', date: '2020-10-17', added: '2026-10-14T10:00:00Z', archive: true },
      { ...base, id: 'i_new', date: '2026-10-17', added: '2026-10-10T10:00:00Z' },
      { ...base, id: 'i_mid', date: '2026-10-10', added: '2026-10-12T10:00:00Z' },
    ],
    'x',
  );
  const old = index.get('i_old');
  assert.equal(old.archive, true);
  assert.equal(old._added, 0, 'זמן "חדש" מאופס');
  assert.equal(old.added, '2026-10-14T10:00:00.000Z', 'added האמיתי נשמר לתצוגה');
  assert.equal(index.get('i_new').archive, undefined);
  const byNew = index.search('', {}, {}, { sort: 'new' }).idx.map((i) => index.ids[i]);
  assert.deepEqual(
    byNew,
    ['i_mid', 'i_new', 'i_old'],
    'archive אחרון במיון "חדש", למרות ש-added שלו הוא המאוחר ביותר',
  );
  const since = index
    .search('', { sinceVisit: true }, { lastVisit: Date.parse('2026-10-01T00:00:00Z') }, {})
    .idx.map((i) => index.ids[i])
    .sort();
  assert.deepEqual(since, ['i_mid', 'i_new']);
});

test('Core.hyLetters ו-year: סימני גרש וגרשיים שונים שקולים', () => {
  assert.equal(Core.parseYear('תשפ״ז'), 5787);
  assert.equal(Core.parseYear('תשפ"ז'), 5787);
  assert.equal(Core.parseYear("תשפ'ז"), 5787);
});
