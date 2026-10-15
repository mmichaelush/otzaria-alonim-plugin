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
  ['settings', 'page=settings', "document.querySelectorAll('.settings-card').length >= 8"],
  ['settings-rules', 'page=settings&section=rules', "document.querySelector('.rule-form')"],
  ['settings-backup', 'page=settings&section=backup', "document.querySelector('.code-area')"],
  ['details', 'details=0', "document.querySelector('.dialog .asset-list')"],
  ['viewer', 'open=0', "document.querySelector('.viewer-frame')"],
  ['viewer-nofolder', 'open=0&nofolder=1', "document.querySelector('.viewer .state-card')"],
  ['viewer-print', 'open=0&print=1&xorigin=1', "document.querySelector('.print-dialog')"],
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

  // חיפוש מיידי + Ctrl+K + Esc
  let page = await open('page=week');
  await page.key('k', 2);
  await page.sleep(300);
  check('Ctrl+K עובר לחיפוש וממקד', await page.eval("document.querySelector('.main-tab[aria-selected=true]').dataset.tab === 'all' && document.activeElement.classList.contains('search-input')"));
  await page.type('נח');
  await page.sleep(200);
  check('הקלדה מסננת', await page.eval("document.querySelector('.results-count').textContent.includes('12')"), await page.eval("document.querySelector('.results-count').textContent"));
  check('הדגשת התאמה', await page.eval("document.querySelectorAll('mark.hit').length > 0"));
  await page.key('Escape');
  await page.sleep(200);
  check('Esc מנקה חיפוש', await page.eval("document.querySelector('.search-input').value === ''"));

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
  page = await open('open=0&print=1&xorigin=1');
  await page.sleep(900);
  check('הדפסה: דיאלוג עם מסלול הקורא וההנחיה', await page.eval("document.querySelector('.print-dialog') && document.querySelector('.print-guide')"));
  await page.click('.print-dialog [data-key=reader]');
  await page.sleep(1500);
  check('פתיחה בקורא של אוצריא (מדומה)', (await page.eval("window.__sdk.calls.some((c) => c.method === 'reader.openBook')")) === true);
  await browser.closePage(page);

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
  const info = await page.eval("({ n: Number(document.querySelector('.results-count').textContent.replace(/\\D/g, '')), dom: document.querySelectorAll('[data-item]').length })");
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
