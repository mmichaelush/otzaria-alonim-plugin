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

const css = readFileSync(join(here, '..', '..', 'plugin', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const styled = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
const seenClasses = new Map();

/** [שם, שאילתה, בדיקה אחרי הטעינה (אופציונלי)]. */
const scenarios = [
  ['week', 'page=week', "document.querySelector('.hero-title') && document.querySelectorAll('.card').length > 3"],
  ['week-empty-seed', 'page=week&seed=0', "document.querySelector('.hint-card')"],
  ['all', 'page=all', "document.querySelectorAll('.card').length > 3"],
  ['all-query', 'page=all&query=' + encodeURIComponent('אסיפת נח'), "document.querySelectorAll('.card').length >= 1 && document.querySelector('mark.hit')"],
  ['all-none', 'page=all&query=' + encodeURIComponent('זזזזזז'), "document.querySelector('.state-card')"],
  ['all-list-view', 'page=all&view=list', "document.querySelector('.card.is-row')"],
  ['series', 'page=series', "document.querySelectorAll('.series-row').length > 3"],
  ['series-page', 'series=0', "document.querySelector('.series-title') && document.querySelectorAll('.card').length > 1"],
  ['mine', 'page=mine', "document.querySelector('.segmented')"],
  ['mine-lists', 'page=mine&minetab=lists', "document.querySelector('.state-card, .list-header')"],
  ['mine-shabbat', 'page=mine&minetab=shabbat', "document.querySelector('.shabbat-header')"],
  ['mine-downloads', 'page=mine&minetab=downloads', "document.querySelector('.state-card, .list-header')"],
  ['mine-history', 'page=mine&minetab=history&seed=1', "document.querySelector('.history-page, .state-card')"],
  ['settings', 'page=settings', "document.querySelectorAll('.settings-card').length >= 8"],
  ['settings-rules', 'page=settings&section=rules', "document.querySelector('.rule-form')"],
  ['settings-general', 'page=settings&section=general', "document.querySelector('[data-section=general] .switch')"],
  ['settings-storage', 'page=settings&section=disk', "document.querySelector('[data-section=disk] .history-row') && document.querySelector('[data-section=disk] .setting-actions')"],
  ['settings-help', 'page=settings&section=help', "document.querySelector('[data-section=help] .syntax') && document.querySelector('[data-section=help] .shortcuts')"],
  ['welcome', 'welcome=1', "document.querySelector('.welcome')"],
  ['settings-backup', 'page=settings&section=backup', "document.querySelector('.code-area')"],
  ['details', 'details=0', "document.querySelector('.dialog .asset-list')"],
  ['viewer', 'open=0', "document.querySelector('.viewer-frame')"],
  ['viewer-legacy', 'open=0&host=legacy', "document.querySelector('.viewer-frame')"],
  ['viewer-nofolder', 'open=0&nofolder=1', "document.querySelector('.viewer-frame')"],
  ['viewer-nofolder-legacy', 'open=0&nofolder=1&host=legacy', "document.querySelector('.viewer .state-card')"],
  ['viewer-print', 'open=0&print=1&xorigin=1', "document.querySelector('.viewer-banner')"],
  ['viewer-print-legacy', 'open=0&print=1&xorigin=1&host=legacy', "document.querySelector('.print-dialog')"],
  ['viewer-linux', 'open=0&platform=linux', "document.querySelector('.viewer .state-card')"],
  ['offline', 'scenario=offline&page=week&warm=1', "document.querySelector('.hero-title') && document.querySelectorAll('.card').length > 3"],
  ['offline-nocache', 'scenario=offline&page=week&seed=0&nocache=1', 'true'],
  ['blocked', 'scenario=blocked', 'true'],
  ['bad-schema', 'scenario=bad-schema', 'true'],
  ['rate-limit', 'scenario=rate-limit&page=all', "document.querySelectorAll('.card').length > 3"],
  ['slow', 'scenario=slow&page=week', 'true'],
  ['download-blocked', 'scenario=download-blocked&open=40', "document.querySelector('.viewer .state-card.is-error')"],
  ['download-html', 'scenario=download-html&open=3', 'true'],
  ['folder-gone', 'scenario=folder-gone&page=mine', 'true'],
];

// בכל התרחישים בהיר; כהה ואנגלית רק למסכים המרכזיים.
const modes = [
  ['', () => true],
  ['&mode=dark', (name) => ['week', 'all', 'series-page', 'mine', 'settings', 'details', 'viewer'].includes(name)],
  ['&lang=en', (name) => ['week', 'all', 'series', 'settings', 'details', 'viewer', 'mine'].includes(name)],
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
    for (const cls of await page.eval("[...new Set([...document.querySelectorAll('[class]')].flatMap((n) => (typeof n.className === 'string' ? n.className.split(/\\s+/) : (n.className.baseVal || '').split(/\\s+/))))]")) {
      if (cls) seenClasses.set(cls, name);
    }
    // נגישות: שמות נגישים, תוויות, ARIA וניגודיות AA.
    const a11y = await a11yReport(page);
    if (a11y.length) fail(name + suffix, 'נגישות: ' + a11y.join('; '));
    // "null"/"undefined" שדלפו כטקסט לממשק (למשל replaceChildren(null)).
    const leaked = await page.eval("(document.body.innerText.match(/\\b(null|undefined|NaN)\\b|\\[object/g) || []).join(',')");
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
  const text = (selector) => page.eval(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent || ''`);
  const hero = async () => ({ title: await text('.hero-title'), sub: await text('.hero-sub'), chips: await text('.hero-chips') });
  const click = (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const jump = async (date) => {
    await page.eval(`document.querySelector('.week-row[data-date="${date}"]').click()`);
    await page.sleep(250);
  };
  const openPicker = async () => {
    await page.eval("document.querySelector('[data-key=jump]').click()");
    await page.sleep(300);
  };

  let h = await hero();
  check('השבוע לפי היום: פרשת נח, תאריך עברי ולועזי', h.title === 'פרשת נח' && /^שבת, \S+ בחשוון תשפ״ז · 17 באוקטובר 2026$/.test(h.sub), JSON.stringify(h));
  check('השבוע הנוכחי מסומן, בלי הדגשת "שבוע אחר"', h.chips.includes('השבוע') && (await page.eval("!document.querySelector('.week-hero.is-away')")));

  await page.eval("document.querySelector('.hero-nav:last-of-type').click()");
  await page.sleep(250);
  h = await hero();
  check('חץ "הבא": שבוע אחר מסומן בבירור', h.title === 'פרשת לך לך' && h.chips.includes('שבוע הבא') && (await page.eval("Boolean(document.querySelector('.week-hero.is-away'))")), JSON.stringify(h));
  await page.eval("document.querySelector('[data-key=current]').click()");
  await page.sleep(250);
  check('"חזרה להשבוע" מחזירה לשבת הקרובה', (await text('.hero-title')) === 'פרשת נח');

  await openPicker();
  const rows = await page.eval("document.querySelectorAll('.week-row').length");
  check('מעבר לשבוע: רשימת השנה העברית נפתחת על השנה הנוכחית', rows > 40 && (await page.eval("document.querySelector('.picker-year').value === '5787'")), 'rows ' + rows);
  check('מעבר לשבוע: השבוע המוצג מסומן', await page.eval("document.querySelector('.week-row.is-selected').dataset.date === '2026-10-17'"));
  await page.eval("document.querySelector('[data-filter=holiday]').click()");
  await page.sleep(150);
  check('מעבר לשבוע: מסנן חגים מציג רק חגים באמצע השבוע', await page.eval("[...document.querySelectorAll('.week-row')].every((r) => r.classList.contains('is-holiday')) && document.querySelectorAll('.week-row').length >= 5"));
  // שנים ישנות: לוח הארכיון נטען בלחיצה, ומופיעות שנים ישנות בבורר
  const yearsBefore = await page.eval("document.querySelectorAll('.picker-year option').length");
  check('שנים ישנות: כפתור טעינה מוצג', await page.eval("Boolean(document.querySelector('[data-key=archive]')) && !document.querySelector('[data-key=archive]').hidden"));
  await click('[data-key=archive]');
  await page.sleep(1500);
  const yearsAfter = await page.eval("document.querySelectorAll('.picker-year option').length");
  check('שנים ישנות: אחרי הטעינה יש יותר שנים והכפתור נעלם', yearsAfter > yearsBefore + 10 && (await page.eval("document.querySelector('[data-key=archive]').hidden")), `${yearsBefore} -> ${yearsAfter}`);
  await click('[data-filter=all]');
  await page.eval("(() => { const s = document.querySelector('.picker-year'); s.value = '5760'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await page.sleep(300);
  check('שנה ישנה נבחרת ומציגה שבועות', (await page.eval("document.querySelectorAll('.week-row').length")) > 20);
  await page.eval("(() => { const s = document.querySelector('.picker-year'); s.value = '5787'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await page.sleep(300);
  await jump('2027-03-23');
  h = await hero();
  check('בחירת חג (פורים): כותרת ותאריך עם יום בשבוע', h.title === 'פורים' && h.sub === 'יום שלישי, י״ד באדר ב׳ תשפ״ז · 23 במרץ 2027' && h.chips.includes('חג באמצע השבוע'), JSON.stringify(h));

  await page.eval("document.querySelector('[data-key=current]').click()");
  await page.sleep(200);
  await openPicker();
  await page.eval("(() => { const i = document.querySelector('.picker-date'); i.value = '2027-03-21'; })()");
  await page.eval("document.querySelector('[data-key=go-gregorian]').click()");
  await page.sleep(250);
  h = await hero();
  check('תאריך לועזי (יום ראשון) עובר לשבת הבאה', h.title === 'פרשת צו' && h.chips.includes('שבת פרה'), JSON.stringify(h));

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
  check('תאריך עברי (ט״ו בניסן תשפ״ז) מוצא את פסח', h.title === 'פסח' && h.sub.includes('ט״ו בניסן תשפ״ז · 22 באפריל 2027'), JSON.stringify(h));

  // ארץ ישראל מול חוץ לארץ: שבועות שחל בשבת (12.6.2027)
  await page.eval("document.querySelector('[data-key=current]').click()");
  await page.sleep(200);
  await openPicker();
  await jump('2027-06-12');
  check('ארץ ישראל: שבת פרשת נשא', (await text('.hero-title')) === 'פרשת נשא');
  await page.eval("window.__alonimApp.state.setPref('diaspora', true)");
  await page.sleep(400);
  check('חוץ לארץ: אותה שבת היא שבועות', (await text('.hero-title')) === 'שבועות', await text('.hero-title'));
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
  check('חישוב הלוח העברי זהה ל-Intl של הדפדפן (150 שנה)', /^0\/\d+$/.test(intl) || intl === 'no-intl', String(intl));

  check('"השבוע" בלי שגיאות קונסול', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);
}

/**
 * חלון המסננים ב"כל העלונים": בחירה מרובה, תגיות, איפוס, טווחים והגדרות שמורות.
 * התוצאה מושווית לספירה נאיבית על הגיליונות שבאינדקס (לא על `search`).
 */
async function filterFlows(browser, open, check) {
  const page = await open('page=all');
  const brute = (predicate) => page.eval(`(() => {
    const idx = window.__alonimApp.index;
    let n = 0;
    for (let i = 0; i < idx.size; i++) { const it = idx.item(i); if (idx.vis[i] === 1 && (${predicate})(it)) n++; }
    return n;
  })()`);
  const shown = async () => Number((await page.eval("document.querySelector('.results-count').textContent")).replace(/[^\d]/g, ''));
  const click = (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const tick = async (group, value) => {
    await page.eval(`document.querySelector('[data-group="${group}"] input[value="${value}"]').click()`);
    await page.sleep(220);
  };

  await click('[data-key=filters]');
  await page.sleep(300);
  check('חלון מסננים נפתח עם קבוצות', await page.eval("document.querySelectorAll('.filter-group').length >= 10"));
  const total = await shown();

  // "או" בתוך מסנן, "וגם" בין מסננים
  const noach = 'noach';
  await tick('parasha', noach);
  await tick('parasha', 'bereshit');
  let expected = await brute(`(it) => it.parasha.includes('noach') || it.parasha.includes('bereshit')`);
  check('פרשה מרובה (או): הספירה בכותרת שווה לספירה נאיבית', (await shown()) === expected && expected > 0, `shown ${await shown()} expected ${expected}`);
  check('הכפתור בחלון מראה את אותו מספר', await page.eval(`document.querySelector('[data-key=done]').textContent.includes('${expected}')`));
  await tick('source', 'ladaat');
  await tick('source', 'tashma');
  expected = await brute(`(it) => (it.parasha.includes('noach') || it.parasha.includes('bereshit')) && it.assets.some((a) => a.src === 'ladaat' || a.src === 'tashma')`);
  check('פרשה (או) וגם מקור (או)', (await shown()) === expected, `shown ${await shown()} expected ${expected}`);
  await tick('lang', 'he');
  expected = await brute(`(it) => (it.parasha.includes('noach') || it.parasha.includes('bereshit')) && it.assets.some((a) => a.src === 'ladaat' || a.src === 'tashma') && it.lang === 'he'`);
  check('שלושה מסננים יחד', (await shown()) === expected, `shown ${await shown()} expected ${expected}`);

  // הספירה ליד ערך = מה שיתקבל אם בוחרים רק בו (בנוסף לשאר המסננים)
  const optCount = Number((await page.eval(`document.querySelector('[data-group="lang"] input[value="yi"]').closest('label').querySelector('.opt-count').textContent`)).replace(/[^\d]/g, ''));
  const yiExpected = await brute(`(it) => (it.parasha.includes('noach') || it.parasha.includes('bereshit')) && it.assets.some((a) => a.src === 'ladaat' || a.src === 'tashma') && it.lang === 'yi'`);
  check('הספירה ליד ערך שלא נבחר מדויקת', optCount === yiExpected, `shown ${optCount} expected ${yiExpected}`);

  // סגירה: תגיות פעילות
  await click('[data-key=done]');
  await page.sleep(300);
  check('תגית לכל ערך שנבחר', (await page.eval("document.querySelectorAll('.filter-tag').length")) === 5, String(await page.eval("document.querySelectorAll('.filter-tag').length")));
  await click('.filter-tag');
  await page.sleep(300);
  check('הסרת תגית מעדכנת את הרשימה', (await page.eval("document.querySelectorAll('.filter-tag').length")) === 4);

  // טווח תאריכים (לועזי)
  await click('[data-key=filters]');
  await page.sleep(300);
  await click('[data-key=reset]');
  await page.sleep(300);
  check('איפוס המסננים מחזיר לסך הכל', (await shown()) === total && (await page.eval("document.querySelectorAll('.filter-tag').length")) === 0, `shown ${await shown()} total ${total}`);
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
  expected = await brute("(it) => Boolean(it.date) && it.date >= '2026-03-01' && it.date <= '2026-06-30'");
  check('טווח תאריכים לועזי', (await shown()) === expected && expected > 0, `shown ${await shown()} expected ${expected}`);
  const caption = await page.eval("document.querySelector('[data-group=date] .range-caption').textContent");
  check('מתחת לתאריך מופיע התאריך העברי', /בניסן|באדר|בשבט|באייר|בסיוון/.test(caption), caption);
  // טווח עמודים
  await page.eval(`(() => {
    const group = document.querySelector('[data-group="pages"]');
    const [min] = group.querySelectorAll('input[type=number]');
    min.value = '20';
    min.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.sleep(300);
  expected = await brute("(it) => Boolean(it.date) && it.date >= '2026-03-01' && it.date <= '2026-06-30' && Math.max(0, ...it.assets.map((a) => a.pages || 0)) >= 20");
  check('תאריך וגם עמודים', (await shown()) === expected, `shown ${await shown()} expected ${expected}`);

  // הגדרה שמורה
  await page.eval(`(() => {
    const form = document.querySelector('.preset-form');
    form.hidden = false;
    form.querySelector('input').value = 'ניסיון';
    form.requestSubmit();
  })()`);
  await page.sleep(300);
  check('הגדרה נשמרה ומופיעה ברשימה', await page.eval("[...document.querySelectorAll('.preset-select option')].some((o) => o.textContent === 'ניסיון')"));
  await click('[data-key=reset]');
  await page.sleep(250);
  await page.eval(`(() => {
    const select = document.querySelector('.preset-select');
    select.value = [...select.options].find((o) => o.textContent === 'ניסיון').value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.sleep(350);
  check('החלת הגדרה שמורה משחזרת את המסננים', (await shown()) === expected, `shown ${await shown()} expected ${expected}`);
  await page.key('Escape');
  await page.sleep(250);

  // מצב הלשונית נשמר במעבר בין לשוניות
  await page.eval("window.__alonimApp.go('series')");
  await page.sleep(300);
  await page.eval("window.__alonimApp.go('all')");
  await page.sleep(400);
  check('המסננים נשמרים בחזרה ללשונית', (await page.eval("document.querySelectorAll('.filter-tag').length")) === 2 && (await shown()) === expected, `tags ${await page.eval("document.querySelectorAll('.filter-tag').length")}`);
  check('המסננים נשמרו גם באחסון', await page.eval("Boolean(window.__alonimApp.state.viewState('all') && window.__alonimApp.state.viewState('all').filters.pagesMin === 20)"));
  check('מסננים: בלי שגיאות קונסול', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);

  // 400px: החלון לא גולש
  const narrow = await open('page=all', undefined, 400);
  await narrow.eval("document.querySelector('[data-key=filters]').click()");
  await narrow.sleep(350);
  await narrow.eval("document.querySelectorAll('.filter-group').forEach((g) => (g.open = true))");
  await narrow.sleep(200);
  check('חלון מסננים ב-400px בלי גלישה אופקית', await narrow.eval("document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.dialog, .dialog-body')].every((n) => n.scrollWidth <= n.clientWidth + 1)"), await narrow.eval("document.documentElement.scrollWidth + ' > ' + window.innerWidth"));
  await browser.closePage(narrow);
}

/** מצב בחירה מרובה והיסטוריה. */
async function selectionFlows(browser, open, check) {
  const page = await open('page=all');
  const num = (expr) => page.eval(`Number(${expr})`);
  // קיבוץ: כותרת לכל קבוצה, וסכום הספירות שבכותרות שווה לסך התוצאות
  const groupTotal = await num("document.querySelector('.results-count').textContent.replace(/[^0-9]/g, '')");
  for (const kind of ['series', 'year', 'week', 'circle', 'lang']) {
    await page.eval(`(() => { const s = document.querySelector('.select-group'); s.value = '${kind}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.sleep(350);
    const sum = await num("[...document.querySelectorAll('.year-header .section-count')].reduce((n, c) => n + Number(c.textContent.replace(/[^0-9]/g, '')), 0)");
    const headers = await num("document.querySelectorAll('.year-header').length");
    check(`קיבוץ לפי ${kind}: כותרות לכל קבוצה`, headers >= 1, String(headers));
    if (kind === 'series') {
      // כל הקבוצות בגלילה: בודקים דרך האינדקס, כי רק חלק מהכותרות ב-DOM
      const inIndex = await num("window.__alonimApp.index.groupResults(window.__alonimApp.index.search('', {}, {}, {}).idx, 'series').reduce((n, g) => n + g.idx.length, 0)");
      check('קיבוץ: כל התוצאות בקבוצות', inIndex === groupTotal, `${inIndex}/${groupTotal}`);
    }
    check(`קיבוץ לפי ${kind}: DOM מוגבל`, (await num("document.querySelectorAll('.card').length")) <= 60 && sum <= groupTotal);
  }
  await page.eval("(() => { const s = document.querySelector('.select-group'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await page.sleep(300);
  check('ללא קיבוץ: אין כותרות', (await num("document.querySelectorAll('.year-header').length")) === 0);

  await page.eval("document.querySelector('[data-key=select-mode]').click()");
  await page.sleep(300);
  check('מצב בחירה: תיבות סימון בכרטיסים ושורת פעולות', (await num("document.querySelectorAll('.select-check').length")) > 3 && (await page.eval("!document.querySelector('.selection-bar').hidden")));
  const before = await num('window.__alonimApp.state.favoriteSnaps().length');
  await page.eval("[...document.querySelectorAll('.select-check')].slice(0, 3).forEach((b) => b.click())");
  await page.sleep(300);
  check('נבחרו שלושה', (await num('window.__alonimApp.selection.ids.size')) === 3 && (await page.eval("document.querySelector('.selection-count').textContent.includes('3')")));
  check('לחיצה על כרטיס במצב בחירה אינה פותחת צפיין', await page.eval("(document.querySelector('.card:not(.is-selected)').click(), document.querySelector('.viewer').hidden)"));
  await page.sleep(200);
  await page.eval("[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.includes('למועדפים')).click()");
  await page.sleep(300);
  check('"למועדפים" מוסיף את כל הנבחרים', await page.eval('window.__alonimApp.selectedItems().every((it) => window.__alonimApp.state.isFavorite(it.id))') && (await num('window.__alonimApp.state.favoriteSnaps().length')) >= before);
  await page.eval("[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.includes('בחירת כל התוצאות')).click()");
  await page.sleep(300);
  const total = await num("document.querySelector('.results-count').textContent.replace(/[^0-9]/g, '')");
  check('"בחירת כל התוצאות" בוחר את כולן', (await num('window.__alonimApp.selection.ids.size')) === total, String(total));
  await page.eval("[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.includes('העתקה כטקסט')).click()");
  await page.sleep(700);
  check('העתקה כטקסט מציגה הודעה', await page.eval("/הרשימה הועתקה|ההעתקה נכשלה/.test(document.body.innerText)"));
  await page.key('Escape');
  await page.sleep(300);
  check('Esc יוצא ממצב בחירה', (await page.eval("document.querySelector('.selection-bar').hidden")) && (await num("document.querySelectorAll('.select-check').length")) === 0);
  // היסטוריה: פתיחת גיליון נרשמת ומופיעה בלשונית
  await page.eval("window.__alonimApp.openIssue(window.__alonimApp.index.item(0))");
  await page.sleep(500);
  await page.eval("window.__alonimApp.closeViewer(); window.__alonimApp.view.mine.tab = 'history'; window.__alonimApp.go('mine')");
  await page.sleep(400);
  check('היסטוריה: גיליון שנפתח מופיע', (await num("document.querySelectorAll('.history-row').length")) >= 1);
  // מזהה גיליון שהשתנה (previousIds): מצב המשתמש עובר בעת סנכרון
  await page.eval(`(() => {
    const a = window.__alonimApp;
    const it = a.index.item(5);
    a.state.toggleFavorite({ ...it, id: 'i_legacy000001' });
    a.state.markRead({ ...it, id: 'i_legacy000001' }, true);
    a.onCatalogData({ kind: 'shard', id: 'recent', cached: true, data: [{ id: 'i_renamed00001', series: it.series, title: 'x', hy: 5787, assets: [{ src: 'ladaat', ext: '1' }], previousIds: ['i_legacy000001'] }] });
  })()`);
  check('previousIds: מועדף וקריאה עברו למזהה החדש', await page.eval("(() => { const s = window.__alonimApp.state; return s.isFavorite('i_renamed00001') && s.isRead('i_renamed00001') && !s.isFavorite('i_legacy000001') && !s.isRead('i_legacy000001'); })()"));
  check('היסטוריה: הסרת אירוע', await page.eval("(document.querySelector('.history-remove').click(), true)"));
  // פרטי גיליון: גיליונות קשורים וניווט בסדרה
  await page.eval("window.__alonimApp.go('all'); window.__alonimApp.showDetails(window.__alonimApp.index.item(window.__alonimApp.index.search('', {}, {}, { sort: 'date' }).idx[3]))");
  await page.sleep(700);
  const title1 = await page.eval("document.querySelector('.dialog-title').textContent");
  check('פרטים: "עוד גיליונות בסדרה" ו"אותה פרשה בשנים אחרות"', await page.eval("document.querySelectorAll('.details-related').length >= 1"));
  await page.eval("[...document.querySelectorAll('.details-more button')].find((b) => b.textContent.includes('הקודם בסדרה') || b.textContent.includes('הבא בסדרה')).click()");
  await page.sleep(700);
  const title2 = await page.eval("document.querySelector('.dialog-title').textContent");
  check('פרטים: מעבר לגיליון הסמוך בסדרה', Boolean(title1) && Boolean(title2) && (await page.eval("document.querySelectorAll('.dialog').length")) === 1, `${title1} -> ${title2}`);
  await page.eval("[...document.querySelectorAll('.details-more button')].find((b) => b.textContent.includes('העתקת השם')).click()");
  await page.sleep(600);
  check('פרטים: העתקת שם מציגה הודעה', await page.eval("/השם הועתק|ההעתקה נכשלה/.test(document.body.innerText)"));
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
  check('מארח חדש: קריאה מהמקור בלי הורדה ובלי כתיבה לתיקיית המשתמש', await page.eval("window.__sdk.fetchedFiles.length === 1 && window.__sdk.downloads.length === 0 && ![...window.__sdk.userFs.keys()].some((k) => k.includes('_קריאה'))"));
  check('מארח חדש: iframe ישיר על כתובת המארח (לא blob)', await page.eval("(() => { const f = document.querySelector('.viewer-frame'); return Boolean(f) && !f.src.startsWith('blob:') && f.src.length > 20; })()"));
  check('מארח חדש: כפתור תצוגה חלופית זמין', await page.eval("Boolean(document.querySelector('[data-key=alt-view]'))"));
  await page.eval("document.querySelector('[data-key=alt-view]').click()");
  await page.sleep(900);
  check('תצוגה חלופית: עוברת ל-Blob', await page.eval("document.querySelector('.viewer-frame').src.startsWith('blob:') && !document.querySelector('[data-key=alt-view]')"));
  await page.eval("window.__alonimApp.print(window.__alonimApp.viewer.item)");
  await page.sleep(900);
  await browser.closePage(page);

  page = await open('open=40&print=1&xorigin=1');
  await page.sleep(1500);
  check('מארח חדש: הדפסה מציגה כפתור "הדפסה" (לחיצה טרייה) במקום לקרוא בלי מחווה', await page.eval("Boolean(document.querySelector('.viewer-banner [data-key=print-now]')) && window.__sdk.printed.length === 0"));
  await page.eval("document.querySelector('[data-key=print-now]').click()");
  await page.sleep(500);
  check('מארח חדש: ui.printFile נקרא עם ה-token של הקובץ', await page.eval("window.__sdk.printed.length === 1 && window.__sdk.fileTokens.has(window.__sdk.printed[0].token) && Boolean(window.__sdk.printed[0].jobName)"));
  check('מארח חדש: לא נפתח דיאלוג הדרכה', await page.eval("!document.querySelector('.print-dialog')"));
  await browser.closePage(page);

  page = await open('open=40&print=1&xorigin=1&scenario=print-cancel');
  await page.sleep(1500);
  await page.eval("document.querySelector('[data-key=print-now]').click()");
  await page.sleep(500);
  check('הדפסה שבוטלה בדיאלוג המערכת: הודעה, בלי דיאלוג הדרכה', await page.eval("/ההדפסה בוטלה/.test(document.body.innerText) && !document.querySelector('.print-dialog')"));
  await browser.closePage(page);

  // ישן
  page = await open('open=40&host=legacy');
  await page.sleep(1500);
  check('מארח ישן: הורדה ל-_קריאה, בלי fetchFile', await page.eval("window.__sdk.fetchedFiles.length === 0 && window.__sdk.downloads.length === 1 && /_קריאה/.test(window.__sdk.downloads[0].destPath)"));
  check('מארח ישן: iframe על blob, בלי כפתור תצוגה חלופית', await page.eval("document.querySelector('.viewer-frame').src.startsWith('blob:') && !document.querySelector('[data-key=alt-view]')"));
  check('מארח ישן: אין קריאה לשיטות החדשות', await page.eval("!window.__sdk.calls.some((c) => c.method === 'network.fetchFile' || c.method === 'ui.printFile')"));
  await browser.closePage(page);

  // הדפסה מרובה: מארח חדש מציע, מארח ישן לא
  page = await open('page=all');
  await page.eval("document.querySelector('[data-key=select-mode]').click()");
  await page.sleep(250);
  await page.eval("[...document.querySelectorAll('.select-check')].slice(0, 2).forEach((b) => b.click())");
  await page.sleep(250);
  check('הדפסה מרובה: כפתור בשורת הבחירה (מארח חדש)', await page.eval("[...document.querySelectorAll('.selection-bar button')].some((b) => b.textContent.trim() === 'הדפסה')"));
  await page.eval("[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.trim() === 'הדפסה').click()");
  await page.sleep(300);
  await page.eval("document.querySelector('.dialog [data-key=all]').click()");
  await page.sleep(2200);
  check('הדפסה ברצף: שני הגיליונות נשלחו, בלי הורדה', await page.eval("window.__sdk.printed.length === 2 && window.__sdk.downloads.length === 0"), String(await page.eval('window.__sdk.printed.length')));
  check('הדפסה ברצף: סטטוס "הודפס" לכל גיליון', await page.eval("document.querySelectorAll('.dialog .queue-row.is-done').length === 2"));
  await browser.closePage(page);
  page = await open('page=all&host=legacy');
  await page.eval("document.querySelector('[data-key=select-mode]').click()");
  await page.sleep(250);
  await page.eval("document.querySelector('.select-check').click()");
  await page.sleep(250);
  check('הדפסה מרובה: אין כפתור במארח ישן', await page.eval("![...document.querySelectorAll('.selection-bar button')].some((b) => b.textContent.trim() === 'הדפסה')"));
  check('מסלולי המארח: בלי שגיאות קונסול', page.errors.length === 0, page.errors.join('\n'));
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
  const check = (name, ok, detail) => (ok ? console.log('✔ flow: ' + name) : fail('flow: ' + name, detail || 'failed'));

  // חיפוש מיידי + Ctrl+/ + Esc
  let page = await open('page=week');
  await page.key('/', 2, 'Slash');
  await page.sleep(300);
  check('Ctrl+/ עובר לחיפוש וממקד', await page.eval("document.querySelector('.main-tab[aria-selected=true]').dataset.tab === 'all' && document.activeElement.classList.contains('search-input')"));
  await page.type('נח');
  await page.sleep(200);
  check('הקלדה מסננת', await page.eval("parseInt(document.querySelector('.results-count').textContent, 10) >= 8"), await page.eval("document.querySelector('.results-count').textContent"));
  check('הדגשת התאמה', await page.eval("document.querySelectorAll('mark.hit').length > 0"));
  await page.key('Escape');
  await page.sleep(200);
  check('Esc מנקה חיפוש', await page.eval("document.querySelector('.search-input').value === ''"));

  // פריסה עברית: ל על המקש הפיזי K. Ctrl+K אינו חיפוש (באוצריא הוא "החלף שולחן עבודה"); קיצורי הכרטיס לפי המקש הפיזי.
  await page.eval('document.activeElement.blur()');
  await page.key('ל', 2, 'KeyK');
  await page.sleep(200);
  check('Ctrl+K (גם בפריסה עברית) אינו תופס את המיקוד', await page.eval("!document.activeElement.classList.contains('search-input')"));
  await page.eval("document.querySelector('.search-input').focus()");
  await page.key('ArrowDown');
  await page.sleep(150);
  await page.key('ם', 0, 'KeyP');
  await page.sleep(500);
  check('קיצור P בפריסה עברית מדפיס (דיאלוג או צפיין)', await page.eval("!document.querySelector('.viewer').hidden || Boolean(document.querySelector('.print-dialog'))"), await page.eval('document.activeElement.className'));
  await page.eval('window.__alonimApp.closeViewer && window.__alonimApp.closeViewer(); Array.from(document.querySelectorAll(".dialog-actions button")).forEach((b) => b.click())');
  await page.sleep(300);

  // ניווט מקלדת ברשימה: חץ מטה מהשדה לכרטיס הראשון, Enter פותח צפיין, Esc חוזר
  await page.eval("document.querySelector('.search-input').focus()");
  await page.key('ArrowDown');
  await page.sleep(150);
  check('חץ מטה ממקד כרטיס', await page.eval("document.activeElement.classList.contains('card')"));
  await page.key('ArrowLeft');
  await page.sleep(100);
  check('חץ בין כרטיסים (RTL: שמאלה = הבא)', await page.eval("document.activeElement.dataset.item === '1'"), await page.eval('document.activeElement.className'));
  await page.key('Enter');
  await page.sleep(900);
  check('Enter פותח צפיין עם iframe', await page.eval("!document.querySelector('.viewer').hidden && Boolean(document.querySelector('.viewer-frame'))"));
  await page.key('Escape');
  await page.sleep(250);
  check('Esc סוגר צפיין וחוזר לרשימה', await page.eval("document.querySelector('.viewer').hidden && document.querySelectorAll('.card').length > 0"));
  check('בלי שגיאות קונסול בזרימה', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);

  await weekFlows(browser, open, check);
  await filterFlows(browser, open, check);
  await selectionFlows(browser, open, check);

  // לחיצה על כרטיס = קריאה; הורדה = שמירה קבועה ומצב "הורד" מהדיסק
  page = await open('page=all');
  const before = await page.eval("window.__sdk.userFs.size");
  await page.click('.card:not(:has(.chip-done)) .card-actions .icon-button');
  await page.sleep(1500);
  check('כפתור הורדה שומר לתיקייה', (await page.eval('window.__sdk.userFs.size')) === before + 1, 'size ' + (await page.eval('window.__sdk.userFs.size')));
  check('המצב "הורד" מופיע בכרטיס', await page.eval("document.querySelectorAll('.card .chip-done').length >= 6"));
  const pathOk = await page.eval("[...window.__sdk.userFs.keys()].some((k) => /\\/\\d{4}\\/[^/]+\\/[^/]+ \\[[0-9a-f]{8}\\]\\.pdf$/.test(k) && !k.includes('/_קריאה/'))");
  check('נתיב שנה/סדרה/קובץ', pathOk);
  await page.click('.card .card-title');
  await page.sleep(900);
  check('לחיצה על כרטיס פותחת לקריאה', await page.eval("!document.querySelector('.viewer').hidden"));
  await browser.closePage(page);

  // הדפסה: iframe חסום ב-WebView האמיתי → דיאלוג עם מסלול קורא אוצריא
  page = await open('open=0&print=1&xorigin=1&host=legacy');
  await page.sleep(2200);
  check('הדפסה: דיאלוג עם מסלול הקורא וההנחיה', await page.eval("document.querySelector('.print-dialog') && document.querySelector('.print-guide')"));
  await page.click('.print-dialog [data-key=reader]');
  await page.sleep(1500);
  check('פתיחה בקורא של אוצריא (מדומה)', (await page.eval("window.__sdk.calls.some((c) => c.method === 'reader.openBook')")) === true);
  await browser.closePage(page);

  await hostFlows(browser, open, check);

  // כללים: "הסתר סדרה" מכרטיס, ביטול (Undo)
  page = await open('page=all');
  const total = await page.eval("Number(document.querySelector('.results-count').textContent.replace(/\\D/g, ''))");
  await page.eval("window.__alonimApp.hideSeries(window.__alonimApp.index.item(window.__alonimApp.index.search('', {}, {}, {}).idx[0]))");
  await page.sleep(400);
  const after = await page.eval("Number(document.querySelector('.results-count').textContent.replace(/\\D/g, ''))");
  check('הסתר סדרה מקטין את הרשימה', after < total, total + ' → ' + after);
  await page.click('.toast-action');
  await page.sleep(400);
  check('ביטול מחזיר את הסדרה', (await page.eval("Number(document.querySelector('.results-count').textContent.replace(/\\D/g, ''))")) === total);
  await browser.closePage(page);

  // גלישה אופקית ב-400px בכל המסכים
  for (const q of ['page=week', 'page=all', 'page=series', 'series=0', 'page=mine', 'page=settings&section=rules', 'details=0', 'open=0']) {
    page = await open(q, small, 400);
    const overflow = await page.eval("(() => { const w = innerWidth; const bad = []; for (const n of document.querySelectorAll('body *')) { const r = n.getBoundingClientRect(); if (r.width > 0 && (r.right > w + 1 || r.left < -1) && !n.closest('.vlist, .main-tabs, .viewer-frame, .menu, .toasts') && getComputedStyle(n).position !== 'fixed') bad.push(n.className + ':' + Math.round(r.left) + '-' + Math.round(r.right)); } return bad.slice(0, 5); })()");
    check('400px בלי גלישה: ' + q, overflow.length === 0, overflow.join(' | '));
    check('400px בלי שגיאות: ' + q, page.errors.length === 0, page.errors.join('\n'));
    await browser.closePage(page);
  }

  // גלילה וירטואלית: 30,000+ גיליונות, לעולם לא יותר מ-60 כרטיסים ב-DOM
  page = await open('page=all', large);
  await page.waitFor("window.__alonimApp.catalog.status.shardsLoaded >= window.__alonimApp.catalog.status.shardsTotal && window.__alonimApp.catalog.status.phase === 'idle'", 60000);
  await page.sleep(600);
  const info =await page.eval("({ n: Number(document.querySelector('.results-count').textContent.replace(/\\D/g, '')), dom: document.querySelectorAll('[data-item]').length })");
  check('30K+ תוצאות, DOM מוגבל', info.n >= 30000 && info.dom > 0 && info.dom <= 60, JSON.stringify(info));
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
  check('חיפוש על 30K+ ממשיך להגביל DOM', (await page.eval("document.querySelectorAll('[data-item]').length")) <= 60);
  check('חיפוש על 30K+ בלי שגיאות', page.errors.length === 0, page.errors.join('\n'));
  await browser.closePage(page);
}

const browser = await Browser.launch();
try {
  // תרחישים במקביל (עד 4 דפים בכל פעם).
  const jobs = [];
  for (const scenario of scenarios) {
    for (const [suffix, include] of modes) if (include(scenario[0])) jobs.push(() => runScenario(browser, scenario, suffix));
  }
  // מסכים מרכזיים גם בצר.
  for (const name of ['week', 'all', 'series-page', 'settings', 'details']) {
    const s = scenarios.find((x) => x[0] === name);
    jobs.push(() => runScenario(browser, s, '', small, 400));
  }
  let next = 0;
  await Promise.all(Array.from({ length: Number(process.env.SMOKE_PARALLEL || 1) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await job();
      } catch (error) {
        fail('job', error.message);
      }
    }
  }));
  await flows(browser);
  // כל מחלקה שהופיעה ב-DOM מעוצבת (או שהיא סימון בלבד).
  const MARKERS = new Set(['visually-hidden', 'week-page', 'all-page', 'mine-page', 'settings-page', 'builder-host', 'select-sort', 'select-value', 'results-list', 'series-list', 'series-issues', 'live-region', 'is-unread', 'dialog-close']);
  const unstyled = [...seenClasses.keys()].filter((c) => !styled.has(c) && !MARKERS.has(c));
  if (unstyled.length) fail('classes', 'מחלקות ב-DOM בלי עיצוב: ' + unstyled.map((c) => c + '(' + seenClasses.get(c) + ')').join(', '));
  else console.log('✔ כל המחלקות שבשימוש מעוצבות (' + seenClasses.size + ')');
} finally {
  await browser.close();
}
if (failures) {
  console.error(failures + ' בדיקות נכשלו');
  process.exit(1);
}
console.log('הכול עבר');
