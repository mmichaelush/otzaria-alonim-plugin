// דפדפן אמיתי headless דרך Chrome DevTools Protocol, בלי תלויות: WebSocket מובנה
// ב-Node. מאפשר רוחב חלון מדויק (גם 400px), הרצת JS, מקשים, לחיצות וצילומים,
// ואיסוף שגיאות קונסול. משמש את smoke.mjs, screenshots.mjs ו-perf.mjs.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export const findBrowser = () => BROWSERS.find((p) => existsSync(p));

class Connection {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Set();
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', () => reject(new Error('websocket error')));
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }

  send(method, params, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.ws.close();
  }
}

export class Page {
  constructor(conn, sessionId) {
    this.conn = conn;
    this.sessionId = sessionId;
    /** שגיאות: חריגות לא נתפסות, console.error, ו-`[alonim] event … failed`. */
    this.errors = [];
    this.logs = [];
    conn.handlers.add((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push('Uncaught: ' + ((d.exception && d.exception.description) || d.text));
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        this.logs.push(msg.params.type + ': ' + text);
        if (msg.params.type === 'error' && !/^\[alonim\] /.test(text)) this.errors.push('console.error: ' + text);
        else if (/^\[alonim\] (event|listener) .* failed/.test(text)) this.errors.push(text);
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        const e = msg.params.entry;
        // 404 של favicon וכו' אינם שגיאת קוד.
        if (!/favicon/.test(e.url || '')) this.errors.push('log.error: ' + e.text + ' ' + (e.url || ''));
      }
    });
  }

  send(method, params) {
    return this.conn.send(method, params, this.sessionId);
  }

  async init(width, height, scale) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.setViewport(width, height, scale);
  }

  setViewport(width, height, scale) {
    return this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale || 1, mobile: false });
  }

  async goto(url, readyExpr) {
    this.errors.length = 0;
    this.logs.length = 0;
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"', 15000);
    if (readyExpr) await this.waitFor(readyExpr, 15000);
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error('eval: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    return res.result.value;
  }

  async waitFor(expression, timeout = 10000) {
    const end = Date.now() + timeout;
    for (;;) {
      let ok = false;
      try {
        ok = await this.eval('Boolean(' + expression + ')');
      } catch (error) {
        ok = false;
      }
      if (ok) return;
      if (Date.now() > end) throw new Error('timeout waiting for: ' + expression);
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async screenshot(file, options) {
    const o = options || {};
    const res = await this.send('Page.captureScreenshot', { format: 'png', ...(o.clip ? { clip: o.clip } : {}) });
    writeFileSync(file, Buffer.from(res.data, 'base64'));
  }

  async key(key, modifiers) {
    const map = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Tab: 9, Home: 36, End: 35, PageDown: 34, PageUp: 33 };
    const code = map[key] || key.toUpperCase().charCodeAt(0);
    const base = { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: code, modifiers: modifiers || 0 };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key.length === 1 ? key : undefined });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async type(text) {
    await this.send('Input.insertText', { text });
  }

  async click(selector) {
    const box = await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
    if (!box) throw new Error('no element: ' + selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
  }
}

export class Browser {
  static async launch() {
    const exe = findBrowser();
    if (!exe) throw new Error('לא נמצא Edge או Chrome');
    const dir = mkdtempSync(join(tmpdir(), 'alonim-cdp-'));
    const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--allow-file-access-from-files', '--hide-scrollbars', '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const url = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('browser did not start')), 15000);
      proc.stderr.on('data', (d) => {
        buf += d.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      proc.on('exit', () => reject(new Error('browser exited')));
    });
    const conn = new Connection(url);
    await conn.opened;
    return new Browser(proc, conn, dir);
  }

  constructor(proc, conn, dir) {
    this.proc = proc;
    this.conn = conn;
    this.dir = dir;
  }

  async newPage(width, height, scale) {
    const { targetId } = await this.conn.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.conn.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this.conn, sessionId);
    page.targetId = targetId;
    await page.init(width || 1000, height || 720, scale || 1);
    return page;
  }

  async closePage(page) {
    await this.conn.send('Target.closeTarget', { targetId: page.targetId });
  }

  async close() {
    try {
      this.conn.close();
    } catch (error) {
      // כבר סגור.
    }
    this.proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch (error) {
      // תיקיית פרופיל זמנית שעוד נעולה: לא קריטי.
    }
  }
}
