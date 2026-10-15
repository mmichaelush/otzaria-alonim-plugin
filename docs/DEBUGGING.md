# דיבוג

מי שמקבל דיווח ("הגיליון לא נפתח", "הקטלוג לא מתעדכן", "התאריך לא נכון") צריך לדעת מה לבקש, איך לשחזר, ואיפה
לחפש. המסמך מסודר לפי השאלות האלה. מפת הקוד: `DEVELOPMENT.md`; ההחלטות: `ARCHITECTURE.md`.

## 1. מה מבקשים מהמשתמש

**הגדרות ← אבחון ← "העתקת הדיווח".** הטקסט נקי מנתיבי דיסק וכתובות מקומיות (`scrub` ב-`alonim-log.js`) ומכיל:

| שורה בדיווח | מה היא אומרת |
|-------------|--------------|
| `Alonim plugin 0.3.0 (he)` | גרסת התוסף ושפת הממשק |
| `Otzaria 0.9.99 / windows / he` | גרסת המארח, מערכת הפעלה ושפה; `/ offline` כשאין חיבור |
| `permissions:` | ההרשאות שהמשתמש אישר; חסרה הרשאה — ראו `permission` בטבלה |
| `capabilities:` | כל יכולת חדשה של המארח (`fetchFile`, `printFile`, תצוגה ישירה): `yes/no` ו**למה** (`version`, `old-version`, `unknown-version`, `learned`, `override`). `learned` = המארח אמר שיש ופלט `unknown_method`; `override` = "תאימות לאחור" דולקת |
| `catalog vN (תאריך), issues …, phase …` | גרסת הקטלוג שבזיכרון, כמה גיליונות, ומצב הסנכרון (`idle/checking/downloading/partial/error/offline`) והקוד אם נכשל |
| `catalog age: N min, last ok sync …` | גיל הקטלוג (לפי `generatedAt` במניפסט) ומתי הסנכרון התקין האחרון |
| `shards a/b, weeks, archive, id aliases` | כמה קבצי שנים נטענו מתוך החמים, שורות לוח, ולוח ארכיון (`none/available/loaded`) |
| `folder: ok/missing/revoked/error/none, files, queue, remote grants` | תיקיית ההורדות, כמה קבצים זוהו בה, תור הורדות, וכמה קבצים מרוחקים פתוחים במארח |
| `state read-only: true (failed: …)` | קריאת מצב משתמש נכשלה; התחום לא נכתב (כדי לא לדרוס מצב אמיתי) |
| `perf:` | חיפוש אחרון, בניית אינדקס, קריאת מטמון, סנכרון אחרון, ו-heap של הדף |
| `startup:` | אבני דרך מיצירת ה-App: `state` (מצב משתמש נטען), `shell` (הממשק צויר), `firstData` (הנתונים הראשונים), `firstSync` (הסנכרון הראשון הסתיים) |
| `storage:` | גודל כל תחום של מצב משתמש (תווי JSON) ומטמון הקטלוג מתוך המכסה |
| `warnings and errors by code:` | ספירת אזהרות ושגיאות ביומן **לפי קוד יציב** — המקום הראשון להסתכל |
| `last warnings and errors:` | האחרונות, עם שעה, קטגוריה וקוד |

היומן עצמו (טבעת של 500 אירועים) מסונן במסך האבחון לפי רמה (`debug/info/warn/error`) וקטגוריה (`app, host, catalog,
files, state, ui`). `info` ומעלה נכתבים גם ל-console של ה-WebView, ש-אוצריא מעתיקה ליומן שלה.

אם יש חריגה במסך: כרטיס "משהו השתבש במסך הזה" עם `קוד: screen_failed` ושם הפעולה; "העתקת פרטים לדיווח" מעתיקה את אותו דיווח.

## 2. קודי שגיאה

לכל כשל שהמשתמש רואה יש **קוד יציב** (`alonim-errors.js` הוא הרישום היחיד; `error-codes.test.js` מוודא שכל קוד
שהקוד יוצר רשום, ו-`debugging-doc.test.js` שכל קוד רשום כאן). ההחלטות בקוד נשענות על הקוד, לא על הטקסט. כשל ללא טיפול
ייעודי נעשה דרך `app.reportFailure(code, error)`: ביומן (אזהרה, או שגיאה לתקלה בתוסף עצמו) עם הקוד היציב והקוד
הגולמי של המארח ליד, ובממשק הודעה בעברית עם "קוד: …".

| קוד | תחום | חוזר? | סיבה אפשרית | מה לעשות |
|-----|------|-------|-------------|----------|
| `no_folder` | קבצים | לא | לא נבחרה תיקיית הורדות (ובמארח ישן גם קריאה דורשת אחת) | הגדרות ← תיקייה, או "בחירת תיקייה" בחלון |
| `blocked` | קבצים | לא | נתיב הקובץ אינו ב-`plugin_network_allowlist.txt` של אוצריא (`ALLOWLIST_REQUEST.md`), או המקור החזיר 401/403 | "פתח באתר המקור"; לבדוק שהאישור ניתן ושהנתיב זהה ל-`network.allowlist` |
| `no_direct_link` | קבצים | לא | המקור במצב `link` (אין כתובת קובץ), או כל העותקים מוסתרים בכללי סינון | "פתח באתר המקור"; לבדוק כללים |
| `permission` | קבצים | לא | אין לתוסף הרשאת קבצים/רשת | הרשאות התוסף באוצריא |
| `not_pdf` | קבצים | כן | התשובה אינה PDF (לרוב דף HTML של חומת התחברות או הגבלת קצב; המארח קובע סוג לפי סיומת, והתוסף בודק `%PDF-`) | לנסות שוב; אם חוזר — המקור חוסם |
| `truncated` | קבצים | כן | הקובץ שירד קטן ממחצית הגודל הצפוי (ניתוק באמצע) | לנסות שוב |
| `timeout` | קבצים | כן | `error.timeout` מהמארח (90 שניות לקובץ) | חיבור איטי: לנסות שוב |
| `failed` | קבצים | כן | כשל כללי; הקוד הגולמי של המארח ביומן (`files`) | לקרוא את היומן |
| `missing_file` | קבצים | כן | הקובץ נמחק מהתיקייה אחרי הסריקה | להוריד שוב |
| `open_failed` | קבצים | כן | `fs.openFolderFile` או קריאת ה-Blob נכשלו (מארח ישן) | לנסות שוב; בודקים שהתיקייה זמינה |
| `cancelled` | קבצים | כן | המשתמש ביטל | — |
| `missing_data` | קבצים | כן | האינדקס רזה (בלי כתובות): הכתובות נקראות מקובץ השרד, והוא אינו במטמון ואין רשת | להתחבר ולנסות שוב |
| `forbidden_folder` | קבצים | לא | אוצריא דחתה את התיקייה (תיקיית מערכת, שורש כונן) | לבחור תיקייה ייעודית |
| `pick_failed` | קבצים | כן | בחירת התיקייה נכשלה (קוד גולמי ביומן) | לנסות שוב |
| `too_large` | קבצים | לא | מעל 100MB ב-`fetchFile`, או מעל 150MB לצפיין | להוריד ולפתוח בקורא של אוצריא |
| `delete_failed` | קבצים | כן | מחיקת קובץ מהתיקייה נכשלה (נעול / כבר נמחק) | לרענן ולנסות שוב |
| `forbidden` | רשת | לא | כתובת הקטלוג חסומה ב-allowlist של אוצריא | הקטלוג השמור ממשיך לעבוד; לבדוק אישור |
| `busy` | רשת | כן | `error.rate_limited` מהמארח (הדלי של אוצריא: 50 קריאות, אסימון כל ~15ms בפועל) | התוסף ממתין וחוזר לבד; אם נשאר ביומן — קצב חריג |
| `network` | רשת | כן | אין חיבור, או האתר אינו עונה | לבדוק חיבור |
| `http` | רשת | כן | השרת החזיר שגיאה (5xx / 4xx אחר) | לנסות שוב מאוחר יותר |
| `bad_schema` | קטלוג | לא | `schema` במניפסט גדול ממה שהתוסף מכיר | לעדכן את התוסף |
| `bad_file` | קטלוג | כן | קובץ קטלוג שאינו מערך JSON תקין | ינסה שוב לבד |
| `hash` | קטלוג | כן | ה-sha256 לא תואם (מטמון CDN ישן) | ינסה שוב עם `?v=` (אוטומטי) |
| `cleanup_failed` | קטלוג | כן | ניקוי המטמון נכשל | לנסות שוב; לדווח |
| `cold_years_failed` | קטלוג | כן | חלק משרדי השנים הישנות לא נטענו | לבדוק חיבור ולנסות שוב |
| `screen_failed` | ממשק | כן | חריגה בציור מסך (באג) | "נסה שוב"; "העתקת פרטים לדיווח" |
| `dialog_failed` | ממשק | כן | חריגה בפתיחת חלון (באג) | לדווח עם היומן |
| `copy_failed` | ממשק | כן | `navigator.clipboard` ו-`execCommand` נכשלו | לסמן ולהעתיק ידנית |
| `open_url_failed` | ממשק | כן | `app.openUrl` נכשל או נדחה | להעתיק את הכתובת |
| `url_not_allowed` | ממשק | לא | הכתובת אינה מאתר מקור מוכר (אימות פנימי לפני `app.openUrl`) | — |
| `reader_timeout` | ממשק | כן | `library.refreshUserBooks`/`findBooks`/`openBook` לא ענו בזמן: אין ספרייה טעונה באוצריא | לפתוח את הספרייה באוצריא ולנסות שוב |
| `reader_failed` | ממשק | כן | כשל אחר בפתיחה בקורא (קוד גולמי ביומן) | לנסות שוב |
| `print_failed` | ממשק | כן | `ui.printFile` נכשל בקוד שאינו `forbidden` (קוד גולמי ביומן) | להדפיס מהצפיין |
| `unsupported` | ממשק | לא | המארח אינו תומך ביכולת (`error.unknown_method` / `error.unsupported`); נעשה מסלול חלופי | אין צורך; הטבלה ב"אבחון" אומרת למה |

## 3. תסמין ← סיבה

| תסמין | איפה לחפש | סיבה נפוצה |
|-------|-----------|------------|
| "הקטלוג חסום · הנתונים השמורים" | `catalog` ביומן: `forbidden` | אין אישור `plugin_network_allowlist.txt` ל-`raw.githubusercontent.com/<repo>/data` |
| "הסנכרון נכשל · הנתונים השמורים", `phase partial` | `catalog` ביומן, `failed` > 0 | קובץ קטלוג אחד נכשל (`hash`/`network`); הניסיון החוזר הבא אחרי 1/5/15 דקות |
| הקטלוג לא מתעדכן | `catalog age` | ה-CDN של GitHub מחזיק 5 דקות; ה-workflow רץ כל 3 שעות; `catalogVersion` עולה רק כשהתוכן השתנה (heartbeat פעם ביממה) |
| גיליון בשבוע/פרשה לא נכונים | `catalog/tools/audit-dates.mjs`, `build.mjs --explain` | כותרת מבלבלת (מספר בגימטריה מול שם פרשה), קריאת ארץ ישראל מול חו"ל; ראו `CATALOG_DEV.md` |
| PDF לא מוצג (מסגרת ריקה) | "הצגה חלופית" בסרגל, `capabilities` | במארח ישן: Blob; במארח חדש: iframe ישיר שנחסם — "הצגה חלופית" עוברת ל-Blob. מחוץ ל-Windows/macOS אין צפיין מובנה (`unsupported`) |
| Esc לא סוגר את הצפיין | — | המיקוד ב-iframe של ה-PDF (ממקור אחר, האירועים אינם מגיעים לתוסף); לחצו על "חזרה לרשימה" או על כפתור בסרגל ואז Esc |
| "הדפסה" לא פותחת מסך | `capabilities` (`printFile`), יומן `ui` | מארח ישן: דיאלוג עם הנחיות; מארח חדש שדורש מחווה: כפתור "הדפסה" ללחיצה |
| "פתח בקורא של אוצריא" נתקע/נכשל | `reader_timeout` | אין ספרייה טעונה (`library.refreshUserBooks` נתקע 45+ שניות); או התיקייה אינה תיקייה אישית באוצריא (`not_indexed`) |
| מועדפים/סימוני קריאה נעלמו בין חלונות | `state` | שני חלונות של אוצריא על אותו מצב: נשמר באיבוד מיקוד ונקרא מחדש בקבלת מיקוד; חלון שנשאר ברקע לא ראה שינוי |
| `error.rate_limited` ביומן `host` | `host` debug | פרץ קריאות; הדלי של אוצריא "צוק" (50, ‏~15ms). `runtime` ממתין ומנסה שוב |
| איטיות או זיכרון גבוה | `perf:`, `shards a/b` | 123 אלף גיליונות: ראו `docs/PERFORMANCE.md`; `heap` מעל 350MB חריג |
| "התוסף פועל רק מתוך אוצריא" | — | `index.html` נפתח ישירות בדפדפן (אין `window.Otzaria`); להשתמש בתצוגה המקדימה (סעיף 4.1) |

## 4. לשחזר

### 4.1 תצוגה מקדימה בדפדפן (הדרך המהירה)

`tools/preview` בונה את `plugin/index.html` האמיתי עם SDK מדומה (`fake-sdk.js`) וקטלוג מקומי, ומפעיל אותו ב-Chrome/Edge
דרך CDP (בלי תלויות):

```bash
node tools/preview/build-preview.mjs [--large]            # tools/preview/out/preview.html (--large: 30K גיליונות)
node tools/preview/build-preview.mjs --catalog catalog/out # preview-real.html: הקטלוג האמיתי (123 אלף)
node tools/preview/eval.mjs "page=all&scenario=blocked" "window.__alonimApp.catalog.status"   # ביטוי JS + יומן + שגיאות
node tools/preview/shot.mjs "page=all" out.png 1000x820    # צילום
```

הפרמטרים בכתובת (`preview.html?today=2026-10-15&…`) ב-`DEVELOPMENT.md`. התרחישים שמדמים כשל:

| `scenario=` | מדמה |
|-------------|------|
| `offline`, `slow`, `blocked`, `bad-schema`, `rate-limit` | רשת: אין חיבור, איטית, allowlist חסום, `schema` עתידי, `error.rate_limited` כל כמה קריאות |
| `download-blocked`, `download-html`, `no-folder-permission`, `folder-gone` | הורדה: נחסמה, החזירה HTML, אין הרשאת תיקייה, התיקייה נעלמה |
| `fetchfile-blocked`, `fetchfile-html`, `fetchfile-html-pdfmime` | `network.fetchFile`: נחסם / HTML תחת `.pdf` (גם עם mime של PDF) |
| `legacy-host` (או `host=legacy`) | אוצריא 0.9.98: בלי `fetchFile` ו-`printFile` |
| `print-cancel`, `print-gesture`, `print-gesture-first`, `print-slow` | מסך ההדפסה: ביטול, מארח שדורש מחווה (אחרי הראשונה / בראשונה), מסך פתוח 300ms |
| `reader-permission`, `reader-hang`, `reader-nolibrary` | הקורא של אוצריא: הרשאה כבויה, הרענון נתקע, אין ספרייה |

בדף: `window.__alonimApp` (ה-App: `index`, `state`, `catalog`, `files`, `caps`, `log`, `timings`) ו-`window.__sdk`
(הקריאות שהתוסף עשה: `calls`, `printed`, `fetchedFiles`, `downloads`, `revoked`, `fileTokens`…). סינון באג: בדיקה ב-
`filters.test.js` על `mini()`, או `node --test plugin/test/filter-matrix.test.js` (כשל מדפיס את המסנן המדויק).
`npm run smoke` מריץ את כל המסכים והתרחישים (`SMOKE_PARALLEL=4` מקצר ל-2 דקות).

### 4.2 שרת QA מקומי + אוצריא אמיתית (בלי allowlist)

```bash
tools\qa\start-qa.cmd                                  # שרת על 127.0.0.1:39811 (קטלוג אמיתי, קבצים מועברים מהמקור בלחיצה)
node tools/qa/make-variant.mjs C:\q\alonim-qa --name "עלונים (בדיקה)" --no-probe
```

העותק (`com.otzaria-alonim.qa`) מחליף כתובות לשרת המקומי ומשתמש ב-`network.localhost`. **המוצר אינו פונה ל-localhost**
(`qa-variant.test.js`). אריזה: ב-Git Bash `tar` הוא GNU tar והחבילה לא תיפתח; יש להשתמש ב-`C:\Windows\System32\tar.exe
--format zip -c -f x.otzplugin manifest.json index.html css js i18n icon` (המניפסט בשורש הארכיון, בלי `./`). התקנה:
אוצריא ← כלים ← "+" והקלדת נתיב קצר (נתיבים ארוכים מאבדים תווים בבורר הקבצים). לשחזור תקלות ב-QA: `/qa/mode?down=503|reset|hang`,
`/qa/root?dir=<קטלוג>` (החלפת קטלוג בשרת רץ), `/qa/wins` ו-`/qa/exec?win=<id>` (הרצת JS בחלון מסוים).

בדיקה חיה: אוצריא נייד (`portable.marker` ליד ה-exe) כדי שלא לגעת בהתקנה; היא מופע יחיד, ולכן סוגרים את הרגילה לפני ופותחים
אחרי. בילד debug כל ה-WebView של התוספים ריק (`external_texture`): משתמשים ב-`flutter build windows --release`.

### 4.3 הקטלוג והתאריכים

```bash
node catalog/tools/verify-calendar.mjs                 # לוח עברי, מועדים ופרשה מול ICU ו-KosherJava, 1800-2300
node catalog/tools/audit-dates.mjs [--seed N]          # השבוע של כל עותק מול כותרות ותיקיות המקור (מהמטמון, בלי רשת)
node catalog/tools/audit-dates.mjs --examples title-parasha --src tashma --limit 30
node catalog/build.mjs --explain i_8c11d0e47a93 --cache # למה גיליון יצא כך
```

## 5. כתיבת קוד שקל לדבג

- כל כשל שמגיע למשתמש עובר דרך קוד ברישום (`alonim-errors.js`) ו-`app.reportFailure`; לא `toast` עם טקסט חופשי.
- `log.warn('מה קרה', error)` (קטגוריה מ-`app.log.scoped(...)`): `error.code` נכנס לשדה `code`. לא בולעים חריגה בלי שורה ביומן
  (`debug` מספיק לכשל צפוי כמו "אין Range").
- הבטחה שאיש אינו ממתין לה — `.catch(...)` עם יומן; ב-`catalog` `sync()` אינו נדחה לעולם.
- פעולה שמחזיקה משאב מהמארח (`fs.openFolderFile`, `network.fetchFile`) משחררת אותו (`files.releaseFile`).
- מדידה: `app.stamp('שם')` לאבן דרך חדשה בהפעלה; `perf.mjs` לתקציבים (`PERFORMANCE.md`).
