// tashma.co.il/gilyonot (Laravel + Inertia). Public JSON the site's own UI uses:
//   /gilyonot/new                  newest 254 files with page_count and object_key
//   /gilyonot/list                 series folders
//   /gilyonot/g/<series>           series page; with X-Inertia headers it returns
//                                  every year/folder and file of the series in one JSON
// File: /gilyonot/file/{id} (PDF), thumbnail: /gilyonot/thumb/{id}.png,
// page: /gilyonot/{id}. We never touch admin/*, publisher/*, sendMail,
// api-internal or the content search.
import { collapse } from './util.mjs';

export const id = 'tashma';
export const name = 'תא שמע';
export const url = 'https://tashma.co.il/gilyonot';
export const mode = 'catalog';

const ORIGIN = 'https://tashma.co.il';
const BASE = `${ORIGIN}/gilyonot`;
const iso = (v) => (v ? new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);

function toRaw(f, { series, folder }) {
  return {
    src: id,
    ext: String(f.originalID ?? f.id),
    rawTitle: collapse(String(f.name).replace(/\.pdf$/i, '')),
    // A group folder ("0 כל הגליונות פר' בא תשפ''ו") often carries the week and year the file name lacks.
    contextTitles: folder ? [collapse(folder)] : [],
    seriesHint: { ext: series, title: collapse(series) },
    dateHint: null,
    addedAt: iso(f.createdTime),
    url: `${BASE}/file/${f.originalID ?? f.id}`,
    page: `${BASE}/${f.originalID ?? f.id}`,
    thumb: `${BASE}/thumb/${f.originalID ?? f.id}.png`,
    pages: Number.isFinite(f.page_count) ? f.page_count : null,
    rawMeta: { views: f.views ?? null, folder: folder || null },
  };
}

const isPdf = (f) => String(f.fileExtension || /\.(\w+)$/.exec(f.name || '')?.[1] || '').toLowerCase() === 'pdf' && !f.deleted_at;

/** /gilyonot/new -> RawIssue[]. object_key is "gilyonot/<series>/<folder>/<file>". */
export function parseNew(json) {
  const out = [];
  for (const f of json?.items || []) {
    if (!isPdf(f)) continue;
    const parts = String(f.object_key || '').split('/');
    const series = f.collection || parts[1];
    if (!series) continue;
    const folder = parts.length >= 4 ? parts[2] : '';
    out.push(toRaw(f, { series, folder }));
  }
  return out;
}

/** /gilyonot/list -> series folder names. */
export function parseSeriesList(json) {
  return (json?.items || []).filter((i) => i.type === 'folder').map((i) => i.name);
}

/** Inertia series page (props.years[].items[]) -> RawIssue[]. */
export function parseSeriesPage(json, series) {
  const out = [];
  for (const group of json?.props?.years || []) {
    for (const f of group.items || []) {
      if (!isPdf(f)) continue;
      const parts = String(f.object_key || '').split('/');
      const folder = parts.length >= 4 ? parts[2] : group.name || '';
      out.push(toRaw(f, { series, folder }));
    }
  }
  return out;
}

/** The asset version Inertia wants in X-Inertia-Version, from the HTML data-page attribute. */
export function parseInertiaVersion(html) {
  return /&quot;version&quot;:&quot;([^&]+)&quot;/.exec(html)?.[1] || /"version":"([^"]+)"/.exec(html)?.[1] || null;
}

export async function probe({ http }) {
  const j = await http.getJson(`${BASE}/new`);
  if (!Array.isArray(j?.items)) return { status: 'degraded', note: 'מבנה התשובה של /new השתנה' };
  return { status: 'ok', note: '' };
}

export async function* crawl({ http, log }, { full = false } = {}) {
  if (!full) {
    for (const it of parseNew(await http.getJson(`${BASE}/new`))) yield it;
    return;
  }
  const list = await http.getJson(`${BASE}/list`);
  const seriesNames = parseSeriesList(list);
  const version = parseInertiaVersion(await http.getText(BASE, { accept: 'text/html' }));
  const headers = { 'X-Requested-With': 'XMLHttpRequest', 'X-Inertia': 'true', ...(version ? { 'X-Inertia-Version': version } : {}) };
  let n = 0;
  for (const s of seriesNames) {
    const page = await http.getJson(`${BASE}/g/${encodeURIComponent(s)}`, { headers });
    for (const it of parseSeriesPage(page, s)) yield it;
    if (++n % 25 === 0) log?.(`tashma ${n}/${seriesNames.length} series`);
  }
}
