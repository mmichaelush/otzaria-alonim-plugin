// מדידות ביצועים בדפדפן אמיתי: ציור ראשון (ביקור ראשון וביקור שני מהמטמון), בניית
// האינדקס, חיפוש בהקלדה, צמתי DOM בגלילה וזיכרון. על הקטלוג הסינתטי (30K+) או על
// האמיתי (`--real`, אחרי build-preview.mjs --catalog <dir>).
//   node tools/preview/perf.mjs [--real]
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Browser } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const real = process.argv.includes('--real');
const file = real ? 'preview-real.html' : 'preview-large.html';
const base = pathToFileURL(join(here, 'out', file)).href;
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
      "window.__alonimApp && document.querySelectorAll('.card').length > 0",
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
