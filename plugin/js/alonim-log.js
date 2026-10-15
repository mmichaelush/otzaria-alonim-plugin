// יומן קטן בזיכרון: info ומעלה גם ל-console (אוצריא כותבת אותו ליומן שלה),
// debug נשאר בזיכרון. "אודות ודיווח" מציג את הזנב, אחרי `scrub`: נתיבי דיסק
// וכתובות מקומיות אינם יוצאים מהמחשב בדיווח.
(function (root) {
  'use strict';

  const LIMIT = 200;

  class Log {
    constructor(sink) {
      /** `null` בבדיקות, כדי לא להרעיש. */
      this.sink = sink === undefined ? root.console : sink;
      this.entries = [];
    }

    _add(level, args) {
      const text = args
        .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a)))
        .join(' ');
      this.entries.push({ at: Date.now(), level, text });
      if (this.entries.length > LIMIT) this.entries.splice(0, this.entries.length - LIMIT);
      if (this.sink && level !== 'debug' && typeof this.sink[level] === 'function') {
        this.sink[level]('[alonim] ' + text);
      }
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

    /** הזנב כטקסט, מנוקה. */
    tail(count) {
      return this.entries
        .slice(-(count || 60))
        .map((e) => new Date(e.at).toISOString().slice(11, 19) + ' ' + e.level + ' ' + scrub(e.text))
        .join('\n');
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
      .replace(/[A-Za-z]:[\\/][^\s"']*/g, '<path>')
      .replace(/\/(?:Users|home)\/[^\s"']*/g, '<path>')
      .replace(/https?:\/\/(?:127\.0\.0\.1|localhost)[^\s"']*/g, '<local>');
  }

  const api = { Log, scrub, shared: new Log() };
  const A = (root.Alonim = root.Alonim || {});
  A.Log = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
