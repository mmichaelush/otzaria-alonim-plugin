// חיפוש וסינון על האינדקס: `search` (תוצאות), `facetCounts` (ספירות לכל מסנן, לפי
// שאר המסננים) ו-`matches` (בדיקת גיליון בודד). כל מסנן הוא "קבוצה": פונקציית
// בדיקה לפי אינדקס. אותן קבוצות משמשות לחיפוש ולספירות, ולכן הספירה שמוצגת ליד
// ערך תמיד שווה למה שהחיפוש יחזיר אם יבחרו בו (נבדק מול סינון נאיבי על הנתונים
// הגולמיים בכל קטלוג: test/filter-matrix.test.js). הסמנטיקה: alonim-filters.js.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Index = A.Index;
  const Filters = A.Filters;
  const CatalogIndex = Index.CatalogIndex;
  const { dayOf, SORTS } = Index;
  const Core = A.Core;

  const proto = CatalogIndex.prototype;

  const popcount = (n) => {
    let c = 0;
    for (let x = n; x; x &= x - 1) c++;
    return c;
  };

  /** עמודים: המקסימום בין העותקים (0 = לא ידוע). */
  proto._pagesOf = function (i) {
    let m = 0;
    for (let k = this.astart[i]; k < this.astart[i] + this.acount[i]; k++) if (this.aPages[k] > m) m = this.aPages[k];
    return m;
  };

  /** גודל קובץ ב-KB: המקסימום בין העותקים (0 = לא ידוע). */
  proto._kbOf = function (i) {
    let m = 0;
    for (let k = this.astart[i]; k < this.astart[i] + this.acount[i]; k++) if (this.aKb[k] > m) m = this.aKb[k];
    return m;
  };

  /** כמה מקורות שונים מחזיקים עותק. */
  proto._copiesOf = function (i) {
    return popcount(this.maskc[i]);
  };

  const inRange = (value, lo, hi) => value > 0 && (!lo || value >= lo) && (!hi || value <= hi);

  /**
   * קבוצות הסינון של שאילתה ומסננים. כל קבוצה: `{ key, facet, test(i) }`.
   * `facet` — האם יש לה ספירה משלה בממשק. הסדר: זולות קודם, מצב משתמש אחרון.
   */
  proto._compile = function (q, f, c, scores) {
    const groups = [];
    const add = (key, test, facet) => groups.push({ key, facet: Boolean(facet), test });
    const ids = (dict, list) => new Set(list.map((v) => dict.map.get(v)).filter(Boolean));

    if (f.hy) {
      const set = new Set(f.hy);
      add('hy', (i) => set.has(this.hyc[i]), true);
    }
    if (f.lang) {
      const set = ids(this.langs, f.lang);
      add('lang', (i) => set.has(this._lang(i)), true);
    }
    if (f.source) {
      let mask = 0;
      for (const id of f.source) if (this.sourceBits.has(id)) mask |= 1 << this.sourceBits.get(id);
      add('source', (i) => (this.maskc[i] & mask) !== 0, true);
    }
    if (f.parasha) {
      const set = ids(this.parashot, f.parasha);
      add('parasha', (i) => set.has(this.p1[i]) || set.has(this.p2[i]), true);
    }
    if (f.event) {
      const set = ids(this.events, f.event);
      add('event', (i) => set.has(this.evc[i]), true);
    }
    if (f.circle) {
      const set = new Set(f.circle);
      add('circle', (i) => set.has(this.seriesArr[this.sidx[i]].circle), true);
    }
    if (f.series) {
      const set = new Set(f.series.map((id) => this.seriesIdx.get(this.resolveSeriesId(id))).filter((k) => k !== undefined));
      add('series', (i) => set.has(this.sidx[i]), false);
    }
    if (f.dateFrom || f.dateTo) {
      const lo = f.dateFrom ? dayOf(f.dateFrom) : 0;
      const hi = f.dateTo ? dayOf(f.dateTo) : 0;
      add('date', (i) => inRange(this.dayc[i], lo, hi));
    }
    if (f.hyFrom || f.hyTo) add('years', (i) => inRange(this.hyc[i], f.hyFrom || 0, f.hyTo || 0));
    if (f.pagesMin || f.pagesMax) add('pages', (i) => inRange(this._pagesOf(i), f.pagesMin || 0, f.pagesMax || 0));
    if (f.sizeMin || f.sizeMax) {
      const lo = f.sizeMin ? f.sizeMin * 1024 : 0;
      const hi = f.sizeMax ? f.sizeMax * 1024 : 0;
      add('size', (i) => inRange(this._kbOf(i), lo, hi));
    }
    if (f.multi) add('multi', (i) => this._copiesOf(i) >= 2);
    if (q.clauses.length) add('text', this._textTest(q.clauses, scores));
    // מצב המשתמש: דורש את הגיליון המלא, ולכן אחרון.
    const state = [];
    const need = (name, fn) => {
      if (f[name]) state.push(fn);
    };
    need('favorite', (it) => Boolean(c.isFavorite && c.isFavorite(it)));
    need('followed', (it) => Boolean(c.isFollowed && c.isFollowed(it)));
    need('downloaded', (it) => Boolean(c.isDownloaded && c.isDownloaded(it)));
    need('inList', (it) => Boolean(c.inList && c.inList(it)));
    need('unread', (it) => !(c.isRead && c.isRead(it)));
    need('isNew', (it) => Boolean(c.isNew && c.isNew(it)));
    if (f.sinceVisit) add('sinceVisit', (i) => this.newc[i] * 1000 > (c.lastVisit || 0));
    if (state.length) add('state', (i) => {
      const it = this.item(i);
      return state.every((fn) => fn(it));
    });
    return groups;
  };

  /** בדיקת הטקסט: סעיפים ב-AND, חלופות (`OR`) בתוך סעיף, ניקוד לרלוונטיות. */
  proto._textTest = function (clauses, scores) {
    return (i) => {
      let score = 0;
      for (let ci = 0; ci < clauses.length; ci++) {
        const alts = clauses[ci].alts;
        let hit = false;
        for (let ai = 0; ai < alts.length; ai++) {
          const term = alts[ai];
          const matched = this._termHit(i, term);
          if (term.neg) {
            if (!matched) hit = true;
          } else if (matched) {
            hit = true;
            if (scores && !term.field) {
              const ns = this.seriesArr[this.sidx[i]]._ntitle;
              score += ns.startsWith(term.norm) ? 4 : (' ' + ns + ' ').includes(' ' + term.norm + ' ') ? 3 : (' ' + ns).includes(' ' + term.norm) ? 2 : 1;
            }
          }
        }
        if (!hit) return false;
      }
      if (scores) scores.set(i, score);
      return true;
    };
  };

  /** סוגי הקיבוץ של רשימת תוצאות. */
  const GROUPS = Object.freeze(['week', 'series', 'year', 'circle', 'lang']);

  /** מפתח הקיבוץ של גיליון [i] לפי [kind] (ראו GROUPS); 0 או '' = "ללא". */
  proto.groupKey = function (i, kind) {
    switch (kind) {
      case 'week':
        return this.dayc[i];
      case 'series':
        return this.sidx[i];
      case 'year':
        return this.hyc[i];
      case 'circle':
        return this.seriesArr[this.sidx[i]].circle || '';
      case 'lang':
        return this._lang(i);
      default:
        return 0;
    }
  };

  /**
   * מקבץ אינדקסים (בסדר שנתקבלו) לקבוצות לפי [kind]. מחזיר
   * `[{ key, idx: [i…] }]` ממוין: שבוע ושנה מהחדש לישן, סדרה וחוג לפי א-ב, שפה לפי
   * סדר השפות; "ללא" (תאריך, שנה, חוג) בסוף.
   */
  proto.groupResults = function (idx, kind) {
    const map = new Map();
    for (const i of idx) {
      const key = this.groupKey(i, kind);
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(i);
    }
    const groups = [...map].map(([key, list]) => ({ key, idx: list }));
    // "ללא" = אין תאריך / שנה / חוג. מפתח סדרה 0 הוא סדרה אמיתית (המקום הראשון).
    const empty = (g) => ((kind === 'week' || kind === 'year') && g.key === 0) || (kind === 'circle' && g.key === '');
    const rank = (g) => (kind === 'lang' ? Core.LANG_CODES.indexOf(this.langs.get(g.key)) : 0);
    groups.sort((a, b) => {
      if (empty(a) !== empty(b)) return empty(a) ? 1 : -1;
      if (kind === 'week' || kind === 'year') return b.key - a.key;
      if (kind === 'series') {
        const x = this.seriesArr[a.key]._ntitle;
        const y = this.seriesArr[b.key]._ntitle;
        return x < y ? -1 : x > y ? 1 : 0;
      }
      if (kind === 'circle') return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      return rank(a) - rank(b);
    });
    return groups;
  };

  Index.GROUPS = GROUPS;

  const visibleFor = (index, i, f, o) => (f.hiddenOnly ? index.vis[i] !== 1 : o.includeHidden || index.vis[i] === 1);

  /**
   * מריץ שאילתה. [filters]: ראו `Filters.clean` (רשימות = "או", בין מסננים "וגם").
   * [ctx]: מצב משתמש: `{ isFavorite, isFollowed, isDownloaded, inList, isRead,
   * isNew, lastVisit }`. [options]: `{ sort, includeHidden }`.
   * מחזיר `{ idx, total, hidden, ms, query }`; `hidden` — כמה עוד היו מתאימים
   * אילולא הוסתרו לפי הכללים.
   */
  proto.search = function (query, filters, ctx, options) {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const q = typeof query === 'string' ? Index.parseQuery(query) : query || { clauses: [], tokens: [] };
    const f = Filters.clean(filters);
    const c = ctx || {};
    const o = options || {};
    const sort = SORTS.includes(o.sort) ? o.sort : 'relevance';
    const order = this._order(sort);
    const scores = q.clauses.length && sort === 'relevance' ? new Map() : null;
    const groups = this._compile(q, f, c, scores);
    const out = [];
    let hidden = 0;
    // מסנני מצב אחרונים: ההסתרה נספרת לפני שהם נבדקים (כמו תמיד).
    const stateGroup = groups.length && groups[groups.length - 1].key === 'state' ? groups.pop() : null;
    const tests = groups.map((g) => g.test);
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      let ok = true;
      for (let g = 0; g < tests.length; g++) {
        if (!tests[g](i)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (!visibleFor(this, i, f, o)) {
        if (!f.hiddenOnly && this.vis[i] !== 1) hidden++;
        continue;
      }
      if (stateGroup && !stateGroup.test(i)) continue;
      out.push(i);
    }
    if (scores && out.length > 1) {
      const rank = new Map();
      for (let r = 0; r < out.length; r++) rank.set(out[r], r);
      out.sort((a, b) => scores.get(b) - scores.get(a) || rank.get(a) - rank.get(b));
    }
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    return { idx: out, total: out.length, hidden, ms, query: q };
  };

  /** האם הגיליון [i] עובר את כל הקבוצות (למי שבודק גיליון בודד). */
  proto.matches = function (i, query, filters, ctx, options) {
    const q = typeof query === 'string' ? Index.parseQuery(query) : query || { clauses: [], tokens: [] };
    const f = Filters.clean(filters);
    const groups = this._compile(q, f, ctx || {}, null);
    return visibleFor(this, i, f, options || {}) && groups.every((g) => g.test(i));
  };

  /**
   * ספירות לכל מסנן, כשכל מסנן נספר לפי כל השאר (ולא לפי עצמו): "כמה גיליונות
   * יהיו אם אבחר בערך הזה (או אוסיף אותו)". כולל את הטקסט. מחזיר
   * `{ total, parasha, event, hy, lang, source, circle }` (מפות ערך ← ספירה).
   * מעבר אחד על האינדקס.
   */
  proto.facetCounts = function (query, filters, ctx, options) {
    const q = typeof query === 'string' ? Index.parseQuery(query) : query || { clauses: [], tokens: [] };
    const f = Filters.clean(filters);
    const o = options || {};
    const groups = this._compile(q, f, ctx || {}, null);
    const out = { total: 0, parasha: new Map(), event: new Map(), hy: new Map(), lang: new Map(), source: new Map(), circle: new Map() };
    const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
    const sourceOf = (i) => {
      const mask = this.maskc[i];
      const list = [];
      for (const [id, b] of this.sourceBits) if (mask & (1 << b)) list.push(id);
      return list;
    };
    for (let i = 0; i < this.n; i++) {
      if (!visibleFor(this, i, f, o)) continue;
      let failed = '';
      let fails = 0;
      for (let g = 0; g < groups.length && fails < 2; g++) {
        if (!groups[g].test(i)) {
          fails++;
          failed = groups[g].key;
        }
      }
      if (fails > 1) continue;
      const only = fails === 1 ? failed : '';
      // כשל יחיד באחד המסננים: הגיליון נספר רק במסנן הזה (ולא בסך הכל). כשל במסנן
      // שאין לו ספירה משלו (סדרה, טווחים, מצב) לא נספר בשום מקום.
      if (!only) out.total++;
      const count = (key) => !only || only === key;
      if (count('hy') && this.hyc[i]) bump(out.hy, this.hyc[i]);
      if (count('parasha')) {
        if (this.p1[i]) bump(out.parasha, this.parashot.get(this.p1[i]));
        if (this.p2[i]) bump(out.parasha, this.parashot.get(this.p2[i]));
      }
      if (count('event') && this.evc[i]) bump(out.event, this.events.get(this.evc[i]));
      if (count('lang')) bump(out.lang, this.langs.get(this._lang(i)));
      if (count('source')) for (const id of sourceOf(i)) bump(out.source, id);
      if (count('circle')) {
        const circle = this.seriesArr[this.sidx[i]].circle;
        if (circle) bump(out.circle, circle);
      }
    }
    return out;
  };

})(typeof self !== 'undefined' ? self : globalThis);
