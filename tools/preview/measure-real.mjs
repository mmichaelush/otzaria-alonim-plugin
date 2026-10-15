// מודד את האינדקס על הקטלוג האמיתי (catalog/out) או על קטלוג סינתטי באותו גודל:
// זמן בנייה, זיכרון, חיפוש.
//   node --expose-gc tools/preview/measure-real.mjs <catalog-dir> | --synthetic [N]
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
globalThis.Alonim = {};
for (const f of ['i18n', 'hebcal', 'core', 'normalize', 'log', 'weeks', 'rules', 'filters', 'index', 'index-search']) require('../../plugin/js/alonim-' + f + '.js');
const { CatalogIndex } = globalThis.Alonim.Index;

const arg = process.argv[2];
const mb = (n) => Math.round(n / 1048576) + 'MB';
const heap = () => {
  if (globalThis.gc) globalThis.gc();
  return process.memoryUsage().heapUsed;
};
const base = heap();
let series;
let shards;
const synthetic = () => {
  const { makeCatalog } = require('../../plugin/test/helpers/fixture.js');
  const size = Number(process.argv[3] || 123000);
  const c = makeCatalog(size, 2029, 9);
  const byYear = new Map();
  for (const it of c.issues) (byYear.get(it.hy) || byYear.set(it.hy, []).get(it.hy)).push(it);
  console.log('synthetic catalog', size);
  return { series: c.series, shards: [...byYear].map(([id, list]) => ({ id: String(id), list })) };
};
if (arg === '--synthetic' || !arg || !existsSync(join(arg, 'series.json'))) {
  ({ series, shards } = synthetic());
} else {
  series = JSON.parse(readFileSync(join(arg, 'series.json'), 'utf8'));
  shards = readdirSync(join(arg, 'issues')).map((f) => ({ id: f.replace('.json', ''), list: JSON.parse(readFileSync(join(arg, 'issues', f), 'utf8')) }));
}
const idx = new CatalogIndex({ source: (id) => id });
idx.setSeries(series);
const t0 = performance.now();
for (const s of shards) idx.addIssues(s.list, s.id);
const build = performance.now() - t0;
for (const s of shards) s.list = null;
shards.length = 0;
series = null;
const after = heap();
console.log(`issues ${idx.size}, build ${Math.round(build)}ms (incremental per-shard), heap +${mb(after - base)}`);
const timings = {};
for (const q of ['נח', 'אסיפת גליונות נח', 'year:5786 parasha:noach', 'שבת OR נח -עלון', 'torah', '']) {
  idx.search(q, {}, {}, {});
  const s = performance.now();
  let r;
  for (let i = 0; i < 5; i++) r = idx.search(q, {}, {}, {});
  timings[q || '(ריק)'] = Math.round((performance.now() - s) / 5) + 'ms/' + r.total;
}
console.log(JSON.stringify(timings));
const s = performance.now();
idx.search('נח', {}, {}, { sort: 'size' });
idx.search('נח', {}, {}, { sort: 'alpha' });
console.log('first sort orders (size+alpha):', Math.round(performance.now() - s) + 'ms');
const sim = performance.now();
const r = idx.simulate({ action: 'hide', field: 'lang', value: 'yi' }, 3);
console.log('simulate:', Math.round(performance.now() - sim) + 'ms, hides', r.hides);
