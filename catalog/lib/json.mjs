// Canonical JSON helpers shared by the writer and the wire format.

/** Drops null/undefined/""/[] recursively (CATALOG_FORMAT: empty fields are omitted). */
export function prune(v) {
  if (Array.isArray(v)) return v.map(prune);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      const x = prune(v[k]);
      if (x === null || x === undefined || x === '' || (Array.isArray(x) && x.length === 0)) continue;
      out[k] = x;
    }
    return out;
  }
  return v;
}

/** JSON with sorted object keys at every depth (arrays keep their order). */
export function stableStringify(v, indent) {
  const sort = (x) => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])]));
    return x;
  };
  return JSON.stringify(sort(v), null, indent) + '\n';
}
