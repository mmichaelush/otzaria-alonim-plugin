// טוען את הקטלוג האמיתי (catalog/out) לבדיקות, אם הוא נמצא; אחרת הבדיקות
// מדלגות עליו ורצות על קטלוג סינתטי. סדר החיפוש: משתנה הסביבה ALONIM_CATALOG,
// ואחר כך catalog/out של הריפו או של ריפו האב (כשרצים מתוך worktree).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function findCatalog() {
  const candidates = [];
  if (process.env.ALONIM_CATALOG) candidates.push(process.env.ALONIM_CATALOG);
  let dir = path.resolve(__dirname);
  for (let k = 0; k < 8; k++) {
    candidates.push(path.join(dir, 'catalog', 'out'));
    dir = path.dirname(dir);
  }
  return (
    candidates.find(
      (c) => fs.existsSync(path.join(c, 'series.json')) && fs.existsSync(path.join(c, 'issues')),
    ) || null
  );
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** `{ series, weeks, manifest, shards: [{ id, list }] }` מהתיקייה. */
function loadRaw(dir) {
  const issuesDir = path.join(dir, 'issues');
  const shards = fs
    .readdirSync(issuesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ id: f.replace(/\.json$/, ''), list: readJson(path.join(issuesDir, f)) }));
  return {
    series: readJson(path.join(dir, 'series.json')),
    weeks: fs.existsSync(path.join(dir, 'weeks.json'))
      ? readJson(path.join(dir, 'weeks.json'))
      : [],
    manifest: fs.existsSync(path.join(dir, 'manifest.json'))
      ? readJson(path.join(dir, 'manifest.json'))
      : {},
    shards,
  };
}

const SOURCE_NAMES = {
  ladaat: 'לדעת',
  tashma: 'תשמע',
  gilyoines: 'גיליונס',
  alonolam: 'עלון עולם',
};

/** אינדקס מלא (או רק השרדים ב-[only]) מהנתונים הגולמיים. */
function buildIndex(A, raw, only) {
  const index = new A.Index.CatalogIndex({ source: (id) => SOURCE_NAMES[id] || id });
  index.setSeries(raw.series);
  index.setWeeks(raw.weeks);
  for (const shard of raw.shards)
    if (!only || only.includes(shard.id)) index.addIssues(shard.list, shard.id);
  return index;
}

module.exports = { findCatalog, loadRaw, buildIndex, SOURCE_NAMES };
