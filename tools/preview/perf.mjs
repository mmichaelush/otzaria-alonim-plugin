// מדידות ביצועים בדפדפן אמיתי: הפעלה (ביקור ראשון מהרשת, וביקור שני מהמטמון), בניית האינדקס, חיפוש בהקלדה,
// החלת מסנן, פתיחת חלונות, צמתי DOM וגמישות הגלילה (פריימים ארוכים), וזיכרון (לפני ואחרי איסוף זבל). על הקטלוג
// הסינתטי (30K+) או על האמיתי (`--real`, 123 אלף גיליונות).
//   node tools/preview/perf.mjs [--real] [--catalog <dir>] [--json file]
// בונה את דף הבדיקה בעצמו (build-preview): `--real` על קטלוג אמיתי מ-`--catalog`, או `ALONIM_CATALOG`,
// או `catalog/out`; בלי קטלוג כזה נכשל מיד עם הודעה ברורה (ולא בהמתנה לשדה חיפוש שאינו קיים).
// מסיים בקוד 1 כשתקציב מופר (BUDGETS), כדי שנסיגה בביצועים תיכשל בבדיקה ולא תתגלה במשתמש.
//
// זמני ההפעלה נמדדים **מיצירת ה-App** (`app.timings`), ולא מטעינת הדף: טעינת הדף כוללת פענוח של קובץ הנתונים
// של התצוגה המקדימה (עד 46MB לקטלוג האמיתי), שאינו חלק מהמוצר. הקריאות ל-SDK מושהות 2ms כל אחת (`latency=2`),
// כמו ערוץ ההודעות של ה-WebView. הדף הכולל נרשם בנפרד (`pageFirstCardMs`).
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
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

/**
 * תקציבי ביצועים (ms אלא אם נאמר אחרת). מדידה על המחשב של המפתח; התקציב נדיב פי 1.5-3 מהמדידה, חוץ מהיעדים
 * של המוצר (כרטיס ראשון בביקור שני 400, הקשה 60, מסנן 100), שהם התקציב עצמו.
 */
const BUDGETS = real
  ? {
      firstCardFirstVisitMs: 1500,
      firstCardSecondVisitMs: 400,
      typingEndToEndMs: 60,
      typingSequenceWorstMs: 80,
      searchMs: 50,
      filterApplyMs: 100,
      facetCountsMs: 100,
      multiFilterSearchMs: 40,
      filterPanelOpenMs: 200,
      weekPickerOpenMs: 100,
      scrollLongFrames: 3,
      scrollWorstFrameMs: 120,
      maxCardsInDom: 60,
      liveHeapMB: 220,
    }
  : {
      firstCardFirstVisitMs: 1500,
      firstCardSecondVisitMs: 400,
      typingEndToEndMs: 60,
      typingSequenceWorstMs: 80,
      searchMs: 40,
      filterApplyMs: 100,
      facetCountsMs: 100,
      multiFilterSearchMs: 40,
      filterPanelOpenMs: 200,
      weekPickerOpenMs: 100,
      scrollLongFrames: 3,
      scrollWorstFrameMs: 120,
      maxCardsInDom: 60,
      liveHeapMB: 100,
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
    await page.goto(`${base}?today=2026-10-15&page=all&latency=2&settle=0${extra}`);
    await page.waitFor(
      "window.__alonimApp && document.querySelectorAll('.card').length > 0 && Boolean(document.querySelector('.search-input'))",
      60000,
    );
    const pageFirstCard = Date.now() - t0;
    await page.waitFor(
      "window.__alonimApp.catalog.status.phase === 'idle' && window.__alonimApp.catalog.status.shardsLoaded >= window.__alonimApp.catalog.status.shardsTotal",
      180000,
    );
    const allLoaded = Date.now() - t0;
    const info = await page.eval(
      `(() => { const a = window.__alonimApp; return { issues: a.index.size, lastBatchBuildMs: Math.round(a.index.lastBuildMs), warmShards: a.catalog.status.shardsTotal, startup: a.timings, warmUpMs: a.warmUpMs, cacheMs: a.catalog.status.cacheMs }; })()`,
    );
    out[label] = {
      firstCardMs: info.startup.firstCard,
      pageFirstCardMs: pageFirstCard,
      allShardsMs: allLoaded,
      ...info,
    };
    if (!extra) {
      // כמו משתמש אמיתי: מקלידים אחרי שהנתונים נרגעו והחימום ברקע (App.scheduleWarmUp) הסתיים.
      await page
        .waitFor('window.__alonimApp.timings.warmedAt !== undefined', 15000)
        .catch(() => console.log('(warm-up did not run)'));
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
      // הקלדה אות אחרי אות של שאילתה בת שלוש מילים: כל הקשה מורידה מילה נוספת, והמסכות מצמצמות (alonim-index-search)
      const phrase = 'אסיפת גליונות נח';
      out.typingSequence = await page.eval(`(async () => {
        const input = document.querySelector('.search-input');
        const times = [];
        for (let k = 1; k <= ${JSON.stringify(phrase)}.length; k++) {
          const t = performance.now();
          input.value = ${JSON.stringify(phrase)}.slice(0, k);
          input.dispatchEvent(new Event('input'));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          times.push(performance.now() - t);
        }
        input.value = '';
        input.dispatchEvent(new Event('input'));
        const sorted = [...times].sort((a, b) => a - b);
        return { keystrokes: times.length, medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]), worstMs: Math.round(sorted[sorted.length - 1]), firstMs: Math.round(times[0]) };
      })()`);
      // DOM וגלילה: פריימים ארוכים (מעל 34ms) ביותר מ-90 פריימים של גלילה רציפה, והפריים הגרוע ביותר
      await page.eval(
        "(() => { const i = document.querySelector('.search-input'); i.value = ''; i.dispatchEvent(new Event('input')); })()",
      );
      await page.sleep(400);
      let maxDom = 0;
      out.scrollJank = await page.eval(`(async () => {
        const list = document.querySelector('.vlist');
        const frames = [];
        let last = performance.now();
        let maxDom = 0;
        for (let k = 0; k < 120; k++) {
          list.scrollTop += 700;
          await new Promise((r) => requestAnimationFrame(r));
          const now = performance.now();
          frames.push(now - last);
          last = now;
          maxDom = Math.max(maxDom, document.querySelectorAll('[data-item]').length);
        }
        frames.sort((a, b) => a - b);
        return {
          frames: frames.length,
          p50: Math.round(frames[Math.floor(frames.length * 0.5)] * 10) / 10,
          p95: Math.round(frames[Math.floor(frames.length * 0.95)] * 10) / 10,
          worst: Math.round(frames[frames.length - 1] * 10) / 10,
          long: frames.filter((f) => f > 34).length,
          maxDom,
        };
      })()`);
      maxDom = out.scrollJank.maxDom;
      for (const top of [0, 10000, 250000, 1000000, 4000000, 9000000]) {
        await page.eval(`document.querySelector('.vlist').scrollTop = ${top}`);
        await page.sleep(100);
        maxDom = Math.max(
          maxDom,
          await page.eval("document.querySelectorAll('[data-item]').length"),
        );
      }
      await page.eval("document.querySelector('.vlist').scrollTop = 0");
      // מסננים: ספירות לכל מסנן, חיפוש עם כמה מסננים, החלה מקצה לקצה, ופתיחת החלונות
      out.filters = await page.eval(`(async () => {
        const a = window.__alonimApp;
        const time = (fn, n = 3) => { fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) / n; };
        const f = { lang: ['he', 'yi'], source: ['ladaat', 'tashma'], dateFrom: '2022-01-01', pagesMin: 4 };
        const res = {
          facetCountsMs: Math.round(time(() => a.index.facetCounts('נח', f, a.searchContext(), {})) * 10) / 10,
          multiFilterSearchMs: Math.round(time(() => a.index.search('נח OR וירא', f, a.searchContext(), { sort: 'date' })) * 10) / 10,
          groupMs: Math.round(time(() => a.index.groupResults(a.index.search('', {}, {}, {}).idx, 'series')) * 10) / 10,
        };
        // החלת מסנן כמו שהמסך עושה: setFilters ← חיפוש ← ציור, עד שתי frames אחרי
        const apply = [];
        for (const filters of [{ lang: ['he'] }, { lang: ['he'], source: ['ladaat'] }, { hy: [5786] }, {}]) {
          const t = performance.now();
          a.screen.setFilters(filters);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          apply.push(performance.now() - t);
        }
        res.filterApplyMs = Math.round(Math.max(...apply));
        return res;
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
      // זיכרון מדויק (CDP `Runtime.getHeapUsage`; `performance.memory` מעוגל ומתעדכן לאט), לפני ואחרי איסוף זבל
      const heapMB = async () =>
        Math.round((await page.send('Runtime.getHeapUsage')).usedSize / 1048576);
      const before = await heapMB();
      await page.send('HeapProfiler.collectGarbage');
      const after = await heapMB();
      // הערכה: מה מזה של הגשר המדומה (הקטלוג כטקסט בנתוני התצוגה ובמטמון הפרטי המדומה). חלק מהמחרוזות
      // משותפות עם התוסף, ולכן ההערכה גבוהה מדי; התקציב הוא על `liveMB` הכולל.
      const harnessMB = await page.eval(`(() => {
        // V8 stores a string with any non-ASCII character as 2 bytes per character, otherwise 1
        const bytes = (text) => (/[^\x00-\x7f]/.test(text) ? 2 : 1) * text.length;
        let total = 0;
        for (const text of Object.values((window.__FIXTURE__ || {}).files || {})) total += bytes(text);
        const fs = window.__sdk && window.__sdk.privateFs;
        if (fs) for (const entry of fs.values()) total += bytes(entry.content || '');
        return Math.round(total / 1048576);
      })()`);
      out.memory = { usedMB: before, liveMB: after, harnessMB, pluginMB: after - harnessMB };
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
  typingSequenceWorstMs: out.typingSequence && out.typingSequence.worstMs,
  searchMs: worst(out.search, 'searchMs'),
  filterApplyMs: out.filters && out.filters.filterApplyMs,
  facetCountsMs: out.filters && out.filters.facetCountsMs,
  multiFilterSearchMs: out.filters && out.filters.multiFilterSearchMs,
  filterPanelOpenMs: out.filters && out.filters.filterPanelOpenMs,
  weekPickerOpenMs: out.filters && out.filters.weekPickerOpenMs,
  scrollLongFrames: out.scrollJank && out.scrollJank.long,
  scrollWorstFrameMs: out.scrollJank && out.scrollJank.worst,
  maxCardsInDom: out.scroll && out.scroll.maxCardsInDom,
  liveHeapMB: out.memory && out.memory.liveMB,
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
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0)
  writeFileSync(
    process.argv[jsonAt + 1],
    JSON.stringify({ real, measured, budgets: BUDGETS, out }, null, 2),
  );
if (violations.length || (out.errors && out.errors.length)) {
  console.error('\nתקציב ביצועים הופר או שיש שגיאות קונסול');
  process.exit(1);
}
