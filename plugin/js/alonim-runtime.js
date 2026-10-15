// הגבול היחיד מול ה-SDK של אוצריא: כל קריאה עוברת כאן, ולכן לכל כשל אותה צורה,
// ואף אירוע אינו הופך לדחייה שאיש אינו תופס. שאר הקבצים אינם נוגעים ב-`Otzaria`.
(function (root) {
  'use strict';

  const CODES = Object.freeze({
    unknownMethod: 'error.unknown_method',
    unavailable: 'error.unavailable',
    permissionDenied: 'permission_denied',
    forbidden: 'error.forbidden',
    notFound: 'error.not_found',
    rateLimited: 'error.rate_limited',
    timeout: 'error.timeout',
    invalidParams: 'error.invalid_params',
    tooLarge: 'error.too_large',
  });

  /** השיטה חסרה או חסומה במארח הזה: היכולת פשוט לא מוצעת. */
  const SOFT_CODES = Object.freeze([
    CODES.unknownMethod,
    CODES.unavailable,
    CODES.permissionDenied,
    'error.permission_denied',
    'error.unsupported_context',
  ]);

  class SdkError extends Error {
    constructor(method, response) {
      const failure = (response && response.error) || {};
      const code = failure.code || 'error.unknown';
      super(method + ' [' + code + ']: ' + (failure.message || ''));
      this.name = 'SdkError';
      this.method = method;
      this.code = code;
      this.hostMessage = failure.message || '';
    }

    get isUnsupported() {
      return SOFT_CODES.includes(this.code);
    }
  }

  /**
   * כשל ברשת (`network.fetchStream`). אוצריא מעבירה לזרם רק הודעה בעברית, בלי
   * קוד, ולכן ה-`code` כאן נגזר מהטקסט. ההחלטות בקוד נשענות עליו ולא על הטקסט.
   * `forbidden` = הכתובת אינה ברשימת ההיתר של אוצריא: מסלול הירידה הוא האתר.
   */
  class NetError extends Error {
    constructor(code, message, status) {
      super(message);
      this.name = 'NetError';
      this.code = code;
      this.status = status || 0;
    }
  }

  function classifyNetworkFailure(error) {
    if (error instanceof NetError) return error;
    const message = String((error && (error.hostMessage || error.message)) || error || '');
    const code = error && error.code;
    if (
      code === CODES.forbidden ||
      /forbidden|allowlist|רשימת ההיתר|לא מורשית|אינה מורשית|חסומ/i.test(message)
    ) {
      return new NetError('forbidden', message);
    }
    if (
      code === CODES.permissionDenied ||
      code === 'error.permission_denied' ||
      /permission|הרשא/i.test(message)
    ) {
      return new NetError('permission', message);
    }
    if (code === CODES.timeout || /timeout|timed out|זמן/i.test(message)) {
      return new NetError('timeout', message);
    }
    if (/rate.?limit|too many/i.test(message)) return new NetError('busy', message);
    return new NetError('network', message);
  }

  // דלי האסימונים של אוצריא (50, אסימון לכל 10ms, והשארית נזרקת) הוא צוק ולא
  // האטה: 50 קריאות צפופות עוברות, וכל השאר נדחות בשקט. שומרים עותק שלו
  // ומחכים במקום להידחות; ניסיון חוזר רק על `rate_limited`, שנדחה לפני
  // שהקריאה רצה ולכן בטוח לחזור עליו בכל שיטה.
  const BUCKET_SIZE = 45;
  const REFILL_MS = 10;
  const WAIT_MS = 15;
  const RETRY_BACKOFF_MS = Object.freeze([20, 60, 150, 400, 900]);

  const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * @param bridge  `window.Otzaria`.
   * @param options `{ now, sleep, logger }` להחלפה בבדיקות.
   */
  function createRuntime(bridge, options) {
    const opts = options || {};
    const now = opts.now || (() => Date.now());
    const sleep = opts.sleep || defaultSleep;
    const logger =
      opts.logger || (root.Alonim && root.Alonim.Log && root.Alonim.Log.shared) || console;
    const debug = (message, detail) => {
      if (typeof logger.debug === 'function') logger.debug(message, detail);
    };

    let tokens = BUCKET_SIZE;
    let refilledAt = now();
    let gate = Promise.resolve();

    function takeToken() {
      const time = now();
      // שעון שחוזר אחורה (NTP) היה נועל את כל הקריאות לזמן רב.
      tokens = Math.min(
        BUCKET_SIZE,
        tokens + Math.max(0, Math.floor((time - refilledAt) / REFILL_MS)),
      );
      refilledAt = time;
      if (tokens <= 0) return false;
      tokens -= 1;
      return true;
    }

    /** רק ההמתנה מסודרת בתור; הקריאות עצמן רצות במקביל. */
    function reserveSlot() {
      const reservation = gate.then(async () => {
        while (!takeToken()) await sleep(WAIT_MS);
      });
      gate = reservation.then(
        () => {},
        () => {},
      );
      return reservation;
    }

    async function callRaw(method, payload) {
      if (!bridge || typeof bridge.call !== 'function') {
        return { success: false, error: { code: CODES.unavailable, message: 'no SDK' } };
      }
      const params = payload || {};
      await reserveSlot();
      let response = await bridge.call(method, params);
      for (const backoff of RETRY_BACKOFF_MS) {
        if (!(response && response.error && response.error.code === CODES.rateLimited)) break;
        tokens = 0;
        await sleep(backoff);
        response = await bridge.call(method, params);
      }
      return response;
    }

    /** מחזיר `data`, או זורק [SdkError]. */
    async function call(method, payload) {
      const response = await callRaw(method, payload);
      if (!response || response.success === false) {
        const error = new SdkError(method, response);
        debug(method + ' failed', error);
        throw error;
      }
      return response.data;
    }

    /**
     * לקריאות שכשלונן אינו צריך לעצור את הזרימה. לעולם לא לפעולה שהמשתמש
     * ביקש: כל לחיצה נגמרת בתוצאה או בהודעה.
     */
    async function callSoft(method, payload, fallback) {
      try {
        return await call(method, payload);
      } catch (error) {
        if (!(error instanceof SdkError && error.isUnsupported))
          logger.warn(method + ' failed', error);
        return fallback === undefined ? null : fallback;
      }
    }

    /**
     * GET של טקסט (JSON) דרך `network.fetchStream`: הערוץ היחיד, כי `fetch()`
     * מה-WebView נחסם ב-CORS והזרם מחזיר רק UTF-8. זורק [NetError].
     */
    async function fetchText(url, request) {
      const o = request || {};
      const maxBytes = o.maxBytes || 12 * 1024 * 1024;
      if (!bridge || typeof bridge.call !== 'function') throw new NetError('network', 'no SDK');
      await reserveSlot();
      let status = null;
      let text = '';
      let chunks;
      try {
        chunks = bridge.call('network.fetchStream', {
          url,
          method: 'GET',
          headers: o.headers || { Accept: 'application/json' },
          timeoutMs: o.timeoutMs || 30000,
        });
        // קריאה שנדחתה לפני שהחלה (שגיאת פרמטרים, הרשאה) מגיעה כהבטחה.
        if (chunks && typeof chunks.then === 'function') {
          const response = await chunks;
          if (response && response.success === false)
            throw new SdkError('network.fetchStream', response);
          chunks = response;
        }
        if (o.signal)
          o.signal.addEventListener('abort', () => chunks.return && chunks.return(), {
            once: true,
          });
        let size = 0;
        for await (const chunk of chunks) {
          if (chunk.type === 'response') {
            status = chunk.status;
          } else if (chunk.type === 'data') {
            size += chunk.body.length;
            if (size > maxBytes) {
              if (chunks.return) chunks.return();
              throw new NetError('too_large', 'response too large');
            }
            text += chunk.body;
          }
        }
      } catch (error) {
        const failure = classifyNetworkFailure(error);
        debug('fetch failed ' + failure.code, failure);
        throw failure;
      }
      if (status === null) throw new NetError('network', 'no response');
      if (status >= 400) {
        throw new NetError(
          status === 403 || status === 401 ? 'blocked' : 'http',
          'HTTP ' + status,
          status,
        );
      }
      return { status, text };
    }

    /** `Otzaria.on` שכשל במטפל נרשם בלוג ואינו בורח כדחייה. */
    function on(eventName, handler) {
      if (!bridge || typeof bridge.on !== 'function') return () => {};
      const wrapped = (payload) =>
        Promise.resolve()
          .then(() => handler(payload))
          .catch((error) => logger.error('event ' + eventName + ' failed', error));
      bridge.on(eventName, wrapped);
      return () => bridge.off && bridge.off(eventName, wrapped);
    }

    return Object.freeze({ bridge, call, callRaw, callSoft, fetchText, on });
  }

  const api = { CODES, SdkError, NetError, classifyNetworkFailure, createRuntime };
  const A = (root.Alonim = root.Alonim || {});
  A.Runtime = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
