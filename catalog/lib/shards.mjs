// Serialization of the catalog: deterministic JSON, shard splitting, hashes.
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { issueCompare } from './merge.mjs';
import { addDays, shabbatOnOrAfter, weeksBetween, weeksOfYear } from './calendar.mjs';
import { toWire, assertRoundTrip } from './wire.mjs';
import { prune, stableStringify } from './json.mjs';

export const SHARD_MAX_BYTES = 3 * 1024 * 1024;
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export { prune, stableStringify };

const bytesOf = (s) => Buffer.from(s, 'utf8');

/** Splits an ordered issue list into chunks that each serialize below `max` bytes. */
export function splitIssues(issues, max = SHARD_MAX_BYTES) {
  const whole = stableStringify(issues.map(prune));
  if (Buffer.byteLength(whole) <= max) return [issues];
  const chunks = [];
  let cur = [];
  let size = 4;
  for (const i of issues) {
    const n = Buffer.byteLength(JSON.stringify(prune(i))) + 1;
    if (cur.length && size + n > max) { chunks.push(cur); cur = []; size = 4; }
    cur.push(i);
    size += n;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Hard cap for recent.json (bytes): the first thing the plugin loads must be small. */
export const RECENT_MAX_BYTES = 1_500_000;

/** recent.json window: 3 Shabbatot back and 1 ahead, aligned to Shabbat so the file changes weekly, not daily. */
export function recentWindow(today) {
  const shabbat = shabbatOnOrAfter(today);
  return { from: addDays(shabbat, -21), to: addDays(shabbat, 7) };
}

/** An issue as stored in recent.json: same object as in the shards, minus the original titles. */
const recentView = (i) => ({ ...i, assets: i.assets.map(({ rawTitle, ...a }) => a) });

/**
 * "This week" material: dated issues inside the window, plus undated issues that
 * were added inside it and have a copy outside tashma (tashma's undated files
 * are archive material, not news). If the result exceeds `maxBytes` the least
 * important issues are cut: oldest week first, and within a week the ones with
 * fewer copies first (then by id). Everything cut is still in the shards.
 * Returns issues sorted like the shards.
 */
export function selectRecent(issues, today, maxBytes = RECENT_MAX_BYTES) {
  const { from, to } = recentWindow(today);
  const fromTs = `${from}T00:00:00Z`;
  const picked = [];
  for (const i of issues) {
    if (i.date) { if (i.date >= from && i.date <= to) picked.push([i.date, i]); continue; }
    if (i.added >= fromTs && i.assets.some((a) => a.src !== 'tashma')) picked.push([i.added.slice(0, 10), i]);
  }
  picked.sort(([da, a], [db, b]) => (da < db ? 1 : da > db ? -1 : b.assets.length - a.assets.length || (a.id < b.id ? -1 : 1)));
  const out = [];
  let bytes = 2;
  for (const [, i] of picked) {
    const v = prune(recentView(i));
    bytes += Buffer.byteLength(JSON.stringify(v)) + 1;
    if (bytes > maxBytes) break;
    out.push(i);
  }
  return out.sort(issueCompare).map((i) => prune(recentView(i)));
}

/**
 * A weeks.json row as written. parasha, parashaIL and event are always present, even
 * when empty or null: an empty parashaIL means something (a festival Shabbat abroad).
 */
export function weekRowOut(r) {
  const row = { date: r.date, hy: r.hy, hebrew: r.hebrew, parasha: r.parasha, parashaIL: r.parashaIL, label: r.label, event: r.event ?? null };
  if (r.events) row.events = r.events;
  if (!r.shabbat) row.shabbat = false;
  return row;
}

/** First day of the earliest Hebrew year that has at least MIN_ARCHIVE_ISSUES dated issues. */
const MIN_ARCHIVE_ISSUES = 20;
export function archiveStart(issues) {
  const perYear = new Map();
  for (const i of issues) if (i.date && i.hy) perYear.set(i.hy, (perYear.get(i.hy) || 0) + 1);
  const years = [...perYear].filter(([, n]) => n >= MIN_ARCHIVE_ISSUES).map(([y]) => y).sort((x, y) => x - y);
  if (!years.length) return null;
  return weeksOfYear(years[0])[0]?.date ?? null;
}

/** weeks.json range: a year back, a year ahead, aligned to Shabbat. */
export function weeksRange(today) {
  const shabbat = shabbatOnOrAfter(today);
  return { from: addDays(shabbat, -364), to: addDays(shabbat, 371) };
}

async function put(outDir, rel, text) {
  const path = join(outDir, rel);
  await mkdir(dirname(path), { recursive: true });
  const buf = bytesOf(text);
  await writeFile(path, buf);
  return { path: rel, sha256: sha256(buf), bytes: buf.length };
}

/**
 * Writes series/weeks/recent/issues/* into outDir.
 * Returns the manifest `files` and `shards` sections.
 */
export async function writeCatalog(outDir, { series, issues: memIssues, today, sourceSpecs = {} }) {
  await rm(join(outDir, 'issues'), { recursive: true, force: true });
  // Wire form (lib/wire.mjs): urls compressed per source, inheritable fields dropped.
  // Every issue is checked to inflate back to exactly what is in memory.
  const seriesById = new Map(series.map((x) => [x.id, x]));
  const issues = memIssues.map((i) => {
    const w = toWire(i, seriesById.get(i.series), sourceSpecs);
    assertRoundTrip(i, w, seriesById.get(i.series), sourceSpecs);
    return w;
  });
  const files = {};
  const sers = series.map(prune);
  files.series = { ...(await put(outDir, 'series.json', stableStringify(sers))), count: sers.length };

  const { from, to } = weeksRange(today);
  files.weeks = await put(outDir, 'weeks.json', stableStringify(weeksBetween(from, to).map(weekRowOut)));
  // Older years (back to the first year with real data) in a separate file the plugin can load lazily.
  const archiveFrom = archiveStart(issues);
  const archiveRows = archiveFrom && archiveFrom < from ? weeksBetween(archiveFrom, addDays(from, -1)) : [];
  if (archiveRows.length) files.weeksArchive = { ...(await put(outDir, 'weeks-archive.json', stableStringify(archiveRows.map(weekRowOut)))), count: archiveRows.length };

  const recent = selectRecent(issues, today);
  files.recent = { ...(await put(outDir, 'recent.json', stableStringify(recent))), count: recent.length };

  const byYear = new Map();
  for (const i of issues) {
    const k = i.hy ? String(i.hy) : 'timeless';
    (byYear.get(k) ?? byYear.set(k, []).get(k)).push(i);
  }
  const shards = [];
  for (const key of [...byYear.keys()].sort()) {
    const list = byYear.get(key).sort(issueCompare);
    const chunks = splitIssues(list);
    for (let n = 0; n < chunks.length; n++) {
      const id = chunks.length > 1 ? `${key}-${n + 1}` : key;
      const body = chunks[n].map(prune);
      const w = await put(outDir, `issues/${id}.json`, stableStringify(body));
      const dates = chunks[n].map((i) => i.date).filter(Boolean).sort();
      const adds = chunks[n].map((i) => i.added).filter(Boolean).sort();
      shards.push({
        id, path: w.path, sha256: w.sha256, bytes: w.bytes, count: chunks[n].length,
        from: dates[0], to: dates[dates.length - 1], addedMax: adds[adds.length - 1],
      });
    }
  }
  return { files, shards: shards.map(prune) };
}
