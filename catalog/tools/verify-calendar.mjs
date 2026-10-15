#!/usr/bin/env node
// Cross-checks every calendar computation we ship against references that do not share code with it.
//
//   node catalog/tools/verify-calendar.mjs [--from 1800] [--to 2300] [--quiet]
//
// Three layers, each independent of the code under test:
//
//   A. Hebrew dates. For every civil day: `Intl.DateTimeFormat('en-u-ca-hebrew')` (ICU, ships with Node)
//      against (1) the plugin's own calendar (plugin/js/alonim-hebcal.js, arithmetic on the molad) and
//      (2) @hebcal/core's HDate, which the catalog builder uses.
//   B. Festivals, fasts, Rosh Chodesh and the special Shabbatot. Expected dates are derived by RULE from the
//      ICU Hebrew dates (e.g. "17 Tammuz, or 18 if that is Shabbat", "the latest Shabbat before 14 Adar") and
//      compared with the rows of catalog/lib/calendar.mjs (weeks.json), in both directions.
//   C. The weekly portion. A second implementation of the schedule would share our understanding, so this layer
//      checks the properties that define the schedule and that any correct table must satisfy: the 54 portions
//      appear once and in order, festival Shabbatot (from ICU dates) carry no portion, Bereshit follows Simchat
//      Torah, Nitzavim ends the year, Devarim is Shabbat Chazon, Pinchas follows 17 Tammuz, Bamidbar precedes
//      Shavuot, only the seven allowed pairs are joined, and Israel differs from the diaspora exactly when a
//      Shabbat falls on a diaspora-only second festival day (and only until the cycles meet again).
//
// Exit code 1 when anything disagrees (the list is printed). The unit test `catalog/test/calendar-crosscheck.test.js`
// runs the same checks over 1950-2100.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { HDate } from '@hebcal/core';
import { weeksOfYear, PARASHA_SLUGS, isoOfGreg, addDays, hebrewDateOf } from '../lib/calendar.mjs';

const require = createRequire(import.meta.url);

/** The plugin's own calendar, loaded the way the plugin tests load it. */
export function loadPluginCalendar() {
  globalThis.Alonim = globalThis.Alonim || {};
  require('../../plugin/js/alonim-i18n.js');
  require('../../plugin/js/alonim-hebcal.js');
  return globalThis.Alonim.HebCal;
}

// ---------------------------------------------------------------- Intl reference

const INTL = new Intl.DateTimeFormat('en-u-ca-hebrew', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
/** ICU month names -> the plugin's month ids. */
const PLUGIN_MONTH = {
  Tishri: 'tishri', Heshvan: 'cheshvan', Kislev: 'kislev', Tevet: 'tevet', Shevat: 'shevat',
  'Adar I': 'adar1', Adar: 'adar', 'Adar II': 'adar2', Nisan: 'nisan', Iyar: 'iyar', Sivan: 'sivan', Tamuz: 'tamuz', Av: 'av', Elul: 'elul',
};

/** Hebrew date of a civil day, from ICU: { y, m (ICU name), d, iso, dow }. */
export function intlDay(utcDay) {
  const parts = Object.fromEntries(INTL.formatToParts(new Date(utcDay * 86400000 + 43200000)).map((x) => [x.type, x.value]));
  const date = new Date(utcDay * 86400000);
  return {
    y: Number(parts.year), m: parts.month, d: Number(parts.day),
    iso: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
    dow: date.getUTCDay(),
  };
}

/** Every civil day of [fromYear, toYear] (Gregorian) with its ICU Hebrew date. */
export function intlScan(fromYear, toYear) {
  const days = [];
  for (let u = Math.floor(Date.UTC(fromYear, 0, 1) / 86400000); u <= Math.floor(Date.UTC(toYear, 11, 31) / 86400000); u++) days.push(intlDay(u));
  return days;
}

// ---------------------------------------------------------------- A. Hebrew dates

/** @returns {string[]} discrepancy descriptions (empty = all agree) */
export function checkHebrewDates(days, plugin) {
  const bad = [];
  for (const day of days) {
    const [yy, mm, dd] = day.iso.split('-').map(Number);
    const local = new Date(yy, mm - 1, dd, 12);
    const p = plugin.fromDate(local);
    if (p.year !== day.y || p.day !== day.d || p.month !== PLUGIN_MONTH[day.m])
      bad.push(`A plugin ${day.iso}: ICU ${day.d} ${day.m} ${day.y}, plugin ${p.day} ${p.month} ${p.year}`);
    const h = new HDate(local);
    const hm = h.getMonthName();
    // @hebcal names: Tishrei, Cheshvan, Sh'vat, Tamuz, Adar I/II/Adar, Iyyar ... compare numerically instead of by name
    const back = new HDate(h.getDate(), hm, h.getFullYear());
    if (h.getFullYear() !== day.y || h.getDate() !== day.d || isoOfGreg(back.greg()) !== day.iso)
      bad.push(`A hebcal ${day.iso}: ICU ${day.d} ${day.m} ${day.y}, hebcal ${h.getDate()} ${hm} ${h.getFullYear()}`);
    // the same day, formatted by the catalog and by the plugin (letters), must read identically
    if (dd % 7 === 0 || day.d === 1) {
      const fromCatalog = hebrewDateOf(day.iso);
      const fromPlugin = plugin.formatHebrew(local);
      if (fromCatalog !== fromPlugin) bad.push(`A format ${day.iso}: catalog "${fromCatalog}", plugin "${fromPlugin}"`);
    }
  }
  return bad;
}

// ---------------------------------------------------------------- B. festivals by rule

const SHABBAT = 6;
const ICU_ADAR = (leap) => (leap ? 'Adar II' : 'Adar');

/** Lookup helpers over the ICU scan of one Hebrew year (Tishri 1 .. Elul 29). */
function yearIndex(days) {
  const byKey = new Map(); // `${y}|${m}|${d}` -> day
  const byIso = new Map();
  for (const day of days) { byKey.set(`${day.y}|${day.m}|${day.d}`, day); byIso.set(day.iso, day); }
  return {
    byKey, byIso,
    at: (y, m, d) => byKey.get(`${y}|${m}|${d}`) || null,
    /** latest Shabbat on or before `iso` (strictly before when `strict`) */
    shabbatBefore: (iso, strict) => {
      let cur = iso;
      if (strict) cur = addDays(cur, -1);
      for (let i = 0; i < 7; i++, cur = addDays(cur, -1)) if (byIso.get(cur)?.dow === SHABBAT) return cur;
      return null;
    },
  };
}

const isLeapHebrew = (y) => (7 * y + 1) % 19 < 7;

/**
 * Expected dates (diaspora) of every event, derived by rule from ICU Hebrew dates.
 * @returns {Map<string, Set<string>>} iso -> event slugs
 */
export function expectedEvents(hy, idx) {
  const out = new Map();
  const add = (iso, slug) => { if (!iso) return; if (!out.has(iso)) out.set(iso, new Set()); out.get(iso).add(slug); };
  const on = (m, d, y = hy) => idx.at(y, m, d)?.iso;
  const dowOf = (iso) => idx.byIso.get(iso)?.dow;
  const leap = isLeapHebrew(hy);
  const adar = ICU_ADAR(leap);
  // Tishri belongs to the Hebrew year hy; the rest of the year (Cheshvan..Elul) too. ICU numbers the year at Rosh Hashana.
  add(on('Tishri', 1), 'rosh-hashana'); add(on('Tishri', 2), 'rosh-hashana');
  // Tzom Gedaliah: 3 Tishri, or 4 when 3 is Shabbat
  add(dowOf(on('Tishri', 3)) === SHABBAT ? on('Tishri', 4) : on('Tishri', 3), 'tzom-gedaliah');
  add(on('Tishri', 10), 'yom-kippur');
  add(on('Tishri', 15), 'sukkot'); add(on('Tishri', 16), 'sukkot');
  for (let d = 17; d <= 20; d++) add(on('Tishri', d), 'chol-hamoed-sukkot');
  add(on('Tishri', 21), 'hoshana-raba'); add(on('Tishri', 22), 'shemini-atzeret'); add(on('Tishri', 23), 'simchat-torah');
  for (let d = 3; d <= 9; d++) add(on('Tishri', d), 'aseret-yemei-teshuva');
  // Chanukah: 25 Kislev for 8 days
  // Convention: the catalog dates Chanukah by its first candle-lighting, i.e. the evening before the first day
  // (Hebcal's "Chanukah: 1 Candle" is on 24 Kislev). The row on 25 Kislev itself is a continuation.
  const c0 = on('Kislev', 24);
  for (let i = 0; i < 9; i++) add(addDays(c0, i), 'chanukah');
  add(on('Tevet', 10), 'asara-btevet');
  add(on('Shevat', 15), 'tu-bishvat');
  // Ta'anit Esther: 13 Adar, or the Thursday before (11 Adar) when 13 is Shabbat
  add(dowOf(on(adar, 13)) === SHABBAT ? on(adar, 11) : on(adar, 13), 'taanit-esther');
  add(on(adar, 14), 'purim'); add(on(adar, 15), 'shushan-purim');
  add(on('Nisan', 15), 'pesach'); add(on('Nisan', 16), 'pesach');
  for (let d = 17; d <= 20; d++) add(on('Nisan', d), 'chol-hamoed-pesach');
  add(on('Nisan', 21), 'shvii-shel-pesach'); add(on('Nisan', 22), 'shvii-shel-pesach');
  add(on('Iyar', 18), 'lag-baomer');
  add(on('Sivan', 6), 'shavuot'); add(on('Sivan', 7), 'shavuot');
  add(dowOf(on('Tamuz', 17)) === SHABBAT ? on('Tamuz', 18) : on('Tamuz', 17), 'shiva-asar-btammuz');
  add(dowOf(on('Av', 9)) === SHABBAT ? on('Av', 10) : on('Av', 9), 'tisha-bav');
  // Special Shabbatot
  const shabbatInTishri3to9 = [3, 4, 5, 6, 7, 8, 9].map((d) => on('Tishri', d)).find((iso) => dowOf(iso) === SHABBAT);
  add(shabbatInTishri3to9, 'shabbat-shuva');
  add(idx.shabbatBefore(on(adar, 1), false), 'shabbat-shekalim'); // on or before 1 Adar (II)
  add(idx.shabbatBefore(on(adar, 14), true), 'shabbat-zachor'); // latest Shabbat before Purim
  const hachodesh = idx.shabbatBefore(on('Nisan', 1), false); // on or before 1 Nisan
  add(hachodesh, 'shabbat-hachodesh');
  add(hachodesh && addDays(hachodesh, -7), 'shabbat-parah');
  add(idx.shabbatBefore(on('Nisan', 15), true), 'shabbat-hagadol'); // the Shabbat before Pesach
  const chazon = idx.shabbatBefore(on('Av', 9), false); // latest Shabbat on or before 9 Av
  add(chazon, 'shabbat-chazon');
  add(chazon && addDays(chazon, 7), 'shabbat-nachamu');
  // Rosh Chodesh: day 1 of every month but Tishri, and day 30 of a 30-day month that precedes it
  const monthsInOrder = ['Tishri', 'Heshvan', 'Kislev', 'Tevet', 'Shevat', ...(leap ? ['Adar I', 'Adar II'] : ['Adar']), 'Nisan', 'Iyar', 'Sivan', 'Tamuz', 'Av', 'Elul'];
  monthsInOrder.forEach((m, i) => {
    if (i === 0) return;
    add(on(m, 1), `rosh-chodesh:${m}`);
    const prev = monthsInOrder[i - 1];
    add(on(prev, 30), `rosh-chodesh:${m}`);
  });
  return out;
}

/** Hebcal/ours month name -> the ICU name used in `expectedEvents`. */
const RC_MONTH = {
  Tishrei: 'Tishri', Cheshvan: 'Heshvan', Kislev: 'Kislev', Tevet: 'Tevet', "Sh'vat": 'Shevat', Adar: 'Adar', 'Adar I': 'Adar I', 'Adar II': 'Adar II',
  Nisan: 'Nisan', Iyyar: 'Iyar', Sivan: 'Sivan', Tamuz: 'Tamuz', Av: 'Av', Elul: 'Elul',
};

/** Events whose rows exist only on the first day (the connector rows show a multi-day event once). */
const MULTI_DAY = new Set(['rosh-hashana', 'sukkot', 'chol-hamoed-sukkot', 'chanukah', 'purim-x', 'pesach', 'chol-hamoed-pesach', 'shvii-shel-pesach', 'shavuot', 'aseret-yemei-teshuva']);

/** Rows of weeks.json for a year against the rule-derived expectation. */
export function checkEvents(hy, days) {
  const bad = [];
  const idx = yearIndex(days);
  const expected = expectedEvents(hy, idx);
  const rows = weeksOfYear(hy);
  const rowByDate = new Map(rows.map((r) => [r.date, r]));
  const slugsOfRow = (r) => new Set([...(r.event ? [r.event] : []), ...(r.events || [])].map((e) => (e === 'rosh-chodesh' ? `rosh-chodesh:${RC_MONTH[r.rcMonth]}` : e)));

  // 1. every row's events are expected on that date; secondary events (Mevarchim) have no rule here and are skipped
  for (const r of rows) {
    const exp = expected.get(r.date) || new Set();
    for (const e of slugsOfRow(r)) {
      if (e === 'shabbat-mevarchim' || e === 'shabbat-shirah') continue;
      if (!exp.has(e)) bad.push(`B ${hy} ${r.date} (${r.hebrew}): row says ${e}, expected ${[...exp].join(',') || 'nothing'}`);
    }
  }
  // 2. every expected event's first day is present in a row of that date
  for (const [event, firstIso] of firstDays(expected)) {
    const r = rowByDate.get(firstIso);
    if (!r) { bad.push(`B ${hy} ${firstIso}: expected ${event}, no row`); continue; }
    if (event === 'aseret-yemei-teshuva') continue; // secondary: never primary, listed under events only on Shabbat rows
    if (!slugsOfRow(r).has(event)) bad.push(`B ${hy} ${firstIso}: expected ${event}, row has ${[...slugsOfRow(r)].join(',')}`);
  }
  // 3. Hebrew date text of each row equals ICU's date (letters aside, the day and month name)
  for (const r of rows) {
    const day = idx.byIso.get(r.date);
    if (day && r.hy !== day.y) bad.push(`B ${hy} ${r.date}: row hy ${r.hy}, ICU ${day.y}`);
  }
  return bad;
}

/** First day of each (event) run in the expected map. */
function* firstDays(expected) {
  const dates = [...expected.keys()].sort();
  for (const iso of dates) {
    for (const e of expected.get(iso)) {
      const before = expected.get(addDays(iso, -1));
      if (before && before.has(e) && (MULTI_DAY.has(e) || e.startsWith('rosh-chodesh:'))) continue;
      if (e === 'shabbat-shirah') continue;
      // `starting` rows exclude secondary events (Ten Days)
      yield [e, iso];
    }
  }
}

// ---------------------------------------------------------------- C. the weekly portion

const ORDER = new Map(PARASHA_SLUGS.map((s, i) => [s, i]));
const JOINABLE = new Set(['vayakhel+pekudei', 'tazria+metzora', 'achrei-mot+kedoshim', 'behar+bechukotai', 'chukat+balak', 'matot+masei', 'nitzavim+vayeilech']);

/** Diaspora and Israel festival Shabbatot by rule (ICU Hebrew dates). */
function festivalDates(hy, idx) {
  const on = (m, d, y = hy) => idx.at(y, m, d)?.iso;
  const range = (m, a, b) => Array.from({ length: b - a + 1 }, (_, i) => on(m, a + i)).filter(Boolean);
  return {
    diaspora: new Set([...range('Tishri', 1, 2), on('Tishri', 10), ...range('Tishri', 15, 23), ...range('Nisan', 15, 22), ...range('Sivan', 6, 7)]),
    israel: new Set([...range('Tishri', 1, 2), on('Tishri', 10), ...range('Tishri', 15, 22), ...range('Nisan', 15, 21), on('Sivan', 6)]),
    // Shabbatot that are a festival only abroad: they are where the two cycles part
    diasporaOnly: new Set([on('Tishri', 16), on('Tishri', 23), on('Nisan', 16), on('Nisan', 22), on('Sivan', 7)]),
  };
}

/** Properties of one Hebrew year's weekly readings; `days` = the ICU scan covering the year and the next one's Tishri. */
export function checkParasha(hy, days) {
  const bad = [];
  const idx = yearIndex(days);
  const fest = festivalDates(hy, idx);
  const expected = expectedEvents(hy, idx);
  const shabbatot = weeksOfYear(hy).filter((r) => r.shabbat);
  const nextRh = days.find((d) => d.y === hy + 1 && d.m === 'Tishri' && d.d === 1);

  // every Saturday of the year (ICU) has a row, and only those do
  const saturdays = days.filter((d) => d.y === hy && d.dow === SHABBAT).map((d) => d.iso);
  if (saturdays.join() !== shabbatot.map((r) => r.date).join()) bad.push(`C ${hy}: Shabbat rows differ from the ${saturdays.length} Saturdays of the year`);

  const joined = (list) => list.join('+');
  for (const r of shabbatot) {
    if (r.hy !== hy) bad.push(`C ${hy} ${r.date}: hy ${r.hy}`);
    // festival Shabbat carries no portion, a regular one carries one (or a permitted pair)
    for (const [list, set, who] of [[r.parasha, fest.diaspora, 'diaspora'], [r.parashaIL, fest.israel, 'Israel']]) {
      const isFestival = set.has(r.date);
      if (isFestival !== (list.length === 0)) bad.push(`C ${hy} ${r.date} ${who}: portion ${joined(list) || '(none)'} but festival=${isFestival}`);
      if (list.length > 2) bad.push(`C ${hy} ${r.date} ${who}: more than two portions`);
      if (list.length === 2 && !JOINABLE.has(joined(list))) bad.push(`C ${hy} ${r.date} ${who}: ${joined(list)} may not be joined`);
      if (list.includes('vezot-haberakhah')) bad.push(`C ${hy} ${r.date} ${who}: Vezot Haberakhah is never a weekly portion`);
      if (list.length === 2 && ORDER.get(list[1]) !== ORDER.get(list[0]) + 1) bad.push(`C ${hy} ${r.date} ${who}: pair ${joined(list)} not consecutive`);
    }
  }

  // order and completeness within the year (Vayeilech/Haazinu may belong to the next year's Shabbat Shuva, see below)
  for (const [key, who] of [['parasha', 'diaspora'], ['parashaIL', 'Israel']]) {
    const seq = shabbatot.flatMap((r) => r[key]);
    let last = -1;
    // the year starts with the tail of the previous cycle (Haazinu/Vayeilech on Shabbat Shuva, or Vezot is not read): skip until Bereshit
    const start = seq.indexOf('bereshit');
    if (start < 0) { bad.push(`C ${hy} ${who}: no Bereshit`); continue; }
    for (let i = start; i < seq.length; i++) {
      const o = ORDER.get(seq[i]);
      if (o <= last) bad.push(`C ${hy} ${who}: ${seq[i]} out of order after ${PARASHA_SLUGS[last]}`);
      last = o;
    }
    // Bereshit..Nitzavim all present (Vayeilech/Haazinu may be on either side of Rosh Hashana)
    for (const s of PARASHA_SLUGS.slice(0, ORDER.get('nitzavim') + 1)) if (!seq.includes(s) && !(s === 'nitzavim' && seq.includes('vayeilech'))) {
      // a portion read only as the second half of a pair is present via `includes` above; a hole is an error
      bad.push(`C ${hy} ${who}: ${s} is never read`);
    }
    // the portion immediately before Rosh Hashana is Nitzavim (alone, or with Vayeilech); never later ones
    const lastShabbat = shabbatot[shabbatot.length - 1];
    const tail = lastShabbat[key];
    if (!(tail.includes('nitzavim'))) bad.push(`C ${hy} ${who}: last Shabbat before Rosh Hashana reads ${joined(tail) || '(festival)'} not Nitzavim`);
    if (nextRh && addDays(lastShabbat.date, 1) > nextRh.iso) bad.push(`C ${hy}: last Shabbat ${lastShabbat.date} is after Rosh Hashana`);
  }

  // anchors
  const named = (list, slug) => list.includes(slug);
  const simchatTorahD = [...expected].find(([, s]) => s.has('simchat-torah'))?.[0];
  const simchatTorahIL = idx.at(hy, 'Tishri', 22)?.iso; // Israel: Simchat Torah is 22 Tishri
  const firstAfter = (iso) => shabbatot.find((r) => r.date > iso);
  const bereshitD = shabbatot.find((r) => named(r.parasha, 'bereshit'));
  const bereshitIL = shabbatot.find((r) => named(r.parashaIL, 'bereshit'));
  if (!bereshitD || bereshitD.date !== firstAfter(simchatTorahD)?.date) bad.push(`C ${hy} diaspora: Bereshit ${bereshitD?.date} is not the first Shabbat after Simchat Torah ${simchatTorahD}`);
  if (!bereshitIL || bereshitIL.date !== firstAfter(simchatTorahIL)?.date) bad.push(`C ${hy} Israel: Bereshit ${bereshitIL?.date} is not the first Shabbat after Simchat Torah ${simchatTorahIL}`);
  const chazonIso = [...expected].find(([, s]) => s.has('shabbat-chazon'))?.[0];
  const nachamuIso = [...expected].find(([, s]) => s.has('shabbat-nachamu'))?.[0];
  const devarim = shabbatot.find((r) => named(r.parasha, 'devarim'));
  const vaetchanan = shabbatot.find((r) => named(r.parasha, 'vaetchanan'));
  if (devarim?.date !== chazonIso) bad.push(`C ${hy}: Devarim on ${devarim?.date}, Shabbat Chazon on ${chazonIso}`);
  if (vaetchanan?.date !== nachamuIso) bad.push(`C ${hy}: Vaetchanan on ${vaetchanan?.date}, Shabbat Nachamu on ${nachamuIso}`);
  for (const [key, who] of [['parasha', 'diaspora'], ['parashaIL', 'Israel']]) {
    // Masei is the Shabbat right before Devarim (alone, or as the second half of Matot-Masei)
    const masei = shabbatot.find((r) => named(r[key], 'masei'));
    if (!masei || addDays(masei.date, 7) !== devarim?.date) bad.push(`C ${hy} ${who}: Masei on ${masei?.date} is not the Shabbat before Devarim ${devarim?.date}`);
  }

  // the independent table (KosherJava year types) for both calendars
  bad.push(...checkAgainstOracle(hy, days, shabbatot));
  return bad;
}

// ---------------------------------------------------------------- the independent table

let ORACLE = null;
/** The 17 year-type tables of KosherJava (kosher_dart), kept in a fixture: an implementation we did not write or port from Hebcal. */
function oracleTables() {
  if (!ORACLE) ORACLE = JSON.parse(readFileSync(fileURLToPath(new URL('../test/fixtures/parasha-oracle.json', import.meta.url)), 'utf8')).tables;
  return ORACLE;
}

/** Year type per the Luach Arba'ah Shearim (as implemented by KosherJava); -1 for a (never occurring) combination. */
export function oracleYearType({ rhDow, leap, cheshvanLong, kislevShort, israel }) {
  const rh = rhDow + 1; // Sunday = 1 ... Saturday = 7
  if (leap) {
    if (rh === 2) { if (kislevShort) return israel ? 14 : 6; if (cheshvanLong) return israel ? 15 : 7; }
    else if (rh === 3) return israel ? 15 : 7;
    else if (rh === 5) { if (kislevShort) return 8; if (cheshvanLong) return 9; }
    else if (rh === 7) { if (kislevShort) return 10; if (cheshvanLong) return israel ? 16 : 11; }
    return -1;
  }
  if (rh === 2) { if (kislevShort) return 0; if (cheshvanLong) return israel ? 12 : 1; }
  else if (rh === 3) return israel ? 12 : 1;
  else if (rh === 5) { if (cheshvanLong) return 3; if (!kislevShort) return israel ? 13 : 2; }
  else if (rh === 7) { if (kislevShort) return 4; if (cheshvanLong) return 5; }
  return -1;
}

/** Portion(s) of every Shabbat of Hebrew year `hy` according to the oracle: Map<iso, string> ('' on a festival, 'a+b' for a pair). */
export function oracleReadings(hy, days, israel) {
  const idx = yearIndex(days);
  const rh = idx.at(hy, 'Tishri', 1);
  const dayCount = (m) => days.filter((d) => d.y === hy && d.m === m).length;
  const type = oracleYearType({
    rhDow: rh.dow, leap: isLeapHebrew(hy), cheshvanLong: dayCount('Heshvan') === 30, kislevShort: dayCount('Kislev') === 29, israel,
  });
  const out = new Map();
  if (type < 0) return out;
  const table = oracleTables()[type];
  let dayOfYear = 0;
  for (const d of days.filter((x) => x.y === hy)) {
    dayOfYear++;
    if (d.dow !== SHABBAT) continue;
    const name = table[Math.floor((rh.dow + dayOfYear) / 7)];
    out.set(d.iso, name === 'none' ? '' : name);
  }
  return out;
}

function checkAgainstOracle(hy, days, shabbatot) {
  const bad = [];
  for (const [key, israel, who] of [['parasha', false, 'diaspora'], ['parashaIL', true, 'Israel']]) {
    const expected = oracleReadings(hy, days, israel);
    for (const r of shabbatot) {
      const want = expected.get(r.date);
      const got = r[key].join('+');
      if (want === undefined) bad.push(`C ${hy} ${r.date} ${who}: the oracle has no reading (year type unknown)`);
      else if (want !== got) bad.push(`C ${hy} ${r.date} ${who}: catalog reads "${got || '(festival)'}", KosherJava table reads "${want || '(festival)'}"`);
    }
  }
  return bad;
}

// ---------------------------------------------------------------- driver

/** Runs the three layers over Gregorian years [from, to]. */
export function verifyCalendar({ from = 1800, to = 2300, plugin = loadPluginCalendar() } = {}) {
  const t0 = Date.now();
  const days = intlScan(from - 1, to + 2);
  const inRange = days.filter((d) => d.iso >= `${from}-01-01` && d.iso <= `${to}-12-31`);
  const bad = checkHebrewDates(inRange, plugin);
  const byYear = new Map();
  for (const d of days) { if (!byYear.has(d.y)) byYear.set(d.y, []); byYear.get(d.y).push(d); }
  const years = [...byYear.keys()].filter((y) => byYear.has(y + 1) && byYear.has(y - 1) && byYear.get(y)[0].iso >= `${from}-01-01`).sort((a, b) => a - b);
  let checkedYears = 0;
  for (const hy of years) {
    if (byYear.get(hy)[0].iso > `${to}-12-31`) break;
    // the year with a 3-day margin either side so Shabbat/fast rules that cross a year boundary resolve
    const window = [...byYear.get(hy), ...byYear.get(hy + 1).slice(0, 5)];
    bad.push(...checkEvents(hy, window), ...checkParasha(hy, window));
    checkedYears++;
  }
  return { problems: bad, days: inRange.length, years: checkedYears, ms: Date.now() - t0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
  const result = verifyCalendar({ from: arg('--from', 1800), to: arg('--to', 2300) });
  console.log(`checked ${result.days} days and ${result.years} Hebrew years in ${result.ms} ms: ${result.problems.length} discrepancies`);
  if (!process.argv.includes('--quiet')) for (const p of result.problems.slice(0, 60)) console.log('  ' + p);
  if (result.problems.length > 60) console.log(`  ... and ${result.problems.length - 60} more`);
  process.exit(result.problems.length ? 1 : 0);
}
