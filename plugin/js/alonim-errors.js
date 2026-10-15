// רישום אחד של קודי השגיאה של התוסף: לכל קוד — תחום, טקסט למשתמש, והאם ניסיון חוזר
// עשוי לעזור. ההחלטות בקוד נשענות על הקוד (לא על הטקסט); הטקסט הוא של ה-UI. הבדיקה
// `error-codes.test.js` מוודאת שכל קוד שהקוד זורק או מדווח רשום כאן.
//
// תחומים: files (הורדה וקריאה), net (בקשות רשת), catalog (סנכרון), ui (מסך או חלון).
(function (root) {
  'use strict';

  const A = (root.Alonim = root.Alonim || {});
  /** מסמן מחרוזת לתרגום בלי לתרגם אותה עכשיו (התרגום בזמן הציור). */
  const N = (text) => text;

  /** קוד ← `{ area, retry, text }`. */
  const CODES = Object.freeze({
    // ---- קבצים
    no_folder: { area: 'files', retry: false, text: N('עוד לא נבחרה תיקייה לשמירת העלונים.') },
    blocked: {
      area: 'files',
      retry: false,
      text: N(
        'הכתובת של הקובץ טרם אושרה באוצריא, ולכן אי אפשר להוריד אותו דרך התוסף. אפשר לפתוח את הגיליון באתר המקור.',
      ),
    },
    no_direct_link: {
      area: 'files',
      retry: false,
      text: N('המקור הזה מספק קישור לאתר בלבד, בלי הורדה ישירה.'),
    },
    permission: { area: 'files', retry: false, text: N('לתוסף אין הרשאה לשמור קבצים בתיקייה.') },
    not_pdf: {
      area: 'files',
      retry: true,
      text: N('הקובץ שירד אינו PDF תקין, ולכן נמחק. אפשר לנסות שוב או לפתוח באתר המקור.'),
    },
    truncated: { area: 'files', retry: true, text: N('ההורדה נקטעה באמצע. אפשר לנסות שוב.') },
    timeout: { area: 'files', retry: true, text: N('ההורדה לקחה יותר מדי זמן. אפשר לנסות שוב.') },
    failed: { area: 'files', retry: true, text: N('ההורדה נכשלה. אפשר לנסות שוב.') },
    missing_file: {
      area: 'files',
      retry: true,
      text: N('הקובץ נמחק מהתיקייה. אפשר להוריד אותו שוב.'),
    },
    open_failed: { area: 'files', retry: true, text: N('אוצריא לא הצליחה לפתוח את הקובץ.') },
    cancelled: { area: 'files', retry: true, text: N('ההורדה בוטלה.') },
    missing_data: {
      area: 'files',
      retry: true,
      text: N(
        'פרטי הגיליון אינם זמינים כרגע (הקטלוג עדיין נטען, או שאין חיבור). אפשר לנסות שוב או לפתוח באתר המקור.',
      ),
    },
    forbidden_folder: {
      area: 'files',
      retry: false,
      text: N(
        'אוצריא אינה מאפשרת לבחור את התיקייה הזו (תיקיית מערכת או שורש כונן). בחרו תיקייה ייעודית, למשל תחת "מסמכים".',
      ),
    },
    pick_failed: { area: 'files', retry: true, text: N('בחירת התיקייה נכשלה.') },
    too_large: {
      area: 'files',
      retry: false,
      text: N('הקובץ גדול מדי לקריאה בתוסף. אפשר להוריד אותו ולפתוח בקורא של אוצריא.'),
    },
    // ---- רשת וקטלוג
    forbidden: { area: 'net', retry: false, text: N('הכתובת אינה ברשימת ההיתר של אוצריא.') },
    busy: { area: 'net', retry: true, text: N('אוצריא מגבילה את קצב הבקשות כרגע. ינסה שוב לבד.') },
    network: { area: 'net', retry: true, text: N('אין חיבור לרשת, או שהאתר אינו עונה.') },
    http: { area: 'net', retry: true, text: N('השרת החזיר שגיאה.') },
    bad_schema: {
      area: 'catalog',
      retry: false,
      text: N('הקטלוג בפורמט שהתוסף אינו מכיר. עדכנו את התוסף מהחנות של אוצריא.'),
    },
    bad_file: { area: 'catalog', retry: true, text: N('קובץ קטלוג פגום. ינסה שוב לבד.') },
    hash: {
      area: 'catalog',
      retry: true,
      text: N('קובץ קטלוג לא תואם לחתימה (מטמון ישן). ינסה שוב לבד.'),
    },
    // ---- ממשק
    screen_failed: { area: 'ui', retry: true, text: N('משהו השתבש בהצגת המסך הזה.') },
    dialog_failed: { area: 'ui', retry: true, text: N('משהו השתבש בפתיחת החלון.') },
    unsupported: {
      area: 'ui',
      retry: false,
      text: N('המארח אינו תומך ביכולת הזו, ולכן נעשה שימוש במסלול חלופי.'),
    },
  });

  const known = (code) => Object.hasOwn(CODES, code);

  /** טקסט למשתמש לקוד; קוד לא מוכר מקבל טקסט כללי (לא נשבר). */
  function text(code) {
    const entry = known(code) ? CODES[code] : CODES.failed;
    return A.I18n ? A.I18n.t(entry.text) : entry.text;
  }

  /** האם ניסיון חוזר עשוי לעזור. קוד לא מוכר: כן (שגיאה זמנית כנראה). */
  const retryable = (code) => (known(code) ? CODES[code].retry : true);

  const area = (code) => (known(code) ? CODES[code].area : 'files');

  const api = { CODES, known, text, retryable, area };
  A.Errors = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
