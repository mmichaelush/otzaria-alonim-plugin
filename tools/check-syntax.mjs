// `node --check` על כל קובץ JS של התוסף והכלים (כמו שמוגדר ב-AGENTS.md לפני קומיט).
//   node tools/check-syntax.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'out', 'fixtures', '.git']);

function files(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...files(full));
    else if (/\.(?:js|mjs|cjs)$/.test(name)) found.push(full);
  }
  return found;
}

let failed = 0;
const targets = ['plugin/js', 'plugin/i18n', 'plugin/test', 'tools/preview', 'tools/icon'].flatMap(
  (d) => files(join(root, d)),
);
for (const file of targets) {
  const run = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (run.status !== 0) {
    failed++;
    console.error('✖ ' + relative(root, file) + '\n' + run.stderr);
  }
}
console.log(failed ? failed + ' קבצים עם שגיאת תחביר' : 'תחביר תקין: ' + targets.length + ' קבצים');
process.exit(failed ? 1 : 0);
