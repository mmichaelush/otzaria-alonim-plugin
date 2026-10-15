# בקשת allowlist מאוצריא

התוסף "עלוני שבת" (`com.otzaria-alonim`) פונה לרשת בשני מסלולים נפרדים, ולכן צריך שני סוגי ערכים
ב-`plugin_network_allowlist.txt` (ענף `dev` של `Otzaria/otzaria`). הצהרה ב-`network.allowlist` של
המניפסט אינה מספיקה בלי הערכים האלה: אוצריא חוסמת כתובת שאינה ברשימה הרשמית.

## לפתיחת ה-PR

כל שורה היא קידומת מדויקת, בלי `/` בסוף. הרשימה שבבלוק הבא מוכנה להדבקה בקובץ (כולל
הערות `#` קצרות לכל מקור); `plugin/test/manifest.test.js` מוודא שהיא זהה ל-`network.allowlist` שבמניפסט.

```text allowlist
# עלוני שבת (com.otzaria-alonim): קטלוג, מטא-דאטה בלבד (JSON). ענף data בריפו התוסף
https://raw.githubusercontent.com/mmichaelush/otzaria-alonim-plugin/data
# עלוני שבת: לדעת (קבצי PDF ותמונות ממוזערות)
https://ladaat.co/gilyonot/uploads
# עלוני שבת: תא שמע (קבצי PDF)
https://tashma.co.il/gilyonot/file
# עלוני שבת: תא שמע (תמונות ממוזערות)
https://tashma.co.il/gilyonot/thumb
# עלוני שבת: גיליוינעס (קבצי PDF ותמונות ממוזערות)
https://gilyoines.com/storage
# עלוני שבת: עלון עולם (קבצי PDF ותמונות ממוזערות)
https://alonolam.com/wp-content/uploads
```

## מה כל ערך משרת

| ערך | סוג | מה עובר | באיזה API |
|-----|-----|---------|-----------|
| `raw.githubusercontent.com/mmichaelush/otzaria-alonim-plugin/data` | **קטלוג** | קבצי JSON סטטיים (`manifest.json`, `series.json`, `weeks.json`, `recent.json`, `issues/*.json`) שנבנים ב-CI ומתפרסמים בענף `data`. אין בהם מידע על משתמשים | `network.fetchStream` (GET) |
| `ladaat.co/gilyonot/uploads` | **קבצים** + **תמונות** | קובצי ה-PDF של האתר, והתמונות הממוזערות שלהם (`…/files/*.pdf`, `…/thumbnails/*.png`) | `network.download` (לתיקייה שהמשתמש בחר), `<img>` |
| `tashma.co.il/gilyonot/file` | **קבצים** | קובצי PDF (`/gilyonot/file/<id>`) | `network.download` |
| `tashma.co.il/gilyonot/thumb` | **תמונות** | תמונה ממוזערת (`/gilyonot/thumb/<id>.png`) | `<img>` |
| `gilyoines.com/storage` | **קבצים** + **תמונות** | קובצי PDF ותמונות כריכה (`/storage/<שם>.pdf`, `.jpg`) | `network.download`, `<img>` |
| `alonolam.com/wp-content/uploads` | **קבצים** + **תמונות** | קובצי PDF ותמונות (`/wp-content/uploads/<שנה>/<חודש>/…`) | `network.download`, `<img>` |

הקידומות נבדקו מול `docs/SOURCES.md` (הנתיבים שהקטלוג מפרסם בפועל). הן ברמת הנתיב המינימלית
שהתוסף צריך, ולא דומיין שלם. דפי האתרים עצמם (`assets[].page`) נפתחים בדפדפן דרך `app.openUrl`, ולכן
אינם דורשים ערך ברשימה: התוסף מאמת בעצמו שהכתובת `https` ומדומיין מקור מוכר, ואוצריא מציגה אישור למשתמש.

## מה קורה בלי כל ערך (ירידה מדורגת)

התוסף נבנה כך שהעדר אישור אינו שובר אותו:

- **רק ערך הקטלוג מאושר:** הכול עובד חוץ מהורדה: חיפוש, סינון, סדרות, אוספים, פרטי גיליון. כל פעולת
  "קריאה" או "הורדה" שנחסמת (`error.forbidden`) נופלת ל"פתח באתר המקור" (`app.openUrl`), עם הסבר
  ברור למשתמש ובלי חלון שגיאה. תמונות ממוזערות פשוט אינן מוצגות.
- **ערך של מקור אחד חסר:** גיליונות המקור הזה נפתחים באתר; שאר המקורות ממשיכים להוריד. אם לגיליון יש
  עותקים בכמה מקורות, התוסף בוחר עותק שמותר להוריד.
- **ערך הקטלוג חסר:** הקטלוג אינו יורד. מי שכבר יש לו מטמון ממשיך לעבוד ממנו; למי שאין, המסך הראשון
  מסביר שהכתובת ממתינה לאישור. (זו הסיבה שערך הקטלוג הוא הראשון והחשוב.)

## פרטיות

אין טלמטריה. הבקשות לקטלוג הן GET בלבד, בלי כותרות מזהות. הבקשות לאתרי המקורות הן הורדת קובץ
שהמשתמש ביקש במפורש (או תמונה ממוזערת, כשהמשתמש הפעיל את האפשרות; כבויה כברירת מחדל), ומגיעות מהמחשב
שלו, כמו כניסה ישירה לאתר. התוסף אינו שולח לאף כתובת חיפושים, היסטוריית קריאה, רשימות או הגדרות.

## קישורים

- מאגר התוסף: <https://github.com/mmichaelush/otzaria-alonim-plugin>
- חוזה הקטלוג: `docs/CATALOG_FORMAT.md`; מצב המקורות: `docs/SOURCES.md`
- המניפסט: `plugin/manifest.json` (`network.allowlist`)
