#!/usr/bin/env node
// Audits the week every copy was assigned to, against evidence the assignment code does not use.
//
//   node catalog/tools/audit-dates.mjs [--sample 200] [--seed 1] [--per-source N] [--json file] [--show 40]
//                                      [--examples <check> [--src id] [--limit N]]
//
// It replays the crawl OFFLINE from the response cache (catalog/.cache, filled by `build.mjs --full --cache`;
// a cache miss is an error, never a request), enriches every copy with tracing on, and checks each one:
//
//   date-row     the date is a row of the calendar (a Shabbat, or the first day of an event)
//   year         the Hebrew year equals the year of the date
//   reading      the reading stored on the copy is the calendar's reading of that date (diaspora or Israel)
//   title-parasha  a portion NAMED in the title (own matcher, distinctive names only) is one of the portions of the week
//   title-year   a Hebrew year written in the title or its folders equals the year of the date
//   title-event  an event named in the title (Purim, Chanukah, Pesach ...) is an event of that week's row
//   upload-gap   the upload time is not absurdly before the week (a bulletin uploaded 100+ days early)
//
// The first three check the plumbing (the date really is that week and the stored reading is that week's). The
// last four compare the date with what the SOURCE says, through the title and folder names, with a matcher of
// its own (no code shared with lib/parasha.mjs). Output: per-source rates, the failing patterns, and a seeded random
// sample (default 200, evenly over the sources) with every field needed to look the copy up on the source.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectors } from '../connectors/index.mjs';
import { createHttp } from '../lib/http.mjs';
import { crawlAll, enrichAll } from '../lib/pipeline.mjs';
import { buildAliasIndex } from '../lib/enrich.mjs';
import { weekRowOf, weeksBetween, addDays, hyOfIso, hebrewDateOf, daysBetween } from '../lib/calendar.mjs';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(HERE, '..');

// ------------------------------------------------------------- the independent matcher

/** Distinctive portion names only: a word like "שמות" or "בא" in a title proves nothing, so it is not here. */
const NAMES = {
  bereshit: ['בראשית'], noach: ['נח'], 'lech-lecha': ['לך לך'], vayera: ['וירא'], 'chayei-sara': ['חיי שרה'], toldot: ['תולדות'],
  vayetzei: ['ויצא'], vayishlach: ['וישלח'], vayeshev: ['וישב'], miketz: ['מקץ'], vayigash: ['ויגש'], vayechi: ['ויחי'],
  vaera: ['וארא'], beshalach: ['בשלח'], yitro: ['יתרו'], mishpatim: ['משפטים'], terumah: ['תרומה'], tetzaveh: ['תצוה', 'תצווה'],
  'ki-tisa': ['כי תשא'], vayakhel: ['ויקהל'], pekudei: ['פקודי'], tazria: ['תזריע'], metzora: ['מצורע'],
  'achrei-mot': ['אחרי מות', 'אחרי'], kedoshim: ['קדושים'], emor: ['אמור'], bechukotai: ['בחוקותי', 'בחקותי'],
  behaalotcha: ['בהעלותך', 'בהעלתך'], korach: ['קרח'], chukat: ['חוקת', 'חקת'], balak: ['בלק'], pinchas: ['פינחס', 'פנחס'], matot: ['מטות'], masei: ['מסעי'],
  vaetchanan: ['ואתחנן'], eikev: ['עקב'], shoftim: ['שופטים'], 'ki-teitzei': ['כי תצא'], 'ki-tavo': ['כי תבוא', 'כי תבא'], nitzavim: ['נצבים', 'ניצבים'],
  vayeilech: ['וילך'], haazinu: ['האזינו'], shemini: ['שמיני'], vayikra: [], tzav: [], lech: [],
};
const EVENT_WORDS = {
  purim: ['פורים'], chanukah: ['חנוכה', 'חנוכא'], pesach: ['פסח'], shavuot: ['שבועות'], sukkot: ['סוכות'], 'rosh-hashana': ['ראש השנה'],
  'yom-kippur': ['יום כיפור', 'יום הכיפורים'], 'shabbat-shekalim': ['שקלים'], 'shabbat-zachor': ['זכור'], 'shabbat-parah': ['פרה'],
  'shabbat-hachodesh': ['החודש'], 'shabbat-hagadol': ['הגדול'], 'shabbat-shuva': ['שובה'], 'shabbat-chazon': ['חזון'], 'shabbat-nachamu': ['נחמו'],
  'tisha-bav': ['תשעה באב', 'ט באב'], 'simchat-torah': ['שמחת תורה'], 'shemini-atzeret': ['שמיני עצרת'],
};

/** Lower-case, no points/quotes/punctuation, single spaces: both the title and the names go through it. */
const flat = (s) => String(s || '').normalize('NFKD').replace(/(\d)([א-ת])/g, '$1 $2').replace(/([א-ת])(\d)/g, '$1 $2').replace(/[֑-ׇ]/g, '').replace(/["'׳״`´’‘“”\-–—־_.,;:!?()\[\]{}\/\\|]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => ` ${flat(s)} `;
const has = (hay, needle) => words(hay).includes(` ${flat(needle)} `);

/** Portions named in a text (own matcher). "שמיני" alone is skipped when "עצרת" follows (Shemini Atzeret). */
export function namedPortions(text) {
  const out = new Set();
  for (const [slug, names] of Object.entries(NAMES)) {
    if (names.some((n) => has(text, n))) out.add(slug);
  }
  if (out.has('shemini') && has(text, 'שמיני עצרת')) out.delete('shemini');
  if (out.has('achrei-mot') && !has(text, 'אחרי מות') && !has(text, 'אחרי קדושים') && !has(text, 'אחרי מות קדושים')) out.delete('achrei-mot');
  return out;
}

export function namedEvents(text) {
  const out = new Set();
  for (const [slug, names] of Object.entries(EVENT_WORDS)) if (names.some((n) => has(text, n))) out.add(slug);
  return out;
}

const YEAR_RE = /(?:^|\s)(?:ה?)ת[׳']?([א-ת]{0,2}[״"']?[א-ת]{1,2})(?=$|\s)/;
const GEMATRIA = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };

/**
 * Hebrew years written as letters ("תשפ״ו", "תשפו") in a text -> 5000+n. Only 5740..5799 are believed, and a token
 * must be 'תש' + a tens letter (+ units): "כי תשא" (5701) and "תשעה באב" (5775 without gershayim) are not years.
 */
export function namedYears(text) {
  const out = new Set();
  // "תשפ_ב": file names write the gershayim as an underscore; a letter-underscore-letter run is one word
  const joined = String(text || '').replace(/(ה?תש[מנסעפצ])_([א-ט])(?![א-ת])/g, '$1$2');
  const tokens = joined.split(/[\s\-–—_,.;:()[\]/\\|]+/);
  tokens.forEach((token, at) => {
    // final letters stand for their plain forms (תש"ף = 5780)
    const letters = token.replace(/["'׳״”“]/g, '').replace(/^ה(?=תש)/, '').replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');
    if (!/^תש[מנסעפצ][א-ט]?$/.test(letters)) return;
    // "תשעה באב" (Tisha B'Av): the word nine, not the year 5775
    if (letters === 'תשעה' && (tokens[at + 1] === 'באב' || tokens[at - 1] === 'ערב')) return;
    let n = 0;
    for (const ch of letters) n += GEMATRIA[ch] || 0;
    if (n >= 740 && n <= 799) out.add(5000 + n);
  });
  return out;
}

// ------------------------------------------------------------- evaluation

/** What a holiday name in a title may refer to in the calendar. */
const FAMILY = {
  pesach: ['pesach', 'chol-hamoed-pesach', 'shvii-shel-pesach', 'shabbat-hagadol'],
  sukkot: ['sukkot', 'chol-hamoed-sukkot', 'hoshana-raba', 'shemini-atzeret', 'simchat-torah'],
  'rosh-hashana': ['rosh-hashana', 'shabbat-shuva', 'tzom-gedaliah'],
  purim: ['purim', 'shushan-purim', 'taanit-esther', 'shabbat-zachor'],
  chanukah: ['chanukah'],
  shavuot: ['shavuot'],
  'tisha-bav': ['tisha-bav', 'shabbat-chazon', 'shabbat-nachamu'],
  'yom-kippur': ['yom-kippur', 'shabbat-shuva'],
};

/** Every event slug of the calendar rows within [days] days of [iso]. */
function eventsNear(iso, days) {
  const out = [];
  for (const r of weeksBetween(addDays(iso, -days), addDays(iso, days))) out.push(...[r.event, ...(r.events || [])].filter(Boolean));
  return out;
}

/** Seeded PRNG (mulberry32) so a sample can be reproduced. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Checks one enriched copy. Each check is 'ok', 'FAIL' or 'n/a' (nothing to compare); `why` explains the FAILs.
 * @returns {{checks: Record<string,string>, why: string[], row: object|null}}
 */
export function evaluate(item) {
  const checks = {};
  const why = [];
  /** the title names exactly one portion and the week is another: the strongest evidence of a wrong week */
  let single = false;
  const fail = (name, text) => { checks[name] = 'FAIL'; why.push(`${name}: ${text}`); };
  const row = item.date ? weekRowOf(item.date) : null;
  const asset = item.asset;
  // The series' own name is not evidence of the week ("ויקהל דוד", "קונטרס פורים קטן תשנ״ב", "תולדות אהרן" are series titles).
  const seriesName = item.raw?.seriesHint?.title || '';
  const own = seriesName && asset.rawTitle.includes(seriesName) ? asset.rawTitle.replace(seriesName, ' ') : asset.rawTitle;
  const texts = [own, ...(item.raw?.contextTitles || [])];

  // plumbing
  if (!item.date) { for (const k of ['date-row', 'year', 'reading', 'title-parasha', 'title-year', 'title-event']) checks[k] = 'n/a'; checks['upload-gap'] = 'n/a'; return { checks, why, row }; }
  if (row) checks['date-row'] = 'ok'; else fail('date-row', `${item.date} is not a calendar row`);
  if (item.hy === hyOfIso(item.date)) checks.year = 'ok'; else fail('year', `hy ${item.hy} but ${item.date} is in ${hyOfIso(item.date)}`);
  if (row) {
    const reading = item.slugs.join('+');
    if (!reading || reading === row.parasha.join('+') || reading === row.parashaIL.join('+')) checks.reading = 'ok';
    else fail('reading', `stored ${reading}, calendar ${row.parasha.join('+') || '-'} / ${row.parashaIL.join('+') || '-'} (IL)`);
  } else checks.reading = 'n/a';

  // against the source's own words
  const portions = new Set(texts.flatMap((t) => [...namedPortions(t)]));
  if (!portions.size) checks['title-parasha'] = 'n/a';
  else if (!row) checks['title-parasha'] = 'n/a';
  else {
    const week = new Set([...row.parasha, ...row.parashaIL]);
    // A title may name several portions (a file that covers two weeks): the week must be one of them.
    if ([...portions].some((p) => week.has(p))) checks['title-parasha'] = 'ok';
    else if (!week.size) checks['title-parasha'] = 'n/a'; // a festival week has no portion to compare; title-event judges it
    else {
      single = portions.size === 1;
      fail('title-parasha', `${single ? 'SINGLE: ' : ''}title names ${[...portions].join('+')}, week ${item.date} (${hebrewDateOf(item.date)}) is ${[...week].join('+')}`);
    }
  }
  const years = new Set(texts.flatMap((t) => [...namedYears(t)]));
  if (!years.size) checks['title-year'] = 'n/a';
  else if (years.has(item.hy)) checks['title-year'] = 'ok';
  else fail('title-year', `title names ${[...years].join('/')}, date is in ${item.hy}`);
  const events = new Set(texts.flatMap((t) => [...namedEvents(t)]));
  if (!events.size || !row) checks['title-event'] = 'n/a';
  else {
    // The title may name the holiday the week leads into (a "Nitzavim and Rosh Hashana" bulletin is for the Shabbat before) or
    // follows, and a name like "Pesach" covers its days (the seventh day, Chol HaMoed): any event within a week of the date, by family.
    const near = new Set(eventsNear(item.date, 8));
    if ([...events].some((e) => (FAMILY[e] || [e]).some((x) => near.has(x)))) checks['title-event'] = 'ok';
    else fail('title-event', `title names ${[...events].join('+')}, within a week of ${item.date} there is ${[...near].join('+') || 'no event'}`);
  }
  // upload time
  if (item.addedAt && item.how !== 'prev') {
    const gap = daysBetween(item.addedAt.slice(0, 10), item.date); // days from upload to the week
    if (gap > 100) fail('upload-gap', `uploaded ${item.addedAt.slice(0, 10)}, ${gap} days before the week of ${item.date}`);
    else checks['upload-gap'] = 'ok';
  } else checks['upload-gap'] = 'n/a';
  return { checks, why, row, single };
}

/** Per-source tally of checks. */
export function tally(evaluated) {
  const bySource = {};
  for (const e of evaluated) {
    const s = (bySource[e.item.src] ||= { n: 0, placed: 0, how: {}, checks: {}, anyFail: 0, failKinds: {} });
    s.n++;
    if (e.item.date) s.placed++;
    s.how[e.item.how] = (s.how[e.item.how] || 0) + 1;
    let failed = false;
    for (const [k, v] of Object.entries(e.result.checks)) {
      const c = (s.checks[k] ||= { ok: 0, FAIL: 0, 'n/a': 0 });
      c[v]++;
      if (v === 'FAIL') { failed = true; s.failKinds[k] = (s.failKinds[k] || 0) + 1; }
    }
    if (failed) s.anyFail++;
    if (e.result.single) s.single = (s.single || 0) + 1;
  }
  return bySource;
}

// ------------------------------------------------------------- driver

export async function loadItems({ cacheDir = join(CATALOG, '.cache'), now = '2026-10-15T09:00:00Z' } = {}) {
  let misses = 0;
  const http = createHttp({
    cacheDir, useCache: true, minIntervalMs: 0,
    fetchImpl: async (url) => { misses++; throw new Error(`cache miss for ${url} (the audit never makes requests)`); },
  });
  const log = { info() {}, warn() {}, verbose() {}, warnings: [] };
  const results = await crawlAll(connectors, new Set(connectors.map((c) => c.id)), { http, now, log }, { full: true });
  const aliasIndex = buildAliasIndex(JSON.parse(readFileSync(join(CATALOG, 'data', 'aliases.json'), 'utf8')));
  const prevState = { items: [], prevAdded: new Map(), cidByKey: new Map(), archiveByKey: new Map() };
  const { fresh } = enrichAll(results, { now, aliasIndex, prevState, trace: true });
  return { items: fresh, results, misses };
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(2) + '%' : '-');

async function main() {
  const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
  const total = Number(arg('--sample', 200));
  const seed = Number(arg('--seed', 1));
  const show = Number(arg('--show', 40));
  const { items, results, misses } = await loadItems();
  console.log(`replayed ${items.length} copies from the cache (${misses} cache misses)`);
  for (const r of results) console.log(`  ${r.id}: ${r.status}, ${r.raw.length} copies${r.softErrorCount ? `, ${r.softErrorCount} soft errors` : ''}${r.error ? ', ' + r.error : ''}`);
  const evaluated = items.map((item) => ({ item, result: evaluate(item) }));
  const stats = tally(evaluated);

  console.log('\nPopulation, per source (rate = copies with at least one FAIL / copies with a date):');
  for (const [src, s] of Object.entries(stats)) {
    console.log(`\n${src}: ${s.n} copies, ${s.placed} with a date (${pct(s.placed, s.n)}); decided by ${Object.entries(s.how).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    for (const [k, c] of Object.entries(s.checks)) console.log(`  ${k.padEnd(14)} ok ${String(c.ok).padStart(6)}  FAIL ${String(c.FAIL).padStart(5)}  n/a ${String(c['n/a']).padStart(6)}  fail rate ${pct(c.FAIL, c.ok + c.FAIL)}`);
    console.log(`  ANY FAIL: ${s.anyFail} of ${s.placed} dated copies = ${pct(s.anyFail, s.placed)}; title names ONE portion and the week is another: ${s.single || 0}`);
  }

  // the seeded sample: evenly over the sources, among dated copies
  const random = rng(seed);
  const perSource = Number(arg('--per-source', Math.floor(total / Object.keys(stats).length)));
  const sample = [];
  for (const src of Object.keys(stats)) {
    const pool = evaluated.filter((e) => e.item.src === src && e.item.date);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    sample.push(...pool.slice(0, perSource));
  }
  const sampleStats = tally(sample);
  console.log(`\nSample (seed ${seed}, ${sample.length} copies, ${perSource} per source):`);
  for (const [src, s] of Object.entries(sampleStats)) console.log(`  ${src}: ${s.n} sampled, ${s.anyFail} with a FAIL (${pct(s.anyFail, s.n)})${Object.keys(s.failKinds).length ? '  ' + JSON.stringify(s.failKinds) : ''}`);
  const failing = sample.filter((e) => Object.values(e.result.checks).includes('FAIL'));
  console.log(`\nFailing copies in the sample (${failing.length}), first ${Math.min(show, failing.length)}:`);
  for (const e of failing.slice(0, show)) {
    const i = e.item;
    console.log(`- ${i.src}:${i.ext} "${i.asset.rawTitle}"${i.raw?.contextTitles?.length ? ` [${i.raw.contextTitles.join(' / ')}]` : ''}\n    date ${i.date} (${hebrewDateOf(i.date)}) by ${i.how}; ${e.result.why.join('; ')}`);
  }
  // --examples <check> [--src id] [--limit N]: failing copies of the whole population, for studying a failure class
  const wanted = arg('--examples', '');
  if (wanted) {
    const src = arg('--src', '');
    const limit = Number(arg('--limit', 25));
    const hits = evaluated.filter((e) => e.result.checks[wanted] === 'FAIL' && (!src || e.item.src === src));
    console.log(`
${hits.length} copies fail ${wanted}${src ? ' in ' + src : ''}; showing ${Math.min(limit, hits.length)} (evenly spaced):`);
    const step = Math.max(1, Math.floor(hits.length / limit));
    for (let k = 0; k < hits.length && k < limit * step; k += step) {
      const i = hits[k].item;
      console.log(`- ${i.src}:${i.ext} "${i.asset.rawTitle}"${i.raw?.contextTitles?.length ? ` [${i.raw.contextTitles.join(' / ')}]` : ''} -> ${i.date} (${hebrewDateOf(i.date)}) by ${i.how}; ${hits[k].result.why.join('; ')}`);
    }
  }
  const out = arg('--json', '');
  if (out) {
    writeFileSync(out, JSON.stringify({ seed, population: stats, sample: sample.map((e) => ({
      src: e.item.src, ext: e.item.ext, rawTitle: e.item.asset.rawTitle, contextTitles: e.item.raw?.contextTitles || [], dateHint: e.item.raw?.dateHint || null,
      weekHint: e.item.raw?.weekHint?.name || null, refMonth: e.item.raw?.refMonth || null, addedAt: e.item.addedAt, page: e.item.asset.page || null,
      date: e.item.date, hebrew: hebrewDateOf(e.item.date), how: e.item.how, slugs: e.item.slugs, event: e.item.event, checks: e.result.checks, why: e.result.why,
    })) }, null, 1));
    console.log(`\nwrote ${out}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
