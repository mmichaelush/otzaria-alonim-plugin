// The only network code in the project. Every source is a third party, so this
// layer is deliberately polite: identifies itself, honours robots.txt, keeps at
// most 2 requests in flight per host with a minimum gap between starts,
// respects Retry-After, backs off with jitter, and backs OFF COMPLETELY on
// 403/429 (that host is cooled down until the next run). It never tries to get
// around blocks, challenges or rate limits.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const USER_AGENT = 'OtzariaAlonimCatalog/1 (+https://github.com/mmichaelush/otzaria-alonim-plugin)';
const UA_TOKEN = 'otzariaalonimcatalog';

export class HttpError extends Error {
  constructor(status, url, message) {
    super(message || `HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}
/** The host asked us to stop (403/429, robots, repeated failures); no more requests this run. */
export class HostBlockedError extends Error {
  constructor(host, reason) {
    super(`host ${host} is cooled down: ${reason}`);
    this.name = 'HostBlockedError';
    this.host = host;
    this.reason = reason;
  }
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- robots.txt (RFC 9309 subset: groups, Allow/Disallow, * and $) ---------

export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (cur) cur.rules.push({ allow: key === 'allow', path: value });
    } else lastWasAgent = false;
  }
  return groups;
}

function ruleRegex(path) {
  const esc = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc.replace(/\\\$$/, '$'));
}

/** True when `path` (with query) may be fetched under the given robots groups. */
export function robotsAllows(groups, path) {
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && UA_TOKEN.includes(a)));
  const star = groups.filter((g) => g.agents.includes('*'));
  const rules = (specific.length ? specific : star).flatMap((g) => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue; // "Disallow:" with an empty value allows everything
    if (!ruleRegex(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

// ---- the client ---------------------------------------------------------------

/**
 * @param {object} o
 * @param {string|null} o.cacheDir   response cache directory (development only)
 * @param {boolean} o.useCache       serve from cache when present, and store responses
 * @param {number} o.minIntervalMs   minimum gap between request starts per host
 * @param {Record<string,number>} o.hostIntervalMs  per-host overrides
 */
export function createHttp({
  fetchImpl = globalThis.fetch,
  sleep = realSleep,
  cacheDir = null,
  useCache = false,
  minIntervalMs = 700,
  hostIntervalMs = {},
  concurrency = 2,
  timeoutMs = 45000,
  retries = 3,
  maxRetryAfterMs = 120000,
  log = () => {},
  random = Math.random,
} = {}) {
  const hosts = new Map();
  const stats = { requests: 0, cached: 0, retries: 0, bytes: 0 };

  const hostState = (host) => {
    let h = hosts.get(host);
    if (!h) { h = { nextStart: 0, inflight: 0, waiters: [], cooled: null, robots: null }; hosts.set(host, h); }
    return h;
  };

  async function acquire(host) {
    const h = hostState(host);
    while (h.inflight >= concurrency) await new Promise((r) => h.waiters.push(r));
    h.inflight++;
    const gap = hostIntervalMs[host] ?? minIntervalMs;
    const wait = Math.max(0, h.nextStart - Date.now());
    h.nextStart = Math.max(Date.now(), h.nextStart) + gap;
    if (wait) await sleep(wait);
  }
  function release(host) {
    const h = hostState(host);
    h.inflight--;
    h.waiters.shift()?.();
  }

  const cacheFile = (url, accept) => join(cacheDir, createHash('sha1').update(`GET ${url}\n${accept}`).digest('hex') + '.json');
  async function cacheGet(url, accept) {
    if (!useCache || !cacheDir) return null;
    try { return JSON.parse(await readFile(cacheFile(url, accept), 'utf8')); } catch { return null; }
  }
  async function cachePut(url, accept, entry) {
    if (!useCache || !cacheDir) return;
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile(url, accept), JSON.stringify(entry));
  }

  function retryAfterMs(res) {
    const v = res.headers.get('retry-after');
    if (!v) return null;
    if (/^\d+$/.test(v)) return Number(v) * 1000;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : Math.max(0, t - Date.now());
  }

  async function rawFetch(url, { accept, headers = {} }) {
    const u = new URL(url);
    const h = hostState(u.host);
    if (h.cooled) throw new HostBlockedError(u.host, h.cooled);
    let attempt = 0;
    for (;;) {
      await acquire(u.host);
      let res, err;
      try {
        res = await fetchImpl(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: accept, ...headers },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'follow',
        });
        stats.requests++;
        if (res.ok || res.status === 404 || res.status === 410) {
          const body = await res.text();
          stats.bytes += body.length;
          return { status: res.status, contentType: res.headers.get('content-type') || '', body };
        }
        await res.arrayBuffer().catch(() => {});
      } catch (e) {
        err = e;
      } finally {
        release(u.host);
      }
      if (res && res.status === 403) {
        h.cooled = 'HTTP 403';
        throw new HostBlockedError(u.host, 'HTTP 403');
      }
      if (res && res.status === 429) {
        const ra = retryAfterMs(res);
        if (attempt >= retries || (ra != null && ra > maxRetryAfterMs)) {
          h.cooled = 'HTTP 429';
          throw new HostBlockedError(u.host, 'HTTP 429');
        }
        stats.retries++;
        await sleep(ra ?? 2000 * 2 ** attempt);
        attempt++;
        continue;
      }
      const retryable = err || (res && res.status >= 500);
      if (!retryable || attempt >= retries) {
        if (res) throw new HttpError(res.status, url);
        throw new Error(`network error for ${url}: ${err?.message || err}`, { cause: err });
      }
      const ra = res ? retryAfterMs(res) : null;
      const backoff = Math.min(30000, 1000 * 2 ** attempt) * (0.5 + random());
      stats.retries++;
      log(`retry ${attempt + 1} for ${url}: ${res ? res.status : err.message}`);
      await sleep(ra != null ? Math.min(ra, maxRetryAfterMs) : backoff);
      attempt++;
    }
  }

  async function loadRobots(origin) {
    const host = new URL(origin).host;
    const h = hostState(host);
    if (!h.robots) {
      h.robots = (async () => {
        try {
          const r = await getRaw(`${origin}/robots.txt`, { accept: 'text/plain', skipRobots: true });
          if (r.status === 404 || r.status === 410) return [];
          return parseRobots(r.body);
        } catch (e) {
          if (e instanceof HostBlockedError) throw e;
          // RFC 9309: robots.txt unreachable (5xx) means treat the site as disallowed.
          return [{ agents: ['*'], rules: [{ allow: false, path: '/' }] }];
        }
      })();
    }
    return h.robots;
  }

  /** Whether robots.txt permits fetching this URL (loads robots.txt once per host). */
  async function allowed(url) {
    const u = new URL(url);
    const groups = await loadRobots(u.origin);
    return robotsAllows(groups, u.pathname + u.search);
  }

  async function getRaw(url, { accept = '*/*', headers, skipRobots = false } = {}) {
    if (!skipRobots && !(await allowed(url))) throw new HttpError(0, url, `blocked by robots.txt: ${url}`);
    const hit = await cacheGet(url, accept);
    if (hit) { stats.cached++; return hit; }
    const r = await rawFetch(url, { accept, headers });
    if (r.status === 200) await cachePut(url, accept, r);
    return r;
  }

  async function getText(url, opts = {}) {
    const r = await getRaw(url, { accept: opts.accept || 'text/html,*/*;q=0.5', headers: opts.headers });
    if (r.status !== 200 && !opts.allow404) throw new HttpError(r.status, url);
    return r.status === 200 ? r.body : null;
  }

  async function getJson(url, opts = {}) {
    const r = await getRaw(url, { accept: 'application/json', headers: opts.headers });
    if (r.status !== 200) {
      if (opts.allow404) return null;
      throw new HttpError(r.status, url);
    }
    try { return JSON.parse(r.body); } catch (e) { throw new Error(`invalid JSON from ${url}: ${e.message}`, { cause: e }); }
  }

  return { getText, getJson, allowed, stats, hostState, isCooled: (host) => hostState(host).cooled };
}
