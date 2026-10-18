// "מעגל השנה": המודל של סדר השנה (פרשות ומועדים), נושאי הדפים ("בראשית בכל השנים"),
// והקיבוץ של גיליונות הנושא לסדרות. פונקציות טהורות (בלי DOM); המסכים ב-
// `alonim-ui-cycle.js`, `alonim-ui-topic.js` ו-`alonim-ui-ring.js`. החלטות: docs/ARCHITECTURE.md.
//
// מודל הנתונים: אין שדה חדש בקטלוג. כל גיליון נושא `parasha` (מערך, שתיים בשבת משולבת)
// ו-`event` (האירוע הראשי), והאינדקס כבר מסנן לפיהם. "דף נושא" הוא חיפוש עם מסנן קבוע:
// פרשה = `{ parasha: [slug] }`, מועד = `{ event: [slug] }`. גיליון של שבת משולבת (ויקהל־פקודי)
// שייך לשתי הפרשות, ומופיע פעם אחת בכל אחד משני הדפים.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;
  const Weeks = A.Weeks;
  const HebCal = A.HebCal;
  const N = (text) => text;

  /** כל 54 הפרשות לפי סדר התורה. */
  const PARASHA_ORDER = Object.freeze(Object.keys(Core.PARASHOT));

  /** חמשת החומשים, לפי טווח פרשות. */
  const CHUMASHIM = Object.freeze([
    { id: 'bereshit', name: N('חומש בראשית'), first: 'bereshit', last: 'vayechi' },
    { id: 'shemot', name: N('חומש שמות'), first: 'shemot', last: 'pekudei' },
    { id: 'vayikra', name: N('חומש ויקרא'), first: 'vayikra', last: 'bechukotai' },
    { id: 'bamidbar', name: N('חומש במדבר'), first: 'bamidbar', last: 'masei' },
    { id: 'devarim', name: N('חומש דברים'), first: 'devarim', last: 'vezot-haberakhah' },
  ]);

  /** זוגות הפרשות שנקראות לעיתים בשבת אחת (בשנים שונות, וחלקם רק בחוץ לארץ). */
  const PAIRS = Object.freeze([
    ['vayakhel', 'pekudei'],
    ['tazria', 'metzora'],
    ['achrei-mot', 'kedoshim'],
    ['behar', 'bechukotai'],
    ['chukat', 'balak'],
    ['matot', 'masei'],
    ['nitzavim', 'vayeilech'],
  ]);

  /** הפרשה שמתחברת אליה בשבת משולבת, או `null`. */
  function partnerOf(slug) {
    for (const [a, b] of PAIRS) {
      if (a === slug) return b;
      if (b === slug) return a;
    }
    return null;
  }

  // ------------------------------------------------------------- מועדים

  /** חגי תשרי: פותחים את הגלגל (ראש השנה עד שמחת תורה), כסדרם בלוח. */
  const TISHREI_EVENTS = Object.freeze([
    'rosh-hashana',
    'tzom-gedaliah',
    'shabbat-shuva',
    'yom-kippur',
    'sukkot',
    'chol-hamoed-sukkot',
    'hoshana-raba',
    'shemini-atzeret',
    'simchat-torah',
  ]);

  /** שאר המועדים, בסדר הכרונולוגי בשנה: בתוך אותה פרשה הם נשארים בסדר הזה. */
  const YEAR_EVENTS = Object.freeze([
    'chanukah',
    'asara-btevet',
    'shabbat-shirah',
    'tu-bishvat',
    'shabbat-shekalim',
    'shabbat-zachor',
    'taanit-esther',
    'purim',
    'shushan-purim',
    'shabbat-parah',
    'shabbat-hachodesh',
    'shabbat-hagadol',
    'pesach',
    'chol-hamoed-pesach',
    'shvii-shel-pesach',
    'lag-baomer',
    'shavuot',
    'shiva-asar-btammuz',
    'shabbat-chazon',
    'tisha-bav',
    'shabbat-nachamu',
  ]);

  /**
   * מועדים שאינם בגלגל: ראש חודש (בכל חודש; גיליון שבת ראש חודש כבר בדף הפרשה שלו) ושני
   * האירועים המשניים של הקטלוג (עשרת ימי תשובה, שבת מברכים), שאינם נשמרים בגיליונות.
   */
  const NOT_IN_WHEEL = Object.freeze(['rosh-chodesh', 'aseret-yemei-teshuva', 'shabbat-mevarchim']);

  /**
   * שבתות שהן תמיד אותה פרשה: כל גיליון של "שבת שירה" הוא גם גיליון של בשלח (נמדד בקטלוג
   * האמיתי: 1,848 מתוך 1,946; השאר גיליונות בלי תאריך, שאין להם אירוע). לכן אין להן אריח
   * משלהן: הן כתובית על אריח הפרשה, וקישור אליהן נפתח בדף הפרשה.
   */
  const ALIAS_OF = Object.freeze({
    'shabbat-shirah': 'beshalach',
    'shabbat-chazon': 'devarim',
    'shabbat-nachamu': 'vaetchanan',
  });
  const ALIAS_BY_PARASHA = Object.freeze(
    Object.fromEntries(Object.entries(ALIAS_OF).map(([event, slug]) => [slug, event])),
  );

  /**
   * המקום של כל מועד בין הפרשות: "אחרי הפרשה X". נמדד על לוח הקטלוג (35 שנים): הפרשה של השבת
   * האחרונה שלפני המועד (או של אותה שבת, בשבתות מיוחדות). בשנה מעוברת מועדי אדר ופסח נקראים
   * חמישה שבועות מאוחר יותר ביחס לפרשות, ולכן יש שתי טבלאות; `cycle.test.js` בודק אותן מול הלוח.
   */
  const AFTER = Object.freeze({
    plain: Object.freeze({
      chanukah: 'vayeshev',
      'asara-btevet': 'vayigash',
      'shabbat-shirah': 'beshalach',
      'tu-bishvat': 'beshalach',
      'shabbat-shekalim': 'mishpatim',
      'shabbat-zachor': 'tetzaveh',
      'taanit-esther': 'tetzaveh',
      purim: 'tetzaveh',
      'shushan-purim': 'tetzaveh',
      'shabbat-parah': 'ki-tisa',
      'shabbat-hachodesh': 'pekudei',
      'shabbat-hagadol': 'tzav',
      pesach: 'tzav',
      'chol-hamoed-pesach': 'tzav',
      'shvii-shel-pesach': 'tzav',
      'lag-baomer': 'emor',
      shavuot: 'bamidbar',
      'shiva-asar-btammuz': 'balak',
      'shabbat-chazon': 'devarim',
      'tisha-bav': 'devarim',
      'shabbat-nachamu': 'vaetchanan',
    }),
    leap: Object.freeze({
      chanukah: 'vayeshev',
      'asara-btevet': 'vayigash',
      'shabbat-shirah': 'beshalach',
      'tu-bishvat': 'beshalach',
      'shabbat-shekalim': 'vayakhel',
      'shabbat-zachor': 'vayikra',
      'taanit-esther': 'vayikra',
      purim: 'vayikra',
      'shushan-purim': 'vayikra',
      'shabbat-parah': 'shemini',
      'shabbat-hachodesh': 'tazria',
      'shabbat-hagadol': 'metzora',
      pesach: 'metzora',
      'chol-hamoed-pesach': 'metzora',
      'shvii-shel-pesach': 'metzora',
      'lag-baomer': 'behar',
      shavuot: 'bamidbar',
      'shiva-asar-btammuz': 'balak',
      'shabbat-chazon': 'devarim',
      'tisha-bav': 'devarim',
      'shabbat-nachamu': 'vaetchanan',
    }),
  });

  /** סוג המועד, לשורת המשנה בדף: חג, שבת מיוחדת, צום. */
  const EVENT_KIND = Object.freeze({
    'rosh-hashana': 'chag',
    'tzom-gedaliah': 'fast',
    'shabbat-shuva': 'special',
    'yom-kippur': 'chag',
    sukkot: 'chag',
    'chol-hamoed-sukkot': 'moed',
    'hoshana-raba': 'moed',
    'shemini-atzeret': 'chag',
    'simchat-torah': 'chag',
    chanukah: 'chag',
    'asara-btevet': 'fast',
    'tu-bishvat': 'moed',
    'shabbat-shirah': 'special',
    'shabbat-shekalim': 'special',
    'shabbat-zachor': 'special',
    'taanit-esther': 'fast',
    purim: 'chag',
    'shushan-purim': 'moed',
    'shabbat-parah': 'special',
    'shabbat-hachodesh': 'special',
    'shabbat-hagadol': 'special',
    pesach: 'chag',
    'chol-hamoed-pesach': 'moed',
    'shvii-shel-pesach': 'chag',
    'lag-baomer': 'moed',
    shavuot: 'chag',
    'shiva-asar-btammuz': 'fast',
    'tisha-bav': 'fast',
    'shabbat-chazon': 'special',
    'shabbat-nachamu': 'special',
  });
  const KIND_LABELS = Object.freeze({
    chag: N('חג'),
    moed: N('מועד'),
    special: N('שבת מיוחדת'),
    fast: N('צום'),
  });

  /** קשרים הדדיים בין דף פרשה לדף מועד שמשלים אותו. */
  const RELATED = Object.freeze({
    'p:vezot-haberakhah': ['e:simchat-torah'],
    'e:simchat-torah': ['p:vezot-haberakhah'],
  });

  // ------------------------------------------------------------- מפתחות

  const pKey = (slug) => 'p:' + slug;
  const eKey = (slug) => 'e:' + slug;

  /**
   * מפתח נושא תקין: `p:<פרשה>` או `e:<מועד>` (מועד שהוא כינוי לפרשה — שבת שירה, חזון, נחמו —
   * נפתח כפרשה). לא תקין (מצב ישן, סלאג לא מוכר) — `null`.
   */
  function canonicalKey(key) {
    const m = /^([pe]):([a-z-]+)$/.exec(String(key || ''));
    if (!m) return null;
    if (m[1] === 'p') return Core.PARASHOT[m[2]] ? pKey(m[2]) : null;
    if (ALIAS_OF[m[2]]) return pKey(ALIAS_OF[m[2]]);
    return Core.EVENTS[m[2]] && !NOT_IN_WHEEL.includes(m[2]) ? eKey(m[2]) : null;
  }

  /** הנושא של [key]: `{ key, kind, slug, filters }`, או `null`. */
  function topic(key) {
    const canonical = canonicalKey(key);
    if (!canonical) return null;
    const kind = canonical[0] === 'p' ? 'parasha' : 'event';
    const slug = canonical.slice(2);
    return {
      key: canonical,
      kind,
      slug,
      filters: kind === 'parasha' ? { parasha: [slug] } : { event: [slug] },
    };
  }

  /** השם בעברית (או בשפת הממשק). */
  const topicName = (tp) =>
    tp.kind === 'parasha' ? Core.parashaName(tp.slug) : Core.eventName(tp.slug);

  /** מפתח הנושא של שבוע (`Weeks.view`): הפרשה (או הפרשה הראשונה בשבת משולבת), ואחרת האירוע. */
  function topicOfView(view) {
    if (!view) return null;
    if (view.parasha && view.parasha.length) return pKey(view.parasha[0]);
    return view.event ? canonicalKey(eKey(view.event)) : null;
  }

  // ------------------------------------------------------------- הסדר

  /**
   * סדר השנה: חגי תשרי, ואחריהם החומשים (ובתוכם הפרשות ומועדי השנה במקומם).
   * [leap]: שנה מעוברת. מחזיר `{ sections, stations }`; תחנה: `{ key, kind, slug, section, n }`
   * (n: מספר הפרשה 1-54, בפרשה בלבד) ו-`alias` (מועד-כינוי שנשען עליה).
   */
  const cache = new Map();
  function order(leap) {
    const flag = leap ? 'leap' : 'plain';
    if (cache.has(flag)) return cache.get(flag);
    const after = AFTER[flag];
    const bySlug = new Map();
    for (const event of YEAR_EVENTS) {
      if (ALIAS_OF[event]) continue;
      const slug = after[event];
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug).push(event);
    }
    const station = (kind, slug, section) => ({
      key: (kind === 'parasha' ? 'p:' : 'e:') + slug,
      kind,
      slug,
      section,
    });
    const sections = [
      {
        id: 'tishrei',
        name: N('חגי תשרי'),
        kind: 'moadim',
        stations: TISHREI_EVENTS.map((slug) => station('event', slug, 'tishrei')),
      },
    ];
    for (const chumash of CHUMASHIM) {
      const from = PARASHA_ORDER.indexOf(chumash.first);
      const to = PARASHA_ORDER.indexOf(chumash.last);
      const stations = [];
      for (let k = from; k <= to; k++) {
        const slug = PARASHA_ORDER[k];
        const parasha = station('parasha', slug, chumash.id);
        parasha.n = k + 1;
        if (ALIAS_BY_PARASHA[slug]) parasha.alias = ALIAS_BY_PARASHA[slug];
        stations.push(parasha);
        for (const event of bySlug.get(slug) || [])
          stations.push(station('event', event, chumash.id));
      }
      sections.push({ id: chumash.id, name: chumash.name, kind: 'chumash', stations });
    }
    const result = { sections, stations: sections.flatMap((s) => s.stations) };
    cache.set(flag, result);
    return result;
  }

  /** החומש של פרשה. */
  function chumashOf(slug) {
    const k = PARASHA_ORDER.indexOf(slug);
    return CHUMASHIM.find(
      (c) => k >= PARASHA_ORDER.indexOf(c.first) && k <= PARASHA_ORDER.indexOf(c.last),
    );
  }

  // --------------------------------------------------- תאריכי השנה

  /**
   * השנה העברית שהגלגל מציג: של השבוע הנוכחי (או של היום, כשאין לוח), ואם היא מעוברת.
   * @param {any[]} views תצוגות `Weeks.build`
   * @param {{ index: number }} current
   * @param {Date} today
   */
  function cycleYear(views, current, today) {
    const view = current && views[current.index];
    const hy = view && view.hy ? view.hy : HebCal.fromDate(today).year;
    return { hy, leap: HebCal.isLeap(hy) };
  }

  /**
   * מפתח תחנה ← שורת השבוע הראשונה שלה בשנה [hy] (לפי העדפת ארץ ישראל / חוץ לארץ שכבר
   * בתצוגות). מועדים: האירוע הראשי או אחד מהמשניים של השורה. "וזאת הברכה" נקראת בשמחת תורה
   * (אין לה שבת משלה בלוח), ולכן התאריך שלה הוא של שמחת תורה.
   */
  function stationDates(views, hy) {
    const dates = new Map();
    for (const view of Weeks.ofYear(views, hy)) {
      if (view.shabbat)
        for (const slug of view.parasha) if (!dates.has(pKey(slug))) dates.set(pKey(slug), view);
      const row = view.row || {};
      const events = new Set([row.event].concat(row.events || []).filter(Boolean));
      for (const event of events) if (!dates.has(eKey(event))) dates.set(eKey(event), view);
    }
    if (!dates.has(pKey('vezot-haberakhah')) && dates.has(eKey('simchat-torah')))
      dates.set(pKey('vezot-haberakhah'), dates.get(eKey('simchat-torah')));
    return dates;
  }

  /** היום שמוצג לתחנה: חנוכה מתוארך בלוח בערב הנר הראשון, ומוצג היום הראשון (כ״ה בכסלו). */
  const displayDay = (key, view) => (key === 'e:chanukah' ? Core.addDays(view.day, 1) : view.day);

  /** שורת השבוע הבאה של נושא (מהיום והלאה); אחרת האחרונה שיש; אחרת `null`. */
  function nextOccurrence(views, tp, todayYmd) {
    // "וזאת הברכה" נקראת בשמחת תורה, ואין לה שורת שבת משלה.
    const event =
      tp.kind === 'event' ? tp.slug : tp.slug === 'vezot-haberakhah' ? 'simchat-torah' : '';
    const hit = (view) =>
      event
        ? [view.row.event].concat(view.row.events || []).includes(event)
        : view.shabbat && view.parasha.includes(tp.slug);
    let last = null;
    for (const view of views) {
      if (!hit(view)) continue;
      if (view.date >= todayYmd) return { view, upcoming: true };
      last = view;
    }
    return last ? { view: last, upcoming: false } : null;
  }

  // ------------------------------------------------------ גיליונות הנושא

  /**
   * חיפוש הנושא באינדקס: מסנן קבוע (פרשה או מועד), מהחדש לישן. הכללים (הסתרה) חלים כרגיל.
   * @returns {number[]} אינדקסים
   */
  function issuesOf(index, tp, ctx) {
    return index.search('', tp.filters, ctx, { sort: 'date' }).idx;
  }

  /** שבת משולבת: לגיליון שתי פרשות. */
  const isCombined = (index, i) => index.p2[i] !== 0;

  /**
   * מצב הצגה של דף פרשה: `all` (הכול), `combined` (רק שבת משולבת), `alone` (רק כשהפרשה לבדה).
   * בדף מועד אין הבחנה.
   */
  const MODES = Object.freeze(['all', 'combined', 'alone']);

  /**
   * עובדות על רשימת גיליונות של נושא: כמות, סדרות, טווח שנים, משולבים, ובני הזוג של
   * שבתות משולבות (`partners`: סלאג ← כמה).
   */
  function summarize(index, idx, tp) {
    const series = new Set();
    let hyMin = 0;
    let hyMax = 0;
    let combined = 0;
    const years = new Set();
    const partners = new Map();
    const own = index.parashot.map.get(tp.slug);
    for (const i of idx) {
      series.add(index.sidx[i]);
      const hy = index.hyc[i];
      if (hy) {
        years.add(hy);
        if (!hyMin || hy < hyMin) hyMin = hy;
        if (hy > hyMax) hyMax = hy;
      }
      if (tp.kind === 'parasha' && isCombined(index, i)) {
        combined++;
        const other = index.parashot.get(index.p1[i] === own ? index.p2[i] : index.p1[i]);
        partners.set(other, (partners.get(other) || 0) + 1);
      }
    }
    return {
      count: idx.length,
      seriesCount: series.size,
      yearCount: years.size,
      hyMin,
      hyMax,
      combined,
      partners,
    };
  }

  /**
   * מסנן את גיליוני הנושא ([idx]) לפי תצוגה: `{ mode, lang, source, hy, query }`. הטקסט כמו בדף
   * סדרה (סעיפים ב-AND, `OR` בתוך סעיף, שלילה). שדות ריקים אינם מסננים.
   */
  function select(index, idx, o) {
    const v = o || {};
    let out = idx;
    if (v.mode === 'combined') out = out.filter((i) => index.p2[i] !== 0);
    else if (v.mode === 'alone') out = out.filter((i) => index.p2[i] === 0);
    if (v.lang) {
      const id = index.langs.map.get(v.lang);
      out = out.filter((i) => index._lang(i) === id);
    }
    if (v.source) {
      const bit = index.sourceBits.get(v.source);
      out = bit === undefined ? [] : out.filter((i) => (index.maskc[i] & (1 << bit)) !== 0);
    }
    if (v.hy) out = out.filter((i) => index.hyc[i] === Number(v.hy));
    if (v.query) {
      const q = A.Index.parseQuery(v.query);
      if (q.clauses.length)
        out = out.filter((i) =>
          q.clauses.every((cl) =>
            cl.alts.some((term) => (term.neg ? !index._termHit(i, term) : index._termHit(i, term))),
          ),
        );
    }
    return out;
  }

  /** ערכי הבחירה של השפה, המקור והשנה בתוך [idx]: `{ langs, sources, years }` (ערך ← כמות). */
  function facetsOf(index, idx) {
    const langs = new Map();
    const sources = new Map();
    const years = new Map();
    const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
    for (const i of idx) {
      bump(langs, index.langs.get(index._lang(i)));
      for (const id of index._srcsOfMask(index.maskc[i])) bump(sources, id);
      if (index.hyc[i]) bump(years, index.hyc[i]);
    }
    return { langs, sources, years };
  }

  /**
   * קבוצות לפי סדרה: סדרות שעוקבים אחריהן קודם, אחר כך הרבה גיליונות לפני מעט, אחר כך החדשה
   * ביותר, ולבסוף א-ב. כל קבוצה: `{ key, id, idx, newest, mask }` (mask: מקורות הסדרה בנושא).
   * @param {Set<string>} [followed] מזהי סדרות במעקב
   */
  function groupBySeries(index, idx, followed) {
    const map = new Map();
    for (const i of idx) {
      const k = index.sidx[i];
      let g = map.get(k);
      if (!g) {
        g = { key: k, id: index.seriesArr[k].id, idx: [], newest: 0, mask: 0 };
        map.set(k, g);
      }
      g.idx.push(i);
      if (index.dayc[i] > g.newest) g.newest = index.dayc[i];
      g.mask |= index.maskc[i];
    }
    const mine = followed || new Set();
    return [...map.values()].sort((a, b) => {
      const fa = mine.has(a.id) ? 0 : 1;
      const fb = mine.has(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      if (a.idx.length !== b.idx.length) return b.idx.length - a.idx.length;
      if (a.newest !== b.newest) return b.newest - a.newest;
      const x = index.seriesArr[a.key]._ntitle;
      const y = index.seriesArr[b.key]._ntitle;
      return x < y ? -1 : x > y ? 1 : a.key - b.key;
    });
  }

  /** קבוצות לפי שנה עברית, מהחדשה לישנה (בלי שנה — בסוף). */
  function groupByYear(index, idx) {
    return index
      .groupResults(idx, 'year')
      .map((g) => ({ key: g.key, id: 'y' + g.key, idx: g.idx }));
  }

  /**
   * שורות הרשימה הוירטואלית: כותרת לכל קבוצה ואחריה שורות של [perRow] גיליונות.
   * מחזיר `{ rows, flat }`: `rows` — `{ header: group }` או `{ start, n }` (מקום ב-`flat`);
   * `flat` — כל הגיליונות בסדר ההצגה (מפתח המיקוד והבחירה).
   */
  function buildRows(groups, perRow) {
    const rows = [];
    const flat = [];
    for (const g of groups) {
      rows.push({ header: g });
      for (let k = 0; k < g.idx.length; k += perRow)
        rows.push({ start: flat.length + k, n: Math.min(perRow, g.idx.length - k) });
      for (const i of g.idx) flat.push(i);
    }
    return { rows, flat };
  }

  const api = {
    PARASHA_ORDER,
    CHUMASHIM,
    PAIRS,
    TISHREI_EVENTS,
    YEAR_EVENTS,
    NOT_IN_WHEEL,
    ALIAS_OF,
    ALIAS_BY_PARASHA,
    AFTER,
    EVENT_KIND,
    KIND_LABELS,
    RELATED,
    MODES,
    partnerOf,
    pKey,
    eKey,
    canonicalKey,
    topic,
    topicName,
    topicOfView,
    order,
    chumashOf,
    cycleYear,
    stationDates,
    displayDay,
    nextOccurrence,
    issuesOf,
    isCombined,
    summarize,
    select,
    facetsOf,
    groupBySeries,
    groupByYear,
    buildRows,
  };
  A.Cycle = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
