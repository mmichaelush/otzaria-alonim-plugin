// אורקל סינון: מסנן את הרשומות הגולמיות של הקטלוג בצורה נאיבית (לולאה אחת, בלי
// עמודות, בלי מטמונים), לפי הסמנטיקה שב-alonim-filters.js. מטרתו להשוות לאינדקס:
// אם שניהם מסכימים על כל שילוב אקראי של מסננים ושאילתות, האינדקס נכון.
'use strict';

const SOURCE_NAMES = { ladaat: 'לדעת', tashma: 'תשמע', gilyoines: 'גיליונס', alonolam: 'עלון עולם' };

/** רשומות עם השדות הנגזרים (ירושה מהסדרה), מהנתונים הגולמיים. */
function prepare(A, raw) {
  const { Core } = A;
  const { searchKey, normalizeKey } = A.Normalize;
  const seriesById = new Map(raw.series.map((s) => [s.id, s]));
  const records = [];
  for (const shard of raw.shards) {
    for (const it of shard.list) {
      const s = seriesById.get(it.series) || { id: it.series, title: '', circle: '', lang: 'he' };
      const assets = it.assets || [];
      const parasha = (Array.isArray(it.parasha) ? it.parasha : it.parasha ? [it.parasha] : []).slice(0, 2);
      const title = it.title && it.title !== s.title ? it.title : '';
      const lang = it.lang || s.lang || 'he';
      const hay =
        ' ' +
        [
          searchKey(s.title),
          searchKey(title),
          searchKey(s.circle || ''),
          it.no ? String(it.no) : '',
          searchKey(parasha.map((p) => (Core.PARASHOT[p] || '') + ' ' + p).join(' ') + ' ' + (it.event ? (Core.EVENTS[it.event] || '') + ' ' + it.event : '')),
          it.hy ? it.hy + ' ' + searchKey(Core.hyLetters(it.hy)) + ' ' + (it.hy % 1000) : '',
          lang + ' ' + searchKey(Core.LANG_NAMES[lang] || ''),
          [...new Set(assets.map((a) => a.src))].map((src) => src + ' ' + searchKey(SOURCE_NAMES[src] || '')).join(' '),
        ]
          .map((x) => x.trim())
          .filter(Boolean)
          .join(' ') +
        ' ';
      let kb = 0;
      let pages = 0;
      for (const a of assets) {
        kb = Math.max(kb, a.bytes ? Math.round(a.bytes / 1024) : 0);
        pages = Math.max(pages, a.pages || 0);
      }
      records.push({
        id: it.id,
        raw: it,
        series: s,
        seriesKey: searchKey(s.title),
        circleKey: normalizeKey(s.circle || ''),
        hy: it.hy || 0,
        date: it.date || '',
        added: it.added ? Math.floor((Date.parse(it.added) || 0) / 1000) * 1000 : 0,
        parasha,
        event: it.event || '',
        lang,
        sources: [...new Set(assets.map((a) => a.src))],
        pages,
        kb,
        hay,
      });
    }
  }
  return { records, seriesById };
}

/** מזהי פרשה/אירוע שהטקסט מציין (שם מדויק קודם, אחרת תחילת מילה). */
const slugCache = new Map();
function namedSlugs(A, kind, norm) {
  const key = kind + '/' + norm;
  if (!slugCache.has(key)) slugCache.set(key, computeNamedSlugs(A, kind, norm));
  return slugCache.get(key);
}

function computeNamedSlugs(A, kind, norm) {
  const { Core } = A;
  const { searchKey } = A.Normalize;
  const names = kind === 'event' ? Core.EVENTS : Core.PARASHOT;
  const exact = [];
  const prefix = [];
  for (const slug of Object.keys(names)) {
    const forms = [searchKey(names[slug]), searchKey(slug)];
    if (forms.includes(norm)) exact.push(slug);
    else if (forms.some((f) => (' ' + f).includes(' ' + norm))) prefix.push(slug);
  }
  return new Set(exact.length ? exact : prefix);
}

/** האם הרשומה מתאימה לאיבר בשאילתה (term מ-`parseQuery`). */
function termMatches(A, rec, term) {
  const { searchKey } = A.Normalize;
  const { Core } = A;
  switch (term.field) {
    case 'year':
      return term.from ? rec.hy >= term.from && rec.hy <= term.to : String(rec.hy || '').startsWith(term.norm);
    case 'series':
      return (' ' + rec.seriesKey + ' ').includes(term.needle);
    case 'parasha': {
      const set = namedSlugs(A, 'parasha', term.norm);
      return rec.parasha.some((p) => set.has(p));
    }
    case 'event':
      return namedSlugs(A, 'event', term.norm).has(rec.event);
    case 'lang':
      return (' ' + rec.lang + ' ' + searchKey(Core.LANG_NAMES[rec.lang] || '') + ' ').includes(term.needle);
    case 'source':
      return (' ' + rec.sources.map((s) => s + ' ' + searchKey(SOURCE_NAMES[s] || '')).join(' ') + ' ').includes(term.needle);
    case 'circle':
      return rec.circleKey.includes(term.norm);
    default:
      return rec.hay.includes(term.needle);
  }
}

function textMatches(A, rec, query) {
  return query.clauses.every((clause) =>
    clause.alts.some((term) => {
      const hit = Boolean(termMatches(A, rec, term));
      return term.neg ? !hit : hit;
    }),
  );
}

/**
 * ‏[state]: `{ favorite:Set, followed:Set(seriesId), downloaded:Set, inList:Set,
 * read:Set, newSet:Set, lastVisit:number }` (מזהי גיליונות). ‏[hiddenIds]: Set.
 * מחזיר את הקבוצות כ-`{ key, facet, test(rec) }` לפי הסמנטיקה.
 */
function groups(A, query, f, state, hiddenIds) {
  const out = [];
  const add = (key, test, facet) => out.push({ key, facet: Boolean(facet), test });
  const range = (v, lo, hi) => v > 0 && (!lo || v >= lo) && (!hi || v <= hi);
  const has = (list, v) => Boolean(list) && list.includes(v);
  if (f.hy) add('hy', (r) => has(f.hy, r.hy), true);
  if (f.lang) add('lang', (r) => has(f.lang, r.lang), true);
  if (f.source) add('source', (r) => r.sources.some((s) => has(f.source, s)), true);
  if (f.parasha) add('parasha', (r) => r.parasha.some((p) => has(f.parasha, p)), true);
  if (f.event) add('event', (r) => Boolean(r.event) && has(f.event, r.event), true);
  if (f.circle) add('circle', (r) => has(f.circle, r.series.circle || ''), true);
  if (f.series) add('series', (r) => has(f.series, r.series.id));
  if (f.dateFrom || f.dateTo) add('date', (r) => Boolean(r.date) && (!f.dateFrom || r.date >= f.dateFrom) && (!f.dateTo || r.date <= f.dateTo));
  if (f.hyFrom || f.hyTo) add('years', (r) => range(r.hy, f.hyFrom, f.hyTo));
  if (f.pagesMin || f.pagesMax) add('pages', (r) => range(r.pages, f.pagesMin, f.pagesMax));
  if (f.sizeMin || f.sizeMax) add('size', (r) => range(r.kb, f.sizeMin ? f.sizeMin * 1024 : 0, f.sizeMax ? f.sizeMax * 1024 : 0));
  if (f.multi) add('multi', (r) => r.sources.length >= 2);
  if (query.clauses.length) add('text', (r) => textMatches(A, r, query));
  if (f.sinceVisit) add('sinceVisit', (r) => r.added > (state.lastVisit || 0));
  const flag = (name, test) => {
    if (f[name]) add('state:' + name, test);
  };
  flag('favorite', (r) => state.favorite.has(r.id));
  flag('followed', (r) => state.followed.has(r.series.id));
  flag('downloaded', (r) => state.downloaded.has(r.id));
  flag('inList', (r) => state.inList.has(r.id));
  flag('unread', (r) => !state.read.has(r.id));
  flag('isNew', (r) => state.newSet.has(r.id));
  return out;
}

/** מזהי הגיליונות התואמים (לפי סדר הקלט), ומספר המוסתרים שהיו מתאימים. */
function filter(A, data, query, f, state, hiddenIds, options) {
  const o = options || {};
  const gs = groups(A, query, f, state, hiddenIds);
  const plain = gs.filter((g) => !g.key.startsWith('state:'));
  const stateGs = gs.filter((g) => g.key.startsWith('state:'));
  const ids = [];
  let hidden = 0;
  for (const rec of data.records) {
    if (!plain.every((g) => g.test(rec))) continue;
    const isHidden = hiddenIds.has(rec.id);
    if (f.hiddenOnly ? !isHidden : isHidden && !o.includeHidden) {
      if (isHidden && !f.hiddenOnly) hidden++;
      continue;
    }
    if (!stateGs.every((g) => g.test(rec))) continue;
    ids.push(rec.id);
  }
  return { ids, hidden };
}

/** ספירות לכל מסנן לפי כל השאר, באותה הגדרה כמו `facetCounts`. */
function facets(A, data, query, f, state, hiddenIds, options) {
  const o = options || {};
  const gs = groups(A, query, f, state, hiddenIds);
  const out = { total: 0, parasha: new Map(), event: new Map(), hy: new Map(), lang: new Map(), source: new Map(), circle: new Map() };
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const facetKeys = new Set(gs.filter((g) => g.facet).map((g) => g.key));
  for (const rec of data.records) {
    const isHidden = hiddenIds.has(rec.id);
    if (f.hiddenOnly ? !isHidden : isHidden && !o.includeHidden) continue;
    const failed = [];
    for (const g of gs) if (!g.test(rec) && failed.push(g.key) > 1) break;
    if (failed.length > 1) continue;
    if (failed.length === 1 && !facetKeys.has(failed[0])) continue;
    const only = failed[0] || '';
    const count = (k) => !only || only === k;
    if (!only) out.total++;
    if (count('hy') && rec.hy) bump(out.hy, rec.hy);
    if (count('parasha')) for (const p of rec.parasha) bump(out.parasha, p);
    if (count('event') && rec.event) bump(out.event, rec.event);
    if (count('lang')) bump(out.lang, rec.lang);
    if (count('source')) for (const s of rec.sources) bump(out.source, s);
    if (count('circle') && rec.series.circle) bump(out.circle, rec.series.circle);
  }
  return out;
}

module.exports = { prepare, filter, facets, SOURCE_NAMES };
