// In-memory issue <-> on-disk ("wire") issue. The wire form is smaller and every
// omission is an inheritance rule that fromWire undoes exactly:
//   issue.lang       missing = the series' lang
//   issue.title      missing = the series' title
//   asset.rawTitle   missing = the issue's title (after the rule above)
//   asset url/page/thumb: compressed per source (lib/urls.mjs)
import { compressAssetUrls, resolveAssetUrls } from './urls.mjs';
import { prune, stableStringify } from './shards.mjs';

export function toWire(issue, series, sourceSpecs = {}) {
  const w = { ...issue };
  w.assets = issue.assets.map((a) => {
    const c = compressAssetUrls(a, sourceSpecs[a.src]);
    if (c.rawTitle !== undefined && c.rawTitle === issue.title) delete c.rawTitle;
    return c;
  });
  if (series) {
    if (w.lang === series.lang) delete w.lang;
    if (w.title === series.title) delete w.title;
  }
  return w;
}

export function fromWire(wire, series, sourceSpecs = {}) {
  const title = wire.title ?? series?.title;
  const i = { ...wire, title, lang: wire.lang ?? series?.lang };
  i.assets = wire.assets.map((a) => ({
    ...a,
    ...resolveAssetUrls(a, sourceSpecs[a.src]),
    rawTitle: a.rawTitle ?? title,
  }));
  return i;
}

/** Throws unless fromWire(toWire(x)) is x (compared as canonical JSON, empty fields ignored). */
export function assertRoundTrip(issue, wire, series, sourceSpecs) {
  const back = fromWire(wire, series, sourceSpecs);
  if (stableStringify(prune(back)) !== stableStringify(prune(issue))) {
    throw new Error(`wire round-trip failed for issue ${issue.id}:\n${stableStringify(prune(issue))}\n${stableStringify(prune(back))}`);
  }
}
