// gilyoines.com: Vue SPA over a JSON API.
//   GET /api/home                              current week + permanent material
//   GET /api/home/getGilyoines/<weekId>/<siteViewId>   any week (ids are not in
//        /api/home beyond the last 9; 191 is the first with data, March 2026)
// PDF: /storage/<pdf>. There is no per-gilyon page, so `page` is the site root.
import { collapse, isoSeconds, medianIso, safeUrl } from './util.mjs';
import { langFromName, stripLanguage } from '../lib/parasha.mjs';

export const id = 'gilyoines';
export const name = 'גיליוינעס';
export const url = 'https://gilyoines.com/';
export const mode = 'catalog';

// pdf and cover share /storage/; there is no per-gilyon page, so the site root is the template.
export const urlSpec = {
  urlBase: 'https://gilyoines.com/storage/',
  urlTemplates: { page: 'https://gilyoines.com/' },
};

const ORIGIN = 'https://gilyoines.com';
/** First week id with data when this connector was written. */
export const FIRST_WEEK_ID = 191;

/** One gilyoines[] element -> RawIssue. Pure. */
export function parseItem(g) {
  if (!g?.pdf) return null;
  const { core, lang: suffixLang } = stripLanguage(g.gilyon_type_hebrew_name || '');
  const lang = langFromName(g.language_hebrew_name) || suffixLang || null;
  const weekly = g.type === 'Gilyoines' && g.week_id != null;
  return {
    src: id,
    ext: String(g.id),
    rawTitle: collapse(g.gilyon_type_hebrew_name),
    seriesHint: { ext: g.gilyon_type_id != null ? String(g.gilyon_type_id) : null, title: collapse(core || g.gilyon_type_hebrew_name), lang },
    dateHint: null,
    weekHint: weekly ? { id: g.week_id, name: collapse(g.week_hebrew_name) } : null,
    timeless: !weekly,
    addedAt: g.created_at ? isoSeconds(g.created_at * 1000) : null,
    url: safeUrl(`${ORIGIN}/storage/${g.pdf}`),
    page: `${ORIGIN}/`,
    thumb: g.cover_image ? safeUrl(String(g.cover_image).replace(/\?.*$/, '')) : null,
    pages: Number.isFinite(g.pages) ? g.pages : null,
    rawMeta: { popular: g.popular ?? null },
  };
}

/** /api/home or getGilyoines response -> RawIssue[]. */
export function parseGilyoines(json) {
  return (json?.gilyoines || []).map(parseItem).filter(Boolean);
}

/** Weeks of one page of items get one reference time (median upload) for date resolution. */
export function withWeekRef(items) {
  const byWeek = new Map();
  for (const it of items) if (it.weekHint) (byWeek.get(it.weekHint.id) ?? byWeek.set(it.weekHint.id, []).get(it.weekHint.id)).push(it.addedAt);
  for (const it of items) if (it.weekHint) it.weekHint.refTime = medianIso(byWeek.get(it.weekHint.id));
  return items;
}

export async function probe({ http }) {
  const j = await http.getJson(`${ORIGIN}/api/home`);
  if (!Array.isArray(j?.gilyoines)) return { status: 'degraded', note: 'מבנה התשובה של /api/home השתנה' };
  return { status: 'ok', note: '' };
}

export async function* crawl({ http, log }, { full = false } = {}) {
  const home = await http.getJson(`${ORIGIN}/api/home`);
  const current = Number(home.currentWeek);
  const view = home.site_view_id;
  const seen = new Set();
  const emit = function* (items) { for (const it of withWeekRef(items)) if (!seen.has(it.ext)) { seen.add(it.ext); yield it; } };
  yield* emit(parseGilyoines(home));
  // Incremental: the last two weeks and the next few (published ahead of time).
  const from = full ? FIRST_WEEK_ID : current - 2;
  for (let w = from; w <= current + 4; w++) {
    const j = await http.getJson(`${ORIGIN}/api/home/getGilyoines/${w}/${view}`, { allow404: true });
    if (!j) continue;
    yield* emit(parseGilyoines(j));
    if (full && w % 10 === 0) log?.(`gilyoines week ${w}`);
  }
}
