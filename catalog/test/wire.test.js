import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureJson } from './helpers.js';
import { toWire, fromWire, assertRoundTrip } from '../lib/wire.mjs';

const vectors = fixtureJson('url-vectors.json');

test('inheritance vectors (the plugin copy must pass the same file)', () => {
  for (const v of vectors.inherit) assert.deepEqual(fromWire(v.wire, v.series, {}), v.expect, v.name);
});

test('toWire drops exactly what fromWire restores', () => {
  const series = { id: 's_1', title: 'אור החיים', lang: 'he' };
  const specs = { tashma: { urlBase: 'https://tashma.co.il/gilyonot/', urlTemplates: { url: 'file/{ext}', page: '{ext}', thumb: 'thumb/{ext}.png' } } };
  const issue = {
    id: 'i_1', series: 's_1', title: 'אור החיים', lang: 'he', hy: 5787, date: '2026-10-17',
    assets: [{ src: 'tashma', ext: '7', rawTitle: 'אור החיים', url: 'https://tashma.co.il/gilyonot/file/7', page: 'https://tashma.co.il/gilyonot/7', thumb: 'https://tashma.co.il/gilyonot/thumb/7.png' }],
  };
  const w = toWire(issue, series, specs);
  assert.deepEqual(w, { id: 'i_1', series: 's_1', hy: 5787, date: '2026-10-17', assets: [{ src: 'tashma', ext: '7' }] });
  assertRoundTrip(issue, w, series, specs);
  // a different title or language stays explicit
  const other = { ...issue, title: 'אור החיים - ביאור', lang: 'yi', assets: [{ ...issue.assets[0], rawTitle: 'אור החיים' }] };
  const w2 = toWire(other, series, specs);
  assert.equal(w2.title, 'אור החיים - ביאור');
  assert.equal(w2.lang, 'yi');
  assert.equal(w2.assets[0].rawTitle, 'אור החיים');
  assertRoundTrip(other, w2, series, specs);
  // a broken wire form is caught
  assert.throws(() => assertRoundTrip(issue, { ...w, date: '2026-10-24' }, series, specs), /round-trip/);
});
