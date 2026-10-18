// בדיקת נגישות מלאה עם axe-core (מעבר לבדיקות המהירות של a11y.mjs), בדפדפן אמיתי, בהיר וכהה, רחב וצר.
// axe-core אינו תלות של הריפו: מורידים אותו לתיקיית זמני ומצביעים עליו.
//   npm pack axe-core            # בתיקייה זמנית; ואז: tar xzf axe-core-*.tgz
//   AXE_CORE=<תיקייה>/package/axe.min.js node tools/preview/axe.mjs [scenario ...]
// בלי ארגומנטים: מסכי הבית, מעגל השנה (גלגל ודפי נושא), כל העלונים, סדרות ודף סדרה. מסיים בקוד 1 על הפרה.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Browser } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let axePath = process.env.AXE_CORE || '';
if (!axePath) {
  try {
    axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
  } catch (error) {
    axePath = '';
  }
}
if (!axePath || !existsSync(axePath)) {
  console.error(
    'axe-core לא נמצא. הורידו אותו (npm pack axe-core, ופתיחה) והצביעו עליו: AXE_CORE=<נתיב>/axe.min.js',
  );
  process.exit(2);
}
const axeSource = readFileSync(axePath, 'utf8');
execFileSync(process.execPath, [join(here, 'build-preview.mjs')], { stdio: 'ignore' });
const base = pathToFileURL(join(here, 'out', 'preview.html')).href;
const scenarios = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'page=week',
      'page=cycle',
      'topic=p:noach',
      'topic=p:nitzavim&topicmode=combined',
      'topic=e:purim',
      'page=all',
      'page=series',
      'series=0',
    ];

const browser = await Browser.launch();
let total = 0;
try {
  for (const mode of ['light', 'dark']) {
    for (const width of [1000, 420]) {
      for (const query of scenarios) {
        const page = await browser.newPage(width, 800);
        await page.goto(`${base}?today=2026-10-15&${query}&mode=${mode}`);
        await page
          .waitFor("document.documentElement.dataset.previewReady === '1'", 20000)
          .catch(() => {});
        await page.sleep(1200);
        await page.eval(axeSource);
        const found = await page.eval(`(async () => {
          const result = await axe.run(document, { resultTypes: ['violations'] });
          return result.violations.map((v) => v.id + ' (' + v.impact + '): ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '));
        })()`);
        total += found.length;
        console.log(
          (found.length ? '✖ ' : '✔ ') +
            mode +
            ' ' +
            width +
            ' ' +
            query +
            (found.length ? '\n   ' + found.join('\n   ') : ''),
        );
        await browser.closePage(page);
      }
    }
  }
} finally {
  await browser.close();
}
console.log('axe: ' + total + ' הפרות');
if (total) process.exit(1);
