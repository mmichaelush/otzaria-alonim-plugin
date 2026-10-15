// Jewish calendar layer (wraps @hebcal/core): Hebrew year of a date, weekly
// parasha per Shabbat (diaspora and Israel) and festival days.
// All dates are ISO "YYYY-MM-DD" strings in the local civil calendar; we never
// go through UTC because that shifts midnight dates in Israel's timezone.
import { HDate, Sedra, HebrewCalendar, flags } from '@hebcal/core';

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

// Event slugs (CATALOG_FORMAT weeks.json). Hebrew names are used for labels.
export const EVENT_HE = {
  'rosh-hashana': 'ראש השנה',
  'shabbat-shuva': 'שבת שובה',
  'yom-kippur': 'יום כיפור',
  sukkot: 'סוכות',
  'shemini-atzeret': 'שמיני עצרת',
  chanukah: 'חנוכה',
  'tu-bishvat': 'ט״ו בשבט',
  'shabbat-shirah': 'שבת שירה',
  'shabbat-shekalim': 'שבת שקלים',
  'shabbat-zachor': 'שבת זכור',
  purim: 'פורים',
  'shabbat-parah': 'שבת פרה',
  'shabbat-hachodesh': 'שבת החודש',
  'shabbat-hagadol': 'שבת הגדול',
  pesach: 'פסח',
  'lag-baomer': 'ל״ג בעומר',
  shavuot: 'שבועות',
  'shabbat-chazon': 'שבת חזון',
  'tisha-bav': 'תשעה באב',
  'shabbat-nachamu': 'שבת נחמו',
};
// Higher wins when one Shabbat carries several events.
const EVENT_PRIORITY = [
  'rosh-hashana', 'yom-kippur', 'sukkot', 'shemini-atzeret', 'pesach', 'shavuot', 'chanukah', 'purim', 'tisha-bav',
  'shabbat-shuva', 'shabbat-hagadol', 'shabbat-zachor', 'shabbat-parah', 'shabbat-hachodesh', 'shabbat-shekalim',
  'shabbat-chazon', 'shabbat-nachamu', 'shabbat-shirah', 'tu-bishvat', 'lag-baomer',
];

function eventOfDesc(desc) {
  if (/^Erev |^Shushan Purim|^Pesach Sheni|^Purim (Katan|Meshulash)|^Leil Selichot|^Chag HaBanot|Rosh Hashana LaBehemot/.test(desc)) return null;
  if (/^Rosh Hashana/.test(desc)) return 'rosh-hashana';
  if (desc === 'Yom Kippur') return 'yom-kippur';
  if (/^Sukkot/.test(desc)) return 'sukkot';
  if (desc === 'Shmini Atzeret' || desc === 'Simchat Torah') return 'shemini-atzeret';
  if (/^Chanukah/.test(desc)) return 'chanukah';
  if (/^Pesach/.test(desc)) return 'pesach';
  if (/^Shavuot/.test(desc)) return 'shavuot';
  if (desc === 'Purim') return 'purim';
  if (desc === "Tish'a B'Av") return 'tisha-bav';
  if (desc === 'Tu BiShvat') return 'tu-bishvat';
  if (desc === 'Lag BaOmer') return 'lag-baomer';
  const sp = { 'Shabbat Shuva': 'shabbat-shuva', 'Shabbat Shekalim': 'shabbat-shekalim', 'Shabbat Zachor': 'shabbat-zachor',
    'Shabbat Parah': 'shabbat-parah', 'Shabbat HaChodesh': 'shabbat-hachodesh', 'Shabbat HaGadol': 'shabbat-hagadol',
    'Shabbat Shirah': 'shabbat-shirah', 'Shabbat Chazon': 'shabbat-chazon', 'Shabbat Nachamu': 'shabbat-nachamu' };
  return sp[desc] || null;
}

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

/** Day-by-day facts for one Hebrew year: { [iso]: { events:Set, shabbat, parasha, parashaIL } }. */
function yearFacts(hy) {
  if (yearCache.has(hy)) return yearCache.get(hy);
  const facts = new Map();
  const get = (iso) => {
    let f = facts.get(iso);
    if (!f) { f = { events: new Set(), parasha: [], parashaIL: [], shabbat: false, chag: false }; facts.set(iso, f); }
    return f;
  };
  const events = HebrewCalendar.calendar({
    year: hy, isHebrewYear: true, sedrot: false, il: false, noMinorFast: true, noModern: true, noRoshChodesh: true,
    noSpecialShabbat: false, candlelighting: false,
  });
  for (const ev of events) {
    const slug = eventOfDesc(ev.getDesc());
    if (slug) get(isoOfHDate(ev.getDate())).events.add(slug);
  }
  // Lag BaOmer and Tu BiShvat are "modern" in hebcal's flags on some versions; add them explicitly.
  for (const [mm, dd, slug] of [['Shvat', 15, 'tu-bishvat'], ['Iyyar', 18, 'lag-baomer']]) {
    get(isoOfHDate(new HDate(dd, mm, hy))).events.add(slug);
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

function pickEvent(events) {
  for (const e of EVENT_PRIORITY) if (events.has(e)) return e;
  return null;
}

function labelFor(parasha, parashaIL, event) {
  const evHe = event ? EVENT_HE[event] : '';
  const part = (p) => parashaLabel(p) || evHe;
  const d = part(parasha), il = part(parashaIL);
  let label = d;
  if (il && il !== d) label = `${d} · ${il}`;
  // The event shown beside a parasha (not when it already is the label).
  if (event && parashaLabel(parasha) && evHe) label += ` – ${evHe}`;
  return label;
}

/**
 * weeks.json rows for a Hebrew year: every Shabbat, plus one row for the first
 * day of each festival that does not fall on Shabbat (shabbat:false). Rows are
 * sorted by date.
 */
export function weeksOfYear(hy) {
  const facts = yearFacts(hy);
  const rows = [];
  for (const iso of [...facts.keys()].sort()) {
    const f = facts.get(iso);
    const event = pickEvent(f.events);
    if (f.shabbat) {
      rows.push({ date: iso, hy: hyOfIso(iso), parasha: f.parasha, parashaIL: f.parashaIL, label: labelFor(f.parasha, f.parashaIL, event), event, shabbat: true });
    } else if (event && !facts.get(addDays(iso, -1))?.events.has(event)) {
      // Only the first day of a multi-day festival gets its own row.
      rows.push({ date: iso, hy: hyOfIso(iso), parasha: [], parashaIL: [], label: EVENT_HE[event], event, shabbat: false });
    }
  }
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

/**
 * The Shabbat (or festival day) an item belongs to, from a parasha/event and a
 * Hebrew year. Returns an ISO date or null when it is not unique.
 * `slugs` are parasha slugs; matching prefers the diaspora reading.
 */
export function findDate({ hy, slugs = [], event = null }) {
  if (!hy) return null;
  const rows = [...weeksOfYear(hy)];
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
    const hit = rows.filter((r) => r.event === event);
    // First occurrence: the first Shabbat/festival row of that event in the year.
    if (hit.length) return hit[0].date;
  }
  return null;
}

/** The row for a date, if any (used to fill event/label). */
export function weekRowOf(iso) {
  return weeksOfYear(hyOfIso(iso)).find((r) => r.date === iso) || null;
}

/** Nearest Shabbat on or after an ISO date. */
export function shabbatOnOrAfter(iso) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return isoOfGreg(d);
}

export { flags };
