// שרת QA מקומי: מגיש את הקטלוג האמיתי ומחליף את כתובות הקבצים והתמונות ב-
// 127.0.0.1, כדי לבדוק באוצריא אמיתית (ללא אישור allowlist וללא פגיעה באתרי המקור).
//   node tools/qa/qa-server.mjs [--catalog catalog/out] [--port 39811] [--proxy]
// --proxy: בקשת קובץ/תמונה מועברת לאתר המקור האמיתי (רק כשהמשתמש לוחץ), במקום PDF מזויף.
import { createServer } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const root = resolve(arg('--catalog', 'catalog/out'));
const port = Number(arg('--port', '39811'));
const origin = `http://127.0.0.1:${port}`;
const proxy = process.argv.includes('--proxy');
/** urlBase המקורי של כל מקור (נשמר לפני שכתוב המניפסט), לשימוש ב-proxy. */
const origBases = new Map();
const qaLog = resolve(arg('--qa-log', 'tools/qa/out/qa-console.log'));

// ערוץ שליטה ל-qa-probe.js: הפרוב עושה long-poll ל-/qa/poll, ו-POST ל-/qa/exec מוסר לו קוד.
// מצב תקלה לבדיקת ירידה בשלבים: down=503 | reset | hang (חל על /data ו-/files בלבד; /qa תמיד חי).
let outage = null;
const queue = [];
const waiters = [];
const results = new Map();
let nextId = 1;
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** PDF תקין מינימלי (Helvetica, A4, [pages] עמודים). */
function makePdf(label, pages = 3) {
  const objs = [];
  const add = (body) => (objs.push(body), objs.length);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let p = 0; p < pages; p++) {
    const text = `BT /F1 28 Tf 60 760 Td (${label.replace(/[^A-Za-z0-9 _./:-]/g, '?')}) Tj 0 -50 Td (Page ${p + 1} of ${pages}) Tj ET`;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + p * 2} 0 R >>`);
    add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function rewriteManifest(text) {
  const m = JSON.parse(text);
  for (const s of m.sources || []) {
    if (s.mode !== 'catalog') continue;
    if (s.urlBase) origBases.set(s.id, s.urlBase);
    s.urlBase = `${origin}/files/${s.id}/`;
    for (const k of Object.keys(s.urlTemplates || {})) {
      // דף האתר נשאר באתר האמיתי (נפתח בדפדפן), לא בשרת המקומי.
      if (k === 'page') { if (!/^https:\/\//.test(s.urlTemplates[k]) && origBases.get(s.id)) s.urlTemplates[k] = origBases.get(s.id) + s.urlTemplates[k]; continue; }
      if (/^https:\/\//.test(s.urlTemplates[k])) s.urlTemplates[k] = s.urlTemplates[k].replace(/^https:\/\/[^/]+\/[^{]*/, '');
    }
  }
  return JSON.stringify(m);
}

async function qaRoute(path, url, req, res) {
  const body = req.method === 'POST' ? await readBody(req) : '';
  if (path === '/qa/hello') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><meta charset=utf-8><body style="font:24px sans-serif;background:#cfe">hello from QA server (html in iframe)</body>');
  if (path === '/qa/mode') {
    outage = url.searchParams.get('down') || null;
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ outage }));
  }
  if (path === '/qa/log') {
    const lines = JSON.parse(body || '[]').map((e) => JSON.stringify(e)).join(String.fromCharCode(10)) + String.fromCharCode(10);
    await appendFile(qaLog, lines);
    return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end('{}');
  }
  if (path === '/qa/poll') {
    const take = () => queue.shift();
    const cmd = take();
    return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(cmd ? JSON.stringify(cmd) : '');
  }
  if (path === '/qa/result') {
    const id = url.searchParams.get('id');
    const r = results.get(id);
    if (r) { results.delete(id); r(JSON.parse(body)); }
    return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end('{}');
  }
  if (path === '/qa/exec') {
    const id = String(nextId++);
    const done = new Promise((ok) => { results.set(id, ok); setTimeout(() => ok({ ok: false, error: 'timeout waiting for page' }), Number(url.searchParams.get('timeout') || 60000)); });
    const cmd = { id, code: body };
    queue.push(cmd);
    return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(await done));
  }
  return res.writeHead(404).end();
}

createServer(async (req, res) => {
  const t0 = Date.now();
  res.on('close', () => console.log(new Date().toISOString(), req.method, req.url, res.statusCode, Date.now() - t0 + 'ms', req.headers.range || ''));
  try {
    const url = new URL(req.url, origin);
    const path = decodeURIComponent(url.pathname);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (path.startsWith('/qa/')) return await qaRoute(path, url, req, res);
    if (outage === '503') return res.writeHead(503, { 'Retry-After': '1' }).end('QA outage');
    if (outage === 'reset') return req.socket.destroy();
    if (outage === 'hang') return await new Promise(() => {});
    if (path.startsWith('/data/')) {
      const rel = path.slice(6);
      if (rel.includes('..')) throw Object.assign(new Error('bad'), { status: 400 });
      let body = await readFile(join(root, rel), 'utf8');
      if (rel === 'manifest.json') body = rewriteManifest(body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (path.startsWith('/files/')) {
      if (proxy) {
        const [, , src, ...restParts] = url.pathname.split('/');
        const base = origBases.get(src);
        if (!base) throw Object.assign(new Error('manifest not served yet'), { status: 503 });
        const target = base + restParts.join('/');
        const upstream = await fetch(target, { headers: { 'User-Agent': 'OtzariaAlonimQA/1 (manual check by the plugin owner)', ...(req.headers.range ? { Range: req.headers.range } : {}) }, redirect: 'follow' });
        const h = { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream' };
        for (const k of ['content-length', 'content-range', 'accept-ranges']) if (upstream.headers.get(k)) h[k] = upstream.headers.get(k);
        res.writeHead(upstream.status, h);
        if (!upstream.body) return res.end();
        for await (const chunk of upstream.body) res.write(chunk);
        return res.end();
      }
      if (/\.(png|jpe?g)$/i.test(path)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(PNG);
      }
      await new Promise((r) => setTimeout(r, Number(url.searchParams.get('delay') || 300)));
      const pdf = makePdf(path.split('/').slice(2).join(' / ') || 'QA', 3 + (path.length % 5));
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      const headers = { 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes' };
      if (range) {
        const start = Number(range[1] || 0);
        const end = Math.min(Number(range[2] || pdf.length - 1), pdf.length - 1);
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${pdf.length}`, 'Content-Length': end - start + 1 });
        return res.end(pdf.subarray(start, end + 1));
      }
      res.writeHead(200, { ...headers, 'Content-Length': pdf.length });
      return res.end(req.method === 'HEAD' ? undefined : pdf);
    }
    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(error.status || (error.code === 'ENOENT' ? 404 : 500)).end(String(error.message));
  }
}).listen(port, '127.0.0.1', () => console.log(`QA server on ${origin} (catalog: ${root})`));
