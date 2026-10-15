// צילום מסך אחד, לעבודה שוטפת על העיצוב:
//   node tools/preview/shot.mjs "page=all&mode=dark" out.png [1000x720] [--large]
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Browser } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [query, file, size] = process.argv.slice(2);
const large = process.argv.includes('--large');
const real = process.argv.includes('--real');
execFileSync(process.execPath, [join(here, 'build-preview.mjs'), ...(large ? ['--large'] : [])], { stdio: 'ignore' });
const [width, height] = (size && /^\d+x\d+$/.test(size) ? size : '1000x720').split('x').map(Number);
const browser = await Browser.launch();
try {
  const page = await browser.newPage(width, height);
  const html = real ? 'preview-real.html' : large ? 'preview-large.html' : 'preview.html';
  await page.goto(pathToFileURL(join(here, 'out', html)).href + '?today=2026-10-15&' + (query || ''));
  await page.sleep(Number(process.env.SETTLE || 1800));
  // SHOT_EVAL: קוד שרץ בדף לפני הצילום (למשל פתיחת חלון).
  if (process.env.SHOT_EVAL) {
    await page.eval(process.env.SHOT_EVAL);
    await page.sleep(600);
  }
  await page.screenshot(resolve(file || join(here, 'out', 'shot.png')));
  if (page.errors.length) console.error('ERRORS:\n' + page.errors.join('\n'));
} finally {
  await browser.close();
}
