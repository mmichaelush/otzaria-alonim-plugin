// URL compression for the catalog (CATALOG_FORMAT.md, "דחיסת URL").
//
// In memory every asset URL is absolute and fully percent-encoded. On disk:
//  * a value that starts with "https://" is absolute, anything else is relative to the
//    source's `urlBase`;
//  * a field equal to the expansion of the source's `urlTemplates[field]` ({ext} is replaced
//    by the asset's ext) is omitted;
//  * non-ASCII characters are stored decoded (Hebrew as UTF-8); ASCII escapes (%20, %5B ...)
//    stay as they are.
// The plugin keeps an identical copy of resolveAssetUrls; test/fixtures/url-vectors.json
// guards the two against drift.

const FIELDS = ['url', 'page', 'thumb'];

/** Decodes runs of percent-escaped non-ASCII bytes (%D7%A0 -> נ); ASCII escapes are left alone. */
export function decodeNonAscii(s) {
  return String(s).replace(/(?:%[89A-Fa-f][0-9A-Fa-f])+/g, (run) => {
    try { return decodeURIComponent(run); } catch { return run; }
  });
}

/** Percent-encodes only the non-ASCII characters (encodeURIComponent per character, UTF-8). */
export function encodeNonAscii(s) {
  let out = '';
  for (const ch of String(s)) out += ch.codePointAt(0) < 128 ? ch : encodeURIComponent(ch);
  return out;
}

const isAbsolute = (v) => v.startsWith('https://');

function resolveValue(v, source) {
  const full = isAbsolute(v) ? v : (source?.urlBase ?? '') + v;
  return encodeNonAscii(full);
}

/** Absolute, encoded url/page/thumb of an on-disk asset. Fields with neither a value nor a template are undefined. */
export function resolveAssetUrls(asset, source) {
  const out = {};
  for (const f of FIELDS) {
    let v = asset[f];
    if (v === undefined || v === null) {
      const t = source?.urlTemplates?.[f];
      if (t === undefined) continue;
      v = t.split('{ext}').join(asset.ext);
    }
    out[f] = resolveValue(v, source);
  }
  return out;
}

/**
 * Inverse of resolveAssetUrls for the writer: takes an asset with absolute encoded
 * urls and returns it with url/page/thumb compressed against `source`
 * ({urlBase, urlTemplates}). Always verified to round-trip; if a value would not,
 * it is kept absolute and encoded.
 */
export function compressAssetUrls(asset, source) {
  const out = { ...asset };
  const base = source?.urlBase ? encodeNonAscii(source.urlBase) : null;
  for (const f of FIELDS) {
    const v = asset[f];
    if (v === undefined || v === null) continue;
    const t = source?.urlTemplates?.[f];
    if (t !== undefined && resolveValue(t.split('{ext}').join(asset.ext), source) === v) { delete out[f]; continue; }
    let stored = v;
    if (base && v.startsWith(base) && v.length > base.length) stored = decodeNonAscii(v.slice(base.length));
    else stored = decodeNonAscii(v);
    // A relative value must not look absolute, and the whole thing must round-trip.
    if (resolveValue(stored, source) !== v) stored = v;
    out[f] = stored;
  }
  return out;
}

/**
 * Keeps a template only when every asset of the source carries that field
 * (an asset without e.g. a thumb must not get one invented by the template).
 */
export function usableSpec(spec, assets) {
  if (!spec) return null;
  const out = { urlBase: spec.urlBase };
  const templates = {};
  for (const f of FIELDS) {
    const t = spec.urlTemplates?.[f];
    if (t !== undefined && assets.length && assets.every((a) => a[f] !== undefined && a[f] !== null)) templates[f] = t;
  }
  if (Object.keys(templates).length) out.urlTemplates = templates;
  return out;
}
