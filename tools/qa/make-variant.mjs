// בונה עותק QA של התוסף שפונה לשרת המקומי (tools/qa/qa-server.mjs) במקום לרשת:
//   node tools/qa/make-variant.mjs <out-dir> [--port 39811]
// העותק משתמש ב-network.localhost (בלי allowlist גלובלי), ומחליף כתובות בקוד.
import { cp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const out = resolve(process.argv[2] || 'tools/qa/out/plugin');
const pi = process.argv.indexOf('--port');
const port = pi > 0 ? process.argv[pi + 1] : '39811';
const origin = `http://127.0.0.1:${port}`;

await rm(out, { recursive: true, force: true });
await cp('plugin', out, { recursive: true, filter: (src) => !/[\\/]test([\\/]|$)/.test(src) });

const manifestPath = join(out, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.id = 'com.otzaria-alonim.qa';
manifest.name = process.argv.includes('--name') ? process.argv[process.argv.indexOf('--name') + 1] : 'עלוני שבת QA';
manifest.contributes.toolTab.title = manifest.name;
manifest.permissions = manifest.permissions.map((p) => (p === 'network.access' ? 'network.localhost' : p));
manifest.network = { enabled: true, allowlist: ['127.0.0.1'] };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const corePath = join(out, 'js', 'alonim-core.js');
let core = await readFile(corePath, 'utf8');
const sub = (re, to) => {
  if (!re.test(core)) throw new Error(`pattern not found: ${re}`);
  core = core.replace(re, to);
};
sub(/const CATALOG_BASE = '[^']+';/, `const CATALOG_BASE = '${origin}/data/';`);
sub(/const FILE_PREFIXES = Object\.freeze\(\[[\s\S]*?\]\);/, `const FILE_PREFIXES = Object.freeze(['${origin}/files']);`);
sub(
  /return Boolean\(\s*u\s*&&\s*u\.protocol === 'https:'\s*&&\s*!u\.username\s*&&\s*!u\.password\s*&&\s*isPublicHost\(u\.hostname\),?\s*\);/,
  `return Boolean(u && (u.origin === '${origin}' || (u.protocol === 'https:' && !u.username && !u.password && isPublicHost(u.hostname))));`,
);
await writeFile(corePath, core);
console.log(`QA variant written to ${out} (id ${manifest.id}, server ${origin})`);

// פרוב QA (יומן קונסול, תזמונים, הרצת JS מרחוק): נכנס רק לעותק, לא למוצר.
if (!process.argv.includes('--no-probe')) {
  const probe = (await readFile(new URL('./qa-probe.js', import.meta.url), 'utf8')).replace('__PORT__', port);
  await writeFile(join(out, 'js', 'qa-probe.js'), probe);
  const indexPath = join(out, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  if (!html.includes('<script src="js/alonim-i18n.js">')) throw new Error('index.html script anchor not found');
  await writeFile(indexPath, html.replace('<script src="js/alonim-i18n.js">', '<script src="js/qa-probe.js"></script>\n    <script src="js/alonim-i18n.js">'));
  console.log('probe injected');
}
