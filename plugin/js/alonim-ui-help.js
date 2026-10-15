// עזרה (תחביר חיפוש, סמנטיקת המסננים, קיצורי מקלדת) והפעלה ראשונה קצרה. הטקסטים
// כאן הם מקור האמת למשתמש; המסמך `docs/USER_GUIDE.md` מתאר אותם בהרחבה.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const I18n = A.I18n;
  const { el } = Ui;
  const t = (text, vars) => I18n.t(text, vars);
  const N = (text) => text;

  /** דוגמאות תחביר: [שאילתה, הסבר]. השאילתות אינן מתורגמות (הן קוד). */
  const SYNTAX = [
    ['נח', N('מילה: בתחילת מילה בשם הסדרה, בכותרת, בפרשה, בשנה, בשפה או במקור. כמה מילים — כולן חייבות להופיע.')],
    ['"אסיפת גליונות"', N('ביטוי במרכאות: המילים ברצף.')],
    ['-שבת', N('מינוס: להחריג.')],
    ['נח OR וירא', N('OR: אחת מהחלופות.')],
    ['parasha:נח', N('פרשה לפי שם מלא (או סלאג, למשל noach). בלי שם מלא — תחילת מילה.')],
    ['event:חנוכה', N('שבת מיוחדת או חג.')],
    ['year:תשפ״ז', N('שנה עברית (אותיות או מספר). טווח: year:תשפ״ה-תשפ״ז או year:5785-5787.')],
    ['lang:yi', N('שפה (קוד או שם: yi, אידיש).')],
    ['source:לדעת', N('מקור (שם או מזהה).')],
    ['series:"שם הסדרה"', N('שם הסדרה בלבד.')],
    ['circle:בעלזא', N('חוג או קהילה.')],
  ];

  const SEMANTICS = [
    N('בתוך מסנן אחד (למשל כמה פרשות) מספיק שאחד הערכים מתאים: "או".'),
    N('בין מסננים שונים (פרשה וגם שפה), וגם בינם לבין הטקסט, כולם חייבים להתאים: "וגם".'),
    N('טווחים (תאריך, שנים, עמודים, גודל): גיליון בלי הערך (למשל בלי תאריך) אינו עובר טווח שהופעל.'),
    N('הספירה ליד כל ערך היא מה שיתקבל אם תבחרו בו, יחד עם שאר המסננים.'),
    N('גיליונות שהוסתרו לפי הכללים אינם נספרים, אלא אם בחרתם להציג אותם.'),
  ];

  /** גוף סעיף העזרה בהגדרות. */
  function body(app) {
    const shortcuts = A.Dialogs.SHORTCUTS;
    return [
      el('h3', { class: 'details-section' }, t('חיפוש')),
      el('dl', { class: 'facts syntax' }, SYNTAX.map(([query, text]) => [el('dt', {}, el('code', { dir: 'auto' }, query)), el('dd', {}, t(text))])),
      el('h3', { class: 'details-section' }, t('איך המסננים עובדים')),
      el('ul', { class: 'help-list' }, SEMANTICS.map((line) => el('li', {}, t(line)))),
      el('h3', { class: 'details-section' }, t('קיצורי מקלדת')),
      el('dl', { class: 'facts shortcuts' }, shortcuts.map(([key, label]) => [el('dt', {}, el('kbd', {}, key)), el('dd', {}, t(label))])),
      el('p', { class: 'setting-help' }, t('העלון מוצג באדיבות האתרים שבקרדיטים. התוסף אינו שולח דבר לשום מקום מלבד בקשות לקבצים הציבוריים של הקטלוג והעלונים.')),
    ];
  }

  /**
   * הפעלה ראשונה, קצרה: מה התוסף עושה, בחירת תיקייה (לא חובה) וקרדיטים. הסגירה
   * (בכל דרך) מסמנת שהוצגה.
   */
  function firstRun(app) {
    const dlg = Ui.dialog({
      title: t('ברוכים הבאים לעלוני שבת'),
      size: 'small',
      body: el(
        'div',
        { class: 'welcome' },
        el('p', { class: 'dialog-text' }, t('עלוני שבת מכמה אתרים, במקום אחד: חיפוש מיידי, מעקב אחרי סדרות, קריאה והדפסה.')),
        el('p', { class: 'dialog-text' }, t('כדי לשמור גיליונות להורדה בוחרים תיקייה פעם אחת. אפשר לדלג: הקריאה והחיפוש עובדים גם בלי.')),
        el('p', { class: 'setting-help' }, t('אין איסוף מידע: ההיסטוריה, החיפושים והרשימות נשארים אצלכם.')),
      ),
      actions: [
        Ui.button('text', t('קרדיטים'), () => { dlg.close('credits'); app.go('settings', { section: 'about' }); }),
        Ui.button('tonal', t('בחירת תיקייה'), () => { dlg.close('folder'); app.emit('need-folder', {}); }, { icon: 'folder_open_24_regular' }),
        Ui.button('filled', t('בואו נתחיל'), () => dlg.close('start'), { key: 'start' }),
      ],
      focus: '[data-key="start"]',
      onClose: () => app.state.setPref('welcomeSeen', true),
    });
    return dlg;
  }

  A.HelpUi = { body, firstRun, SYNTAX };
  if (typeof module === 'object' && module.exports) module.exports = A.HelpUi;
})(typeof self !== 'undefined' ? self : globalThis);
