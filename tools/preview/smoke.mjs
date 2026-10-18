// טוען כל מסך ותרחיש בדפדפן אמיתי (בהיר, כהה ואנגלית), ונכשל על כל שגיאת
// קונסול. מוסיף בדיקות זרימה (חיפוש, מקלדת, צפיין, הורדה, תרחישי כשל), בדיקת
// גלישה אופקית ב-400px, ובדיקה שכל מחלקת CSS שהופיעה ב-DOM מעוצבת.
//   node tools/preview/smoke.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Browser } from './cdp.mjs';
import { a11yReport } from './a11y.mjs';

const here = dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [join(here, 'build-preview.mjs'), '--large'], { stdio: 'ignore' });
const small = pathToFileURL(join(here, 'out', 'preview.html')).href;
const large = pathToFileURL(join(here, 'out', 'preview-large.html')).href;
const TODAY = 'today=2026-10-15';

const css = readFileSync(join(here, '..', '..', 'plugin', 'css', 'style.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const styled = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
const seenClasses = new Map();

/** [שם, שאילתה, בדיקה אחרי הטעינה (אופציונלי)]. */
const scenarios = [
  [
    'week',
    'page=week',
    "document.querySelector('.hero-title') && document.querySelectorAll('.card').length > 3",
  ],
  ['week-empty-seed', 'page=week&seed=0', "document.querySelector('.hint-card')"],
  [
    'cycle',
    'page=cycle',
    "document.querySelectorAll('.cycle-tile').length >= 70 && document.querySelector('.cycle-tile.is-current')",
  ],
  [
    'cycle-topic',
    'topic=p:noach',
    "document.querySelector('.topic-title') && document.querySelectorAll('.card').length > 3",
  ],
  [
    'cycle-topic-event',
    'topic=e:purim',
    "document.querySelector('.topic-title') && document.querySelector('.topic-when')",
  ],
  [
    'cycle-topic-empty',
    'topic=p:vezot-haberakhah',
    "document.querySelector('.topic-title') && document.querySelector('.state-card')",
  ],
  ['all', 'page=all', "document.querySelectorAll('.card').length > 3"],
  [
    'all-query',
    'page=all&query=' + encodeURIComponent('אסיפת נח'),
    "document.querySelectorAll('.card').length >= 1 && document.querySelector('mark.hit')",
  ],
  [
    'all-none',
    'page=all&query=' + encodeURIComponent('זזזזזז'),
    "document.querySelector('.state-card') && !/החיפוש הוא בעברית|Search is in Hebrew/.test(document.querySelector('.state-card').textContent)",
  ],
  [
    'all-latin-hint',
    'page=all&query=' + encodeURIComponent('mashiv nefesh'),
    "document.querySelector('.state-card') && /החיפוש הוא בעברית|Search is in Hebrew/.test(document.querySelector('.state-card').textContent)",
  ],
  ['all-list-view', 'page=all&view=list', "document.querySelector('.card.is-row')"],
  ['series', 'page=series', "document.querySelectorAll('.series-row').length > 3"],
  [
    'series-page',
    'series=0',
    "document.querySelector('.series-title') && document.querySelectorAll('.card').length > 1",
  ],
  ['mine', 'page=mine', "document.querySelector('.segmented')"],
  ['mine-lists', 'page=mine&minetab=lists', "document.querySelector('.state-card, .list-header')"],
  ['mine-shabbat', 'page=mine&minetab=shabbat', "document.querySelector('.shabbat-header')"],
  [
    'mine-downloads',
    'page=mine&minetab=downloads',
    "document.querySelector('.state-card, .list-header')",
  ],
  [
    'mine-history',
    'page=mine&minetab=history&seed=1',
    "document.querySelector('.history-page, .state-card')",
  ],
  ['settings', 'page=settings', "document.querySelectorAll('.settings-card').length >= 8"],
  ['settings-rules', 'page=settings&section=rules', "document.querySelector('.rule-form')"],
  [
    'settings-general',
    'page=settings&section=general',
    "document.querySelector('[data-section=general] .switch')",
  ],
  [
    'settings-storage',
    'page=settings&section=disk',
    "document.querySelector('[data-section=disk] .history-row') && document.querySelector('[data-section=disk] .setting-actions')",
  ],
  [
    'settings-help',
    'page=settings&section=help',
    "document.querySelector('[data-section=help] .syntax') && document.querySelector('[data-section=help] .shortcuts')",
  ],
  [
    'settings-diagnostics',
    'page=settings&section=diagnostics',
    "document.querySelector('[data-section=diagnostics] .diag-table') && document.querySelector('[data-section=diagnostics] .log-area')",
  ],
  [
    'settings-diagnostics-legacy',
    'page=settings&section=diagnostics&host=legacy',
    "document.querySelector('[data-section=diagnostics] .diag-table .is-no')",
  ],
  ['welcome', 'welcome=1', "document.querySelector('.welcome')"],
  ['settings-backup', 'page=settings&section=backup', "document.querySelector('.code-area')"],
  ['details', 'details=0', "document.querySelector('.dialog .asset-list')"],
  ['viewer', 'open=0', "document.querySelector('.viewer-frame')"],
  ['viewer-legacy', 'open=0&host=legacy', "document.querySelector('.viewer-frame')"],
  ['viewer-nofolder', 'open=0&nofolder=1', "document.querySelector('.viewer-frame')"],
  [
    'viewer-nofolder-legacy',
    'open=0&nofolder=1&host=legacy',
    "document.querySelector('.viewer .state-card')",
  ],
  [
    'viewer-print',
    'open=0&print=1&xorigin=1&scenario=print-gesture-first',
    "document.querySelector('.viewer-banner')",
  ],
  [
    'viewer-print-legacy',
    'open=0&print=1&xorigin=1&host=legacy',
    "document.querySelector('.print-dialog')",
  ],
  ['viewer-linux', 'open=0&platform=linux', "document.querySelector('.viewer .state-card')"],
  [
    'offline',
    'scenario=offline&page=week&warm=1',
    "document.querySelector('.hero-title') && document.querySelectorAll('.card').length > 3",
  ],
  ['offline-nocache', 'scenario=offline&page=week&seed=0&nocache=1', 'true'],
  ['blocked', 'scenario=blocked', 'true'],
  ['bad-schema', 'scenario=bad-schema', 'true'],
  ['rate-limit', 'scenario=rate-limit&page=all', "document.querySelectorAll('.card').length > 3"],
  ['slow', 'scenario=slow&page=week', 'true'],
  [
    'download-blocked',
    'scenario=download-blocked&open=40',
    "document.querySelector('.viewer .state-card.is-error')",
  ],
  ['download-html', 'scenario=download-html&open=3', 'true'],
  ['folder-gone', 'scenario=folder-gone&page=mine', 'true'],
];

// בכל התרחישים בהיר; כהה ואנגלית רק למסכים המרכזיים.
const modes = [
  ['', () => true],
  [
    '&mode=dark',
    (name) =>
      [
        'week',
        'all',
        'series-page',
        'mine',
        'settings',
        'details',
        'viewer',
        'cycle',
        'cycle-topic',
      ].includes(name),
  ],
  [
    '&lang=en',
    (name) =>
      [
        'week',
        'all',
        'series',
        'settings',
        'details',
        'viewer',
        'mine',
        'cycle',
        'cycle-topic',
      ].includes(name),
  ],
];

let failures = 0;
const fail = (name, message) => {
  failures++;
  console.error('✖ ' + name + '\n  ' + message);
};

async function runScenario(browser, [name, query, check], suffix, base, width) {
  const page = await browser.newPage(width || 1000, 760);
  try {
    await page.goto(`${base || small}?${TODAY}&${query}${suffix}`);
    await page.waitFor("document.documentElement.dataset.previewReady === '1'", 20000);
    await page.sleep(250);
    let reached = true;
    if (check) {
      try {
        await page.waitFor(check, 6000);
      } catch (error) {
        reached = false;
        fail(name + suffix, 'expected state not reached: ' + check);
      }
    }
    for (const cls of await page.eval(
      "[...new Set([...document.querySelectorAll('[class]')].flatMap((n) => (typeof n.className === 'string' ? n.className.split(/\\s+/) : (n.className.baseVal || '').split(/\\s+/))))]",
    )) {
      if (cls) seenClasses.set(cls, name);
    }
    // נגישות: שמות נגישים, תוויות, ARIA וניגודיות AA.
    const a11y = await a11yReport(page);
    if (a11y.length) fail(name + suffix, 'נגישות: ' + a11y.join('; '));
    // "null"/"undefined" שדלפו כטקסט לממשק (למשל replaceChildren(null)).
    const leaked = await page.eval(
      "(document.body.innerText.match(/\\b(null|undefined|NaN)\\b|\\[object/g) || []).join(',')",
    );
    if (leaked) fail(name + suffix, 'טקסט דלף לממשק: ' + leaked);
    if (page.errors.length) fail(name + suffix, page.errors.join('\n  '));
    else if (reached) console.log('✔ ' + name + suffix + (width ? ' @' + width : ''));
    return page;
  } finally {
    await browser.closePage(page);
  }
}

/** מסך "השבוע": תאריכים, ניווט, ובחירת שבוע לפי רשימה ותאריך (היום בבדיקה: 15.10.2026). */
async function weekFlows(browser, open, check) {
  const page = await open('page=week');
  const text = (selector) =>
    page.eval(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent || ''`);
  const hero = async () => ({
    title: await text('.hero-title'),
    sub: await text('.hero-sub'),
    chips: await text('.hero-chips'),
  });
  const click = (selector) =>
    page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const jump = async (date) => {
    await page.eval(`document.querySelector('.week-row[data-date="${date}"]').click()`);
    await page.sleep(250);
  };
  const openPicker = async () => {
    await page.eval("document.querySelector('[data-key=jump]').click()");
    await page.sleep(300);
  };

  let h = await hero();
  check(
    'השבוע לפי היום: פרשת נח, תאריך עברי ולועזי',
    h.title === 'פרשת נח' && /^שבת, \S+ בחשוון תשפ״ז · 17 באוקטובר 2026$/.test(h.sub),
    JSON.stringify(h),
  );
  check(
    'השבוע הנוכחי מסומן, בלי הדגשת "שבוע אחר"',
    h.chips.includes('השבוע') && (await page.eval("!document.querySelector('.week-hero.is-away')")),
  );

  await page.eval("document.querySelector('.hero-nav:last-of-type').click()");
  await page.sleep(250);
  h = await hero();
  check(
    'חץ "הבא": שבוע אחר מסומן בבירור',
    h.title === 'פרשת לך לך' &&
      h.chips.includes('שבוע הבא') &&
      (await page.eval("Boolean(document.querySelector('.week-hero.is-away'))")),
    JSON.stringify(h),
  );
  await page.eval("document.querySelector('[data-key=current]').click()");
  await page.sleep(250);
  check('"חזרה להשבוע" מחזירה לשבת הקרובה', (await text('.hero-title')) === 'פרשת נח');

  await openPicker();
  const rows = await page.eval("document.querySelectorAll('.week-row').length");
  check(
    'מעבר לשבוע: רשימת השנה העברית נפתחת על השנה הנוכחית',
    rows > 40 && (await page.eval("document.querySelector('.picker-year').value === '5787'")),
    'rows ' + rows,
  );
  check(
    'מעבר לשבוע: השבוע המוצג מסומן',
    await page.eval(
      "document.querySelector('.week-row.is-selected').dataset.date === '2026-10-17'",
    ),
  );
  await page.eval("document.querySelector('[data-filter=holiday]').click()");
  await page.sleep(150);
  check(
    'מעבר לשבוע: מסנן חגים מציג רק חגים באמצע השבוע',
    await page.eval(
      "[...document.querySelectorAll('.week-row')].every((r) => r.classList.contains('is-holiday')) && document.querySelectorAll('.week-row').length >= 5",
    ),
  );
  // שנים ישנות: לוח הארכיון נטען בלחיצה, ומופיעות שנים ישנות בבורר
  const yearsBefore = await page.eval("document.querySelectorAll('.picker-year option').length");
  check(
    'שנים ישנות: כפתור טעינה מוצג',
    await page.eval(
      "Boolean(document.querySelector('[data-key=archive]')) && !document.querySelector('[data-key=archive]').hidden",
    ),
  );
  await click('[data-key=archive]');
  await page.sleep(1500);
  const yearsAfter = await page.eval("document.querySelectorAll('.picker-year option').length");
  check(
    'שנים ישנות: אחרי הטעינה יש יותר שנים והכפתור נעלם',
    yearsAfter > yearsBefore + 10 &&
      (await page.eval("document.querySelector('[data-key=archive]').hidden")),
    `${yearsBefore} -> ${yearsAfter}`,
  );
  await click('[data-filter=all]');
  await page.eval(
    "(() => { const s = document.querySelector('.picker-year'); s.value = '5760'; s.dispatchEvent(new Event('change', { bubbles: true })); })()",
  );
  await page.sleep(300);
  check(
    'שנה ישנה נבחרת ומציגה שבועות',
    (await page.eval("document.querySelectorAll('.week-row').length")) > 20,
  );
  await page.eval(
    "(() => { const s = document.querySelector('.picker-year'); s.value = '5787'; s.dispatchEvent(new Event('change', { bubbles: true })); })()",
  );
  await page.sleep(300);
  await jump('2027-03-23');
  h = await hero();
  check(
    'בחירת חג (פורים): כותרת ותאריך עם יום בשבוע',
    h.title === 'פורים' &&
      h.sub === 'יום שלישי, י״ד באדר ב׳ תשפ״ז · 23 במרץ 2027' &&
      h.chips.includes('חג באמצע השבוע'),
    JSON.stringify(h),
  );

  await page.eval("document.querySelector('[data-key=current]').click()");
  await page.sleep(200);
  await openPicker();
  await page.eval(
    "(() => { const i = document.querySelector('.picker-date'); i.value = '2027-03-21'; })()",
  );
  await page.eval("document.querySelector('[data-key=go-gregorian]').click()");
  await page.sleep(250);
  h = await hero();
  check(
    'תאריך לועזי (יום ראשון) עובר לשבת הבאה',
    h.title === 'פרשת צו' && h.chips.includes('שבת פרה'),
    JSON.stringify(h),
  );

  await page.eval("document.querySelector('[data-key=current]').click()");
  await page.sleep(200);
  await openPicker();
  // סדר הבחירות: שנה ← חודש ← יום (כל שינוי בונה מחדש את הבאים אחריו).
  await page.eval(`(() => {
    const pick = (index, value) => {
      const select = document.querySelectorAll('.picker-inline select')[index];
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    pick(2, '5787');
    pick(1, 'nisan');
    pick(0, '15');
  })()`);
  await page.eval("document.querySelector('[data-key=go-hebrew]').click()");
  await page.sleep(250);
  h = await hero();
  check(
    'תאריך עברי (ט״ו בניסן תשפ״ז) מוצא את פסח',
    h.title === 'פסח' && h.sub.includes('ט״ו בניסן תשפ״ז · 22 באפריל 2027'),
    JSON.stringify(h),
  );

  // ארץ ישראל מול חוץ לארץ: שבועות שחל בשבת (12.6.2027)
  await page.eval("document.querySelector('[data-key=current]').click()");
  await page.sleep(200);
  await openPicker();
  await jump('2027-06-12');
  check('ארץ ישראל: שבת פרשת נשא', (await text('.hero-title')) === 'פרשת נשא');
  await page.eval("window.__alonimApp.state.setPref('diaspora', true)");
  await page.sleep(400);
  check(
    'חוץ לארץ: אותה שבת היא שבועות',
    (await text('.hero-title')) === 'שבועות',
    await text('.hero-title'),
  );
  await page.eval("window.__alonimApp.state.setPref('diaspora', false)");

  // האלגוריתם החשבוני מול Intl של הדפדפן עצמו (WebView): כל יום, 1950-2100.
  const intl = await page.eval(`(() => {
    const H = window.Alonim.HebCal;
    const names = { Tishri: 'tishri', Heshvan: 'cheshvan', Cheshvan: 'cheshvan', Kislev: 'kislev', Tevet: 'tevet', Shevat: 'shevat', 'Adar I': 'adar1', Adar: 'adar', 'Adar II': 'adar2', Nisan: 'nisan', Iyar: 'iyar', Sivan: 'sivan', Tamuz: 'tamuz', Tammuz: 'tamuz', Av: 'av', Elul: 'elul' };
    let f;
    try { f = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); f.formatToParts(new Date(0)); } catch (e) { return 'no-intl'; }
    let bad = 0, n = 0;
    for (let day = H.dayNumber(new Date(1950, 0, 1, 12)); day <= H.dayNumber(new Date(2100, 11, 31, 12)); day++) {
      const parts = f.formatToParts(new Date(day * 86400000 + 43200000));
      const get = (t) => (parts.find((p) => p.type === t) || {}).value;
      const h = H.fromDate(H.dateOfDayNumber(day));
      n++;
      if (h.year !== Number(get('relatedYear') || get('year')) || h.month !== names[get('month')] || h.day !== Number(get('day'))) bad++;
    }
    return bad + '/' + n;
  })()`);
  check(
    'חישוב הלוח העברי זהה ל-Intl של הדפדפן (150 שנה)',
    /^0\/\d+$/.test(intl) || intl === 'no-intl',
    String(intl),
  );

  check('"השבוע" בלי שגיאות קונסול', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);
}

/**
 * "מעגל השנה": הגלגל (סדר, ספירות מול ספירה נאיבית, שנה מעוברת, מקלדת), דף הנושא (קבוצות סדרות
 * מול ספירה נאיבית, שבת משולבת בשני הדפים, מסננים, בחירה, חזרה), הקישור מכותרת השבוע, וצר.
 */
async function cycleFlows(browser, open, check) {
  // ספירה נאיבית של הגיליונות הגלויים בעמודות האינדקס (בלי `topicCounts`): kind 'p' פרשה, 'e' מועד
  const BRUTE = `const brute = (kind, slug) => { const a = window.__alonimApp.index; const id = (kind === 'p' ? a.parashot : a.events).map.get(slug); let n = 0; for (let i = 0; i < a.n; i++) { if (a.vis[i] !== 1) continue; if (kind === 'p' ? a.p1[i] === id || a.p2[i] === id : a.evc[i] === id) n++; } return n; };`;
  const enter = (page) => page.key('Enter', 0, 'Enter', String.fromCharCode(13));
  const key = (page) => page.eval('document.activeElement.dataset.key || ""');
  const text = (page, selector) =>
    page.eval(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent || ''`);

  let page = await open('page=cycle');
  const tabs = await page.eval(
    "[...document.querySelectorAll('.main-tab')].map((t) => t.dataset.tab).join()",
  );
  check(
    'מעגל השנה: לשונית בין "השבוע" ל"כל העלונים"',
    tabs === 'week,cycle,all,series,mine,settings',
    tabs,
  );
  const wheel = await page.eval(`(() => {
    const tiles = [...document.querySelectorAll('.cycle-tile')];
    const keys = tiles.map((t) => t.dataset.key);
    return {
      n: tiles.length,
      parasha: keys.filter((k) => k[0] === 'p').length,
      dup: keys.length - new Set(keys).size,
      ring: document.querySelectorAll('.ring-seg').length,
      first: keys[0],
      last: keys[keys.length - 1],
      tabbable: tiles.filter((t) => t.tabIndex === 0).length,
      now: [...document.querySelectorAll('.cycle-tile.is-current')].map((t) => t.dataset.key).join(),
      purim: keys.indexOf('e:purim') > keys.indexOf('p:vayikra') && keys.indexOf('e:purim') < keys.indexOf('p:tzav'),
      aliasTiles: keys.filter((k) => /shirah|chazon|nachamu/.test(k)).length,
    };
  })()`);
  check(
    'הגלגל: 54 פרשות, בלי כפילויות, הטבעת תואמת את האריחים, אריח אחד ב-Tab',
    wheel.parasha === 54 && wheel.dup === 0 && wheel.ring === wheel.n && wheel.tabbable === 1,
    JSON.stringify(wheel),
  );
  check(
    'הגלגל נפתח בראש השנה ומסתיים בוזאת הברכה; השבוע (נח) מסומן; בלי אריחי כינוי',
    wheel.first === 'e:rosh-hashana' &&
      wheel.last === 'p:vezot-haberakhah' &&
      wheel.now === 'p:noach' &&
      wheel.aliasTiles === 0,
    JSON.stringify(wheel),
  );
  check(
    'שנה מעוברת (תשפ״ז): פורים אחרי ויקרא ולפני צו; תאריכו באדר ב׳',
    wheel.purim &&
      (await page.eval(
        "document.querySelector('.cycle-tile[data-key=\"e:purim\"] .tile-date').textContent.includes('אדר ב׳')",
      )),
  );
  const mismatch = await page.eval(`(() => {
    ${BRUTE}
    return [...document.querySelectorAll('.cycle-tile')].filter((t) => {
      const [kind, slug] = t.dataset.key.split(':');
      const shown = Number(t.querySelector('.tile-count').textContent.replace(/\\D/g, ''));
      return shown !== brute(kind, slug);
    }).map((t) => t.dataset.key);
  })()`);
  check('ספירת כל אריח שווה לספירה נאיבית על האינדקס', mismatch.length === 0, mismatch.join());
  check(
    'הטבעת: כל קטע הוא כפתור עם שם נגיש וספירה; קטע אחד ב-Tab',
    await page.eval(
      "(() => { const segs = [...document.querySelectorAll('.ring-seg')]; return segs.every((s) => s.getAttribute('role') === 'button' && /\\d/.test(s.getAttribute('aria-label'))) && segs.filter((s) => s.getAttribute('tabindex') === '0').length === 1; })()",
    ),
  );

  // מקלדת באריחים (RTL: שמאלה = הבא)
  await page.eval('document.querySelector(\'.cycle-tile[data-key="p:noach"]\').focus()');
  await page.key('ArrowLeft');
  check('חץ שמאלה: התחנה הבאה (לך לך)', (await key(page)) === 'p:lech-lecha', await key(page));
  await page.key('ArrowRight');
  check('חץ ימינה: חוזר לנח', (await key(page)) === 'p:noach', await key(page));
  await page.key('ArrowDown');
  const down = await key(page);
  check('חץ מטה: אריח בשורה הבאה', down !== 'p:noach' && down !== '', down);
  await page.key('Home');
  check('Home: ראש השנה', (await key(page)) === 'e:rosh-hashana', await key(page));
  await page.key('End');
  check('End: וזאת הברכה', (await key(page)) === 'p:vezot-haberakhah', await key(page));
  check(
    'אריח אחד בלבד ב-Tab אחרי תנועה (מיקוד נודד)',
    (await page.eval('document.querySelectorAll(\'.cycle-tile[tabindex="0"]\').length')) === 1,
  );

  // מקלדת בטבעת
  await page.eval('document.querySelector(\'.ring-seg[data-key="p:noach"]\').focus()');
  check(
    'מיקוד בטבעת מציג את התחנה במרכז',
    await page.eval("document.querySelector('.ring-name').textContent === 'נח'"),
  );
  await page.key('ArrowLeft');
  check(
    'טבעת: חץ שמאלה = התחנה הבאה, והמרכז מתעדכן',
    (await key(page)) === 'p:lech-lecha' &&
      (await page.eval("document.querySelector('.ring-name').textContent === 'לך לך'")),
    await key(page),
  );
  await enter(page);
  await page.sleep(400);
  check(
    'Enter על קטע בטבעת פותח את הנושא',
    (await text(page, '.topic-title')) === 'לך לך בכל השנים',
    await text(page, '.topic-title'),
  );
  await browser.closePage(page);

  // דף הנושא: קבוצות לפי סדרה מול ספירה נאיבית
  page = await open('page=cycle');
  await page.eval('document.querySelector(\'.cycle-tile[data-key="p:noach"]\').focus()');
  await enter(page);
  await page.sleep(500);
  const topic = await page.eval(`(() => {
    ${BRUTE}
    const a = window.__alonimApp;
    const s = a.screen;
    const id = a.index.parashot.map.get('noach');
    const series = new Set();
    for (let i = 0; i < a.index.n; i++) if (a.index.vis[i] === 1 && (a.index.p1[i] === id || a.index.p2[i] === id)) series.add(a.index.sidx[i]);
    const groups = s.groups();
    const heads = [...document.querySelectorAll('.topic-group')];
    return {
      title: document.querySelector('.topic-title').textContent,
      route: a.route.tab + '/' + a.route.topic,
      shown: s.shown.length,
      brute: brute('p', 'noach'),
      groups: groups.length,
      series: series.size,
      sum: groups.reduce((n, g) => n + g.idx.length, 0),
      sorted: groups.every((g, k) => k === 0 || groups[k - 1].idx.length >= g.idx.length || a.state.isFollowed(groups[k - 1].id)),
      firstCount: heads[0] ? heads[0].querySelector('.section-count').textContent : '',
      firstSize: groups[0].idx.length,
      credit: Boolean(document.querySelector('.group-credit')),
      cards: document.querySelectorAll('.topic-list .card').length,
      label: (document.querySelector('.topic-list .card') || {}).ariaLabel || '',
      facts: document.querySelector('.topic-facts').textContent,
      when: (document.querySelector('.topic-when') || {}).textContent || '',
      dom: document.querySelectorAll('.topic-list [data-item]').length,
    };
  })()`);
  check(
    'דף נושא (נח): כותרת, ונתיב הלשונית',
    topic.title === 'נח בכל השנים' && topic.route === 'cycle/p:noach',
    JSON.stringify(topic),
  );
  check(
    'דף נושא: מספר הגיליונות והסדרות שווה לספירה נאיבית, והקבוצות מסתכמות לדף',
    topic.shown === topic.brute &&
      topic.groups === topic.series &&
      topic.sum === topic.shown &&
      topic.facts.includes(String(topic.brute)),
    JSON.stringify(topic),
  );
  check(
    'דף נושא: סדר הקבוצות (הרבה לפני מעט), קרדיט וספירה בכותרת, ושם הסדרה בשם הכרטיס לקורא מסך',
    topic.sorted &&
      topic.credit &&
      topic.firstCount === String(topic.firstSize) &&
      topic.cards > 0 &&
      topic.label.length > 10,
    JSON.stringify(topic),
  );
  check('דף נושא: מתי נקרא השנה (השבת הקרובה)', /הקרוב/.test(topic.when), topic.when);
  check('דף נושא: לא יותר מ-60 פריטים ב-DOM', topic.dom <= 60 && topic.dom > 0, String(topic.dom));
  // קישור לדף הסדרה מכותרת הקבוצה
  await page.eval("document.querySelector('.group-link').click()");
  await page.sleep(400);
  check(
    'כותרת קבוצה: קישור לדף הסדרה המלא',
    await page.eval(
      "window.__alonimApp.route.tab === 'series' && Boolean(window.__alonimApp.route.series) && Boolean(document.querySelector('.series-title'))",
    ),
  );
  await browser.closePage(page);

  // חזרה: כפתור, Esc, ומיקוד באריח שממנו יצאנו (אחרי גלילה: אריח שנראה בחלון)
  page = await open('page=cycle');
  await page.eval("document.querySelector('.app-content').scrollTop = 700");
  await page.sleep(200);
  const picked = await page.eval(`(() => {
    const box = document.querySelector('.app-content').getBoundingClientRect();
    const tile = [...document.querySelectorAll('.cycle-tile')].find((t) => {
      const r = t.getBoundingClientRect();
      return r.top > box.top + 40 && r.bottom < box.bottom - 40;
    });
    tile.focus();
    return tile.dataset.key;
  })()`);
  const scrolled = await page.eval("document.querySelector('.app-content').scrollTop");
  await enter(page);
  await page.sleep(400);
  await page.eval("document.querySelector('[data-key=back]').click()");
  await page.sleep(500);
  check(
    'חזרה מדף נושא: הגלגל, המיקוד באריח שנבחר והגלילה נשמרה',
    (await key(page)) === picked &&
      (await page.eval('window.__alonimApp.route.topic === null')) &&
      Math.abs((await page.eval("document.querySelector('.app-content').scrollTop")) - scrolled) <
        80,
    picked + ' ' + (await key(page)) + ' ' + scrolled,
  );
  await enter(page);
  await page.sleep(400);
  await page.eval('document.activeElement.blur()');
  await page.key('Escape');
  await page.sleep(400);
  check(
    'Esc בדף נושא חוזר לגלגל',
    await page.eval(
      "window.__alonimApp.route.tab === 'cycle' && window.__alonimApp.route.topic === null && Boolean(document.querySelector('.cycle-tile'))",
    ),
  );
  await browser.closePage(page);

  // מועד: פורים (שנה מעוברת: י״ד באדר ב׳)
  page = await open('page=cycle');
  await page.eval('document.querySelector(\'.cycle-tile[data-key="e:purim"]\').click()');
  await page.sleep(500);
  const purim = await page.eval(`(() => {
    ${BRUTE}
    const s = window.__alonimApp.screen;
    return {
      title: document.querySelector('.topic-title').textContent,
      sub: document.querySelector('.topic-title').nextElementSibling.textContent,
      shown: s.shown.length,
      brute: brute('e', 'purim'),
      when: document.querySelector('.topic-when').textContent,
      modes: Boolean(document.querySelector('.topic-modes')),
    };
  })()`);
  check(
    'דף מועד (פורים): כותרת, סוג, ספירה נאיבית, תאריך באדר ב׳, בלי בורר שבת משולבת',
    purim.title === 'פורים בכל השנים' &&
      purim.sub === 'חג' &&
      purim.shown === purim.brute &&
      /אדר ב׳/.test(purim.when) &&
      !purim.modes,
    JSON.stringify(purim),
  );
  await browser.closePage(page);

  // שבת משולבת: נצבים־וילך; כל גיליון משולב בשני הדפים, פעם אחת בכל דף
  page = await open('topic=p:nitzavim');
  const combo = await page.eval(`(() => {
    const a = window.__alonimApp;
    const C = window.Alonim.Cycle;
    const s = a.screen;
    const all = s.shown.length;
    const modes = [...document.querySelectorAll('.topic-modes button')].map((b) => b.dataset.mode);
    const other = new Set(C.issuesOf(a.index, C.topic('p:vayeilech'), {}));
    const both = C.issuesOf(a.index, C.topic('p:nitzavim'), {}).filter((i) => other.has(i));
    const naive = [];
    for (let i = 0; i < a.index.n; i++) if (a.index.p2[i] && a.index.vis[i] === 1 && (a.index.parashot.get(a.index.p1[i]) === 'nitzavim' || a.index.parashot.get(a.index.p2[i]) === 'nitzavim')) naive.push(i);
    return { all, modes, both: both.length, naive: naive.length, note: Boolean(document.querySelector('.topic-note')), unique: new Set(s.flat).size === s.flat.length };
  })()`);
  check(
    'שבת משולבת: בורר סוג השבת, גיליון משולב פעם אחת בדף ובשני הדפים, והסבר',
    combo.modes.join() === 'all,combined,alone' &&
      combo.both === combo.naive &&
      combo.naive > 0 &&
      combo.note &&
      combo.unique,
    JSON.stringify(combo),
  );
  await page.eval("document.querySelector('[data-mode=combined]').click()");
  await page.sleep(300);
  const onlyCombined = await page.eval(
    "(() => { const s = window.__alonimApp.screen; const a = window.__alonimApp.index; return { n: s.shown.length, ok: s.shown.every((i) => a.p2[i] !== 0), pressed: document.querySelector('[data-mode=combined]').getAttribute('aria-pressed') }; })()",
  );
  await page.eval("document.querySelector('[data-mode=alone]').click()");
  await page.sleep(300);
  const onlyAlone = await page.eval(
    '(() => { const s = window.__alonimApp.screen; const a = window.__alonimApp.index; return { n: s.shown.length, ok: s.shown.every((i) => a.p2[i] === 0) }; })()',
  );
  check(
    'שבת משולבת: "רק משולבת" ו"הפרשה לבדה" מתחלקים לכל הגיליונות, בלי חפיפה',
    onlyCombined.ok &&
      onlyAlone.ok &&
      onlyCombined.n === combo.naive &&
      onlyCombined.n + onlyAlone.n === combo.all &&
      onlyCombined.pressed === 'true',
    JSON.stringify({ combo, onlyCombined, onlyAlone }),
  );
  await browser.closePage(page);

  // מסננים וחיפוש בתוך הנושא, מול ספירה נאיבית
  page = await open('topic=p:noach');
  const naiveCount = (cond) =>
    `(() => { const a = window.__alonimApp.index; const id = a.parashot.map.get('noach'); let n = 0; for (let i = 0; i < a.n; i++) { if (a.vis[i] !== 1 || !(a.p1[i] === id || a.p2[i] === id)) continue; const it = a.item(i); if (${cond}) n++; } return n; })()`;
  await page.eval(
    "(() => { const s = document.querySelector('select[aria-label=\"שפה\"]'); s.value = 'yi'; s.dispatchEvent(new Event('change', { bubbles: true })); })()",
  );
  await page.sleep(300);
  check(
    'מסנן שפה בדף הנושא = ספירה נאיבית',
    (await page.eval('window.__alonimApp.screen.shown.length')) ===
      (await page.eval(naiveCount("it.lang === 'yi'"))),
  );
  await page.eval(
    "(() => { const s = document.querySelector('select[aria-label=\"שפה\"]'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); const i = document.querySelector('.topic-page .search-input'); i.value = 'אסיפת'; i.dispatchEvent(new Event('input', { bubbles: true })); })()",
  );
  await page.sleep(300);
  check(
    'חיפוש בתוך הנושא = ספירה נאיבית',
    (await page.eval('window.__alonimApp.screen.shown.length')) ===
      (await page.eval(naiveCount("it.seriesTitle.includes('אסיפת')"))),
  );
  await page.eval("document.querySelector('.topic-page .search-input').focus()");
  await page.key('Escape');
  await page.sleep(200);
  check(
    'Esc בשדה החיפוש מנקה ואינו יוצא מהדף',
    (await page.eval("document.querySelector('.topic-page .search-input').value")) === '' &&
      (await page.eval('Boolean(window.__alonimApp.route.topic)')),
  );
  // קיבוץ לפי שנה נשמר
  await page.eval(
    "(() => { const s = document.querySelector('select[aria-label=\"קיבוץ\"]'); s.value = 'year'; s.dispatchEvent(new Event('change', { bubbles: true })); })()",
  );
  await page.sleep(300);
  check(
    'קיבוץ לפי שנה: כותרות שנה, והבחירה נשמרת במצב המסכים',
    (await page.eval("document.querySelectorAll('.topic-list .year-header').length > 0")) &&
      (await page.eval("window.__alonimApp.state.viewState('cycle').group === 'year'")),
  );
  // בחירה מרובה: בחירת כל התוצאות היא כל מה שבדף
  await page.eval("document.querySelector('[data-key=select-mode]').click()");
  await page.sleep(300);
  await page.eval(
    "[...document.querySelectorAll('.select-check')].slice(0, 2).forEach((b) => b.click())",
  );
  await page.sleep(300);
  const sel = await page.eval(
    "(() => { const bar = document.querySelector('.selection-bar'); const all = [...bar.querySelectorAll('button')].find((b) => /בחירת כל התוצאות/.test(b.textContent)); return { shown: window.__alonimApp.screen.shown.length, all: all ? Number(all.textContent.replace(/\\D/g, '')) : -1, hidden: bar.hidden }; })()",
  );
  check(
    'בחירה בדף נושא: "בחירת כל התוצאות (N)" = כל גיליוני הדף',
    !sel.hidden && sel.all === sel.shown,
    JSON.stringify(sel),
  );
  await page.eval('document.activeElement.blur()');
  await page.key('Escape');
  await page.sleep(300);
  check(
    'Esc ראשון יוצא ממצב בחירה, ונשארים בדף',
    (await page.eval('!window.__alonimApp.selection.on')) &&
      (await page.eval('Boolean(window.__alonimApp.route.topic)')),
  );
  await page.key('Escape');
  await page.sleep(300);
  check('Esc שני חוזר לגלגל', await page.eval('window.__alonimApp.route.topic === null'));
  await browser.closePage(page);

  // מכותרת השבוע: קישור בשם הפרשה, וחזרה לשבוע
  page = await open('page=week');
  const heroLinks = await page.eval(
    "[...document.querySelectorAll('.hero-title .hero-title-link')].map((b) => b.textContent).join()",
  );
  check('כותרת השבוע: שם הפרשה הוא קישור', heroLinks === 'נח', heroLinks);
  await page.eval("document.querySelector('.hero-title-link').click()");
  await page.sleep(500);
  check(
    'לחיצה על שם הפרשה בכותרת פותחת את "נח בכל השנים", עם חזרה לשבוע',
    (await text(page, '.topic-title')) === 'נח בכל השנים' &&
      (await page.eval("document.querySelector('[data-key=back]').getAttribute('aria-label')")) ===
        'חזרה לשבוע',
  );
  await page.eval("document.querySelector('[data-key=back]').click()");
  await page.sleep(400);
  check(
    'חזרה מדף נושא שנפתח מהשבוע: מסך השבוע',
    await page.eval(
      "window.__alonimApp.route.tab === 'week' && document.querySelector('.hero-title').textContent.includes('נח')",
    ),
  );
  // שבת משולבת בכותרת, ושבת מיוחדת
  await page.eval("window.__alonimApp.view.weekDate = '2026-09-05'; window.__alonimApp.go('week')");
  await page.sleep(400);
  const pair = await page.eval(
    "[...document.querySelectorAll('.hero-title .hero-title-link')].map((b) => b.textContent).join()",
  );
  check('שבת משולבת בכותרת: כל פרשה קישור', pair === 'נצבים,וילך', pair);
  await page.eval("document.querySelector('[data-key=topic]').click()");
  await page.sleep(500);
  check(
    'כפתור "בכל השנים" בשבת משולבת פותח את הפרשה על "שבת משולבת"',
    (await text(page, '.topic-title')) === 'נצבים בכל השנים' &&
      (await page.eval(
        "document.querySelector('[data-mode=combined]').getAttribute('aria-pressed')",
      )) === 'true',
  );
  await page.eval("window.__alonimApp.view.weekDate = '2027-03-06'; window.__alonimApp.go('week')");
  await page.sleep(400);
  check(
    'שבת שקלים: תגית האירוע היא קישור לדף המועד',
    await page.eval(
      "(() => { const chip = document.querySelector('.hero-chips .chip-link'); if (!chip) return false; chip.click(); return true; })()",
    ),
  );
  await page.sleep(500);
  check(
    'תגית שבת שקלים פותחת "שבת שקלים בכל השנים"',
    (await text(page, '.topic-title')) === 'שבת שקלים בכל השנים',
    await text(page, '.topic-title'),
  );
  await browser.closePage(page);

  // צר: הגלגל מוסתר, האריחים בשני טורים, ושש לשוניות בסרגל התחתון
  page = await open('page=cycle', small, 480);
  const narrow = await page.eval(`(() => {
    const ring = document.querySelector('.cycle-ring');
    const tabs = [...document.querySelectorAll('.main-tab')];
    const tiles = [...document.querySelectorAll('.cycle-tile')].slice(0, 4).map((t) => Math.round(t.getBoundingClientRect().left));
    return { ring: getComputedStyle(ring).display, tabs: tabs.length, minTab: Math.round(Math.min(...tabs.map((t) => t.getBoundingClientRect().width))), columns: new Set(tiles).size, overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
  check(
    'צר (480px): בלי טבעת, שני טורים, שש לשוניות ברוחב סביר',
    narrow.ring === 'none' &&
      narrow.tabs === 6 &&
      narrow.minTab >= 55 &&
      narrow.columns === 2 &&
      !narrow.overflow,
    JSON.stringify(narrow),
  );
  await browser.closePage(page);

  // 30K+: הרשימה הוירטואלית של דף הנושא מוגבלת ב-DOM
  page = await open('topic=p:bereshit', large);
  await page.waitFor(
    "window.__alonimApp.catalog.status.shardsLoaded >= window.__alonimApp.catalog.status.shardsTotal && window.__alonimApp.catalog.status.phase === 'idle'",
    60000,
  );
  await page.sleep(800);
  let maxDom = 0;
  for (const top of [0, 3000, 40000, 300000, 900000, 0]) {
    await page.eval(`document.querySelector('.topic-list').scrollTop = ${top}`);
    await page.sleep(120);
    maxDom = Math.max(
      maxDom,
      await page.eval("document.querySelectorAll('.topic-list [data-item]').length"),
    );
  }
  // כותרת קבוצה צמודה: בראש הרשימה אין (הכותרת האמיתית נראית), ובגלילה בתוך קבוצה היא מציגה את שמה וספירתה
  await page.eval("document.querySelector('.topic-list').scrollTop = 0");
  await page.sleep(150);
  const stickyTop = await page.eval("document.querySelector('.topic-sticky').hidden");
  await page.eval(
    '(() => { const s = window.__alonimApp.screen; const l = s.list; let r = s.rowGroup.findIndex((g, k) => !s.rowIsHeader[k] && g.idx.length > 3); l.root.scrollTop = l._top(r) + 4; })()',
  );
  await page.sleep(200);
  const sticky = await page.eval(
    "(() => { const s = window.__alonimApp.screen; const el = document.querySelector('.topic-sticky'); const row = s.list._rowAt(s.list.root.scrollTop); return { hidden: el.hidden, text: el.textContent, count: s.rowGroup[row].idx.length, aria: el.getAttribute('aria-hidden') }; })()",
  );
  check(
    'כותרת קבוצה צמודה: מוסתרת בראש הרשימה, ובתוך קבוצה מציגה את שמה וספירתה (מוסתרת מקורא מסך)',
    stickyTop &&
      !sticky.hidden &&
      sticky.text.includes(String(sticky.count)) &&
      sticky.aria === 'true',
    JSON.stringify({ stickyTop, sticky }),
  );
  const rows = await page.eval('window.__alonimApp.screen.shown.length');
  check(
    'דף נושא עם אלפי גיליונות: DOM ≤ 60 בגלילה (' + rows + ' גיליונות, נמדד ' + maxDom + ')',
    rows > 1000 && maxDom > 0 && maxDom <= 60,
  );
  check('דף נושא על 30K+ בלי שגיאות קונסול', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);
}

/**
 * חלון המסננים ב"כל העלונים": בחירה מרובה, תגיות, איפוס, טווחים והגדרות שמורות.
 * התוצאה מושווית לספירה נאיבית על הגיליונות שבאינדקס (לא על `search`).
 */
async function filterFlows(browser, open, check) {
  const page = await open('page=all');
  const brute = (predicate) =>
    page.eval(`(() => {
    const idx = window.__alonimApp.index;
    let n = 0;
    for (let i = 0; i < idx.size; i++) { const it = idx.item(i); if (idx.vis[i] === 1 && (${predicate})(it)) n++; }
    return n;
  })()`);
  const shown = async () =>
    Number(
      (await page.eval("document.querySelector('.results-count').textContent")).replace(
        /[^\d]/g,
        '',
      ),
    );
  const click = (selector) =>
    page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const tick = async (group, value) => {
    await page.eval(
      `document.querySelector('[data-group="${group}"] input[value="${value}"]').click()`,
    );
    await page.sleep(220);
  };

  await click('[data-key=filters]');
  await page.sleep(300);
  check(
    'חלון מסננים נפתח עם קבוצות',
    await page.eval("document.querySelectorAll('.filter-group').length >= 10"),
  );
  const total = await shown();

  // "או" בתוך מסנן, "וגם" בין מסננים
  const noach = 'noach';
  await tick('parasha', noach);
  await tick('parasha', 'bereshit');
  let expected = await brute(
    `(it) => it.parasha.includes('noach') || it.parasha.includes('bereshit')`,
  );
  check(
    'פרשה מרובה (או): הספירה בכותרת שווה לספירה נאיבית',
    (await shown()) === expected && expected > 0,
    `shown ${await shown()} expected ${expected}`,
  );
  check(
    'הכפתור בחלון מראה את אותו מספר',
    await page.eval(
      `document.querySelector('[data-key=done]').textContent.includes('${expected}')`,
    ),
  );
  await tick('source', 'ladaat');
  await tick('source', 'tashma');
  expected = await brute(
    `(it) => (it.parasha.includes('noach') || it.parasha.includes('bereshit')) && it.assets.some((a) => a.src === 'ladaat' || a.src === 'tashma')`,
  );
  check(
    'פרשה (או) וגם מקור (או)',
    (await shown()) === expected,
    `shown ${await shown()} expected ${expected}`,
  );
  await tick('lang', 'he');
  expected = await brute(
    `(it) => (it.parasha.includes('noach') || it.parasha.includes('bereshit')) && it.assets.some((a) => a.src === 'ladaat' || a.src === 'tashma') && it.lang === 'he'`,
  );
  check(
    'שלושה מסננים יחד',
    (await shown()) === expected,
    `shown ${await shown()} expected ${expected}`,
  );

  // הספירה ליד ערך = מה שיתקבל אם בוחרים רק בו (בנוסף לשאר המסננים)
  const optCount = Number(
    (
      await page.eval(
        `document.querySelector('[data-group="lang"] input[value="yi"]').closest('label').querySelector('.opt-count').textContent`,
      )
    ).replace(/[^\d]/g, ''),
  );
  const yiExpected = await brute(
    `(it) => (it.parasha.includes('noach') || it.parasha.includes('bereshit')) && it.assets.some((a) => a.src === 'ladaat' || a.src === 'tashma') && it.lang === 'yi'`,
  );
  check(
    'הספירה ליד ערך שלא נבחר מדויקת',
    optCount === yiExpected,
    `shown ${optCount} expected ${yiExpected}`,
  );

  // סגירה: תגיות פעילות
  await click('[data-key=done]');
  await page.sleep(300);
  check(
    'תגית לכל ערך שנבחר',
    (await page.eval("document.querySelectorAll('.filter-tag').length")) === 5,
    String(await page.eval("document.querySelectorAll('.filter-tag').length")),
  );
  await click('.filter-tag');
  await page.sleep(300);
  check(
    'הסרת תגית מעדכנת את הרשימה',
    (await page.eval("document.querySelectorAll('.filter-tag').length")) === 4,
  );

  // טווח תאריכים (לועזי)
  await click('[data-key=filters]');
  await page.sleep(300);
  await click('[data-key=reset]');
  await page.sleep(300);
  check(
    'איפוס המסננים מחזיר לסך הכל',
    (await shown()) === total &&
      (await page.eval("document.querySelectorAll('.filter-tag').length")) === 0,
    `shown ${await shown()} total ${total}`,
  );
  await page.eval(`(() => {
    const group = document.querySelector('[data-group="date"]');
    group.open = true;
    const [from, to] = group.querySelectorAll('input[type=date]');
    from.value = '2026-03-01';
    from.dispatchEvent(new Event('change', { bubbles: true }));
    to.value = '2026-06-30';
    to.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.sleep(300);
  expected = await brute(
    "(it) => Boolean(it.date) && it.date >= '2026-03-01' && it.date <= '2026-06-30'",
  );
  check(
    'טווח תאריכים לועזי',
    (await shown()) === expected && expected > 0,
    `shown ${await shown()} expected ${expected}`,
  );
  const caption = await page.eval(
    "document.querySelector('[data-group=date] .range-caption').textContent",
  );
  check('מתחת לתאריך מופיע התאריך העברי', /בניסן|באדר|בשבט|באייר|בסיוון/.test(caption), caption);
  // טווח עמודים
  await page.eval(`(() => {
    const group = document.querySelector('[data-group="pages"]');
    const [min] = group.querySelectorAll('input[type=number]');
    min.value = '20';
    min.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.sleep(300);
  expected = await brute(
    "(it) => Boolean(it.date) && it.date >= '2026-03-01' && it.date <= '2026-06-30' && Math.max(0, ...it.assets.map((a) => a.pages || 0)) >= 20",
  );
  check(
    'תאריך וגם עמודים',
    (await shown()) === expected,
    `shown ${await shown()} expected ${expected}`,
  );

  // הגדרה שמורה
  await page.eval(`(() => {
    const form = document.querySelector('.preset-form');
    form.hidden = false;
    form.querySelector('input').value = 'ניסיון';
    form.requestSubmit();
  })()`);
  await page.sleep(300);
  check(
    'הגדרה נשמרה ומופיעה ברשימה',
    await page.eval(
      "[...document.querySelectorAll('.preset-select option')].some((o) => o.textContent === 'ניסיון')",
    ),
  );
  await click('[data-key=reset]');
  await page.sleep(250);
  await page.eval(`(() => {
    const select = document.querySelector('.preset-select');
    select.value = [...select.options].find((o) => o.textContent === 'ניסיון').value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.sleep(350);
  check(
    'החלת הגדרה שמורה משחזרת את המסננים',
    (await shown()) === expected,
    `shown ${await shown()} expected ${expected}`,
  );
  await page.key('Escape');
  await page.sleep(250);

  // מצב הלשונית נשמר במעבר בין לשוניות
  await page.eval("window.__alonimApp.go('series')");
  await page.sleep(300);
  await page.eval("window.__alonimApp.go('all')");
  await page.sleep(400);
  check(
    'המסננים נשמרים בחזרה ללשונית',
    (await page.eval("document.querySelectorAll('.filter-tag').length")) === 2 &&
      (await shown()) === expected,
    `tags ${await page.eval("document.querySelectorAll('.filter-tag').length")}`,
  );
  check(
    'המסננים נשמרו גם באחסון',
    await page.eval(
      "Boolean(window.__alonimApp.state.viewState('all') && window.__alonimApp.state.viewState('all').filters.pagesMin === 20)",
    ),
  );
  check('מסננים: בלי שגיאות קונסול', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);

  // 400px: החלון לא גולש
  const narrow = await open('page=all', undefined, 400);
  await narrow.eval("document.querySelector('[data-key=filters]').click()");
  await narrow.sleep(350);
  await narrow.eval("document.querySelectorAll('.filter-group').forEach((g) => (g.open = true))");
  await narrow.sleep(200);
  check(
    'חלון מסננים ב-400px בלי גלישה אופקית',
    await narrow.eval(
      "document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.dialog, .dialog-body')].every((n) => n.scrollWidth <= n.clientWidth + 1)",
    ),
    await narrow.eval("document.documentElement.scrollWidth + ' > ' + window.innerWidth"),
  );
  await browser.closePage(narrow);
}

/** מצב בחירה מרובה והיסטוריה. */
async function selectionFlows(browser, open, check) {
  const page = await open('page=all');
  const num = (expr) => page.eval(`Number(${expr})`);
  // קיבוץ: כותרת לכל קבוצה, וסכום הספירות שבכותרות שווה לסך התוצאות
  const groupTotal = await num(
    "document.querySelector('.results-count').textContent.replace(/[^0-9]/g, '')",
  );
  for (const kind of ['series', 'year', 'week', 'circle', 'lang']) {
    await page.eval(
      `(() => { const s = document.querySelector('.select-group'); s.value = '${kind}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
    await page.sleep(350);
    const sum = await num(
      "[...document.querySelectorAll('.year-header .section-count')].reduce((n, c) => n + Number(c.textContent.replace(/[^0-9]/g, '')), 0)",
    );
    const headers = await num("document.querySelectorAll('.year-header').length");
    check(`קיבוץ לפי ${kind}: כותרות לכל קבוצה`, headers >= 1, String(headers));
    if (kind === 'series') {
      // כל הקבוצות בגלילה: בודקים דרך האינדקס, כי רק חלק מהכותרות ב-DOM
      const inIndex = await num(
        "window.__alonimApp.index.groupResults(window.__alonimApp.index.search('', {}, {}, {}).idx, 'series').reduce((n, g) => n + g.idx.length, 0)",
      );
      check('קיבוץ: כל התוצאות בקבוצות', inIndex === groupTotal, `${inIndex}/${groupTotal}`);
    }
    check(
      `קיבוץ לפי ${kind}: DOM מוגבל`,
      (await num("document.querySelectorAll('.card').length")) <= 60 && sum <= groupTotal,
    );
  }
  await page.eval(
    "(() => { const s = document.querySelector('.select-group'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()",
  );
  await page.sleep(300);
  check(
    'ללא קיבוץ: אין כותרות',
    (await num("document.querySelectorAll('.year-header').length")) === 0,
  );

  await page.eval("document.querySelector('[data-key=select-mode]').click()");
  await page.sleep(300);
  check(
    'מצב בחירה: תיבות סימון בכרטיסים ושורת פעולות',
    (await num("document.querySelectorAll('.select-check').length")) > 3 &&
      (await page.eval("!document.querySelector('.selection-bar').hidden")),
  );
  const before = await num('window.__alonimApp.state.favoriteSnaps().length');
  await page.eval(
    "[...document.querySelectorAll('.select-check')].slice(0, 3).forEach((b) => b.click())",
  );
  await page.sleep(300);
  check(
    'נבחרו שלושה',
    (await num('window.__alonimApp.selection.ids.size')) === 3 &&
      (await page.eval("document.querySelector('.selection-count').textContent.includes('3')")),
  );
  check(
    'לחיצה על כרטיס במצב בחירה אינה פותחת צפיין',
    await page.eval(
      "(document.querySelector('.card:not(.is-selected)').click(), document.querySelector('.viewer').hidden)",
    ),
  );
  await page.sleep(200);
  await page.eval(
    "[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.includes('למועדפים')).click()",
  );
  await page.sleep(300);
  check(
    '"למועדפים" מוסיף את כל הנבחרים',
    (await page.eval(
      'window.__alonimApp.selectedItems().every((it) => window.__alonimApp.state.isFavorite(it.id))',
    )) && (await num('window.__alonimApp.state.favoriteSnaps().length')) >= before,
  );
  await page.eval(
    "[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.includes('בחירת כל התוצאות')).click()",
  );
  await page.sleep(300);
  const total = await num(
    "document.querySelector('.results-count').textContent.replace(/[^0-9]/g, '')",
  );
  check(
    '"בחירת כל התוצאות" בוחר את כולן',
    (await num('window.__alonimApp.selection.ids.size')) === total,
    String(total),
  );
  await page.eval("document.querySelector('.selection-bar [aria-haspopup=menu]').click()");
  await page.sleep(300);
  await page.eval(
    "[...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('העתקה כטקסט')).click()",
  );
  await page.sleep(700);
  check(
    'העתקה כטקסט מציגה הודעה',
    await page.eval('/הרשימה הועתקה|ההעתקה ללוח נכשלה/.test(document.body.innerText)'),
  );
  await page.key('Escape');
  await page.sleep(300);
  check(
    'Esc יוצא ממצב בחירה',
    (await page.eval("document.querySelector('.selection-bar').hidden")) &&
      (await num("document.querySelectorAll('.select-check').length")) === 0,
  );
  // הבחירה לפי מזהה: כשהתוצאות משתנות, "בחירת כל התוצאות (N)" מציג את הספירה הנוכחית והנבחרים שיצאו מהתוצאות נושרים
  await page.eval("document.querySelector('[data-key=select-mode]').click()");
  await page.sleep(200);
  const selectAllLabel = () =>
    page.eval(
      "(() => { const b = [...document.querySelectorAll('.selection-bar button')].find((x) => x.textContent.includes('בחירת כל התוצאות')); return b ? Number(b.textContent.replace(/[^0-9]/g, '')) : null; })()",
    );
  const resultCount = () =>
    num("document.querySelector('.results-count').textContent.replace(/[^0-9]/g, '')");
  const fullCount = await resultCount();
  await page.eval(
    "[...document.querySelectorAll('.select-check')].slice(0, 3).forEach((b) => b.click())",
  );
  await page.sleep(200);
  check('בחירה: לפני סינון הכפתור מציג את כל התוצאות', (await selectAllLabel()) === fullCount);
  await page.eval("document.querySelector('.search-input').focus()");
  await page.type('נח');
  await page.sleep(400);
  const narrowCount = await resultCount();
  check('בחירה: הסינון צמצם את התוצאות', narrowCount > 0 && narrowCount < fullCount);
  check(
    'בחירה: אחרי חיפוש הכפתור מציג את הספירה החדשה',
    (await selectAllLabel()) === narrowCount || (await selectAllLabel()) === null,
    String(await selectAllLabel()) + ' מול ' + narrowCount,
  );
  check(
    'בחירה: נבחרים שיצאו מהתוצאות נושרים, והספירה והפעולות תואמות את הנראה',
    await page.eval(
      "(() => { const a = window.__alonimApp; const n = a.selection.ids.size; const shown = new Set(a.index.search(a.view.all.query, a.view.all.filters, a.searchContext(), { sort: a.view.all.sort, includeHidden: a.view.all.includeHidden }).idx); return a.selectedItems().length === n && a.selectedItems().every((it) => shown.has(it._i)) && document.querySelector('.selection-count').textContent.includes(String(n)); })()",
    ),
  );
  await page.eval(
    "[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.includes('בחירת כל התוצאות'))?.click()",
  );
  await page.sleep(200);
  check(
    'בחירה: "בחירת כל התוצאות" בתוצאות מסוננות בוחר אותן בלבד',
    (await num('window.__alonimApp.selection.ids.size')) === narrowCount,
  );
  await page.eval("document.querySelector('[aria-label^=ניקוי]').click()");
  await page.sleep(400);
  check(
    'בחירה: אחרי ניקוי החיפוש הכפתור חוזר לספירה המלאה (לא 380 ישן)',
    (await resultCount()) === fullCount && (await selectAllLabel()) === fullCount,
    String(await selectAllLabel()),
  );
  check(
    'בחירה: מה שנבחר בתוצאות המסוננות נשאר נבחר',
    (await num('window.__alonimApp.selection.ids.size')) === narrowCount,
  );
  await page.eval("document.querySelector('.search-input').focus()");
  await page.type('ויקרא');
  await page.sleep(400);
  check(
    'בחירה: חיפוש שמוציא את כל הנבחרים מהתוצאות מרוקן את הבחירה',
    (await resultCount()) === 0 && (await num('window.__alonimApp.selection.ids.size')) === 0,
    (await resultCount()) + ' / ' + (await num('window.__alonimApp.selection.ids.size')),
  );
  await page.eval('window.__alonimApp.setSelecting(false)');

  // היסטוריה: פתיחת גיליון נרשמת ומופיעה בלשונית
  await page.eval('window.__alonimApp.openIssue(window.__alonimApp.index.item(0))');
  await page.sleep(500);
  await page.eval(
    "window.__alonimApp.closeViewer(); window.__alonimApp.view.mine.tab = 'history'; window.__alonimApp.go('mine')",
  );
  await page.sleep(400);
  check(
    'היסטוריה: גיליון שנפתח מופיע',
    (await num("document.querySelectorAll('.history-row').length")) >= 1,
  );
  // מזהה גיליון שהשתנה (previousIds): מצב המשתמש עובר בעת סנכרון
  await page.eval(`(() => {
    const a = window.__alonimApp;
    const it = a.index.item(5);
    a.state.toggleFavorite({ ...it, id: 'i_legacy000001' });
    a.state.markRead({ ...it, id: 'i_legacy000001' }, true);
    a.onCatalogData({ kind: 'shard', id: 'recent', cached: true, data: [{ id: 'i_renamed00001', series: it.series, title: 'x', hy: 5787, assets: [{ src: 'ladaat', ext: '1' }], previousIds: ['i_legacy000001'] }] });
  })()`);
  check(
    'previousIds: מועדף וקריאה עברו למזהה החדש',
    await page.eval(
      "(() => { const s = window.__alonimApp.state; return s.isFavorite('i_renamed00001') && s.isRead('i_renamed00001') && !s.isFavorite('i_legacy000001') && !s.isRead('i_legacy000001'); })()",
    ),
  );
  check(
    'היסטוריה: הסרת אירוע',
    await page.eval("(document.querySelector('.history-remove').click(), true)"),
  );
  // פרטי גיליון: גיליונות קשורים וניווט בסדרה
  await page.eval(
    "window.__alonimApp.go('all'); window.__alonimApp.showDetails(window.__alonimApp.index.item(window.__alonimApp.index.search('', {}, {}, { sort: 'date' }).idx[3]))",
  );
  await page.sleep(700);
  const title1 = await page.eval("document.querySelector('.dialog-title').textContent");
  check(
    'פרטים: "עוד גיליונות בסדרה" ו"אותה פרשה בשנים אחרות"',
    await page.eval("document.querySelectorAll('.details-related').length >= 1"),
  );
  await page.eval(
    "[...document.querySelectorAll('.details-more button')].find((b) => b.textContent.includes('הקודם בסדרה') || b.textContent.includes('הבא בסדרה')).click()",
  );
  await page.sleep(700);
  const title2 = await page.eval("document.querySelector('.dialog-title').textContent");
  check(
    'פרטים: מעבר לגיליון הסמוך בסדרה',
    Boolean(title1) &&
      Boolean(title2) &&
      (await page.eval("document.querySelectorAll('.dialog').length")) === 1,
    `${title1} -> ${title2}`,
  );
  await page.eval(
    "[...document.querySelectorAll('.details-more button')].find((b) => b.textContent.includes('העתקת השם')).click()",
  );
  await page.sleep(600);
  check(
    'פרטים: העתקת שם מציגה הודעה',
    await page.eval('/השם הועתק|ההעתקה ללוח נכשלה/.test(document.body.innerText)'),
  );
  await page.key('Escape');
  await page.sleep(300);
  check('בחירה והיסטוריה: בלי שגיאות קונסול', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);
}

/**
 * שני מסלולי המארח, בדפדפן אמיתי: חדש (0.9.99: קריאה בלי הורדה, תצוגה ישירה,
 * הדפסת קובץ) וישן (Blob, הורדה לתיקיית קריאה, הדפסה מהקורא).
 */
async function hostFlows(browser, open, check) {
  // חדש
  let page = await open('open=40');
  await page.sleep(900);
  check(
    'מארח חדש: קריאה מהמקור בלי הורדה ובלי כתיבה לתיקיית המשתמש',
    await page.eval(
      "window.__sdk.fetchedFiles.length === 1 && window.__sdk.downloads.length === 0 && ![...window.__sdk.userFs.keys()].some((k) => k.includes('_קריאה'))",
    ),
  );
  check(
    'מארח חדש: iframe ישיר על כתובת המארח (לא blob)',
    await page.eval(
      "(() => { const f = document.querySelector('.viewer-frame'); return Boolean(f) && !f.src.startsWith('blob:') && f.src.length > 20; })()",
    ),
  );
  check(
    'מארח חדש: כפתור תצוגה חלופית זמין',
    await page.eval("Boolean(document.querySelector('[data-key=alt-view]'))"),
  );
  await page.eval("document.querySelector('[data-key=alt-view]').click()");
  await page.sleep(900);
  check(
    'תצוגה חלופית: עוברת ל-Blob',
    await page.eval(
      "document.querySelector('.viewer-frame').src.startsWith('blob:') && !document.querySelector('[data-key=alt-view]')",
    ),
  );
  await page.eval('window.__alonimApp.print(window.__alonimApp.viewer.item)');
  await page.sleep(900);
  await browser.closePage(page);

  page = await open('open=40&print=1&xorigin=1');
  await page.sleep(1500);
  check(
    'מארח חדש: הדפסה פותחת מיד את מסך ההדפסה של אוצריא (ui.printFile), בלי כפתור ביניים',
    await page.eval(
      "window.__sdk.printed.length === 1 && !document.querySelector('.viewer-banner')",
    ),
  );
  check(
    'מארח חדש: ui.printFile נקרא עם ה-token של הקובץ',
    await page.eval(
      'window.__sdk.fileTokens.has(window.__sdk.printed[0].token) && Boolean(window.__sdk.printed[0].jobName)',
    ),
  );
  check(
    'מארח חדש: הדפסה שאושרה נרשמת בהיסטוריה',
    await page.eval("window.__alonimApp.state.historyEvents('printed').length === 1"),
  );
  check(
    'מארח חדש: לא נפתח דיאלוג הדרכה',
    await page.eval("!document.querySelector('.print-dialog')"),
  );
  await browser.closePage(page);

  // מארח שעדיין דורש מחווה: הבקשה האוטומטית נדחית, מופיע כפתור, והלחיצה מדפיסה
  page = await open('open=40&print=1&xorigin=1&scenario=print-gesture-first');
  await page.sleep(1500);
  check(
    'מארח שדורש מחווה (error.forbidden): מופיע כפתור "הדפסה" ולא נרשמת הדפסה',
    await page.eval(
      "Boolean(document.querySelector('.viewer-banner [data-key=print-now]')) && window.__sdk.printed.length === 1 && window.__alonimApp.state.historyEvents('printed').length === 0",
    ),
  );
  await page.eval("document.querySelector('[data-key=print-now]').click()");
  await page.sleep(500);
  check(
    'מארח שדורש מחווה: הלחיצה מדפיסה ונרשמת בהיסטוריה',
    await page.eval(
      "window.__sdk.printed.length === 2 && !document.querySelector('.viewer-banner') && window.__alonimApp.state.historyEvents('printed').length === 1",
    ),
  );
  await browser.closePage(page);

  page = await open('open=40&print=1&xorigin=1&scenario=print-cancel');
  await page.sleep(1500);
  check(
    'הדפסה שבוטלה בדיאלוג המערכת: הודעה, בלי דיאלוג הדרכה',
    await page.eval(
      "/ההדפסה בוטלה/.test(document.body.innerText) && !document.querySelector('.print-dialog')",
    ),
  );
  check(
    'הדפסה שבוטלה אינה נרשמת בהיסטוריה כהודפסה',
    await page.eval("window.__alonimApp.state.historyEvents('printed').length === 0"),
  );
  await browser.closePage(page);

  // ישן
  page = await open('open=40&host=legacy');
  await page.sleep(1500);
  check(
    'מארח ישן: הורדה ל-_קריאה, בלי fetchFile',
    await page.eval(
      'window.__sdk.fetchedFiles.length === 0 && window.__sdk.downloads.length === 1 && /_קריאה/.test(window.__sdk.downloads[0].destPath)',
    ),
  );
  check(
    'מארח ישן: iframe על blob, בלי כפתור תצוגה חלופית',
    await page.eval(
      "document.querySelector('.viewer-frame').src.startsWith('blob:') && !document.querySelector('[data-key=alt-view]')",
    ),
  );
  check(
    'מארח ישן: אין קריאה לשיטות החדשות',
    await page.eval(
      "!window.__sdk.calls.some((c) => c.method === 'network.fetchFile' || c.method === 'ui.printFile')",
    ),
  );
  await browser.closePage(page);

  // הדפסה מרובה: מארח חדש מציע, מארח ישן לא
  page = await open('page=all');
  await page.eval("document.querySelector('[data-key=select-mode]').click()");
  await page.sleep(250);
  await page.eval(
    "[...document.querySelectorAll('.select-check')].slice(0, 2).forEach((b) => b.click())",
  );
  await page.sleep(250);
  check(
    'הדפסה מרובה: כפתור בשורת הבחירה (מארח חדש)',
    await page.eval(
      "[...document.querySelectorAll('.selection-bar button')].some((b) => b.textContent.trim() === 'הדפסה')",
    ),
  );
  await page.eval(
    "[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.trim() === 'הדפסה').click()",
  );
  await page.sleep(300);
  await page.eval("document.querySelector('.dialog [data-key=all]').click()");
  await page.sleep(2200);
  check(
    'הדפסה ברצף: שני הגיליונות נשלחו, בלי הורדה',
    await page.eval('window.__sdk.printed.length === 2 && window.__sdk.downloads.length === 0'),
    String(await page.eval('window.__sdk.printed.length')),
  );
  check(
    'הדפסה ברצף: סטטוס "הודפס" לכל גיליון',
    await page.eval("document.querySelectorAll('.dialog .queue-row.is-done').length === 2"),
  );
  await browser.closePage(page);

  // ביטול בדיאלוג המערכת אינו חוסם את הגיליון הבא; מחווה שפגה נעצרת בנימוס
  for (const scenario of ['print-cancel', 'print-gesture']) {
    page = await open('page=all&scenario=' + scenario);
    await page.eval("document.querySelector('[data-key=select-mode]').click()");
    await page.sleep(250);
    await page.eval(
      "[...document.querySelectorAll('.select-check')].slice(0, 2).forEach((b) => b.click())",
    );
    await page.sleep(250);
    await page.eval(
      "[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.trim() === 'הדפסה').click()",
    );
    await page.sleep(300);
    await page.eval("document.querySelector('.dialog [data-key=all]').click()");
    await page.sleep(1500);
    if (scenario === 'print-cancel') {
      await page.eval("document.querySelector('.dialog [data-key=next]').click()");
      await page.sleep(900);
      check(
        'הדפסה מרובה: אחרי ביטול, "הדפס הבא" עובר לגיליון הבא (לא חוזר על המבוטל)',
        await page.eval(
          'window.__sdk.printed.length === 2 && window.__sdk.printed[0].token !== window.__sdk.printed[1].token',
        ),
        String(await page.eval('window.__sdk.printed.length')),
      );
    } else {
      check(
        'הדפסה ברצף: מחווה שפגה — ההודעה מסבירה, והגיליון נשאר ממתין (לא "נכשל")',
        await page.eval(
          "/לחיצה נפרדת/.test(document.querySelector('.dialog [role=status]').textContent) && document.querySelectorAll('.dialog .queue-row.is-done').length === 1 && document.querySelectorAll('.dialog .queue-row.is-failed').length === 0",
        ),
      );
    }
    await browser.closePage(page);
  }
  page = await open('page=all&host=legacy');
  await page.eval("document.querySelector('[data-key=select-mode]').click()");
  await page.sleep(250);
  await page.eval("document.querySelector('.select-check').click()");
  await page.sleep(250);
  check(
    'הדפסה מרובה: אין כפתור במארח ישן',
    await page.eval(
      "![...document.querySelectorAll('.selection-bar button')].some((b) => b.textContent.trim() === 'הדפסה')",
    ),
  );
  check('מסלולי המארח: בלי שגיאות קונסול', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);
}

/**
 * דליפות: מעבר מהיר בין לשוניות ופתיחה/סגירה חוזרות של הצפיין אינן מצטברות מאזינים, צמתי DOM, כתובות Blob או
 * tokens שהוענקו מהמארח (מארח ישן: כל פתיחה מקומית מעניקה token ו-Blob, וכל סגירה משחררת אותם).
 */
async function leakFlows(browser, open, check) {
  const page = await open('page=all&host=legacy');
  await page.eval(
    '(() => { window.__blobs = { made: 0, revoked: 0 }; const mk = URL.createObjectURL.bind(URL); const rv = URL.revokeObjectURL.bind(URL); URL.createObjectURL = (b) => (window.__blobs.made++, mk(b)); URL.revokeObjectURL = (u) => (window.__blobs.revoked++, rv(u)); })()',
  );
  const counts = () =>
    page.eval(
      "(() => { const a = window.__alonimApp; let n = 0; for (const set of a.listeners.values()) n += set.size; return { listeners: n, nodes: document.getElementsByTagName('*').length, opened: window.__sdk.calls.filter((c) => c.method === 'fs.openFolderFile').length, revoked: window.__sdk.revoked.length, blobsRevoked: window.__blobs.revoked }; })()",
    );
  const tabs = ['week', 'all', 'series', 'mine', 'settings'];
  for (let round = 0; round < 2; round++)
    for (const tab of tabs) {
      await page.eval(`window.__alonimApp.go('${tab}')`);
      await page.sleep(40);
    }
  await page.eval("window.__alonimApp.go('all')");
  await page.sleep(500);
  const before = await counts();
  for (let k = 0; k < 20; k++) {
    await page.eval(`window.__alonimApp.go('${tabs[k % tabs.length]}')`);
    await page.sleep(30);
  }
  await page.eval("window.__alonimApp.go('all')");
  await page.sleep(500);
  const afterTabs = await counts();
  check(
    'מעבר מהיר בין לשוניות (20 פעמים) אינו מצטבר מאזינים',
    afterTabs.listeners === before.listeners,
    JSON.stringify([before, afterTabs]),
  );
  check(
    'מעבר מהיר בין לשוניות אינו מצטבר צמתי DOM (עד 5% סטייה)',
    Math.abs(afterTabs.nodes - before.nodes) <= before.nodes * 0.05,
    JSON.stringify([before.nodes, afterTabs.nodes]),
  );
  await page.eval("window.__alonimApp.state.setPref('thumbs', false)");
  const opens = 5;
  const sdkBefore = await counts();
  for (let k = 0; k < opens; k++) {
    await page.eval(
      "(() => { const a = window.__alonimApp; const idx = a.index.search('', {}, {}, { sort: 'date' }).idx; a.openIssue(a.index.item(idx[" +
        k +
        '])); })()',
    );
    await page.sleep(1700);
    await page.eval('window.__alonimApp.closeViewer()');
    await page.sleep(200);
  }
  const afterViewer = await counts();
  check(
    'צפיין: פתיחה וסגירה (5 פעמים) אינן מצטברות מאזינים',
    afterViewer.listeners === sdkBefore.listeners,
    JSON.stringify([sdkBefore, afterViewer]),
  );
  check(
    'צפיין: כל token שהוענק מהמארח (fs.openFolderFile) שוחרר בסגירה',
    afterViewer.opened - sdkBefore.opened === afterViewer.revoked - sdkBefore.revoked &&
      afterViewer.opened - sdkBefore.opened >= opens,
    JSON.stringify([sdkBefore, afterViewer]),
  );
  check(
    'צפיין: כל Blob של הקובץ שוחרר בסגירה',
    afterViewer.blobsRevoked - sdkBefore.blobsRevoked >= opens,
    JSON.stringify([sdkBefore.blobsRevoked, afterViewer.blobsRevoked]),
  );
  // סגירה בזמן טעינה: אין token יתום
  const midBefore = await counts();
  await page.eval(
    "(() => { const a = window.__alonimApp; const idx = a.index.search('', {}, {}, { sort: 'date' }).idx; a.openIssue(a.index.item(idx[7])); setTimeout(() => a.closeViewer(), 120); })()",
  );
  await page.sleep(2500);
  const midAfter = await counts();
  check(
    'סגירת הצפיין באמצע הטעינה: אין token מוענק שנשאר',
    midAfter.opened - midBefore.opened === midAfter.revoked - midBefore.revoked,
    JSON.stringify([midBefore, midAfter]),
  );
  check('דליפות (מארח ישן): בלי שגיאות קונסול', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);

  // "הצגה חלופית" פעמיים ברצף (מארח חדש): שתי טעינות מקבילות לא משאירות Blob בלי מי שישחרר אותו
  const alt = await open('page=all');
  await alt.eval(
    "(() => { window.__blobs = { made: 0, revoked: 0 }; const mk = URL.createObjectURL.bind(URL); const rv = URL.revokeObjectURL.bind(URL); URL.createObjectURL = (b) => { if (!/fileUrl/.test(new Error().stack)) window.__blobs.made++; return mk(b); }; URL.revokeObjectURL = (u) => (window.__blobs.revoked++, rv(u)); const a = window.__alonimApp; const idx = a.index.search('', {}, {}, { sort: 'date' }).idx; a.openIssue(a.index.item(idx[2])); })()",
  );
  await alt.sleep(1200);
  await alt.eval(
    'window.__alonimApp.viewerUi.useBlobView(); window.__alonimApp.viewerUi.useBlobView();',
  );
  await alt.sleep(1500);
  await alt.eval('window.__alonimApp.closeViewer()');
  await alt.sleep(300);
  check(
    'הצגה חלופית פעמיים ברצף: כל Blob שנוצר שוחרר',
    await alt.eval('window.__blobs.made >= 1 && window.__blobs.made === window.__blobs.revoked'),
    await alt.eval('JSON.stringify(window.__blobs)'),
  );
  check('דליפות: בלי שגיאות קונסול', alt.errors.length === 0, alt.errors.join('\n'));
  await browser.closePage(alt);
}

/** כשל במסך או בחלון אינו משאיר דף ריק: כרטיס שגיאה עם ניסיון חוזר, והלשוניות ממשיכות לעבוד. */
async function failureFlows(browser, open, check) {
  const page = await open('page=week');
  await page.eval(
    "(() => { const a = window.__alonimApp; window.__origForWeek = a.index.forWeek; a.index.forWeek = () => { throw new Error('injected failure'); }; a.emit('data', 'x'); })()",
  );
  await page.sleep(500);
  check(
    'כשל בציור מסך: כרטיס שגיאה במקום דף ריק',
    await page.eval(
      "Boolean(document.querySelector('.state-card.is-error')) && /משהו השתבש במסך הזה/.test(document.querySelector('.state-card').textContent) && /screen_failed/.test(document.querySelector('.state-card').textContent)",
    ),
  );
  check(
    'כרטיס השגיאה מציע ניסיון חוזר והעתקת פרטים',
    await page.eval(
      "Boolean(document.querySelector('.state-card [data-key=retry]')) && [...document.querySelectorAll('.state-card button')].length >= 3",
    ),
  );
  check(
    'הכשל נרשם ביומן בקטגוריית ui עם הקוד',
    await page.eval(
      "window.__alonimApp.log.filter({ level: 'error', cat: 'ui' }).some((e) => e.code === 'screen_failed')",
    ),
  );
  await page.eval("window.__alonimApp.go('all')");
  await page.sleep(500);
  check(
    'שאר התוסף ממשיך לעבוד: לשונית אחרת נטענת',
    await page.eval("document.querySelectorAll('.card').length > 3"),
  );
  await page.eval(
    "window.__alonimApp.index.forWeek = window.__origForWeek; window.__alonimApp.go('week')",
  );
  await page.sleep(500);
  check(
    'אחרי התיקון המסך חוזר',
    await page.eval(
      "Boolean(document.querySelector('.hero-title')) && !document.querySelector('.state-card.is-error')",
    ),
  );
  // חלון שנכשל
  await page.eval(
    "(() => { window.__origDetails = window.Alonim.Dialogs.showDetails; window.Alonim.Dialogs.showDetails = async () => { throw new Error('injected dialog failure'); }; window.__alonimApp.showDetails(window.__alonimApp.index.item(0)); })()",
  );
  await page.sleep(500);
  check(
    'חלון שנכשל: הודעה עם קוד, לא שתיקה',
    await page.eval('/dialog_failed/.test(document.body.innerText)'),
  );
  await browser.closePage(page);
}

/** תרחישי זרימה: נבדקים בפועל, לא רק נטענים. */
async function flows(browser) {
  const open = async (query, base, width) => {
    const page = await browser.newPage(width || 1000, 760);
    await page.goto(`${base || small}?${TODAY}&${query}`);
    await page.waitFor("document.documentElement.dataset.previewReady === '1'", 20000);
    await page.sleep(200);
    return page;
  };
  const check = (name, ok, detail) =>
    ok ? console.log('✔ flow: ' + name) : fail('flow: ' + name, detail || 'failed');

  // SMOKE_ONLY=cycle: רק "מעגל השנה" (תרחישים וזרימות), לעבודה על המסך.
  if (process.env.SMOKE_ONLY === 'cycle') {
    await cycleFlows(browser, open, check);
    return;
  }

  // חיפוש מיידי + Ctrl+/ + Esc
  let page = await open('page=week');
  await page.key('/', 2, 'Slash');
  await page.sleep(300);
  check(
    'Ctrl+/ עובר לחיפוש וממקד',
    await page.eval(
      "document.querySelector('.main-tab[aria-selected=true]').dataset.tab === 'all' && document.activeElement.classList.contains('search-input')",
    ),
  );
  await page.type('נח');
  await page.sleep(200);
  check(
    'הקלדה מסננת',
    await page.eval("parseInt(document.querySelector('.results-count').textContent, 10) >= 8"),
    await page.eval("document.querySelector('.results-count').textContent"),
  );
  check('הדגשת התאמה', await page.eval("document.querySelectorAll('mark.hit').length > 0"));
  await page.key('Escape');
  await page.sleep(200);
  check('Esc מנקה חיפוש', await page.eval("document.querySelector('.search-input').value === ''"));

  // פריסה עברית: ל על המקש הפיזי K. Ctrl+K אינו חיפוש (באוצריא הוא "החלף שולחן עבודה"); קיצורי הכרטיס לפי המקש הפיזי.
  await page.eval('document.activeElement.blur()');
  await page.key('ל', 2, 'KeyK');
  await page.sleep(200);
  check(
    'Ctrl+K (גם בפריסה עברית) אינו תופס את המיקוד',
    await page.eval("!document.activeElement.classList.contains('search-input')"),
  );
  await page.eval("document.querySelector('.search-input').focus()");
  await page.key('ArrowDown');
  await page.sleep(150);
  await page.key('ם', 0, 'KeyP');
  await page.sleep(500);
  check(
    'קיצור P בפריסה עברית מדפיס (דיאלוג או צפיין)',
    await page.eval(
      "!document.querySelector('.viewer').hidden || Boolean(document.querySelector('.print-dialog'))",
    ),
    await page.eval('document.activeElement.className'),
  );
  await page.eval(
    'window.__alonimApp.closeViewer && window.__alonimApp.closeViewer(); Array.from(document.querySelectorAll(".dialog-actions button")).forEach((b) => b.click())',
  );
  await page.sleep(300);

  // ניווט מקלדת ברשימה: חץ מטה מהשדה לכרטיס הראשון, Enter פותח צפיין, Esc חוזר
  await page.eval("document.querySelector('.search-input').focus()");
  await page.key('ArrowDown');
  await page.sleep(150);
  check('חץ מטה ממקד כרטיס', await page.eval("document.activeElement.classList.contains('card')"));
  await page.key('ArrowLeft');
  await page.sleep(100);
  check(
    'חץ בין כרטיסים (RTL: שמאלה = הבא)',
    await page.eval("document.activeElement.dataset.item === '1'"),
    await page.eval('document.activeElement.className'),
  );
  // שרד שמגיע ברקע מצייר מחדש את התוצאות: המיקוד של מי שגולל במקלדת נשמר
  await page.eval("window.__alonimApp.emit('data', 'shard')");
  await page.sleep(400);
  check(
    'אירוע נתונים בזמן שכרטיס ממוקד אינו מפיל את המיקוד',
    await page.eval(
      "document.activeElement.classList.contains('card') && document.activeElement.dataset.item === '1'",
    ),
    await page.eval('document.activeElement.tagName + "." + document.activeElement.className'),
  );
  await page.key('Enter');
  await page.sleep(900);
  check(
    'Enter פותח צפיין עם iframe',
    await page.eval(
      "!document.querySelector('.viewer').hidden && Boolean(document.querySelector('.viewer-frame'))",
    ),
  );
  await page.key('Escape');
  await page.sleep(250);
  check(
    'Esc סוגר צפיין וחוזר לרשימה',
    await page.eval(
      "document.querySelector('.viewer').hidden && document.querySelectorAll('.card').length > 0",
    ),
  );
  check(
    'אחרי Esc המיקוד חוזר לכרטיס שממנו נפתח הצפיין',
    await page.eval(
      "document.activeElement.classList.contains('card') && document.activeElement.dataset.item === '1'",
    ),
    await page.eval('document.activeElement.className'),
  );
  // הצפיין של הדפדפן תופס מיקוד אחרי הטעינה: המיקוד חוזר לסרגל כדי ש-Esc ימשיך לעבוד
  await page.key('Enter');
  await page.sleep(900);
  await page.eval(
    "(() => { const f = document.querySelector('.viewer-frame'); f.focus(); f.dispatchEvent(new Event('load')); })()",
  );
  await page.sleep(250);
  check(
    'מיקוד שנתפס ב-iframe אחרי טעינה חוזר לכפתור החזרה (Esc עובד)',
    await page.eval("document.activeElement.dataset.key === 'back'"),
    await page.eval('document.activeElement.tagName + "." + document.activeElement.className'),
  );
  await page.key('Escape');
  await page.sleep(250);
  check(
    'אחרי Esc שני המיקוד על הכרטיס שנצפה',
    await page.eval(
      "document.activeElement.classList.contains('card') && document.activeElement.dataset.item === '1'",
    ),
  );
  check('בלי שגיאות קונסול בזרימה', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);

  await weekFlows(browser, open, check);
  await cycleFlows(browser, open, check);
  await filterFlows(browser, open, check);
  await selectionFlows(browser, open, check);
  await failureFlows(browser, open, check);
  await leakFlows(browser, open, check);

  // לחיצה על כרטיס = קריאה; הורדה = שמירה קבועה ומצב "הורד" מהדיסק
  page = await open('page=all');
  const before = await page.eval('window.__sdk.userFs.size');
  await page.click('.card:not(:has(.chip-done)) .card-actions .icon-button');
  await page.sleep(1500);
  check(
    'כפתור הורדה שומר לתיקייה',
    (await page.eval('window.__sdk.userFs.size')) === before + 1,
    'size ' + (await page.eval('window.__sdk.userFs.size')),
  );
  check(
    'המצב "הורד" מופיע בכרטיס',
    await page.eval("document.querySelectorAll('.card .chip-done').length >= 6"),
  );
  const pathOk = await page.eval(
    "[...window.__sdk.userFs.keys()].some((k) => /\\/\\d{4}\\/[^/]+\\/[^/]+ \\[[0-9a-f]{8}\\]\\.pdf$/.test(k) && !k.includes('/_קריאה/'))",
  );
  check('נתיב שנה/סדרה/קובץ', pathOk);
  await page.click('.card .card-title');
  await page.sleep(900);
  check(
    'לחיצה על כרטיס פותחת לקריאה',
    await page.eval("!document.querySelector('.viewer').hidden"),
  );
  await browser.closePage(page);

  // הדפסה: iframe חסום ב-WebView האמיתי → דיאלוג עם מסלול קורא אוצריא
  page = await open('open=0&print=1&xorigin=1&host=legacy');
  await page.sleep(2200);
  check(
    'הדפסה: דיאלוג עם מסלול הקורא וההנחיה',
    await page.eval(
      "document.querySelector('.print-dialog') && document.querySelector('.print-guide')",
    ),
  );
  await page.click('.print-dialog [data-key=reader]');
  await page.sleep(1500);
  check(
    'פתיחה בקורא של אוצריא (מדומה)',
    (await page.eval("window.__sdk.calls.some((c) => c.method === 'reader.openBook')")) === true,
  );
  await browser.closePage(page);

  // אין ספרייה טעונה באוצריא: הרענון והחיפוש נתקעים. חיווי התקדמות, הודעה ברורה אחרי פסק הזמן, וביטול.
  page = await open('open=0&print=1&xorigin=1&host=legacy&scenario=reader-nolibrary');
  await page.sleep(2200);
  await page.eval('window.__alonimApp.files.readerTimeouts = { refreshMs: 300, callMs: 300 }');
  await page.click('.print-dialog [data-key=reader]');
  await page.sleep(500);
  check(
    'פתיחה בקורא: חלון התקדמות (שומר / מרענן / מחפש) עם כפתור ביטול',
    await page.eval(
      "/מרענן את הספרייה|שומר את הגיליון|מחפש את הגיליון/.test(document.querySelector('.dialog [role=status]').textContent) && Boolean(document.querySelector('.dialog [data-key=cancel]'))",
    ),
  );
  await page.sleep(3500);
  check(
    'פתיחה בקורא: אחרי פסק הזמן — הודעה ברורה וניסיון חוזר',
    await page.eval(
      "/לא ענתה בזמן/.test(document.querySelector('.dialog [role=status]').textContent) && !document.querySelector('.dialog [data-key=retry]').hidden",
    ),
  );
  await page.eval("document.querySelector('.dialog [data-key=cancel]').click()");
  await page.sleep(400);
  check('פתיחה בקורא: ביטול סוגר את החלון', await page.eval("!document.querySelector('.dialog')"));
  await browser.closePage(page);

  await hostFlows(browser, open, check);

  // "פתח באתר המקור": סירוב באישור של אוצריא שקט; כשל של המארח הוא open_url_failed; האימות שלנו הוא url_not_allowed
  for (const [scenario, expected, forbidden] of [
    ['openurl-declined', null, /url_not_allowed|open_url_failed/],
    ['openurl-error', /open_url_failed/, /url_not_allowed/],
    ['ready', null, /url_not_allowed|open_url_failed/],
  ]) {
    page = await open('page=all&scenario=' + scenario);
    await page.eval('window.__alonimApp.openSiteFor(window.__alonimApp.index.item(0))');
    await page.sleep(500);
    const text = await page.eval(
      "document.querySelector('.toasts') ? document.querySelector('.toasts').innerText : ''",
    );
    check(
      'פתח באתר המקור (' + scenario + '): ההודעה לפי התוצאה',
      !forbidden.test(text) && (!expected || expected.test(text)),
      text,
    );
    await browser.closePage(page);
  }

  // רמז "החיפוש הוא בעברית" גם בחיפוש בסדרות ובדף סדרה
  for (const [q, field] of [
    ['page=series', '.search-input'],
    ['series=0', '.page-search input, input'],
  ]) {
    page = await open(q);
    await page.eval(
      `(() => { const i = document.querySelector(${JSON.stringify(field)}); i.value = 'mashiv nefesh'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await page.sleep(500);
    check(
      'רמז לחיפוש בעברית (' + q + ')',
      await page.eval(
        "/החיפוש הוא בעברית/.test((document.querySelector('.state-card') || {}).textContent || '')",
      ),
    );
    await browser.closePage(page);
  }

  // שורת הבחירה בצר: פעולות כאייקונים בלבד עם שם נגיש (שתי שורות במקום שלוש); ברחב התוויות נראות
  for (const [width, narrow] of [
    [480, true],
    [1000, false],
  ]) {
    page = await open('page=all', small, width);
    await page.eval("document.querySelector('[data-key=select-mode]').click()");
    await page.sleep(300);
    await page.eval(
      "[...document.querySelectorAll('.select-check')].slice(0, 2).forEach((b) => b.click())",
    );
    await page.sleep(300);
    const bar = await page.eval(
      "(() => { const b = document.querySelector('.selection-bar'); const acts = [...b.querySelectorAll('.bar-action')]; return { n: acts.length, named: acts.every((a) => (a.getAttribute('aria-label') || '').length > 1 && a.title), hidden: acts.map((a) => getComputedStyle(a.querySelector('.bar-label')).display === 'none'), h: Math.round(b.getBoundingClientRect().height) }; })()",
    );
    check(
      'שורת בחירה ב-' +
        width +
        'px: ' +
        (narrow ? 'אייקונים בלבד, שמות נגישים, שתי שורות' : 'תוויות נראות'),
      bar.n >= 3 && bar.named && bar.hidden.every((h) => h === narrow) && (!narrow || bar.h < 110),
      JSON.stringify(bar),
    );
    await browser.closePage(page);
  }

  // כותרת השבוע בטעינה הראשונה: שלד, לא "שבת" גנרית שמתחלפת בשם הפרשה
  page = await open('page=week&seed=0&netdelay=3000&settle=100&welcome=0', small, 480);
  check(
    'כותרת השבוע בטעינה: שלד עם שם נגיש, בלי "לפי העלונים"',
    await page.eval(
      "(() => { const h = document.querySelector('.hero-title'); return Boolean(h) && h.classList.contains('is-pending') && Boolean(h.querySelector('.skeleton-line')) && h.textContent.trim().length > 0 && !document.querySelector('.hero-chips').textContent.includes('לפי העלונים'); })()",
    ),
  );
  await browser.closePage(page);

  // אבחון: יומן שכל אירועיו debug וסינון ברירת המחדל (info) — הספירה והרשימה מסכימות, וההסבר אומר מה קרה
  page = await open('page=settings&section=diagnostics');
  await page.eval(
    "(() => { const a = window.__alonimApp; a.log.clear(); for (const x of 'abcd') a.log.debug(x); const s = document.querySelector('[data-section=diagnostics] select[aria-label=\"קטגוריית יומן\"]'); s.value = 'app'; s.dispatchEvent(new Event('change', { bubbles: true })); })()",
  );
  await page.sleep(300);
  const diagText = await page.eval(
    "document.querySelector('[data-section=diagnostics] .log-area').textContent + ' | ' + document.querySelector('[data-section=diagnostics] .log-area').previousElementSibling.textContent",
  );
  check(
    'אבחון: 4 אירועי debug מול סינון info — "מוצגים 0 מתוך 4" והסבר, לא "אין אירועים להצגה"',
    /אין אירועים שמתאימים לסינון/.test(diagText) &&
      /מוצגים 0 מתוך 4 אירועים ביומן/.test(diagText) &&
      !/אין אירועים להצגה/.test(diagText),
    diagText,
  );
  await browser.closePage(page);

  // כללים: "הסתר סדרה" מכרטיס, ביטול (Undo)
  page = await open('page=all');
  const total = await page.eval(
    "Number(document.querySelector('.results-count').textContent.replace(/\\D/g, ''))",
  );
  await page.eval(
    "window.__alonimApp.hideSeries(window.__alonimApp.index.item(window.__alonimApp.index.search('', {}, {}, {}).idx[0]))",
  );
  await page.sleep(400);
  const after = await page.eval(
    "Number(document.querySelector('.results-count').textContent.replace(/\\D/g, ''))",
  );
  check('הסתר סדרה מקטין את הרשימה', after < total, total + ' → ' + after);
  await page.click('.toast-action');
  await page.sleep(400);
  check(
    'ביטול מחזיר את הסדרה',
    (await page.eval(
      "Number(document.querySelector('.results-count').textContent.replace(/\\D/g, ''))",
    )) === total,
  );
  await browser.closePage(page);

  // גלישה אופקית ב-400px בכל המסכים
  for (const q of [
    'page=week',
    'page=cycle',
    'topic=p:noach',
    'topic=p:vayakhel',
    'page=all',
    'page=series',
    'series=0',
    'page=mine',
    'page=settings&section=rules',
    'details=0',
    'open=0',
  ]) {
    page = await open(q, small, 400);
    const overflow = await page.eval(
      "(() => { const w = innerWidth; const bad = []; for (const n of document.querySelectorAll('body *')) { const r = n.getBoundingClientRect(); if (r.width > 0 && (r.right > w + 1 || r.left < -1) && !n.closest('.vlist, .main-tabs, .filter-flags, .viewer-frame, .menu, .toasts') && getComputedStyle(n).position !== 'fixed') bad.push(n.className + ':' + Math.round(r.left) + '-' + Math.round(r.right)); } return bad.slice(0, 5); })()",
    );
    check('400px בלי גלישה: ' + q, overflow.length === 0, overflow.join(' | '));
    check('400px בלי שגיאות: ' + q, page.errors.length === 0, page.errors.join('\n'));
    await browser.closePage(page);
  }

  // גלילה וירטואלית: 30,000+ גיליונות, לעולם לא יותר מ-60 כרטיסים ב-DOM
  page = await open('page=all', large);
  await page.waitFor(
    "window.__alonimApp.catalog.status.shardsLoaded >= window.__alonimApp.catalog.status.shardsTotal && window.__alonimApp.catalog.status.phase === 'idle'",
    60000,
  );
  await page.sleep(600);
  const info = await page.eval(
    "({ n: Number(document.querySelector('.results-count').textContent.replace(/\\D/g, '')), dom: document.querySelectorAll('[data-item]').length })",
  );
  check(
    '30K+ תוצאות, DOM מוגבל',
    info.n >= 30000 && info.dom > 0 && info.dom <= 60,
    JSON.stringify(info),
  );
  let maxDom = info.dom;
  for (const top of [5000, 120000, 700000, 2500000, 0]) {
    await page.eval(`document.querySelector('.vlist').scrollTop = ${top}`);
    await page.sleep(120);
    maxDom = Math.max(maxDom, await page.eval("document.querySelectorAll('[data-item]').length"));
  }
  check('DOM בגלילה ≤ 60 (נמדד ' + maxDom + ')', maxDom <= 60 && maxDom > 0);
  await page.eval("document.querySelector('.search-input').focus()");
  await page.type('אסיפה');
  await page.sleep(300);
  check(
    'חיפוש על 30K+ ממשיך להגביל DOM',
    (await page.eval("document.querySelectorAll('[data-item]').length")) <= 60,
  );
  check('חיפוש על 30K+ בלי שגיאות', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);
}

const browser = await Browser.launch();
try {
  // תרחישים במקביל (עד 4 דפים בכל פעם).
  const jobs = [];
  for (const scenario of scenarios) {
    if (process.env.SMOKE_ONLY && !scenario[0].startsWith(process.env.SMOKE_ONLY)) continue;
    for (const [suffix, include] of modes)
      if (include(scenario[0])) jobs.push(() => runScenario(browser, scenario, suffix));
  }
  // מסכים מרכזיים גם בצר.
  for (const name of [
    'week',
    'all',
    'series-page',
    'settings',
    'details',
    'cycle',
    'cycle-topic',
  ]) {
    if (process.env.SMOKE_ONLY && !name.startsWith(process.env.SMOKE_ONLY)) continue;
    const s = scenarios.find((x) => x[0] === name);
    jobs.push(() => runScenario(browser, s, '', small, 400));
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: Number(process.env.SMOKE_PARALLEL || 1) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          await job();
        } catch (error) {
          fail('job', error.message);
        }
      }
    }),
  );
  await flows(browser);
  // כל מחלקה שהופיעה ב-DOM מעוצבת (או שהיא סימון בלבד).
  const MARKERS = new Set([
    'visually-hidden',
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
    'is-parasha',
    'topic-page',
    'topic-title',
    'topic-when-text',
    'topic-filters',
    'topic-list',
    'is-unread',
    'dialog-close',
  ]);
  const unstyled = [...seenClasses.keys()].filter((c) => !styled.has(c) && !MARKERS.has(c));
  if (unstyled.length)
    fail(
      'classes',
      'מחלקות ב-DOM בלי עיצוב: ' +
        unstyled.map((c) => c + '(' + seenClasses.get(c) + ')').join(', '),
    );
  else console.log('✔ כל המחלקות שבשימוש מעוצבות (' + seenClasses.size + ')');
} finally {
  await browser.close();
}
if (failures) {
  console.error(failures + ' בדיקות נכשלו');
  process.exit(1);
}
console.log('הכול עבר');
