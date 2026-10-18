// מצלם את כל המסכים, בהיר וכהה, ברוחב דסקטופ ובטלפון (400px).
//   node tools/preview/screenshots.mjs [out-dir]     (SHOTS=week,all לחלק מהמסכים)
//   MODES=light  — מצב אחד בלבד; FLAT=1 — בלי סיומת -light בשם הקובץ (docs/img למדריך)
//   WIDTHS=1200,800,480 — כל מסך בכל אחד מהרוחבים (שם הקובץ name@רוחב-מצב), בלי narrow-*
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Browser } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] || join(here, 'out', 'shots'));
mkdirSync(outDir, { recursive: true });
execFileSync(process.execPath, [join(here, 'build-preview.mjs'), '--large', '--wheel'], {
  stdio: 'ignore',
});
const small = pathToFileURL(join(here, 'out', 'preview.html')).href;
const large = pathToFileURL(join(here, 'out', 'preview-large.html')).href;
// שמונה שנים של עלונים מומצאים: הגלגל והספירות נראים כמו בקטלוג אמיתי
const wheel = pathToFileURL(join(here, 'out', 'preview-wheel.html')).href;

const q = encodeURIComponent;
// [שם, שאילתה, רוחב, גובה, preview, קוד שרץ בדף לפני הצילום]
const app = 'window.__alonimApp';
const open = (selector) => `document.querySelector('${selector}').click()`;
const shots = [
  ['week', 'page=week', 1000, 820],
  ['week-skeleton', 'page=week&seed=0&netdelay=3000&settle=100', 1000, 620],
  ['week-offline-cached', 'scenario=offline&page=week&warm=1&settle=2500', 1000, 620],
  ['week-blocked', 'scenario=blocked&page=week&seed=0', 1000, 620],
  ['week-empty-folder', 'page=week&seed=0&nofolder=1', 1000, 760],
  ['all', 'page=all', 1000, 820],
  ['all-list', 'page=all&view=list', 1000, 820],
  ['all-query', 'page=all&query=' + q('אסיפת נח'), 1000, 640],
  ['all-none', 'page=all&query=' + q('זזזזז'), 1000, 560],
  ['all-large', 'page=all', 1000, 820, large],
  ['cycle', 'page=cycle&warm=1&settle=2500', 1000, 900, wheel],
  ['cycle-topic', 'topic=p:noach&warm=1&settle=2500', 1000, 820, wheel],
  [
    'cycle-topic-combined',
    'topic=p:nitzavim&topicmode=combined&warm=1&settle=2500',
    1000,
    820,
    wheel,
  ],
  ['cycle-event', 'topic=e:purim&warm=1&settle=2500', 1000, 760, wheel],
  ['narrow-cycle', 'page=cycle&warm=1&settle=2500', 400, 800, wheel],
  ['narrow-cycle-topic', 'topic=p:noach&warm=1&settle=2500', 400, 800, wheel],
  ['series', 'page=series', 1000, 760],
  ['series-page', 'series=0', 1000, 760],
  ['mine-favorites', 'page=mine', 1000, 620],
  ['mine-lists', 'page=mine&minetab=lists', 1000, 620],
  ['mine-shabbat', 'page=mine&minetab=shabbat', 1000, 720],
  ['mine-downloads', 'page=mine&minetab=downloads', 1000, 720],
  ['settings', 'page=settings&section=rules', 1000, 1500],
  ['settings-backup', 'page=settings&section=backup', 1000, 1100],
  ['details', 'details=0', 1000, 820],
  ['viewer', 'open=0', 1000, 700],
  ['viewer-loading', 'open=40&dldelay=4000', 1000, 520],
  ['viewer-blocked', 'scenario=download-blocked&open=40', 1000, 520],
  ['viewer-nofolder', 'open=0&nofolder=1', 1000, 520],
  ['print-dialog', 'open=0&print=1&xorigin=1', 1000, 760],
  ['narrow-week', 'page=week', 400, 800],
  ['narrow-all', 'page=all', 400, 800],
  ['narrow-series', 'page=series', 400, 800],
  ['narrow-series-page', 'series=0', 400, 800],
  ['narrow-mine', 'page=mine', 400, 800],
  ['narrow-settings', 'page=settings&section=rules', 400, 1300],
  ['narrow-details', 'details=0', 400, 800],
  ['narrow-viewer', 'open=0', 400, 800],
  [
    'week-holiday',
    'page=week',
    1000,
    760,
    null,
    `${app}.view.weekDate = '2027-03-23'; ${app}.go('week')`,
  ],
  [
    'week-future',
    'page=week',
    1000,
    760,
    null,
    `${app}.view.weekDate = '2027-02-06'; ${app}.go('week')`,
  ],
  ['week-picker', 'page=week', 1000, 820, null, open('[data-key=jump]')],
  [
    'filters-panel',
    'page=all',
    1000,
    860,
    null,
    `${open('[data-key=filters]')}; setTimeout(() => document.querySelectorAll('[data-group=parasha], [data-group=lang]').forEach((g) => (g.open = true)), 50)`,
  ],
  [
    'filters-active',
    'page=all',
    1000,
    820,
    null,
    `${app}.view.all.filters = { lang: ['he'], source: ['ladaat', 'tashma'], parasha: ['noach', 'bereshit'], pagesMin: 4 }; ${app}.go('series'); ${app}.go('all')`,
  ],
  [
    'all-grouped',
    'page=all',
    1000,
    820,
    null,
    `${app}.view.all.group = 'series'; ${app}.go('series'); ${app}.go('all')`,
  ],
  [
    'select-mode',
    'page=all',
    1000,
    820,
    null,
    `${open('[data-key=select-mode]')}; setTimeout(() => [...document.querySelectorAll('.select-check')].slice(0, 3).forEach((b) => b.click()), 80)`,
  ],
  [
    'mine-history',
    'page=mine&minetab=history',
    1000,
    760,
    null,
    `[1, 4, 7].forEach((n) => ${app}.state.logEvent(['opened', 'read', 'downloaded'][n % 3], ${app}.index.item(n))); ${app}.go('series'); ${app}.go('mine')`,
  ],
  ['settings-general', 'page=settings&section=general', 1000, 900],
  ['settings-storage', 'page=settings&section=disk', 1000, 1000],
  ['settings-diagnostics', 'page=settings&section=diagnostics', 1000, 1100],
  ['settings-diagnostics-legacy', 'page=settings&section=diagnostics&host=legacy', 1000, 1100],
  ['settings-help', 'page=settings&section=help', 1000, 1000],
  ['welcome', 'welcome=1', 1000, 620],
  ['viewer-print-ready', 'open=40&print=1&xorigin=1&scenario=print-gesture-first', 1000, 620],
  ['narrow-picker', 'page=week', 400, 800, null, open('[data-key=jump]')],
  ['narrow-filters', 'page=all', 400, 860, null, open('[data-key=filters]')],
  ['scaled', 'page=all&scale=1.5', 1000, 820],
  ['english', 'page=week&lang=en', 1000, 760],
];

const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
const widths = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : null;
const plan = widths
  ? shots
      .filter(([name]) => !name.startsWith('narrow-'))
      .flatMap((shot) => widths.map((w) => [shot, w]))
  : shots.map((shot) => [shot, null]);
const browser = await Browser.launch();
try {
  const modes = process.env.MODES ? process.env.MODES.split(',') : ['light', 'dark'];
  for (const [[name, query, shotWidth, height, base, after], forced] of plan) {
    if (only && !only.includes(name)) continue;
    const width = forced || shotWidth;
    for (const mode of modes) {
      const page = await browser.newPage(width, height);
      await page.goto(`${base || small}?today=2026-10-15&${query}&mode=${mode}`);
      await page
        .waitFor("document.documentElement.dataset.previewReady === '1'", 20000)
        .catch(() => {});
      await page.sleep(
        name.includes('skeleton') || name.includes('loading')
          ? 100
          : name.includes('print')
            ? 1400
            : 400,
      );
      if (after) {
        await page.eval(after);
        await page.sleep(600);
      }
      const label = forced ? `${name}@${forced}` : name;
      const file = join(outDir, process.env.FLAT ? `${label}.png` : `${label}-${mode}.png`);
      await page.screenshot(file);
      if (page.errors.length)
        console.error('✖ ' + name + ' ' + mode + ': ' + page.errors.join(' | '));
      console.log(file);
      await browser.closePage(page);
    }
  }
} finally {
  await browser.close();
}
