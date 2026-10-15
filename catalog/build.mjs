#!/usr/bin/env node
// Builds the catalog.
//   node catalog/build.mjs --out catalog/out [--sources ladaat,tashma] [--full]
//                          [--prev dir] [--cache] [--now ISO] [--stats file]
// Default mode is incremental: connectors read only what is new (tashma /new,
// recent ladaat weeks, nearby gilyoines weeks); --prev supplies everything
// found before. --full crawls each source's whole archive.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connectors as allConnectors } from './connectors/index.mjs';
import { createHttp, HostBlockedError } from './lib/http.mjs';
import { enrich, buildAliasIndex } from './lib/enrich.mjs';
import { mergeAll } from './lib/merge.mjs';
import { loadPrev, itemsFromPrev } from './lib/prev.mjs';
import { writeCatalog, stableStringify, sha256, prune } from './lib/shards.mjs';
import { dayOf } from './lib/dates.mjs';
import { usableSpec } from './lib/urls.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIN_PLUGIN_VERSION = '0.1.0';

const NOTES = {
  down: 'האתר אינו זמין כרגע; מוצגים נתונים מהסנכרון האחרון',
  blocked: 'האתר חסם גישה אוטומטית זמנית; מוצגים נתונים מהסנכרון האחרון',
  degraded: 'חלק מהנתונים לא נטענו; מוצגים גם נתונים מהסנכרון האחרון',
  empty: 'לא התקבלו פריטים מהאתר בריצה זו',
};

async function runSource(c, ctx, { full }) {
  const res = { id: c.id, raw: [], status: 'ok', note: '' };
  const log = (m) => ctx.log(`[${c.id}] ${m}`);
  if (c.mode === 'link') {
    try { Object.assign(res, await c.probe(ctx)); } catch (e) { res.status = 'down'; res.note = NOTES.down; }
    return res;
  }
  try {
    for await (const raw of c.crawl({ ...ctx, log }, { full })) res.raw.push(raw);
    if (!res.raw.length) { res.status = 'degraded'; res.note = NOTES.empty; }
  } catch (e) {
    const kind = e instanceof HostBlockedError ? 'blocked' : res.raw.length ? 'degraded' : 'down';
    res.status = kind;
    res.note = NOTES[kind];
    res.error = e.message;
    log(`failed: ${e.message}`);
  }
  return res;
}

/**
 * @param {object} o
 * @param {string} o.out        output directory
 * @param {string[]} [o.sources] connector ids to run (default all)
 * @param {boolean} [o.full]
 * @param {string} [o.prev]     previous catalog directory
 * @param {string} [o.now]      ISO timestamp (tests, reproducible builds)
 */
export async function runBuild(o) {
  const log = o.log || ((m) => console.error(m));
  const now = (o.now || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z');
  const today = dayOf(now);
  const selected = new Set(o.sources?.length ? o.sources : allConnectors.map((c) => c.id));
  const http = o.http || createHttp({
    cacheDir: o.cacheDir || join(HERE, '.cache'),
    useCache: !!o.cache,
    log,
    hostIntervalMs: { 'tashma.co.il': 500, 'ladaat.co': 700, 'gilyoines.com': 800, 'alonolam.com': 800, 'beinenu.com': 2000 },
  });
  const aliases = JSON.parse(await readFile(join(HERE, 'data', 'aliases.json'), 'utf8'));
  const aliasIndex = buildAliasIndex(aliases);

  // ---- crawl (sources run side by side: different hosts, independent limiters) ----
  const connectors = (o.connectors || allConnectors);
  const results = await Promise.all(connectors.filter((c) => selected.has(c.id)).map((c) => runSource(c, { http, now, log }, { full: !!o.full })));
  const resById = new Map(results.map((r) => [r.id, r]));

  // ---- previous state ----
  const prev = o.prev ? await loadPrev(o.prev) : null;
  if (o.prev && !prev) log(`warning: could not read previous catalog in ${o.prev}; building without it`);
  // A full crawl that finished cleanly replaces that source's old items; anything else keeps them.
  const skip = new Set(results.filter((r) => o.full && r.status === 'ok' && r.raw.length).map((r) => r.id));
  const { items: prevItems, prevAdded, cidByKey } = prev ? itemsFromPrev(prev, { aliasIndex, skipSources: skip }) : { items: [], prevAdded: new Map(), cidByKey: new Map() };

  // ---- enrich + merge ----
  const stats = {};
  const fresh = [];
  const seen = new Set();
  for (const r of results) {
    const st = (stats[r.id] = { raw: r.raw.length, parasha: 0, year: 0, date: 0, how: {}, titleParashaDiffers: 0 });
    for (const raw of r.raw) {
      const k = `${raw.src}:${raw.ext}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const it = enrich(raw, { now, aliasIndex });
      // A copy seen before stays in the issue it was in (see lib/merge.mjs).
      it.cid = cidByKey.get(k);
      fresh.push(it);
      if (it.flags.parasha) st.parasha++;
      if (it.flags.year) st.year++;
      if (it.flags.date) st.date++;
      st.how[it.how] = (st.how[it.how] || 0) + 1;
      if (it.notes.includes('title-parasha-differs')) st.titleParashaDiffers++;
    }
  }
  // New data wins over reconstructed data for the same copy.
  const items = [...prevItems.filter((i) => !seen.has(`${i.src}:${i.ext}`)), ...fresh];
  const { series, issues } = mergeAll(items, { now, prevAdded, aliasIndex });

  // ---- write ----
  const out = resolve(o.out);
  await mkdir(out, { recursive: true });
  // URL compression specs: a connector's template is used only if every copy of that source has the field.
  const sourceSpecs = {};
  for (const c of connectors) {
    const assets = issues.flatMap((i) => i.assets.filter((a) => a.src === c.id));
    const spec = c.urlSpec && assets.length ? usableSpec(c.urlSpec, assets) : null;
    if (spec) sourceSpecs[c.id] = spec;
  }
  const { files, shards } = await writeCatalog(out, { series, issues, today, sourceSpecs });

  const counts = {};
  for (const i of issues) for (const a of i.assets) counts[a.src] = (counts[a.src] || 0) + 1;
  const prevSources = new Map((prev?.manifest.sources || []).map((s) => [s.id, s]));
  const sources = connectors.map((c) => {
    const r = resById.get(c.id);
    const p = prevSources.get(c.id);
    const base = { id: c.id, name: c.name, url: c.url, mode: c.mode, issueCount: counts[c.id] || 0, ...(sourceSpecs[c.id] || {}) };
    if (!r) return { ...base, status: p?.status || 'disabled', checkedAt: p?.checkedAt, lastOkAt: p?.lastOkAt, note: p?.note || 'לא נבדק בריצה זו' };
    return { ...base, status: r.status, checkedAt: now, lastOkAt: r.status === 'ok' ? now : p?.lastOkAt, note: r.note || '' };
  });

  // ---- manifest: unchanged content keeps the previous file byte for byte ----
  const comparable = (m) => stableStringify(prune({ files: m.files, shards: m.shards, sources: m.sources.map(({ checkedAt, lastOkAt, ...rest }) => rest) }));
  const draft = { schema: 1, minPluginVersion: MIN_PLUGIN_VERSION, sources, files, shards };
  const heartbeatMs = (o.heartbeatHours ?? 24) * 3600 * 1000;
  let manifestText;
  if (prev && comparable(prev.manifest) === comparable(draft) && Date.parse(now) - Date.parse(prev.manifest.generatedAt) < heartbeatMs) {
    manifestText = await readFile(join(o.prev, 'manifest.json'), 'utf8');
  } else {
    const version = Math.max(Math.floor(Date.parse(now) / 1000), (prev?.manifest.catalogVersion || 0) + 1);
    const m = { ...draft, catalogVersion: version, generatedAt: now };
    for (const s of m.sources) for (const k of Object.keys(s)) if (s[k] === undefined || s[k] === '') delete s[k];
    manifestText = stableStringify(m, 2);
  }
  await writeFile(join(out, 'manifest.json'), manifestText);
  const manifest = JSON.parse(manifestText);
  const fullStats = { generatedAt: now, full: !!o.full, series: series.length, issues: issues.length, sources: stats, httpRequests: http.stats, hash: sha256(Buffer.from(manifestText)) };
  if (o.stats) { await mkdir(dirname(resolve(o.stats)), { recursive: true }); await writeFile(o.stats, JSON.stringify(fullStats, null, 2)); }
  return { manifest, stats: fullStats, results };
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' }, sources: { type: 'string' }, full: { type: 'boolean', default: false },
      prev: { type: 'string' }, cache: { type: 'boolean', default: false }, now: { type: 'string' },
      stats: { type: 'string' }, 'heartbeat-hours': { type: 'string' },
    },
  });
  if (!values.out) { console.error('usage: node catalog/build.mjs --out <dir> [--sources a,b] [--full] [--prev <dir>] [--cache] [--now ISO] [--stats file]'); process.exit(2); }
  const { manifest, stats, results } = await runBuild({
    out: values.out, sources: values.sources?.split(',').map((s) => s.trim()).filter(Boolean), full: values.full, prev: values.prev,
    cache: values.cache, now: values.now, stats: values.stats,
    heartbeatHours: values['heartbeat-hours'] ? Number(values['heartbeat-hours']) : undefined,
  });
  console.error(`catalog v${manifest.catalogVersion}: ${stats.series} series, ${stats.issues} issues`);
  for (const s of manifest.sources) console.error(`  ${s.id}: ${s.status}, ${s.issueCount} copies${s.note ? ' - ' + s.note : ''}`);
  const ok = results.some((r) => r.status === 'ok' || r.status === 'degraded') || !!values.prev;
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
