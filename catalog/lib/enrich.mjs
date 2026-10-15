// Turns a connector's RawIssue into a normalized item: series identity, week
// (date, Hebrew year, parasha, event), issue number and display title. This is
// the one place where text and hints become facts, so connectors stay dumb.
import { createHash } from 'node:crypto';
import { normalizeKey } from './normalize.mjs';
import { analyzeTitle, tokenize, stripFileNoise, stripLanguage, guessLang, weekLabelParts } from './parasha.mjs';
import { hyOfIso, hyOfTimestamp, findDate, weekRowOf, addDays, daysBetween } from './calendar.mjs';
import { resolveWeekLabel, expectedSlugs, dayOf } from './dates.mjs';

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
  const noMerge = new Set((aliases?.noMerge || []).map((t) => seriesCore(t) || normalizeKey(t)));
  return { toCanonical, previous, noMerge };
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
export function enrich(raw, ctx) {
  const now = ctx.now;
  const notes = [];
  const fresh = raw.addedAt && daysBetween(dayOf(raw.addedAt), dayOf(now)) <= 45 && daysBetween(dayOf(raw.addedAt), dayOf(now)) >= -2;
  const expect = fresh ? expectedSlugs(raw.addedAt) : [];

  // ---- text facts (rawTitle first, then the folder it sits in) ----
  let a = analyzeTitle(raw.rawTitle, { expect });
  let fromFolder = false;
  if (raw.contextTitles?.length) {
    for (const ctxTitle of raw.contextTitles) {
      const f = analyzeTitle(ctxTitle, { expect });
      if (!a.slugs.length && f.slugs.length) { a = { ...a, slugs: f.slugs }; fromFolder = true; }
      if (!a.hy && f.hy) a = { ...a, hy: f.hy };
      if (!a.events.length && f.events.length) a = { ...a, events: f.events };
    }
  }

  // ---- week ----
  let date = null, hy = a.hy, slugs = a.slugs, event = null, how = 'none';
  if (raw.dateHint) {
    date = raw.dateHint;
    hy = hyOfIso(date);
    how = 'source-date';
  } else if (raw.weekHint?.name) {
    const parts = weekLabelParts(raw.weekHint.name);
    const row = resolveWeekLabel(parts, raw.weekHint.refTime || raw.addedAt || now);
    if (row) { date = row.date; hy = row.hy; how = 'week-label'; }
    else {
      hy = hyOfTimestamp(raw.weekHint.refTime || raw.addedAt || now);
      slugs = [...parts.slugs];
      notes.push('week-label-unresolved');
    }
  } else if (raw.timeless) {
    hy = null; slugs = [];
    how = 'timeless';
  } else {
    // Text-derived: parasha/event + year. Without a year, a fresh upload (or an
    // upload month) says which cycle is meant; anything else stays unplaced.
    let refIso = raw.refMonth ? `${raw.refMonth}-15T12:00:00Z` : fresh ? raw.addedAt : null;
    if (!hy && refIso && (slugs.length || a.events.length)) {
      const row = resolveWeekLabel({ slugs: new Set(slugs), events: a.events }, refIso);
      if (row && Math.abs(daysBetween(dayOf(refIso), row.date)) <= 75) { date = row.date; hy = row.hy; how = 'upload-time'; }
    } else if (hy && slugs.length) {
      date = findDate({ hy, slugs });
      if (date) how = 'parasha-year';
    } else if (hy && a.events.length) {
      date = findDate({ hy, event: a.events[0] });
      if (date) how = 'event-year';
    }
  }
  // A source that lists only the current month (alonolam) still tells us the year.
  if (!hy && !date && raw.refMonth) hy = hyOfIso(`${raw.refMonth}-15`);
  if (date) {
    const row = weekRowOf(date);
    if (row) {
      // One reading per week, whatever each source calls it: the calendar's.
      slugs = row.parasha.length ? row.parasha : row.parashaIL;
      event = row.event;
      if (how === 'source-date' && a.slugs.length && !a.slugs.every((s) => row.parasha.includes(s) || row.parashaIL.includes(s))) notes.push('title-parasha-differs');
    }
  } else if (a.events.length) {
    event = a.events[0];
  }

  // ---- series ----
  const sid = seriesIdentity(raw.seriesHint?.title || raw.rawTitle, raw.seriesHint?.lang, raw.src, ctx.aliasIndex);

  // ---- display title ----
  let title = a.title;
  if (sid.lang !== 'he') title = stripLanguage(title).core;
  const titleKey = normalizeKey(title);
  if (!title || titleKey === normalizeKey(sid.displayTitle) || titleKey === sid.core) title = sid.displayTitle;
  // What is left of the title once the series' own words are gone tells two issues of one week apart.
  const serWords = new Set(tokenize(sid.displayTitle).map((t) => t.n));
  const variant = tokenize(a.title).map((t) => t.n).filter((w) => !serWords.has(w) && !GENERIC.has(w) && !/^\d+$/.test(w)).join(' ');

  return {
    src: raw.src,
    ext: raw.ext,
    series: sid,
    seriesHint: raw.seriesHint,
    title,
    variant,
    no: a.no,
    noStrong: a.noStrong,
    date,
    hy: hy ?? null,
    slugs,
    event,
    timeless: !!raw.timeless || (!hy && !date),
    lang: sid.lang,
    how,
    notes,
    flags: { parasha: slugs.length > 0, year: !!(a.hy || date), date: !!date, fromFolder },
    asset: {
      src: raw.src,
      ext: raw.ext,
      url: raw.url || undefined,
      page: raw.page || undefined,
      thumb: raw.thumb || undefined,
      bytes: raw.bytes ?? undefined,
      pages: raw.pages ?? undefined,
      downloads: raw.downloads ?? undefined,
      rawTitle: raw.rawTitle,
    },
    pages: raw.pages ?? null,
    addedAt: raw.addedAt || null,
    circle: raw.seriesHint?.circle || null,
  };
}
