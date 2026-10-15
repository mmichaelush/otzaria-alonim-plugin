// אינדקס בזיכרון על כל הגיליונות שנטענו: חיפוש, סינון, מיון, קיבוץ ושאילתות
// מתקדמות. טהור: בלי DOM ובלי SDK. היעד: חיפוש על 50,000 גיליונות בפחות מ-50ms,
// ולכן כל גיליון מקבל מחרוזת חיפוש מנורמלת אחת (`hay`), וההתאמה היא `includes`
// של ' ' + מילה: התחלת מילה, בלי לפרק לטוקנים בזמן החיפוש.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;
  const Rules = A.Rules;
  const { normalizeKey, searchKey, memoized } = A.Normalize;

  const norm = memoized(normalizeKey, 60000);
  const skey = memoized(searchKey, 60000);

  const FIELDS = ['series', 'year', 'parasha', 'lang', 'source', 'circle'];
  const SORTS = ['relevance', 'new', 'date', 'alpha', 'size'];

  // ---------------------------------------------------------- שאילתות

  /**
   * מפרק שאילתה: מילים, "ביטויים", `-שלילה`, `OR`, ו-`שדה:ערך`
   * (series year parasha lang source circle). מחזיר
   * `{ clauses: [{alts: [term]}], tokens, text }`; סעיפים הם AND, ובתוך סעיף
   * `OR`. `tokens` — המילים החיוביות להדגשה.
   */
  function parseQuery(text) {
    const source = String(text || '');
    const raw = [];
    const re = /(-?)(?:([a-z]+):)?(?:"([^"]*)"|“([^”]*)”|(\S+))/giu;
    let m;
    while ((m = re.exec(source))) {
      const field = m[2] ? m[2].toLowerCase() : '';
      const known = FIELDS.includes(field);
      const quoted = m[3] !== undefined ? m[3] : m[4];
      let body = quoted !== undefined ? quoted : m[5];
      let neg = m[1] === '-';
      let useField = known ? field : '';
      if (field && !known) body = (field + ':' + (body || '')).trim();
      if (!known && field && quoted === undefined) neg = m[1] === '-';
      if (quoted === undefined && !useField && /^(OR|\|)$/.test(body)) {
        raw.push({ or: true });
        continue;
      }
      raw.push({ field: useField, body, neg, phrase: quoted !== undefined && /\s/.test(quoted.trim()) });
    }
    const clauses = [];
    const tokens = [];
    let pendingOr = false;
    for (const part of raw) {
      if (part.or) {
        pendingOr = clauses.length > 0;
        continue;
      }
      const term = makeTerm(part);
      if (!term) continue;
      if (!term.neg && !term.field) for (const w of term.norm.split(' ')) if (w) tokens.push(w);
      if (!term.neg && term.field === 'series') for (const w of term.norm.split(' ')) if (w) tokens.push(w);
      if (pendingOr && clauses.length) clauses[clauses.length - 1].alts.push(term);
      else clauses.push({ alts: [term] });
      pendingOr = false;
    }
    return { clauses, tokens, text: source };
  }

  function makeTerm(part) {
    const body = String(part.body || '').trim();
    if (!body) return null;
    const term = { field: part.field, neg: part.neg, norm: skey(body), phrase: part.phrase, from: 0, to: 0 };
    if (part.field === 'year') {
      const range = /^(\d{3,4})\s*(?:-|\.\.|–)\s*(\d{3,4})$/.exec(body);
      const a = range ? Core.parseYear(range[1]) : Core.parseYear(body);
      const b = range ? Core.parseYear(range[2]) : a;
      if (a) {
        term.from = Math.min(a, b || a);
        term.to = Math.max(a, b || a);
      }
    }
    if (!term.norm && !term.from) return null;
    return term;
  }

  // ----------------------------------------------------------- אינדקס

  class CatalogIndex {
    /** [names]: `{ source(id) → שם }` לשמות מקורות בחיפוש. */
    constructor(names) {
      this.names = names || {};
      this.items = [];
      this.byId = new Map();
      this.seriesById = new Map();
      this.seriesAlias = new Map();
      this.weeks = [];
      this.sourceBits = new Map();
      this.bySeries = new Map();
      this.byDate = new Map();
      this.byYearParasha = new Map();
      this.hay = [];
      this.version = 0;
      this._orders = new Map();
      this._facets = null;
      this._compiled = Rules.compile(Rules.emptyRules(), null);
      this._rules = Rules.emptyRules();
      this.vis = [];
      this.nodl = [];
      this.pin = [];
      this.lastBuildMs = 0;
    }

    // ------------------------------------------------------- בנייה

    setSeries(list) {
      this.seriesById.clear();
      this.seriesAlias.clear();
      for (const s of Array.isArray(list) ? list : []) {
        if (!s || !s.id) continue;
        s._norm = skey([s.title].concat(s.aliases || []).join(' '));
        s._ntitle = norm(s.title);
        this.seriesById.set(s.id, s);
        for (const old of s.previousIds || []) this.seriesAlias.set(old, s.id);
      }
      // כותרות הסדרות נכנסות לחיפוש של גיליונות שכבר נטענו.
      for (let i = 0; i < this.items.length; i++) this._derive(this.items[i], i);
      this._invalidate();
    }

    setWeeks(list) {
      this.weeks = (Array.isArray(list) ? list : []).filter((w) => w && w.date).sort((a, b) => (a.date < b.date ? -1 : 1));
    }

    resolveSeriesId(id) {
      return this.seriesById.has(id) ? id : this.seriesAlias.get(id) || id;
    }

    _sourceBit(id) {
      let bit = this.sourceBits.get(id);
      if (bit === undefined) {
        bit = this.sourceBits.size < 30 ? this.sourceBits.size : 30;
        this.sourceBits.set(id, bit);
      }
      return bit;
    }

    /** מחשב את השדות הנגזרים והמחרוזת לחיפוש. נקרא גם כשנטענות הסדרות. */
    _derive(item, i) {
      const series = this.seriesById.get(item.series);
      item.seriesTitle = series ? series.title : item.title || '';
      item.circleName = series && series.circle ? series.circle : '';
      item._ns = norm(item.seriesTitle);
      // רכיבים נפרדים ממוטמנים: מיליוני כותרות זהות אינן מנורמלות מחדש.
      const sameTitle = !item.title || item.title === item.seriesTitle;
      item._nall = sameTitle ? item._ns : item._ns + ' ' + norm(item.title);
      item._nc = norm(item.circleName);
      let mask = 0;
      let names = '';
      let bytes = 0;
      let downloads = 0;
      for (const a of item.assets) {
        mask |= 1 << this._sourceBit(a.src);
        names += ' ' + a.src + ' ' + (this.names.source ? this.names.source(a.src) || '' : '');
        if (a.bytes > bytes) bytes = a.bytes;
        if (a.downloads > downloads) downloads = a.downloads;
      }
      item._mask = mask;
      item._bytes = bytes;
      item._dl = downloads;
      const parashot = item.parasha.map((p) => Core.PARASHOT[p] || '').join(' ') + ' ' + item.parasha.join(' ');
      const event = item.event ? (Core.EVENTS[item.event] || '') + ' ' + item.event : '';
      item._parashaHay = ' ' + skey(parashot + ' ' + event) + ' ';
      const langHay = ' ' + item.lang + ' ' + skey(Core.LANG_NAMES[item.lang] || '') + ' ';
      item._langHay = langHay;
      item._srcHay = ' ' + skey(names) + ' ';
      const year = item.hy ? ' ' + item.hy + ' ' + skey(Core.hyLetters(item.hy)) + ' ' + (item.hy % 1000) : '';
      this.hay[i] =
        ' ' +
        skey(item.seriesTitle) +
        ' ' +
        (sameTitle ? '' : skey(item.title) + ' ') +
        skey(item.circleName) +
        ' ' + (item.no ? item.no + ' ' : '') +
        item._parashaHay.trim() +
        year +
        langHay.trimEnd() +
        item._srcHay.trimEnd() +
        ' ';
      item._i = i;
    }

    /** מוסיף או מחליף גיליונות לפי `id`. מחזיר כמה היו חדשים. */
    addIssues(list) {
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
      let added = 0;
      for (const raw of Array.isArray(list) ? list : []) {
        if (!raw || typeof raw.id !== 'string') continue;
        const item = raw;
        item.assets = Array.isArray(item.assets) ? item.assets : [];
        item.parasha = Array.isArray(item.parasha) ? item.parasha : item.parasha ? [item.parasha] : [];
        item.lang = item.lang || 'he';
        item._added = item.added ? Date.parse(item.added) || 0 : 0;
        const d = item.date ? Core.parseYmd(item.date) : null;
        item._date = d ? d.getTime() : 0;
        item.series = this.resolveSeriesId(item.series);
        let i = this.byId.get(item.id);
        if (i === undefined) {
          i = this.items.length;
          this.items.push(item);
          this.byId.set(item.id, i);
          added++;
        } else {
          this.items[i] = item;
        }
        this._derive(item, i);
      }
      this._rebuildGroups();
      this._applyRules();
      this._invalidate();
      this.lastBuildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
      return added;
    }

    _rebuildGroups() {
      this.bySeries = new Map();
      this.byDate = new Map();
      this.byYearParasha = new Map();
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        let arr = this.bySeries.get(it.series);
        if (!arr) this.bySeries.set(it.series, (arr = []));
        arr.push(i);
        if (it.date) {
          let d = this.byDate.get(it.date);
          if (!d) this.byDate.set(it.date, (d = []));
          d.push(i);
        } else if (it.hy) {
          for (const p of it.parasha) {
            const key = it.hy + '|' + p;
            let d = this.byYearParasha.get(key);
            if (!d) this.byYearParasha.set(key, (d = []));
            d.push(i);
          }
        }
      }
    }

    _invalidate() {
      this._orders.clear();
      this._facets = null;
      this.version++;
    }

    get size() {
      return this.items.length;
    }

    // --------------------------------------------------------- כללים

    setRules(ruleset) {
      this._rules = ruleset || Rules.emptyRules();
      this._applyRules();
      this._invalidate();
    }

    _applyRules() {
      this._compiled = Rules.compile(this._rules, { seriesTitle: (it) => it.seriesTitle });
      for (let i = 0; i < this.items.length; i++) {
        const d = this._compiled.decide(this.items[i]);
        this.vis[i] = d.action === 'show' ? 1 : 0;
        this.nodl[i] = d.noDownload ? 1 : 0;
        this.pin[i] = d.pin ? 1 : 0;
      }
    }

    /** ההחלטה המלאה (עם הסיבה) לגיליון אחד. */
    decision(item) {
      return this._compiled.decide(item);
    }

    isVisible(item) {
      return this.vis[item._i] === 1;
    }

    // ----------------------------------------------------------- מיון

    /** סדר האינדקסים לפי מיון, עם מטמון. `relevance` ללא שאילתה = לפי תאריך. */
    _order(sort) {
      const key = sort === 'relevance' ? 'date' : sort;
      let order = this._orders.get(key);
      if (order) return order;
      const items = this.items;
      order = new Int32Array(items.length);
      for (let i = 0; i < order.length; i++) order[i] = i;
      const byDate = (a, b) => items[b]._date - items[a]._date || items[b]._added - items[a]._added || a - b;
      let cmp = byDate;
      if (key === 'new') cmp = (a, b) => items[b]._added - items[a]._added || byDate(a, b);
      else if (key === 'size') cmp = (a, b) => items[b]._bytes - items[a]._bytes || byDate(a, b);
      else if (key === 'alpha') {
        cmp = (a, b) => (items[a]._ns < items[b]._ns ? -1 : items[a]._ns > items[b]._ns ? 1 : byDate(a, b));
      }
      order.sort(cmp);
      this._orders.set(key, order);
      return order;
    }

    // --------------------------------------------------------- חיפוש

    _termHit(i, term) {
      const it = this.items[i];
      switch (term.field) {
        case 'year':
          if (term.from) return it.hy >= term.from && it.hy <= term.to;
          return String(it.hy || '').startsWith(term.norm);
        case 'series':
          return (' ' + skey(it.seriesTitle) + ' ').includes(' ' + term.norm);
        case 'parasha':
          return it._parashaHay.includes(' ' + term.norm);
        case 'lang':
          return it._langHay.includes(' ' + term.norm);
        case 'source':
          return it._srcHay.includes(' ' + term.norm);
        case 'circle':
          return it._nc.includes(term.norm);
        default:
          // כל מילה בנפרד כשזה לא ביטוי: "אסיפה נח" = שתי מילים בכל סדר.
          if (term.phrase) return this.hay[i].includes(' ' + term.norm);
          return this.hay[i].includes(' ' + term.norm);
      }
    }

    /**
     * מריץ שאילתה. [filters]: `{ parasha, hy, lang, source, circle, series,
     * favorite, downloaded, unread, isNew }`. [ctx]: פרדיקטים למצב המשתמש:
     * `{ isFavorite(item), isDownloaded(item), isRead(item), isNew(item),
     * seriesBoost(item) }`. [options]: `{ sort, includeHidden }`.
     * מחזיר `{ idx, total, hidden, ms }`, כש-`idx` רשימת אינדקסים מסודרת.
     */
    search(query, filters, ctx, options) {
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const q = typeof query === 'string' ? parseQuery(query) : query || { clauses: [], tokens: [] };
      const f = filters || {};
      const c = ctx || {};
      const o = options || {};
      let sort = SORTS.includes(o.sort) ? o.sort : 'relevance';
      const hasText = q.clauses.length > 0;
      if (sort === 'relevance' && !hasText) sort = 'relevance';
      const order = this._order(sort);
      const items = this.items;
      const out = [];
      let hidden = 0;
      const bit = f.source && this.sourceBits.has(f.source) ? 1 << this.sourceBits.get(f.source) : 0;
      if (f.source && !bit) return { idx: out, total: 0, hidden: 0, ms: 0, query: q };
      const scores = hasText && sort === 'relevance' ? new Map() : null;
      const clauses = q.clauses;
      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        const it = items[i];
        if (f.hy && it.hy !== f.hy) continue;
        if (f.lang && it.lang !== f.lang) continue;
        if (bit && !(it._mask & bit)) continue;
        if (f.parasha && !it.parasha.includes(f.parasha) && it.event !== f.parasha) continue;
        if (f.circle && it.circleName !== f.circle) continue;
        if (f.series && it.series !== f.series) continue;
        if (hasText) {
          let ok = true;
          let score = 0;
          for (let ci = 0; ci < clauses.length && ok; ci++) {
            const alts = clauses[ci].alts;
            let hit = false;
            let negOnly = true;
            for (let ai = 0; ai < alts.length; ai++) {
              const term = alts[ai];
              const matched = this._termHit(i, term);
              if (term.neg) {
                if (!matched) hit = true;
              } else {
                negOnly = false;
                if (matched) {
                  hit = true;
                  if (scores && !term.field) {
                    score += it._ns.startsWith(term.norm) ? 4 : (' ' + it._ns + ' ').includes(' ' + term.norm + ' ') ? 3 : (' ' + it._nall + ' ').includes(' ' + term.norm) ? 2 : 1;
                  }
                }
              }
            }
            if (!hit && !negOnly) ok = false;
            else if (!hit) ok = false;
          }
          if (!ok) continue;
          if (scores) scores.set(i, score);
        }
        if (this.vis[i] !== 1 && !o.includeHidden) {
          hidden++;
          continue;
        }
        if (f.favorite && !(c.isFavorite && c.isFavorite(it))) continue;
        if (f.downloaded && !(c.isDownloaded && c.isDownloaded(it))) continue;
        if (f.unread && c.isRead && c.isRead(it)) continue;
        if (f.isNew && !(c.isNew && c.isNew(it))) continue;
        out.push(i);
      }
      if (scores && out.length > 1) {
        const rank = new Map();
        for (let r = 0; r < out.length; r++) rank.set(out[r], r);
        out.sort((a, b) => scores.get(b) - scores.get(a) || rank.get(a) - rank.get(b));
      }
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
      return { idx: out, total: out.length, hidden, ms, query: q };
    }

    // -------------------------------------------- קיבוץ ושליפות

    item(i) {
      return this.items[i];
    }

    get(id) {
      const i = this.byId.get(id);
      return i === undefined ? null : this.items[i];
    }

    /** גיליונות הסדרה, מהחדש לישן (לפי תאריך, אחר כך זמן הוספה). */
    issuesOfSeries(seriesId, includeHidden) {
      const list = (this.bySeries.get(this.resolveSeriesId(seriesId)) || []).filter((i) => includeHidden || this.vis[i] === 1);
      const items = this.items;
      return list.sort((a, b) => items[b]._date - items[a]._date || items[b]._added - items[a]._added || a - b);
    }

    /** האינדקסים של שבוע: לפי תאריך השבת, או לפי פרשה ושנה כשאין תאריך. */
    forWeek(week, includeHidden) {
      if (!week) return [];
      const set = new Set(this.byDate.get(week.date) || []);
      for (const p of (week.parasha || []).concat(week.parashaIL || [])) {
        for (const i of this.byYearParasha.get(week.hy + '|' + p) || []) set.add(i);
      }
      return [...set].filter((i) => includeHidden || this.vis[i] === 1);
    }

    weekFor(dateText) {
      const weeks = this.weeks;
      for (let i = 0; i < weeks.length; i++) if (weeks[i].date >= dateText) return i;
      return weeks.length ? weeks.length - 1 : -1;
    }

    seriesTitleOf(id) {
      const s = this.seriesById.get(this.resolveSeriesId(id));
      return s ? s.title : '';
    }

    /** כל הסדרות, מסודרות א-ב, עם `_norm` לחיפוש. */
    seriesList() {
      // כותרות בעברית קודם, ואחריהן שאר השפות.
      const rank = (s) => (/^[֐-׿]/.test(s._ntitle) ? 0 : 1);
      return [...this.seriesById.values()].sort((a, b) => rank(a) - rank(b) || (a._ntitle < b._ntitle ? -1 : a._ntitle > b._ntitle ? 1 : 0));
    }

    /** סדרות לפי טקסט ומסננים: `{ circle, lang }`. */
    searchSeries(text, filters, predicate) {
      const q = parseQuery(text);
      const terms = q.clauses.map((cl) => cl.alts[0]).filter((t) => !t.field);
      const f = filters || {};
      return this.seriesList().filter((s) => {
        if (f.circle && s.circle !== f.circle) return false;
        if (f.lang && s.lang !== f.lang) return false;
        if (predicate && !predicate(s)) return false;
        const hay = ' ' + s._norm + ' ';
        return terms.every((term) => (term.neg ? !hay.includes(' ' + term.norm) : hay.includes(' ' + term.norm)));
      });
    }

    /** ערכים לסינון, עם ספירה: שנים, פרשות, שפות, מקורות וחוגים. */
    facets() {
      if (this._facets) return this._facets;
      const years = new Map();
      const parashot = new Map();
      const langs = new Map();
      const sources = new Map();
      const circles = new Map();
      const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
      for (let i = 0; i < this.items.length; i++) {
        if (this.vis[i] !== 1) continue;
        const it = this.items[i];
        if (it.hy) bump(years, it.hy);
        for (const p of it.parasha) bump(parashot, p);
        bump(langs, it.lang);
        for (const a of it.assets) bump(sources, a.src);
        if (it.circleName) bump(circles, it.circleName);
      }
      this._facets = { years, parashot, langs, sources, circles };
      return this._facets;
    }
  }

  const api = { CatalogIndex, parseQuery, FIELDS, SORTS };
  A.Index = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
