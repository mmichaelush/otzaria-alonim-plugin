// The previous catalog as input. A run that only re-reads recent material (or
// whose source failed) must not lose what earlier runs found, so the previous
// output is turned back into enriched items and merged with the new ones.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tokenize } from './parasha.mjs';
import { seriesIdentity } from './enrich.mjs';
import { fromWire } from './wire.mjs';

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
      });
    }
  }
  return { items, prevAdded, cidByKey };
}
