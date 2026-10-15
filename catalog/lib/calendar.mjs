// Jewish calendar layer (wraps @hebcal/core): Hebrew year of a date, weekly
// parasha per Shabbat (diaspora and Israel), festivals, fasts and Rosh Chodesh.
// All dates are ISO "YYYY-MM-DD" strings in the local civil calendar; we never
// go through UTC because that shifts midnight dates in Israel's timezone.
import { HDate, Sedra, HebrewCalendar } from '@hebcal/core';
import { EVENT_HE, EVENT_PRIORITY, SECONDARY_EVENTS, eventOfDesc, eventLabel, hebrewDateString } from './events.mjs';

export const PARASHA_SLUGS = [
  'bereshit', 'noach', 'lech-lecha', 'vayera', 'chayei-sara', 'toldot', 'vayetzei', 'vayishlach', 'vayeshev',
  'miketz', 'vayigash', 'vayechi', 'shemot', 'vaera', 'bo', 'beshalach', 'yitro', 'mishpatim', 'terumah',
  'tetzaveh', 'ki-tisa', 'vayakhel', 'pekudei', 'vayikra', 'tzav', 'shemini', 'tazria', 'metzora',
  'achrei-mot', 'kedoshim', 'emor', 'behar', 'bechukotai', 'bamidbar', 'nasso', 'behaalotcha', 'shlach',
  'korach', 'chukat', 'balak', 'pinchas', 'matot', 'masei', 'devarim', 'vaetchanan', 'eikev', 'reeh',
  'shoftim', 'ki-teitzei', 'ki-tavo', 'nitzavim', 'vayeilech', 'haazinu', 'vezot-haberakhah',
];
const SLUG_SET = new Set(PARASHA_SLUGS);
const SLUG_ALIASES = { shmini: 'shemini' };

/** Hebcal's English parasha name -> contract slug. */
export function parashaSlug(englishName) {
  const s = englishName.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, '-');
  const slug = SLUG_ALIASES[s] || s;
  if (!SLUG_SET.has(slug)) throw new Error(`unknown parasha from hebcal: ${englishName}`);
  return slug;
}

export const pad = (n) => String(n).padStart(2, '0');
export const isoOfGreg = (g) => `${g.getFullYear()}-${pad(g.getMonth() + 1)}-${pad(g.getDate())}`;
const isoOfHDate = (hd) => isoOfGreg(hd.greg());

export function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

export function addDays(iso, n) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoOfGreg(d);
}

export function daysBetween(a, b) {
  const da = parseIso(a), db = parseIso(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
}

/** Hebrew year (e.g. 5787) of a civil date; null on garbage input. */
export function hyOfIso(iso) {
  const d = parseIso(iso);
  return d ? new HDate(d).getFullYear() : null;
}

/** Hebrew year of an ISO timestamp, using the Jerusalem civil date. */
export function hyOfTimestamp(ts) {
  const t = new Date(ts);
  if (Number.isNaN(t.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  return hyOfIso(parts);
}

/** "כ״ז בחשוון תשפ״ז" for a civil date. */
export const hebrewDateOf = (iso) => hebrewDateString(new HDate(parseIso(iso)));

const PARASHA_HE_LABEL = {
  bereshit: 'בראשית', noach: 'נח', 'lech-lecha': 'לך לך', vayera: 'וירא', 'chayei-sara': 'חיי שרה', toldot: 'תולדות',
  vayetzei: 'ויצא', vayishlach: 'וישלח', vayeshev: 'וישב', miketz: 'מקץ', vayigash: 'ויגש', vayechi: 'ויחי',
  shemot: 'שמות', vaera: 'וארא', bo: 'בא', beshalach: 'בשלח', yitro: 'יתרו', mishpatim: 'משפטים', terumah: 'תרומה',
  tetzaveh: 'תצוה', 'ki-tisa': 'כי תשא', vayakhel: 'ויקהל', pekudei: 'פקודי', vayikra: 'ויקרא', tzav: 'צו',
  shemini: 'שמיני', tazria: 'תזריע', metzora: 'מצורע', 'achrei-mot': 'אחרי מות', kedoshim: 'קדושים', emor: 'אמור',
  behar: 'בהר', bechukotai: 'בחוקותי', bamidbar: 'במדבר', nasso: 'נשא', behaalotcha: 'בהעלותך', shlach: 'שלח',
  korach: 'קרח', chukat: 'חוקת', balak: 'בלק', pinchas: 'פינחס', matot: 'מטות', masei: 'מסעי', devarim: 'דברים',
  vaetchanan: 'ואתחנן', eikev: 'עקב', reeh: 'ראה', shoftim: 'שופטים', 'ki-teitzei': 'כי תצא', 'ki-tavo': 'כי תבוא',
  nitzavim: 'נצבים', vayeilech: 'וילך', haazinu: 'האזינו', 'vezot-haberakhah': 'וזאת הברכה',
};
export const parashaLabelHe = (slug) => PARASHA_HE_LABEL[slug];
export const parashaLabel = (slugs) => (slugs || []).map(parashaLabelHe).join('־');

const yearCache = new Map();

/**
 * Day-by-day facts for one Hebrew year (Tishrei to Elul):
 * Map<iso, { events:Set<slug>, rcMonth?, shabbat, chag, parasha, parashaIL }>.
 * Events follow the diaspora calendar; Israel differs only in the second day of
 * festivals, which is why `parashaIL` is kept separately for Shabbatot.
 */
function yearFacts(hy) {
  if (yearCache.has(hy)) return yearCache.get(hy);
  const facts = new Map();
  const get = (iso) => {
    let f = facts.get(iso);
    if (!f) { f = { events: new Set(), parasha: [], parashaIL: [], shabbat: false, chag: false }; facts.set(iso, f); }
    return f;
  };
  const events = HebrewCalendar.calendar({
    year: hy, isHebrewYear: true, sedrot: false, il: false, noMinorFast: false, noModern: true, noRoshChodesh: false,
    noSpecialShabbat: false, candlelighting: false,
  });
  const rcFirst = new Map(); // Hebcal month -> first Rosh Chodesh day
  for (const ev of events) {
    const e = eventOfDesc(ev.getDesc());
    if (!e) continue;
    const iso = isoOfHDate(ev.getDate());
    const f = get(iso);
    f.events.add(e.slug);
    if (e.month) {
      f.rcMonth = e.month;
      if (!rcFirst.has(e.month) || iso < rcFirst.get(e.month)) rcFirst.set(e.month, iso);
    }
  }
  // Hebcal's "modern" flag hides Lag BaOmer / Tu BiShvat on some versions; add them explicitly.
  for (const [mm, dd, slug] of [['Shvat', 15, 'tu-bishvat'], ['Iyyar', 18, 'lag-baomer']]) {
    get(isoOfHDate(new HDate(dd, mm, hy))).events.add(slug);
  }
  // Ten Days of Repentance (3-9 Tishrei, between the days that are events of their own).
  for (let d = 3; d <= 9; d++) get(isoOfHDate(new HDate(d, 'Tishrei', hy))).events.add('aseret-yemei-teshuva');
  // Shabbat Mevarchim: the last Shabbat before each Rosh Chodesh.
  for (const first of rcFirst.values()) {
    const d = parseIso(first);
    do { d.setDate(d.getDate() - 1); } while (d.getDay() !== 6);
    get(isoOfGreg(d)).events.add('shabbat-mevarchim');
  }
  const sedraD = new Sedra(hy, false);
  const sedraIL = new Sedra(hy, true);
  const start = new HDate(1, 'Tishrei', hy).abs();
  const end = new HDate(1, 'Tishrei', hy + 1).abs() - 1;
  for (let abs = start; abs <= end; abs++) {
    const hd = new HDate(abs);
    if (hd.getDay() !== 6) continue;
    const f = get(isoOfHDate(hd));
    f.shabbat = true;
    const d = sedraD.lookup(hd), il = sedraIL.lookup(hd);
    f.chag = d.chag;
    f.parasha = d.chag ? [] : d.parsha.map(parashaSlug);
    f.parashaIL = il.chag ? [] : il.parsha.map(parashaSlug);
  }
  yearCache.set(hy, facts);
  return facts;
}

/** The highest-priority event of a set; secondary ones (Mevarchim, Ten Days) never win. */
function pickEvent(events) {
  for (const e of EVENT_PRIORITY) if (events.has(e) && !SECONDARY_EVENTS.has(e)) return e;
  return null;
}

function labelFor(parasha, parashaIL, event, month) {
  const evHe = event ? eventLabel(event, month) : '';
  const part = (p) => parashaLabel(p) || evHe;
  const d = part(parasha), il = part(parashaIL);
  let label = d;
  if (il && il !== d) label = `${d} · ${il}`;
  // The event shown beside a parasha (not when it already is the label).
  if (event && parashaLabel(parasha) && evHe) label += ` – ${evHe}`;
  return label;
}

const rowsCache = new Map();

/**
 * @typedef {object} WeekRow  one line of weeks.json
 * @property {string} date          ISO date (a Shabbat, or the first day of a festival/fast/Rosh Chodesh)
 * @property {number} hy            Hebrew year of `date`
 * @property {string} hebrew        Hebrew date, "כ״ז בחשוון תשפ״ז"
 * @property {string[]} parasha     diaspora reading (empty on festival Shabbatot and weekday rows)
 * @property {string[]} parashaIL   Israel reading
 * @property {string} label         display label (Hebrew)
 * @property {string|null} event    primary event slug (lib/events.mjs), or null
 * @property {string[]} [events]    every event of that day when there are several
 * @property {boolean} shabbat      false for weekday rows
 * @property {string} [rcMonth]     internal: Hebcal month of a Rosh Chodesh (not written)
 */

/**
 * Rows of one Hebrew year, sorted by date: every Shabbat, plus a row for each
 * weekday on which an event begins (first day of a festival, a fast, Rosh Chodesh).
 * Multi-day events (Chanukah, Chol HaMoed) get a row on their first day only.
 * @param {number} hy
 * @returns {WeekRow[]}
 */
export function weeksOfYear(hy) {
  if (rowsCache.has(hy)) return rowsCache.get(hy);
  const facts = yearFacts(hy);
  const rows = [];
  for (const iso of [...facts.keys()].sort()) {
    const f = facts.get(iso);
    const prev = facts.get(addDays(iso, -1));
    const all = EVENT_PRIORITY.filter((e) => f.events.has(e));
    const base = { date: iso, hy: hyOfIso(iso), hebrew: hebrewDateOf(iso), ...(f.rcMonth ? { rcMonth: f.rcMonth } : {}) };
    const extra = all.length && !(all.length === 1 && all[0] === pickEvent(f.events)) ? { events: all } : {};
    if (f.shabbat) {
      const event = pickEvent(f.events);
      rows.push({ ...base, parasha: f.parasha, parashaIL: f.parashaIL, label: labelFor(f.parasha, f.parashaIL, event, f.rcMonth), event, ...extra, shabbat: true });
      continue;
    }
    // Weekday: a row where an event starts (it was not already running the day before).
    const starting = new Set([...f.events].filter((e) => !prev?.events.has(e) && !SECONDARY_EVENTS.has(e)));
    const event = pickEvent(starting);
    if (!event) continue;
    rows.push({ ...base, parasha: [], parashaIL: [], label: eventLabel(event, f.rcMonth), event, ...extra, shabbat: false });
  }
  rowsCache.set(hy, rows);
  return rows;
}

/** weeks.json rows covering [from, to] (inclusive ISO dates). */
export function weeksBetween(from, to) {
  const rows = [];
  for (let hy = hyOfIso(from) - 1; hy <= hyOfIso(to) + 1; hy++) {
    for (const r of weeksOfYear(hy)) if (r.date >= from && r.date <= to) rows.push(r);
  }
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.date) && seen.add(r.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Whether a row is, or carries, an event. */
export const rowHasEvent = (row, slug) => row.event === slug || (row.events ? row.events.includes(slug) : false);

/**
 * The Shabbat (or festival day) an item belongs to, from a parasha/event and a
 * Hebrew year. Returns an ISO date or null when it is not unique.
 * `slugs` are parasha slugs; matching prefers the diaspora reading.
 * For `event: 'rosh-chodesh'` pass `month` (a Hebcal month name, see MONTHS in events.mjs).
 */
export function findDate({ hy, slugs = [], event = null, month = null }) {
  if (!hy) return null;
  const rows = weeksOfYear(hy);
  if (slugs.length) {
    const key = [...slugs].sort().join(',');
    const exact = rows.filter((r) => r.shabbat && [...r.parasha].sort().join(',') === key);
    if (exact.length === 1) return exact[0].date;
    const exactIL = rows.filter((r) => r.shabbat && [...r.parashaIL].sort().join(',') === key);
    if (!exact.length && exactIL.length === 1) return exactIL[0].date;
    // A lone name that is half of a diaspora double reading (e.g. "מטות" in a year reading matot-masei).
    const part = rows.filter((r) => r.shabbat && slugs.every((s) => r.parasha.includes(s) || r.parashaIL.includes(s)));
    if (part.length === 1) return part[0].date;
    return null;
  }
  if (event) {
    const isRc = event === 'rosh-chodesh';
    if (isRc && !month) return null;
    const hit = rows.filter((r) => rowHasEvent(r, event) && (!isRc || r.rcMonth === month));
    // The row where the event starts wins over a Shabbat inside it.
    const starting = hit.filter((r) => r.event === event);
    if (starting.length) return starting[0].date;
    if (hit.length && !isRc) return hit[0].date;
  }
  return null;
}

const rowIndexCache = new Map();
/** The row for a date, if any (used to fill event/label). */
export function weekRowOf(iso) {
  const hy = hyOfIso(iso);
  let idx = rowIndexCache.get(hy);
  if (!idx) { idx = new Map(weeksOfYear(hy).map((r) => [r.date, r])); rowIndexCache.set(hy, idx); }
  return idx.get(iso) || null;
}

/** Nearest Shabbat on or after an ISO date. */
export function shabbatOnOrAfter(iso) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return isoOfGreg(d);
}

export { EVENT_HE };
