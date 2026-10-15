// גבול שגיאות למסכים: חריגה בציור מסך אינה משאירה דף ריק. המחלקה של המסך נעטפת פעם
// אחת, וכל שיטה שבה (mount, render, refresh…) שנכשלת מציגה במקומה כרטיס שגיאה עם
// הודעה, "נסה שוב" ו"העתקת פרטים לדיווח". הכשל נרשם ביומן (קטגוריה ui) עם קוד
// `screen_failed`, וחזרה לשאר התוסף נשארת פתוחה (לשוניות, חיפוש, הגדרות).
(function (root) {
  'use strict';

  const A = (root.Alonim = root.Alonim || {});

  /** השיטות של מסך שנעטפות. כל מה שלא קיים במחלקה מדולג. */
  const GUARDED = Object.freeze(['mount', 'render', 'refresh', 'layout', 'run', 'schedule', 'renderPage', 'layoutPage', 'runList', 'renderHead']);

  const guarded = new WeakSet();

  /**
   * עוטף את [Screen] (מחלקה). [onError](screen, method, error) נקרא בכל כשל, והמסך
   * עצמו אינו זורק. כפול-עטיפה בטוח.
   */
  function protect(Screen, onError) {
    if (!Screen || guarded.has(Screen)) return Screen;
    guarded.add(Screen);
    for (const name of GUARDED) {
      const original = Screen.prototype[name];
      if (typeof original !== 'function') continue;
      Screen.prototype[name] = function guardedMethod(...args) {
        try {
          const result = original.apply(this, args);
          // שיטה אסינכרונית: כשל בהבטחה נתפס כמו כשל סינכרוני.
          if (result && typeof result.catch === 'function') return result.catch((error) => onError(this, name, error));
          return result;
        } catch (error) {
          onError(this, name, error);
          return undefined;
        }
      };
    }
    return Screen;
  }

  const api = { protect, GUARDED };
  A.Boundary = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
