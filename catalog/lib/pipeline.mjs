// The stages of a build, one function each (build.mjs wires them together):
//   crawlAll -> enrichAll (+ previous catalog) -> mergeAll -> specs/sources/manifest -> write.
import { HostBlockedError } from './http.mjs';
import { enrich, weeklySeriesOf } from './enrich.mjs';
import { usableSpec } from './urls.mjs';
import { stableStringify, prune } from './shards.mjs';
import { prefixed } from './log.mjs';

export const MIN_PLUGIN_VERSION = '0.1.0';

/** Hebrew notes shown to the user in sources[].note. */
export const NOTES = {
  down: 'האתר אינו זמין כרגע; מוצגים נתונים מהסנכרון האחרון',
  blocked: 'האתר חסם גישה אוטומטית זמנית; מוצגים נתונים מהסנכרון האחרון',
  degraded: 'חלק מהנתונים לא נטענו; מוצגים גם נתונים מהסנכרון האחרון',
  empty: 'לא התקבלו פריטים מהאתר בריצה זו',
};

/** Most soft errors kept per source in the run summary. */
const MAX_SOFT_ERRORS = 25;

/**
 * @typedef {object} SourceResult  what one connector produced in this run
 * @property {string} id
 * @property {object[]} raw                 RawIssue[] (see connectors/*.mjs)
 * @property {'ok'|'degraded'|'blocked'|'down'|'disabled'} status
 * @property {string} note                  Hebrew sentence for the user
 * @property {string} [error]               the error that ended the crawl, if any
 * @property {{unit: string, message: string}[]} softErrors  units that failed while the crawl went on
 * @property {number} softErrorCount
 * @property {number} durationMs
 */

/**
 * Runs one connector. Never throws: every failure becomes a status, and what was
 * read before the failure is kept (a partly failed source is "degraded", not empty).
 * @returns {Promise<SourceResult>}
 */
export async function runSource(connector, ctx, { full }) {
  const t0 = Date.now();
  const res = { id: connector.id, raw: [], status: 'ok', note: '', softErrors: [], softErrorCount: 0, durationMs: 0 };
  const log = prefixed(ctx.log, `[${connector.id}] `);
  const connectorCtx = {
    ...ctx,
    log: (m) => log.info(m),
    soft: (unit, err) => {
      res.softErrorCount++;
      if (res.softErrors.length < MAX_SOFT_ERRORS) res.softErrors.push({ unit, message: String(err?.message || err) });
      log.warn(`${unit} failed, continuing: ${err?.message || err}`);
    },
  };
  try {
    for await (const raw of connector.crawl(connectorCtx, { full })) res.raw.push(raw);
    if (!res.raw.length) { res.status = 'degraded'; res.note = NOTES.empty; }
    else if (res.softErrorCount) { res.status = 'degraded'; res.note = NOTES.degraded; }
  } catch (e) {
    res.status = e instanceof HostBlockedError ? 'blocked' : res.raw.length ? 'degraded' : 'down';
    res.note = NOTES[res.status];
    res.error = e.message;
    log.warn(`failed: ${e.message}`);
  }
  res.durationMs = Date.now() - t0;
  return res;
}

/** Runs the selected connectors side by side (different hosts, independent rate limiters). */
export function crawlAll(connectors, selected, ctx, { full }) {
  return Promise.all(connectors.filter((c) => selected.has(c.id)).map((c) => runSource(c, ctx, { full })));
}

/**
 * Turns the crawled RawIssues into items, with the bookkeeping that ties them to the
 * previous catalog (same issue as before, archive flag) and per-source recognition statistics.
 * @returns {{fresh: object[], seen: Set<string>, stats: Record<string, object>}}
 */
export function enrichAll(results, { now, aliasIndex, prevState, trace = false }) {
  const fresh = [];
  const seen = new Set();
  const stats = {};
  const weeklySeries = weeklySeriesOf(results.flatMap((r) => r.raw));
  for (const r of results) {
    const st = (stats[r.id] = { raw: r.raw.length, parasha: 0, year: 0, date: 0, how: {}, titleParashaDiffers: 0, relaxed: 0 });
    for (const raw of r.raw) {
      const key = `${raw.src}:${raw.ext}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const it = enrich(raw, { now, aliasIndex, weeklySeries, trace });
      it.raw = trace ? raw : undefined;
      // A copy seen before stays in the issue it was in, and keeps its archive flag (lib/merge.mjs).
      it.cid = prevState.cidByKey.get(key);
      it.archive = prevState.archiveByKey.get(key) === true;
      fresh.push(it);
      if (it.flags.parasha) st.parasha++;
      if (it.flags.year) st.year++;
      if (it.flags.date) st.date++;
      st.how[it.how] = (st.how[it.how] || 0) + 1;
      if (it.notes.includes('title-parasha-differs')) st.titleParashaDiffers++;
      if (it.notes.includes('parasha-relaxed')) st.relaxed++;
    }
  }
  return { fresh, seen, stats };
}

/** URL compression spec per source: a template is used only if every copy of the source has the field. */
export function sourceSpecsFor(connectors, issues) {
  const specs = {};
  for (const c of connectors) {
    const assets = issues.flatMap((i) => i.assets.filter((a) => a.src === c.id));
    const spec = c.urlSpec && assets.length ? usableSpec(c.urlSpec, assets) : null;
    if (spec) specs[c.id] = spec;
  }
  return specs;
}

/** manifest.sources[]: this run's status for crawled sources, the previous one for the others. */
export function sourceEntries(connectors, { results, issues, prevManifest, specs, now }) {
  const resById = new Map(results.map((r) => [r.id, r]));
  const prevSources = new Map((prevManifest?.sources || []).map((s) => [s.id, s]));
  const counts = {};
  for (const i of issues) for (const a of i.assets) counts[a.src] = (counts[a.src] || 0) + 1;
  return connectors.map((c) => {
    const r = resById.get(c.id);
    const p = prevSources.get(c.id);
    const base = { id: c.id, name: c.name, url: c.url, mode: c.mode, issueCount: counts[c.id] || 0, ...(specs[c.id] || {}) };
    if (!r) return { ...base, status: p?.status || 'disabled', checkedAt: p?.checkedAt, lastOkAt: p?.lastOkAt, note: p?.note || 'לא נבדק בריצה זו' };
    return { ...base, status: r.status, checkedAt: now, lastOkAt: r.status === 'ok' ? now : p?.lastOkAt, note: r.note || '' };
  });
}

/**
 * The manifest text. When nothing but timestamps changed since the previous catalog
 * (and its heartbeat is younger than `heartbeatMs`), the previous text is reused
 * byte for byte, so the data branch gets an empty commit.
 * @returns {{text: string, reused: boolean}}
 */
export function manifestText({ sources, files, shards, prevManifest, prevText, now, heartbeatMs }) {
  const comparable = (m) => stableStringify(prune({
    files: m.files, shards: m.shards, sources: m.sources.map(({ checkedAt, lastOkAt, ...rest }) => rest),
  }));
  const draft = { schema: 1, minPluginVersion: MIN_PLUGIN_VERSION, sources, files, shards };
  if (prevManifest && prevText && comparable(prevManifest) === comparable(draft)
    && Date.parse(now) - Date.parse(prevManifest.generatedAt) < heartbeatMs) {
    return { text: prevText, reused: true };
  }
  const catalogVersion = Math.max(Math.floor(Date.parse(now) / 1000), (prevManifest?.catalogVersion || 0) + 1);
  const m = { ...draft, catalogVersion, generatedAt: now };
  for (const s of m.sources) for (const k of Object.keys(s)) if (s[k] === undefined || s[k] === '') delete s[k];
  return { text: stableStringify(m, 2), reused: false };
}
