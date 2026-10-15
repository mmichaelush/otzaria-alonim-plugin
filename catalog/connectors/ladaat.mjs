// ladaat.co/gilyonot: Express app with a JSON listing per Shabbat date.
//   GET /gilyonot/api/files?name=&language=&category=&date=YYYY-MM-DD&sort=&offset=&limit=500
// The date select on the home page lists only the recent weeks; the API with an
// empty date returns just the current week, so older weeks are probed by date.
import { collapse, encodePath, isoSeconds } from './util.mjs';
import { langFromName } from '../lib/parasha.mjs';
import { weeksBetween, addDays } from '../lib/calendar.mjs';

export const id = 'ladaat';
export const name = 'לדעת';
export const url = 'https://ladaat.co/gilyonot/';
export const mode = 'catalog';

const BASE = 'https://ladaat.co/gilyonot/';
const PAGE_LIMIT = 500;

/** Home page -> { dates:[{date,label}] } from <select id="filter-date">. */
export function parseHome(html) {
  const block = /<select[^>]*id="filter-date"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] || '';
  const dates = [];
  for (const m of block.matchAll(/<option\s+value="(\d{4}-\d{2}-\d{2})"[^>]*>\s*([^<]*?)\s*<\/option>/g)) {
    dates.push({ date: m[1], label: collapse(m[2]) });
  }
  return { dates };
}

/** One /api/files response -> RawIssue[]. Pure. */
export function parseFiles(json) {
  const out = [];
  for (const f of json?.files || []) {
    if (!f?.file_path || !/\.pdf$/i.test(f.file_path)) continue;
    const parts = f.file_path.split('/'); // uploads/<date>/files/<name>
    const date = /^\d{4}-\d{2}-\d{2}$/.test(parts[1]) ? parts[1] : null;
    const fileName = parts[parts.length - 1];
    // "[37]-אסיפת-גליונות-נח.pdf": the number in brackets is the series id at the source.
    const sm = /^\[(\d+)\]-?(.*)$/.exec(fileName);
    const stem = (sm ? sm[2] : fileName).replace(/\.pdf$/i, '').replace(/-/g, ' ');
    out.push({
      src: id,
      ext: String(f.id),
      rawTitle: collapse(stem),
      seriesHint: {
        ext: sm ? sm[1] : null,
        title: collapse(f.name),
        lang: langFromName(f.language),
        circle: f.category ? collapse(f.category) : null,
      },
      dateHint: date,
      addedAt: f.uploaded_at ? isoSeconds(f.uploaded_at) : null,
      url: BASE + encodePath(f.file_path),
      page: `${BASE}view/${f.id}`,
      thumb: f.thumbnail_path ? BASE + encodePath(f.thumbnail_path) : null,
      downloads: Number.isFinite(f.downloads) ? f.downloads : null,
    });
  }
  return out;
}

const filesUrl = (date, offset) =>
  `${BASE}api/files?name=&language=&category=&date=${date}&sort=&offset=${offset}&limit=${PAGE_LIMIT}`;

export async function probe({ http }) {
  const html = await http.getText(BASE, { accept: 'text/html' });
  const { dates } = parseHome(html);
  if (!dates.length) return { status: 'degraded', note: 'לא נמצאה רשימת שבועות בדף הבית' };
  return { status: 'ok', note: '' };
}

/**
 * Incremental: the weeks listed on the home page (recent and next).
 * Full: additionally every Shabbat/festival date of the last three years,
 * because older weeks are not listed anywhere (most are empty).
 */
export async function* crawl({ http, now, log }, { full = false } = {}) {
  const html = await http.getText(BASE, { accept: 'text/html' });
  const dates = new Set(parseHome(html).dates.map((d) => d.date));
  if (full) {
    const today = now.slice(0, 10);
    for (const r of weeksBetween(addDays(today, -3 * 366), addDays(today, 14))) dates.add(r.date);
  }
  for (const date of [...dates].sort().reverse()) {
    for (let offset = 0; ; offset += PAGE_LIMIT) {
      const json = await http.getJson(filesUrl(date, offset));
      const items = parseFiles(json);
      for (const it of items) yield it;
      if (!json?.hasMore || !(json?.files || []).length) break;
    }
    log?.(`ladaat ${date} done`);
  }
}
