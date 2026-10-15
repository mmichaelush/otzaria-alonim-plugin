// The date audit's own matcher and checks (tools/audit-dates.mjs): they judge the catalog, so they are tested too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namedPortions, namedYears, namedEvents, evaluate, rng } from '../tools/audit-dates.mjs';

test('namedPortions: distinctive names only, pairs, and spelling variants', () => {
  assert.deepEqual([...namedPortions('אסיפת גליונות וירא תשפ"ו')], ['vayera']);
  assert.deepEqual([...namedPortions('תזריע-מצורע')].sort(), ['metzora', 'tazria']);
  assert.deepEqual([...namedPortions('פרשת תצווה')], ['tetzaveh']);
  assert.deepEqual([...namedPortions('156מקץ ויגש')].sort(), ['miketz', 'vayigash']);
  // ambiguous words prove nothing about the week
  assert.deepEqual([...namedPortions('גליון בא שמות דברים ראה')], []);
  assert.deepEqual([...namedPortions('שמיני עצרת')], [], 'Shemini Atzeret is a festival, not the portion');
});

test('namedYears: only 5740-5799, a tens letter after תש, and never "כי תשא" or "תשעה באב"', () => {
  assert.deepEqual([...namedYears('גליון פרשת נח תשפ"ו')], [5786]);
  assert.deepEqual([...namedYears('בלק_תשפד')], [5784]);
  assert.deepEqual([...namedYears('תשפ_ב')], [5782], 'underscore stands for the gershayim');
  assert.deepEqual([...namedYears('פרשת כי תשא')], []);
  assert.deepEqual([...namedYears('מתיקות ועריבות התורה תשעה באב')], []);
  assert.deepEqual([...namedYears('התש"ף')], [5780], 'final letters count as their plain forms');
  assert.deepEqual([...namedYears('תשכ"ב')], [], 'before 5740 is not believed');
});

test('namedEvents', () => {
  assert.deepEqual([...namedEvents('קונטרס פורים תשפו')], ['purim']);
  assert.deepEqual([...namedEvents('פסח וחול המועד')], ['pesach']);
});

const item = (over) => ({
  src: 'x', ext: '1', date: '2026-10-17', hy: 5787, slugs: ['noach'], how: 'parasha-year', addedAt: '2026-10-12T10:00:00Z',
  asset: { rawTitle: 'עלון נח תשפ"ז' }, raw: { contextTitles: [] }, ...over,
});

test('evaluate: a consistent copy passes every check', () => {
  const r = evaluate(item({}));
  assert.deepEqual(Object.values(r.checks).filter((v) => v === 'FAIL'), []);
  assert.equal(r.checks['title-parasha'], 'ok');
  assert.equal(r.checks['title-year'], 'ok');
});

test('evaluate: a title naming another portion or year, and a bulletin uploaded months early, are flagged', () => {
  assert.equal(evaluate(item({ asset: { rawTitle: 'עלון ויצא תשפ"ז' } })).checks['title-parasha'], 'FAIL');
  assert.equal(evaluate(item({ asset: { rawTitle: 'עלון נח תשפ"ה' } })).checks['title-year'], 'FAIL');
  assert.equal(evaluate(item({ addedAt: '2026-04-01T10:00:00Z' })).checks['upload-gap'], 'FAIL');
  // a multi-week title that includes the week is fine; the series name is not evidence
  assert.equal(evaluate(item({ asset: { rawTitle: 'נח לך לך' } })).checks['title-parasha'], 'ok');
  assert.equal(evaluate(item({ asset: { rawTitle: 'תולדות אהרן ויצא' }, raw: { contextTitles: [], seriesHint: { title: 'תולדות אהרן' } } })).checks['title-parasha'], 'FAIL', 'vayetzei is not the week; "תולדות" belongs to the series name');
  // the plumbing checks catch a date that is no week, a wrong year and a foreign reading
  assert.equal(evaluate(item({ date: '2026-10-18' })).checks['date-row'], 'FAIL');
  assert.equal(evaluate(item({ hy: 5786 })).checks.year, 'FAIL');
  assert.equal(evaluate(item({ slugs: ['vayera'] })).checks.reading, 'FAIL');
  assert.equal(evaluate(item({ date: null })).checks['date-row'], 'n/a');
});

test('rng is seeded', () => {
  const a = rng(7), b = rng(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
