# מקורות

מצב כל מקור כפי שנבדק ב-**15.10.2026** (בדיקות חיות מהמחשב של הפיתוח, ב-fetch של Node בלבד, בנימוס:
זיהוי עצמי, מקביליות 2, השהיה בין בקשות). האתרים משתנים בלי הודעה; מחבר ששובר מסומן
ב-`sources[].status` ואינו מפיל את הבנייה. המספרים כאן הם מבנייה מלאה (`--full`) מה-15.10.2026.

כללי אזרחות לכל המקורות (`catalog/lib/http.mjs`): `User-Agent: OtzariaAlonimCatalog/1
(+https://github.com/mmichaelush/otzaria-alonim-plugin)`, קריאת `robots.txt` וכיבודו (404 = מותר; 5xx = אסור),
עד 2 בקשות במקביל לדומיין עם השהיה של 0.5 עד 2 שניות בין התחלות, `Retry-After`, backoff עם jitter.
`403` מרגיע את הדומיין עד סוף הריצה, `429` אחרי המתנה סבירה עושה זאת גם, ואין שום ניסיון לעקוף חסימה,
אתגר, התחברות או הגבלת קצב.

## תחיליות URL לבקשת allowlist מאוצריא

כל ה-URL בקטלוג הם `https:` מוחלטים, באחוזי-קידוד. מה שנדרש כדי שהתוסף יוריד ויציג, **לפי מה שנבדק**:

| מקור | קבצי PDF (`assets[].url`) | תמונות ממוזערות (`assets[].thumb`) | דף האתר (`assets[].page`, ל-`app.openUrl`) |
|------|---------------------------|--------------------------------------|---------------------------------------------|
| `ladaat` | `https://ladaat.co/gilyonot/uploads/<YYYY-MM-DD>/files/<שם>.pdf` | `https://ladaat.co/gilyonot/uploads/<YYYY-MM-DD>/thumbnails/<שם>.<n>.png` | `https://ladaat.co/gilyonot/view/<id>` |
| `tashma` | `https://tashma.co.il/gilyonot/file/<id>` | `https://tashma.co.il/gilyonot/thumb/<id>.png` | `https://tashma.co.il/gilyonot/<id>` |
| `gilyoines` | `https://gilyoines.com/storage/<שם>.pdf` | `https://gilyoines.com/storage/<שם>.jpg` או `<שם>.pdf.jpg` (גיליונות קבועים ישנים) | `https://gilyoines.com/` (אין דף לכל גיליון) |
| `alonolam` | `https://alonolam.com/wp-content/uploads/<YYYY>/<MM>/<שם>.pdf` | `https://alonolam.com/wp-content/uploads/<YYYY>/<MM>/pdf-thumb-<id>.jpg` | `https://alonolam.com/%d7%92%d7%9c%d7%a8%d7%99%d7%94/` (הגלריה) |
| `beinenu` | אין (מצב קישור) | אין | `https://beinenu.com/alonim/` |

תחיליות מינימליות לרשימה: `ladaat.co/gilyonot/uploads/`, `tashma.co.il/gilyonot/file/`,
`tashma.co.il/gilyonot/thumb/`, `gilyoines.com/storage/`, `alonolam.com/wp-content/uploads/`. הדפים נפתחים בדפדפן
(`app.openUrl`) ולכן דורשים רק אימות הדומיין בתוסף. הקטלוג עצמו (`raw.githubusercontent.com/mmichaelush/otzaria-alonim-plugin/data/`)
הוא ערך נפרד.

**אחסון בקטלוג (דחיסה):** ה-URL שבטבלה הם מה שמתקבל אחרי פענוח; בקבצי הקטלוג הם נשמרים דחוסים, לפי `sources[].urlBase` ו-`sources[].urlTemplates` במניפסט (ראו `docs/CATALOG_FORMAT.md`, "דחיסת URL"). ההגדרות בפועל (15.10.2026):

| מקור | `urlBase` | `urlTemplates` |
|------|-----------|-----------------|
| `ladaat` | `https://ladaat.co/gilyonot/uploads/` | `page`: `https://ladaat.co/gilyonot/view/{ext}` |
| `tashma` | `https://tashma.co.il/gilyonot/` | `url`: `file/{ext}`, `page`: `{ext}`, `thumb`: `thumb/{ext}.png` (לכן בנכס של tashma אין שדות URL כלל) |
| `gilyoines` | `https://gilyoines.com/storage/` | `page`: `https://gilyoines.com/` |
| `alonolam` | `https://alonolam.com/wp-content/uploads/` | `page`: `https://alonolam.com/גלריה/` |

**נבדק (HEAD, 15.10.2026, דגימה אחת לכל סוג בכל מקור):** כל ה-PDF, התמונות והדפים שבטבלה החזירו `200` בלי הפניה (`redirect: manual`)
עם `Content-Type` מתאים (`application/pdf`, `image/png`/`image/jpeg`, `text/html`). **לא נבדק:** תמיכה ב-`Range`/`resume`,
הורדה מלקוח Dart של אוצריא (כותרות, עוגיות), הגנת hotlinking/Referer, מגבלות קצב על הורדת קבצים, ושכל תמונה ממוזערת קיימת
(נבדקה דגימה; נתיב התמונה נגזר מהמקור כפי שהוא). ב-`tashma` שדה `thumbnailLink` שהאתר מחזיר מצביע לפעמים לדומיין אחר
(`gilyonot.jewishoffice.co.il`); אנחנו לא משתמשים בו אלא תמיד ב-`/gilyonot/thumb/<id>.png` של tashma.

## `ladaat` — לדעת (`https://ladaat.co/gilyonot/`)

- **סטטוס:** `catalog`. **מספרים (בנייה מלאה):** 21,656 עותקים, תאריכי שבת 2025-09-06 עד 2026-10-31 (שבתות ו-`2026-09-21` יום כיפור).
- **ממשק:** `GET /gilyonot/api/files?name=&language=&category=&date=YYYY-MM-DD&sort=&offset=&limit=500` (JSON:
  `files[{id,name,language,category,downloads,uploaded_at,file_path,thumbnail_path}]`, `hasMore`). `date` הוא תאריך השבת
  **או החג** (יום כיפור בתאריך החג עצמו). בלי `date` מוחזר רק השבוע הנוכחי. רשימת השבועות האחרונים: `<select id="filter-date">`
  בדף הבית (9 שבועות כולל עתידיים). דפי שבועות ישנים לא מופיעים בשום רשימה, ולכן ב-`--full` נבדקים כל תאריכי השבת והחג של
  שלוש השנים האחרונות; בפועל הארכיון מתחיל סביב ספטמבר 2025.
- **שדות שבשימוש:** `name` = שם הסדרה; המספר שבסוגריים מרובעים בשם הקובץ (`[37]-…`) = מזהה הסדרה במקור (`sources[].ext`);
  `language` (שם עברי של שפה) ו-`category` (חוג, ל-`circle`); `uploaded_at` ל-`added`; התאריך מתיקיית הקובץ ל-`date`.
- **מגבלות:** אין מספר עמודים, גודל או מספר גיליון. הורדות `/gilyonot/download/<id>` סופרות הורדה ולכן לא בשימוש; משתמשים בנתיב
  הקובץ הסטטי. `robots.txt` ריק.
- **לא נבדק:** מגבלת קצב מעבר ל-0.7 שניות בין בקשות; שינוי מבנה ה-API; מזהי החוגים (`<select id="filter-category">`) אינם נקראים.

## `tashma` — תא שמע (`https://tashma.co.il/gilyonot`)

- **סטטוס:** `catalog`. **מספרים:** 95,649 עותקים ב-793 סדרות (האתר מדווח `indexed_count` ≈ 89,208), מ-5751 (תשנ"א) עד היום.
- **ממשק (Laravel + Inertia):**
  - `GET /gilyonot/new` (`Accept: application/json`): 254 הקבצים האחרונים עם `object_key` (`gilyonot/<סדרה>/<תיקייה>/<קובץ>`),
    `page_count`, `createdTime`, `views`. זה מה שהבנייה **הרגילה** קוראת.
  - `GET /gilyonot/list`: תיקיות הסדרות.
  - `GET /gilyonot/g/<סדרה>` עם כותרות Inertia (`X-Inertia: true`, `X-Requested-With: XMLHttpRequest`, `X-Inertia-Version` מדף
    `/gilyonot`): **כל** התיקיות והקבצים של סדרה בבקשה אחת (עד 6.4MB לסדרה הגדולה). זו הסריקה המלאה: 793 בקשות, כ-100MB, כ-9 דקות
    ב-0.5 שניות בין בקשות. הכותרות הן אלה שהדפדפן של האתר שולח בניווט רגיל.
  - `/gilyonot/file/<id>` (PDF), `/gilyonot/thumb/<id>.png`, `/gilyonot/<id>` (דף).
  - `robots.txt`: `Disallow:` ריק, ו-sitemap `https://tashma.co.il/sitemap-gilyonot.xml` (נקרא רק בבדיקה; לא בשימוש כרגע).
  - לא נוגעים ב-`admin/*`, `publisher/*`, `sendMail`, `api-internal` ובחיפוש התוכן (נשמר לעתיד, באישור המפעיל).
- **מבנה:** תיקיית סדרה מכילה תיקיות חופשיות: שנה (`תשפ"ז`), אך גם `0 כל הגליונות פר' בא תשפ''ו`, `36 בחוקותי` ועוד. השנה והפרשה נגזרות
  משם הקובץ ומשם התיקייה (`contextTitles`). הסדרה היא תיקיית-העל; ב"אסיפת גליונות" נמצאים מאות פרסומים שונים כקבצים נפרדים, והם נשארים
  בסדרה הזו.
- **זיהוי:** שנה עברית זוהתה ב-91.8% מהקבצים, פרשה ב-58.6%, תאריך שבת ב-60.5%. מעל 37 אלף קבצים נשארים בלי תאריך (חומר שאינו שבועי,
  או שם קובץ בלי פרשה), והם נכנסים לשרד של שנתם (או ל-`timeless` בלי שנה).
- **מגבלות:** בסריקה המלאה אין `page_count` (רק ב-`/new`). בסריקה רגילה (`/new`) אין גילוי של קבצים ישנים שנוספו או נמחקו; זה תפקיד
  ה-`--full` (ה-sitemap מכיל `lastmod` לכל סדרה ויכול לשמש לסריקה חלקית בהמשך).
- **לא נבדק:** `Range` בקבצים; שינוי גרסת Inertia באמצע ריצה (הכותרת נלקחת פעם אחת בתחילת הסריקה); קבצים שאינם PDF (מדולגים).

## `gilyoines` — גיליוינעס (`https://gilyoines.com`)

- **סטטוס:** `catalog`. **מספרים:** 13,656 עותקים; שבועות 191 (תצוה-פורים, פברואר 2026) עד 226 (לך לך, כבר פורסם), כ-380 לשבוע, ועוד 15
  חומרים קבועים (זמירות, תפילות; `timeless`).
- **ממשק:** `GET /api/home` (נוכחי + קבוע + 9 השבועות האחרונים ב-`weeks`), `GET /api/home/getGilyoines/<weekId>/<site_view_id>` לכל שבוע
  (`weekId` הוא ה-`id` הפנימי ב-`weeks`, למשל 224 = נח תשפ"ז; `site_view_id` מגיע מ-`/api/home`). מזהים 1 עד 190 ריקים, ו-225/227+ ריקים
  כרגע (שבוע 225 לא קיים). **הבנייה הרגילה** קוראת את השבוע הנוכחי פחות 2 ועד ארבעה קדימה; `--full` מ-191.
- **שבוע:** שם השבוע בעברית (`week_hebrew_name`) מכיל לפעמים שתי פרשות (חו"ל וארץ ישראל, בכל סדר: `קרח - שלח`, `(בלק (חקת-בלק`) או חג
  (`שבועות - נשא`). התאריך נגזר מהשם ומזמן ההעלאה (חציון `created_at` של השבוע) מול לוח השנה, ומיושר ל-`date` של ladaat.
- **שדות:** `pdf`, `cover_image`, `pages`, `created_at`, `gilyon_type_*` (שם הסדרה), `language_hebrew_name`, `popular`. אין מספר גיליון
  (`hebrew_number` אינו מספר גיליון) ואין דף לכל גיליון: `page` הוא דף הבית.
- **מגבלות:** הארכיון מתחיל במרץ 2026. `robots.txt`: `Disallow:` ריק.
- **לא נבדק:** האם מזהה `site_view_id` פג תוקף; גיליונות שנמחקו (לא מזוהים).

## `alonolam` — עלון עולם (`https://alonolam.com`)

- **סטטוס:** `catalog`, מטא-דאטה דלה. **מספרים:** 329 קבצי PDF (מתוך 348 פריטים; הרשימה כוללת גם `docx`), רק אוספי החודש הנוכחי.
- **ממשק:** `GET /wp-json/gallery/v1/list` בלבד: `[{id,name,originalName,url,thumb,sizeBytes,ext,views,downloads}]`. **אסור לגעת** בנקודות
  upload/delete/sync/track/counters/bulk של אותו API, והקוד לא פונה אליהן (יש בדיקה).
- **נגזר משם הקובץ:** הסדרה (מה שנשאר אחרי הסרת פרשה, שנה ומספר), הפרשה, השנה והמספר. התאריך: פרשה + שנה מהשם, ובלעדיה חודש ההעלאה
  (מתוך `/wp-content/uploads/YYYY/MM/`) מכריע איזה מחזור. 78% מהקבצים קיבלו פרשה ותאריך. רמת הוודאות נשמרת ב-`rawMeta.confidence`
  פנימי בלבד. **לכן** סדרה שנגזרה משם קובץ גנרי ("עלון נח 9") נקראת "(ללא שם סדרה)" ואינה מתאחדת.
- **מגבלות:** אין תאריך העלאה (`added` = מועד הריצה הראשונה שראתה את הקובץ), אין מספר עמודים. `robots.txt`: חסום רק `wp-admin` ותיקיות
  woocommerce.

## `beinenu` — בינינו (`https://beinenu.com/alonim/`)

- **סטטוס:** `link` (**חסום**). Cloudflare מחזיר 403 לבקשה אוטומטית. המחבר שולח בקשה אחת מנומסת (ועוד `robots.txt`), ואם נחסם רושם
  `status: "blocked"` והערה בעברית ("האתר מגביל גישה אוטומטית; הקישור פותח את האתר"), בלי רשומות. **אסור לעקוף**: לא User-Agent מזויף, לא
  דפדפן headless, לא פתרון אתגר. נשאר ב-`sources[]` עם `mode: "link"` כדי שהתוסף יציג קישור. אם המפעיל יאשר גישה, ייבנה מחבר.
- **נבדק 15.10.2026:** 403 (`Server: cloudflare`).

## איכות הזיהוי והאיחוד (בנייה מלאה, 15.10.2026)

| מקור | עותקים | פרשה | שנה עברית | תאריך שבת |
|------|--------|------|-----------|-----------|
| ladaat | 21,656 | 88.1% | 99.8% | 99.8% (מהמקור) |
| tashma | 95,649 | 58.6% | 91.8% | 60.5% |
| gilyoines | 13,656 | 90.2% | 99.9% | 99.9% (משם השבוע) |
| alonolam | 329 | 78.4% | 79.3% | 78.4% |

סך הכול 123,001 גיליונות ב-2,029 סדרות (1,656 עבריות, 187 אידיש, 148 אנגלית, השאר שפות אחרות). 544 סדרות ממקורות מרובים. בטווח
2026-02 עד 2026-10 (שבו ל-gilyoines יש נתונים) 31% מעותקי ladaat, 40% מעותקי gilyoines ו-30% מעותקי tashma חולקים גיליון עם
מקור אחר. דגימה ידנית (שתי דגימות של 20 איחודים כל אחת, ב-15.10.2026): לא נמצא איחוד שגוי. מתוך 40 זוגות דומים שלא אוחדו, אחד הוא מועמד סביר לאיחוד (שם סדרה שונה באיות/בתוספת, ראו להלן) והשאר סדרות שונות.

מקרים ידועים שאינם מתאחדים (בכוונה): אותו שם בשפות שונות; שם סדרה שונה באיות או בתוספת (`המאור שבתורה` מול
`המאור שבתורה - שבת אורה`: מועמד ל-`catalog/data/aliases.json`); שני קבצים של אותו מקור בשבוע אחד; מספרי גיליון או מספרי עמודים
שסותרים; ושוויון בין מועמדים. בשבועות שבהם לוח ארץ ישראל שונה מלוח חו"ל (כשישה בשנה) כותרת עם פרשה בודדת מתוארכת לפי חו"ל אם יש שם
קריאה כזו, ואחרת לפי ארץ ישראל.

## הרצה

```
cd catalog && npm ci
node build.mjs --out out                       # רגיל (incremental); בלי --prev מקבלים רק את החדש
node build.mjs --out out --prev <dir-קודם>      # שומר את כל מה שנמצא קודם
node build.mjs --out out --full --cache        # סריקת כל הארכיון; --cache שומר תשובות ב-catalog/.cache (פיתוח)
node --test "test/*.test.js"   # מתוך catalog/; מהשורש: node --test "catalog/test/*.test.js"
```
