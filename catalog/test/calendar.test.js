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
