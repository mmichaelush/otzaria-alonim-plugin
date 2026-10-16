// גשר SDK מדומה של אוצריא: אותו קוד בבדיקות Node (`require`) ובתצוגה המקדימה
// בדפדפן (`window.FakeSdk`). מדמה את מה שהתוסף נשען עליו, כולל המלכודות:
// דלי אסימונים של 50 שמתמלא אחד ל-10ms וזורק את העודף, `fetchStream` שמחזיר רק
// הודעת שגיאה בעברית בלי קוד, `fs` פרטי עם מכסה, תיקיית משתמש עם
// `pickUserFolder`/`listUserFolder`/`openFolderFile`, ו-`network.download` שיוצר
// PDF מינימלי תקין. תרחישים (`scenario`): offline, blocked, slow, bad-schema,
// rate-limit, download-blocked, download-html, no-folder-permission,
// reader-permission, folder-gone, legacy-host (אוצריא 0.9.98: בלי `network.fetchFile`
// ו-`ui.printFile`), fetchfile-blocked, fetchfile-html, fetchfile-html-pdfmime, print-cancel, print-gesture (מארח שדורש מחווה לכל הדפסה אחרי
// הראשונה), print-gesture-first (הבקשה הראשונה נדחית ב-forbidden, כמו הדפסה אוטומטית בלי לחיצה),
// print-slow (מסך ההדפסה "פתוח" 300ms), reader-hang, reader-nolibrary.
// `ui.printFile` מדמה את מסך ההדפסה של אוצריא: ההבטחה נפתרת כשהמשתמש סיים (printed: true/false).
(function (root) {
  'use strict';

  const enc = (s) =>
    typeof TextEncoder === 'function' ? new TextEncoder().encode(s) : Buffer.from(s);

  /** PDF מינימלי תקין, מרופד לפחות ל-2KB (התוסף דוחה קובץ קטן מ-1KB). */
  function minimalPdf(label) {
    const body =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
      '4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 20 100 Td (' +
      String(label || 'Alonim').replace(/[()\\]/g, '') +
      ') Tj ET\nendstream endobj\n' +
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n';
    return (
      body +
      '%' +
      'x'.repeat(Math.max(0, 2200 - body.length)) +
      '\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n'
    );
  }

  /** כתובת שאפשר לעשות לה fetch (כמו שרת הקבצים של אוצריא), בלי שרת. */
  function dataUrl(content) {
    const text = typeof content === 'string' ? content : '';
    const b64 =
      typeof Buffer === 'function' ? Buffer.from(text, 'latin1').toString('base64') : btoa(text);
    return 'data:application/pdf;base64,' + b64;
  }

  function createFakeSdk(options) {
    const o = options || {};
    const now = o.now || (() => Date.now());
    const scenario = o.scenario || 'ready';
    const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    /** נתיב יחסי לבסיס הקטלוג → טקסט. */
    const catalog = o.catalog || {};
    const base =
      o.base || 'https://raw.githubusercontent.com/mmichaelush/otzaria-alonim-plugin/data/';

    const sdk = {
      calls: [],
      storage: new Map(Object.entries(o.storage || {})),
      privateFs: new Map(),
      quota: o.quota || 100 * 1024 * 1024,
      /** נתיב מוחלט (עם `/`) → `{ type, size, modified, content }`. */
      userFs: new Map(),
      folders: new Map(),
      openedUrls: [],
      declinedUrls: [],
      downloads: [],
      handlers: {},
      rateLimited: 0,
      tokens: 50,
      refilledAt: now(),
      streams: 0,
      /** קבצים מרוחקים שהמארח הוריד לתיקיית מטמון פרטית (`network.fetchFile`). */
      fetchedFiles: [],
      /** קריאות `ui.printFile` שהתקבלו. */
      printed: [],
      /** כמה מסכי הדפסה פתוחים כרגע, והשיא (הרצף אמור להשאיר אחד בלבד). */
      printOpen: 0,
      printMaxOpen: 0,
      /** token ← תוכן, לכל קובץ שהמארח הוענק לתוסף (תיקייה או fetchFile). */
      fileTokens: new Map(),
      revoked: [],
    };
    const legacyHost = scenario === 'legacy-host' || o.legacyHost === true;

    const folderRoot = 'C:/Users/Me/Documents/עלונים';

    function err(code, message) {
      return { success: false, data: null, error: { code, message: message || code } };
    }
    const ok = (data) => ({ success: true, data, error: null });

    function takeToken() {
      const t = now();
      sdk.tokens = Math.min(50, sdk.tokens + Math.floor((t - sdk.refilledAt) / 10));
      sdk.refilledAt = t;
      if (sdk.tokens <= 0) return false;
      sdk.tokens--;
      return true;
    }

    const used = () => [...sdk.privateFs.values()].reduce((n, f) => n + f.size, 0);

    function folderFor(token) {
      const f = sdk.folders.get(token);
      if (!f) return null;
      return f;
    }

    /** כל הצאצאים הישירים של תיקייה (נתיב מוחלט). */
    function children(dir) {
      const prefix = dir.replace(/\/$/, '') + '/';
      const seen = new Map();
      for (const [path, entry] of sdk.userFs) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const name = rest.split('/')[0];
        if (rest.includes('/')) {
          if (!seen.has(name))
            seen.set(name, { name, abs: prefix + name, type: 'dir', size: 0, modified: null });
        } else {
          seen.set(name, {
            name,
            abs: path,
            type: entry.type,
            size: entry.size,
            modified: entry.modified,
          });
        }
      }
      return [...seen.values()].sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
      );
    }

    function inApproved(abs) {
      return [...sdk.folders.values()].some((f) => abs === f.path || abs.startsWith(f.path + '/'));
    }

    const methods = {
      'storage.get': (p) => (sdk.storage.has(p.key) ? sdk.storage.get(p.key) : null),
      'storage.set': (p) => {
        if (p.value === null || p.value === undefined) return err('error.invalid_params', 'null');
        sdk.storage.set(p.key, JSON.parse(JSON.stringify(p.value)));
        return true;
      },
      'storage.remove': (p) => sdk.storage.delete(p.key) || true,
      'storage.list': () => [...sdk.storage.keys()],

      'fs.writeFile': (p) => {
        const size = enc(p.content).length;
        if (size > 10 * 1024 * 1024) return err('error.too_large');
        const prev = sdk.privateFs.get(p.path);
        if (used() - (prev ? prev.size : 0) + size > sdk.quota)
          return err('error.too_large', 'quota');
        sdk.privateFs.set(p.path, { content: p.content, size });
        return { path: p.path, size, usedBytes: used(), quotaBytes: sdk.quota };
      },
      'fs.readFile': (p) => {
        const f = sdk.privateFs.get(p.path);
        return f
          ? { path: p.path, encoding: 'utf8', size: f.size, content: f.content }
          : err('error.not_found');
      },
      'fs.listDir': (p) => ({
        entries: [...sdk.privateFs.keys()]
          .filter((k) => !p.path || k.startsWith(p.path + '/'))
          .map((k) => ({
            path: k,
            name: k.split('/').pop(),
            type: 'file',
            size: sdk.privateFs.get(k).size,
          })),
        usedBytes: used(),
        quotaBytes: sdk.quota,
      }),
      'fs.deleteEntry': (p) => {
        let n = 0;
        for (const k of [...sdk.privateFs.keys()])
          if (k === p.path || k.startsWith(p.path + '/')) (sdk.privateFs.delete(k), n++);
        return n > 0;
      },
      'fs.stat': (p) => (sdk.privateFs.has(p.path) ? { exists: true } : { exists: false }),

      'fs.pickUserFolder': () => {
        if (scenario === 'no-folder-permission') return err('permission_denied');
        if (o.pickCancel) return ok({ cancelled: true });
        const token = 'folder-1';
        sdk.folders.set(token, { token, name: 'עלונים', path: folderRoot });
        return { cancelled: false, folderToken: token, name: 'עלונים', path: folderRoot };
      },
      'fs.listUserFolder': (p) => {
        const f = folderFor(p.folderToken);
        if (!f) return err('error.not_found', 'unknown folder token');
        if (scenario === 'folder-gone') return err('error.not_found', 'folder no longer exists');
        const abs = f.path + (p.path ? '/' + p.path : '');
        if (/\.\./.test(p.path || '')) return err('error.forbidden');
        const exts = (p.extensions || []).map((e) => e.replace(/^\./, '').toLowerCase());
        const entries = children(abs)
          .filter(
            (e) =>
              e.type === 'dir' ||
              !exts.length ||
              exts.includes(e.name.split('.').pop().toLowerCase()),
          )
          .filter((e) => !e.name.startsWith('.'))
          .map((e) => ({
            name: e.name,
            path: (p.path ? p.path + '/' : '') + e.name,
            type: e.type,
            size: e.size,
            modified: e.modified,
          }));
        return {
          folderToken: p.folderToken,
          name: f.name,
          path: p.path || '',
          entries,
          truncated: false,
        };
      },
      'fs.openFolderFile': (p) => {
        const f = folderFor(p.folderToken);
        if (!f) return err('error.not_found');
        const abs = f.path + '/' + p.path;
        const file = sdk.userFs.get(abs);
        if (!file) return err('error.not_found');
        const token = 'file-' + p.path.length + '-' + file.size;
        sdk.fileTokens.set(token, file.content);
        return {
          cancelled: false,
          token,
          url: o.fileUrl ? o.fileUrl(abs, file) : dataUrl(file.content),
          name: p.path.split('/').pop(),
          size: file.size,
          access: 'read',
        };
      },
      'fs.deleteFile': (p) => {
        if (!inApproved(p.path)) return err('error.forbidden');
        sdk.userFs.delete(p.path);
        return true;
      },
      'fs.moveEntry': (p) => {
        if (!inApproved(p.from) || !inApproved(p.to)) return err('error.forbidden');
        const f = sdk.userFs.get(p.from);
        if (!f) return err('error.not_found');
        if (sdk.userFs.has(p.to)) return err('error.invalid_params');
        sdk.userFs.delete(p.from);
        sdk.userFs.set(p.to, f);
        return true;
      },
      'fs.revokeFolder': (p) => sdk.folders.delete(p.folderToken) || true,

      'network.download': async (p) => {
        sdk.downloads.push(p);
        if (o.downloadDelay) await sleep(o.downloadDelay);
        if (scenario === 'download-blocked' || scenario === 'blocked')
          return err('error.forbidden', 'URL not in allowlist');
        if (!inApproved(p.destPath))
          return err('error.forbidden', 'destPath outside approved folder');
        const html = scenario === 'download-html';
        let content = html
          ? '<html>' + 'x'.repeat(2000) + '</html>'
          : minimalPdf(p.destPath.split('/').pop());
        // גודל כמו בקטלוג (כדי שבדיקת "ההורדה נקטעה" תעבור על קובץ תקין).
        const wanted = o.sizeFor ? o.sizeFor(p.url) : 0;
        if (wanted > content.length) content = content + '%'.padEnd(wanted - content.length, 'x');
        sdk.userFs.set(p.destPath, {
          type: 'file',
          size: content.length,
          modified: new Date(now()).toISOString(),
          content,
        });
        return { path: p.destPath.replace(/\//g, '\\'), filename: p.destPath.split('/').pop() };
      },

      // אוצריא 0.9.99: קובץ מרוחק בלי הורדה לתיקיית המשתמש, והדפסת קובץ.
      'network.fetchFile': legacyHost
        ? undefined
        : async (p) => {
            sdk.fetchedFiles.push(p);
            // כמו המארח האמיתי (PluginRemoteFileCache): תקרות הפרמטרים נדחות, לא נחתכות.
            if (
              p.maxBytes !== undefined &&
              (!Number.isInteger(p.maxBytes) || p.maxBytes <= 0 || p.maxBytes > 104857600)
            )
              return err(
                'error.invalid_params',
                'maxBytes must be a positive integer up to 104857600',
              );
            if (
              p.timeoutMs !== undefined &&
              (!Number.isInteger(p.timeoutMs) || p.timeoutMs <= 0 || p.timeoutMs > 600000)
            )
              return err(
                'error.invalid_params',
                'timeoutMs must be a positive integer up to 600000',
              );
            if (o.downloadDelay) await sleep(o.downloadDelay);
            if (
              scenario === 'fetchfile-blocked' ||
              scenario === 'blocked' ||
              scenario === 'download-blocked'
            )
              return err('error.forbidden', 'URL not in allowlist');
            if (
              !/^https:\/\/(ladaat\.co|tashma\.co\.il|gilyoines\.com|alonolam\.com)\//.test(
                String(p.url),
              )
            )
              return err('error.forbidden', 'URL not in allowlist');
            const htmlPdfMime = scenario === 'fetchfile-html-pdfmime';
            const html = scenario === 'fetchfile-html' || htmlPdfMime;
            let content = html
              ? '<html>' + 'x'.repeat(2000) + '</html>'
              : minimalPdf(String(p.url).split('/').pop());
            const wanted = o.sizeFor ? o.sizeFor(p.url) : 0;
            if (!html && wanted > content.length)
              content = content + '%'.padEnd(wanted - content.length, 'x');
            const token = 'remote-' + sdk.fetchedFiles.length;
            sdk.fileTokens.set(token, content);
            return {
              token,
              url: dataUrl(content),
              name: String(p.url).split('/').pop() || 'file.pdf',
              size: content.length,
              // המארח האמיתי קובע mime לפי הסיומת (`.pdf`), לא לפי התוכן.
              mime: html && !htmlPdfMime ? 'text/html' : 'application/pdf',
            };
          },
      'ui.printFile': legacyHost
        ? undefined
        : async (p) => {
            sdk.printed.push(p);
            if (!sdk.fileTokens.has(p.token)) return err('error.not_found', 'unknown file token');
            const gesture = () =>
              err(
                'error.forbidden',
                'Requires a user gesture — call it directly from a click handler',
              );
            if (scenario === 'print-gesture' && sdk.printed.length > 1) return gesture();
            if (scenario === 'print-gesture-first' && sdk.printed.length === 1) return gesture();
            sdk.printMaxOpen = Math.max(sdk.printMaxOpen, ++sdk.printOpen);
            try {
              const wait = scenario === 'print-slow' ? 300 : o.printDelayMs || 0;
              if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
              return { printed: scenario !== 'print-cancel' };
            } finally {
              sdk.printOpen--;
            }
          },
      'fs.revokeFile': (p) => {
        sdk.revoked.push(p.token);
        sdk.fileTokens.delete(p.token);
        return true;
      },

      // openurl-declined: המשתמש סירב באישור "פתיחת קישור חיצוני" של אוצריא (מחזיר false); openurl-error: המארח נכשל.
      'app.openUrl': (p) => {
        if (scenario === 'openurl-error') return err('error.internal', 'failed to open URL');
        if (scenario === 'openurl-declined') {
          sdk.declinedUrls.push(p.url);
          return false;
        }
        sdk.openedUrls.push(p.url);
        return true;
      },
      'app.getConnectivity': () => ({
        isOfflineMode: scenario === 'offline',
        hasNetwork: scenario !== 'offline',
        isOnline: scenario !== 'offline',
      }),

      // reader-hang: הרענון נתקע (כמו באוצריא בלי ספרייה טעונה: 45 שניות ויותר); reader-nolibrary: גם החיפוש.
      'library.refreshUserBooks': () =>
        scenario === 'reader-permission'
          ? err('permission_denied')
          : scenario === 'reader-hang' || scenario === 'reader-nolibrary'
            ? new Promise(() => {})
            : { addedBooks: 1, updatedBooks: 0, errors: [] },
      'library.findBooks': (p) => {
        if (scenario === 'reader-permission') return err('permission_denied');
        if (scenario === 'reader-nolibrary') return new Promise(() => {});
        const hits = [];
        for (const path of sdk.userFs.keys()) {
          const name = path
            .split('/')
            .pop()
            .replace(/\.pdf$/i, '');
          if (
            path.endsWith('.pdf') &&
            !path.includes('/_קריאה/') &&
            name.includes(String(p.query).replace(/[[\]]/g, ''))
          )
            hits.push({ bookId: name, title: name, bookUid: 'uid:' + hits.length, type: 'pdf' });
        }
        return hits;
      },
      'reader.openBook': () => true,
      'ui.showMessage': () => true,
    };

    sdk.call = async function (method, payload) {
      sdk.calls.push({ method, payload });
      // השהיית ערוץ ההודעות של ה-WebView (כמה ms לקריאה): מדידות הפעלה ריאליסטיות יותר.
      if (o.callLatency) await sleep(o.callLatency);
      if (method === 'network.fetchStream') {
        // כמו אוצריא: ההגבלה על יצירת הזרם, והשגיאות מגיעות בתוך הזרם.
        if (!takeToken()) return err('error.rate_limited');
        return stream(payload || {});
      }
      if (!takeToken()) {
        sdk.rateLimited++;
        return err('error.rate_limited');
      }
      if (scenario === 'rate-limit' && sdk.calls.length % 7 === 0 && !o.noInjectedLimit)
        return err('error.rate_limited');
      const fn = methods[method];
      if (!fn) return err('error.unknown_method');
      let result = fn(payload || {});
      if (result && typeof result.then === 'function') result = await result;
      if (result && typeof result === 'object' && result.success === false && result.error)
        return result;
      if (result && typeof result === 'object' && result.success === true && 'data' in result)
        return result;
      return ok(result);
    };

    function stream(params) {
      sdk.streams++;
      const gen = (async function* () {
        if (o.netDelay) await sleep(o.netDelay);
        if (scenario === 'slow') await sleep(o.slowMs || 1500);
        if (scenario === 'offline') throw new Error('SocketException: Failed host lookup');
        if (!String(params.url).startsWith(base)) {
          // אוצריא מחזירה לזרם רק הודעה בעברית כשהכתובת אינה ברשימת ההיתר.
          throw new Error('הכתובת אינה ברשימת ההיתר של אוצריא');
        }
        if (scenario === 'blocked') throw new Error('הכתובת אינה ברשימת ההיתר של אוצריא');
        const path = String(params.url).slice(base.length).split('?')[0];
        let text = catalog[path];
        if (path === 'manifest.json' && scenario === 'bad-schema')
          text = JSON.stringify({ schema: 99 });
        if (text === undefined) {
          yield { type: 'response', sequence: 0, status: 404, ok: false, headers: {} };
          return;
        }
        yield { type: 'response', sequence: 0, status: 200, ok: true, headers: {} };
        const size = 64 * 1024;
        for (let i = 0, n = 1; i < text.length; i += size, n++)
          yield { type: 'data', sequence: n, body: text.slice(i, i + size) };
      })();
      let closed = false;
      return {
        next: () => (closed ? Promise.resolve({ value: undefined, done: true }) : gen.next()),
        return: () => {
          closed = true;
          return Promise.resolve({ value: undefined, done: true });
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    }

    sdk.on = (event, handler) => {
      (sdk.handlers[event] = sdk.handlers[event] || []).push(handler);
    };
    sdk.off = (event, handler) => {
      sdk.handlers[event] = (sdk.handlers[event] || []).filter((h) => h !== handler);
    };
    sdk.emit = (event, payload) => Promise.all((sdk.handlers[event] || []).map((h) => h(payload)));
    sdk.folderRoot = folderRoot;
    /** שם קובץ בתיקיית המשתמש, לבדיקות. */
    sdk.putFile = (rel, content) => {
      const text = content === undefined ? minimalPdf(rel) : content;
      sdk.userFs.set(folderRoot + '/' + rel, {
        type: 'file',
        size: text.length,
        modified: new Date(now()).toISOString(),
        content: text,
      });
    };
    sdk.methods = methods;
    return sdk;
  }

  const api = { createFakeSdk, minimalPdf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FakeSdk = api;
})(typeof self !== 'undefined' ? self : globalThis);
