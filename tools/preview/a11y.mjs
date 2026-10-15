// בדיקות נגישות אוטומטיות בדפדפן אמיתי: שמות נגישים לכפתורים ושדות, alt לתמונות, מזהים
// כפולים, תפקידי ARIA, כותרת ל-iframe, וניגודיות טקסט (WCAG AA) מול הרקע האפקטיבי, בבהיר
// וכהה. רץ גם ב-smoke.mjs (`a11yReport`).
//   node tools/preview/a11y.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Browser } from './cdp.mjs';

/** מופעל בתוך הדף. מחזיר `{ problems: string[] }`. */
export const REPORT_SOURCE = String.raw`(() => {
  const problems = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.textContent || '').trim();
  const where = (el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.');

  for (const el of document.querySelectorAll('button, [role=button], [role=tab], [role=menuitem], [role=switch], a[href]')) {
    if (visible(el) && !name(el)) problems.push('no accessible name: ' + where(el));
  }
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!visible(el)) continue;
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label');
    if (!labelled) problems.push('field without a label: ' + where(el));
  }
  for (const el of document.querySelectorAll('img')) if (el.getAttribute('alt') === null) problems.push('img without alt: ' + where(el));
  for (const el of document.querySelectorAll('iframe')) if (!el.getAttribute('title')) problems.push('iframe without title');
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  for (const [id, n] of ids) if (n > 1) problems.push('duplicate id: ' + id);
  for (const el of document.querySelectorAll('[role=listitem]')) if (!el.closest('[role=list]')) problems.push('listitem outside a list: ' + where(el));
  for (const el of document.querySelectorAll('[role=dialog], [role=alertdialog]')) if (!el.getAttribute('aria-labelledby') && !el.getAttribute('aria-label')) problems.push('dialog without a name');
  for (const el of document.querySelectorAll('[aria-labelledby]')) for (const id of el.getAttribute('aria-labelledby').split(' ')) if (!document.getElementById(id)) problems.push('aria-labelledby points nowhere: ' + id);
  for (const el of document.querySelectorAll('[aria-controls]')) for (const id of el.getAttribute('aria-controls').split(' ')) if (!document.getElementById(id) && el.getAttribute('aria-expanded') !== 'false') problems.push('aria-controls points nowhere: ' + id);
  if (document.querySelectorAll('h1').length < 1) problems.push('no h1');

  // ניגודיות
  const parse = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value) || /color\(srgb ([^)]+)\)/.exec(value);
    if (!m) return null;
    const isColor = value.startsWith('color(');
    const parts = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    const [r, g, b] = isColor ? parts.slice(0, 3).map((x) => x * 255) : parts.slice(0, 3);
    const a = parts.length > 3 ? parts[3] : 1;
    return { r, g, b, a };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const background = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    if (base.a < 1) base = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of stack.reverse()) base = over(c, base);
    return base;
  };
  const seen = new Set();
  let checked = 0;
  let min = 99;
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('[disabled], .is-hidden, .vlist-measure, svg')) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (Number(cs.opacity) < 1) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = background(el);
    const effective = over(fg, bg);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const r = ratio(effective, bg);
    checked++;
    if (r < min) min = r;
    const key = where(el);
    if (r < need && !seen.has(key)) { seen.add(key); problems.push('contrast ' + r.toFixed(2) + ' < ' + need + ': ' + key + ' "' + text.slice(0, 30) + '"'); }
  }
  return { problems, checked, min: Math.round(min * 100) / 100 };
})()`;

export async function a11yReport(page, stats) {
  const report = await page.eval(REPORT_SOURCE);
  if (stats) Object.assign(stats, { checked: report.checked, min: report.min });
  return report.problems;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  execFileSync(process.execPath, [join(here, 'build-preview.mjs')], { stdio: 'ignore' });
  const base = pathToFileURL(join(here, 'out', 'preview.html')).href;
  const scenarios = ['page=week', 'page=all', 'page=all&view=list', 'series=0', 'page=series', 'page=mine', 'page=settings&section=rules', 'page=settings&section=backup', 'details=0', 'open=0&nofolder=1', 'open=0&print=1&xorigin=1', 'scenario=blocked&page=week&seed=0'];
  const browser = await Browser.launch();
  let total = 0;
  try {
    for (const mode of ['light', 'dark']) {
      for (const q of scenarios) {
        const page = await browser.newPage(1000, 800);
        await page.goto(`${base}?today=2026-10-15&${q}&mode=${mode}`);
        await page.waitFor("document.documentElement.dataset.previewReady === '1'", 20000).catch(() => {});
        await page.sleep(1200);
        const stats = {};
        const problems = await a11yReport(page, stats);
        total += problems.length;
        console.log((problems.length ? '✖ ' : '✔ ') + mode + ' ' + q + ' [' + stats.checked + ' text elements, min contrast ' + stats.min + ']' + (problems.length ? '\n   ' + problems.join('\n   ') : ''));
        await browser.closePage(page);
      }
    }
  } finally {
    await browser.close();
  }
  if (total) process.exit(1);
}
