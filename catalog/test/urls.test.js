import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureJson, fixture } from './helpers.js';
import { decodeNonAscii, encodeNonAscii, resolveAssetUrls, compressAssetUrls, usableSpec } from '../lib/urls.mjs';
import * as ladaat from '../connectors/ladaat.mjs';
import * as tashma from '../connectors/tashma.mjs';
import * as gilyoines from '../connectors/gilyoines.mjs';
import * as alonolam from '../connectors/alonolam.mjs';

const vectors = fixtureJson('url-vectors.json');

test('url vectors: encodeNonAscii, decodeNonAscii (the plugin copy must pass the same file)', () => {
  for (const [input, expected] of vectors.encodeNonAscii) assert.equal(encodeNonAscii(input), expected, input);
  for (const [input, expected] of vectors.decodeNonAscii) assert.equal(decodeNonAscii(input), expected, input);
});

test('url vectors: resolveAssetUrls', () => {
  for (const v of vectors.resolve) assert.deepEqual(resolveAssetUrls(v.asset, v.source), v.expect, v.name);
});

test('only non-ASCII is decoded: ASCII escapes survive both directions', () => {
  const u = 'https://x.test/%5B37%5D-%D7%90%20%26%23%3F%25.pdf';
  const d = decodeNonAscii(u);
  assert.equal(d, 'https://x.test/%5B37%5D-א%20%26%23%3F%25.pdf');
  assert.equal(encodeNonAscii(d), u);
});

test('compress then resolve gives back the original, for tricky values', () => {
  const source = { urlBase: 'https://s.test/up/', urlTemplates: { page: 'view/{ext}', thumb: 'th/{ext}.png' } };
  const assets = [
    { src: 's', ext: '1', url: 'https://s.test/up/a/%5B1%5D-%D7%90.pdf', page: 'https://s.test/up/view/1', thumb: 'https://s.test/up/th/1.png' },
    { src: 's', ext: '2', url: 'https://s.test/up/', page: 'https://s.test/up/view/9', thumb: 'https://elsewhere.test/%D7%90.png' },
    { src: 's', ext: 'a b', url: 'https://s.test/other/x.pdf', page: 'https://s.test/up/view/a%20b', thumb: 'https://s.test/up/th/a b.png' },
    { src: 's', ext: '3', url: 'https://s.test/up/%d7%90.pdf' }, // lowercase hex does not round-trip: kept as is
  ];
  for (const a of assets) {
    const wire = compressAssetUrls(a, source);
    const back = resolveAssetUrls(wire, source);
    // (a missing field would be invented by a template: that is why usableSpec exists)
    for (const f of ['url', 'page', 'thumb']) if (a[f] !== undefined) assert.equal(back[f], a[f], `${a.ext} ${f}`);
  }
  const w = compressAssetUrls(assets[0], source);
  assert.equal(w.url, 'a/%5B1%5D-א.pdf');
  assert.equal(w.page, undefined, 'omitted: equals the template');
  assert.equal(w.thumb, undefined);
  assert.equal(compressAssetUrls(assets[3], source).url, 'https://s.test/up/%d7%90.pdf');
  // the page without a template stays explicit
  assert.equal(compressAssetUrls({ src: 's', ext: '4', url: 'https://s.test/up/z.pdf', page: 'https://s.test/p/4' }, source).page, 'https://s.test/p/4');
});

test('a template is only used when every copy of the source has that field', () => {
  const spec = { urlBase: 'https://s.test/', urlTemplates: { page: 'p/{ext}', thumb: 't/{ext}' } };
  assert.deepEqual(usableSpec(spec, [{ page: 'a', thumb: 'b' }, { page: 'c' }]).urlTemplates, { page: 'p/{ext}' });
  assert.equal(usableSpec(spec, [{ url: 'x' }]).urlTemplates, undefined);
  assert.equal(usableSpec(null, [{}]), null);
});

test('real connector output round-trips through each source spec and gets much shorter', () => {
  const cases = [
    [ladaat, ladaat.parseFiles(fixtureJson('ladaat-files.json'))],
    [tashma, tashma.parseNew(fixtureJson('tashma-new.json'))],
    [gilyoines, gilyoines.parseGilyoines(fixtureJson('gilyoines-home.json'))],
    [alonolam, alonolam.parseList(fixtureJson('alonolam-list.json'))],
  ];
  for (const [mod, raws] of cases) {
    const assets = raws.map((r) => ({ src: r.src, ext: r.ext, url: r.url, page: r.page, thumb: r.thumb }));
    const spec = usableSpec(mod.urlSpec, assets);
    let before = 0, after = 0;
    for (const a of assets) {
      const wire = compressAssetUrls(a, spec);
      const back = resolveAssetUrls(wire, spec);
      for (const f of ['url', 'page', 'thumb']) if (a[f]) assert.equal(back[f], a[f], `${mod.id} ${a.ext} ${f}`);
      before += JSON.stringify(a).length; after += JSON.stringify(wire).length;
    }
    assert.ok(after < before * 0.7, `${mod.id}: ${before} -> ${after}`);
  }
});

test('tashma assets carry no url fields at all; ladaat keeps only the file and thumb paths', () => {
  const t = tashma.parseNew(fixtureJson('tashma-new.json'))[0];
  const spec = usableSpec(tashma.urlSpec, [{ url: t.url, page: t.page, thumb: t.thumb }]);
  const wire = compressAssetUrls({ src: 'tashma', ext: t.ext, url: t.url, page: t.page, thumb: t.thumb }, spec);
  assert.deepEqual(Object.keys(wire).sort(), ['ext', 'src']);
  assert.ok(fixture('url-vectors.json').includes('גלריה'), 'vectors keep Hebrew decoded');
});
