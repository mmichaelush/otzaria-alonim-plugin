// מדידות ביצועים בדפדפן אמיתי: ציור ראשון (ביקור ראשון וביקור שני מהמטמון), בניית
// האינדקס, חיפוש בהקלדה, צמתי DOM בגלילה וזיכרון. על הקטלוג הסינתטי (30K+) או על
// האמיתי (`--real`, אחרי build-preview.mjs --catalog <dir>).
//   node tools/preview/perf.mjs [--real] [--catalog <dir>]
// בונה את דף הבדיקה בעצמו (build-preview): `--real` על קטלוג אמיתי מ-`--catalog`, או `ALONIM_CATALOG`,
// או `catalog/out`; בלי קטלוג כזה נכשל מיד עם הודעה ברורה (ולא בהמתנה לשדה חיפוש שאינו קיים).
// מסיים בקוד 1 כשתקציב מופר (BUDGETS), כדי שנסיגה בביצועים תיכשל בבדיקה ולא תתגלה במשתמש.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Browser } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const real = process.argv.includes('--real');
const argAt = process.argv.indexOf('--catalog');
const catalogDir = resolve(
  (argAt > 0 && process.argv[argAt + 1]) ||
    process.env.ALONIM_CATALOG ||
    join(here, '..', '..', 'catalog', 'out'),
);
if (real && !existsSync(join(catalogDir, 'manifest.json'))) {
  console.error(
    'perf --real: אין קטלוג ב-' +
      catalogDir +
      ' (חסר manifest.json). בנו אחד: node catalog/build.mjs --out catalog/out --cache, או ציינו --catalog <תיקייה>.',
  );
  process.exit(2);
}
execFileSync(
  process.execPath,
  [join(here, 'build-preview.mjs'), ...(real ? ['--catalog', catalogDir] : ['--large'])],
  { stdio: 'ignore' },
);
const file = real ? 'preview-real.html' : 'preview-large.html';
const base = pathToFileURL(join(here, 'out', file)).href;
/** תקציבי ביצועים (ms אלא אם נאמר אחרת). מדידה על המחשב של המפתח; התקציב נדיב פי 2-3 מהמדידה. */
const BUDGETS = {
  firstCardFirstVisitMs: 1500,
  firstCardSecondVisitMs: 2500,
  typingEndToEndMs: 100,
  searchMs: 40,
  facetCountsMs: 100,
  multiFilterSearchMs: 40,
  filterPanelOpenMs: 200,
  weekPickerOpenMs: 100,
  maxCardsInDom: 60,
  heapMB: 250,
};
const browser = await Browser.launch();
const out = {};
try {
  for (const [label, extra] of [
    ['first visit (simulated network, 40ms per file)', ''],
    ['second visit (private cache filled)', '&warm=1'],
  ]) {
    const page = await browser.newPage(1000, 800);
    const t0 = Date.now();
    await page.goto(`${base}?today=2026-10-15&page=all${extra}`);
    await page.waitFor(
      "window.__alonimApp && document.querySelectorAll('.card').length > 0 && Boolean(document.querySelector('.search-input'))",
      60000,
    );
    const firstCard = Date.now() - t0;
    await page.waitFor(
      "window.__alonimApp.catalog.status.phase === 'idle' && window.__alonimApp.catalog.status.shardsLoaded >= window.__alonimApp.catalog.status.shardsTotal",
      180000,
    );
    const allLoaded = Date.now() - t0;
    const info = await page.eval(
      `(() => { const a = window.__alonimApp; return { issues: a.index.size, lastBatchBuildMs: Math.round(a.index.lastBuildMs), warmShards: a.catalog.status.shardsTotal, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; })()`,
    );
    out[label] = { firstCardMs: firstCard, allShardsMs: allLoaded, ...info };
    if (!extra) {
      // חיפוש מההקלדה: זמן מאירוע input ועד שהרשימה צוירה.
      const queries = ['נח', 'אסיפת גליונות נח', 'year:5786 parasha:noach', 'torah'];
      const timings = {};
      await page.eval("document.querySelector('.search-input').focus()");
      for (const q of queries) {
        const ms = await page.eval(
          `(async () => { const input = document.querySelector('.search-input'); const t = performance.now(); input.value = ${JSON.stringify(q)}; input.dispatchEvent(new Event('input')); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return { total: performance.now() - t, search: window.__alonimApp.lastQueryMs, results: document.querySelector('.results-count').textContent }; })()`,
        );
        timings[q] = {
          endToEndMs: Math.round(ms.total),
          searchMs: Math.round(ms.search * 10) / 10,
          results: ms.results,
        };
      }
      out.search = timings;
      // DOM בגלילה
      let maxDom = 0;
      await page.eval(
        "(() => { const i = document.querySelector('.search-input'); i.value = ''; i.dispatchEvent(new Event('input')); })()",
      );
      await page.sleep(300);
      for (const top of [0, 10000, 250000, 1000000, 4000000, 9000000]) {
        await page.eval(`document.querySelector('.vlist').scrollTop = ${top}`);
        await page.sleep(100);
        maxDom = Math.max(
          maxDom,
          await page.eval("document.querySelectorAll('[data-item]').length"),
        );
      }
      // מסננים: ספירות לכל מסנן, חיפוש עם כמה מסננים, ופתיחת החלונות
      out.filters = await page.eval(`(() => {
        const a = window.__alonimApp;
        const time = (fn, n = 3) => { fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) / n; };
        const f = { lang: ['he', 'yi'], source: ['ladaat', 'tashma'], dateFrom: '2022-01-01', pagesMin: 4 };
        return {
          facetCountsMs: Math.round(time(() => a.index.facetCounts('נח', f, a.searchContext(), {})) * 10) / 10,
          multiFilterSearchMs: Math.round(time(() => a.index.search('נח OR וירא', f, a.searchContext(), { sort: 'date' })) * 10) / 10,
          groupMs: Math.round(time(() => a.index.groupResults(a.index.search('', {}, {}, {}).idx, 'series')) * 10) / 10,
        };
      })()`);
      const timeOpen = async (click, ready) => {
        await page.eval(click);
        const t = Date.now();
        await page.waitFor(ready, 5000);
        const ms = Date.now() - t;
        await page.key('Escape');
        await page.sleep(300);
        return ms;
      };
      out.filters.filterPanelOpenMs = await timeOpen(
        "document.querySelector('[data-key=filters]').click()",
        "document.querySelectorAll('.filter-group').length > 5",
      );
      await page.eval("window.__alonimApp.go('week')");
      await page.sleep(500);
      out.filters.weekPickerOpenMs = await timeOpen(
        "document.querySelector('[data-key=jump]').click()",
        "document.querySelectorAll('.week-row').length > 5",
      );
      await page.eval("window.__alonimApp.go('all')");
      await page.sleep(400);
      out.scroll = {
        maxCardsInDom: maxDom,
        totalNodes: await page.eval('document.getElementsByTagName("*").length'),
      };
    }
    if (page.errors.length) out.errors = page.errors;
    await browser.closePage(page);
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));

const first = out['first visit (simulated network, 40ms per file)'] || {};
const second = out['second visit (private cache filled)'] || {};
const worst = (obj, key) => Math.max(...Object.values(obj || {}).map((x) => x[key] || 0));
const measured = {
  firstCardFirstVisitMs: first.firstCardMs,
  firstCardSecondVisitMs: second.firstCardMs,
  typingEndToEndMs: worst(out.search, 'endToEndMs'),
  searchMs: worst(out.search, 'searchMs'),
  facetCountsMs: out.filters && out.filters.facetCountsMs,
  multiFilterSearchMs: out.filters && out.filters.multiFilterSearchMs,
  filterPanelOpenMs: out.filters && out.filters.filterPanelOpenMs,
  weekPickerOpenMs: out.filters && out.filters.weekPickerOpenMs,
  maxCardsInDom: out.scroll && out.scroll.maxCardsInDom,
  heapMB: first.heapMB,
};
const violations = Object.entries(BUDGETS).filter(
  ([key, limit]) => measured[key] !== null && measured[key] !== undefined && measured[key] > limit,
);
console.log('\nתקציבים (נמדד / מותר):');
for (const [key, limit] of Object.entries(BUDGETS)) {
  console.log(
    '  ' +
      (violations.some(([k]) => k === key) ? '✖' : '✔') +
      ' ' +
      key +
      ': ' +
      measured[key] +
      ' / ' +
      limit,
  );
}
if (violations.length || (out.errors && out.errors.length)) {
  console.error('\nתקציב ביצועים הופר או שיש שגיאות קונסול');
  process.exit(1);
}
