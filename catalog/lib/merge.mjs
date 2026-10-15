// Series and issue merging across sources. Precision before coverage: two
// copies become one issue only when series, week and (where known) number,
// leftover title and page count do not contradict, AND the pairing is
// unambiguous. When unsure they stay separate; no source copy is ever dropped.
import { normalizeKey } from './normalize.mjs';
import { sha1 } from './enrich.mjs';

/** Preference order of copies inside one issue (quality and reliability of the source). */
export const SOURCE_ORDER = ['ladaat', 'tashma', 'gilyoines', 'alonolam'];
const rank = (src) => { const i = SOURCE_ORDER.indexOf(src); return i < 0 ? SOURCE_ORDER.length : i; };

/** Group key: which items may even be compared. */
function groupKey(it) {
  const s = it.series.id;
  if (it.date) return `d|${s}|${it.date}`;
  if (it.hy && it.slugs.length) return `p|${s}|${it.hy}|${it.slugs.join('+')}`;
  if (it.hy) return `y|${s}|${it.hy}|${normalizeKey(it.title)}`;
  return `t|${s}|${normalizeKey(it.title)}`;
}

function compatible(cluster, it) {
  if (cluster.items.some((x) => x.src === it.src)) return false; // two files from one source are two issues
  for (const x of cluster.items) {
    if (x.no != null && it.no != null && x.no !== it.no) return false;
    if (x.variant && it.variant && x.variant !== it.variant) return false;
    if (x.pages != null && it.pages != null && x.pages !== it.pages) return false;
  }
  return true;
}

function score(cluster, it) {
  let s = 0;
  for (const x of cluster.items) {
    if (x.no != null && x.no === it.no) s += 3;
    if (x.variant && x.variant === it.variant) s += 3;
    if (!x.variant && !it.variant) s += 1;
    if (x.pages != null && x.pages === it.pages) s += 1;
  }
  return s;
}

/** Clusters one group's items into issues. */
export function clusterItems(items) {
  const sorted = [...items].sort((a, b) => rank(a.src) - rank(b.src) || (a.ext < b.ext ? -1 : a.ext > b.ext ? 1 : 0));
  // Copies that a previous run already joined stay together (`cid` = the earlier issue id):
  // re-reading the catalog must not reshuffle decisions, or every run would be a new commit.
  const clusters = [];
  const byCid = new Map();
  const loose = [];
  for (const it of sorted) {
    if (!it.cid) { loose.push(it); continue; }
    let c = byCid.get(it.cid);
    if (!c) { c = { items: [] }; byCid.set(it.cid, c); clusters.push(c); }
    if (c.items.some((x) => x.src === it.src)) loose.push(it); // never two copies of one source in an issue
    else c.items.push(it);
  }
  for (const it of loose) {
    const cands = clusters.filter((c) => compatible(c, it));
    let target = null;
    if (cands.length) {
      const scored = cands.map((c) => ({ c, s: score(c, it) })).sort((x, y) => y.s - x.s);
      // A tie between candidate clusters means we cannot tell which one: do not guess.
      if (scored.length === 1 || scored[0].s > scored[1].s) target = scored[0].c;
    }
    if (target) target.items.push(it);
    else clusters.push({ items: [it] });
  }
  return clusters;
}

const first = (list, f) => { for (const x of list) { const v = f(x); if (v != null && v !== '') return v; } return null; };

function buildIssue(cluster, { now, prevAdded }) {
  const items = [...cluster.items].sort((a, b) => rank(a.src) - rank(b.src) || (a.ext < b.ext ? -1 : 1));
  const lead = items[0];
  const no = first(items.filter((i) => i.noStrong), (i) => i.no) ?? first(items, (i) => i.no);
  const slugs = lead.slugs;
  const assets = items.map((i) => {
    const a = { ...i.asset };
    for (const k of Object.keys(a)) if (a[k] === undefined || a[k] === null) delete a[k];
    return a;
  });
  // Earliest sighting: the source's own upload time, else the first run that saw it.
  const addedCandidates = items.map((i) => i.addedAt || prevAdded?.get(`${i.src}:${i.ext}`)).filter(Boolean).sort();
  const added = addedCandidates[0] || now;
  const issue = {
    series: lead.series.id,
    title: first(items, (i) => i.title) || lead.series.displayTitle,
    no,
    date: lead.date,
    hy: lead.hy,
    parasha: slugs.length ? slugs : undefined,
    event: lead.event,
    lang: lead.lang,
    pages: first(items, (i) => i.pages),
    added,
    assets,
    _base: `${lead.series.id}|${lead.hy ?? ''}|${slugs.join('+') || lead.event || lead.date || ''}|${no ?? ''}`,
    _first: `${lead.src}:${lead.ext}`,
  };
  return issue;
}

/**
 * @param items enriched items (lib/enrich.mjs)
 * @returns { series:[], issues:[] } unsorted-stable: both sorted deterministically
 */
export function mergeAll(items, { now, prevAdded = null, aliasIndex = null } = {}) {
  const groups = new Map();
  for (const it of items) {
    const k = groupKey(it);
    (groups.get(k) ?? groups.set(k, []).get(k)).push(it);
  }
  const issues = [];
  for (const g of groups.values()) for (const c of clusterItems(g)) issues.push(buildIssue(c, { now, prevAdded }));

  // Ids: stable hash; when two distinct issues share it (same week, same number, but not
  // mergeable), the lead copy's source id tells them apart. Nothing derived from titles goes in,
  // so re-reading the catalog never renames an issue.
  const counts = new Map();
  for (const i of issues) counts.set(i._base, (counts.get(i._base) || 0) + 1);
  for (const i of issues) {
    const base = counts.get(i._base) > 1 ? `${i._base}|${i._first}` : i._base;
    i.id = `i_${sha1(base).slice(0, 12)}`;
    delete i._base; delete i._first;
  }

  // ---- series ----
  const bySeries = new Map();
  for (const it of items) {
    let s = bySeries.get(it.series.id);
    if (!s) { s = { id: it.series.id, key: it.series.key, lang: it.series.lang, titles: new Map(), sources: new Map(), circles: new Map(), items: [] }; bySeries.set(s.id, s); }
    s.items.push(it);
    s.titles.set(it.series.displayTitle, (s.titles.get(it.series.displayTitle) || 0) + 1);
    const sk = `${it.src}|${it.seriesHint?.ext ?? normalizeKey(it.series.displayTitle)}`;
    if (!s.sources.has(sk)) s.sources.set(sk, { src: it.src, ext: it.seriesHint?.ext ?? normalizeKey(it.series.displayTitle), title: it.seriesHint?.title || it.series.displayTitle });
    if (it.circle) s.circles.set(it.circle, (s.circles.get(it.circle) || 0) + 1);
  }
  const issueBySeries = new Map();
  for (const i of issues) (issueBySeries.get(i.series) ?? issueBySeries.set(i.series, []).get(i.series)).push(i);

  const series = [];
  for (const s of bySeries.values()) {
    const iss = issueBySeries.get(s.id) || [];
    const titles = [...s.titles.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((x) => x[0]);
    const dates = iss.map((i) => i.date).filter(Boolean).sort();
    const circle = [...s.circles.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    const named = s.items[0].series.named;
    series.push({
      id: s.id,
      title: named ? titles[0] : `${titles[0]} (ללא שם סדרה)`,
      aliases: titles.slice(1),
      previousIds: (aliasIndex?.previous.get(s.key.split('|')[0]) || []).map((k) => `s_${sha1(s.lang === 'he' ? k : `${k}|${s.lang}`).slice(0, 10)}`).sort(),
      lang: s.lang,
      circle,
      kind: iss.some((i) => i.date || i.parasha || i.event) ? 'weekly' : 'timeless',
      sources: [...s.sources.values()].sort((a, b) => rank(a.src) - rank(b.src) || (a.ext < b.ext ? -1 : 1)),
      issueCount: iss.length,
      first: dates[0],
      last: dates[dates.length - 1],
    });
  }
  series.sort((a, b) => (a.id < b.id ? -1 : 1));
  issues.sort(issueCompare);
  return { series, issues };
}

/** Deterministic total order: newest week first, then id. */
export function issueCompare(a, b) {
  const da = a.date || '', db = b.date || '';
  if (da !== db) return da < db ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
