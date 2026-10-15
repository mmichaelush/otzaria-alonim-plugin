// When is an issue's `added` not news? `added` feeds "new" in the plugin, so a
// backfill or a bulk import must not look new. An issue gets `archive: true` when
//  1. its earliest upload is more than ARCHIVE_LAG_DAYS after the week it belongs to
//     (or after the end of its Hebrew year, when only the year is known), or
//  2. that upload falls on a day on which one source added BULK_DAY_MIN or more files
//     (a mass import; measured over the files seen in this run, so it needs a --full crawl).
// The flag is sticky: once set it stays (the earlier upload time does not become "newer").
import { daysBetween, hyEndIso } from './calendar.mjs';
import { dayOf } from './dates.mjs';

export const ARCHIVE_LAG_DAYS = 45;
export const BULK_DAY_MIN = 600;

/** Set of "src:YYYY-MM-DD" days with a mass import, from the items seen in this run. */
export function bulkDaysOf(items) {
  const count = new Map();
  for (const it of items) {
    if (!it.addedAt) continue;
    const k = `${it.src}:${dayOf(it.addedAt)}`;
    count.set(k, (count.get(k) || 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n >= BULK_DAY_MIN).map(([k]) => k));
}

/**
 * @param {{added:string, src:string, date?:string|null, hy?:number|null}} x  the earliest sighting and where it was
 * @param {Set<string>} bulkDays
 */
export function isArchive({ added, src, date, hy }, bulkDays = new Set()) {
  const day = dayOf(added);
  if (!day) return false;
  if (bulkDays.has(`${src}:${day}`)) return true;
  if (date) return daysBetween(date, day) > ARCHIVE_LAG_DAYS;
  if (hy) return daysBetween(hyEndIso(hy), day) > ARCHIVE_LAG_DAYS;
  return false;
}
