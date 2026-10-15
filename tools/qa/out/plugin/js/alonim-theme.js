// ערכת הצבעים והגופנים של אוצריא, כמשתני CSS (DESIGN_GUIDE.md). כל תפקיד
// צבע ב-`colorScheme` הופך ל-`--color-<kebab>`, כך שתפקיד שאוצריא תוסיף
// בעתיד יהיה זמין בלי שינוי כאן. מעליה — "גודל תצוגה" מהגדרות התוסף
// (`--ui-scale`).
(function (root) {
  'use strict';

  /** גופן הממשק של אוצריא (`typography.uiFontFamily`), כשנשלח. */
  let hostFont = null;

  const kebab = (name) => name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());

  /** שם משפחה בתוך מחרוזת CSS: מרכאות ולוכסן היו שוברים את הערך. */
  function family(name) {
    const clean = String(name).replace(/['"\\]/g, '');
    return "'" + clean + "', system-ui, sans-serif";
  }

  /** `true` כשהערכה הוחלה. ערכה חסרה או חלקית נשארת על ברירות המחדל. */
  function applyTheme(theme, documentRef) {
    const doc = documentRef || root.document;
    if (!theme || !theme.colorScheme || !doc) return false;
    const style = doc.documentElement.style;
    for (const [role, value] of Object.entries(theme.colorScheme)) {
      if (typeof value === 'string' && value !== '') style.setProperty('--color-' + kebab(role), value);
    }
    doc.documentElement.dataset.mode = theme.mode === 'dark' ? 'dark' : 'light';
    const typography = theme.typography || {};
    // גופן הקריאה אינו מתאים לממשק (DESIGN_GUIDE); משתמשים רק בגופן הממשק.
    // מארח ישן אינו שולח אותו, ואז נשאר הגופן הקודם.
    if (typography.uiFontFamily) hostFont = typography.uiFontFamily;
    if (hostFont) style.setProperty('--font-ui', family(hostFont));
    return true;
  }

  /** "גודל תצוגה": מכפיל של גודל הממשק (`--ui-scale`). */
  function applyScale(scale, documentRef) {
    const doc = documentRef || root.document;
    if (!doc) return;
    const value = typeof scale === 'number' && scale >= 0.7 && scale <= 2 ? scale : 1;
    doc.documentElement.style.setProperty('--ui-scale', String(value));
  }

  const api = { applyTheme, applyScale, kebab };
  const A = (root.Alonim = root.Alonim || {});
  A.Theme = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
