import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hyOfIso, weeksOfYear, weeksBetween, findDate, PARASHA_SLUGS, parashaSlug, addDays } from '../lib/calendar.mjs';
import { resolveWeekLabel, expectedSlugs } from '../lib/dates.mjs';
import { weekLabelParts } from '../lib/parasha.mjs';

test('Hebrew year turns over on Rosh Hashana, not on 1 September', () => {
  assert.equal(hyOfIso('2026-09-11'), 5786);
  assert.equal(hyOfIso('2026-09-12'), 5787); // Rosh Hashana 5787 fell on Saturday 12.9.2026
  assert.equal(hyOfIso('2027-09-01'), 5787);
  assert.equal(hyOfIso('garbage'), null);
});

test('Shabbat rows: Noach 5787 on 17.10.2026, same in Israel', () => {
  const row = weeksOfYear(5787).find((r) => r.date === '2026-10-17');
  assert.deepEqual(row.parasha, ['noach']);
  assert.deepEqual(row.parashaIL, ['noach']);
  assert.equal(row.label, 'נח');
  assert.equal(row.shabbat, true);
});

test('diaspora and Israel readings differ after Shavuot 5786', () => {
  const rows = weeksOfYear(5786);
  const w = (d) => rows.find((r) => r.date === d);
  assert.deepEqual(w('2026-06-27').parasha, ['chukat', 'balak']);
  assert.deepEqual(w('2026-06-27').parashaIL, ['balak']);
  assert.equal(w('2026-06-27').label, 'חוקת־בלק · בלק');
  // Shabbat that is Shavuot II abroad: no parasha there, Nasso in Israel.
  assert.deepEqual(w('2026-05-23').parasha, []);
  assert.deepEqual(w('2026-05-23').parashaIL, ['nasso']);
  assert.equal(w('2026-05-23').event, 'shavuot');
});

test('double readings and special Shabbatot', () => {
  const rows = weeksOfYear(5786);
  const w = (d) => rows.find((r) => r.date === d);
  assert.deepEqual(w('2026-03-14').parasha, ['vayakhel', 'pekudei']);
  assert.equal(w('2026-03-14').event, 'shabbat-hachodesh');
  assert.equal(w('2026-02-28').event, 'shabbat-zachor');
  assert.equal(w('2026-03-28').event, 'shabbat-hagadol');
  assert.equal(w('2025-09-27').event, 'shabbat-shuva');
  assert.equal(w('2026-07-18').event, 'shabbat-chazon');
  assert.equal(w('2026-07-25').event, 'shabbat-nachamu');
});

test('festival days that are not Shabbat get their own row with shabbat:false', () => {
  const yk = weeksOfYear(5787).find((r) => r.date === '2026-09-21');
  assert.equal(yk.event, 'yom-kippur');
  assert.equal(yk.shabbat, false);
  assert.deepEqual(yk.parasha, []);
  // Rosh Hashana 5787 is on Shabbat: the Shabbat row carries it, no duplicate row.
  const rh = weeksOfYear(5787).filter((r) => r.event === 'rosh-hashana');
  assert.equal(rh.length, 1);
  assert.equal(rh[0].shabbat, true);
});

test('every slug the calendar emits is in the contract list, and each parasha appears each year', () => {
  const valid = new Set(PARASHA_SLUGS);
  for (let hy = 5770; hy <= 5800; hy++) {
    const seen = new Set();
    for (const r of weeksOfYear(hy)) {
      for (const s of [...r.parasha, ...r.parashaIL]) { assert.ok(valid.has(s), `${hy} ${s}`); seen.add(s); }
    }
    // Vezot Haberakhah is read on Simchat Torah; Vayeilech is sometimes read on Shabbat Shuva, i.e. in the next year.
    for (const s of PARASHA_SLUGS) if (s !== 'vezot-haberakhah' && s !== 'vayeilech') assert.ok(seen.has(s), `${hy} missing ${s}`);
  }
  assert.equal(parashaSlug('Sh\'lach'), 'shlach');
  assert.equal(parashaSlug('Shmini'), 'shemini');
  assert.equal(parashaSlug('Beha\'alotcha'), 'behaalotcha');
});

test('weeksBetween is sorted, unique per date, and Shabbat rows are Saturdays', () => {
  const rows = weeksBetween('2026-01-01', '2026-12-31');
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date < rows[i].date);
  for (const r of rows.filter((x) => x.shabbat)) assert.equal(new Date(`${r.date}T12:00:00`).getDay(), 6);
});

test('findDate: parasha + year, half of a double reading, and ambiguity', () => {
  assert.equal(findDate({ hy: 5787, slugs: ['noach'] }), '2026-10-17');
  assert.equal(findDate({ hy: 5786, slugs: ['matot'] }), '2026-07-11'); // matot-masei: "מטות" alone still lands on that Shabbat
  assert.equal(findDate({ hy: 5786, slugs: ['matot', 'masei'] }), '2026-07-11');
  assert.equal(findDate({ hy: 5787, event: 'yom-kippur' }), '2026-09-21');
  assert.equal(findDate({ hy: null, slugs: ['noach'] }), null);
  assert.equal(findDate({ hy: 5787, slugs: [] }), null);
});

test('gilyoines-style week labels resolve to the right Shabbat, including reversed IL/diaspora pairs', () => {
  const at = (label, ref) => resolveWeekLabel(weekLabelParts(label), ref)?.date;
  assert.equal(at('נח', '2026-09-29T19:43:00Z'), '2026-10-17');
  assert.equal(at('קרח - שלח', '2026-05-25T10:00:00Z'), '2026-06-13'); // Israel Korach, diaspora Shlach
  assert.equal(at('חקת - קרח', '2026-05-31T10:00:00Z'), '2026-06-20');
  assert.equal(at('(בלק (חקת-בלק', '2026-06-09T10:00:00Z'), '2026-06-27');
  assert.equal(at('שבועות - נשא', '2026-05-05T10:00:00Z'), '2026-05-23');
  assert.equal(at('תצוה - פורים', '2026-02-11T10:00:00Z'), '2026-02-28');
  assert.equal(at('ראש השנה', '2026-08-27T10:00:00Z'), '2026-09-12');
  assert.equal(at('שמיני עצרת - שמחת תורה', '2026-09-23T10:00:00Z'), '2026-10-03');
  assert.equal(at('פסח', '2026-03-24T10:00:00Z'), '2026-04-02');
  assert.equal(resolveWeekLabel(weekLabelParts('שבילי פנחס'), 'garbage'), null);
});

test('expectedSlugs covers the reading around an upload date', () => {
  const e = expectedSlugs('2026-10-14T10:00:00Z');
  assert.ok(e.includes('noach'));
  assert.ok(e.includes('lech-lecha'));
  assert.ok(!e.includes('vayera') || addDays('2026-10-14', 24) >= '2026-10-31');
});

import { HDate } from '@hebcal/core';
import { hebrewDateOf, rowHasEvent } from '../lib/calendar.mjs';
import { EVENTS, EVENT_PRIORITY, hebrewDateString } from '../lib/events.mjs';

test('Hebrew date strings agree with Hebcal gematria for every day of ten years', () => {
  const strip = (s) => s.replace(/[֑-ׇ]/g, '').replace(/וו/g, 'ו');
  for (let abs = new HDate(1, 'Tishrei', 5780).abs(); abs < new HDate(1, 'Tishrei', 5790).abs(); abs++) {
    const hd = new HDate(abs);
    const theirs = strip(hd.renderGematriya(true)).split(' ');
    const mine = strip(hebrewDateString(hd)).split(' ');
    assert.equal(mine[0], theirs[0], `${hd}`); // day
    assert.equal(mine.at(-1), theirs.at(-1), `${hd}`); // year without the thousands
    assert.equal(mine.slice(1, -1).join(' ').replace(/^ב/, ''), theirs.slice(1, -1).join(' '), `${hd}`);
  }
  assert.equal(hebrewDateOf('2026-10-17'), 'ו׳ בחשוון תשפ״ז');
  assert.equal(hebrewDateOf('2026-04-02'), 'ט״ו בניסן תשפ״ו');
  assert.equal(hebrewDateOf('2026-09-12'), 'א׳ בתשרי תשפ״ז');
});

test('every requested festival, fast and special Shabbat has a row in every year (2020-2035)', () => {
  const required = ['rosh-hashana', 'tzom-gedaliah', 'shabbat-shuva', 'yom-kippur', 'sukkot', 'chol-hamoed-sukkot', 'hoshana-raba',
    'shemini-atzeret', 'simchat-torah', 'chanukah', 'asara-btevet', 'tu-bishvat', 'taanit-esther', 'purim', 'shushan-purim', 'pesach',
    'chol-hamoed-pesach', 'shvii-shel-pesach', 'shavuot', 'shiva-asar-btammuz', 'tisha-bav', 'shabbat-shekalim', 'shabbat-zachor',
    'shabbat-parah', 'shabbat-hachodesh', 'shabbat-hagadol', 'shabbat-chazon', 'shabbat-nachamu', 'shabbat-shirah', 'rosh-chodesh'];
  for (let hy = 5780; hy <= 5795; hy++) {
    const rows = weeksOfYear(hy);
    for (const ev of required) assert.ok(rows.some((r) => rowHasEvent(r, ev)), `${hy} has no ${ev}`);
    // Shabbat Mevarchim is carried by Shabbat rows (never the primary event)
    assert.ok(rows.some((r) => r.shabbat && r.events?.includes('shabbat-mevarchim')), `${hy} mevarchim`);
    assert.ok(rows.every((r) => r.event !== 'shabbat-mevarchim' && r.event !== 'aseret-yemei-teshuva'));
    assert.ok(rows.every((r) => r.hebrew && r.label && r.hy === hyOfIso(r.date)));
  }
  assert.deepEqual([...new Set(EVENT_PRIORITY)].sort(), Object.keys(EVENTS).sort(), 'every event has a priority and a name');
});

test('weekday event rows: dates, labels and multi-day events', () => {
  const rows = weeksOfYear(5787);
  const at = (d) => rows.find((r) => r.date === d);
  assert.equal(at('2026-09-13'), undefined, 'second day of Rosh Hashana has no row of its own');
  assert.equal(at('2026-09-14').event, 'tzom-gedaliah');
  assert.equal(at('2026-09-21').event, 'yom-kippur');
  assert.equal(at('2026-09-28').event, 'chol-hamoed-sukkot');
  assert.equal(at('2026-10-02').event, 'hoshana-raba');
  assert.equal(at('2026-10-03').event, 'shemini-atzeret');
  assert.equal(at('2026-10-04').event, 'simchat-torah');
  assert.equal(at('2026-10-11').event, 'rosh-chodesh');
  assert.equal(at('2026-10-11').label, 'ראש חודש חשוון');
  // Shabbat before Rosh Chodesh Cheshvan: Bereshit, with Mevarchim only as a secondary event
  assert.equal(at('2026-10-10').event, null);
  assert.deepEqual(at('2026-10-10').events, ['shabbat-mevarchim']);
  // Chanukah: one weekday row on 25 Kislev; the Shabbatot inside carry the event
  assert.equal(at('2026-12-04').event, 'chanukah');
  assert.equal(rows.filter((r) => r.event === 'chanukah' && !r.shabbat).length, 1);
  assert.equal(at('2026-12-05').event, 'chanukah');
  // Pesach 5787 starts on 22.4.2027; the first Chol HaMoed weekday row is the day after
  assert.equal(rows.find((r) => r.event === 'pesach').date, '2027-04-22');
  assert.equal(at('2027-04-24').event, 'chol-hamoed-pesach'); // Chol HaMoed starts on Shabbat that year: no weekday row
});

test('findDate by event, including Rosh Chodesh with its month', () => {
  assert.equal(findDate({ hy: 5787, event: 'rosh-chodesh', month: 'Cheshvan' }), '2026-10-11');
  assert.equal(findDate({ hy: 5787, event: 'rosh-chodesh' }), null, 'a month is required');
  assert.equal(findDate({ hy: 5787, event: 'chanukah' }), '2026-12-04');
  assert.equal(findDate({ hy: 5786, event: 'purim' }), '2026-03-03');
  assert.equal(findDate({ hy: 5787, event: 'simchat-torah' }), '2026-10-04');
  assert.equal(findDate({ hy: 5787, event: 'tisha-bav' }), '2027-08-12');
});
