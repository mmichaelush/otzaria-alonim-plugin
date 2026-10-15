import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isArchive, bulkDaysOf, ARCHIVE_LAG_DAYS, BULK_DAY_MIN } from '../lib/archive.mjs';
import { enrich, buildAliasIndex } from '../lib/enrich.mjs';
import { mergeAll } from '../lib/merge.mjs';
import { hyEndIso } from '../lib/calendar.mjs';

test('hyEndIso is the day before Rosh Hashana', () => {
  assert.equal(hyEndIso(5786), '2026-09-11');
  assert.equal(hyEndIso(5787), '2027-10-01');
});

test('archive: late uploads, bulk-import days, year-only issues; fresh uploads are not archive', () => {
  assert.equal(isArchive({ added: '2026-10-14T20:00:00Z', src: 'ladaat', date: '2026-10-17' }), false);
  assert.equal(isArchive({ added: '2026-10-20T20:00:00Z', src: 'ladaat', date: '2026-10-17' }), false, 'a few days late is still news');
  assert.equal(isArchive({ added: '2026-07-01T18:56:53Z', src: 'tashma', date: '2018-10-13' }), true, 'a 2018 week uploaded in 2026');
  assert.equal(isArchive({ added: '2026-10-14T00:00:00Z', src: 'tashma', date: '2026-10-17' }), false);
  const edge = new Date(Date.parse('2026-10-17T00:00:00Z') + ARCHIVE_LAG_DAYS * 864e5).toISOString();
  assert.equal(isArchive({ added: edge, src: 'x', date: '2026-10-17' }), false);
  assert.equal(isArchive({ added: new Date(Date.parse(edge) + 2 * 864e5).toISOString(), src: 'x', date: '2026-10-17' }), true);
  // year only: relative to the end of that Hebrew year
  assert.equal(isArchive({ added: '2026-07-01T00:00:00Z', src: 'tashma', hy: 5775 }), true);
  assert.equal(isArchive({ added: '2026-10-01T00:00:00Z', src: 'tashma', hy: 5787 }), false);
  // nothing known: not archive
  assert.equal(isArchive({ added: '2026-07-01T00:00:00Z', src: 'tashma' }), false);
  // a bulk day, whatever the week
  const bulk = new Set(['tashma:2026-07-01']);
  assert.equal(isArchive({ added: '2026-07-01T10:00:00Z', src: 'tashma', date: '2026-06-27' }, bulk), true);
  assert.equal(isArchive({ added: '2026-07-01T10:00:00Z', src: 'ladaat', date: '2026-06-27' }, bulk), false, 'the day is per source');
});

test('bulkDaysOf counts uploads per source and day', () => {
  const items = [];
  for (let i = 0; i < BULK_DAY_MIN; i++) items.push({ src: 'tashma', addedAt: '2026-07-01T10:00:00Z' });
  for (let i = 0; i < BULK_DAY_MIN - 1; i++) items.push({ src: 'ladaat', addedAt: '2026-07-01T10:00:00Z' });
  items.push({ src: 'tashma' });
  assert.deepEqual([...bulkDaysOf(items)], ['tashma:2026-07-01']);
});

test('merged issues carry archive when the earliest sighting is not news, and series list their years', () => {
  const NOW = '2026-10-15T08:00:00Z';
  const idx = buildAliasIndex({});
  const mk = (ext, title, addedAt, over = {}) => enrich({ src: 'tashma', ext, rawTitle: title, seriesHint: { title: 'סדרה' }, addedAt, url: 'https://x.test/a.pdf', page: 'https://x.test/', ...over }, { now: NOW, aliasIndex: idx });
  const old = mk('1', 'פרשת נח תשעט', '2026-07-01T18:00:00Z');
  const fresh = mk('2', 'פרשת נח תשפז', '2026-10-14T18:00:00Z');
  const { issues, series } = mergeAll([old, fresh], { now: NOW, aliasIndex: idx });
  const byHy = Object.fromEntries(issues.map((i) => [i.hy, i]));
  assert.equal(byHy[5779].archive, true);
  assert.equal(byHy[5787].archive, undefined);
  assert.deepEqual(series[0].years, [5779, 5787]);
  // sticky: an item marked archive in the previous catalog stays archive
  const sticky = { ...fresh, archive: true };
  assert.equal(mergeAll([sticky], { now: NOW, aliasIndex: idx }).issues[0].archive, true);
});
