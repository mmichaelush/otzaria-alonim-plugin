#!/usr/bin/env node
// Suggests series that may be one publication under two names, for a human to decide.
// Nothing is merged automatically: accepted pairs go into catalog/data/aliases.json
// ("merge": [{ "canonical": "...", "aliases": ["..."] }]).
//
//   node catalog/tools/suggest-aliases.mjs --catalog catalog/out [--min-overlap 0.5] [--limit 60] [--json]
//
// A pair is suggested when the names are alike (shared words) AND the two series
// appear in the same weeks, and they live in different sources (when one source lists both,
// it considers them different publications). Same language only.
// Score = name similarity x week overlap.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeKey } from '../lib/normalize.mjs';
import { seriesCore } from '../lib/enrich.mjs';

const { values } = parseArgs({
  options: {
    catalog: { type: 'string', default: 'catalog/out' },
    'min-overlap': { type: 'string', default: '0.5' },
    'min-weeks': { type: 'string', default: '3' },
    limit: { type: 'string', default: '60' },
    json: { type: 'boolean', default: false },
  },
});

const read = async (f) => JSON.parse(await readFile(join(values.catalog, f), 'utf8'));
const manifest = await read('manifest.json');
const series = await read('series.json');

// weeks (dates) in which each series has issues
const weeks = new Map();
for (const s of manifest.shards) {
  for (const i of await read(s.path)) {
    if (!i.date) continue;
    (weeks.get(i.series) ?? weeks.set(i.series, new Set()).get(i.series)).add(i.date);
  }
}

const words = (title) => new Set((seriesCore(title) || normalizeKey(title)).split(' ').filter((w) => w.length > 1));
const info = series.map((s) => ({ s, w: words(s.title), d: weeks.get(s.id) ?? new Set() }))
  .filter((x) => x.w.size && x.d.size >= Number(values['min-weeks']));

/** Shared-word similarity: Jaccard, but a full containment ("X" inside "X - Y") scores high. */
function nameSimilarity(a, b) {
  const inter = [...a].filter((w) => b.has(w)).length;
  if (!inter) return 0;
  const jaccard = inter / (a.size + b.size - inter);
  const contained = inter === Math.min(a.size, b.size) && Math.min(a.size, b.size) >= 2 ? 0.9 : 0;
  return Math.max(jaccard, contained);
}

const byWord = new Map();
info.forEach((x, k) => x.w.forEach((w) => (byWord.get(w) ?? byWord.set(w, []).get(w)).push(k)));
const seen = new Set();
const out = [];
for (const [, list] of byWord) {
  if (list.length > 400) continue; // a word that is in everything says nothing
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const key = `${list[a]}|${list[b]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const A = info[list[a]], B = info[list[b]];
      if (A.s.lang !== B.s.lang || A.s.id === B.s.id) continue;
      // Two series of one source are different publications by that source's own account.
      if (A.s.sources.some((x) => B.s.sources.some((y) => y.src === x.src))) continue;
      const sim = nameSimilarity(A.w, B.w);
      if (sim < 0.5) continue;
      const common = [...A.d].filter((d) => B.d.has(d)).length;
      const overlap = common / Math.min(A.d.size, B.d.size);
      if (overlap < Number(values['min-overlap'])) continue;
      out.push({ score: +(sim * overlap).toFixed(3), a: A.s, b: B.s, sim: +sim.toFixed(2), overlap: +overlap.toFixed(2), common });
    }
  }
}
out.sort((x, y) => y.score - x.score || (x.a.id < y.a.id ? -1 : 1));
const top = out.slice(0, Number(values.limit));

if (values.json) {
  console.log(JSON.stringify(top.map((o) => ({ score: o.score, merge: { canonical: o.a.title.length <= o.b.title.length ? o.a.title : o.b.title, aliases: [o.a.title.length <= o.b.title.length ? o.b.title : o.a.title] } })), null, 2));
} else {
  console.log(`${out.length} candidate pairs (showing ${top.length}); decide each one by hand.\n`);
  for (const o of top) {
    const src = (s) => s.sources.map((x) => x.src).join('+');
    console.log(`${o.score.toFixed(2)}  "${o.a.title}" [${src(o.a)}, ${o.a.issueCount}]  <->  "${o.b.title}" [${src(o.b)}, ${o.b.issueCount}]  names ${o.sim}, same weeks ${o.common} (${o.overlap})`);
  }
}
