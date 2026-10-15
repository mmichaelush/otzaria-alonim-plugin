#!/usr/bin/env node
// Builds the catalog.
//
//   node catalog/build.mjs --out catalog/out [--sources ladaat,tashma] [--full]
//                          [--prev dir] [--cache] [--now ISO] [--summary file]
//                          [--verbose | --quiet]
//   node catalog/build.mjs --explain <i_... | s_... | series name | url> [--cache] [--sources ...]
//
// Default mode is incremental: connectors read only what is new (tashma /new,
// recent ladaat weeks, nearby gilyoines weeks); --prev supplies everything
// found before. --full crawls each source's whole archive.
// --explain runs the same pipeline but writes nothing; it prints how the issue was derived.
// --summary writes a JSON run log (per source: status, timing, soft errors, recognition rates).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connectors as allConnectors } from './connectors/index.mjs';
import { createHttp } from './lib/http.mjs';
import { buildAliasIndex } from './lib/enrich.mjs';
import { mergeAll } from './lib/merge.mjs';
import { loadPrev, itemsFromPrev, applyPreviousIds } from './lib/prev.mjs';
import { writeCatalog, sha256 } from './lib/shards.mjs';
import { dayOf } from './lib/dates.mjs';
import { bulkDaysOf } from './lib/archive.mjs';
import { createLogger } from './lib/log.mjs';
import { explain } from './lib/explain.mjs';
import { crawlAll, enrichAll, sourceSpecsFor, sourceEntries, manifestText } from './lib/pipeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const HOST_INTERVAL_MS = { 'tashma.co.il': 500, 'ladaat.co': 700, 'gilyoines.com': 800, 'alonolam.com': 800 };

const EMPTY_PREV = () => ({ items: [], prevAdded: new Map(), cidByKey: new Map(), archiveByKey: new Map() });

/**
 * @param {object} o
 * @param {string} [o.out]        output directory (not needed with o.explain)
 * @param {string[]} [o.sources]  connector ids to run (default all)
 * @param {boolean} [o.full]
 * @param {string} [o.prev]       previous catalog directory
 * @param {string} [o.now]        ISO timestamp (tests, reproducible builds)
 * @param {string} [o.explain]    explain this query instead of writing
 * @param {'quiet'|'info'|'verbose'} [o.logLevel]
 * @param {string} [o.summary]    write the run log (JSON) here
 */
export async function runBuild(o) {
  const t0 = Date.now();
  const log = o.logger || createLogger(o.logLevel || 'info', o.log);
  const now = (o.now || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z');
  const connectors = o.connectors || allConnectors;
  const selected = new Set(o.sources?.length ? o.sources : connectors.map((c) => c.id));
  const http = o.http || createHttp({
    cacheDir: o.cacheDir || join(HERE, '.cache'),
    useCache: !!o.cache,
    log: (m) => log.verbose(m),
    hostIntervalMs: HOST_INTERVAL_MS,
  });
  const aliasIndex = buildAliasIndex(JSON.parse(await readFile(join(HERE, 'data', 'aliases.json'), 'utf8')));

  const results = await crawlAll(connectors, selected, { http, now, log }, { full: !!o.full });

  // The previous catalog: a full crawl that finished cleanly replaces that source's old items; anything else keeps them.
  const prev = o.prev ? await loadPrev(o.prev) : null;
  if (o.prev && !prev) log.warn(`could not read the previous catalog in ${o.prev}; building without it`);
  const skip = new Set(results.filter((r) => o.full && r.status === 'ok' && r.raw.length).map((r) => r.id));
  const prevState = prev ? itemsFromPrev(prev, { aliasIndex, skipSources: skip }) : EMPTY_PREV();

  const { fresh, seen, stats } = enrichAll(results, { now, aliasIndex, prevState, trace: !!o.explain });
  // New data wins over reconstructed data for the same copy.
  const items = [...prevState.items.filter((i) => !seen.has(`${i.src}:${i.ext}`)), ...fresh];
  const { series, issues } = mergeAll(items, { now, prevAdded: prevState.prevAdded, aliasIndex, bulkDays: bulkDaysOf(fresh) });

  if (prev) applyPreviousIds(issues, prev.issues, now);

  if (o.explain) return { explain: explain(o.explain, { items, issues, series }), results };

  // ---- write ----
  const out = resolve(o.out);
  await mkdir(out, { recursive: true });
  const specs = sourceSpecsFor(connectors, issues);
  const { files, shards } = await writeCatalog(out, { series, issues, today: dayOf(now), sourceSpecs: specs });
  const sources = sourceEntries(connectors, { results, issues, prevManifest: prev?.manifest, specs, now });
  const prevText = prev ? await readFile(join(o.prev, 'manifest.json'), 'utf8') : null;
  const { text, reused } = manifestText({
    sources, files, shards, prevManifest: prev?.manifest, prevText, now, heartbeatMs: (o.heartbeatHours ?? 24) * 3600 * 1000,
  });
  await writeFile(join(out, 'manifest.json'), text);
  const manifest = JSON.parse(text);

  const summary = {
    generatedAt: now,
    mode: o.full ? 'full' : 'incremental',
    durationMs: Date.now() - t0,
    manifestReused: reused,
    series: series.length,
    issues: issues.length,
    archiveIssues: issues.filter((i) => i.archive).length,
    sources: Object.fromEntries(results.map((r) => [r.id, {
      status: r.status, note: r.note, durationMs: r.durationMs, error: r.error,
      softErrorCount: r.softErrorCount, softErrors: r.softErrors, ...stats[r.id],
    }])),
    files: { series: files.series.bytes, weeks: files.weeks.bytes, recent: files.recent.bytes, shards: shards.reduce((n, s) => n + s.bytes, 0), maxShard: Math.max(0, ...shards.map((s) => s.bytes)) },
    http: http.stats,
    warnings: log.warnings,
    manifestSha256: sha256(Buffer.from(text)),
  };
  if (o.summary) { await mkdir(dirname(resolve(o.summary)), { recursive: true }); await writeFile(o.summary, JSON.stringify(summary, null, 2)); }
  return { manifest, stats: summary, results };
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' }, sources: { type: 'string' }, full: { type: 'boolean', default: false },
      prev: { type: 'string' }, cache: { type: 'boolean', default: false }, now: { type: 'string' },
      summary: { type: 'string' }, stats: { type: 'string' }, 'heartbeat-hours': { type: 'string' },
      verbose: { type: 'boolean', default: false }, quiet: { type: 'boolean', default: false }, explain: { type: 'string' },
    },
  });
  if (!values.out && !values.explain) {
    console.error('usage: node catalog/build.mjs --out <dir> [--sources a,b] [--full] [--prev <dir>] [--cache] [--now ISO] [--summary file] [--verbose|--quiet]\n       node catalog/build.mjs --explain <query> [--cache]');
    process.exit(2);
  }
  const { manifest, stats, results, explain: text } = await runBuild({
    out: values.out, sources: values.sources?.split(',').map((s) => s.trim()).filter(Boolean), full: values.full, prev: values.prev,
    cache: values.cache, now: values.now, summary: values.summary || values.stats, explain: values.explain,
    logLevel: values.quiet ? 'quiet' : values.verbose ? 'verbose' : 'info',
    heartbeatHours: values['heartbeat-hours'] ? Number(values['heartbeat-hours']) : undefined,
  });
  if (text !== undefined) { console.log(text); return; }
  console.error(`catalog v${manifest.catalogVersion}: ${stats.series} series, ${stats.issues} issues (${stats.durationMs} ms)`);
  for (const s of manifest.sources) console.error(`  ${s.id}: ${s.status}, ${s.issueCount} copies${s.note ? ' - ' + s.note : ''}`);
  const ok = results.some((r) => r.status === 'ok' || r.status === 'degraded') || !!values.prev;
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
