// בונה עותק של הקטלוג לבדיקות QA חיות בלי לגעת ב-catalog/out:
//   node tools/qa/make-catalog.mjs <out-dir> [--prev] [--from catalog/out]
// מוסיף גיליונות סינתטיים (קבצי qa-*.pdf שמוגשים מקומית על ידי qa-server.mjs) לכשלים:
// גדול מדי, HTML במקום PDF, איטי, ותקין. עם --prev: גיליון אחד מחליף מזהה ונושא
// previousIds (בדיקת הגירת מצב משתמש), והקטלוג מקבל catalogVersion גבוה יותר.
import { cp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const out = resolve(process.argv[2] || 'tools/qa/out/catalog');
const from = resolve(arg('--from', 'catalog/out'));
const prev = process.argv.includes('--prev');

await rm(out, { recursive: true, force: true });
await cp(from, out, { recursive: true });

const WEEK = '2026-10-17';
const SERIES = 's_cf55df3e80';
const qaItems = [
  ['i_qa0000000001', 'qa-ok.pdf', 'QA תקין'],
  ['i_qa0000000002', 'qa-big.pdf', 'QA גדול 60MB'],
  ['i_qa0000000003', 'qa-html.pdf', 'QA HTML במקום PDF'],
  ['i_qa0000000004', 'qa-slow.pdf', 'QA איטי'],
].map(([id, file, title], k) => ({
  added: '2026-10-15T08:00:00Z',
  assets: [{ ext: `qa${k + 1}`, src: 'ladaat', url: file, pages: 4 }],
  date: WEEK,
  hy: 5787,
  id,
  no: 900 + k,
  parasha: ['noach'],
  series: SERIES,
  title,
}));

const order = (a, b) => {
  if (!a.date !== !b.date) return a.date ? -1 : 1;
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const OLD_ID = 'i_011b3555e667'; // ladaat, השבוע, פרשת נח
const NEW_ID = 'i_qamigrated01';

async function patch(rel) {
  const path = join(out, rel);
  const rows = JSON.parse(await readFile(path, 'utf8'));
  rows.push(...qaItems);
  if (prev) {
    const row = rows.find((r) => r.id === OLD_ID);
    if (!row) throw new Error(`${OLD_ID} not in ${rel}`);
    row.id = NEW_ID;
    row.previousIds = [OLD_ID];
    row.idChangedAt = '2026-10-15';
  }
  rows.sort(order);
  const text = JSON.stringify(rows);
  await writeFile(path, text);
  return { sha256: sha(text), bytes: Buffer.byteLength(text), count: rows.length };
}

const manifestPath = join(out, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
Object.assign(manifest.files.recent, await patch('recent.json'));
const shard = manifest.shards.find((s) => s.id === '5787');
Object.assign(shard, await patch('issues/5787.json'));
if (prev) manifest.catalogVersion += 60;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`QA catalog written to ${out}${prev ? ' (with previousIds migration ' + OLD_ID + ' -> ' + NEW_ID + ')' : ''}`);
