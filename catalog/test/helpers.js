// Shared test helpers (no tests here). Loaded by other test files only.
import { readFileSync } from 'node:fs';
import { HttpError, HostBlockedError } from '../lib/http.mjs';

export const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
export const fixtureJson = (name) => JSON.parse(fixture(name));

/**
 * A stand-in for lib/http.mjs's client. `routes` maps a URL prefix to a
 * string/object/Error (or a function of the full url). The longest prefix wins.
 */
export function fakeHttp(routes) {
  const calls = [];
  const find = (url) => {
    const keys = Object.keys(routes).filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length);
    if (!keys.length) throw new HttpError(404, url);
    const v = routes[keys[0]];
    const r = typeof v === 'function' ? v(url) : v;
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    calls,
    stats: { requests: 0, cached: 0, retries: 0, bytes: 0 },
    async getJson(url, opts) {
      calls.push({ url, opts });
      let r;
      try { r = find(url); } catch (e) { if (opts?.allow404 && e instanceof HttpError && e.status === 404) return null; throw e; }
      return typeof r === 'string' ? JSON.parse(r) : r;
    },
    async getText(url, opts) { calls.push({ url, opts }); const r = find(url); return typeof r === 'string' ? r : JSON.stringify(r); },
    isCooled: () => null,
  };
}

export { HttpError, HostBlockedError };
