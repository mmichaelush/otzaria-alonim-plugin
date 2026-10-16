# פיתוח ותחזוקה של הקטלוג

מדריך למי שמריץ, מדבג או מרחיב את `catalog/`. החוזה עצמו: `CATALOG_FORMAT.md`; המקורות: `SOURCES.md`;
הרקע: `ARCHITECTURE.md`.

## הרצה

```
cd catalog && npm ci                       # פעם אחת (תלות יחידה: @hebcal/core)
node build.mjs --out out                   # בנייה רגילה (incremental): רק החדש
node build.mjs --out out --prev <dir>      # ... ושומר את כל מה שנמצא בקטלוג הקודם
node build.mjs --out out --full --cache    # כל הארכיון; --cache שומר תשובות ב-catalog/.cache (פיתוח בלבד)
node build.mjs --out out --sources ladaat  # רק מקור אחד (השאר נשמרים מ---prev)
node build.mjs --out out --now 2026-10-15T09:00:00Z   # זמן קבוע: פלט זהה בייט בבייט
```

- **בלי `--prev`** בנייה רגילה מכילה רק את מה שהמחברים קראו עכשיו (tashma `/new`, שבועות אחרונים). ב-CI תמיד יש `--prev`.
- **סריקה מלאה של tashma** היא כ-800 בקשות (כ-9 דקות, כ-100MB). בלי `--cache` היא פוגעת באתר: הריצו אותה לעתים רחוקות.
- פלט: `manifest.json`, `series.json`, `weeks.json`, `weeks-archive.json`, `recent.json`, `issues/*.json`.
- בדיקות: `node --test "test/*.test.js"` מתוך `catalog/` (או `node --test "catalog/test/*.test.js"` מהשורש). **לא** `node --test test`: ב-Node 22 ומעלה תיקייה אינה מתפרשת. עובד על Node 22 ו-24.

## בדיקת נכונות: לוח ושיוך לשבועות

שני כלים בלי רשת, שמושווים להתייחסויות שאינן חולקות איתם קוד:

```
node tools/verify-calendar.mjs [--from 1800 --to 2300]   # לוח עברי, חגים, צומות, ר"ח, שבתות מיוחדות ופרשה (חו"ל וארץ ישראל)
node tools/audit-dates.mjs [--seed 1] [--sample 200]     # השבוע של כל עותק מול כותרת, תיקיות וזמן העלאה (משחזר מ-catalog/.cache)
node tools/audit-dates.mjs --examples title-parasha --src tashma --limit 30
```

- `verify-calendar` משווה: (א) תאריך עברי לכל יום מול `Intl` (`en-u-ca-hebrew`), הן לתוסף (`plugin/js/alonim-hebcal.js`) הן ל-Hebcal; (ב) מועדים
  מול כללים שנגזרו מתאריכי ICU (כולל "17 בתמוז, או 18 בו אם חל בשבת"); (ג) פרשה מול טבלאות KosherJava (`test/fixtures/parasha-oracle.json`: 17 סוגי שנה,
  חו"ל וארץ ישראל) ותכונות שחייבות להתקיים (בראשית אחרי שמחת תורה, דברים = שבת חזון, מסעי לפני דברים, רק שבעת הזוגות המותרים). נכשל (קוד 1) ומדפיס כל אי-התאמה.
  `test/calendar-crosscheck.test.js` מריץ אותו על 1950-2100. **1800-2300: אפס אי-התאמות** (16.10.2026).
- `audit-dates` מחליף את הרשת במטמון (החמצה במטמון היא שגיאה, לא בקשה). לכל עותק: האם התאריך הוא שורת לוח, השנה, הקריאה השמורה מול הלוח, ושלוש השוואות
  לכותרת (פרשה, שנה, חג) ולזמן ההעלאה, עם מזהה משלו (בלי `lib/parasha.mjs`). התוצאות והפירוש: `SOURCES.md` ("נכונות התאריכים"). "סומן" אינו "טעות": כותרת של שני שבועות,
  או שם סדרה שנראה כפרשה, מסומנים ויש לשפוט אותם (`--examples`).

## דיבוג: למה גיליון יצא כך?

```
node build.mjs --explain i_8c11d0e47a93 --cache     # גיליון לפי מזהה
node build.mjs --explain "שם משמעון" --cache          # סדרה לפי שם (או s_... לפירוט)
node build.mjs --explain "אסיפת נח לשליחה" --cache    # טקסט מכותרת קובץ
node build.mjs --explain https://tashma.co.il/gilyonot/101853 --cache
```

`--explain` מריץ את כל הצנרת (מהמטמון עם `--cache`) **בלי לכתוב דבר**, ומדפיס לכל עותק: הרמזים של המקור, הכותרת הגולמית,
מה נותח (פרשה, שנה, אירועים, מספר), **מי החליט על התאריך** (`source-date` מתיקיית תאריך, `week-label` משם שבוע, `parasha-year`,
`event-year`, `upload-time`) ושורת הלוח שנמצאה, ואז את החלטות האיחוד בקבוצה (אוחד עם מי ובאיזה ניקוד, או למה נשאר נפרד).

יומן ריצה: `--summary run.json` כותב JSON עם לכל מקור: סטטוס, הערה, משך, שגיאות רכות (יחידות שנכשלו בזמן שהסריקה המשיכה),
אחוזי זיהוי (פרשה, שנה, תאריך), ופירוט `how`; וגם גדלי קבצים, בקשות HTTP ואזהרות. `--verbose` מדפיס גם ניסיונות חוזרים, ו-`--quiet`
רק אזהרות וסיכום. כל ריצה מסתיימת בשורת סיכום לכל מקור.

## מבנה הקוד

| קובץ | תפקיד |
|------|-------|
| `build.mjs` | CLI ותיאום: מחברים, קטלוג קודם, העשרה, איחוד, כתיבה |
| `lib/pipeline.mjs` | שלבי הבנייה: `runSource`, `crawlAll`, `enrichAll`, `sourceEntries`, `manifestText` |
| `connectors/*.mjs` | מחבר לכל מקור: פונקציות ניתוח טהורות + `crawl` (השכבה היחידה שמבקשת מהרשת, דרך `lib/http.mjs`) |
| `lib/http.mjs` | הרשת: נימוס, robots, ניסיונות חוזרים, מטמון |
| `lib/parasha.mjs`, `lib/events.mjs`, `lib/calendar.mjs`, `lib/dates.mjs` | ניתוח כותרות, לוח עברי, אירועים, תרגום "שם שבוע" לתאריך |
| `lib/enrich.mjs` | RawIssue ← Item: סדרה, שבוע, כותרת (כאן טקסט ורמזים הופכים לעובדות) |
| `lib/merge.mjs` | איחוד עותקים לגיליונות וסדרות, מזהים |
| `lib/archive.mjs`, `lib/urls.mjs`, `lib/wire.mjs`, `lib/shards.mjs` | דגל archive, דחיסת URL וירושה, כתיבה ופיצול |
| `lib/prev.mjs` | הקטלוג הקודם ← Items (שימור, `cid` דביק) |
| `lib/explain.mjs` | `--explain` |
| `tools/` | `sanity.mjs` (מגן פרסום), `suggest-aliases.mjs`, `publish-data-branch.sh`, `verify-calendar.mjs`, `audit-dates.mjs` |

סוגי הנתונים המרכזיים מתועדים ב-JSDoc: `lib/types.mjs` (Asset, Issue, Series), `enrich.mjs` (RawIssue, Item), `calendar.mjs` (WeekRow),
`pipeline.mjs` (SourceResult).

## הוספת מחבר

1. `connectors/<id>.mjs` מייצא: `id`, `name`, `url`, `mode` (`catalog`), `urlSpec` (ראו `lib/urls.mjs`), ו-`crawl(ctx, {full})` שהוא
   generator של RawIssue. פונקציות הניתוח (`parse…`) טהורות: קלט JSON/טקסט, פלט רשומות, **בלי רשת**.
2. כל בקשה דרך `ctx.http` בלבד (`getJson`/`getText`). לא fetch ישיר. `Accept` וכותרות מיוחדות דרך האפשרויות.
3. כשל ביחידה אחת (תאריך, עמוד סדרה, שבוע) נתפס עם `softFail(ctx, 'יחידה', err)` (`connectors/util.mjs`): הסריקה ממשיכה והמקור נהיה `degraded`.
   כשל בבקשה הראשית פשוט נזרק: המקור `down`, והנתונים הקודמים נשמרים. `HostBlockedError` תמיד עוצר את המקור.
4. ודאו מבנה: `expectShape(cond, 'מה צפוי')` בפונקציות הניתוח, כדי ששינוי באתר ייתפס כשגיאה ברורה ולא כרשימה ריקה.
5. רישום ב-`connectors/index.mjs`, מקום ב-`SOURCE_ORDER` (`lib/merge.mjs`) ובמפת ההשהיות (`HOST_INTERVAL_MS` ב-`build.mjs`).
6. fixtures ובדיקות ב-`test/connectors.test.js`, ועדכון `docs/SOURCES.md` (ממשק, תחיליות URL, מגבלות, מה נבדק).
7. מקור שחוסם בקשות אוטומטיות **אינו מחבר**: לא עוקפים (ראו מדיניות נימוס).

## עדכון fixtures

הקבצים ב-`test/fixtures/` הם תשובות אמיתיות מוקטנות. כדי לעדכן:

1. שמרו תשובה חיה בנימוס (בקשה אחת, `User-Agent` של הפרויקט) לקובץ זמני **מחוץ לריפו**.
2. קצרו: השאירו 8 עד 15 פריטים מגוונים (שפות, שמות עם תווים מיוחדים כמו `[37]` או סימני RTL, פריט בלי שדה), מחקו שדות משתמש/אסימונים
   (למשל `booksAccessToken` בעמודי tashma) ובלי קבצי PDF.
3. עדכנו את הבדיקות שסופרות פריטים, והריצו `node --test`.
4. ב-`url-vectors.json` ו-`normalize-vectors.json` הסדר והערכים משותפים לתוסף: שינוי בהם מחייב לעדכן גם את `plugin/test`.

## מדיניות נימוס (חובה)

- זיהוי עצמי: `OtzariaAlonimCatalog/1 (+https://github.com/mmichaelush/otzaria-alonim-plugin)`. כיבוד `robots.txt`.
- עד 2 בקשות במקביל לדומיין והשהיה בין התחלות (0.5 עד 0.8 שניות). `Retry-After` מכובד. ניסיונות חוזרים עם backoff וג'יטר.
- `403` או `429` מתמשך: הדומיין "מתקרר" עד סוף הריצה; **אין עקיפה** (לא כותרות מזויפות, לא דפדפן headless, לא פתרון אתגר, לא התחברות).
- לא נוגעים בנקודות כתיבה/ניהול של אתרים (`admin`, `upload`, `delete`, `track` וכו'), ולא בחיפוש התוכן, בלי אישור המפעיל.
- אין לפנות לבעלי האתרים ואין לפרסם בלי בקשה מפורשת.
- פיתוח: השתמשו ב-`--cache`; בנייה מלאה רק כשצריך.

## טעויות נפוצות

| תסמין | סיבה | טיפול |
|-------|------|-------|
| `node --test test` נכשל ("Cannot find module") | תיקייה כארגומנט אינה נתמכת | `node --test "test/*.test.js"` |
| בנייה רגילה מציגה רק אלפי גיליונות | אין `--prev` | הוסיפו `--prev <קטלוג קודם>` |
| ה-commit בענף `data` אינו ריק כשלא השתנה דבר | משהו לא דטרמיניסטי (מפתחות, זמן) או `autocrlf` | `--now` קבוע; בדקו `diff -r` בין שתי ריצות; הסקריפט כבר מכבה autocrlf |
| tashma מחזיר 409 על עמוד סדרה | `X-Inertia-Version` חסר או ישן | נלקח מ-`/gilyonot` בתחילת הסריקה; בדקו שהדף עדיין מכיל `data-page` |
| `url round-trip failed` | URL מהמחבר אינו מוצפן במלואו | `safeUrl` ב-`enrich` מצפין; אם נכשל, מחבר מחזיר תו חריג שלא טופל |
| גיליון בשבוע לא נכון | כותרת עם שם פרשה לא נכון, שנה שגויה, או שבוע שבו לוח חו"ל וארץ ישראל שונים | `--explain` ובדקו "מי החליט"; `tools/audit-dates.mjs`; תיקון בכללי `parasha.mjs` או alias |
| מספר גיליון נקרא כפרשה ("גליון צו - ויחי" ← צו) | מספר בגימטריה אחרי "גליון" שזהה לשם פרשה (צו=96, נח=58, שלח=338) | `detectParashaNotIssueNumber` ב-`parasha.mjs`: כשיש פרשה אחרת בכותרת, המילה נקראת כמספר. "גליון צו" לבד נשאר פרשה |
| גיליון של ladaat בקריאה של חו"ל כשהכותרת אומרת "חקת" | קריאת חו"ל וארץ ישראל שונות באותה שבת | `applyCalendarRow` ב-`enrich.mjs` שומר את הקריאה שהכותרת נקבה (גם כשהתאריך מהמקור) |
| פרשה לא זוהתה | שם דו-משמעי (בא, שמות, דברים) בלי רמז | הכלל: דיוק לפני כיסוי. סדרה שבועית מקבלת קריאה מקלה (`relaxed`); אחרת הוסיפו רמז או וריאנט כתיב |
| חג מזוהה בגלל מסכת (שבועות, ראש השנה) | שם המסכת זהה לחג | `TRACTATE_EVENTS` ב-`parasha.mjs`: הוסיפו הקשר חדש לפי הצורך |
| שנה מופרכת (תשצט) | הכותרת מכילה אות-מספר שנראית כשנה | נדחות שנים מעל השנה הבאה; אחרת הצרו את `parseYearWord` |
| שתי סדרות לאותה הוצאה | שמות שונים בין מקורות | `node tools/suggest-aliases.mjs --catalog out`, והוסיפו ל-`data/aliases.json` |
| איחוד שגוי של שני גיליונות | אותה סדרה ואותו שבוע, בלי מספר ובלי הבדל בכותרת | `--explain`; הוסיפו `noMerge` או שפרו את חילוץ המספר/השאריות |
| שגיאות על `\` או `^` בפקודות shell בסקריפטים | מחרוזות עם backslash בכלי הקלד | כתבו קוד בקבצים, לא ב-heredoc |
| `catalogVersion` לא עולה | התוכן לא השתנה (זו התנהגות מכוונת) | heartbeat פעם ביממה; `--heartbeat-hours 0` לכפות |
| בדיקת publish נכשלת ב-Windows | `bash`/`git` חסרים ב-PATH | הריצו מ-Git Bash |

## פרסום

`tools/publish-data-branch.sh <out> <remote> [data]`: משווה למה שמפורסם; אם זהה אינו עושה דבר; אחרת יוצר commit יתום יחיד ודוחף ב-force
לענף `data` בלבד (מסרב ל-`main`/`master`). ב-CI נקרא מ-`.github/workflows/catalog.yml` אחרי `tools/sanity.mjs` (מסרב לקטלוג ריק או שאיבד
מעל 30% מהקודם). `test/publish.test.js` מוכיח את ההתנהגות מול ריפו bare מקומי. ה-workflow לא הורץ מעולם ב-GitHub: בהפעלה הראשונה בדקו
ידנית (`workflow_dispatch`). נבדק מקומית (16.10.2026): `actionlint` (גרסת WASM, בלי shellcheck) על שלושת הקבצים נקי, `bash -n` על כל צעדי `run`, כל הנתיבים קיימים, וסקריפט הפרסום
הורץ מול ריפו bare מקומי על הקטלוג המלא (commit יתום יחיד, והרצה שנייה "unchanged"). **הרצה ראשונה (אין ענף `data`) סורקת הכול (`--full`)** במקום לפרסם קטלוג חלקי; ב-GitHub Actions
(כתובות IP של מרכזי נתונים) ייתכן שמקורות יחסמו (`403`), ואז הם מסומנים `blocked` ולא עוקפים.
