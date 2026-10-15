// קבועים וכלים טהורים שכל השכבות חולקות: מפתחות אחסון, שמות פרשות ושפות,
// שנה עברית באותיות, אימות כתובות, שמות קבצים ופורמטים. אין כאן DOM ואין SDK.
(function (root) {
  'use strict';

  const I18n = root.Alonim.I18n;
  const t = (text, vars) => I18n.t(text, vars);
  /** מסמן מחרוזת לתרגום בלי לתרגם אותה עכשיו: התרגום בזמן הציור. */
  const N = (text) => text;

  const PLUGIN_ID = 'com.otzaria-alonim';
  /** זהה ל-`manifest.json` (נבדק ב-test/manifest.test.js). */
  const PLUGIN_VERSION = '0.1.0';
  const CATALOG_BASE = 'https://raw.githubusercontent.com/mmichaelush/otzaria-alonim-plugin/data/';
  /** גרסת הסכמה של הקטלוג שהתוסף מכיר. גבוהה יותר = "יש גרסה חדשה של התוסף". */
  const SCHEMA = 1;
  const REPO_URL = 'https://github.com/mmichaelush/otzaria-alonim-plugin';

  /** מפתחות `storage.*`: שיטה אחת למפתח, כדי ששמירה מאוחדת לא תתערבב. */
  const KEYS = Object.freeze({
    prefs: 'prefs',
    favorites: 'state_favorites',
    read: 'state_read',
    series: 'state_series',
    rules: 'state_rules',
    lists: 'state_lists',
    opened: 'state_opened',
  });

  /**
   * קידומות הקבצים (זהות ל-`network.allowlist` במניפסט, פרט לקטלוג): הורדה
   * מותרת רק אליהן. כל כתובת אחרת — "פתח באתר המקור".
   */
  const FILE_PREFIXES = Object.freeze([
    'https://ladaat.co/gilyonot/uploads',
    'https://tashma.co.il/gilyonot/file',
    'https://tashma.co.il/gilyonot/thumb',
    'https://gilyoines.com/storage',
    'https://alonolam.com/wp-content/uploads',
  ]);

  /** דומיינים שמותר לפתוח באתר (`app.openUrl`), בנוסף לאלה שבמניפסט הקטלוג. */
  const SITE_HOSTS = Object.freeze(['ladaat.co', 'tashma.co.il', 'gilyoines.com', 'alonolam.com']);

  // ---------------------------------------------------------------- שפות

  const LANG_NAMES = Object.freeze({
    he: N('עברית'),
    yi: N('אידיש'),
    en: N('אנגלית'),
    de: N('גרמנית'),
    fr: N('צרפתית'),
    es: N('ספרדית'),
    ru: N('רוסית'),
    nl: N('הולנדית'),
    it: N('איטלקית'),
    pt: N('פורטוגזית'),
    fa: N('פרסית'),
    ar: N('ערבית'),
    other: N('אחר'),
  });

  const LANG_CODES = Object.freeze(Object.keys(LANG_NAMES));

  function langName(code) {
    return LANG_NAMES[code] ? t(LANG_NAMES[code]) : String(code || '');
  }

  // --------------------------------------------------------------- פרשות

  const PARASHOT = Object.freeze({
    bereshit: N('בראשית'),
    noach: N('נח'),
    'lech-lecha': N('לך לך'),
    vayera: N('וירא'),
    'chayei-sara': N('חיי שרה'),
    toldot: N('תולדות'),
    vayetzei: N('ויצא'),
    vayishlach: N('וישלח'),
    vayeshev: N('וישב'),
    miketz: N('מקץ'),
    vayigash: N('ויגש'),
    vayechi: N('ויחי'),
    shemot: N('שמות'),
    vaera: N('וארא'),
    bo: N('בא'),
    beshalach: N('בשלח'),
    yitro: N('יתרו'),
    mishpatim: N('משפטים'),
    terumah: N('תרומה'),
    tetzaveh: N('תצוה'),
    'ki-tisa': N('כי תשא'),
    vayakhel: N('ויקהל'),
    pekudei: N('פקודי'),
    vayikra: N('ויקרא'),
    tzav: N('צו'),
    shemini: N('שמיני'),
    tazria: N('תזריע'),
    metzora: N('מצורע'),
    'achrei-mot': N('אחרי מות'),
    kedoshim: N('קדושים'),
    emor: N('אמור'),
    behar: N('בהר'),
    bechukotai: N('בחוקותי'),
    bamidbar: N('במדבר'),
    nasso: N('נשא'),
    behaalotcha: N('בהעלותך'),
    shlach: N('שלח'),
    korach: N('קרח'),
    chukat: N('חוקת'),
    balak: N('בלק'),
    pinchas: N('פינחס'),
    matot: N('מטות'),
    masei: N('מסעי'),
    devarim: N('דברים'),
    vaetchanan: N('ואתחנן'),
    eikev: N('עקב'),
    reeh: N('ראה'),
    shoftim: N('שופטים'),
    'ki-teitzei': N('כי תצא'),
    'ki-tavo': N('כי תבוא'),
    nitzavim: N('נצבים'),
    vayeilech: N('וילך'),
    haazinu: N('האזינו'),
    'vezot-haberakhah': N('וזאת הברכה'),
  });

  const EVENTS = Object.freeze({
    'rosh-hashana': N('ראש השנה'),
    'shabbat-shuva': N('שבת שובה'),
    'yom-kippur': N('יום כיפור'),
    sukkot: N('סוכות'),
    'shemini-atzeret': N('שמיני עצרת'),
    'simchat-torah': N('שמחת תורה'),
    chanukah: N('חנוכה'),
    'shabbat-shekalim': N('שבת שקלים'),
    'shabbat-zachor': N('שבת זכור'),
    'shabbat-parah': N('שבת פרה'),
    'shabbat-hachodesh': N('שבת החודש'),
    'shabbat-hagadol': N('שבת הגדול'),
    pesach: N('פסח'),
    shavuot: N('שבועות'),
    purim: N('פורים'),
    'shabbat-chazon': N('שבת חזון'),
    'shabbat-nachamu': N('שבת נחמו'),
    'tisha-bav': N('תשעה באב'),
    'tu-bishvat': N('ט״ו בשבט'),
    'shabbat-shirah': N('שבת שירה'),
    'lag-baomer': N('ל״ג בעומר'),
  });

  /** שם הפרשה בעברית; סלאג לא מוכר חוזר כמות שהוא, בלי מקפים. */
  function parashaName(slug) {
    return PARASHOT[slug] ? t(PARASHOT[slug]) : String(slug || '').replace(/-/g, ' ');
  }

  function eventName(slug) {
    return EVENTS[slug] ? t(EVENTS[slug]) : String(slug || '').replace(/-/g, ' ');
  }

  /** "מטות־מסעי" לשבת משולבת. */
  function parashaLabel(slugs) {
    return (slugs || []).map(parashaName).join('־');
  }

  /** תווית שבוע לגיליון: הפרשה, ובחג או בשבת מיוחדת — גם היא. */
  function weekLabel(item) {
    const parasha = parashaLabel(item.parasha);
    const event = item.event ? eventName(item.event) : '';
    if (parasha && event) return parasha + ' · ' + event;
    return parasha || event || '';
  }

  // ------------------------------------------------------- שנה עברית

  const Heb = root.Alonim.HebCal;

  /** 5787 ← תשפ״ז (בלי האלפים), עם גרש/גרשיים כמו בכתיבה רגילה. */
  const hyLetters = (year) => Heb.yearLetters(year);

  /** מספר ("5787", "787") או אותיות (תשפ"ז, תשפז) ← 5787; `null` אם אינו שנה. */
  function parseYear(text) {
    const s = String(text || '').trim();
    if (/^\d{3,4}$/.test(s)) {
      const n = Number(s);
      return n < 1000 ? n + 5000 : n;
    }
    const n = Heb.parseNumeral(s);
    return n && n >= 100 && n <= 999 ? n + 5000 : null;
  }

  // ---------------------------------------------------------- תאריכים

  const pad = (n) => (n < 10 ? '0' + n : String(n));

  /** `YYYY-MM-DD` בשעון המקומי. */
  const ymd = (date) => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());

  /** צהריים מקומי: בלי קפיצות של שעון קיץ. */
  function parseYmd(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
  }

  const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);

  /** השבת הקרובה (היום, אם הוא שבת). */
  function upcomingShabbat(today) {
    return addDays(today, (6 - today.getDay() + 7) % 7);
  }

  const uiLang = () => (I18n.language === 'he' ? 'he' : I18n.language);

  /**
   * שורת תאריך לתצוגה, עברי ולועזי: "שבת, כ״ז בחשוון תשפ״ז · 7 בנובמבר 2026".
   * האפשרויות ב-`HebCal.format` (weekday, hebrew, gregorian, short, year).
   */
  const dateLine = (date, options) => Heb.format(date, { lang: uiLang(), ...(options || {}) });

  /** `dateLine` לתאריך `YYYY-MM-DD` מהקטלוג; טקסט שאינו תאריך חוזר כמות שהוא. */
  function dateText(text, options) {
    const date = parseYmd(text);
    return date ? dateLine(date, options) : String(text || '');
  }

  /** תאריך עברי בלבד: "כ״ז בחשוון תשפ״ז". */
  const hebrewDate = (date, options) => Heb.formatHebrew(date, { lang: uiLang(), ...(options || {}) });

  /** חותמת זמן (נבדק/הורד/נפתח): "כ״ז בחשוון · 7.11.2026, 14:05". */
  function formatStamp(ms) {
    const date = new Date(ms);
    if (!ms || Number.isNaN(date.getTime())) return '';
    const time = pad(date.getHours()) + ':' + pad(date.getMinutes());
    return Heb.format(date, { lang: uiLang(), short: true, year: false }) + ', ' + time;
  }

  /** תאריך+שעה לפי האזור (לשימושים טכניים שבהם אין צורך בתאריך עברי). */
  function formatDate(date, options) {
    try {
      return new Intl.DateTimeFormat(I18n.locale(), options || { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    } catch (error) {
      return ymd(date);
    }
  }

  // --------------------------------------------------------- פורמטים

  /**
   * "24.1 MB", עטוף כמקטע שמאל-לימין מבודד (LRI…PDI): בלי זה בתוך משפט עברי
   * מספר ויחידה לטינית מתהפכים ל-"MB 24.1".
   */
  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    let text;
    if (n < 1024 * 1024) text = Math.max(1, Math.round(n / 1024)) + ' KB';
    else {
      const mb = n / (1024 * 1024);
      text = (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB';
    }
    return '⁦' + text + '⁩';
  }

  /** ספרות באותו פורמט בכל מקום (בלי מפרידי אלפים שמשתנים לפי שפה). */
  const formatCount = (n) => Number(n || 0).toLocaleString(I18n.locale());

  function relativeDays(fromMs, nowMs) {
    return Math.floor((nowMs - fromMs) / 86400000);
  }

  // ------------------------------------------------------------ כתובות

  function parseUrl(text) {
    try {
      return new URL(String(text));
    } catch (error) {
      return null;
    }
  }

  /** שם מארח ציבורי: לא IP, לא localhost, לא שם פנימי. */
  function isPublicHost(host) {
    if (!host || !/\./.test(host) || host === 'localhost') return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
    return /^[a-z0-9.-]+$/i.test(host);
  }

  /** https בלבד, בלי פרטי התחברות, ובלי IP או localhost. */
  function isSafeHttpsUrl(text) {
    const u = parseUrl(text);
    return Boolean(u && u.protocol === 'https:' && !u.username && !u.password && isPublicHost(u.hostname));
  }

  /** האם [text] תחת אחת הקידומות ב-[prefixes] (גבול נתיב, לא רק מחרוזת). */
  function matchesPrefix(text, prefixes) {
    const u = parseUrl(text);
    if (!u || !isSafeHttpsUrl(text)) return false;
    const target = u.origin + u.pathname;
    return prefixes.some((prefix) => {
      const p = parseUrl(prefix);
      if (!p) return false;
      const base = p.origin + p.pathname.replace(/\/$/, '');
      if (u.origin !== p.origin) return false;
      return target === base || target.startsWith(base + '/') || (p.pathname === '/' && target.startsWith(base));
    });
  }

  /** כתובת קובץ שמותר להוריד אליה דרך `network.download`. */
  const isDownloadUrl = (text) => matchesPrefix(text, FILE_PREFIXES);

  /**
   * כתובת של אתר מקור שמותר לפתוח בדפדפן: https ודומיין ברשימה (הקבועה,
   * ובנוסף אתרי המקורות שבמניפסט הקטלוג — [extraHosts]).
   */
  function isSiteUrl(text, extraHosts) {
    const u = parseUrl(text);
    if (!u || !isSafeHttpsUrl(text)) return false;
    const host = u.hostname.toLowerCase();
    const allowed = SITE_HOSTS.concat(extraHosts || []);
    return allowed.some((h) => host === h || host.endsWith('.' + h));
  }

  // ------------------------------------------- כתובות הנכסים מהקטלוג

  /** מקודד רק תווים שאינם ASCII, תו אחר תו, ב-hex גדול (כמו `catalog/lib/urls.mjs`). */
  function encodeNonAscii(text) {
    let out = '';
    for (const ch of String(text)) out += ch.codePointAt(0) < 128 ? ch : encodeURIComponent(ch);
    return out;
  }

  /** מפענח רצפי בייטים מקודדים של תווים שאינם ASCII; קידוד ASCII (%20) נשאר. */
  function decodeNonAscii(text) {
    return String(text).replace(/(?:%[89A-Fa-f][0-9A-Fa-f])+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch (error) {
        return run;
      }
    });
  }

  const URL_FIELDS = ['url', 'page', 'thumb'];

  /**
   * המקום היחיד שבו כתובות הנכסים נבנות מהקטלוג (חוזה הדחיסה ב-
   * docs/CATALOG_FORMAT.md; וקטורי הבדיקה משותפים עם הקטלוג):
   * שדה חסר + תבנית ב-`sources[].urlTemplates` = התבנית עם `{ext}` מוחלף; ערך
   * שמתחיל ב-`https://` מוחלט, אחרת `urlBase + ערך` (תבנית ריקה = `urlBase`);
   * תווים שאינם ASCII נשמרים מפוענחים בקטלוג ומקודדים כאן ורק כאן. שדה בלי ערך
   * ובלי תבנית נשאר חסר. מחזיר `{ url?, page?, thumb? }`.
   */
  function resolveAssetUrls(asset, source) {
    const a = asset || {};
    const templates = (source && source.urlTemplates) || {};
    const base = source && typeof source.urlBase === 'string' ? source.urlBase : '';
    const out = {};
    for (const field of URL_FIELDS) {
      let value = a[field];
      if (value === undefined || value === null) {
        const template = templates[field];
        if (typeof template !== 'string') continue;
        value = template.split('{ext}').join(a.ext === undefined || a.ext === null ? '' : String(a.ext));
      }
      value = String(value);
      out[field] = encodeNonAscii(value.startsWith('https://') ? value : base + value);
    }
    return out;
  }

  // ------------------------------------------------------- שמות קבצים

  // תווים שאסורים בשם קובץ ב-Windows, תווי בקרה, וסימני כיוון שמבלבלים את
  // סייר הקבצים.
  const BAD_FILE_CHARS = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001F\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]', 'g');
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  /**
   * שם קובץ או תיקייה בטוחים: בלי `..`, בלי תווי נתיב, בלי נקודה או רווח בסוף,
   * בלי שם שמור של Windows, ועד [max] תווים.
   */
  function sanitizeFileName(name, max) {
    let s = String(name === null || name === undefined ? '' : name)
      .normalize('NFC')
      .replace(/\.{2,}/g, '')
      .replace(BAD_FILE_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '');
    const limit = max || 80;
    if (s.length > limit) s = s.slice(0, limit).replace(/[. ]+$/, '');
    if (!s || RESERVED.test(s)) s = '_' + s;
    return s === '_' ? '_' : s;
  }

  /** 8 התווים האחרונים של המזהה, בתוך סוגריים בשם הקובץ: כך מזהים הורדה בדיסק. */
  const idFragment = (id) => String(id || '').replace(/^i_/, '').slice(0, 8);

  /**
   * הנתיב היחסי של גיליון בתיקיית ההורדות: `<שנה>/<סדרה>/<קובץ>.pdf`. דטרמיניסטי,
   * כדי שמצב "הורד" ייגזר מהדיסק בלי מצב שמור.
   */
  function downloadPath(item, seriesTitle) {
    const year = item.hy ? String(item.hy) : 'ללא שנה';
    const series = sanitizeFileName(seriesTitle || item.title || 'עלון', 60);
    const label = weekLabel(item) || item.date || '';
    const base = sanitizeFileName([seriesTitle || item.title, label, item.no ? '#' + item.no : ''].filter(Boolean).join(' - '), 90);
    return { dir: year + '/' + series, file: base + ' [' + idFragment(item.id) + '].pdf' };
  }

  /** מחלץ את מזהה הגיליון משם קובץ שהורד (`… [8c11d0e4].pdf`). */
  function fragmentFromFile(name) {
    const m = /\[([0-9a-f]{8})\]\.pdf$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : null;
  }

  // ---------------------------------------------------------- שונות

  const clone = (value) => JSON.parse(JSON.stringify(value));

  /**
   * האם המקש הוא האות [letter]. בפריסת מקלדת עברית `event.key` הוא 'ל' ולא 'k',
   * ולכן מקש שאינו אות לטינית נבדק לפי המקש הפיזי (`event.code`).
   */
  function keyIs(event, letter) {
    const key = String(event.key || '');
    const wanted = String(letter).toLowerCase();
    if (/^[a-z]$/i.test(key)) return key.toLowerCase() === wanted;
    return event.code === 'Key' + wanted.toUpperCase();
  }

  const api = {
    PLUGIN_ID,
    PLUGIN_VERSION,
    CATALOG_BASE,
    SCHEMA,
    REPO_URL,
    KEYS,
    FILE_PREFIXES,
    SITE_HOSTS,
    LANG_CODES,
    LANG_NAMES,
    PARASHOT,
    EVENTS,
    langName,
    parashaName,
    eventName,
    parashaLabel,
    weekLabel,
    hyLetters,
    parseYear,
    ymd,
    parseYmd,
    addDays,
    upcomingShabbat,
    dateLine,
    dateText,
    hebrewDate,
    formatStamp,
    formatDate,
    formatBytes,
    formatCount,
    relativeDays,
    parseUrl,
    isPublicHost,
    isSafeHttpsUrl,
    matchesPrefix,
    isDownloadUrl,
    isSiteUrl,
    resolveAssetUrls,
    encodeNonAscii,
    keyIs,
    decodeNonAscii,
    sanitizeFileName,
    idFragment,
    downloadPath,
    fragmentFromFile,
    clone,
  };
  root.Alonim.Core = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
