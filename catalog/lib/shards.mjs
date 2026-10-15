// Serialization of the catalog: deterministic JSON, shard splitting, hashes.
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { issueCompare } from './merge.mjs';
import { addDays, shabbatOnOrAfter, weeksBetween } from './calendar.mjs';

export const SHARD_MAX_BYTES = 3 * 1024 * 1024;
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Drops null/undefined/""/[] recursively (CATALOG_FORMAT: empty fields are omitted). */
export function prune(v) {
  if (Array.isArray(v)) return v.map(prune);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      const x = prune(v[k]);
      if (x === null || x === undefined || x === '' || (Array.isArray(x) && x.length === 0)) continue;
      out[k] = x;
    }
    return out;
  }
  return v;
}

/** JSON with sorted object keys at every depth (arrays keep their order). */
export function stableStringify(v, indent) {
  const sort = (x) => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])]));
    return x;
  };
  return JSON.stringify(sort(v), null, indent) + '\n';
}

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

/** Cutoff Shabbat for "recent": about 6 weeks back, aligned to weeks so the file changes weekly, not daily. */
export function recentWindow(today) {
  const shabbat = shabbatOnOrAfter(today);
  return { from: addDays(shabbat, -42), to: addDays(shabbat, 21) };
}

export function selectRecent(issues, today) {
  const { from, to } = recentWindow(today);
  const fromTs = `${from}T00:00:00Z`;
  return issues.filter((i) => (i.date ? i.date >= from && i.date <= to : i.added >= fromTs)).sort(issueCompare);
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
export async function writeCatalog(outDir, { series, issues, today }) {
  await rm(join(outDir, 'issues'), { recursive: true, force: true });
  const files = {};
  const sers = series.map(prune);
  files.series = { ...(await put(outDir, 'series.json', stableStringify(sers))), count: sers.length };

  const { from, to } = weeksRange(today);
  // weeks.json keeps empty parasha arrays and a null event on purpose (parashaIL vs parasha differ in meaning).
  const weeks = weeksBetween(from, to).map((r) => {
    const row = { date: r.date, hy: r.hy, parasha: r.parasha, parashaIL: r.parashaIL, label: r.label, event: r.event ?? null };
    if (!r.shabbat) row.shabbat = false;
    return row;
  });
  files.weeks = await put(outDir, 'weeks.json', stableStringify(weeks));

  const recent = selectRecent(issues, today).map(prune);
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
