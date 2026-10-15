// בונה קבצי קטלוג בפורמט docs/CATALOG_FORMAT.md מרשימת גיליונות: מניפסט עם
// גיבובים, series, weeks, recent ושרדים לפי שנה עברית. משמש בדיקות וגם
// tools/preview/make-fixture.mjs.
'use strict';

const crypto = require('node:crypto');

const sha = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/** `{ path: text }` שמוגש תחת בסיס הקטלוג. */
function buildFiles({ series, issues, weeks, weeksArchive, sources, catalogVersion, recentCount }) {
  const files = {};
  const put = (path, value) => {
    const text = JSON.stringify(value);
    files[path] = text;
    return {
      path,
      sha256: sha(text),
      bytes: Buffer.byteLength(text),
      count: Array.isArray(value) ? value.length : undefined,
    };
  };
  const byYear = new Map();
  for (const issue of issues) {
    const key = issue.hy ? String(issue.hy) : 'timeless';
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(issue);
  }
  const sorted = [...issues].sort((a, b) =>
    String(b.added || '').localeCompare(String(a.added || '')),
  );
  const manifestFiles = {
    series: put('series.json', series),
    weeks: put('weeks.json', weeks || []),
    recent: put('recent.json', sorted.slice(0, recentCount || 60)),
  };
  if (weeksArchive) manifestFiles.weeksArchive = put('weeks-archive.json', weeksArchive);
  const shards = [];
  for (const [id, list] of byYear) {
    const entry = put('issues/' + id + '.json', list);
    const dates = list
      .map((i) => i.date)
      .filter(Boolean)
      .sort();
    shards.push({
      id,
      ...entry,
      from: dates[0] || null,
      to: dates[dates.length - 1] || null,
      count: list.length,
    });
  }
  const manifest = {
    schema: 1,
    catalogVersion: catalogVersion || 1791834000,
    generatedAt: '2026-10-15T07:40:00Z',
    minPluginVersion: '0.1.0',
    sources: sources || [],
    files: manifestFiles,
    shards,
  };
  files['manifest.json'] = JSON.stringify(manifest);
  return { files, manifest };
}

const DEFAULT_SOURCES = [
  {
    id: 'ladaat',
    name: 'לדעת',
    url: 'https://ladaat.co/gilyonot/',
    mode: 'catalog',
    status: 'ok',
    checkedAt: '2026-10-15T07:39:00Z',
    lastOkAt: '2026-10-15T07:39:00Z',
    issueCount: 100,
    note: '',
  },
  {
    id: 'tashma',
    name: 'תשמע',
    url: 'https://tashma.co.il/gilyonot/',
    mode: 'catalog',
    status: 'ok',
    checkedAt: '2026-10-15T07:39:00Z',
    issueCount: 100,
    note: '',
  },
  {
    id: 'gilyoines',
    name: 'גיליונס',
    url: 'https://gilyoines.com/',
    mode: 'catalog',
    status: 'degraded',
    note: 'חלק מהגיליונות לא נטענו.',
  },
  {
    id: 'alonolam',
    name: 'עלון עולם',
    url: 'https://alonolam.com/',
    mode: 'catalog',
    status: 'ok',
    note: '',
  },
  {
    id: 'linksrc',
    name: 'מקור קישור',
    url: 'https://linksrc.example/',
    mode: 'link',
    status: 'blocked',
    note: 'האתר חוסם גישה אוטומטית. הקישור פותח את האתר.',
  },
];

module.exports = { buildFiles, sha, DEFAULT_SOURCES };
