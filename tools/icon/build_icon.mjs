// מצלם את tools/icon/icon.html ל-plugin/icon/icon.png (64x64, רקע שקוף), בדפדפן headless.
//   node tools/icon/build_icon.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { Browser } from '../preview/cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'plugin', 'icon', 'icon.png');
mkdirSync(dirname(out), { recursive: true });
const browser = await Browser.launch();
try {
  const page = await browser.newPage(64, 64, 1);
  await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await page.goto(pathToFileURL(join(here, 'icon.html')).href);
  await page.screenshot(out, { clip: { x: 0, y: 0, width: 64, height: 64, scale: 1 } });
  console.log(out);
} finally {
  await browser.close();
}
