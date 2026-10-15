// alonolam.com (WordPress). Only GET /wp-json/gallery/v1/list is used; the
// upload/delete/sync/track/counters/bulk endpoints of that API are never called.
// The list is a flat array of files with only the file name as metadata, so the
// series, parasha and year are derived from the name (confidence in rawMeta).
import { collapse } from './util.mjs';
import { analyzeTitle, stripFileNoise, stripLanguage, guessLang } from '../lib/parasha.mjs';

export const id = 'alonolam';
export const name = 'עלון עולם';
export const url = 'https://alonolam.com/';
export const mode = 'catalog';

const LIST = 'https://alonolam.com/wp-json/gallery/v1/list';
const GALLERY_PAGE = 'https://alonolam.com/%d7%92%d7%9c%d7%a8%d7%99%d7%94/';
// Absolute https URL with the path percent-encoded (the source mixes raw Hebrew and %-escapes).
const https = (u) => {
  try { return new URL(String(u).replace(/^http:\/\//, 'https://')).href; } catch { return null; }
};

/** Upload month from "/wp-content/uploads/2026/10/..." -> "2026-10" (the only date the source gives). */
export function uploadMonth(u) {
  const m = /\/wp-content\/uploads\/(\d{4})\/(\d{2})\//.exec(u || '');
  return m ? `${m[1]}-${m[2]}` : null;
}

/** /wp-json/gallery/v1/list -> RawIssue[]. PDFs only. */
export function parseList(json) {
  const out = [];
  for (const f of Array.isArray(json) ? json : []) {
    if (String(f.ext).toLowerCase() !== 'pdf' || !f.url) continue;
    const original = collapse(f.originalName || f.name);
    const a = analyzeTitle(original);
    // Series = what remains of the name after parasha, year and number are removed.
    const { core, lang } = stripLanguage(a.title);
    const month = uploadMonth(f.url);
    out.push({
      src: id,
      ext: String(f.id),
      rawTitle: stripFileNoise(original),
      seriesHint: { ext: null, title: core, lang: lang || guessLang(core), derived: true },
      dateHint: null,
      refMonth: month,
      addedAt: null,
      url: https(f.url),
      page: GALLERY_PAGE,
      thumb: https(f.thumb),
      bytes: Number.isFinite(f.sizeBytes) ? f.sizeBytes : null,
      downloads: Number.isFinite(f.downloads) ? f.downloads : null,
      rawMeta: { confidence: a.title ? (a.slugs.length || a.hy ? 'medium' : 'low') : 'none', views: f.views ?? null },
    });
  }
  return out;
}

export async function probe({ http }) {
  const j = await http.getJson(LIST);
  if (!Array.isArray(j)) return { status: 'degraded', note: 'מבנה הרשימה השתנה' };
  return { status: 'ok', note: 'מטא-דאטה דלה: הסדרה והפרשה נגזרות משם הקובץ' };
}

export async function* crawl({ http }) {
  for (const it of parseList(await http.getJson(LIST))) yield it;
}
