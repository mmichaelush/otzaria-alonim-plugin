// מצלם את כל המסכים, בהיר וכהה, ברוחב דסקטופ ובטלפון (400px).
//   node tools/preview/screenshots.mjs [out-dir]     (SHOTS=week,all לחלק מהמסכים)
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Browser } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] || join(here, 'out', 'shots'));
mkdirSync(outDir, { recursive: true });
execFileSync(process.execPath, [join(here, 'build-preview.mjs'), '--large'], { stdio: 'ignore' });
const small = pathToFileURL(join(here, 'out', 'preview.html')).href;
const large = pathToFileURL(join(here, 'out', 'preview-large.html')).href;

const q = encodeURIComponent;
// [שם, שאילתה, רוחב, גובה, preview]
const shots = [
  ['week', 'page=week', 1000, 820],
  ['week-skeleton', 'page=week&seed=0&netdelay=3000&settle=100', 1000, 620],
  ['week-offline-cached', 'scenario=offline&page=week&warm=1', 1000, 620],
  ['week-blocked', 'scenario=blocked&page=week&seed=0', 1000, 620],
  ['week-empty-folder', 'page=week&seed=0&nofolder=1', 1000, 760],
  ['all', 'page=all', 1000, 820],
  ['all-list', 'page=all&view=list', 1000, 820],
  ['all-query', 'page=all&query=' + q('אסיפת נח'), 1000, 640],
  ['all-none', 'page=all&query=' + q('זזזזז'), 1000, 560],
  ['all-large', 'page=all', 1000, 820, large],
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
  ['scaled', 'page=all&scale=1.5', 1000, 820],
  ['english', 'page=week&lang=en', 1000, 760],
];

const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
const browser = await Browser.launch();
try {
  for (const [name, query, width, height, base] of shots) {
    if (only && !only.includes(name)) continue;
    for (const mode of ['light', 'dark']) {
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
      const file = join(outDir, `${name}-${mode}.png`);
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
