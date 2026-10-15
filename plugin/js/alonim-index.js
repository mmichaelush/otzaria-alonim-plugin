// אינדקס בזיכרון על כל הגיליונות שנטענו: חיפוש, סינון, מיון, קיבוץ ושאילתות
// מתקדמות. טהור: בלי DOM ובלי SDK.
//
// רזה בכוונה (הקטלוג האמיתי: 123 אלף גיליונות): עמודות של מספרים במקום אובייקט
// לגיליון, מחרוזת חיפוש אחת (`hay`) לגיליון, ואין כתובות. מה שנדרש להורדה
// ולפתיחה (url, page, thumb) נשאר בקבצי השרד ונקרא רק לפי דרישה
// (`Catalog.hydrate`). `item(i)` בונה אובייקט גיליון לפי דרישה, עם מטמון קטן, ולכן
// מי שמחזיק גיליון לא מחזיק עותק של העמודות. היעד: חיפוש <50ms.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;
  const Rules = A.Rules;
  const { normalizeKey, searchKey, memoized } = A.Normalize;

  const norm = memoized(normalizeKey, 60000);
  const skey = memoized(searchKey, 60000);

  const FIELDS = ['series', 'year', 'parasha', 'event', 'lang', 'source', 'circle'];
  const SORTS = ['relevance', 'new', 'date', 'alpha', 'size'];
  const DAY_MS = 86400000;
  const MATERIALIZED_MAX = 800;

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
      const useField = known ? field : '';
      // "http:x" אינו שדה: נשאר טקסט רגיל.
      if (field && !known) body = (field + ':' + (body || '')).trim();
      if (quoted === undefined && !useField && /^(OR|\|)$/.test(body)) {
        raw.push({ or: true });
        continue;
      }
      raw.push({ field: useField, body, neg: m[1] === '-', phrase: quoted !== undefined && /\s/.test(quoted.trim()) });
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
      if (!term.neg && (!term.field || term.field === 'series')) for (const w of term.norm.split(' ')) if (w) tokens.push(w);
      if (pendingOr && clauses.length) clauses[clauses.length - 1].alts.push(term);
      else clauses.push({ alts: [term] });
      pendingOr = false;
    }
    return { clauses, tokens, text: source };
  }

  function makeTerm(part) {
    const body = String(part.body || '').trim();
    if (!body) return null;
    const term = { field: part.field, neg: part.neg, norm: skey(body), needle: '', phrase: part.phrase, from: 0, to: 0 };
    if (part.field === 'year') {
      // שנה, או טווח "5785-5787" / "תשפ״ה-תשפ״ז" (מספרים או אותיות, בכל שילוב).
      const ends = body.split(/\s*(?:-|\.\.|–|־)\s*/);
      const a = Core.parseYear(ends[0]);
      const b = ends.length === 2 ? Core.parseYear(ends[1]) : a;
      if (a && b) {
        term.from = Math.min(a, b);
        term.to = Math.max(a, b);
      }
    }
    if (!term.norm && !term.from) return null;
    // מחרוזת החיפוש (רווח + מילה) נבנית פעם אחת, לא לכל גיליון.
    term.needle = ' ' + term.norm;
    return term;
  }

  /** ערכים דינמיים (שפה, פרשה, אירוע) כמספרים קטנים בעמודה. */
  class Dict {
    constructor(initial) {
      this.list = [''];
      this.map = new Map();
      for (const v of initial || []) this.id(v);
    }

    /** מספר לערך (מ-1; 0 = חסר). */
    id(value) {
      if (!value) return 0;
      let n = this.map.get(value);
      if (n === undefined) {
        n = this.list.length;
        this.list.push(value);
        this.map.set(value, n);
      }
      return n;
    }

    get(n) {
      return this.list[n] || '';
    }
  }

  const dayOf = (text) => {
    if (!text) return 0;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS) : 0;
  };
  const dateOfDay = (day) => (day ? new Date(day * DAY_MS).toISOString().slice(0, 10) : null);

  // ----------------------------------------------------------- אינדקס

  class CatalogIndex {
    /** [names]: `{ source(id) → שם }` לשמות מקורות בחיפוש. */
    constructor(names) {
      this.names = names || {};
      this.n = 0;
      this.idToI = new Map();
      // עמודות
      this.ids = [];
      this.sidx = [];
      this.hyc = [];
      this.dayc = [];
      this.addedc = [];
      this.noc = [];
      this.p1 = [];
      this.p2 = [];
      this.evc = [];
      this.langc = [];
      this.maskc = [];
      this.titlec = [];
      this.astart = [];
      this.acount = [];
      this.shardc = [];
      this.hay = [];
      this.vis = [];
      this.nodl = [];
      this.pin = [];
      // נכסים (שטוחים): מקור, גודל ב-KB, עמודים, הורדות, בלי קישור ישיר
      this.aSrc = [];
      this.aKb = [];
      this.aPages = [];
      this.aDl = [];
      this.aNoUrl = [];
      this.titles = [''];
      this.titleMap = new Map();
      this.langs = new Dict();
      this.parashot = new Dict(Object.keys(Core.PARASHOT));
      this.events = new Dict(Object.keys(Core.EVENTS));
      this.shardIds = new Dict();
      this.sourceBits = new Map();
      this.sourceNames = [];
      /** תבניות כתובת לפי מקור (דחיסת URL): נכס בלי `url` עם תבנית עדיין ניתן להורדה. */
      this.sourceTemplate = new Map();
      // סדרות: כולל "מקום שמור" לסדרה שעוד לא נטענה
      this.seriesArr = [];
      this.seriesIdx = new Map();
      this.seriesById = new Map();
      this.seriesAlias = new Map();
      this.weeks = [];
      /** לוח הארכיון (שנים ישנות), נטען לפי בקשה. */
      this.weeksOld = [];
      this.pending = [];
      this.bySeries = new Map();
      this.byDay = new Map();
      this.byYearParasha = new Map();
      this._orders = new Map();
      this._facets = null;
      this._mat = new Map();
      this._fragMap = null;
      this._partCache = new Map();
      this._rules = Rules.emptyRules();
      this._compiled = Rules.compile(this._rules, null);
      this.version = 0;
      this.lastBuildMs = 0;
      this.needRegroup = false;
    }

    get size() {
      return this.n;
    }

    // --------------------------------------------------------- סדרות

    /** שפת הגיליון: שלו אם נכתבה, אחרת של הסדרה, אחרת עברית. */
    _lang(i) {
      return this.langc[i] || this.seriesArr[this.sidx[i]]._lang || this.langs.id('he');
    }

    _seriesSlot(id) {
      let k = this.seriesIdx.get(id);
      if (k === undefined) {
        k = this.seriesArr.length;
        this.seriesArr.push({ id, title: '', _norm: '', _ntitle: '', _skey: '', _nc: '', circle: '', lang: '', _lang: 0, placeholder: true });
        this.seriesIdx.set(id, k);
      }
      return k;
    }

    setSeries(list) {
      this.seriesById.clear();
      this.seriesAlias.clear();
      for (const s of Array.isArray(list) ? list : []) {
        if (!s || !s.id) continue;
        const k = this._seriesSlot(s.id);
        const slot = this.seriesArr[k];
        Object.assign(slot, s);
        slot.placeholder = false;
        slot._ntitle = norm(s.title);
        slot._skey = skey(s.title);
        slot._norm = skey([s.title].concat(s.aliases || []).join(' '));
        slot._nc = norm(s.circle || '');
        slot._lang = this.langs.id(s.lang || 'he');
        this.seriesById.set(s.id, slot);
        for (const old of s.previousIds || []) this.seriesAlias.set(old, s.id);
      }
      // גיליונות שנטענו לפני הסדרה שלהם מקבלים עכשיו את הכותרת.
      const pending = this.pending;
      this.pending = [];
      for (const i of pending) this._derive(i);
      this._rebuildGroups();
      this._applyRules();
      this._invalidate();
    }

    setWeeks(list) {
      this.weeks = (Array.isArray(list) ? list : []).filter((w) => w && w.date).sort((a, b) => (a.date < b.date ? -1 : 1));
      this._derived = null;
      this._calendar = null;
      this.version++;
    }

    /** שורות לוח של שנים ישנות (`weeks-archive.json`); מצטרפות ללוח הרגיל. */
    setWeeksArchive(list) {
      this.weeksOld = (Array.isArray(list) ? list : []).filter((w) => w && w.date).sort((a, b) => (a.date < b.date ? -1 : 1));
      this._derived = null;
      this._calendar = null;
      this.version++;
    }

    /** הלוח המלא: הארכיון (אם נטען) ואחריו הלוח הרגיל, ממוינים. */
    calendar() {
      if (!this.weeksOld.length) return this.weeks;
      if (!this._calendar || this._calendarVersion !== this.version) {
        this._calendar = this.weeksOld.concat(this.weeks).sort((a, b) => (a.date < b.date ? -1 : 1));
        this._calendarVersion = this.version;
      }
      return this._calendar;
    }

    resolveSeriesId(id) {
      return this.seriesById.has(id) ? id : this.seriesAlias.get(id) || id;
    }

    seriesTitleOf(id) {
      const s = this.seriesById.get(this.resolveSeriesId(id));
      return s ? s.title : '';
    }

    /** מקורות המניפסט: מי מהם בונה את כתובת הקובץ מתבנית, כדי ש-"בלי קישור ישיר" יהיה מדויק. */
    setSources(list) {
      this.sourceTemplate = new Map();
      for (const x of Array.isArray(list) ? list : []) {
        if (x && x.id) this.sourceTemplate.set(x.id, Boolean(x.urlTemplates && typeof x.urlTemplates.url === 'string'));
      }
      this._mat.clear();
      this.version++;
    }

    _sourceBit(id) {
      let bit = this.sourceBits.get(id);
      if (bit === undefined) {
        bit = this.sourceBits.size < 30 ? this.sourceBits.size : 30;
        this.sourceBits.set(id, bit);
        this.sourceNames[bit] = id;
        this._partCache.clear();
      }
      return bit;
    }

    // ----------------------------------------------- חלקי מחרוזת חיפוש

    _part(key, build) {
      let v = this._partCache.get(key);
      if (v === undefined) {
        v = build();
        this._partCache.set(key, v);
      }
      return v;
    }

    _parashaHay(p1, p2, ev) {
      return this._part('p' + p1 + '/' + p2 + '/' + ev, () => {
        const names = [p1, p2].filter(Boolean).map((p) => (Core.PARASHOT[this.parashot.get(p)] || '') + ' ' + this.parashot.get(p));
        const event = ev ? (Core.EVENTS[this.events.get(ev)] || '') + ' ' + this.events.get(ev) : '';
        return ' ' + skey(names.join(' ') + ' ' + event) + ' ';
      });
    }

    /**
     * מזהי הפרשות (`kind: 'parasha'`) או האירועים (`'event'`) שהטקסט [norm] מציין:
     * שם מדויק (עברית או סלאג) קודם; ורק אם אין — תחילת מילה. כך `parasha:נח` הוא נח
     * בלבד, ולא גם "נחמו" שמתחילה באותן אותיות.
     */
    _namedIds(kind, norm) {
      const dict = kind === 'event' ? this.events : this.parashot;
      const names = kind === 'event' ? Core.EVENTS : Core.PARASHOT;
      return this._part('n' + kind + '/' + dict.list.length + '/' + norm, () => {
        const exact = new Set();
        const prefix = new Set();
        for (let id = 1; id < dict.list.length; id++) {
          const slug = dict.list[id];
          const forms = [skey(names[slug] || ''), skey(slug)];
          if (forms.some((form) => form === norm)) exact.add(id);
          else if (forms.some((form) => (' ' + form).includes(' ' + norm))) prefix.add(id);
        }
        return exact.size ? exact : prefix;
      });
    }

    _yearHay(hy) {
      return this._part('y' + hy, () => (hy ? ' ' + hy + ' ' + skey(Core.hyLetters(hy)) + ' ' + (hy % 1000) + ' ' : ' '));
    }

    _langHay(lang) {
      return this._part('l' + lang, () => ' ' + this.langs.get(lang) + ' ' + skey(Core.LANG_NAMES[this.langs.get(lang)] || '') + ' ');
    }

    _srcHay(mask) {
      return this._part('s' + mask, () => {
        let text = '';
        for (const [id, bit] of this.sourceBits) if (mask & (1 << bit)) text += ' ' + id + ' ' + (this.names.source ? this.names.source(id) || '' : '');
        return ' ' + skey(text) + ' ';
      });
    }

    _srcsOfMask(mask) {
      return this._part('m' + mask, () => {
        const out = [];
        for (const [id, bit] of this.sourceBits) if (mask & (1 << bit)) out.push(id);
        return out;
      });
    }

    /** מחרוזת החיפוש של גיליון: סדרה, כותרת, חוג, מספר, פרשה, שנה, שפה, מקורות. */
    _derive(i) {
      const k = this.sidx[i];
      const s = this.seriesArr[k];
      // אין כותרת סדרה עדיין: מחכים ל-setSeries.
      if (s.placeholder) this.pending.push(i);
      const title = this.titlec[i] ? this.titles[this.titlec[i]] : '';
      this.hay[i] =
        ' ' +
        s._skey +
        ' ' +
        (title ? skey(title) + ' ' : '') +
        (s.circle ? skey(s.circle) + ' ' : '') +
        (this.noc[i] ? this.noc[i] + ' ' : '') +
        this._parashaHay(this.p1[i], this.p2[i], this.evc[i]).slice(1) +
        this._yearHay(this.hyc[i]).slice(1) +
        this._langHay(this._lang(i)).slice(1) +
        this._srcHay(this.maskc[i]).slice(1);
    }

    // ----------------------------------------------------------- בנייה

    /**
     * מוסיף או מחליף גיליונות לפי `id`. [shardId]: מאיזה קובץ הגיעו, לקריאת
     * הפרטים המלאים אחר כך (`recent` לקובץ האחרונים). מחזיר כמה היו חדשים.
     */
    addIssues(list, shardId) {
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const shard = shardId ? this.shardIds.id(shardId) : 0;
      const firstNew = this.n;
      let added = 0;
      const sorted = new Set(this._orders.keys());
      for (const raw of Array.isArray(list) ? list : []) {
        if (!raw || typeof raw.id !== 'string') continue;
        let i = this.idToI.get(raw.id);
        const fresh = i === undefined;
        if (fresh) {
          i = this.n++;
          this.idToI.set(raw.id, i);
          this.ids[i] = raw.id;
          added++;
        } else {
          this.needRegroup = true;
          this._mat.delete(i);
        }
        const series = this.resolveSeriesId(raw.series || '');
        this.sidx[i] = this._seriesSlot(series);
        const parasha = Array.isArray(raw.parasha) ? raw.parasha : raw.parasha ? [raw.parasha] : [];
        this.hyc[i] = raw.hy || 0;
        this.dayc[i] = dayOf(raw.date);
        this.addedc[i] = raw.added ? Math.floor((Date.parse(raw.added) || 0) / 1000) : 0;
        this.noc[i] = raw.no || 0;
        this.p1[i] = this.parashot.id(parasha[0]);
        this.p2[i] = this.parashot.id(parasha[1]);
        this.evc[i] = this.events.id(raw.event);
        // שפה חסרה בגיליון = שפת הסדרה (ירושה, docs/CATALOG_FORMAT.md).
        this.langc[i] = this.langs.id(raw.lang);
        const sTitle = this.seriesArr[this.sidx[i]].title;
        const t = raw.title || '';
        this.titlec[i] = t && t !== sTitle ? this._titleId(t) : 0;
        // כותרת סדרה לא ידועה: הכותרת של הגיליון היא כל מה שיש.
        if (!sTitle && t) this.titlec[i] = this._titleId(t);
        this.shardc[i] = shard;
        let mask = 0;
        const assets = Array.isArray(raw.assets) ? raw.assets : [];
        this.astart[i] = this.aSrc.length;
        this.acount[i] = assets.length;
        for (const a of assets) {
          const bit = this._sourceBit(a.src);
          mask |= 1 << bit;
          this.aSrc.push(bit);
          this.aKb.push(a.bytes ? Math.round(a.bytes / 1024) : 0);
          this.aPages.push(a.pages || 0);
          this.aDl.push(a.downloads || 0);
          this.aNoUrl.push(a.url ? 0 : 1);
        }
        this.maskc[i] = mask;
        this._derive(i);
        if (!fresh && assets.length) {
          // הנכסים של גיליון מוחלף נשמרים בסוף העמודות; הישנים נשארים יתומים (זניח).
        }
      }
      if (this.needRegroup || this.bySeries.size === 0) this._rebuildGroups();
      else this._appendGroups(firstNew);
      this._applyRulesFrom(firstNew, this.needRegroup);
      this._mergeOrders(sorted, firstNew);
      this.needRegroup = false;
      this._facets = null;
      this._fragMap = null;
      this.version++;
      this.lastBuildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
      return added;
    }

    _titleId(title) {
      let n = this.titleMap.get(title);
      if (n === undefined) {
        n = this.titles.length;
        this.titles.push(title);
        this.titleMap.set(title, n);
      }
      return n;
    }

    _groupAdd(i) {
      const sid = this.seriesArr[this.sidx[i]].id;
      let arr = this.bySeries.get(sid);
      if (!arr) this.bySeries.set(sid, (arr = []));
      arr.push(i);
      const day = this.dayc[i];
      if (day) {
        let d = this.byDay.get(day);
        if (!d) this.byDay.set(day, (d = []));
        d.push(i);
      } else if (this.hyc[i]) {
        for (const p of [this.p1[i], this.p2[i]]) {
          if (!p) continue;
          const key = this.hyc[i] + '|' + this.parashot.get(p);
          let d = this.byYearParasha.get(key);
          if (!d) this.byYearParasha.set(key, (d = []));
          d.push(i);
        }
      }
    }

    _rebuildGroups() {
      this.bySeries = new Map();
      this.byDay = new Map();
      this.byYearParasha = new Map();
      for (let i = 0; i < this.n; i++) this._groupAdd(i);
    }

    _appendGroups(from) {
      for (let i = from; i < this.n; i++) this._groupAdd(i);
    }

    _invalidate() {
      this._orders.clear();
      this._facets = null;
      this._mat.clear();
      this._fragMap = null;
      this.version++;
    }

    // --------------------------------------------------------- כללים

    setRules(ruleset) {
      this._rules = ruleset || Rules.emptyRules();
      this._applyRules();
      this._facets = null;
      this._mat.clear();
      this.version++;
    }

    _scratch() {
      return { id: '', series: '', lang: '', title: '', srcs: [], _ns: '', _nall: undefined, _nc: '', _i: 0 };
    }

    _fill(v, i) {
      const s = this.seriesArr[this.sidx[i]];
      v.id = this.ids[i];
      v.series = s.id;
      v.lang = this.langs.get(this._lang(i));
      v.title = this.titlec[i] ? this.titles[this.titlec[i]] : s.title;
      v.seriesTitle = s.title;
      v.srcs = this._srcsOfMask(this.maskc[i]);
      v._ns = s._ntitle;
      v._nc = s._nc;
      v._nall = this._needsAll ? norm(s.title + ' ' + v.title) : undefined;
      v._i = i;
      return v;
    }

    _applyRules() {
      this._applyRulesFrom(0, true);
    }

    /** מחשב החלטות. [from]: רק מהאינדקס הזה (גיליונות חדשים), אלא אם [all]. */
    _applyRulesFrom(from, all) {
      const seriesTitle = (it) => it.seriesTitle;
      if (all || from === 0 || this._compiledRules !== this._rules) {
        this._compiled = Rules.compile(this._rules, { seriesTitle });
        this._compiledRules = this._rules;
        this._needsAll = this._rules.rules.some((r) => r.field === 'pattern');
        from = 0;
      }
      const v = this._scratch();
      for (let i = from; i < this.n; i++) {
        const d = this._compiled.decide(this._fill(v, i));
        this.vis[i] = d.action === 'show' ? 1 : 0;
        this.nodl[i] = d.noDownload ? 1 : 0;
        this.pin[i] = d.pin ? 1 : 0;
      }
    }

    decision(item) {
      const i = item._i !== undefined && item._i >= 0 ? item._i : this.idToI.get(item.id);
      if (i === undefined) return this._compiled.decide({ ...item, srcs: (item.assets || []).map((a) => a.src), seriesTitle: item.seriesTitle });
      return this._compiled.decide(this._fill(this._scratch(), i));
    }

    isVisible(item) {
      const i = item._i !== undefined && item._i >= 0 ? item._i : this.idToI.get(item.id);
      return i === undefined ? true : this.vis[i] === 1;
    }

    /** כמה גיליונות ישתנו אם [candidate] יצטרף לכללים. ראו `Rules.simulate`. */
    simulate(candidate, limit) {
      const rule = Rules.cleanRule(candidate);
      if (!rule) return { hides: 0, shows: 0, total: 0, examples: [] };
      const ruleset = this._rules;
      const next = { ...ruleset, rules: [...ruleset.rules.filter((r) => r.id !== rule.id), rule] };
      const seriesTitle = (it) => it.seriesTitle;
      const before = Rules.compile(ruleset, { seriesTitle });
      const after = Rules.compile(next, { seriesTitle });
      const saved = this._needsAll;
      this._needsAll = next.rules.some((r) => r.field === 'pattern');
      const v = this._scratch();
      let hides = 0;
      let shows = 0;
      let total = 0;
      const examples = [];
      for (let i = 0; i < this.n; i++) {
        this._fill(v, i);
        const a = before.decide(v);
        const b = after.decide(v);
        if (a.action === b.action && a.noDownload === b.noDownload && a.pin === b.pin) continue;
        total++;
        if (a.action === 'show' && b.action === 'hide') hides++;
        if (a.action === 'hide' && b.action === 'show') shows++;
        if (examples.length < (limit || 5)) examples.push(this.item(i));
      }
      this._needsAll = saved;
      return { hides, shows, total, examples };
    }

    // ----------------------------------------------------------- מיון

    _cmp(key) {
      const day = this.dayc;
      const added = this.addedc;
      const byDate = (a, b) => day[b] - day[a] || added[b] - added[a] || a - b;
      if (key === 'new') return (a, b) => added[b] - added[a] || byDate(a, b);
      if (key === 'size') {
        const maxKb = (i) => {
          let m = 0;
          for (let k = this.astart[i]; k < this.astart[i] + this.acount[i]; k++) if (this.aKb[k] > m) m = this.aKb[k];
          return m;
        };
        return (a, b) => maxKb(b) - maxKb(a) || byDate(a, b);
      }
      if (key === 'alpha') {
        const nt = (i) => this.seriesArr[this.sidx[i]]._ntitle;
        return (a, b) => {
          const x = nt(a);
          const y = nt(b);
          return x < y ? -1 : x > y ? 1 : byDate(a, b);
        };
      }
      return byDate;
    }

    /** סדר האינדקסים לפי מיון, עם מטמון. `relevance` ללא שאילתה = לפי תאריך. */
    _order(sort) {
      const key = sort === 'relevance' ? 'date' : sort;
      let order = this._orders.get(key);
      if (order && order.length === this.n) return order;
      order = new Int32Array(this.n);
      for (let i = 0; i < order.length; i++) order[i] = i;
      order.sort(this._cmp(key));
      this._orders.set(key, order);
      return order;
    }

    /** מיזוג גיליונות חדשים לסדרים שכבר מחושבים, במקום מיון מלא בכל שרד. */
    _mergeOrders(keys, from) {
      if (!keys.size) return;
      if (this.needRegroup) {
        this._orders.clear();
        return;
      }
      for (const key of keys) {
        const order = this._orders.get(key);
        if (!order) continue;
        const cmp = this._cmp(key);
        const extra = [];
        for (let i = from; i < this.n; i++) extra.push(i);
        extra.sort(cmp);
        const merged = new Int32Array(this.n);
        let a = 0;
        let b = 0;
        let k = 0;
        while (a < order.length && b < extra.length) merged[k++] = cmp(order[a], extra[b]) <= 0 ? order[a++] : extra[b++];
        while (a < order.length) merged[k++] = order[a++];
        while (b < extra.length) merged[k++] = extra[b++];
        this._orders.set(key, merged);
      }
    }

    // --------------------------------------------------------- חיפוש

    _termHit(i, term) {
      switch (term.field) {
        case 'year':
          if (term.from) return this.hyc[i] >= term.from && this.hyc[i] <= term.to;
          return String(this.hyc[i] || '').startsWith(term.norm);
        case 'series':
          return (' ' + this.seriesArr[this.sidx[i]]._skey + ' ').includes(term.needle);
        case 'parasha': {
          const set = this._namedIds('parasha', term.norm);
          return set.has(this.p1[i]) || set.has(this.p2[i]);
        }
        case 'event':
          return this._namedIds('event', term.norm).has(this.evc[i]);
        case 'lang':
          return this._langHay(this._lang(i)).includes(term.needle);
        case 'source':
          return this._srcHay(this.maskc[i]).includes(term.needle);
        case 'circle':
          return this.seriesArr[this.sidx[i]]._nc.includes(term.norm);
        default:
          return this.hay[i].includes(term.needle);
      }
    }

    // -------------------------------------------- גיליון, קיבוץ ושליפות

    /** אובייקט גיליון (בלי כתובות) לפי אינדקס, עם מטמון קטן. */
    item(i) {
      let it = this._mat.get(i);
      if (it) return it;
      const s = this.seriesArr[this.sidx[i]];
      const assets = [];
      for (let k = this.astart[i]; k < this.astart[i] + this.acount[i]; k++) {
        assets.push({ src: this.sourceNames[this.aSrc[k]], bytes: this.aKb[k] * 1024, pages: this.aPages[k] || undefined, downloads: this.aDl[k] || undefined, noUrl: this.aNoUrl[k] === 1 && !this.sourceTemplate.get(this.sourceNames[this.aSrc[k]]) });
      }
      const title = this.titlec[i] ? this.titles[this.titlec[i]] : s.title;
      const parasha = [this.p1[i], this.p2[i]].filter(Boolean).map((p) => this.parashot.get(p));
      let bytes = 0;
      let downloads = 0;
      for (const a of assets) {
        if (a.bytes > bytes) bytes = a.bytes;
        if ((a.downloads || 0) > downloads) downloads = a.downloads;
      }
      it = {
        id: this.ids[i],
        series: s.id,
        seriesTitle: s.title || title,
        title,
        no: this.noc[i] || null,
        date: dateOfDay(this.dayc[i]),
        hy: this.hyc[i] || null,
        parasha,
        event: this.events.get(this.evc[i]) || null,
        lang: this.langs.get(this._lang(i)),
        pages: assets.length && assets[0].pages ? assets[0].pages : null,
        added: this.addedc[i] ? new Date(this.addedc[i] * 1000).toISOString() : null,
        assets,
        circleName: s.circle || '',
        _i: i,
        _ns: s._ntitle,
        _added: this.addedc[i] * 1000,
        _date: this.dayc[i] * DAY_MS,
        _bytes: bytes,
        _dl: downloads,
        _shard: this.shardIds.get(this.shardc[i]),
      };
      if (this._mat.size >= MATERIALIZED_MAX) this._mat.clear();
      this._mat.set(i, it);
      return it;
    }

    get(id) {
      const i = this.idToI.get(id);
      return i === undefined ? null : this.item(i);
    }

    /** האינדקס של גיליון שמזהה הקובץ שלו מסתיים ב-8 התווים האלה (מדיסק). */
    byFragment(fragment) {
      if (!this._fragMap) {
        this._fragMap = new Map();
        for (let i = 0; i < this.n; i++) this._fragMap.set(Core.idFragment(this.ids[i]), i);
      }
      const i = this._fragMap.get(fragment);
      return i === undefined ? null : this.item(i);
    }

    /** גיליונות הסדרה, מהחדש לישן (לפי תאריך, אחר כך זמן הוספה). */
    issuesOfSeries(seriesId, includeHidden) {
      const list = (this.bySeries.get(this.resolveSeriesId(seriesId)) || []).filter((i) => includeHidden || this.vis[i] === 1);
      const day = this.dayc;
      const added = this.addedc;
      return list.sort((a, b) => day[b] - day[a] || added[b] - added[a] || a - b);
    }

    /** האינדקסים של שבוע: לפי תאריך השבת, או לפי פרשה ושנה כשאין תאריך. */
    forWeek(week, includeHidden) {
      if (!week) return [];
      const set = new Set(this.byDay.get(dayOf(week.date)) || []);
      for (const p of (week.parasha || []).concat(week.parashaIL || [])) {
        for (const i of this.byYearParasha.get(week.hy + '|' + p) || []) set.add(i);
      }
      return [...set].filter((i) => includeHidden || this.vis[i] === 1);
    }

    /**
     * שורות שבוע לתאריכים שמחוץ ללוח (`weeks.json` מכסה כשנתיים): נגזרות
     * מהגיליונות המתוארכים שנטענו. כך אפשר לדפדף גם בשנים שאין להן לוח.
     */
    derivedWeeks() {
      if (this._derived && this._derivedVersion === this.version) return this._derived;
      const calendar = this.calendar();
      const first = calendar.length ? dayOf(calendar[0].date) : Infinity;
      const last = calendar.length ? dayOf(calendar[calendar.length - 1].date) : -Infinity;
      const rows = [];
      for (const [day, list] of this.byDay) {
        if (day >= first && day <= last) continue;
        const i = list[0];
        const parasha = [this.parashot.get(this.p1[i]), this.parashot.get(this.p2[i])].filter(Boolean);
        const event = this.events.get(this.evc[i]) || null;
        const dow = new Date(day * DAY_MS).getUTCDay();
        if (dow !== 6 && !event) continue; // יום חול בלי אירוע: אינו שבוע
        rows.push({ date: dateOfDay(day), hy: this.hyc[i] || 0, parasha, parashaIL: parasha, event, shabbat: dow === 6, derived: true });
      }
      this._derived = rows.sort((a, b) => (a.date < b.date ? -1 : 1));
      this._derivedVersion = this.version;
      return this._derived;
    }

    /** לוח + שורות נגזרות, ממוינים לפי תאריך. */
    allWeeks() {
      const derived = this.derivedWeeks();
      const calendar = this.calendar();
      return derived.length ? calendar.concat(derived).sort((a, b) => (a.date < b.date ? -1 : 1)) : calendar;
    }

    weekFor(dateText) {
      const weeks = this.weeks;
      for (let i = 0; i < weeks.length; i++) if (weeks[i].date >= dateText) return i;
      return weeks.length ? weeks.length - 1 : -1;
    }

    /** כל הסדרות, מסודרות א-ב (עברית קודם), עם `_norm` לחיפוש. */
    seriesList() {
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
      for (let i = 0; i < this.n; i++) {
        if (this.vis[i] !== 1) continue;
        if (this.hyc[i]) bump(years, this.hyc[i]);
        if (this.p1[i]) bump(parashot, this.parashot.get(this.p1[i]));
        if (this.p2[i]) bump(parashot, this.parashot.get(this.p2[i]));
        bump(langs, this.langs.get(this._lang(i)));
        const mask = this.maskc[i];
        for (const [id, b] of this.sourceBits) if (mask & (1 << b)) bump(sources, id);
        const circle = this.seriesArr[this.sidx[i]].circle;
        if (circle) bump(circles, circle);
      }
      this._facets = { years, parashot, langs, sources, circles };
      return this._facets;
    }

    /** נתיב קבצי השרד שבהם מצוי הגיליון: `recent` או מזהה שרד. */
    shardOf(item) {
      return item._shard || '';
    }
  }

  const api = { CatalogIndex, parseQuery, FIELDS, SORTS, dayOf, dateOfDay };
  A.Index = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
