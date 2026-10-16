# עלוני שבת — תוסף לאוצריא

מרכז עלונים אחד בתוך [אוצריא](https://github.com/Otzaria/otzaria): חיפוש מיידי, עיון לפי שבוע וסדרה, קריאה בצפיין
פנימי, הורדה והדפסה של עלוני שבת מארבעה אתרים, עם מעקב אחרי סדרות, מועדפים, אוספים, היסטוריה וכללי סינון. עובד גם בלי
רשת (מהמטמון), בעברית ובאנגלית, ואינו שולח דבר על המשתמש לשום מקום.

**מצב:** גרסה 0.3.1 (בטא), בפיתוח. התוסף לא פורסם בחנות, בקשת ה-allowlist לאוצריא עוד לא נשלחה, ו-GitHub Actions של הקטלוג לא רץ
מעולם. רישיון: [GPL-3.0](LICENSE).

> צילומי מסך: `docs/img/` (מדריך למשתמש) ו-`docs/img/store/` (לדף החנות, 1280px, בהיר וכהה, וצר); נוצרים מהתוסף עצמו: `node tools/preview/screenshots.mjs`.

## התקנה

- **מהחנות של אוצריא:** כלים ← תוספים ← "עלוני שבת" (אחרי פרסום).
- **מחבילה:** אוצריא ← כלים ← "+" ← בחירת קובץ `.otzplugin` (המניפסט בשורש הארכיון). אריזה: `docs/DEBUGGING.md` §4.2.
- **נדרש:** אוצריא 0.9.98 ומעלה. יכולות נוספות (קריאה בלי הורדה, הדפסה במסך ההדפסה של אוצריא) מזוהות לבד ופועלות מ-0.9.99.
- **הרשאות:** רשת (קטלוג וקבצים), קריאת תיקיית ההורדות שבחרתם, פתיחת קישורים, וספרייה/קורא של אוצריא (פתיחה בקורא).
  שום דבר אינו נשלח החוצה; פירוט: `docs/ALLOWLIST_REQUEST.md`.

מדריך למשתמש: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## איך זה בנוי (עמוד אחד)

```
 אתרי המקור (4)                      GitHub Actions (כל 3 שעות)              אוצריא
 ladaat · tashma · gilyoines ─────►  catalog/  מחברים → נרמול → איחוד ─►  ענף data  ──►  plugin/  (HTML/CSS/JS, בלי build)
 alonolam            (נימוס, robots)          JSON סטטי, מגובב, מפוצל לשרדים   │           אינדקס בזיכרון · חיפוש · צפיין · מצב משתמש
                                                                              │
 קבצי ה-PDF עצמם ◄────────────────────────────── ישר מהמקור (לא דרך GitHub) ─┘  network.fetchFile / network.download
```

- **קטלוג סטטי, לא שרת.** `catalog/` (Node 22, ESM) סורק את המקורות בנימוס (זיהוי עצמי, `robots.txt`, מקביליות 2, בלי עקיפת חסימות),
  מנרמל כותרות לפרשה ושבוע (לוח עברי מ-Hebcal), מאחד עותקים רק כשיש ודאות, וכותב קבצי JSON לענף `data`. התוסף רק קורא אותם
  (דומיין אחד ב-allowlist). חוזה: [docs/CATALOG_FORMAT.md](docs/CATALOG_FORMAT.md).
- **תוסף דק.** `plugin/`: אינדקס עמודות בזיכרון ל-123 אלף גיליונות, מסננים ("או" בתוך מסנן, "וגם" ביניהם) עם ספירות חיות, גלילה
  וירטואלית (עד כ-60 כרטיסים ב-DOM), מצב משתמש ב-`storage.*`. הארכיטקטורה והסיבות: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **מארח חדש וישן.** כל יכולת חדשה של אוצריא נבדקת לפני שימוש, ויש מסלול ישן לכל אחת (Blob, הורדה לתיקייה, הדפסה מהקורא).
- **נבדק.** כ-250 בדיקות לתוסף ו-115 לקטלוג, מטריצת סינון מול סינון נאיבי על הקטלוג האמיתי, הצלבת הלוח מול ICU ו-KosherJava (1800-2300),
  smoke בדפדפן אמיתי לכל מסך ותרחיש כשל, ותקציבי ביצועים ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)).

## פיתוח

```bash
npm install && npm --prefix catalog install
npm run check              # syntax + format + lint + typecheck + בדיקות התוסף
npm run test:catalog       # בדיקות הקטלוג
npm run smoke              # כל המסכים בדפדפן אמיתי (SMOKE_PARALLEL=4)
npm run perf               # תקציבי ביצועים
```

| מסמך | נושא |
|------|------|
| [AGENTS.md](AGENTS.md) | כללי עבודה (גם לסוכני AI): קריאה לפני כל שינוי |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | מפת הקוד, כלים, מוסכמות, רשימת בדיקה לגרסה |
| [docs/DEBUGGING.md](docs/DEBUGGING.md) | מה לבקש מהמשתמש, קודי שגיאה, תסמין ← סיבה, שחזור |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | תקציבים ומדידות |
| [docs/CATALOG_DEV.md](docs/CATALOG_DEV.md) · [CATALOG_FORMAT.md](docs/CATALOG_FORMAT.md) · [SOURCES.md](docs/SOURCES.md) | הקטלוג: הרצה, חוזה, מקורות ונכונות תאריכים |
| [docs/HOST_API_PROPOSAL.md](docs/HOST_API_PROPOSAL.md) · [ALLOWLIST_REQUEST.md](docs/ALLOWLIST_REQUEST.md) | מה התוסף מבקש מאוצריא |
| [CHANGELOG.md](CHANGELOG.md) | יומן שינויים |

## קרדיטים

- **העלונים** שייכים למחבריהם ולמפרסמים, ומוצגים באדיבות האתרים [לדעת](https://ladaat.co/gilyonot/),
  [תא שמע](https://tashma.co.il/gilyonot), [גיליוינעס](https://gilyoines.com) ו[עלון עולם](https://alonolam.com). התוסף מקשר אליהם
  ומוריד קובץ רק כשהמשתמש מבקש; הקטלוג עצמו אינו מכיל קבצים.
- **לוח עברי ופרשות:** [`@hebcal/core`](https://github.com/hebcal/hebcal-es6) (הקטלוג); בבדיקות — `Intl` (ICU) וטבלאות סוגי השנה של
  [KosherJava](https://github.com/KosherJava/zmanim) (LGPL-2.1, כנתונים בלבד, דרך `kosher_dart`).
- **אייקונים:** [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) (MIT), באותה צורה שבה אוצריא משתמשת בהם.
- נבנה עבור [אוצריא](https://github.com/Otzaria/otzaria) לפי מפרט בעל הפרויקט.
