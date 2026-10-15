// Turns a connector's RawIssue into a normalized item: series identity, week
// (date, Hebrew year, parasha, event), issue number and display title. This is
// the one place where text and hints become facts, so connectors stay dumb.
import { createHash } from 'node:crypto';
import { normalizeKey } from './normalize.mjs';
import { analyzeTitle, tokenize, stripFileNoise, stripLanguage, guessLang, weekLabelParts } from './parasha.mjs';
import { hyOfIso, hyOfTimestamp, findDate, weekRowOf, addDays, daysBetween } from './calendar.mjs';
import { resolveWeekLabel, expectedSlugs, dayOf } from './dates.mjs';
import { safeUrl } from '../connectors/util.mjs';

export const sha1 = (s) => createHash('sha1').update(s).digest('hex');

// Words that name a kind of publication, not which one: removed from the series key.
const GENERIC = new Set(['עלון', 'גליון', 'גיליון', 'שבועי', 'לשבת', 'פרשת', 'פרשה']
  .map((w) => normalizeKey(w)));

/** The part of a series title that identifies it (generic words, numbers, years, parasha names removed). */
export function seriesCore(title) {
  const a = analyzeTitle(title);
  const words = tokenize(a.title).map((t) => t.n).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w));
  return words.join(' ');
}

/** Loads alias maps: { keyToCanonicalKey, canonicalPrev: Map<canonicalKey, previousKeys[]> }. */
export function buildAliasIndex(aliases) {
  const toCanonical = new Map();
  const previous = new Map();
  for (const entry of aliases?.merge || []) {
    const canon = seriesCore(entry.canonical) || normalizeKey(entry.canonical);
    for (const a of entry.aliases || []) {
      const k = seriesCore(a) || normalizeKey(a);
      if (k && k !== canon) {
        toCanonical.set(k, canon);
        (previous.get(canon) ?? previous.set(canon, []).get(canon)).push(k);
      }
    }
  }
  // the canonical entry also decides which title is shown
  const canonicalTitle = new Map((aliases?.merge || []).map((m) => [seriesCore(m.canonical) || normalizeKey(m.canonical), m.canonical]));
  const noMerge = new Set((aliases?.noMerge || []).map((t) => seriesCore(t) || normalizeKey(t)));
  return { toCanonical, previous, noMerge, canonicalTitle };
}

/**
 * Canonical series key. Languages other than Hebrew make separate series
 * ("הבינני" vs "הבינני - אידיש"), since a series has one `lang`.
 */
export function seriesIdentity(rawTitle, lang, src, aliasIndex) {
  const { core: noLang, lang: suffixLang } = stripLanguage(stripFileNoise(rawTitle));
  const useLang = lang || suffixLang || guessLang(noLang);
  let core = seriesCore(noLang);
  if (aliasIndex?.toCanonical.has(core)) core = aliasIndex.toCanonical.get(core);
  const named = !!core;
  const base = named ? core : `~unnamed:${src}`;
  const key = useLang === 'he' ? base : `${base}|${useLang}`;
  return { key, id: `s_${sha1(key).slice(0, 10)}`, displayTitle: noLang, lang: useLang, named, core };
}

/**
 * @param raw RawIssue from a connector
 * @param ctx { now:ISO, aliasIndex }
 */
/** Key under which a source's series is judged weekly or not. */
export const weeklyKey = (raw) => `${raw.src}|${raw.seriesHint?.title ?? ''}`;

/**
 * Series (per source) in which at least WEEKLY_MIN_SHARE of at least WEEKLY_MIN_ITEMS titles name a
 * parasha without help: those titles are weekly, so a bare ambiguous name is believed there.
 */
export const WEEKLY_MIN_ITEMS = 5;
export const WEEKLY_MIN_SHARE = 0.3;
export function weeklySeriesOf(raws) {
  const count = new Map();
  for (const r of raws) {
    const k = weeklyKey(r);
    const c = count.get(k) ?? count.set(k, { n: 0, par: 0 }).get(k);
    c.n++;
    if (analyzeTitle(r.rawTitle).slugs.length) c.par++;
  }
  return new Set([...count].filter(([, c]) => c.n >= WEEKLY_MIN_ITEMS && c.par / c.n >= WEEKLY_MIN_SHARE).map(([k]) => k));
}

/**
 * @typedef {object} RawIssue  what a connector yields (see connectors/*.mjs)
 * @property {string} src @property {string} ext @property {string} rawTitle
 * @property {{ext?: string|null, title: string, lang?: string|null, circle?: string|null}} seriesHint
 * @property {string|null} [dateHint]   the source's own date for the week (ladaat)
 * @property {{id: number, name: string, refTime?: string}|null} [weekHint]  the source's week label (gilyoines)
 * @property {string[]} [contextTitles] folder names that may carry the week/year (tashma)
 * @property {string|null} [refMonth]   upload month "YYYY-MM" when it is the only date (alonolam)
 * @property {boolean} [timeless] @property {string|null} [addedAt]
 * @property {string} [url] @property {string} [page] @property {string} [thumb]
 * @property {number|null} [bytes] @property {number|null} [pages] @property {number|null} [downloads]
 */

/**
 * @typedef {object} Item  a RawIssue after enrich(): every fact the merge needs
 * @property {string} src @property {string} ext
 * @property {{key: string, id: string, displayTitle: string, lang: string, named: boolean, core: string}} series
 * @property {string} title            display title of this copy
 * @property {string} variant          what is left of the title after the series' own words
 * @property {number|null} no          issue number
 * @property {string|null} date        the Shabbat/festival date the copy belongs to
 * @property {number|null} hy          Hebrew year
 * @property {string[]} slugs          parasha slugs
 * @property {string|null} event       event slug of that week
 * @property {'source-date'|'week-label'|'parasha-year'|'event-year'|'upload-time'|'timeless'|'prev'|'none'} how  who decided `date`
 * @property {string[]} notes          doubts and special decisions
 * @property {string[]} [trace]        step-by-step reasoning (only when ctx.trace)
 */

const slugList = (s) => (s?.length ? s.join('+') : '-');

/** Text facts of a title and of the folders it sits in: parasha, year, events, number. */
function textFacts(raw, ctx, expect, notes, T) {
  // A year after next year is a misreading ("תשצ" is not 5790), never a real issue.
  const maxHy = hyOfTimestamp(ctx.now) + 1;
  const sane = (x) => (x.hy && x.hy > maxHy ? { ...x, hy: null } : x);
  let a = sane(analyzeTitle(raw.rawTitle, { expect }));
  T(`כותרת "${raw.rawTitle}": פרשה=${slugList(a.slugs)} שנה=${a.hy ?? '-'} אירועים=${a.events.join(',') || '-'} מספר=${a.no ?? '-'} (שאריות: "${a.title}")`);
  // A series known to be weekly (most of its titles name a parasha) may use the relaxed reading
  // of ambiguous names, e.g. a title that ends in "שלח" (lib/parasha.mjs, relaxed).
  if (!a.slugs.length && !raw.dateHint && !raw.weekHint && ctx.weeklySeries?.has(weeklyKey(raw))) {
    const r = sane(analyzeTitle(raw.rawTitle, { expect, relaxed: true }));
    if (r.slugs.length) { a = r; notes.push('parasha-relaxed'); T(`סדרה שבועית: קריאה מקלה של השם → ${slugList(r.slugs)}`); }
  }
  let fromFolder = false;
  for (const ctxTitle of raw.contextTitles || []) {
    const f = sane(analyzeTitle(ctxTitle, { expect }));
    if (!a.slugs.length && f.slugs.length) { a = { ...a, slugs: f.slugs }; fromFolder = true; T(`תיקייה "${ctxTitle}": פרשה ${slugList(f.slugs)}`); }
    if (!a.hy && f.hy) { a = { ...a, hy: f.hy }; T(`תיקייה "${ctxTitle}": שנה ${f.hy}`); }
    if (!a.events.length && f.events.length) { a = { ...a, events: f.events, rcMonth: f.rcMonth }; T(`תיקייה "${ctxTitle}": אירוע ${f.events.join(',')}`); }
  }
  return { a, fromFolder };
}

/**
 * Which week the copy belongs to. Order of authority: the source's date, the source's week
 * label, then text (parasha/event + year, or an upload time for fresh uploads).
 * @returns {{date: string|null, hy: number|null, slugs: string[], how: Item['how']}}
 */
function resolveWeek(raw, a, ctx, fresh, notes, T) {
  const now = ctx.now;
  let date = null, hy = a.hy, slugs = a.slugs, how = 'none';
  if (raw.dateHint) {
    date = raw.dateHint;
    hy = hyOfIso(date);
    how = 'source-date';
    T(`תאריך מהמקור: ${date}`);
  } else if (raw.weekHint?.name) {
    const parts = weekLabelParts(raw.weekHint.name);
    const row = resolveWeekLabel(parts, raw.weekHint.refTime || raw.addedAt || now);
    if (row) { date = row.date; hy = row.hy; how = 'week-label'; T(`שם שבוע "${raw.weekHint.name}" → ${date} (${row.label})`); }
    else {
      hy = hyOfTimestamp(raw.weekHint.refTime || raw.addedAt || now);
      slugs = [...parts.slugs];
      notes.push('week-label-unresolved');
      T(`שם שבוע "${raw.weekHint.name}" לא נפתר לתאריך`);
    }
  } else if (raw.timeless) {
    hy = null; slugs = [];
    how = 'timeless';
    T('חומר קבוע (בלי שבוע ובלי שנה)');
  } else {
    // Text-derived: parasha/event + year. Without a year, a fresh upload (or an upload month)
    // says which cycle is meant; anything else stays unplaced.
    const refIso = raw.refMonth ? `${raw.refMonth}-15T12:00:00Z` : fresh ? raw.addedAt : null;
    if (!hy && refIso && (slugs.length || a.events.length)) {
      const row = resolveWeekLabel({ slugs: new Set(slugs), events: a.events }, refIso);
      if (row && Math.abs(daysBetween(dayOf(refIso), row.date)) <= 75) { date = row.date; hy = row.hy; how = 'upload-time'; T(`בלי שנה: לפי זמן ההעלאה ${refIso.slice(0, 10)} → ${date}`); }
    } else if (hy && slugs.length) {
      date = findDate({ hy, slugs });
      if (date) how = 'parasha-year';
      T(date ? `פרשה ${slugList(slugs)} + שנה ${hy} → ${date}` : `פרשה ${slugList(slugs)} + שנה ${hy}: אין תאריך חד-משמעי`);
    } else if (hy && a.events.length) {
      date = findDate({ hy, event: a.events[0], month: a.events[0] === 'rosh-chodesh' ? a.rcMonth : null });
      if (date) how = 'event-year';
      T(date ? `אירוע ${a.events[0]} + שנה ${hy} → ${date}` : `אירוע ${a.events[0]} + שנה ${hy}: אין תאריך`);
    } else {
      T(`אין מספיק מידע לתאריך (שנה=${hy ?? '-'}, פרשה=${slugList(slugs)}, אירועים=${a.events.join(',') || '-'})`);
    }
  }
  // A source that lists only the current month (alonolam) still tells us the year.
  if (!hy && !date && raw.refMonth) hy = hyOfIso(`${raw.refMonth}-15`);
  return { date, hy, slugs, how };
}

/**
 * One reading per week, whatever each source calls it: the calendar's. A title that named a
 * reading itself keeps the calendar's version of that reading (so "מטות" in a double-reading
 * week becomes matot+masei, and an Israel-only "חקת" stays chukat).
 * @returns {{slugs: string[], event: string|null}}
 */
function applyCalendarRow(date, slugs, how, a, notes, T) {
  const row = weekRowOf(date);
  if (!row) return { slugs, event: a.events[0] ?? null };
  const within = (set) => slugs.length > 0 && slugs.every((x) => set.includes(x));
  // The source's own date or week label only says WHICH week; the reading of that week still comes from what the
  // title names. An Israeli source (ladaat) dates by the Israel calendar and titles "חקת" in the week the diaspora
  // reads Korach: that copy keeps the Israel reading (it was 1,630 of 21,831 ladaat copies, found by tools/audit-dates.mjs).
  let out;
  if (within(row.parasha)) out = row.parasha;
  else if (within(row.parashaIL)) out = row.parashaIL;
  else out = row.parasha.length ? row.parasha : row.parashaIL;
  if (how === 'source-date' && a.slugs.length && !a.slugs.every((s) => row.parasha.includes(s) || row.parashaIL.includes(s))) {
    notes.push('title-parasha-differs');
  }
  T(`שורת לוח ${date} (${row.hebrew}): ${row.label}; פרשה=${slugList(out)} אירוע=${row.event ?? '-'}`);
  return { slugs: out, event: row.event };
}

/**
 * @param {RawIssue} raw
 * @param {{now: string, aliasIndex?: object, weeklySeries?: Set<string>, trace?: boolean}} ctx
 * @returns {Item}
 */
export function enrich(raw, ctx) {
  const notes = [];
  const trace = ctx.trace ? [] : null;
  const T = (line) => { if (trace) trace.push(line); };
  const ageDays = raw.addedAt ? daysBetween(dayOf(raw.addedAt), dayOf(ctx.now)) : null;
  const fresh = ageDays !== null && ageDays <= 45 && ageDays >= -2;
  const expect = fresh ? expectedSlugs(raw.addedAt) : [];

  const { a, fromFolder } = textFacts(raw, ctx, expect, notes, T);
  const week = resolveWeek(raw, a, ctx, fresh, notes, T);
  let { slugs } = week;
  let event = null;
  if (week.date) ({ slugs, event } = applyCalendarRow(week.date, slugs, week.how, a, notes, T));
  else if (a.events.length) event = a.events[0];

  const sid = seriesIdentity(raw.seriesHint?.title || raw.rawTitle, raw.seriesHint?.lang, raw.src, ctx.aliasIndex);
  T(`סדרה: "${raw.seriesHint?.title ?? raw.rawTitle}" → מפתח "${sid.key}" (${sid.id}${sid.named ? '' : ', ללא שם'})`);

  // Display title: what is left of the file name, or the series title when that adds nothing.
  let title = a.title;
  if (sid.lang !== 'he') title = stripLanguage(title).core;
  const titleKey = normalizeKey(title);
  if (!title || titleKey === normalizeKey(sid.displayTitle) || titleKey === sid.core) title = sid.displayTitle;
  // What is left of the title once the series' own words are gone tells two issues of one week apart.
  const serWords = new Set(tokenize(sid.displayTitle).map((t) => t.n));
  const variant = tokenize(a.title).map((t) => t.n).filter((w) => !serWords.has(w) && !GENERIC.has(w) && !/^\d+$/.test(w)).join(' ');
  T(`כותרת לתצוגה: "${title}"; וריאנט: "${variant}"`);

  return {
    src: raw.src,
    ext: raw.ext,
    series: sid,
    seriesHint: raw.seriesHint,
    title,
    variant,
    no: a.no,
    noStrong: a.noStrong,
    date: week.date,
    hy: week.hy ?? null,
    slugs,
    event,
    timeless: !!raw.timeless || (!week.hy && !week.date),
    lang: sid.lang,
    how: week.how,
    notes,
    trace: trace ?? undefined,
    flags: { parasha: slugs.length > 0, year: !!(a.hy || week.date), date: !!week.date, fromFolder },
    asset: {
      src: raw.src,
      ext: raw.ext,
      // whatever a connector hands over leaves here as a valid, fully escaped URL
      url: raw.url ? safeUrl(raw.url) : undefined,
      page: raw.page ? safeUrl(raw.page) : undefined,
      thumb: raw.thumb ? safeUrl(raw.thumb) : undefined,
      bytes: raw.bytes ?? undefined,
      pages: raw.pages ?? undefined,
      downloads: raw.downloads ?? undefined,
      rawTitle: raw.rawTitle || title, // a source that gave no name: the display title stands in
    },
    pages: raw.pages ?? null,
    addedAt: raw.addedAt || null,
    circle: raw.seriesHint?.circle || null,
  };
}
