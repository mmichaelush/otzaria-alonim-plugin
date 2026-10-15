# חוזה הקטלוג (`schema: 1`)

הקטלוג הוא קבצי JSON סטטיים שה-CI בונה ומפרסם בענף `data`. התוסף רק קורא אותם. זה
החוזה היחיד בין `catalog/` ל-`plugin/`: שינוי בו מחייב לעדכן את שני הצדדים, ואם הוא
שובר תאימות גם את `schema`.

כתובת הבסיס: `https://raw.githubusercontent.com/mmichaelush/otzaria-alonim-plugin/data/`.

## קבצים

| קובץ | תוכן | מתי נטען |
|------|------|----------|
| `manifest.json` | גרסה, מקורות ובריאותם, רשימת השרדים עם גיבוב | תמיד ראשון, ובכל סנכרון |
| `series.json` | כל הסדרות | אחרי המניפסט, כשהגיבוב השתנה |
| `weeks.json` | שבתות ופרשות, משנה אחת אחורה ועד שנה קדימה | אחרי המניפסט |
| `recent.json` | הגיליונות של כ-6 השבועות האחרונים מכל המקורות | ציור ראשון, לפני כל שרד אחר |
| `issues/<hy>.json` | גיליונות של שנה עברית (`5787`), מפוצלים ל-`<hy>-<k>` כשחוצים 3MB | ברקע, או לפי בקשה |
| `issues/timeless.json` | חומר בלי שנה ופרשה (זמירות, תפילות, חוברות) | ברקע |

**כללי כתיבה:** UTF-8, בלי BOM, מפתחות ממוינים, שדה `null` או ריק מושמט, מערכים
ממוינים יציבה (אותו קלט, אותו פלט, בייט בבייט). כך ה-commit בענף `data` ריק כשלא
השתנה דבר.

## `manifest.json`

```json
{
  "schema": 1,
  "catalogVersion": 1791834000,
  "generatedAt": "2026-10-15T07:40:00Z",
  "minPluginVersion": "0.1.0",
  "sources": [
    {
      "id": "ladaat",
      "name": "לדעת",
      "url": "https://ladaat.co/gilyonot/",
      "mode": "catalog",
      "status": "ok",
      "checkedAt": "2026-10-15T07:39:00Z",
      "lastOkAt": "2026-10-15T07:39:00Z",
      "issueCount": 2345,
      "note": ""
    }
  ],
  "files": {
    "series":  { "path": "series.json",  "sha256": "…", "bytes": 91234, "count": 1180 },
    "weeks":   { "path": "weeks.json",   "sha256": "…", "bytes": 8000 },
    "recent":  { "path": "recent.json",  "sha256": "…", "bytes": 230000, "count": 640 }
  },
  "shards": [
    { "id": "5787", "path": "issues/5787.json", "sha256": "…", "bytes": 1200000,
      "count": 3100, "from": "2026-09-12", "to": "2026-10-24", "addedMax": "2026-10-14T20:03:05Z" }
  ]
}
```

- `catalogVersion`: שניות Unix של הבנייה. עולה בלבד. התוסף מדלג על סנכרון כשהוא זהה.
- `sources[].mode`: `catalog` (אנחנו מושכים רשימה) או `link` (אין גישה אוטומטית, רק
  קישור לאתר; ראו `beinenu`).
- `sources[].status`: `ok`, `degraded` (חלק מהפריטים נכשלו), `blocked` (חסום, למשל
  Cloudflare; לא עוקפים), `down`, `disabled`. `note` הוא משפט בעברית למשתמש.
- `sha256` של כל קובץ הוא של התוכן הבינארי כפי שנשמר. התוסף משווה אותו למה ששמר ורק
  אז מוריד מחדש.
- `shards[].from/to`: טווח `date` בשרד (ללא `null`), לדילוג על שרדים כשמסננים לפי תאריך.

## `series.json`

מערך. סדרה היא עלון לאורך שנים, מאוחד בין מקורות.

```json
{
  "id": "s_3fa91c02b1",
  "title": "אסיפת גליונות",
  "aliases": ["אסיפת גליונות - ליקוט"],
  "previousIds": [],
  "lang": "he",
  "circle": "כללי",
  "kind": "weekly",
  "sources": [ { "src": "ladaat", "ext": "37", "title": "אסיפת גליונות" } ],
  "issueCount": 214,
  "first": "2022-09-24",
  "last": "2026-10-17"
}
```

- `id`: `s_` + 10 הקס ראשונים של sha1 של `canonicalKey` (ראו נרמול). יציב בין ריצות.
  כשהמפתח הקנוני משתנה בכוונה, הישן נכנס ל-`previousIds` והתוסף מעביר מועדפים.
- `lang`: `he` `yi` `en` `de` `fr` `es` `ru` `nl` `it` `pt` `fa` `ar` או `other`.
- `circle`: החוג או הקהילה כפי שהמקור מציין (כרגע רק `ladaat` מספק), מחרוזת חופשית.
- `kind`: `weekly` (לפי פרשה) או `timeless`.

## `weeks.json`

```json
[ { "date": "2026-10-17", "hy": 5787, "parasha": ["noach"], "parashaIL": ["noach"],
    "label": "נח", "event": null } ]
```

שבת אחת בכל שורה, ממוינת עולה. `parasha` לחו"ל, `parashaIL` לישראל (שונים בכמה
שבתות בשנה). `event` הוא שבת מיוחדת או חג שיש להציג לצד הפרשה (`rosh-hashana`,
`shabbat-shuva`, `sukkot`, `shemini-atzeret`, `chanukah`, `shabbat-hagadol`,
`shabbat-zachor` וכו'), או `null`. `label` הוא התווית לתצוגה, בעברית, ל"חו"ל" אלא אם
`parashaIL` שונה, ואז `label` נושא את שתיהן ("מטות · מטות־מסעי").

מזהי פרשות (`parasha`): הסלאגים של Hebcal באנגלית באותיות קטנות ומקפים:
`bereshit noach lech-lecha vayera chayei-sara toldot vayetzei vayishlach vayeshev
miketz vayigash vayechi shemot vaera bo beshalach yitro mishpatim terumah tetzaveh
ki-tisa vayakhel pekudei vayikra tzav shemini tazria metzora achrei-mot kedoshim emor
behar bechukotai bamidbar nasso behaalotcha shlach korach chukat balak pinchas matot
masei devarim vaetchanan eikev reeh shoftim ki-teitzei ki-tavo nitzavim vayeilech
haazinu vezot-haberakhah`. בשבת משולבת זה מערך של שתיים.

## גיליון (בשרדים וב-`recent.json`)

```json
{
  "id": "i_8c11d0e47a93",
  "series": "s_3fa91c02b1",
  "title": "אסיפת גליונות",
  "no": 21,
  "date": "2026-10-17",
  "hy": 5787,
  "parasha": ["noach"],
  "event": null,
  "lang": "he",
  "pages": 24,
  "added": "2026-10-14T20:03:05Z",
  "assets": [
    {
      "src": "ladaat",
      "ext": "23569",
      "url": "https://ladaat.co/gilyonot/uploads/2026-10-17/files/[37]-אסיפת-גליונות-נח.pdf",
      "page": "https://ladaat.co/gilyonot/view/23569",
      "thumb": "https://ladaat.co/gilyonot/uploads/2026-10-17/thumbnails/[37]-אסיפת-גליונות-נח.1.png",
      "bytes": 25225710,
      "pages": 24,
      "downloads": 513
    }
  ]
}
```

- `id`: `i_` + 12 הקס של sha1 של `seriesId|hy|parashaSlug(s)|no|variant`. יציב.
- `title`: כותרת לתצוגה לגיליון הזה (ללא פרשה ושנה כשאפשר לחלץ אותן). הכותרת המקורית
  נשמרת ב-`assets[].rawTitle` (ראו להלן). **לא** מוחקים מידע: כל מה שנגזר ניתן לשחזור.
- `date`: תאריך השבת ש**הגיליון שייך לה**, לא תאריך ההעלאה. נגזר מהמקור (תיקיית
  תאריך ב-ladaat, week ב-gilyoines) או מפרשה + שנה (`weeks.json`). `null` כשאין ודאות.
- `hy`: שנה עברית כמספר (5787). `null` רק ב-`timeless`.
- `parasha`: מערך סלאגים (ריק או מושמט אם אין). `event`: ראו `weeks.json`.
- `no`: מספר גיליון/שנה/שבוע כפי שמופיע בכותרת, אם זוהה. `null` אם לא.
- `added`: ISO UTC. הכי מוקדם שהגיליון נראה, או תאריך ההעלאה במקור. משמש ל"חדש".
- `assets`: לפחות אחד. כל אחד קובץ אחד אצל מקור אחד. הסדר הוא העדפת ברירת מחדל
  (איכות ואמינות מקור), לא סדר זמן.

שדות `asset`: `src` (חובה), `ext` מזהה במקור (חובה), `url` קישור ישיר ל-PDF (חסר אם אין
הורדה אוטומטית), `page` דף הגיליון באתר המקור (חובה כש-`url` חסר), `thumb`, `bytes`,
`pages`, `downloads`, `rawTitle` (כותרת/שם הקובץ כפי שהם במקור), `sha256` (רק אם חושב).

**כפילות בין מקורות:** אותו גיליון בכמה מקורות הוא רשומה אחת עם כמה `assets`. איחוד רק
כשיש ודאות (אותה סדרה, אותה פרשה ואותה שנה, ושם/מספר/גודל שאינם סותרים). כשיש ספק
משאירים שתי רשומות. דיוק לפני כיסוי; איחוד שגוי גרוע מכפילות. אין מחיקה של עותק מקור.

## נרמול (חייב להיות זהה בקטלוג ובתוסף)

`normalizeKey(s)`: NFKC, הסרת ניקוד וטעמים (U+0591–U+05C7), מקף/מקף מפריד/גרשיים/
גרש/מרכאות מכל סוג והלוכסנים הופכים לרווח או נמחקים (לפי הטבלה בקוד), אותיות סופיות
לרגילות, אותיות לטיניות לקטנות, צמצום רווחים. מחזיר מחרוזת להשוואה בלבד, לעולם לא
לתצוגה. מימוש יחיד ב-`catalog/lib/normalize.mjs`, והעתק זהה (עם בדיקת זהות) ב-
`plugin/js/alonim-normalize.js`. `canonicalKey` של סדרה הוא `normalizeKey` של הכותרת
אחרי הסרת מילים כלליות ("עלון", "גליון", "גיליון", "שבועי", "לשבת", "פרשת", מספרים,
שנים, שמות פרשות), ואחרי החלת `catalog/data/aliases.json`.

## יציבות ועקרונות

- **התוסף חייב לעמוד בשדות לא מוכרים** (להתעלם) ובשדה חסר מותר (לא להיכשל).
- שינוי תואם-אחורה (שדה חדש) לא מעלה `schema`. הסרה/שינוי משמעות כן, והתוסף מציג
  "יש גרסה חדשה של התוסף" כש-`schema` גבוה ממה שהוא מכיר, וממשיך עם המטמון.
- כל מקור הוא מחבר נפרד: כשל באחד מסמן אותו ב-`sources[].status` ואינו מפיל את הבנייה.
  שרד שלא נבנה מחדש נשמר מהריצה הקודמת (לא נמחקים נתונים בגלל תקלה זמנית).
