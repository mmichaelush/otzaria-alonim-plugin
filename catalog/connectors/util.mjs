// Small helpers shared by the connectors.

/** Percent-encodes each path segment (keeps "/"), so Hebrew and "[37]" are valid in a URL. */
export const encodePath = (p) => p.split('/').map((s) => encodeURIComponent(s)).join('/');

/** ISO timestamp without milliseconds: "2026-10-14T20:03:05Z". */
export function isoSeconds(v) {
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Zero-width/bidi marks and runs of whitespace (tashma names carry U+200F).
const INVISIBLE = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]', 'g');
export const collapse = (s) => String(s ?? '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

/** Median of ISO timestamps (middle element of the sorted list). */
export function medianIso(list) {
  const xs = list.filter(Boolean).sort();
  return xs.length ? xs[Math.floor(xs.length / 2)] : null;
}

/** Percent-encodes characters that are not valid in a URL (non-ASCII, space, quotes, brackets of HTML ...) and leaves existing escapes alone. */
export function safeUrl(u) {
  let out = '';
  for (const ch of String(u)) {
    const c = ch.codePointAt(0);
    out += c > 126 || c < 33 || '"<>`{}|^'.includes(ch) || ch === String.fromCharCode(92) ? encodeURIComponent(ch) : ch;
  }
  return out;
}

/**
 * A failure of one unit of work (one date, one series page, one week) must not end the
 * crawl: it is recorded (the source becomes "degraded") and the crawl goes on. A host that
 * blocks us is the exception: that always stops the source.
 * @param {{soft?: (unit: string, err: Error) => void}} ctx
 */
export function softFail(ctx, unit, err) {
  if (err?.name === 'HostBlockedError' || typeof ctx?.soft !== 'function') throw err;
  ctx.soft(unit, err);
}

/** Throws a descriptive error when a response does not have the shape the parser relies on. */
export function expectShape(ok, what) {
  if (!ok) throw new Error(`unexpected response shape: ${what}`);
}
