// קטלוג סינתטי קטן וגדול לבדיקות יחידה וביצועים. דטרמיניסטי (PRNG עם זרע).
'use strict';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SERIES_TITLES = [
  'אסיפת גליונות',
  'עלון שבת',
  'פרפראות לחכמה',
  'שערי הפרשה',
  'מעיין השבוע',
  'אור הפרשה',
  'דבר תורה',
  'ילקוט הפרשה',
  'בית מדרש',
  'קול התורה',
  'שיחות',
  'חידושי תורה',
  'The Weekly Parsha',
  'Torah Insights',
];
const PARASHOT = [
  'bereshit',
  'noach',
  'lech-lecha',
  'vayera',
  'chayei-sara',
  'toldot',
  'vayetzei',
  'vayishlach',
  'vayeshev',
  'miketz',
  'vayigash',
  'vayechi',
  'shemot',
  'vaera',
  'bo',
  'beshalach',
];
const SOURCES = ['ladaat', 'tashma', 'gilyoines', 'alonolam'];
const LANGS = ['he', 'he', 'he', 'yi', 'en'];

/** [seriesCount] סדרות ו-[issueCount] גיליונות, מפוזרים על שנים 5780-5787. */
function makeCatalog(issueCount, seriesCount, seed) {
  const rand = rng(seed || 1);
  const series = [];
  for (let s = 0; s < (seriesCount || 40); s++) {
    const base = SERIES_TITLES[s % SERIES_TITLES.length];
    const title = s < SERIES_TITLES.length ? base : base + ' ' + (s + 1);
    series.push({
      id: 's_' + s.toString(16).padStart(10, '0'),
      title,
      lang: /[a-z]/i.test(title) ? 'en' : LANGS[s % LANGS.length],
      circle: s % 3 === 0 ? 'כללי' : s % 3 === 1 ? 'חסידי' : 'ליטאי',
      kind: 'weekly',
      sources: [{ src: SOURCES[s % 4], ext: String(s), title }],
      issueCount: 0,
    });
  }
  const issues = [];
  for (let n = 0; n < issueCount; n++) {
    const s = series[Math.floor(rand() * series.length)];
    const hy = 5780 + Math.floor(rand() * 8);
    const week = Math.floor(rand() * 52);
    const parasha = PARASHOT[week % PARASHOT.length];
    const month = 1 + Math.floor(week / 4.4);
    const day = 1 + ((week * 7) % 28);
    const date =
      hy -
      3760 +
      '-' +
      String(Math.min(12, month)).padStart(2, '0') +
      '-' +
      String(day).padStart(2, '0');
    const copies = 1 + (rand() < 0.2 ? 1 : 0);
    const assets = [];
    for (let c = 0; c < copies; c++) {
      const src = SOURCES[(Math.floor(rand() * 4) + c) % 4];
      assets.push({
        src,
        ext: String(n * 10 + c),
        url: 'https://ladaat.co/gilyonot/uploads/' + date + '/files/' + n + '-' + c + '.pdf',
        page: 'https://ladaat.co/gilyonot/view/' + n,
        bytes: 200000 + Math.floor(rand() * 20000000),
        pages: 2 + Math.floor(rand() * 40),
        downloads: Math.floor(rand() * 900),
      });
    }
    issues.push({
      id: 'i_' + n.toString(16).padStart(12, '0'),
      series: s.id,
      title: s.title,
      no: week + 1,
      date,
      hy,
      parasha: [parasha],
      lang: s.lang,
      pages: assets[0].pages,
      added: new Date(
        Date.UTC(2020 + (hy - 5780), 0, 1) + Math.floor(rand() * 86400000 * 300),
      ).toISOString(),
      assets,
    });
    s.issueCount++;
  }
  return { series, issues };
}

module.exports = { makeCatalog, rng };
