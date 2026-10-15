// מריץ ביטוי JS בדף התצוגה המקדימה ומדפיס את התוצאה, השגיאות והיומן: לדיבוג.
//   node tools/preview/eval.mjs "page=all&lang=en" "document.title" [400x700] [--large]
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Browser } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [query, expression, size] = process.argv.slice(2);
const large = process.argv.includes('--large');
const real = process.argv.includes('--real');
execFileSync(process.execPath, [join(here, 'build-preview.mjs'), ...(large ? ['--large'] : [])], { stdio: 'ignore' });
const [width, height] = (size && /^\d+x\d+$/.test(size) ? size : '1000x760').split('x').map(Number);
const browser = await Browser.launch();
try {
  const page = await browser.newPage(width, height);
  await page.goto(pathToFileURL(join(here, 'out', real ? 'preview-real.html' : large ? 'preview-large.html' : 'preview.html')).href + '?today=2026-10-15&' + query);
  await page.waitFor("document.documentElement.dataset.previewReady === '1'", 20000).catch(() => console.log('(preview not ready)'));
  await page.sleep(300);
  console.log(JSON.stringify(await page.eval(expression), null, 2));
  if (page.errors.length) console.log('ERRORS:\n' + page.errors.join('\n'));
  if (process.env.LOGS) console.log('LOGS:\n' + page.logs.join('\n'));
} finally {
  await browser.close();
}
