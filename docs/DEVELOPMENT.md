# פיתוח ותחזוקה של התוסף

למי שמתקין, בודק, מתקן או מרחיב את התוסף (`plugin/`). החלטות והסיבות: `ARCHITECTURE.md`;
חוזה הקטלוג: `CATALOG_FORMAT.md`; למשתמש: `USER_GUIDE.md`.

## הפעלה וכלי פיתוח

התוסף עצמו הוא HTML/CSS/JS רגיל: אין build ואין תלויות. כלי הפיתוח (בדיקות, פורמט, lint, טיפוסים)
נמצאים בשורש הריפו (`package.json`) ואינם נכללים בחבילת התוסף.

```bash
npm install                    # פעם אחת: prettier, eslint, typescript (כלי פיתוח בלבד)
npm test                       # בדיקות יחידה (node:test), כולל מטריצת הסינון
npm run smoke                  # כל מסך ותרחיש בדפדפן אמיתי (Edge/Chrome headless), נכשל על שגיאת קונסול
npm run perf                   # תקציבי ביצועים בדפדפן (קוד יציאה 1 כשתקציב מופר)
npm run check                  # syntax + format:check + lint + typecheck + test
npm run format                 # prettier (printWidth 100)
```

לפני קומיט (AGENTS.md): `npm run check`, `npm run smoke`, והוולידטור הרשמי של החנות:

```bash
node <path-to>/otzaria-plugin-validator/src/cli.js plugin --app-version 0.9.98 --fail-on-warnings --publish false
```

(ב-CI: `Otzaria/otzaria-plugin-validator@v1`, ראו `.github/workflows/ci.yml`.)

**הקטלוג האמיתי בבדיקות.** `plugin/test/filter-matrix.test.js` רץ גם על `catalog/out` כשהוא קיים
(בריפו או באחד מהוריו), או לפי `ALONIM_CATALOG=<תיקייה>`; אחרת הוא מדלג על החלק הזה ורץ על קטלוג
סינתטי מגוון. `ALONIM_MATRIX_N` ו-`ALONIM_MATRIX_REAL_N` קובעים כמה מקרים אקראיים.

## מפה: שכבות וקבצים (`plugin/js`)

הכל נרשם על `window.Alonim` (סקריפטים קלאסיים; סדר הטעינה ב-`index.html` וב-`test/helpers/load.js`).
שכבות לא תלויות בשכבות שמעליהן; רק קבצי `alonim-ui*.js`, `alonim-theme.js` ו-`alonim-main.js` נוגעים ב-DOM.

| שכבה | קבצים | תפקיד |
|------|-------|-------|
| תשתית | `i18n`, `log`, `runtime`, `capabilities`, `errors`, `boundary` | תרגום; יומן עם רמות וקטגוריות; SDK עם מגביל קצב; יכולות מארח; קודי שגיאה; גבול שגיאות |
| טהור (נתונים) | `core`, `hebcal`, `weeks`, `normalize`, `filters`, `rules`, `storage`, `bulk`, `diagnostics` | כלים בלי DOM: תאריכים ולוח, זהות מפתחות, מודל מסננים, כללים, חישובי אחסון, פעולות מרובות, אבחון |
| אינדקס | `index`, `index-search` | עמודות בזיכרון; חיפוש, קבוצות סינון, `facetCounts`, קיבוץ, העברת מזהים |
| אחסון ורשת | `state-schema`, `state`, `catalog`, `files` | מצב משתמש ב-`storage.*`; סנכרון קטלוג ל-`fs` הפרטי; תיקיית הקבצים, תור, קריאה והדפסה |
| בקר | `app` | חיבור השכבות, ניווט, פעולות, בחירה מרובה |
| ממשק | `ui` (רכיבים), `ui-overlays` (דיאלוג, תפריט, toast), `ui-vlist` (גלילה וירטואלית), `ui-cards`, `ui-shell`, `ui-week`, `ui-weekpicker`, `ui-dates`, `ui-all`, `ui-filters`, `ui-select`, `ui-browse` (סדרות), `ui-mine`, `ui-detail`, `ui-viewer`, `ui-settings` (+`-rules`, `-backup`), `ui-storage`, `ui-help`, `ui-diagnostics` | מסכים וחלונות |

הוספת מרכיבים נפוצים:

- **מחרוזת בממשק:** `t('עברית')` ליטרל אחד, ותרגום ב-`i18n/en.js` (הבדיקה `i18n.test.js` נכשלת על חסר ועל מיותר). טקסט שנבחר בזמן ציור — `N('…')` בהגדרה ו-`t(…)` בציור.
- **מסך:** מחלקה עם `mount/refresh/destroy` ב-`alonim-ui-*.js`, רישום ב-`SCREENS` (`alonim-ui-shell.js`). גבול השגיאות עוטף אותו אוטומטית.
- **מסנן:** קבוצה ב-`alonim-index-search.js` (`_compile`), מפתח ב-`alonim-filters.js`, בקרה ב-`alonim-ui-filters.js`, ומקרה ב-`helpers/oracle.js` (`groups`). מטריצת הסינון נכשלת אם אחד מהם חסר.
- **קוד שגיאה:** רשומה ב-`alonim-errors.js` (טקסט, תחום, ניסיון חוזר); `error-codes.test.js` מוודא שכל קוד שהקוד יוצר רשום.
- **יכולת מארח:** רשומה ב-`FEATURES` של `alonim-capabilities.js`, שימוש דרך `caps.call(…)` עם נפילה לאחור, ורישום ב-`test/fixtures/sdk-methods.json` (`optional`).

## איך מדבגים

**בתוך אוצריא.** הגדרות ← **אבחון**: גרסת המארח והיכולות (ולמה כל אחת זמינה או לא), מצב הקטלוג והקבצים,
והיומן עם סינון לפי רמה וקטגוריה; "העתקת הדיווח" מעתיקה טקסט בלי נתיבי דיסק וכתובות מקומיות. כשל
בציור מסך מציג כרטיס "משהו השתבש" עם "נסה שוב" ו"העתקת פרטים לדיווח". כל כשל נרשם עם קוד
(`[forbidden]`, `[screen_failed]`, …). ב-DevTools של ה-WebView: `window.__alonimApp` הוא ה-App
(`app.index`, `app.state`, `app.catalog`, `app.files`, `app.caps`, `app.log`).

**מחוץ לאוצריא (תצוגה מקדימה).** `tools/preview` בונה דף עם SDK מדומה וקטלוג מקומי, ומפעיל אותו בדפדפן
אמיתי דרך CDP (בלי תלויות). כתובת התצוגה: `tools/preview/out/preview.html?today=2026-10-15&page=all`.
פרמטרים: `page=week|all|series|mine|settings`, `section=`, `minetab=`, `query=`, `series=N`, `open=N`,
`details=N`, `print=1`, `nofolder=1`, `mode=dark`, `lang=en`, `scale=1.5`, `welcome=1`, `host=legacy`,
`scenario=` (`offline`, `blocked`, `slow`, `bad-schema`, `rate-limit`, `download-blocked`,
`download-html`, `no-folder-permission`, `reader-permission`, `folder-gone`, `legacy-host`,
`fetchfile-blocked`, `fetchfile-html`, `print-cancel`).

```bash
node tools/preview/build-preview.mjs [--large]           # בונה את הדף (--large: 30,000 גיליונות)
node tools/preview/shot.mjs "page=all" out.png 1000x820   # צילום אחד; SHOT_EVAL="…" מריץ קוד לפני הצילום
node tools/preview/screenshots.mjs [dir]                  # כל המסכים, בהיר וכהה (SHOTS=…, MODES=light, FLAT=1)
node --expose-gc tools/preview/measure-real.mjs <catalog/out>   # זמן בנייה, זיכרון וחיפוש על הקטלוג האמיתי
```

**שחזור באג בסינון.** כתבו מקרה ב-`filters.test.js` על קטלוג קטן (`mini()`), או הריצו את המטריצה
(`node --test plugin/test/filter-matrix.test.js`): כשל מדפיס את המסנן המדויק (JSON) לשחזור.

**שרת QA מקומי.** `tools/qa` (`node tools/qa/qa-server.mjs`, `tools/qa/make-variant.mjs`) הוא כלי לבדיקה
חיה באוצריא אמיתית **בלי** אישורי allowlist: שרת ב-`127.0.0.1:39811` שמגיש את הקטלוג והקבצים, ועותק
של התוסף (`com.otzaria-alonim.qa`) שמחליף כתובות. **המוצר אינו פונה ל-localhost ואינו מזכיר את
השרת**; `qa-variant.test.js` ו-`capabilities.test.js` שומרים על ההפרדה.

## מטריצת גרסאות המארח

| יכולת | אוצריא 0.9.98 | אוצריא ≥ 0.9.99 |
|-------|---------------|------------------|
| קריאה בצפיין | הורדה ל-`_קריאה` ← `fs.openFolderFile` ← fetch ← Blob ← `iframe` (דורש תיקייה) | `network.fetchFile` ← `iframe` ישיר (בלי הורדה ובלי תיקייה) |
| הדפסה מהצפיין | `iframe.print()` (נחסם) ← הנחיה ופתיחה בקורא של אוצריא | `ui.printFile({ token })`, בלחיצה טרייה |
| הדפסה מרובה | אין (הכפתור לא מוצג) | דיאלוג ברצף: "הדפסה ברצף" / "הדפס הבא" |
| הורדה לתיקייה | `network.download` | ללא שינוי (פעולה נפרדת) |
| זיהוי | — | גרסה ≥ 0.9.99 + תפיסת `error.unknown_method` / `error.unsupported` |

`minAppVersion` נשאר 0.9.98. בדיקה בשני המסלולים: `host=legacy` / `scenario=legacy-host` בתצוגה,
ו-`host-paths.test.js` ביחידות; ב-אבחון אפשר להפעיל "תאימות לאחור" גם מול מארח חדש.

## מוסכמות

- **אבטחה ופרטיות:** טקסט נכנס ל-DOM רק דרך `textContent` (אין `innerHTML`; נאכף ב-`ui-contract.test.js` וב-eslint);
  אין טלמטריה, ואין בקשת רשת מלבד `network.*` לקטלוג ולקבצים; היסטוריה וחיפושים נשארים במכשיר ולא נכללים בייצוא.
- **קריאה שנכשלה אינה מצב ריק:** תחום שהקריאה שלו נכשלה אינו נכתב עד שקריאה חוזרת מצליחה.
- **עיצוב:** רק משתני ערכת הנושא ו-`em`; אין `style` inline לתוכן (רק CSSOM); `design.test.js` והוולידטור אוכפים.
- **טיפוסים:** `npm run typecheck` (tsc, `checkJs`) על כל `plugin/js`; הטיפוסים הציבוריים (`Item`, `WeekRow`,
  `FilterSpec`, `SearchContext`) ב-`tools/plugin-types.d.ts` (ההגדרה: `tools/tsconfig.plugin.json`, מחוץ לחבילת התוסף).
- **קומיטים:** קטנים; עברית ב-docs, אנגלית בקוד ובהודעות commit.

## רשימת בדיקה לגרסה

1. `npm run check`, `npm run smoke`, `npm run perf`, והוולידטור.
2. `plugin/manifest.json` (`version`) = `PLUGIN_VERSION` ב-`alonim-core.js` (נבדק).
3. `docs/ALLOWLIST_REQUEST.md` זהה ל-`network.allowlist` במניפסט (נבדק).
4. עדכון `CHANGELOG.md` וצילומי המסך במדריך (`docs/img`, `FLAT=1 MODES=light`).
5. בדיקה חיה באוצריא (ראו הרשימה בסוף `CHANGELOG.md` לגרסה).
