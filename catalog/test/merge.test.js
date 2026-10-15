import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrich, buildAliasIndex, seriesIdentity, seriesCore } from '../lib/enrich.mjs';
import { mergeAll } from '../lib/merge.mjs';
import { itemsFromPrev } from '../lib/prev.mjs';

const NOW = '2026-10-15T08:00:00Z';
const noAliases = buildAliasIndex({});

const raw = (o) => ({
  src: 'ladaat', ext: String(Math.random()), rawTitle: '', seriesHint: { title: '' }, dateHint: null, addedAt: '2026-10-14T10:00:00Z',
  url: 'https://x.test/a.pdf', page: 'https://x.test/', ...o,
});
const build = (raws, aliasIndex = noAliases) => mergeAll(raws.map((r) => enrich(r, { now: NOW, aliasIndex })), { now: NOW, aliasIndex });

const ladaatAsifat = raw({ src: 'ladaat', ext: '23569', rawTitle: 'אסיפת גליונות נח', seriesHint: { ext: '37', title: 'אסיפת גליונות', lang: 'he', circle: 'כללי' }, dateHint: '2026-10-17', pages: null });
const tashmaAsifat = raw({ src: 'tashma', ext: '101853', rawTitle: 'אסיפת נח לשליחה (1)', contextTitles: ['תשפ"ז'], seriesHint: { ext: 'אסיפת גליונות', title: 'אסיפת גליונות' }, pages: 96 });
const gilAsifat = raw({ src: 'gilyoines', ext: '146999', rawTitle: 'אסיפת גליונות', seriesHint: { ext: '77', title: 'אסיפת גליונות', lang: 'he' }, weekHint: { id: 224, name: 'נח', refTime: '2026-09-29T19:43:00Z' }, pages: 96 });

test('the same issue at three sources becomes one issue with copies in preference order', () => {
  const { series, issues } = build([gilAsifat, tashmaAsifat, ladaatAsifat]);
  assert.equal(series.length, 1);
  assert.equal(issues.length, 1);
  const i = issues[0];
  assert.deepEqual(i.assets.map((a) => a.src), ['ladaat', 'tashma', 'gilyoines']);
  assert.equal(i.date, '2026-10-17');
  assert.equal(i.hy, 5787);
  assert.deepEqual(i.parasha, ['noach']);
  assert.equal(i.series, series[0].id);
  assert.match(i.id, /^i_[0-9a-f]{12}$/);
  assert.match(series[0].id, /^s_[0-9a-f]{10}$/);
  assert.equal(series[0].circle, 'כללי');
  assert.deepEqual(series[0].sources.map((s) => s.src), ['ladaat', 'tashma', 'gilyoines']);
  assert.equal(series[0].issueCount, 1);
  assert.equal(series[0].first, '2026-10-17');
  assert.equal(i.added, '2026-10-14T10:00:00Z');
});

test('every copy is kept with its own direct pdf url and its own page', () => {
  const { issues } = build([ladaatAsifat, tashmaAsifat, gilAsifat]);
  for (const a of issues[0].assets) { assert.ok(a.url); assert.ok(a.page); assert.ok(a.ext); assert.ok(a.rawTitle); }
});

test('merging is order independent and ids are stable', () => {
  const a = build([ladaatAsifat, tashmaAsifat, gilAsifat]);
  const b = build([gilAsifat, ladaatAsifat, tashmaAsifat]);
  assert.deepEqual(a, b);
  // adding a fourth copy later keeps the issue id
  const alonolam = raw({ src: 'alonolam', ext: '555', rawTitle: 'אסיפת גליונות נח', seriesHint: { title: 'אסיפת גליונות', lang: 'he', derived: true }, refMonth: '2026-10', addedAt: null });
  const c = build([ladaatAsifat, tashmaAsifat, gilAsifat, alonolam]);
  assert.equal(c.issues.length, 1);
  assert.equal(c.issues[0].id, a.issues[0].id);
  assert.equal(c.issues[0].assets.length, 4);
});

test('must NOT merge: different issue numbers in the same week and series', () => {
  const a = raw({ src: 'ladaat', ext: '1', rawTitle: 'עלון נח 5', seriesHint: { title: 'פניני משה', lang: 'he' }, dateHint: '2026-10-17' });
  const b = raw({ src: 'alonolam', ext: '2', rawTitle: 'פניני משה גליון 6 נח', seriesHint: { title: 'פניני משה', lang: 'he' }, refMonth: '2026-10', addedAt: null });
  const { issues } = build([a, b]);
  assert.equal(issues.length, 2);
});

test('must NOT merge: two files of one source are two issues even in the same week', () => {
  const a = raw({ src: 'tashma', ext: '1', rawTitle: 'דעם רבינס מעשיות 301', contextTitles: ['תשפ"ז'], seriesHint: { title: 'דעם רבינס מעשיות' } });
  const b = raw({ src: 'tashma', ext: '2', rawTitle: 'דעם רבינס מעשיות אידיש 301', contextTitles: ['תשפ"ז'], seriesHint: { title: 'דעם רבינס מעשיות' } });
  assert.equal(build([a, b]).issues.length, 2);
});

test('must NOT merge: page counts that disagree', () => {
  const a = raw({ src: 'ladaat', ext: '1', rawTitle: 'שבת טיש נח', seriesHint: { title: 'שבת טיש' }, dateHint: '2026-10-17', pages: 4 });
  const b = raw({ src: 'gilyoines', ext: '2', rawTitle: 'שבת טיש', seriesHint: { title: 'שבת טיש' }, weekHint: { id: 224, name: 'נח', refTime: '2026-09-29T19:43:00Z' }, pages: 8 });
  assert.equal(build([a, b]).issues.length, 2);
});

test('must NOT merge: different weeks, different language editions, different series', () => {
  const mk = (o) => raw({ src: 'ladaat', seriesHint: { title: 'הבינני', lang: 'he' }, dateHint: '2026-10-17', ...o });
  assert.equal(build([mk({ ext: '1' }), mk({ ext: '2', src: 'gilyoines', rawTitle: 'הבינני', dateHint: null, weekHint: { id: 223, name: 'בראשית', refTime: '2026-09-23T10:00:00Z' } })]).issues.length, 2);
  const yi = build([mk({ ext: '1', rawTitle: 'הבינני נח' }), mk({ ext: '2', src: 'gilyoines', rawTitle: 'הבינני - אידיש', seriesHint: { title: 'הבינני - אידיש', lang: 'yi' }, dateHint: null, weekHint: { id: 224, name: 'נח', refTime: '2026-09-29T19:43:00Z' } })]);
  assert.equal(yi.issues.length, 2);
  assert.equal(yi.series.length, 2);
  assert.deepEqual(yi.series.map((s) => s.lang).sort(), ['he', 'yi']);
  const other = build([mk({ ext: '1', rawTitle: 'אור החיים נח', seriesHint: { title: 'אור החיים' } }), mk({ ext: '2', src: 'gilyoines', rawTitle: 'אור היום', seriesHint: { title: 'אור היום' }, dateHint: null, weekHint: { id: 224, name: 'נח', refTime: '2026-09-29T19:43:00Z' } })]);
  assert.equal(other.issues.length, 2);
});

test('must NOT merge when the pairing is ambiguous (a tie between candidates)', () => {
  // two unnumbered, indistinguishable ladaat issues of one week vs one gilyoines copy: we cannot tell which it is
  const l1 = raw({ src: 'ladaat', ext: '1', rawTitle: 'מעדני שבת נח', seriesHint: { title: 'מעדני שבת' }, dateHint: '2026-10-17' });
  const l2 = raw({ src: 'ladaat', ext: '2', rawTitle: 'מעדני שבת נח', seriesHint: { title: 'מעדני שבת' }, dateHint: '2026-10-17' });
  const g = raw({ src: 'gilyoines', ext: '3', rawTitle: 'מעדני שבת', seriesHint: { title: 'מעדני שבת' }, weekHint: { id: 224, name: 'נח', refTime: '2026-09-29T19:43:00Z' } });
  const { issues } = build([l1, l2, g]);
  assert.equal(issues.length, 3);
  assert.equal(new Set(issues.map((i) => i.id)).size, 3, 'ids stay unique');
  // but numbers resolve the tie
  const n1 = { ...l1, ext: '1', rawTitle: 'מעדני שבת גליון 1 נח' };
  const n2 = { ...l2, ext: '2', rawTitle: 'מעדני שבת גליון 2 נח' };
  const g2 = { ...g, rawTitle: 'מעדני שבת גליון 2' };
  const r = build([n1, n2, g2]);
  assert.equal(r.issues.length, 2);
  assert.equal(r.issues.find((i) => i.no === 2).assets.length, 2);
});

test('a source copy is never dropped: asset count in equals asset count out', () => {
  const all = [ladaatAsifat, tashmaAsifat, gilAsifat, raw({ src: 'ladaat', ext: '9', rawTitle: 'אור החיים נח', seriesHint: { title: 'אור החיים' }, dateHint: '2026-10-17' })];
  const { issues } = build(all);
  assert.equal(issues.reduce((n, i) => n + i.assets.length, 0), all.length);
});

test('aliases: one series under two names, with previousIds for favourites migration', () => {
  const aliases = buildAliasIndex({ merge: [{ canonical: 'אסיפת גליונות', aliases: ['אסיפת גליונות - ליקוט'] }] });
  const variant = raw({ src: 'tashma', ext: '5', rawTitle: 'ליקוט נח', contextTitles: ['תשפ"ז'], seriesHint: { title: 'אסיפת גליונות - ליקוט' } });
  const { series } = build([ladaatAsifat, variant], aliases);
  assert.equal(series.length, 1);
  assert.equal(series[0].previousIds.length, 1);
  const before = build([variant]).series[0].id;
  assert.deepEqual(series[0].previousIds, [before]);
  assert.equal(seriesIdentity('אסיפת גליונות - ליקוט', null, 'tashma', aliases).id, seriesIdentity('אסיפת גליונות', null, 'ladaat', aliases).id);
});

test('series key ignores generic words, numbers, years and parasha names', () => {
  assert.equal(seriesCore('עלון שבועי פרשת נח תשפז'), '');
  assert.equal(seriesCore('אסיפת גליונות 12'), 'אסיפת גליונות');
  assert.equal(seriesIdentity('עלון עמק השבוע', 'he', 'x', noAliases).id, seriesIdentity('עמק השבוע', 'he', 'y', noAliases).id);
  const unnamed = seriesIdentity('עלון', 'he', 'alonolam', noAliases);
  assert.equal(unnamed.named, false);
  assert.notEqual(unnamed.id, seriesIdentity('עלון', 'he', 'tashma', noAliases).id, 'unnamed material of different sources is not one series');
});

test('timeless material (no year, no week) stays timeless and merges only on identical titles', () => {
  const a = raw({ src: 'gilyoines', ext: '2', rawTitle: 'זמירות ליל שבת', seriesHint: { title: 'זמירות ליל שבת', lang: 'he' }, timeless: true });
  const b = raw({ src: 'ladaat', ext: '3', rawTitle: 'זמירות ליל שבת', seriesHint: { title: 'זמירות ליל שבת', lang: 'he' }, timeless: true });
  const c = raw({ src: 'ladaat', ext: '4', rawTitle: 'ברכת המזון', seriesHint: { title: 'ברכת המזון', lang: 'he' }, timeless: true });
  const { issues, series } = build([a, b, c]);
  assert.equal(issues.length, 2);
  assert.ok(issues.every((i) => i.hy === null && i.date === null));
  assert.ok(series.every((s) => s.kind === 'timeless'));
});

test('previous output round-trips: re-merging reconstructed items reproduces the same catalog', () => {
  const first = build([ladaatAsifat, tashmaAsifat, gilAsifat]);
  const prev = { series: first.series, issues: first.issues };
  const { items, prevAdded } = itemsFromPrev(prev, { aliasIndex: noAliases });
  const again = mergeAll(items, { now: '2027-01-01T00:00:00Z', prevAdded, aliasIndex: noAliases });
  assert.deepEqual(again.issues, first.issues);
  assert.deepEqual(again.series.map((s) => [s.id, s.title, s.issueCount]), first.series.map((s) => [s.id, s.title, s.issueCount]));
});

test('a source skipped in the previous catalog is dropped from reconstruction (clean full crawl)', () => {
  const first = build([ladaatAsifat, tashmaAsifat]);
  const { items } = itemsFromPrev({ series: first.series, issues: first.issues }, { aliasIndex: noAliases, skipSources: new Set(['tashma']) });
  assert.deepEqual(items.map((i) => i.src), ['ladaat']);
});

test('a text-dated title keeps the reading it named (Israel-only "חקת" is not relabelled as Korach)', () => {
  const r = raw({ src: 'tashma', ext: '1', rawTitle: 'הסודות הגנוזים חקת תשפו', seriesHint: { title: 'הסודות הגנוזים' } });
  const it = enrich(r, { now: NOW, aliasIndex: noAliases });
  assert.equal(it.date, '2026-06-20');
  assert.deepEqual(it.slugs, ['chukat']);
  const half = enrich(raw({ src: 'tashma', ext: '2', rawTitle: 'פרשת מטות תשפו', seriesHint: { title: 'X' } }), { now: NOW, aliasIndex: noAliases });
  assert.deepEqual(half.slugs, ['matot', 'masei']); // half of a double reading becomes the whole reading
  assert.equal(half.date, '2026-07-11');
});
