// "מעגל השנה": סדר השנה (שנה פשוטה ומעוברת), נושאי הדפים, שבתות משולבות, ארץ ישראל מול חוץ
// לארץ, קיבוץ לסדרות, נתונים חסרים, והצלבה לספירה נאיבית על הקטלוג האמיתי.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPlugin } = require('./helpers/load');
const { findCatalog, loadRaw, buildIndex } = require('./helpers/real-catalog');

const A = loadPlugin();
const { Cycle, Weeks, HebCal, Core } = A;
const { CatalogIndex } = A.Index;

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const rows = [...fixture('weeks-archive-real.json'), ...fixture('weeks-real.json')];
const il = Weeks.build(rows, { diaspora: false });
const diaspora = Weeks.build(rows, { diaspora: true });
const keys = (list) => list.map((s) => s.key);

// ---------------------------------------------------------------- הסדר

test('order: כל 54 הפרשות פעם אחת, לפי סדר התורה, אחרי חגי תשרי', () => {
  for (const leap of [false, true]) {
    const { sections, stations } = Cycle.order(leap);
    assert.deepEqual(
      sections.map((s) => s.id),
      ['tishrei', 'bereshit', 'shemot', 'vayikra', 'bamidbar', 'devarim'],
    );
    const parashot = stations.filter((s) => s.kind === 'parasha');
    assert.equal(parashot.length, 54);
    assert.deepEqual(
      parashot.map((s) => s.slug),
      Object.keys(Core.PARASHOT),
    );
    assert.deepEqual(
      parashot.map((s) => s.n),
      parashot.map((_, k) => k + 1),
    );
    assert.deepEqual(keys(sections[0].stations), Cycle.TISHREI_EVENTS.map(Cycle.eKey));
    assert.equal(new Set(keys(stations)).size, stations.length, 'בלי כפילויות');
    assert.equal(stations[0].key, 'e:rosh-hashana');
    assert.equal(stations.at(-1).key, 'p:vezot-haberakhah');
  }
});

test('order: כל מועד מופיע פעם אחת; כינויי שבת (שירה, חזון, נחמו) וראש חודש אינם אריחים', () => {
  const { stations } = Cycle.order(false);
  const events = stations.filter((s) => s.kind === 'event').map((s) => s.slug);
  const expected = [
    ...Cycle.TISHREI_EVENTS,
    ...Cycle.YEAR_EVENTS.filter((e) => !Cycle.ALIAS_OF[e]),
  ];
  assert.deepEqual([...events].sort(), [...expected].sort());
  for (const alias of Object.keys(Cycle.ALIAS_OF)) assert.ok(!events.includes(alias), alias);
  for (const slug of Cycle.NOT_IN_WHEEL) assert.ok(!events.includes(slug), slug);
  // הכינוי נשאר ככיתוב על אריח הפרשה
  const beshalach = stations.find((s) => s.key === 'p:beshalach');
  assert.equal(beshalach.alias, 'shabbat-shirah');
  assert.equal(stations.find((s) => s.key === 'p:devarim').alias, 'shabbat-chazon');
  assert.equal(stations.find((s) => s.key === 'p:vaetchanan').alias, 'shabbat-nachamu');
  // כל מועד בקטלוג (פרט לאלה שמחוץ לגלגל) נמצא באחד המסלולים: גלגל או כינוי
  for (const slug of Object.keys(Core.EVENTS)) {
    if (Cycle.NOT_IN_WHEEL.includes(slug)) continue;
    assert.ok(events.includes(slug) || Cycle.ALIAS_OF[slug], 'חסר בגלגל: ' + slug);
  }
});

test('order: שנה מעוברת מזיזה את מועדי אדר ופסח אחרי פרשות אחרות; כל השאר זהה', () => {
  const plain = keys(Cycle.order(false).stations);
  const leap = keys(Cycle.order(true).stations);
  assert.equal(plain.length, leap.length);
  assert.deepEqual([...plain].sort(), [...leap].sort());
  const after = (list, key) => list[list.indexOf(key) - 1];
  // בשנה פשוטה פורים אחרי תצוה (שבת זכור), במעוברת אחרי ויקרא
  assert.equal(after(plain, 'e:shabbat-zachor'), 'p:tetzaveh');
  assert.equal(after(leap, 'e:shabbat-zachor'), 'p:vayikra');
  assert.ok(plain.indexOf('e:purim') > plain.indexOf('p:tetzaveh'));
  assert.ok(plain.indexOf('e:purim') < plain.indexOf('p:ki-tisa'));
  assert.ok(leap.indexOf('e:purim') > leap.indexOf('p:vayikra'));
  assert.ok(leap.indexOf('e:purim') < leap.indexOf('p:tzav'));
  // סדר פנימי של אדר: שקלים, זכור, תענית אסתר, פורים, שושן פורים, פרה, החודש
  for (const list of [plain, leap]) {
    const adar = [
      'e:shabbat-shekalim',
      'e:shabbat-zachor',
      'e:taanit-esther',
      'e:purim',
      'e:shushan-purim',
      'e:shabbat-parah',
      'e:shabbat-hachodesh',
    ].map((k) => list.indexOf(k));
    assert.deepEqual(
      adar,
      [...adar].sort((a, b) => a - b),
    );
  }
  // חנוכה, עשרה בטבת וט״ו בשבט קבועים
  assert.equal(after(plain, 'e:chanukah'), 'p:vayeshev');
  assert.equal(after(leap, 'e:chanukah'), 'p:vayeshev');
  // הפרשות עצמן באותו סדר בשתיהן
  assert.deepEqual(
    plain.filter((k) => k[0] === 'p'),
    leap.filter((k) => k[0] === 'p'),
  );
});

test('order: הסדר תואם את לוח השנים האמיתי (35 שנים), בשתי הטבלאות', () => {
  for (const views of [diaspora, il]) {
    const stat = { plain: [0, 0], leap: [0, 0] };
    for (const { hy } of Weeks.years(views)) {
      if (Weeks.ofYear(views, hy).filter((v) => v.shabbat).length < 45) continue;
      const leap = HebCal.isLeap(hy);
      const dates = Cycle.stationDates(views, hy);
      // מבראשית עד נצבים: וילך והאזינו לפעמים בתשרי, והגלגל מסיים בהן לפי סדר התורה
      const seq = Cycle.order(leap)
        .stations.filter((s) => s.section !== 'tishrei')
        .filter((s) => !['p:vayeilech', 'p:haazinu', 'p:vezot-haberakhah'].includes(s.key));
      let prev = '';
      let violations = 0;
      for (const s of seq) {
        const view = dates.get(s.key);
        if (!view) continue;
        if (prev && view.date < prev) violations++;
        prev = view.date;
      }
      const bucket = stat[leap ? 'leap' : 'plain'];
      bucket[0]++;
      if (violations === 0) bucket[1]++;
      assert.ok(violations <= 3, hy + ': ' + violations + ' חריגות');
    }
    // רוב מוחלט של השנים בסדר מושלם (שנה שבה פסח מאוחר או חנוכה מתחיל בשישי היא חריגה מוכרת)
    assert.ok(stat.plain[0] >= 20 && stat.plain[1] / stat.plain[0] >= 0.9, JSON.stringify(stat));
    assert.ok(stat.leap[0] >= 10 && stat.leap[1] / stat.leap[0] >= 0.85, JSON.stringify(stat));
  }
});

// ------------------------------------------------------------- נושאים

test('topic: מפתחות, כינויי שבת, ומפתח לא תקין', () => {
  assert.equal(Cycle.canonicalKey('p:bereshit'), 'p:bereshit');
  assert.equal(Cycle.canonicalKey('e:purim'), 'e:purim');
  assert.equal(Cycle.canonicalKey('e:shabbat-shirah'), 'p:beshalach', 'כינוי נפתח כפרשה');
  assert.equal(Cycle.canonicalKey('e:shabbat-chazon'), 'p:devarim');
  assert.equal(Cycle.canonicalKey('e:shabbat-nachamu'), 'p:vaetchanan');
  for (const bad of [
    '',
    null,
    undefined,
    'p:',
    'p:nope',
    'e:nope',
    'x:noach',
    'noach',
    'e:rosh-chodesh',
  ])
    assert.equal(Cycle.canonicalKey(bad), null, String(bad));
  const tp = Cycle.topic('p:vayakhel');
  assert.deepEqual(tp, {
    key: 'p:vayakhel',
    kind: 'parasha',
    slug: 'vayakhel',
    filters: { parasha: ['vayakhel'] },
  });
  assert.deepEqual(Cycle.topic('e:purim').filters, { event: ['purim'] });
  assert.equal(Cycle.topicName(tp), 'ויקהל');
  assert.equal(Cycle.topicName(Cycle.topic('e:shabbat-zachor')), 'שבת זכור');
  assert.equal(Cycle.topic('nope'), null);
});

test('topicOfView: פרשה (הראשונה בשבת משולבת), ושבת או חג בלי פרשה — האירוע', () => {
  const at = (date) => il.find((v) => v.date === date);
  assert.equal(Cycle.topicOfView(at('2026-10-17')), 'p:noach');
  assert.equal(Cycle.topicOfView(at('2027-07-31')), 'p:matot', 'מטות־מסעי נפתחת במטות');
  assert.equal(Cycle.topicOfView(at('2026-09-12')), 'e:rosh-hashana', 'ראש השנה שחל בשבת');
  assert.equal(Cycle.topicOfView(at('2026-09-21')), 'e:yom-kippur', 'חג באמצע השבוע');
  assert.equal(Cycle.topicOfView(at('2027-03-06')), 'p:vayakhel', 'שבת שקלים: הפרשה');
  assert.equal(Cycle.topicOfView(null), null);
});

test('PAIRS: כל שבת משולבת בלוח (35 שנים, ארץ ישראל וחוץ לארץ) היא אחד הזוגות', () => {
  const pairs = new Set(Cycle.PAIRS.map((p) => p.join('+')));
  const seen = new Set();
  for (const views of [il, diaspora])
    for (const v of views) if (v.parasha.length === 2) seen.add(v.parasha.join('+'));
  for (const p of seen) assert.ok(pairs.has(p), p);
  assert.ok(seen.size >= 6);
  assert.equal(Cycle.partnerOf('pekudei'), 'vayakhel');
  assert.equal(Cycle.partnerOf('vayakhel'), 'pekudei');
  assert.equal(Cycle.partnerOf('noach'), null);
});

// ------------------------------------------------- תאריכי השנה הנוכחית

test('cycleYear: שנה מעוברת לפי השבוע הנוכחי, ולפי היום כשאין לוח', () => {
  const current = Weeks.current(il, '2026-10-15');
  const year = Cycle.cycleYear(il, current, new Date(2026, 9, 15, 12));
  assert.deepEqual(year, { hy: 5787, leap: true });
  assert.deepEqual(Cycle.cycleYear([], { index: -1, status: 'empty' }, new Date(2026, 9, 15, 12)), {
    hy: 5787,
    leap: true,
  });
  assert.equal(Cycle.cycleYear([], { index: -1 }, new Date(2025, 9, 15, 12)).leap, false, '5786');
});

test('stationDates: שנה מעוברת — אדר ב׳; וזאת הברכה בשמחת תורה', () => {
  const dates = Cycle.stationDates(il, 5787);
  assert.equal(dates.get('e:purim').date, '2027-03-23');
  assert.match(dates.get('e:purim').hebrew, /אדר ב׳/);
  assert.equal(dates.get('e:shabbat-shekalim').date, '2027-03-06');
  assert.equal(dates.get('p:noach').date, '2026-10-17');
  assert.equal(
    dates.get('p:vezot-haberakhah').date,
    dates.get('e:simchat-torah').date,
    'אין לה שבת משלה',
  );
  // שנה פשוטה: פורים באדר
  const plain = Cycle.stationDates(il, 5786);
  assert.doesNotMatch(plain.get('e:purim').hebrew || '', /אדר ב׳/);
  // שנה שאינה בלוח: אין תאריכים (ולא קריסה)
  assert.equal(Cycle.stationDates(il, 9999).size, 0);
  assert.equal(Cycle.stationDates([], 5787).size, 0);
});

test('stationDates: ארץ ישראל מול חוץ לארץ — שבועות בשבת (2027-06-12)', () => {
  const inIsrael = Cycle.stationDates(il, 5787);
  const abroad = Cycle.stationDates(diaspora, 5787);
  // בארץ זו שבת רגילה של נשא; בחוץ לארץ זה שבועות, ונשא נקראת שבוע אחר כך
  assert.equal(inIsrael.get('p:nasso').date, '2027-06-12');
  assert.equal(abroad.get('p:nasso').date, '2027-06-19');
  assert.equal(abroad.get('e:shavuot').date, '2027-06-11');
  // בשני המקומות אף פרשה אינה חסרה בשנה שלמה
  for (const dates of [inIsrael, abroad])
    for (const slug of Object.keys(Core.PARASHOT).filter((s) => s !== 'vezot-haberakhah'))
      assert.ok(dates.has('p:' + slug), slug);
});

test('stationDates: שבת משולבת — שתי הפרשות באותו תאריך', () => {
  const dates = Cycle.stationDates(il, 5787);
  assert.equal(dates.get('p:matot').date, '2027-07-31');
  assert.equal(dates.get('p:masei').date, '2027-07-31');
});

test('nextOccurrence: הבא מהיום; אחרת האחרון; אחרת null', () => {
  const noach = Cycle.topic('p:noach');
  const next = Cycle.nextOccurrence(il, noach, '2026-10-15');
  assert.equal(next.view.date, '2026-10-17');
  assert.equal(next.upcoming, true);
  const later = Cycle.nextOccurrence(il, Cycle.topic('p:lech-lecha'), '2026-10-15');
  assert.equal(later.upcoming, true);
  assert.equal(later.view.date, '2026-10-24');
  const passed = Cycle.nextOccurrence(il, noach, '2030-01-01');
  assert.equal(passed.upcoming, false);
  assert.equal(
    Cycle.nextOccurrence(il, Cycle.topic('e:purim'), '2027-01-01').view.date,
    '2027-03-23',
  );
  assert.equal(
    Cycle.nextOccurrence(il, Cycle.topic('p:vezot-haberakhah'), '2026-10-01').view.event,
    'simchat-torah',
  );
  assert.equal(Cycle.nextOccurrence([], noach, '2026-10-15'), null);
});

// ---------------------------------------------------- אינדקס סינתטי

function makeIndex(spec) {
  const index = new CatalogIndex({ source: (id) => id });
  index.setSeries([
    { id: 's_a', title: 'אסיפה', lang: 'he' },
    { id: 's_b', title: 'ביאור', lang: 'he' },
    { id: 's_c', title: 'Torah Weekly', lang: 'en' },
    { id: 's_d', title: 'דבר', lang: 'he' },
  ]);
  index.addIssues(
    spec.map(([n, series, hy, date, parasha, event, src]) => ({
      id: 'i_' + n,
      series,
      hy,
      date,
      parasha,
      event,
      assets: [{ src: src || 'ladaat', ext: String(n) }],
    })),
  );
  return index;
}

const SPEC = [
  // [id, series, hy, date, parasha, event, source]
  [1, 's_a', 5787, '2027-03-06', ['vayakhel'], 'shabbat-shekalim'],
  [2, 's_a', 5786, '2026-03-14', ['vayakhel', 'pekudei']],
  [3, 's_b', 5786, '2026-03-14', ['vayakhel', 'pekudei'], null, 'tashma'],
  [4, 's_b', 5785, '2025-03-01', ['vayakhel'], 'shabbat-shekalim', 'tashma'],
  [5, 's_c', 5785, '2025-03-22', ['pekudei'], 'shabbat-hachodesh'],
  [6, 's_c', 5784, '2024-03-02', ['vayakhel']],
  [7, 's_a', 5787, '2026-10-17', ['noach']],
  [8, 's_d', 5787, '2026-09-21', [], 'yom-kippur'],
  [9, 's_d', 5786, '2025-10-02', [], 'yom-kippur'],
  [10, 's_a', 5787, '2026-12-05', ['miketz'], 'chanukah'],
  [11, 's_a', 5787, '2027-01-02', ['shemot'], 'shabbat-shirah'],
];

test('topicCounts: שבת משולבת נספרת בשתי הפרשות, ומועד בנפרד', () => {
  const index = makeIndex(SPEC);
  const counts = index.topicCounts();
  assert.equal(counts.parasha.get('vayakhel'), 5, 'גיליונות 1,2,3,4,6');
  assert.equal(counts.parasha.get('pekudei'), 3, 'גיליונות 2,3,5');
  assert.equal(counts.parasha.get('noach'), 1);
  assert.equal(counts.parasha.has('bereshit'), false);
  assert.equal(counts.event.get('shabbat-shekalim'), 2);
  assert.equal(counts.event.get('yom-kippur'), 2);
  assert.equal(counts.event.get('chanukah'), 1);
  assert.equal(counts.event.has('purim'), false);
  assert.equal(index.topicCounts(), counts, 'נשמר עד שהנתונים משתנים');
  index.addIssues([{ id: 'i_99', series: 's_a', hy: 5787, parasha: ['noach'], assets: [] }]);
  assert.equal(index.topicCounts().parasha.get('noach'), 2);
});

test('topicCounts: כללי הסתרה משפיעים על הספירה ועל הדף באותה מידה', () => {
  const index = makeIndex(SPEC);
  const before = Cycle.issuesOf(index, Cycle.topic('p:vayakhel'), {});
  assert.equal(before.length, 5);
  index.setRules({
    ...A.Rules.emptyRules(),
    rules: [A.Rules.cleanRule({ action: 'hide', field: 'series', value: 's_b' })],
  });
  const after = Cycle.issuesOf(index, Cycle.topic('p:vayakhel'), {});
  assert.equal(after.length, index.topicCounts().parasha.get('vayakhel'));
  assert.ok(after.length < before.length);
});

test('issuesOf: ויקהל — גיליון משולב פעם אחת, מהחדש לישן; מצבי הצגה', () => {
  const index = makeIndex(SPEC);
  const tp = Cycle.topic('p:vayakhel');
  const idx = Cycle.issuesOf(index, tp, {});
  assert.equal(new Set(idx).size, idx.length, 'כל גיליון פעם אחת');
  assert.deepEqual(
    idx.map((i) => index.item(i).id),
    ['i_1', 'i_2', 'i_3', 'i_4', 'i_6'].sort(
      (a, b) => index.get(b).date.localeCompare(index.get(a).date) || (a < b ? -1 : 1),
    ),
  );
  const ids = (list) => list.map((i) => index.item(i).id).sort();
  assert.deepEqual(ids(Cycle.select(index, idx, { mode: 'all' })), [
    'i_1',
    'i_2',
    'i_3',
    'i_4',
    'i_6',
  ]);
  assert.deepEqual(ids(Cycle.select(index, idx, { mode: 'combined' })), ['i_2', 'i_3']);
  assert.deepEqual(ids(Cycle.select(index, idx, { mode: 'alone' })), ['i_1', 'i_4', 'i_6']);
  const summary = Cycle.summarize(index, idx, tp);
  assert.equal(summary.count, 5);
  assert.equal(summary.combined, 2);
  assert.deepEqual([...summary.partners], [['pekudei', 2]]);
  assert.equal(summary.seriesCount, 3);
  assert.equal(summary.hyMin, 5784);
  assert.equal(summary.hyMax, 5787);
  assert.equal(summary.yearCount, 4);
  // דף פקודי: אותו גיליון משולב, פעם אחת
  const pekudei = Cycle.issuesOf(index, Cycle.topic('p:pekudei'), {});
  assert.deepEqual(ids(pekudei), ['i_2', 'i_3', 'i_5']);
  assert.deepEqual(
    [...Cycle.summarize(index, pekudei, Cycle.topic('p:pekudei')).partners],
    [['vayakhel', 2]],
  );
});

test('issuesOf: דף מועד; שבת מיוחדת מופיעה גם בדף הפרשה שלה; חג בלי פרשה', () => {
  const index = makeIndex(SPEC);
  const ids = (list) => list.map((i) => index.item(i).id).sort();
  assert.deepEqual(ids(Cycle.issuesOf(index, Cycle.topic('e:shabbat-shekalim'), {})), [
    'i_1',
    'i_4',
  ]);
  assert.deepEqual(ids(Cycle.issuesOf(index, Cycle.topic('e:yom-kippur'), {})), ['i_8', 'i_9']);
  assert.ok(ids(Cycle.issuesOf(index, Cycle.topic('p:vayakhel'), {})).includes('i_1'));
  // כינוי: שבת שירה נפתחת בדף שמות? (הפרשה בגיליון הדוגמה היא שמות, לא בשלח)
  assert.equal(Cycle.topic('e:shabbat-shirah').key, 'p:beshalach');
  const summary = Cycle.summarize(
    index,
    Cycle.issuesOf(index, Cycle.topic('e:yom-kippur'), {}),
    Cycle.topic('e:yom-kippur'),
  );
  assert.equal(summary.combined, 0);
  assert.equal(summary.partners.size, 0);
});

test('select: שפה, מקור, שנה וטקסט — כמו סינון נאיבי; facetsOf סופר את אותו הדבר', () => {
  const index = makeIndex(SPEC);
  const tp = Cycle.topic('p:vayakhel');
  const idx = Cycle.issuesOf(index, tp, {});
  const ids = (list) => list.map((i) => index.item(i).id).sort();
  assert.deepEqual(ids(Cycle.select(index, idx, { lang: 'en' })), ['i_6']);
  assert.deepEqual(ids(Cycle.select(index, idx, { source: 'tashma' })), ['i_3', 'i_4']);
  assert.deepEqual(ids(Cycle.select(index, idx, { source: 'nope' })), []);
  assert.deepEqual(ids(Cycle.select(index, idx, { hy: 5786 })), ['i_2', 'i_3']);
  assert.deepEqual(ids(Cycle.select(index, idx, { query: 'ביאור' })), ['i_3', 'i_4']);
  assert.deepEqual(ids(Cycle.select(index, idx, { query: 'אסיפה -ביאור' })), ['i_1', 'i_2']);
  assert.deepEqual(ids(Cycle.select(index, idx, { query: 'ביאור OR אסיפה', hy: 5787 })), ['i_1']);
  assert.deepEqual(
    ids(Cycle.select(index, idx, { query: '   ' })),
    ids(idx),
    'שאילתה ריקה אינה מסננת',
  );
  assert.deepEqual(ids(Cycle.select(index, idx, { mode: 'combined', source: 'tashma' })), ['i_3']);
  const facets = Cycle.facetsOf(index, idx);
  assert.deepEqual([...facets.langs].sort(), [
    ['en', 1],
    ['he', 4],
  ]);
  assert.deepEqual([...facets.sources].sort(), [
    ['ladaat', 3],
    ['tashma', 2],
  ]);
  assert.deepEqual([...facets.years].sort(), [
    [5784, 1],
    [5785, 1],
    [5786, 2],
    [5787, 1],
  ]);
});

test('groupBySeries: במעקב קודם, אחר כך הרבה לפני מעט, אחר כך החדשה ביותר; מקורות מאוחדים', () => {
  const index = makeIndex(SPEC);
  const idx = Cycle.issuesOf(index, Cycle.topic('p:vayakhel'), {});
  const groups = Cycle.groupBySeries(index, idx, new Set());
  assert.deepEqual(
    groups.map((g) => [g.id, g.idx.length]),
    [
      ['s_a', 2],
      ['s_b', 2],
      ['s_c', 1],
    ],
  );
  assert.equal(groups[0].newest, A.Index.dayOf('2027-03-06'));
  assert.deepEqual(index._srcsOfMask(groups[1].mask).sort(), ['tashma']);
  assert.deepEqual(index._srcsOfMask(groups[0].mask).sort(), ['ladaat']);
  // סדרה שעוקבים אחריה עולה לראש, גם עם פחות גיליונות
  const followed = Cycle.groupBySeries(index, idx, new Set(['s_c']));
  assert.equal(followed[0].id, 's_c');
  // בתוך קבוצה הסדר נשמר: מהחדש לישן
  assert.deepEqual(
    groups[0].idx.map((i) => index.item(i).date),
    ['2027-03-06', '2026-03-14'],
  );
  // לפי שנה: מהחדשה לישנה
  const byYear = Cycle.groupByYear(index, idx);
  assert.deepEqual(
    byYear.map((g) => g.key),
    [5787, 5786, 5785, 5784],
  );
});

test('buildRows: כותרת לכל קבוצה, שורות של perRow, ורצף שטוח ברצף ההצגה', () => {
  const index = makeIndex(SPEC);
  const idx = Cycle.issuesOf(index, Cycle.topic('p:vayakhel'), {});
  const groups = Cycle.groupBySeries(index, idx, new Set());
  const { rows, flat } = Cycle.buildRows(groups, 2);
  assert.equal(flat.length, 5);
  assert.deepEqual(
    rows.map((r) => (r.header ? 'H' + r.header.idx.length : r.start + '+' + r.n)),
    ['H2', '0+2', 'H2', '2+2', 'H1', '4+1'],
  );
  assert.deepEqual(
    flat,
    groups.flatMap((g) => g.idx),
  );
  const single = Cycle.buildRows(groups, 1);
  assert.equal(single.rows.length, 3 + 5);
  assert.deepEqual(Cycle.buildRows([], 1), { rows: [], flat: [] });
});

test('נתונים חסרים: אינדקס ריק, נושא בלי גיליונות, קטלוג בלי תיוג מועדים', () => {
  const empty = new CatalogIndex({ source: (id) => id });
  assert.equal(empty.topicCounts().parasha.size, 0);
  assert.equal(empty.topicCounts().event.size, 0);
  assert.deepEqual(Cycle.issuesOf(empty, Cycle.topic('p:noach'), {}), []);
  const summary = Cycle.summarize(empty, [], Cycle.topic('p:noach'));
  assert.deepEqual(
    { c: summary.count, s: summary.seriesCount, a: summary.hyMin, b: summary.hyMax },
    { c: 0, s: 0, a: 0, b: 0 },
  );
  // קטלוג ישן בלי שדה `event`: אין ספירות למועדים, והפרשות עובדות
  const legacy = makeIndex(SPEC.map(([n, s, hy, date, parasha]) => [n, s, hy, date, parasha]));
  assert.equal(legacy.topicCounts().event.size, 0);
  assert.ok(legacy.topicCounts().parasha.get('vayakhel') > 0);
  assert.deepEqual(Cycle.issuesOf(legacy, Cycle.topic('e:purim'), {}), []);
  // גיליון עם פרשה לא מוכרת אינו שובר את הספירה
  const odd = makeIndex([[1, 's_a', 5787, '2026-10-17', ['not-a-parasha']]]);
  assert.equal(odd.topicCounts().parasha.get('not-a-parasha'), 1);
});

// ---------------------------------------------- הקטלוג האמיתי (אם קיים)

const realDir = findCatalog();

test(
  'קטלוג אמיתי: ספירת כל פרשה ומועד שווה לספירה נאיבית על הנתונים הגולמיים',
  { skip: !realDir && 'אין catalog/out' },
  () => {
    const raw = loadRaw(realDir);
    const index = buildIndex(A, raw);
    const naiveParasha = new Map();
    const naiveEvent = new Map();
    const naiveCombo = new Map();
    for (const shard of raw.shards)
      for (const it of shard.list) {
        for (const p of it.parasha || []) naiveParasha.set(p, (naiveParasha.get(p) || 0) + 1);
        if (it.event) naiveEvent.set(it.event, (naiveEvent.get(it.event) || 0) + 1);
        if ((it.parasha || []).length > 1) {
          const k = it.parasha.join('+');
          naiveCombo.set(k, (naiveCombo.get(k) || 0) + 1);
        }
      }
    const started = performance.now();
    const counts = index.topicCounts();
    const ms = performance.now() - started;
    assert.ok(ms < 100, 'topicCounts ' + ms + 'ms');
    assert.deepEqual([...counts.parasha].sort(), [...naiveParasha].sort());
    assert.deepEqual([...counts.event].sort(), [...naiveEvent].sort());
    assert.equal(counts.parasha.size, 54);
    // כל זוג משולב בקטלוג הוא אחד מהזוגות המוכרים, בסדר התורה
    const pairs = new Set(Cycle.PAIRS.map((p) => p.join('+')));
    for (const k of naiveCombo.keys()) assert.ok(pairs.has(k), k);
    // כל מועד בגלגל מכוסה בנתונים (או שאין לו עלונים: צום גדליה, תענית אסתר — נדירים אבל קיימים)
    for (const slug of [
      ...Cycle.TISHREI_EVENTS,
      ...Cycle.YEAR_EVENTS.filter((e) => !Cycle.ALIAS_OF[e]),
    ])
      assert.ok(counts.event.get(slug) > 0, 'אין עלונים ל-' + slug);
    // כינויי שבת: כל גיליון של שבת שירה/חזון/נחמו הוא גם גיליון של הפרשה
    for (const [event, slug] of Object.entries(Cycle.ALIAS_OF)) {
      const aliased = Cycle.issuesOf(index, { filters: { event: [event] } }, {});
      const own = new Set(Cycle.issuesOf(index, Cycle.topic('p:' + slug), {}));
      assert.ok(aliased.length > 1000, event);
      assert.ok(
        aliased.every((i) => own.has(i)),
        event + ' ⊆ ' + slug,
      );
      // ההפרש: גיליונות בלי תאריך (אין להם אירוע), ופרשה בלבד מהכותרת
      assert.ok(aliased.length >= own.size * 0.9, event + ': ' + aliased.length + '/' + own.size);
    }
  },
);

test(
  'קטלוג אמיתי: דף פרשה — כל גיליון פעם אחת, והקבוצות מסתכמות לדף; משולב בשני הדפים',
  { skip: !realDir && 'אין catalog/out' },
  () => {
    const raw = loadRaw(realDir);
    const index = buildIndex(A, raw);
    const byId = new Map();
    for (const shard of raw.shards) for (const it of shard.list) byId.set(it.id, it);
    for (const slug of ['bereshit', 'vayakhel', 'pekudei', 'chukat', 'balak', 'vezot-haberakhah']) {
      const tp = Cycle.topic('p:' + slug);
      const started = performance.now();
      const idx = Cycle.issuesOf(index, tp, {});
      const groups = Cycle.groupBySeries(index, idx, new Set());
      const { rows, flat } = Cycle.buildRows(groups, 1);
      const ms = performance.now() - started;
      assert.ok(ms < 250, slug + ' ' + ms + 'ms');
      const naive = [...byId.values()].filter((it) => (it.parasha || []).includes(slug));
      assert.equal(idx.length, naive.length, slug);
      assert.equal(new Set(idx).size, idx.length);
      assert.equal(flat.length, idx.length);
      assert.equal(rows.length, groups.length + idx.length);
      assert.equal(
        groups.reduce((n, g) => n + g.idx.length, 0),
        naive.length,
      );
      // כל קבוצה היא סדרה אחת, ומספר הסדרות שווה לנאיבי
      assert.equal(groups.length, new Set(naive.map((it) => it.series)).size, slug + ' series');
      for (const g of groups)
        assert.ok(
          g.idx.every((i) => index.item(i).series === g.id),
          g.id,
        );
      // מהחדש לישן בתוך כל קבוצה
      for (const g of groups)
        for (let k = 1; k < g.idx.length; k++)
          assert.ok(index.dayc[g.idx[k - 1]] >= index.dayc[g.idx[k]], g.id);
    }
    // גיליון משולב מופיע בשני הדפים ובדף של כל אחד פעם אחת
    const a = new Set(Cycle.issuesOf(index, Cycle.topic('p:vayakhel'), {}));
    const b = new Set(Cycle.issuesOf(index, Cycle.topic('p:pekudei'), {}));
    const both = [...a].filter((i) => b.has(i));
    const combined = [...byId.values()].filter(
      (it) => (it.parasha || []).join('+') === 'vayakhel+pekudei',
    );
    assert.equal(both.length, combined.length);
    assert.ok(combined.length > 500);
    const vayakhel = Cycle.topic('p:vayakhel');
    assert.equal(
      Cycle.select(index, [...a], { mode: 'combined' }).length +
        Cycle.select(index, [...a], { mode: 'alone' }).length,
      a.size,
    );
    assert.equal(Cycle.summarize(index, [...a], vayakhel).combined, combined.length);
  },
);

test(
  'קטלוג אמיתי: דף מועד (פורים, שבת שקלים, שמחת תורה) ו"וזאת הברכה"',
  { skip: !realDir && 'אין catalog/out' },
  () => {
    const raw = loadRaw(realDir);
    const index = buildIndex(A, raw);
    const all = raw.shards.flatMap((s) => s.list);
    for (const slug of ['purim', 'shabbat-shekalim', 'simchat-torah', 'yom-kippur', 'chanukah']) {
      const idx = Cycle.issuesOf(index, Cycle.topic('e:' + slug), {});
      assert.equal(idx.length, all.filter((it) => it.event === slug).length, slug);
    }
    const vezot = Cycle.issuesOf(index, Cycle.topic('p:vezot-haberakhah'), {});
    assert.equal(
      vezot.length,
      all.filter((it) => (it.parasha || []).includes('vezot-haberakhah')).length,
    );
    assert.deepEqual(Cycle.RELATED['p:vezot-haberakhah'], ['e:simchat-torah']);
  },
);

// ------------------------------------------------------------ מצב שמור

test('מצב שמור: קיבוץ דף הנושא נשמר ומנוקה, ו"מעגל השנה" היא לשונית פתיחה תקינה', async () => {
  const { createFakeSdk } = require('../../tools/preview/fake-sdk.js');
  const quiet = { warn() {}, error() {}, debug() {}, info() {} };
  const make = (sdk) =>
    new A.State.State(A.Runtime.createRuntime(sdk, { logger: quiet }), {
      saveDelay: 0,
      log: quiet,
      now: () => 1000,
    });
  const sdk = createFakeSdk();
  const s = make(sdk);
  await s.load();
  s.setViewState('cycle', { group: 'year', junk: 1 });
  s.setPref('startTab', 'cycle');
  await s.flush();
  const again = make(sdk);
  await again.load();
  assert.deepEqual(again.viewState('cycle'), { group: 'year' });
  assert.equal(again.prefs.startTab, 'cycle');
  again.setViewState('cycle', { group: 'nonsense' });
  assert.deepEqual(again.viewState('cycle'), { group: 'series' });
  again.setPref('startTab', 'nope');
  assert.equal(again.prefs.startTab, 'week');
});
