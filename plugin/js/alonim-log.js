// יומן בזיכרון: טבעת של אירועים עם רמה (debug|info|warn|error) וקטגוריה
// (app, host, catalog, files, state, ui), וקוד שגיאה כשיש. info ומעלה גם ל-console
// (אוצריא כותבת אותו ליומן שלה), debug נשאר בזיכרון. מסך "אבחון" מציג את הטבעת עם
// סינון, ו"פרטים לדיווח" מעתיק את הזנב אחרי `scrub`: נתיבי דיסק וכתובות מקומיות אינם
// יוצאים מהמחשב בדיווח.
(function (root) {
  'use strict';

  /** כמה אירועים הטבעת מחזיקה. */
  const LIMIT = 500;
  const LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
  const CATEGORIES = Object.freeze(['app', 'host', 'catalog', 'files', 'state', 'ui']);

  const rank = (level) => LEVELS.indexOf(level);

  class Log {
    /** [sink]: ברירת מחדל `console`; `null` בבדיקות, כדי לא להרעיש. */
    constructor(sink, category) {
      this.sink = sink === undefined ? root.console : sink;
      this.category = category || 'app';
      /** הטבעת; ל-`scoped` יש הפניה לאותה טבעת. */
      this.entries = [];
      this._root = this;
      this.listeners = new Set();
    }

    _add(level, args) {
      const store = this._root;
      let code = '';
      const text = args
        .map((a) => {
          if (a instanceof Error) {
            const failure = /** @type {any} */ (a);
            if (!code && failure.code) code = String(failure.code);
            return a.message;
          }
          return typeof a === 'string' ? a : safeJson(a);
        })
        .join(' ');
      const entry = { at: Date.now(), level, cat: this.category, code, text };
      store.entries.push(entry);
      if (store.entries.length > LIMIT) store.entries.splice(0, store.entries.length - LIMIT);
      if (store.sink && level !== 'debug' && typeof store.sink[level] === 'function') {
        store.sink[level]('[alonim:' + this.category + '] ' + text);
      }
      for (const fn of store.listeners) fn(entry);
    }

    debug(...args) {
      this._add('debug', args);
    }

    info(...args) {
      this._add('info', args);
    }

    warn(...args) {
      this._add('warn', args);
    }

    error(...args) {
      this._add('error', args);
    }

    /** יומן עם קטגוריה קבועה, באותה טבעת. */
    scoped(category) {
      const child = Object.create(Log.prototype);
      child.category = category;
      child._root = this._root;
      Object.defineProperty(child, 'entries', { get: () => this._root.entries });
      Object.defineProperty(child, 'sink', { get: () => this._root.sink });
      return child;
    }

    /** מנוי לאירועים חדשים (מסך האבחון). מחזיר פונקציית ביטול. */
    onEntry(fn) {
      this._root.listeners.add(fn);
      return () => this._root.listeners.delete(fn);
    }

    /** אירועים לפי סינון: `{ level: 'warn' }` (הרמה הזו ומעלה), `{ cat: 'catalog' }`. */
    filter(options) {
      const o = options || {};
      const min = o.level ? rank(o.level) : 0;
      return this._root.entries.filter((e) => rank(e.level) >= min && (!o.cat || e.cat === o.cat));
    }

    /**
     * מה שמסך האבחון מציג: `entries` (האחרונים, עד [limit]), `matched` (כמה מתאימים לסינון) ו-`total`
     * (כל הטבעת). הספירה והרשימה חייבות לבוא מאותו סינון: `total > 0` עם `matched === 0` פירושו
     * שהסינון (רמה, קטגוריה) הסתיר הכול, ולא שהיומן ריק.
     */
    view(options, limit) {
      const matched = this.filter(options);
      return {
        entries: matched.slice(-(limit || 200)),
        matched: matched.length,
        total: this._root.entries.length,
      };
    }

    /** ספירה לפי רמה, למסך האבחון. */
    counts() {
      const out = { debug: 0, info: 0, warn: 0, error: 0 };
      for (const e of this._root.entries) out[e.level]++;
      return out;
    }

    /** אירוע כשורת טקסט מנוקה. */
    static format(entry) {
      return (
        new Date(entry.at).toISOString().slice(11, 19) +
        ' ' +
        entry.level +
        ' ' +
        entry.cat +
        (entry.code ? ' [' + entry.code + ']' : '') +
        ' ' +
        scrub(entry.text)
      );
    }

    /** הזנב כטקסט, מנוקה. [options]: סינון כמו `filter`. */
    tail(count, options) {
      return this.filter(options)
        .slice(-(count || 60))
        .map(Log.format)
        .join('\n');
    }

    clear() {
      this._root.entries.length = 0;
    }
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  /** מסיר נתיבי דיסק וכתובות מקומיות לפני שטקסט יוצא מהמחשב. */
  function scrub(text) {
    return String(text)
      .replace(/https?:\/\/(?:127\.0\.0\.1|localhost)[^\s"']*/g, '<local>') // קודם: "p:/" בסוף "http" נראה כמו כונן
      .replace(/(?<![A-Za-z])[A-Za-z]:[\\/][^\s"']*/g, '<path>')
      .replace(/\/(?:Users|home)\/[^\s"']*/g, '<path>');
  }

  const api = { Log, scrub, LEVELS, CATEGORIES, LIMIT, shared: new Log() };
  /** @type {any} */
  const A = (root.Alonim = root.Alonim || {});
  A.Log = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
