// QA בלבד (נכנס רק לעותק ה-QA, לא למוצר): מדווח לשרת ה-QA יומן קונסול, שגיאות
// ותזמונים, ומריץ פקודות JS שהשרת מוסר (long-poll). הכל דרך network.fetchStream
// של אוצריא (fetch ישיר מ-WebView חסום ב-CORS). קצר ונדיר בכוונה: לאוצריא מגבלת
// זרמי רשת פעילים במקביל, ופרוב שתופס זרמים מפיל את הסנכרון של התוסף עצמו.
(function () {
  'use strict';
  const BASE = 'http://127.0.0.1:__PORT__/qa/';
  const buffer = [];
  /** מזהה חלון (בכל טעינה): `/qa/exec?win=<id>` מכוון פקודה לחלון מסוים. */
  const WIN = Math.random().toString(36).slice(2, 8);
  window.__qaWin = WIN;
  let timer = null;
  let sending = false;
  const stamp = () => Math.round(performance.now());

  function push(kind, data) {
    buffer.push({ kind, t: stamp(), wall: new Date().toISOString(), data });
    if (!timer) timer = setTimeout(flush, 400);
  }
  window.__qaPush = push;

  async function post(path, body, timeoutMs) {
    let stream = window.Otzaria.call('network.fetchStream', { url: BASE + path, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs: timeoutMs || 15000 });
    if (stream && typeof stream.then === 'function') {
      const response = await stream;
      if (response && response.success === false) throw new Error('fetchStream rejected: ' + JSON.stringify(response.error));
      stream = response;
    }
    let text = '';
    for await (const chunk of stream) if (chunk.type === 'data') text += chunk.body;
    return text;
  }

  async function flush() {
    timer = null;
    if (sending || !buffer.length || !window.Otzaria) return;
    sending = true;
    const batch = buffer.splice(0, buffer.length);
    try {
      await post('log', batch);
    } catch (error) {
      buffer.unshift(...batch);
    } finally {
      sending = false;
      if (buffer.length && !timer) timer = setTimeout(flush, 1500);
    }
  }

  const text = (args) => args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })())).join(' ');
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      push('console', { level, text: text(args) });
    };
  }
  window.addEventListener('error', (e) => push('error', { message: e.message, source: e.filename, line: e.lineno }));
  window.addEventListener('unhandledrejection', (e) => push('rejection', { reason: text([e.reason]) }));
  document.addEventListener('securitypolicyviolation', (e) => push('csp', { directive: e.violatedDirective, blocked: e.blockedURI }));

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) push('paint', { name: entry.name, start: Math.round(entry.startTime) });
    }).observe({ type: 'paint', buffered: true });
  } catch (error) {
    // אין תמיכה: מדלגים.
  }
  // חסימות של התהליך הראשי (ג'אנק) ותגובתיות לקלט
  for (const [type, extra] of [['longtask', {}], ['event', { durationThreshold: 100 }]]) {
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) push(type, { name: e.name, start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }).observe({ type, buffered: true, ...extra });
    } catch (error) {
      push('probe', { event: type + ' observer unsupported' });
    }
  }
  // רגעי ציר-זמן: שלד נעלם / כרטיס ראשון / מחוון סנכרון
  const seen = new Set();
  const mark = (name) => {
    if (!seen.has(name)) {
      seen.add(name);
      push('mark', { name });
    }
  };
  const mo = new MutationObserver(() => {
    if (document.querySelector('.card')) mark('first-card');
    const bar = document.querySelector('.sync-bar');
    if (bar && !bar.hidden) mark('sync-bar-visible');
    if (bar && bar.hidden && seen.has('sync-bar-visible')) mark('sync-bar-hidden');
  });
  document.addEventListener('DOMContentLoaded', () => {
    mark('dom-ready');
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  });
  window.addEventListener('load', () => mark('load'));
  window.addEventListener('pagehide', () => push('lifecycle', { event: 'pagehide' }));
  document.addEventListener('visibilitychange', () => push('lifecycle', { event: 'visibility ' + document.visibilityState }));

  // עקבות SDK: כל קריאה לאוצריא (חוץ מערוץ ה-QA עצמו) עם משך ותוצאה
  function traceSdk() {
    const o = window.Otzaria;
    if (!o || o.__qaWrapped || typeof o.call !== 'function') return;
    const orig = o.call.bind(o);
    const brief = (params) => {
      try {
        const copy = { ...(params || {}) };
        for (const k of Object.keys(copy)) if (typeof copy[k] === 'string' && copy[k].length > 160) copy[k] = copy[k].slice(0, 160) + '…';
        return copy;
      } catch (e) { return null; }
    };
    o.call = function (method, params) {
      if (method === 'network.fetchStream' && params && String(params.url).includes('/qa/')) return orig(method, params);
      const started = performance.now();
      const result = orig(method, params);
      if (result && typeof result.then === 'function') {
        result.then(
          (res) => push('sdk', { method, params: brief(params), ms: Math.round(performance.now() - started), ok: !(res && res.success === false), error: res && res.error ? res.error : undefined, data: res && res.data !== undefined && method !== 'network.fetchStream' ? JSON.stringify(res.data).slice(0, 200) : undefined }),
          (err) => push('sdk', { method, params: brief(params), ms: Math.round(performance.now() - started), ok: false, thrown: String(err && err.message || err) }),
        );
      } else {
        push('sdk', { method, params: brief(params), stream: true });
      }
      return result;
    };
    o.__qaWrapped = true;
  }
  const waitTrace = setInterval(() => { if (window.Otzaria) { traceSdk(); clearInterval(waitTrace); } }, 5);

  // לולאת פקודות
  async function loop() {
    while (!window.Otzaria) await new Promise((r) => setTimeout(r, 100));
    push('probe', { event: 'started', href: location.href, ua: navigator.userAgent });
    for (;;) {
      let cmd = null;
      try {
        const body = await post('poll', { page: location.href, win: WIN }, 8000);
        cmd = body ? JSON.parse(body) : null;
        if (!cmd) await new Promise((r) => setTimeout(r, 2500));
      } catch (error) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!cmd || !cmd.id) continue;
      let result;
      try {
        // eslint-disable-next-line no-eval
        const value = await (0, eval)('(async () => {' + cmd.code + '\n})()');
        result = { ok: true, value: value === undefined ? null : value };
      } catch (error) {
        result = { ok: false, error: String(error && error.stack ? error.stack : error) };
      }
      try {
        await post('result?id=' + encodeURIComponent(cmd.id), result);
      } catch (error) {
        await post('result?id=' + encodeURIComponent(cmd.id), { ok: false, error: 'unserializable result' }).catch(() => {});
      }
    }
  }
  loop();
})();
