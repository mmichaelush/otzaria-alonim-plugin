// בונה tools/preview/out/preview.html (וגם preview-large.html) מתוך plugin/index.html
// האמיתי, עם הגשר המדומה והקטלוג המקומי. כך התצוגה המקדימה היא תמיד הדף שנשלח.
//
//   node tools/preview/build-preview.mjs [--large] [--catalog dir]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', '..', 'plugin');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const args = process.argv.slice(2);
execFileSync(process.execPath, [join(here, 'make-fixture.mjs'), ...args], { stdio: 'ignore' });

const toPlugin = relative(out, plugin).replaceAll('\\', '/');
const stub = readFileSync(join(here, 'stub.js'), 'utf8');
const fake = readFileSync(join(here, 'fake-sdk.js'), 'utf8');

function build(name, fixtureFile) {
  const html = readFileSync(join(plugin, 'index.html'), 'utf8')
    .replaceAll('href="css/', `href="${toPlugin}/css/`)
    .replaceAll('src="js/', `src="${toPlugin}/js/`)
    .replaceAll('src="i18n/', `src="${toPlugin}/i18n/`)
    .replace(
      '<link rel="stylesheet"',
      `<script src="${fixtureFile}"></script>\n    <script>${fake}</script>\n    <script>${stub}</script>\n    <link rel="stylesheet"`,
    );
  writeFileSync(join(out, name), html);
  return join(out, name);
}

const real = args.includes('--catalog');
if (real) console.log(build('preview-real.html', 'fixture-real.js'));
else console.log(build('preview.html', 'fixture-small.js'));
if (args.includes('--large')) console.log(build('preview-large.html', 'fixture-large.js'));
