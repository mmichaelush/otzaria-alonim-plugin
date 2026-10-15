import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttp, parseRobots, robotsAllows, USER_AGENT, HostBlockedError, HttpError } from '../lib/http.mjs';

const res = (status, body = '', headers = {}) => new Response(body, { status, headers });

/** fetch stand-in: responder(url, init, n) -> Response; records every call. */
function fetcher(responder) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init, at: Date.now() }); return responder(String(url), init, calls.length); };
  fn.calls = calls;
  return fn;
}
const noSleep = async () => {};

test('identifies itself and respects robots.txt (Disallow, Allow, wildcard, $)', async () => {
  const f = fetcher((u) => (u.endsWith('/robots.txt')
    ? res(200, 'User-agent: *\nDisallow: /private/\nAllow: /private/ok\nDisallow: /*.json$\n')
    : res(200, 'hello')));
  const http = createHttp({ fetchImpl: f, sleep: noSleep, minIntervalMs: 0 });
  assert.equal(await http.getText('https://a.test/page'), 'hello');
  assert.equal(f.calls[0].url, 'https://a.test/robots.txt');
  for (const c of f.calls) assert.equal(c.init.headers['User-Agent'], USER_AGENT);
  assert.match(USER_AGENT, /^OtzariaAlonimCatalog\/1 \(\+https:\/\/github\.com\/mmichaelush\/otzaria-alonim-plugin\)$/);
  await assert.rejects(http.getText('https://a.test/private/x'), /robots/);
  assert.equal(await http.getText('https://a.test/private/ok'), 'hello');
  await assert.rejects(http.getJson('https://a.test/data.json'), /robots/);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/robots.txt')).length, 1, 'robots.txt is fetched once per host');
});

test('robots parsing: group selection, empty Disallow allows all, our own group beats *', () => {
  const g = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: OtzariaAlonimCatalog\nDisallow: /x\n');
  assert.equal(robotsAllows(g, '/x/y'), false);
  assert.equal(robotsAllows(g, '/other'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow:\n'), '/anything'), true);
  assert.equal(robotsAllows(parseRobots(''), '/anything'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: bot\nDisallow: /\n'), '/anything'), true);
});

test('robots.txt 404 means allowed; unreachable robots.txt (5xx) means disallowed', async () => {
  const ok = createHttp({ fetchImpl: fetcher((u) => (u.endsWith('/robots.txt') ? res(404) : res(200, 'x'))), sleep: noSleep, minIntervalMs: 0 });
  assert.equal(await ok.getText('https://b.test/p'), 'x');
  const down = createHttp({ fetchImpl: fetcher((u) => (u.endsWith('/robots.txt') ? res(503) : res(200, 'x'))), sleep: noSleep, minIntervalMs: 0, retries: 1 });
  await assert.rejects(down.getText('https://c.test/p'), /robots/);
});

test('403 cools the whole host down at once: no retry, no further requests', async () => {
  const f = fetcher((u) => (u.endsWith('/robots.txt') ? res(404) : res(403, 'Cloudflare')));
  const http = createHttp({ fetchImpl: f, sleep: noSleep, minIntervalMs: 0 });
  await assert.rejects(http.getText('https://d.test/a'), HostBlockedError);
  const before = f.calls.length;
  await assert.rejects(http.getText('https://d.test/b'), HostBlockedError);
  await assert.rejects(http.getJson('https://d.test/c'), HostBlockedError);
  assert.equal(f.calls.length, before, 'no request after the 403');
  assert.equal(http.isCooled('d.test'), 'HTTP 403');
  // another host is unaffected
  const f2 = fetcher((u) => (u.endsWith('/robots.txt') ? res(404) : res(200, 'fine')));
  const http2 = createHttp({ fetchImpl: f2, sleep: noSleep, minIntervalMs: 0 });
  assert.equal(await http2.getText('https://e.test/a'), 'fine');
});

test('429 honours Retry-After, retries, and cools the host down when it persists', async () => {
  const sleeps = [];
  let n = 0;
  const f = fetcher((u) => {
    if (u.endsWith('/robots.txt')) return res(404);
    n++;
    return n === 1 ? res(429, '', { 'retry-after': '3' }) : res(200, 'ok');
  });
  const http = createHttp({ fetchImpl: f, sleep: async (ms) => { sleeps.push(ms); }, minIntervalMs: 0 });
  assert.equal(await http.getText('https://f.test/a'), 'ok');
  assert.ok(sleeps.includes(3000), `slept for Retry-After: ${sleeps}`);

  const always = createHttp({ fetchImpl: fetcher((u) => (u.endsWith('/robots.txt') ? res(404) : res(429))), sleep: noSleep, minIntervalMs: 0, retries: 2 });
  await assert.rejects(always.getText('https://g.test/a'), HostBlockedError);
  assert.equal(always.isCooled('g.test'), 'HTTP 429');

  // A Retry-After beyond what we are willing to wait is also a cool-down.
  const long = createHttp({ fetchImpl: fetcher((u) => (u.endsWith('/robots.txt') ? res(404) : res(429, '', { 'retry-after': '99999' }))), sleep: noSleep, minIntervalMs: 0 });
  await assert.rejects(long.getText('https://h.test/a'), HostBlockedError);
});

test('5xx and network errors retry with backoff and then succeed or fail with the status', async () => {
  const sleeps = [];
  let n = 0;
  const f = fetcher((u) => {
    if (u.endsWith('/robots.txt')) return res(404);
    n++;
    if (n === 1) throw new Error('ECONNRESET');
    if (n === 2) return res(502);
    return res(200, '{"a":1}');
  });
  const http = createHttp({ fetchImpl: f, sleep: async (ms) => { sleeps.push(ms); }, minIntervalMs: 0, random: () => 0.5 });
  assert.deepEqual(await http.getJson('https://i.test/a'), { a: 1 });
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] > sleeps[0], 'exponential backoff');
  const bad = createHttp({ fetchImpl: fetcher((u) => (u.endsWith('/robots.txt') ? res(404) : res(500))), sleep: noSleep, minIntervalMs: 0, retries: 1 });
  await assert.rejects(bad.getText('https://j.test/a'), (e) => e instanceof HttpError && e.status === 500);
});

test('404 is an error unless allowed; invalid JSON is reported', async () => {
  const http = createHttp({ fetchImpl: fetcher((u) => (u.endsWith('/robots.txt') ? res(404) : u.endsWith('/nope') ? res(404) : res(200, '<html>'))), sleep: noSleep, minIntervalMs: 0 });
  await assert.rejects(http.getJson('https://k.test/nope'), (e) => e.status === 404);
  assert.equal(await http.getJson('https://k.test/nope', { allow404: true }), null);
  await assert.rejects(http.getJson('https://k.test/html'), /invalid JSON/);
});

test('at most 2 requests in flight per host, and a gap between request starts', async () => {
  let inflight = 0, peak = 0;
  const f = fetcher(async (u) => {
    if (u.endsWith('/robots.txt')) return res(404);
    inflight++; peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 25));
    inflight--;
    return res(200, 'x');
  });
  // The gap is verified through the requested waits, not wall-clock timestamps (timer jitter under load).
  const waits = [];
  const http = createHttp({ fetchImpl: f, minIntervalMs: 200, sleep: async (ms) => { waits.push(ms); } });
  await Promise.all(Array.from({ length: 8 }, (_, i) => http.getText(`https://l.test/${i}`)));
  assert.ok(peak <= 2, `peak in flight ${peak}`);
  const sorted = waits.filter((w) => w > 0).sort((a, b) => a - b);
  assert.ok(sorted.length >= 6, `starts are spaced: ${sorted}`);
  for (let k = 1; k < sorted.length; k++) assert.ok(sorted[k] - sorted[k - 1] >= 150, `gap ${sorted[k] - sorted[k - 1]}ms`);
});

test('disk cache: second run is served from disk (development aid)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alonim-cache-'));
  try {
    const f = fetcher((u) => (u.endsWith('/robots.txt') ? res(404) : res(200, '{"v":1}')));
    const a = createHttp({ fetchImpl: f, sleep: noSleep, minIntervalMs: 0, cacheDir: dir, useCache: true });
    assert.deepEqual(await a.getJson('https://m.test/x'), { v: 1 });
    const n = f.calls.length;
    const b = createHttp({ fetchImpl: f, sleep: noSleep, minIntervalMs: 0, cacheDir: dir, useCache: true });
    assert.deepEqual(await b.getJson('https://m.test/x'), { v: 1 });
    assert.equal(f.calls.length, n, 'no network on the cached request');
    assert.equal(b.stats.cached, 2); // robots.txt and the page
    // without useCache the cache is neither read nor written
    const c = createHttp({ fetchImpl: f, sleep: noSleep, minIntervalMs: 0, cacheDir: dir, useCache: false });
    await c.getJson('https://m.test/x');
    assert.ok(f.calls.length > n);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
