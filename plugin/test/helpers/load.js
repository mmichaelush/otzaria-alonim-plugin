// טוען את מודולי התוסף ב-Node בסדר שבו index.html טוען אותם. כל מודול רושם את
// עצמו ב-`globalThis.Alonim`, כמו בדפדפן. המודולים עם DOM אינם נטענים כאן.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const plugin = (...parts) => path.join(__dirname, '..', '..', ...parts);

/** הקבצים בלי DOM, בסדר הטעינה. */
const PURE = [
  'js/alonim-i18n.js',
  'i18n/en.js',
  'js/alonim-hebcal.js',
  'js/alonim-core.js',
  'js/alonim-normalize.js',
  'js/alonim-log.js',
  'js/alonim-runtime.js',
  'js/alonim-capabilities.js',
  'js/alonim-errors.js',
  'js/alonim-boundary.js',
  'js/alonim-theme.js',
  'js/alonim-weeks.js',
  'js/alonim-rules.js',
  'js/alonim-filters.js',
  'js/alonim-index.js',
  'js/alonim-index-search.js',
  'js/alonim-state.js',
  'js/alonim-catalog.js',
  'js/alonim-files.js',
  'js/alonim-bulk.js',
  'js/alonim-storage.js',
  'js/alonim-diagnostics.js',
];

function loadPlugin() {
  globalThis.Alonim = globalThis.Alonim || {};
  for (const file of PURE) {
    if (fs.existsSync(plugin(file))) require(plugin(file));
  }
  const A = globalThis.Alonim;
  if (A.Log) A.Log.shared.sink = null;
  return A;
}

module.exports = { loadPlugin, plugin, PURE };
