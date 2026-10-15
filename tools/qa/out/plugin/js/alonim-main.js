// נקודת הכניסה: מחבר את ה-App לאירועי אוצריא. הערכה והפלטפורמה מגיעות
// ב-`plugin.boot` (אין לקרוא ל-SDK לפני כן).
(function () {
  'use strict';

  const A = window.Alonim;
  const bridge = window.Otzaria;
  const t = A.I18n.t;

  if (!bridge) {
    // מחוץ לאוצריא (פתיחה ישירה של הקובץ בדפדפן) אין מה להציג.
    document.querySelector('.content-column').textContent = t('התוסף פועל רק מתוך אוצריא.');
    return;
  }

  const app = new A.AppModule.App(bridge, document);
  window.__alonimApp = app;
  const on = app.runtime.on;

  // boot חוזר רק מרענן את הערכה, ולכן בטוח.
  on('plugin.boot', (payload) => app.boot(payload));
  on('theme.changed', (theme) => A.Theme.applyTheme(theme));
  on('plugin.suspended', () => app.suspend());
  on('plugin.resumed', () => app.resume());
})();
