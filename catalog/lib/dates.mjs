// Resolving which Shabbat/festival an item belongs to, from week labels,
// parasha + year, or an upload time. Pure functions over lib/calendar.mjs.
import { weeksBetween, weeksOfYear, hyOfIso, addDays, daysBetween, isoOfGreg, rowHasEvent } from './calendar.mjs';

const dayOf = (isoTs) => {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return null;
  // Civil date in Jerusalem, so a late-evening upload lands on the right day.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
export { dayOf };

/**
 * Week row for a label ({slugs:Set, events:[]}) near a reference time.
 * Parasha names match a Shabbat if they are all read there (diaspora or Israel,
 * because sources often print both: "קרח - שלח"). Events-only labels match the
 * first day of the nearest festival run. Returns a weeks row or null.
 */
export function resolveWeekLabel({ slugs, events }, refIso) {
  const ref = dayOf(refIso);
  if (!ref) return null;
  const rows = weeksBetween(addDays(ref, -400), addDays(ref, 400));
  const near = (cands) => cands.sort((a, b) => Math.abs(daysBetween(ref, a.date)) - Math.abs(daysBetween(ref, b.date)) || (a.date < b.date ? -1 : 1))[0] || null;
  if (slugs.size) {
    const cands = rows.filter((r) => r.shabbat && [...slugs].every((s) => r.parasha.includes(s) || r.parashaIL.includes(s)));
    return near(cands);
  }
  for (const ev of events) {
    const cands = rows.filter((r) => rowHasEvent(r, ev));
    if (!cands.length) continue;
    const best = near(cands);
    // First day of that festival run (rows within 10 days belong to one run).
    return cands.filter((r) => daysBetween(r.date, best.date) >= 0 && daysBetween(r.date, best.date) <= 10).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  }
  return null;
}

/** Parasha slugs read in the weeks around an upload time: licenses ambiguous names. */
export function expectedSlugs(refIso) {
  const ref = dayOf(refIso);
  if (!ref) return [];
  const out = new Set();
  for (const r of weeksBetween(addDays(ref, -10), addDays(ref, 24))) {
    for (const s of [...r.parasha, ...r.parashaIL]) out.add(s);
  }
  return [...out];
}

export { weeksOfYear, hyOfIso, isoOfGreg };
