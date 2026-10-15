// יכולות של המארח (אוצריא) שהתוסף משתמש בהן רק אחרי בדיקה: `network.fetchFile`
// (קובץ מרוחק בלי הורדה), `ui.printFile` (מסך ההדפסה של אוצריא על קובץ PDF), ו-iframe ישיר על קובץ
// מוענק. המקור היחיד לשאלה "האם יש" הוא המודול הזה; אין קריאה לשיטה חדשה שלא
// עברה בו.
//
// הכרעה, לפי הסדר:
//   1. ביטול ידני (`setOverride`, "תאימות לאחור" באבחון): אין יכולות חדשות.
//   2. נלמד מכשל: אם קריאה החזירה `error.unknown_method` / `error.unsupported` —
//      היכולת חסרה בהפעלה הזו, גם אם הגרסה אמרה אחרת.
//   3. גרסת המארח (`app.getInfo` / `plugin.boot`) ≥ MIN_VERSION: יש. גרסה נמוכה
//      או לא ידועה: אין (שמרני).
// כך המארח הישן ממשיך לעבוד כמו קודם (Blob, הורדה לתיקייה, הדפסה מהקורא).
(function (root) {
  'use strict';

  /** @type {any} */

  const A = (root.Alonim = root.Alonim || {});

  /** הגרסה שבה נוספו השיטות החדשות (docs/HOST_API_PROPOSAL.md). */
  const MIN_VERSION = '0.9.99';
  /** מסמן מחרוזת לתרגום בלי לתרגם אותה עכשיו (התרגום בזמן הציור). */
  const N = (text) => text;

  /** שם יכולת ← השיטה שמאחוריה (null = נגזרת מיכולת אחרת) ותווית לאבחון. */
  const FEATURES = Object.freeze({
    fetchFile: { method: 'network.fetchFile', label: N('קריאה בלי הורדה') },
    printFile: { method: 'ui.printFile', label: N('מסך ההדפסה של אוצריא') },
    frameFile: { method: null, label: N('תצוגה ישירה בצפיין') },
  });

  /** `1.2.3` ← מספרים; חלק חסר = 0, טקסט אחרי המספר נזרק (`0.9.99-dev`). */
  function parseVersion(text) {
    const parts = String(text || '')
      .split('.')
      .map((p) => parseInt(p, 10));
    return [0, 1, 2].map((i) => (Number.isFinite(parts[i]) ? parts[i] : 0));
  }

  /** `a ≥ b` לגרסאות. */
  function versionAtLeast(a, b) {
    const x = parseVersion(a);
    const y = parseVersion(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return true;
  }

  class Capabilities {
    /** [options]: `{ log, minVersion }`. */
    constructor(options) {
      const o = options || {};
      this.log = o.log || { info() {}, warn() {}, debug() {} };
      this.minVersion = o.minVersion || MIN_VERSION;
      this.hostVersion = '';
      this.override = false;
      /** יכולת ← `{ reason, at }` כשנלמד שהיא חסרה. */
      this.learned = new Map();
    }

    setHost(version) {
      this.hostVersion = String(version || '');
    }

    /** "תאימות לאחור": מתעלם מהיכולות החדשות (לבדיקות ולאבחון). */
    setOverride(on) {
      this.override = Boolean(on);
    }

    /** `{ available, source: 'override'|'learned'|'version'|'unknown-version'|'old-version', detail }`. */
    status(feature) {
      if (!FEATURES[feature])
        return { available: false, source: 'unknown-feature', detail: feature };
      if (this.override) return { available: false, source: 'override', detail: '' };
      const learned = this.learned.get(feature);
      if (learned) return { available: false, source: 'learned', detail: learned.reason };
      if (!this.hostVersion) return { available: false, source: 'unknown-version', detail: '' };
      if (!versionAtLeast(this.hostVersion, this.minVersion))
        return { available: false, source: 'old-version', detail: this.hostVersion };
      return { available: true, source: 'version', detail: this.hostVersion };
    }

    has(feature) {
      return this.status(feature).available;
    }

    /** רושם שהיכולת חסרה בהפעלה הזו (מכשל קריאה, או בחירת המשתמש). */
    markMissing(feature, reason) {
      if (!FEATURES[feature] || this.learned.has(feature)) return;
      this.learned.set(feature, { reason: reason || 'unsupported', at: Date.now() });
      this.log.warn('host capability missing: ' + feature + ' (' + (reason || 'unsupported') + ')');
    }

    /** מאפס מה שנלמד (למשל אחרי שהמשתמש לחץ "נסה שוב"). */
    reset(feature) {
      if (feature) this.learned.delete(feature);
      else this.learned.clear();
    }

    /**
     * קורא ליכולת דרך [runtime]. בלי יכולת — זורק `UnsupportedError`. כשל מסוג
     * "שיטה לא קיימת" נלמד, ונזרק כ-`UnsupportedError` כדי שהקורא ייפול לאחור.
     * שגיאות אחרות עוברות כמות שהן.
     */
    async call(feature, runtime, payload) {
      const spec = FEATURES[feature];
      if (!spec || !spec.method) throw new UnsupportedError(feature, 'no-method');
      if (!this.has(feature)) throw new UnsupportedError(feature, this.status(feature).source);
      try {
        return await runtime.call(spec.method, payload);
      } catch (error) {
        if (error && error.isUnsupported) {
          this.markMissing(feature, error.code || 'unsupported');
          throw new UnsupportedError(feature, 'learned');
        }
        throw error;
      }
    }

    /** שורות לטבלת האבחון: `{ feature, method, label, available, source, detail }`. */
    report() {
      return Object.keys(FEATURES).map((feature) => ({
        feature,
        method: FEATURES[feature].method || '—',
        label: FEATURES[feature].label,
        ...this.status(feature),
      }));
    }
  }

  /** היכולת אינה זמינה: הקורא נופל לאחור. */
  class UnsupportedError extends Error {
    constructor(feature, source) {
      super('unsupported ' + feature + (source ? ' (' + source + ')' : ''));
      this.name = 'UnsupportedError';
      this.code = 'unsupported';
      this.feature = feature;
      this.isUnsupported = true;
    }
  }

  const api = {
    Capabilities,
    UnsupportedError,
    FEATURES,
    MIN_VERSION,
    versionAtLeast,
    parseVersion,
  };
  A.Capabilities = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
