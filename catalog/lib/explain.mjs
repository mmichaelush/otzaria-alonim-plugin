// `node catalog/build.mjs --explain <issueId | seriesId | text | url>`: shows how an issue
// was derived: raw title and hints -> parsed facts (and which rule decided the date) ->
// merge decision -> the resulting record. Meant for answering "why is this in the wrong week?".
import { normalizeKey } from './normalize.mjs';
import { clusterItems, groupKey } from './merge.mjs';

const SAMPLE_ISSUES = 8;
const MAX_ITEMS = 6;

const itemKey = (i) => `${i.src}:${i.ext}`;
const fmt = (v) => (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) ? '-' : Array.isArray(v) ? v.join('+') : String(v));

/** Items matching a query, with how the query was understood. */
export function findMatches(query, { items, issues, series }) {
  const q = query.trim();
  if (/^i_[0-9a-f]{12}$/.test(q)) {
    const issue = issues.find((i) => i.id === q);
    if (!issue) return { kind: 'issue', items: [], issue: null };
    const keys = new Set(issue.assets.map((a) => `${a.src}:${a.ext}`));
    return { kind: 'issue', issue, items: items.filter((i) => keys.has(itemKey(i))) };
  }
  if (/^s_[0-9a-f]{10}$/.test(q)) {
    return { kind: 'series', series: series.find((s) => s.id === q), items: items.filter((i) => i.series.id === q) };
  }
  if (/^https?:\/\//.test(q) || /^[a-z]+:[^\s]+$/.test(q)) {
    const hit = items.filter((i) => itemKey(i) === q || [i.asset.url, i.asset.page, i.asset.thumb].some((u) => u && u === q || (u && decodeURI(u) === decodeURI(q))));
    return { kind: 'url', items: hit };
  }
  const nq = normalizeKey(q);
  const bySeries = series.filter((s) => normalizeKey(s.title).includes(nq) || (s.aliases || []).some((a) => normalizeKey(a).includes(nq)));
  if (bySeries.length) {
    const ids = new Set(bySeries.map((s) => s.id));
    return { kind: 'series', series: bySeries.length === 1 ? bySeries[0] : null, serieses: bySeries, items: items.filter((i) => ids.has(i.series.id)) };
  }
  return { kind: 'text', items: items.filter((i) => normalizeKey(i.asset.rawTitle).includes(nq)) };
}

function describeItem(it, lines) {
  lines.push(`\n● ${itemKey(it)}  "${it.asset.rawTitle}"`);
  const h = it.seriesHint || {};
  lines.push(`  רמזי המקור: סדרה="${h.title ?? '-'}"${h.ext ? ` (מזהה ${h.ext})` : ''} שפה=${fmt(h.lang)} חוג=${fmt(h.circle)}`);
  if (it.raw) {
    const r = it.raw;
    lines.push(`  גולמי: תאריך=${fmt(r.dateHint)} שבוע=${r.weekHint ? `${r.weekHint.id} "${r.weekHint.name}"` : '-'} תיקיות=${fmt(r.contextTitles)} חודש=${fmt(r.refMonth)} הועלה=${fmt(r.addedAt)}`);
  }
  for (const t of it.trace || []) lines.push(`  · ${t}`);
  lines.push(`  ⇒ שבוע: תאריך=${fmt(it.date)} שנה=${fmt(it.hy)} פרשה=${fmt(it.slugs)} אירוע=${fmt(it.event)} מספר=${fmt(it.no)} (נקבע על ידי: ${it.how})`);
  if (it.notes.length) lines.push(`  ⚠ הערות: ${it.notes.join(', ')}`);
  if (it.archive) lines.push('  ⚠ archive (לא "חדש")');
}

/**
 * @param {string} query
 * @param {{items: object[], issues: object[], series: object[]}} data  everything the build holds in memory
 * @returns {string} text for the terminal
 */
export function explain(query, data) {
  const m = findMatches(query, data);
  const lines = [];
  if (!m.items.length && !(m.series || m.serieses)) return `לא נמצא דבר עבור "${query}" (נסה מזהה i_/s_, חלק משם סדרה, או URL).`;
  if (m.serieses && m.serieses.length > 1) {
    lines.push(`נמצאו ${m.serieses.length} סדרות:`);
    for (const s of m.serieses.slice(0, 20)) lines.push(`  ${s.id}  "${s.title}" (${s.lang}) ${s.issueCount} גיליונות [${s.sources.map((x) => x.src).join('+')}]`);
    lines.push('חזור על הפקודה עם מזהה סדרה (s_...) כדי לראות את הפירוט.');
    return lines.join('\n');
  }
  if (m.series) {
    const s = m.series;
    lines.push(`סדרה ${s.id}: "${s.title}" שפה=${s.lang} סוג=${s.kind} גיליונות=${s.issueCount} שנים=${fmt(s.years)}`);
    lines.push(`  שמות נוספים: ${fmt(s.aliases)}; מזהים קודמים: ${fmt(s.previousIds)}`);
    for (const x of s.sources) lines.push(`  מקור ${x.src}: "${x.title}" (מזהה ${x.ext})`);
    const sample = data.issues.filter((i) => i.series === s.id).slice(0, SAMPLE_ISSUES);
    lines.push(`\nדגימה (${sample.length} מהחדשים):`);
    for (const i of sample) lines.push(`  ${i.id} ${fmt(i.date)} ${fmt(i.parasha)} "${i.title}" [${i.assets.map((a) => a.src).join('+')}]`);
    return lines.join('\n');
  }
  if (m.issue) {
    const i = m.issue;
    lines.push(`גיליון ${i.id}: "${i.title}" סדרה=${i.series} תאריך=${fmt(i.date)} שנה=${fmt(i.hy)} פרשה=${fmt(i.parasha)} אירוע=${fmt(i.event)} מספר=${fmt(i.no)} נוסף=${i.added}${i.archive ? ' (archive)' : ''}`);
  }
  const shown = m.items.slice(0, MAX_ITEMS);
  for (const it of shown) describeItem(it, lines);
  if (m.items.length > shown.length) lines.push(`\n(ועוד ${m.items.length - shown.length} עותקים; חדד את החיפוש)`);

  // Merge decisions of each distinct group the shown items belong to.
  const groups = new Map();
  for (const it of shown) groups.set(groupKey(it), data.items.filter((x) => groupKey(x) === groupKey(it)));
  for (const [key, members] of groups) {
    const trace = [];
    const clusters = clusterItems(members, trace);
    lines.push(`\nאיחוד בקבוצה ${key} (${members.length} עותקים → ${clusters.length} גיליונות):`);
    for (const t of trace) lines.push(`  · ${t}`);
    for (const c of clusters) lines.push(`  = גיליון: ${c.items.map(itemKey).join(' + ')}`);
  }
  return lines.join('\n');
}
