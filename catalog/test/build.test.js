import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, fixtureJson, fakeHttp, HostBlockedError, HttpError } from './helpers.js';
import { runBuild } from '../build.mjs';
import { sha256, stableStringify, splitIssues, writeCatalog, SHARD_MAX_BYTES, prune } from '../lib/shards.mjs';
import { PARASHA_SLUGS } from '../lib/calendar.mjs';

const NOW = '2026-10-15T08:00:00Z';
const SILENT = () => {};

function routes(over = {}) {
  const gil = fixtureJson('gilyoines-home.json');
  return {
    'https://ladaat.co/gilyonot/api/files': { ...fixtureJson('ladaat-files.json'), hasMore: false },
    'https://ladaat.co/gilyonot/': fixture('ladaat-home.html'),
    'https://tashma.co.il/gilyonot/new': fixtureJson('tashma-new.json'),
    'https://gilyoines.com/api/home/getGilyoines/': gil,
    'https://gilyoines.com/api/home': gil,
    'https://alonolam.com/wp-json/gallery/v1/list': fixtureJson('alonolam-list.json'),
    'https://beinenu.com/': new HostBlockedError('beinenu.com', 'HTTP 403'),
    ...over,
  };
}

async function withTmp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'alonim-build-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const readJson = async (dir, rel) => JSON.parse(await readFile(join(dir, rel), 'utf8'));
async function snapshot(dir) {
  const out = {};
  for (const f of ['manifest.json', 'series.json', 'weeks.json', 'recent.json']) out[f] = await readFile(join(dir, f));
  for (const f of await readdir(join(dir, 'issues'))) out[`issues/${f}`] = await readFile(join(dir, 'issues', f));
  return out;
}

test('a build writes a contract-shaped catalog: manifest, series, weeks, recent, shards with matching hashes', async () => {
  await withTmp(async (dir) => {
    const { manifest } = await runBuild({ out: dir, now: NOW, http: fakeHttp(routes()), log: SILENT });
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.generatedAt, NOW);
    assert.equal(manifest.catalogVersion, Math.floor(Date.parse(NOW) / 1000));
    assert.deepEqual(manifest.sources.map((s) => s.id), ['ladaat', 'tashma', 'gilyoines', 'alonolam', 'beinenu']);
    assert.equal(manifest.sources.find((s) => s.id === 'beinenu').mode, 'link');
    assert.equal(manifest.sources.find((s) => s.id === 'beinenu').status, 'blocked');
    assert.equal(manifest.sources.find((s) => s.id === 'beinenu').issueCount, 0);
    assert.equal(manifest.sources.find((s) => s.id === 'ladaat').mode, 'catalog');

    for (const key of ['series', 'weeks', 'recent']) {
      const f = manifest.files[key];
      const buf = await readFile(join(dir, f.path));
      assert.equal(f.sha256, sha256(buf), key);
      assert.equal(f.bytes, buf.length, key);
    }
    for (const s of manifest.shards) {
      const buf = await readFile(join(dir, s.path));
      assert.equal(s.sha256, sha256(buf));
      assert.equal(s.bytes, buf.length);
      assert.equal(s.count, JSON.parse(buf).length);
      assert.ok(s.bytes < SHARD_MAX_BYTES);
    }
    const series = await readJson(dir, 'series.json');
    assert.equal(manifest.files.series.count, series.length);
    const seriesIds = new Set(series.map((s) => s.id));
    const all = [];
    for (const s of manifest.shards) all.push(...(await readJson(dir, s.path)));
    assert.ok(all.length > 20);
    assert.equal(new Set(all.map((i) => i.id)).size, all.length, 'issue ids are unique');
    const valid = new Set(PARASHA_SLUGS);
    for (const i of all) {
      assert.match(i.id, /^i_[0-9a-f]{12}$/);
      assert.ok(seriesIds.has(i.series));
      assert.ok(i.assets.length >= 1);
      for (const a of i.assets) {
        assert.ok(a.src && a.ext);
        assert.ok(a.url && a.page, 'every copy has both a direct pdf url and the site page');
        if (a.url) assert.equal(new URL(a.url).protocol, 'https:');
      }
      for (const p of i.parasha || []) assert.ok(valid.has(p), p);
      if (!i.hy) assert.equal(i.date, undefined);
    }
    // shard file name matches the Hebrew year of its issues
    for (const s of manifest.shards) if (/^\d{4}$/.test(s.id)) for (const i of await readJson(dir, s.path)) assert.equal(String(i.hy), s.id);
    // every shard issue and recent issue is also pruned: no nulls, no empty strings or arrays
    const text = await readFile(join(dir, manifest.shards[0].path), 'utf8');
    assert.ok(!/null|""|\[\]/.test(text), 'empty fields are omitted');
    assert.ok(!text.startsWith('﻿'));
    // series.json: ids, languages
    for (const s of series) { assert.match(s.id, /^s_[0-9a-f]{10}$/); assert.ok(['he', 'yi', 'en', 'de', 'fr', 'es', 'ru', 'nl', 'it', 'pt', 'fa', 'ar', 'other'].includes(s.lang)); assert.ok(['weekly', 'timeless'].includes(s.kind)); }
    // weeks.json: sorted ascending Shabbat rows with parasha and parashaIL
    const weeks = await readJson(dir, 'weeks.json');
    assert.ok(weeks.length > 100);
    for (let k = 1; k < weeks.length; k++) assert.ok(weeks[k - 1].date < weeks[k].date);
    const noach = weeks.find((w) => w.date === '2026-10-17');
    assert.deepEqual(noach, { date: '2026-10-17', event: null, hy: 5787, label: 'נח', parasha: ['noach'], parashaIL: ['noach'] });
    // recent: dated issues around now only
    const recent = await readJson(dir, 'recent.json');
    assert.ok(recent.length > 0 && recent.every((i) => !i.date || (i.date >= '2026-09-01' && i.date <= '2026-11-30')));
  });
});

test('JSON files are canonical: sorted keys at every depth, trailing newline, minified shards', async () => {
  await withTmp(async (dir) => {
    await runBuild({ out: dir, now: NOW, http: fakeHttp(routes()), log: SILENT });
    for (const f of ['series.json', 'recent.json', 'weeks.json', 'manifest.json']) {
      const text = await readFile(join(dir, f), 'utf8');
      const parsed = JSON.parse(text);
      assert.equal(text, stableStringify(parsed, f === 'manifest.json' ? 2 : undefined), f);
    }
  });
});

test('determinism: two runs on the same input produce byte-identical files', async () => {
  await withTmp(async (dir) => {
    await runBuild({ out: join(dir, 'a'), now: NOW, http: fakeHttp(routes()), log: SILENT });
    await runBuild({ out: join(dir, 'b'), now: NOW, http: fakeHttp(routes()), log: SILENT });
    const a = await snapshot(join(dir, 'a')), b = await snapshot(join(dir, 'b'));
    assert.deepEqual(Object.keys(a), Object.keys(b));
    for (const k of Object.keys(a)) assert.ok(a[k].equals(b[k]), k);
  });
});

test('unchanged content keeps the previous manifest byte for byte (so the data branch commit is empty); a heartbeat refreshes it daily', async () => {
  await withTmp(async (dir) => {
    const r1 = await runBuild({ out: join(dir, 'a'), now: NOW, http: fakeHttp(routes()), log: SILENT });
    const r2 = await runBuild({ out: join(dir, 'b'), now: '2026-10-15T11:00:00Z', prev: join(dir, 'a'), http: fakeHttp(routes()), log: SILENT });
    const a = await snapshot(join(dir, 'a')), b = await snapshot(join(dir, 'b'));
    for (const k of Object.keys(a)) assert.ok(a[k].equals(b[k]), `${k} identical 3 hours later`);
    assert.equal(r2.manifest.catalogVersion, r1.manifest.catalogVersion);
    // a day later: only the manifest timestamps move, and catalogVersion increases
    const r3 = await runBuild({ out: join(dir, 'c'), now: '2026-10-16T09:00:00Z', prev: join(dir, 'a'), http: fakeHttp(routes()), log: SILENT });
    assert.ok(r3.manifest.catalogVersion > r1.manifest.catalogVersion);
    assert.equal(r3.manifest.generatedAt, '2026-10-16T09:00:00Z');
  });
});

test('a source that fails keeps its previous data and is marked down; other sources still update', async () => {
  await withTmp(async (dir) => {
    const r1 = await runBuild({ out: join(dir, 'a'), now: NOW, http: fakeHttp(routes()), log: SILENT });
    const before = r1.manifest.sources.find((s) => s.id === 'gilyoines');
    assert.equal(before.status, 'ok');
    const err = new HttpError(500, 'https://gilyoines.com/api/home');
    const failing = routes({ 'https://gilyoines.com/api/home': err, 'https://gilyoines.com/api/home/getGilyoines/': err });
    const r2 = await runBuild({ out: join(dir, 'b'), now: '2026-10-15T14:00:00Z', prev: join(dir, 'a'), http: fakeHttp(failing), log: SILENT });
    const after = r2.manifest.sources.find((s) => s.id === 'gilyoines');
    assert.equal(after.status, 'down');
    assert.match(after.note, /האתר אינו זמין/);
    assert.equal(after.lastOkAt, before.lastOkAt, 'lastOkAt is not advanced by a failure');
    assert.equal(after.issueCount, before.issueCount, 'its copies are still in the catalog');
    const countOf = async (dir2, src) => { let n = 0; for (const s of (await readJson(dir2, 'manifest.json')).shards) for (const i of await readJson(dir2, s.path)) n += i.assets.filter((a) => a.src === src).length; return n; };
    assert.equal(await countOf(join(dir, 'b'), 'gilyoines'), await countOf(join(dir, 'a'), 'gilyoines'));
    assert.ok((await countOf(join(dir, 'b'), 'ladaat')) > 0);
    // a blocked host is reported as blocked
    const blocked = routes({ 'https://alonolam.com/wp-json/gallery/v1/list': new HostBlockedError('alonolam.com', 'HTTP 429') });
    const r3 = await runBuild({ out: join(dir, 'c'), now: '2026-10-15T15:00:00Z', prev: join(dir, 'a'), http: fakeHttp(blocked), log: SILENT });
    assert.equal(r3.manifest.sources.find((s) => s.id === 'alonolam').status, 'blocked');
    assert.equal(r3.manifest.sources.find((s) => s.id === 'alonolam').issueCount, r1.manifest.sources.find((s) => s.id === 'alonolam').issueCount);
  });
});

test('incremental runs keep everything an earlier run found; --sources limits the crawl', async () => {
  await withTmp(async (dir) => {
    const r1 = await runBuild({ out: join(dir, 'a'), now: NOW, http: fakeHttp(routes()), log: SILENT });
    const http = fakeHttp(routes());
    const r2 = await runBuild({ out: join(dir, 'b'), now: '2026-10-15T14:00:00Z', prev: join(dir, 'a'), sources: ['ladaat'], http, log: SILENT });
    assert.ok(http.calls.every((c) => c.url.includes('ladaat.co')), 'only ladaat was requested');
    for (const id of ['tashma', 'gilyoines', 'alonolam']) {
      assert.equal(r2.manifest.sources.find((s) => s.id === id).issueCount, r1.manifest.sources.find((s) => s.id === id).issueCount, id);
      assert.equal(r2.manifest.sources.find((s) => s.id === id).status, 'ok');
    }
  });
});

test('a clean --full crawl replaces that source\'s previous copies (files removed at the source disappear)', async () => {
  await withTmp(async (dir) => {
    const files = fixtureJson('ladaat-files.json');
    const r1 = await runBuild({ out: join(dir, 'a'), now: NOW, http: fakeHttp(routes()), log: SILENT });
    const fewer = routes({ 'https://ladaat.co/gilyonot/api/files': { ...files, files: files.files.slice(0, 3), hasMore: false } });
    const incremental = await runBuild({ out: join(dir, 'b'), now: '2026-10-15T14:00:00Z', prev: join(dir, 'a'), sources: ['ladaat'], http: fakeHttp(fewer), log: SILENT });
    assert.equal(incremental.manifest.sources.find((s) => s.id === 'ladaat').issueCount, r1.manifest.sources.find((s) => s.id === 'ladaat').issueCount, 'incremental never deletes');
    const full = await runBuild({ out: join(dir, 'c'), now: '2026-10-15T14:00:00Z', prev: join(dir, 'a'), sources: ['ladaat'], full: true, http: fakeHttp(fewer), log: SILENT });
    assert.equal(full.manifest.sources.find((s) => s.id === 'ladaat').issueCount, 3);
  });
});

test('shards above 3MB are split into <year>-<k> files, each below the limit, in order, losing nothing', async () => {
  await withTmp(async (dir) => {
    const mk = (n) => ({
      id: `i_${String(n).padStart(12, '0')}`, series: 's_0000000001', title: 'כותרת ארוכה '.repeat(8) + n, hy: 5787,
      date: `2026-${String(10 + (n % 3)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`, lang: 'he', added: '2026-10-01T00:00:00Z',
      assets: [{ src: 'ladaat', ext: String(n), url: `https://ladaat.co/gilyonot/uploads/${'x'.repeat(400)}/${n}.pdf`, rawTitle: 'y'.repeat(200) }],
    });
    const issues = Array.from({ length: 9000 }, (_, n) => mk(n));
    const chunks = splitIssues(issues);
    assert.ok(chunks.length >= 2, `needs splitting (${chunks.length})`);
    assert.equal(chunks.flat().length, issues.length);
    for (const c of chunks) assert.ok(Buffer.byteLength(stableStringify(c.map(prune))) <= SHARD_MAX_BYTES);

    const { shards } = await writeCatalog(dir, { series: [], issues, today: '2026-10-15' });
    assert.deepEqual(shards.map((s) => s.id), chunks.map((_, k) => `5787-${k + 1}`));
    let total = 0;
    for (const s of shards) {
      const buf = await readFile(join(dir, s.path));
      assert.ok(buf.length <= SHARD_MAX_BYTES);
      assert.equal(s.sha256, sha256(buf));
      total += JSON.parse(buf).length;
    }
    assert.equal(total, issues.length);
    // small data is not split
    assert.equal(splitIssues(issues.slice(0, 10)).length, 1);
  });
});

test('publish guard: refuses an empty catalog and one that lost most of the previous data', async () => {
  const { spawnSync } = await import('node:child_process');
  const { writeFile, mkdir } = await import('node:fs/promises');
  const run = (out, prev) => spawnSync(process.execPath, [new URL('../tools/sanity.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--out', out, ...(prev ? ['--prev', prev] : [])], { encoding: 'utf8' });
  await withTmp(async (dir) => {
    await runBuild({ out: join(dir, 'good'), now: NOW, http: fakeHttp(routes()), log: SILENT });
    assert.equal(run(join(dir, 'good')).status, 0);
    assert.equal(run(join(dir, 'good'), join(dir, 'good')).status, 0);
    // a catalog with a tenth of the issues
    const small = routes({ 'https://ladaat.co/gilyonot/api/files': { success: true, files: [], hasMore: false }, 'https://alonolam.com/wp-json/gallery/v1/list': [], 'https://tashma.co.il/gilyonot/new': { items: [] }, 'https://gilyoines.com/api/home': { gilyoines: [] }, 'https://gilyoines.com/api/home/getGilyoines/': { gilyoines: [] } });
    await runBuild({ out: join(dir, 'empty'), now: NOW, http: fakeHttp(small), log: SILENT });
    assert.equal(run(join(dir, 'empty')).status, 1, 'empty');
    await mkdir(join(dir, 'x'), { recursive: true });
    const m = JSON.parse(await readFile(join(dir, 'good', 'manifest.json'), 'utf8'));
    m.shards = [{ ...m.shards[0], count: 1 }];
    await writeFile(join(dir, 'x', 'manifest.json'), JSON.stringify(m));
    assert.equal(run(join(dir, 'x'), join(dir, 'good')).status, 1, 'shrunk');
  });
});
