// The previous catalog as input. A run that only re-reads recent material (or
// whose source failed) must not lose what earlier runs found, so the previous
// output is turned back into enriched items and merged with the new ones.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tokenize } from './parasha.mjs';
import { seriesIdentity } from './enrich.mjs';
import { fromWire } from './wire.mjs';
import { dayOf } from './dates.mjs';
import { daysBetween } from './calendar.mjs';

const readJson = async (dir, rel) => JSON.parse(await readFile(join(dir, rel), 'utf8'));
const UNNAMED_SUFFIX = ' (ללא שם סדרה)';

/** Loads { manifest, series, issues } from a previous output directory; null if unusable. */
export async function loadPrev(dir) {
  try {
    const manifest = await readJson(dir, 'manifest.json');
    const series = await readJson(dir, 'series.json');
    const issues = [];
    for (const s of manifest.shards || []) issues.push(...(await readJson(dir, s.path)));
    return { manifest, series, issues };
  } catch {
    return null;
  }
}

/**
 * Rebuilds enriched items (the shape lib/enrich.mjs produces) from previous
 * issues. Series identity is recomputed, so an aliases.json change flows into
 * new ids and `previousIds` automatically.
 */
export function itemsFromPrev(prev, { aliasIndex, skipSources = new Set() }) {
  const seriesById = new Map(prev.series.map((s) => [s.id, s]));
  const specs = Object.fromEntries((prev.manifest?.sources || []).map((s) => [s.id, { urlBase: s.urlBase, urlTemplates: s.urlTemplates }]));
  const items = [];
  const prevAdded = new Map();
  const cidByKey = new Map();
  const archiveByKey = new Map();
  for (const wireIssue of prev.issues) {
    const s = seriesById.get(wireIssue.series);
    if (!s) continue;
    // inherit lang/title/rawTitle and expand urls (the on-disk form is the compact one)
    const issue = fromWire(wireIssue, s, specs);
    const displayTitle = s.title.endsWith(UNNAMED_SUFFIX) ? s.title.slice(0, -UNNAMED_SUFFIX.length) : s.title;
    for (const asset of issue.assets || []) {
      if (skipSources.has(asset.src)) continue;
      const hint = (s.sources || []).find((x) => x.src === asset.src);
      const sid = seriesIdentity(hint?.title || displayTitle, s.lang, asset.src, aliasIndex);
      const seriesWords = new Set(tokenize(displayTitle).map((t) => t.n));
      const variant = issue.title && issue.title !== displayTitle
        ? tokenize(issue.title).map((t) => t.n).filter((w) => !seriesWords.has(w) && !/^\d+$/.test(w)).join(' ')
        : '';
      prevAdded.set(`${asset.src}:${asset.ext}`, issue.added);
      cidByKey.set(`${asset.src}:${asset.ext}`, issue.id);
      archiveByKey.set(`${asset.src}:${asset.ext}`, issue.archive === true);
      items.push({
        src: asset.src,
        ext: asset.ext,
        series: { ...sid, id: sid.id },
        seriesHint: { ext: hint?.ext ?? null, title: hint?.title || displayTitle, circle: s.circle || null },
        title: issue.title,
        variant,
        no: issue.no ?? null,
        noStrong: issue.no != null,
        date: issue.date ?? null,
        hy: issue.hy ?? null,
        slugs: issue.parasha || [],
        event: issue.event ?? null,
        timeless: !issue.hy && !issue.date,
        lang: s.lang,
        how: 'prev',
        notes: [],
        flags: {},
        asset: { ...asset },
        pages: asset.pages ?? issue.pages ?? null,
        addedAt: null,
        circle: s.circle || null,
        cid: issue.id,
        archive: issue.archive === true,
      });
    }
  }
  return { items, prevAdded, cidByKey, archiveByKey };
}

/** How long an old issue id stays in `previousIds` (days). */
export const PREVIOUS_ID_TTL_DAYS = 120;
/** At most this many old ids are kept; the oldest drop first. */
export const MAX_PREVIOUS_IDS = 3;

/**
 * Keeps user state alive when an issue id changes (a better analysis found its week,
 * a copy joined or left). Compares the new issues with the previous catalog by their
 * copies (`src:ext`): a new issue whose copies were in an issue with another id lists
 * that id in `previousIds` (newest first, at most MAX_PREVIOUS_IDS) and gets `idChangedAt`.
 * When the id did not change, `previousIds` and `idChangedAt` carry over from the previous
 * catalog, so the list survives any number of runs. Entries older than PREVIOUS_ID_TTL_DAYS
 * are dropped together with `idChangedAt`.
 *
 * @param {object[]} issues      this run's issues (mutated: previousIds, idChangedAt)
 * @param {object[]} prevIssues  the previous catalog's issues (on-disk form is fine)
 * @param {string} now           ISO timestamp of this run
 */
export function applyPreviousIds(issues, prevIssues, now) {
  const prevByKey = new Map();
  for (const p of prevIssues) for (const a of p.assets || []) prevByKey.set(`${a.src}:${a.ext}`, p);
  const today = dayOf(now);
  for (const issue of issues) {
    const parents = new Map();
    for (const a of issue.assets) {
      const p = prevByKey.get(`${a.src}:${a.ext}`);
      if (p) parents.set(p.id, p);
    }
    const changed = [...parents.values()].filter((p) => p.id !== issue.id).sort((x, y) => (x.id < y.id ? -1 : 1));
    const same = parents.get(issue.id);
    // newest first: ids that just changed, then what the same-id issue (or the changed ones) already carried
    const ids = [];
    const push = (id) => { if (id && id !== issue.id && !ids.includes(id)) ids.push(id); };
    let changedAt = null;
    for (const p of changed) push(p.id);
    if (changed.length) changedAt = now;
    for (const p of [same, ...changed]) {
      for (const id of p?.previousIds || []) push(id);
      if (p?.idChangedAt && !changed.length && (!changedAt || p.idChangedAt > changedAt)) changedAt = p.idChangedAt;
    }
    const expired = changedAt && !changed.length && daysBetween(dayOf(changedAt), today) > PREVIOUS_ID_TTL_DAYS;
    if (!ids.length || expired) { delete issue.previousIds; delete issue.idChangedAt; continue; }
    issue.previousIds = ids.slice(0, MAX_PREVIOUS_IDS);
    issue.idChangedAt = (changedAt || now).slice(0, 10);
  }
}
