#!/usr/bin/env node
// Publish guard: refuse to replace the published catalog with one that lost a
// large share of its data (a connector bug or a half-working site must never
// shrink what users already have). Usage:
//   node catalog/tools/sanity.mjs --out <new dir> [--prev <published dir>] [--min-ratio 0.7]
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { out: { type: 'string' }, prev: { type: 'string' }, 'min-ratio': { type: 'string', default: '0.7' } } });

async function counts(dir) {
  const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  if (m.schema !== 1) throw new Error(`unexpected schema ${m.schema}`);
  let issues = 0;
  for (const s of m.shards) issues += s.count;
  return { issues, series: m.files.series.count };
}

const next = await counts(values.out);
console.error(`new catalog: ${next.issues} issues, ${next.series} series`);
if (!next.issues) { console.error('refusing to publish an empty catalog'); process.exit(1); }
if (values.prev) {
  let prev = null;
  try { prev = await counts(values.prev); } catch { console.error('previous catalog unreadable; skipping ratio check'); }
  if (prev) {
    const ratio = Number(values['min-ratio']);
    console.error(`previous catalog: ${prev.issues} issues, ${prev.series} series`);
    if (next.issues < prev.issues * ratio || next.series < prev.series * ratio) {
      console.error(`refusing to publish: less than ${ratio * 100}% of the previous data`);
      process.exit(1);
    }
  }
}
