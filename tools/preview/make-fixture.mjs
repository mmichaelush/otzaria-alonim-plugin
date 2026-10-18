// קטלוגים לבדיקה, בפורמט docs/CATALOG_FORMAT.md:
//   (א) קטן ריאלי: כ-80 גיליונות, 12 סדרות, 4 מקורות, 3 שפות, פרשת נח תשפ"ז.
//   (ב) סינתטי גדול: 30,000+ גיליונות (ובדיקות ביצועים: --size 50000).
//   (ג) `--catalog <dir>`: קטלוג אמיתי שנבנה ב-catalog/out.
// הפלט: tools/preview/out/fixture-{small,large,real}.js (`window.__FIXTURE__`).
//   node tools/preview/make-fixture.mjs [--large] [--size N] [--catalog dir]
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const { buildFiles, DEFAULT_SOURCES } = require('../../plugin/test/helpers/catalog-files.js');
const { makeCatalog } = require('../../plugin/test/helpers/fixture.js');
globalThis.Alonim = globalThis.Alonim || {};
require('../../plugin/js/alonim-i18n.js');
require('../../plugin/js/alonim-hebcal.js');
require('../../plugin/js/alonim-core.js');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

/** כל הקבצים תחת תיקייה, כ-`{ path: text }`. */
function readDir(dir) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json'))
        files[relative(dir, full).replaceAll('\\', '/')] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return files;
}

const ANCHOR = { date: '2026-10-17', hy: 5787, slug: 'noach' };

/** לוח השבועות האמיתי של הקטלוג (5786-5788), כולל שורות חג באמצע השבוע. */
function weeksFixture() {
  return JSON.parse(
    readFileSync(join(here, '..', '..', 'plugin', 'test', 'fixtures', 'weeks-real.json'), 'utf8'),
  );
}

const SERIES = [
  ['אסיפת גליונות', 'he', 'כללי', 'ladaat', 24],
  ['עלון שבת', 'he', 'כללי', 'tashma', 20],
  ['פרפראות לחכמה', 'he', 'חסידי', 'ladaat', 18],
  ['שערי הפרשה', 'he', 'ליטאי', 'gilyoines', 14],
  ['מעיין השבוע', 'he', 'כללי', 'alonolam', 12],
  ['אור לישרים', 'he', 'ליטאי', 'tashma', 10],
  ['דבר השבוע', 'he', 'חסידי', 'ladaat', 10],
  ['קול הפרשה', 'he', 'כללי', 'tashma', 8],
  ['דער אידישער בלאט', 'yi', 'חסידי', 'tashma', 8],
  ['שבת שלום', 'yi', 'חסידי', 'gilyoines', 6],
  ['Torah Weekly', 'en', 'כללי', 'gilyoines', 8],
  ['Shabbos Table', 'en', 'כללי', 'alonolam', 6],
];

function smallCatalog() {
  const weeks = weeksFixture();
  const shabbatRows = weeks.filter((w) => w.shabbat !== false);
  const noachIndex = shabbatRows.findIndex((w) => w.date === ANCHOR.date);
  const series = SERIES.map(([title, lang, circle, src], i) => ({
    id: 's_' + (0x3fa91c02b1 + i * 7919).toString(16).slice(0, 10),
    title,
    aliases: [],
    previousIds: [],
    lang,
    circle,
    kind: 'weekly',
    sources: [{ src, ext: String(37 + i), title }],
    issueCount: 0,
    first: '2023-01-07',
    last: '2026-10-17',
  }));
  const issues = [];
  const sources = ['ladaat', 'tashma', 'gilyoines', 'alonolam'];
  let n = 0;
  series.forEach((s, si) => {
    const total = SERIES[si][4];
    for (let k = 0; k < total; k++) {
      // השבוע הנוכחי תחילה, ואז אחורה: כל סדרה מקבלת את השבוע הנוכחי.
      const week = shabbatRows[noachIndex - k];
      if (!week) break;
      const slug = week.parasha[0] || week.event || 'shabbat';
      const primary = sources[(si + k) % 4];
      const copies = [primary];
      if ((si + k) % 5 === 0) copies.push(sources[(si + k + 1) % 4]);
      const date = week.date;
      const assets = copies.map((src, c) => ({
        src,
        ext: String(1000 + n * 3 + c),
        url:
          src === 'ladaat'
            ? 'https://ladaat.co/gilyonot/uploads/' +
              date +
              '/files/' +
              (si + 1) +
              '-' +
              slug +
              '.pdf'
            : src === 'tashma'
              ? 'https://tashma.co.il/gilyonot/file/' + (5000 + n)
              : src === 'gilyoines'
                ? 'https://gilyoines.com/storage/' + n + '.pdf'
                : 'https://alonolam.com/wp-content/uploads/' + date.slice(0, 7) + '/' + n + '.pdf',
        page:
          'https://' +
          {
            ladaat: 'ladaat.co/gilyonot/view/',
            tashma: 'tashma.co.il/gilyonot/',
            gilyoines: 'gilyoines.com/g/',
            alonolam: 'alonolam.com/g/',
          }[src] +
          n,
        bytes: 200000 + ((n * 7919) % 1000000),
        pages: 4 + ((n * 13) % 40),
        downloads: (n * 37) % 700,
      }));
      // עותק אחד בלי קישור ישיר: מקור "קישור בלבד".
      if (n % 17 === 0) {
        delete assets[0].url;
      }
      const added = new Date(
        Date.UTC(2026, 9, 14, 20, 0, 0) - k * 7 * 86400000 - (n % 9) * 3600000,
      ).toISOString();
      issues.push({
        id: 'i_' + (0x8c11d0e47a93 + n * 104729).toString(16).padStart(12, '0').slice(-12),
        series: s.id,
        title: s.title,
        no: 50 - k,
        date,
        hy: week.hy,
        parasha: week.parasha,
        event: week.event || undefined,
        lang: s.lang,
        pages: assets[0].pages,
        added,
        assets,
      });
      s.issueCount++;
      n++;
    }
  });
  const weeksArchive = JSON.parse(
    readFileSync(
      join(here, '..', '..', 'plugin', 'test', 'fixtures', 'weeks-archive-real.json'),
      'utf8',
    ),
  );
  const { files } = buildFiles({
    series,
    issues,
    weeks,
    weeksArchive,
    sources: DEFAULT_SOURCES,
    recentCount: 40,
  });
  return files;
}

/**
 * (ד) קטלוג "מעגל השנה" לצילומי מסך: שמונה שנים (תש״פ-תשפ״ז) של עלונים מומצאים ב-12 סדרות, בתדירות שונה
 * לכל סדרה, כדי שהגלגל והספירות ייראו כמו בקטלוג אמיתי. דטרמיניסטי; בלי כותרות של עלונים אמיתיים.
 */
function wheelCatalog() {
  const weeks = weeksFixture();
  // צילום הארכיון בבדיקות מכיל תאריכים בלבד (בלי פרשות); כשיש קטלוג אמיתי מקומי — הלוח המלא שלו
  const localArchive = join(here, '..', '..', 'catalog', 'out', 'weeks-archive.json');
  const archive = JSON.parse(
    readFileSync(
      existsSync(localArchive)
        ? localArchive
        : join(here, '..', '..', 'plugin', 'test', 'fixtures', 'weeks-archive-real.json'),
      'utf8',
    ),
  );
  const rows = [...archive, ...weeks].filter(
    (w) => w.hy >= 5780 && w.hy <= 5787 && w.date <= '2026-10-17',
  );
  const series = SERIES.map(([title, lang, circle, src], i) => ({
    id: 's_' + (0x3fa91c02b1 + i * 7919).toString(16).slice(0, 10),
    title,
    aliases: [],
    previousIds: [],
    lang,
    circle,
    kind: 'weekly',
    sources: [{ src, ext: String(37 + i), title }],
    issueCount: 0,
    first: '2020-01-04',
    last: '2026-10-17',
  }));
  // כל סדרה יוצאת בחלק משבועות השנה: מ-90% (שבועון קבוע) עד 25% (סדרה שנעלמה לתקופות)
  const rate = [92, 88, 80, 74, 66, 58, 52, 46, 40, 34, 28, 22];
  const sources = ['ladaat', 'tashma', 'gilyoines', 'alonolam'];
  const issues = [];
  let n = 0;
  series.forEach((s, si) => {
    rows.forEach((row, ri) => {
      // חגים באמצע השבוע: רק חלק מהסדרות מפרסמות עלון חג
      const holiday = row.shabbat === false;
      const roll = (si * 7919 + ri * 104729 + (n % 7)) % 100;
      if (roll >= (holiday ? rate[si] * 0.9 : rate[si])) return;
      const src = sources[(si + ri) % 4];
      const parasha = holiday ? [] : row.parasha;
      issues.push({
        id: 'i_' + (0x8c11d0e47a93 + n * 104729).toString(16).padStart(12, '0').slice(-12),
        series: s.id,
        title: s.title,
        no: 10 + (ri % 60),
        date: row.date,
        hy: row.hy,
        parasha,
        event: row.event || undefined,
        lang: s.lang,
        pages: 4 + ((n * 13) % 40),
        added: new Date(
          Date.UTC(2026, 9, 14, 20, 0, 0) - ((rows.length - ri) % 90) * 86400000,
        ).toISOString(),
        assets: [
          {
            src,
            ext: String(1000 + n),
            url: 'https://ladaat.co/gilyonot/uploads/' + row.date + '/files/' + (si + 1) + '.pdf',
            page: 'https://ladaat.co/gilyonot/view/' + n,
            bytes: 200000 + ((n * 7919) % 1000000),
            pages: 4 + ((n * 13) % 40),
            downloads: (n * 37) % 700,
          },
        ],
      });
      s.issueCount++;
      n++;
    });
  });
  const { files } = buildFiles({
    series,
    issues,
    weeks,
    weeksArchive: archive,
    sources: DEFAULT_SOURCES,
    recentCount: 40,
  });
  return files;
}

function write(name, files) {
  writeFileSync(join(out, name), 'window.__FIXTURE__ = ' + JSON.stringify({ files }) + ';');
  const bytes = Object.values(files).reduce((s, t) => s + t.length, 0);
  console.log(name, Object.keys(files).length + ' files', Math.round(bytes / 1024) + ' KB');
}

if (value('--catalog')) {
  write('fixture-real.js', readDir(value('--catalog')));
} else {
  write('fixture-small.js', smallCatalog());
  if (flag('--wheel')) write('fixture-wheel.js', wheelCatalog());
  if (flag('--large')) {
    const size = Number(value('--size') || 32000);
    const { series, issues } = makeCatalog(size, 1200, 5);
    const weeks = weeksFixture();
    const { files } = buildFiles({
      series,
      issues,
      weeks,
      sources: DEFAULT_SOURCES,
      recentCount: 60,
    });
    write('fixture-large.js', files);
  }
}
void existsSync;
