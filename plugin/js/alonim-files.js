// קבצים: תיקיית ההורדות (`fs.pickUserFolder`, גישה קבועה), תור הורדות, פתיחה
// לקריאה (`fs.openFolderFile`), מחיקה, והדפסה. מצב "הורד" אינו נשמר: הוא נגזר
// מהדיסק (`fs.listUserFolder`), ושם הקובץ נושא את מזהה הגיליון.
//
// שתי משמעויות לפתיחה של גיליון:
//   * קריאה — ברירת המחדל של לחיצה. אם הקובץ לא בתיקייה, הוא יורד ל-`_קריאה`
//     (זמני, מתנקה לבד), ונפתח בצפיין.
//   * שמירה — "הורדה": הקובץ נשמר קבוע ב-`<שנה>/<סדרה>/`. אם כבר נקרא, הוא
//     מועבר (`fs.moveEntry`) ולא יורד שוב.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;

  const READ_DIR = '_קריאה';
  const READ_KEEP = 20;
  const MIN_PDF_BYTES = 1024;
  /** מעל זה לא טוענים לזיכרון של הצפיין (Blob): ממליצים על הקורא של אוצריא. */
  const MAX_INLINE_BYTES = 150 * 1024 * 1024;
  /** תקרת `network.fetchFile` של המארח: ערך גדול ממנה נדחה ב-`error.invalid_params` (נמדד חי באוצריא 0.9.99). */
  const HOST_FETCH_MAX_BYTES = 100 * 1024 * 1024;
  const CONCURRENCY = 2;
  const START_GAP_MS = 400;
  const SCAN_PARALLEL = 3;
  /** קובץ מרוחק שהוענק: כמה זמן משתמשים בו בלי לבקש שוב, וכמה מחזיקים. */
  const REMOTE_TTL_MS = 10 * 60 * 1000;
  const REMOTE_KEEP = 6;

  const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const trimSlash = (p) => String(p || '').replace(/[\\/]+$/, '');

  /** כשל עם קוד יציב: ההחלטות בקוד נשענות עליו, והטקסט הוא של ה-UI. */
  class FileError extends Error {
    constructor(code, detail) {
      super(code + (detail ? ': ' + detail : ''));
      this.name = 'FileError';
      this.code = code;
    }
  }

  /**
   * העותק שמורידים: מהמקור המועדף של הסדרה, ואחר כך לפי סדר ברירת המחדל. רק
   * עותק עם כתובת קובץ שמותר להוריד אליה. `reason`: למה אין עותק.
   */
  function pickAsset(item, preferredSrc, hiddenSources) {
    const hidden = new Set(hiddenSources || []);
    const assets = (item.assets || []).filter((a) => a && !hidden.has(a.src));
    const withUrl = assets.filter((a) => a.url);
    if (!withUrl.length) return { asset: null, reason: 'no_link' };
    const allowed = withUrl.filter((a) => Core.isDownloadUrl(a.url));
    if (!allowed.length) return { asset: null, reason: 'blocked' };
    const preferred = allowed.find((a) => a.src === preferredSrc);
    return { asset: preferred || allowed[0], reason: null };
  }

  class Files {
    /**
     * [runtime] מ-`createRuntime`; [options]: `{ log, sleep, now, getFolder(),
     * setFolder(folder), hiddenSources(item), preferredSource(item) }`. התיקייה
     * עצמה נשמרת בהעדפות (State), ולכן נקראת דרך [getFolder].
     */
    constructor(runtime, options) {
      const o = options || {};
      this.runtime = runtime;
      this.log = o.log || { debug() {}, warn() {}, info() {}, error() {} };
      this.sleep = o.sleep || sleepDefault;
      this.now = o.now || (() => Date.now());
      this.getFolder = o.getFolder || (() => null);
      this.setFolder = o.setFolder || (() => {});
      this.hiddenSources = o.hiddenSources || (() => []);
      this.preferredSource = o.preferredSource || (() => '');
      /** `(id) => [מזהים קודמים]`: קובץ שירד תחת מזהה ישן עדיין שייך לגיליון. */
      this.previousIds = o.previousIds || (() => []);
      /** `Capabilities`: יכולות חדשות של המארח (fetchFile, printFile). בלי זה — מסלול ישן בלבד. */
      this.caps = o.caps || null;
      /** מזהה גיליון ← קובץ מרוחק שהמארח הוריד לתיקיית מטמון פרטית: `{ token, url, name, size, at }`. */
      this.remote = new Map();
      this.fetchImpl = o.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
      /** מזהה קצר ← `{ path, size, modified, name }`. */
      this.disk = new Map();
      this.diskState = { status: 'unknown', scannedAt: 0, partial: false, count: 0, bytes: 0 };
      this.jobs = new Map();
      this.order = [];
      this.active = 0;
      this.lastStart = 0;
      this.listeners = new Set();
      this.diskListeners = new Set();
      this.scanning = null;
    }

    onChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    onDisk(fn) {
      this.diskListeners.add(fn);
      return () => this.diskListeners.delete(fn);
    }

    _emit() {
      for (const fn of this.listeners) {
        try {
          fn();
        } catch (error) {
          this.log.warn('files listener failed', error);
        }
      }
    }

    _emitDisk() {
      for (const fn of this.diskListeners) {
        try {
          fn();
        } catch (error) {
          this.log.warn('disk listener failed', error);
        }
      }
    }

    // -------------------------------------------------------- תיקייה

    get folder() {
      return this.getFolder();
    }

    get hasFolder() {
      return Boolean(this.folder && this.folder.token);
    }

    /**
     * בחירת תיקייה: דיאלוג של אוצריא. חייב לבוא ישירות מלחיצה. מחזיר
     * `{ ok, cancelled, folder }`. זורק [FileError] בכשל (`forbidden`: תיקייה
     * מוגנת, `permission`: אין הרשאה).
     */
    async pickFolder() {
      let data;
      try {
        data = await this.runtime.call('fs.pickUserFolder', {
          title: 'בחרו תיקייה לשמירת העלונים',
        });
      } catch (error) {
        if (error.code === 'error.forbidden') throw new FileError('forbidden_folder');
        if (error.isUnsupported) throw new FileError('permission');
        throw new FileError('pick_failed', error.code);
      }
      if (!data || data.cancelled || !data.folderToken) return { ok: false, cancelled: true };
      const folder = { token: data.folderToken, name: data.name || '', path: trimSlash(data.path) };
      this.setFolder(folder);
      this.disk = new Map();
      this.diskState = { status: 'unknown', scannedAt: 0, partial: false, count: 0, bytes: 0 };
      this._emitDisk();
      return { ok: true, folder };
    }

    /** מסיר את הגישה הקבועה (`fs.revokeFolder`) ושוכח את התיקייה. */
    async forgetFolder() {
      const folder = this.folder;
      this.setFolder(null);
      this.disk = new Map();
      this.diskState = { status: 'nofolder', scannedAt: 0, partial: false, count: 0, bytes: 0 };
      if (folder) await this.runtime.callSoft('fs.revokeFolder', { folderToken: folder.token });
      this._emitDisk();
    }

    // ----------------------------------------------------------- דיסק

    /** שם הנתיב היחסי (שנה/סדרה/קובץ) של גיליון בתיקייה. */
    relPath(item) {
      const p = Core.downloadPath(item, item.seriesTitle || item.title);
      return p.dir + '/' + p.file;
    }

    readPath(item) {
      return READ_DIR + '/' + Core.idFragment(item.id) + '.pdf';
    }

    absolute(rel) {
      return trimSlash(this.folder.path) + '/' + rel;
    }

    /**
     * המזהה הקצר שתחתיו הקובץ בדיסק: של הגיליון, ואם אין — של מזהה קודם שלו
     * (`previousIds`); אם אין קובץ — המזהה הנוכחי (לשמירה חדשה).
     */
    fragmentOf(item) {
      const own = Core.idFragment(item.id);
      if (this.disk.has(own)) return own;
      for (const old of this.previousIds(item.id)) {
        const fragment = Core.idFragment(old);
        if (this.disk.has(fragment)) return fragment;
      }
      return own;
    }

    isDownloaded(item) {
      return this.disk.has(this.fragmentOf(item));
    }

    diskEntry(item) {
      return this.disk.get(this.fragmentOf(item)) || null;
    }

    async _list(path, extensions) {
      const payload = { folderToken: this.folder.token };
      if (path) payload.path = path;
      if (extensions) payload.extensions = extensions;
      return this.runtime.call('fs.listUserFolder', payload);
    }

    /**
     * סורק את התיקייה: שורש ← שנים ← סדרות ← קבצים. שיטה אחת בכל רגע. כשל
     * קריאה אינו "אין קבצים": המפה הקודמת נשמרת והסטטוס אומר מה קרה.
     */
    scan() {
      if (!this.hasFolder) {
        this.diskState = { status: 'nofolder', scannedAt: 0, partial: false, count: 0, bytes: 0 };
        this.disk = new Map();
        this._emitDisk();
        return Promise.resolve(this.diskState);
      }
      if (this.scanning) return this.scanning;
      this.scanning = this._scan().finally(() => {
        this.scanning = null;
      });
      return this.scanning;
    }

    async _scan() {
      const found = new Map();
      let partial = false;
      try {
        const root = await this._list('');
        partial = Boolean(root.truncated);
        const years = (root.entries || []).filter((e) => e.type === 'dir' && e.name !== READ_DIR);
        const seriesDirs = [];
        await this._pool(years, SCAN_PARALLEL, async (year) => {
          const list = await this._list(year.path);
          partial = partial || Boolean(list.truncated);
          for (const e of list.entries || []) if (e.type === 'dir') seriesDirs.push(e);
        });
        await this._pool(seriesDirs, SCAN_PARALLEL, async (dir) => {
          const list = await this._list(dir.path, ['pdf']);
          partial = partial || Boolean(list.truncated);
          for (const e of list.entries || []) {
            if (e.type !== 'file') continue;
            const fragment = Core.fragmentFromFile(e.name);
            if (fragment)
              found.set(fragment, {
                path: e.path,
                name: e.name,
                size: e.size || 0,
                modified: e.modified || null,
              });
          }
        });
      } catch (error) {
        const message = String(error.hostMessage || error.message || '');
        const status = /unknown folder token/i.test(message)
          ? 'revoked'
          : /no longer exists/i.test(message) || error.code === 'error.not_found'
            ? 'missing'
            : 'error';
        this.log.warn('disk scan failed: ' + status, error);
        this.diskState = { ...this.diskState, status };
        if (status === 'revoked') this.disk = new Map();
        this._emitDisk();
        return this.diskState;
      }
      this.disk = found;
      let bytes = 0;
      for (const e of found.values()) bytes += e.size;
      this.diskState = { status: 'ok', scannedAt: this.now(), partial, count: found.size, bytes };
      this._emitDisk();
      return this.diskState;
    }

    async _pool(list, size, fn) {
      let cursor = 0;
      const workers = Array.from({ length: Math.min(size, list.length) }, async () => {
        while (cursor < list.length) await fn(list[cursor++]);
      });
      await Promise.all(workers);
    }

    /** מוחק קובץ שהורד (אחרי אישור של ה-UI). */
    async deleteDownloaded(fragment) {
      const entry = this.disk.get(fragment);
      if (!entry || !this.hasFolder) return false;
      await this.runtime.call('fs.deleteFile', { path: this.absolute(entry.path) });
      this.disk.delete(fragment);
      this._emitDisk();
      return true;
    }

    // ------------------------------------------------------------ תור

    jobFor(item) {
      return this.jobs.get(item.id) || null;
    }

    /** כל העבודות, החדשה ראשונה בסוף הרשימה. */
    list() {
      return this.order.map((id) => this.jobs.get(id)).filter(Boolean);
    }

    get busy() {
      return this.list().some((j) => j.status === 'queued' || j.status === 'active');
    }

    /**
     * מוסיף לתור. `mode`: `save` (קבוע) או `read` (זמני לקריאה). העבודה
     * מחזירה הבטחה ב-`job.done` שנפתרת בסיום (גם בכשל; לא נדחית).
     */
    enqueue(item, mode, srcOverride) {
      const existing = this.jobs.get(item.id);
      if (existing && (existing.status === 'queued' || existing.status === 'active')) {
        // קריאה שהתבקשה אחריה שמירה: משדרגים את העבודה הקיימת.
        if (mode === 'save') existing.mode = 'save';
        this._emit();
        return existing;
      }
      let finish;
      const job = {
        id: item.id,
        item: {
          id: item.id,
          title: item.title,
          seriesTitle: item.seriesTitle,
          hy: item.hy,
          date: item.date,
          parasha: item.parasha,
          event: item.event,
          no: item.no,
          assets: item.assets,
          series: item.series,
        },
        mode: mode === 'save' ? 'save' : 'read',
        status: 'queued',
        error: null,
        result: null,
        asset: null,
        queuedAt: this.now(),
        startedAt: 0,
        endedAt: 0,
        cancelled: false,
        src: srcOverride || '',
        done: null,
      };
      job.done = new Promise((resolve) => {
        finish = resolve;
      });
      job._finish = finish;
      this.jobs.set(item.id, job);
      this.order = this.order.filter((id) => id !== item.id);
      this.order.push(item.id);
      this._emit();
      this._pump();
      return job;
    }

    cancel(id) {
      const job = this.jobs.get(id);
      if (!job) return;
      job.cancelled = true;
      if (job.status === 'queued') this._end(job, 'cancelled', null);
      else this._emit();
    }

    /** חוזר אחרי כשל. */
    retry(id) {
      const job = this.jobs.get(id);
      if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return null;
      return this.enqueue({ ...job.item }, job.mode, job.src);
    }

    clearFinished() {
      for (const job of this.list()) {
        if (job.status === 'done' || job.status === 'cancelled' || job.status === 'failed')
          this.jobs.delete(job.id);
      }
      this.order = this.order.filter((id) => this.jobs.has(id));
      this._emit();
    }

    async _pump() {
      while (this.active < CONCURRENCY) {
        const next = this.order
          .map((id) => this.jobs.get(id))
          .find((j) => j && j.status === 'queued');
        if (!next) return;
        next.status = 'active';
        next.startedAt = this.now();
        this.active++;
        this._emit();
        const gap = this.lastStart + START_GAP_MS - this.now();
        this.lastStart = this.now() + Math.max(0, gap);
        this._run(next, Math.max(0, gap)).finally(() => {
          this.active--;
          this._pump();
        });
      }
    }

    _end(job, status, error) {
      job.status = status;
      job.error = error;
      job.endedAt = this.now();
      this._emit();
      job._finish(job);
    }

    async _run(job, delay) {
      try {
        if (delay) await this.sleep(delay);
        if (job.cancelled) return this._end(job, 'cancelled', null);
        const result = await this._execute(job);
        if (job.cancelled) {
          // אי אפשר לעצור הורדה שכבר רצה: מנקים את מה שירד.
          await this._discard(job, result);
          return this._end(job, 'cancelled', null);
        }
        job.result = result;
        this._end(job, 'done', null);
      } catch (error) {
        const fe =
          error instanceof FileError ? error : new FileError('failed', error && error.code);
        this.log.warn('download failed ' + job.id + ' ' + fe.code, error);
        this._end(job, 'failed', { code: fe.code });
      }
    }

    async _discard(job, result) {
      if (!result || !this.hasFolder) return;
      await this.runtime.callSoft('fs.deleteFile', { path: this.absolute(result.rel) });
      this.disk.delete(Core.idFragment(job.id));
    }

    /** מוריד/מזיז לפי המצב; מחזיר `{ rel, size, verified, saved }`. */
    async _execute(job) {
      if (!this.hasFolder) throw new FileError('no_folder');
      const item = job.item;
      const fragment = this.fragmentOf(item);
      const permanent = this.relPath(item);
      const temp = this.readPath(item);
      const disk = this.disk.get(fragment);
      if (disk) return { rel: disk.path, size: disk.size, verified: 'disk', saved: true };

      // יש כבר עותק לקריאה, והמשתמש מבקש לשמור: מזיזים, לא מורידים שוב.
      if (job.mode === 'save') {
        const moved = await this._moveFromReadCache(item, temp, permanent);
        if (moved) return moved;
      } else if (await this._exists(temp)) {
        return { rel: temp, size: 0, verified: 'cache', saved: false };
      }

      const { asset, reason } = pickAsset(
        item,
        job.src || this.preferredSource(item),
        this.hiddenSources(item),
      );
      if (!asset) throw new FileError(reason === 'blocked' ? 'blocked' : 'no_direct_link');
      job.asset = asset;
      const rel = job.mode === 'save' ? permanent : temp;
      const url = Core.parseUrl(asset.url).href;
      try {
        await this.runtime.call('network.download', {
          url,
          destPath: this.absolute(rel),
          resume: true,
        });
      } catch (error) {
        if (error.code === 'error.forbidden') throw new FileError('blocked');
        if (error.code === 'permission_denied' || error.code === 'error.permission_denied')
          throw new FileError('permission');
        if (error.code === 'error.timeout') throw new FileError('timeout');
        throw new FileError('failed', error.code);
      }
      const verified = await this._verify(rel, asset);
      if (job.mode === 'save') {
        this.disk.set(fragment, {
          path: rel,
          name: rel.split('/').pop(),
          size: verified.size,
          modified: new Date(this.now()).toISOString(),
        });
        this._emitDisk();
      } else {
        this._pruneReadCache();
      }
      return { rel, size: verified.size, verified: verified.how, saved: job.mode === 'save' };
    }

    async _exists(rel) {
      try {
        const dir = rel.split('/').slice(0, -1).join('/');
        const list = await this._list(dir, ['pdf']);
        return (list.entries || []).some((e) => e.path === rel && e.size >= MIN_PDF_BYTES);
      } catch (error) {
        return false;
      }
    }

    async _moveFromReadCache(item, temp, permanent) {
      if (!(await this._exists(temp))) return null;
      try {
        await this.runtime.call('fs.moveEntry', {
          from: this.absolute(temp),
          to: this.absolute(permanent),
        });
      } catch (error) {
        this.log.warn('move failed', error);
        return null;
      }
      this.disk.set(Core.idFragment(item.id), {
        path: permanent,
        name: permanent.split('/').pop(),
        size: 0,
        modified: new Date(this.now()).toISOString(),
      });
      this._emitDisk();
      return { rel: permanent, size: 0, verified: 'moved', saved: true };
    }

    /**
     * בדיקת הקובץ שירד: גודל סביר (אחרת דף שגיאה שנשמר בטעות), ואם אפשר גם
     * `%PDF-` בתחילתו. קובץ פגום נמחק וההורדה נחשבת כושלת.
     */
    async _verify(rel, asset) {
      let size = 0;
      try {
        const dir = rel.split('/').slice(0, -1).join('/');
        const list = await this._list(dir, ['pdf']);
        const entry = (list.entries || []).find((e) => e.path === rel);
        size = entry ? entry.size || 0 : 0;
      } catch (error) {
        this.log.warn('verify list failed', error);
      }
      const tooSmall = size > 0 && size < MIN_PDF_BYTES;
      const truncated = size > 0 && asset && asset.bytes > 0 && size < asset.bytes * 0.5;
      let how = size ? 'size' : 'unknown';
      let header = null;
      if (!tooSmall && !truncated) header = await this._readHeader(rel);
      if (header === false || tooSmall || truncated) {
        await this.runtime.callSoft('fs.deleteFile', { path: this.absolute(rel) });
        throw new FileError(header === false || tooSmall ? 'not_pdf' : 'truncated');
      }
      if (header === true) how = 'header';
      return { size, how };
    }

    /** `true`/`false` לפי `%PDF-`, או `null` כשאי אפשר לקרוא (CORS, שרת קבצים). */
    async _readHeader(rel) {
      if (!this.fetchImpl) return null;
      try {
        const file = await this.runtime.call('fs.openFolderFile', {
          folderToken: this.folder.token,
          path: rel,
        });
        if (!file || !file.url) return null;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
        try {
          const res = await this.fetchImpl(file.url, {
            headers: { Range: 'bytes=0-7' },
            signal: controller && controller.signal,
          });
          const bytes = new Uint8Array(await res.arrayBuffer()).slice(0, 5);
          return String.fromCharCode(...bytes) === '%PDF-';
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch (error) {
        return null;
      }
    }

    /** משאיר ב-`_קריאה` את ${READ_KEEP} האחרונים. */
    async _pruneReadCache() {
      try {
        const list = await this._list(READ_DIR, ['pdf']);
        const files = (list.entries || [])
          .filter((e) => e.type === 'file')
          .sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
        for (const e of files.slice(READ_KEEP))
          await this.runtime.callSoft('fs.deleteFile', { path: this.absolute(e.path) });
      } catch (error) {
        // התיקייה עוד לא קיימת, או נכשל: ניקוי הוא עניין של נוחות.
      }
    }

    /** כמה קבצים (ובייטים) ב-`_קריאה`, התיקייה הזמנית של הקריאה. */
    async readCacheInfo() {
      if (!this.hasFolder) return { count: 0, bytes: 0 };
      try {
        const list = await this._list(READ_DIR, ['pdf']);
        const files = (list.entries || []).filter((e) => e.type === 'file');
        return { count: files.length, bytes: files.reduce((n, e) => n + (e.size || 0), 0) };
      } catch (error) {
        return { count: 0, bytes: 0 };
      }
    }

    /** מוחק את כל קבצי הקריאה הזמניים (לא נוגע בקבצים שנשמרו). מחזיר כמה נמחקו. */
    async clearReadCache() {
      if (!this.hasFolder) return 0;
      let removed = 0;
      try {
        const list = await this._list(READ_DIR, ['pdf']);
        for (const e of (list.entries || []).filter((x) => x.type === 'file')) {
          const result = await this.runtime.callSoft('fs.deleteFile', {
            path: this.absolute(e.path),
          });
          if (result !== null) removed++;
        }
      } catch (error) {
        this.log.warn('clear read cache failed', error);
      }
      return removed;
    }

    // ------------------------------------------- קובץ מרוחק (0.9.99)

    /** האם אפשר לקרוא גיליון בלי תיקייה: `network.fetchFile` זמין. */
    get canReadRemote() {
      return Boolean(this.caps && this.caps.has('fetchFile'));
    }

    /**
     * קובץ הגיליון מהמקור ישירות למטמון פרטי של המארח, בלי לשמור בתיקיית המשתמש:
     * `{ url, token, name, size, remote: true }`. אותה בדיקת allowlist כמו הורדה.
     * זורק `UnsupportedError` כשהיכולת חסרה (הקורא נופל להורדה), ו-[FileError] אחרת.
     */
    async openRemote(item) {
      const cached = this.remote.get(item.id);
      if (cached && this.now() - cached.at < REMOTE_TTL_MS)
        return { ...cached, remote: true, saved: false };
      const { asset, reason } = pickAsset(
        item,
        this.preferredSource(item),
        this.hiddenSources(item),
      );
      if (!asset) throw new FileError(reason === 'blocked' ? 'blocked' : 'no_direct_link');
      const url = Core.parseUrl(asset.url).href;
      let data;
      try {
        data = await this.caps.call('fetchFile', this.runtime, {
          url,
          timeoutMs: 90000,
          maxBytes: HOST_FETCH_MAX_BYTES,
        });
      } catch (error) {
        if (error && error.isUnsupported && error.name === 'UnsupportedError') throw error;
        if (error.code === 'error.forbidden') throw new FileError('blocked');
        if (error.code === 'permission_denied' || error.code === 'error.permission_denied')
          throw new FileError('permission');
        if (error.code === 'error.timeout') throw new FileError('timeout');
        if (error.code === 'error.too_large') throw new FileError('too_large');
        throw new FileError('failed', error.code);
      }
      if (!data || !data.token || !data.url) throw new FileError('failed', 'bad fetchFile result');
      // דף שגיאה (HTML) במקום PDF: מוחקים את ההענקה ולא מציגים.
      if (
        (data.mime && !/pdf/i.test(String(data.mime))) ||
        (data.size > 0 && data.size < MIN_PDF_BYTES)
      ) {
        this.releaseToken(data.token);
        throw new FileError('not_pdf');
      }
      const entry = {
        token: data.token,
        url: data.url,
        name: data.name || 'file.pdf',
        size: data.size || 0,
        at: this.now(),
      };
      // המארח קובע mime לפי סיומת הכתובת ולא לפי התוכן: דף HTML בתשובה 200 תחת כתובת `.pdf`
      // (חומת התחברות, הגבלת קצב) עובר את הבדיקה למעלה ומציג צפיין שבור. בודקים את הכותרת בעצמנו.
      if (!(await this._looksLikePdf(data.url))) {
        this.releaseToken(data.token);
        throw new FileError('not_pdf');
      }
      this.remote.set(item.id, entry);
      this._pruneRemote();
      return { ...entry, remote: true, saved: false };
    }

    /**
     * האם הקובץ המוענק מתחיל ב-`%PDF-` (בתוך 1KB הראשונים, כמו הצפיינים). קריאה חלקית בלבד,
     * גם כששרת הקבצים מתעלם מ-Range. אם אי אפשר לבדוק — לא חוסמים.
     */
    async _looksLikePdf(url) {
      if (!this.fetchImpl) return true;
      try {
        const res = await this.fetchImpl(url, { headers: { Range: 'bytes=0-1023' } });
        if (!res || !res.ok) return true;
        let head;
        const reader =
          res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
        if (reader) {
          const first = await reader.read();
          reader.cancel().catch(() => {});
          head = first && first.value ? first.value.subarray(0, 1024) : new Uint8Array(0);
        } else {
          head = new Uint8Array(await (await res.blob()).slice(0, 1024).arrayBuffer());
        }
        return String.fromCharCode(...head).includes('%PDF-');
      } catch (error) {
        this.log.debug('pdf header check skipped', error);
        return true;
      }
    }

    /** משאיר רק את הקבצים המרוחקים האחרונים (ההענקה האחרת מבוטלת). */
    _pruneRemote() {
      while (this.remote.size > REMOTE_KEEP) {
        const [id, entry] = this.remote.entries().next().value;
        this.remote.delete(id);
        this.releaseToken(entry.token);
      }
    }

    /** מבטל הענקת קובץ (fs.revokeFile); כשל אינו מפריע. */
    releaseToken(token) {
      if (token) this.runtime.callSoft('fs.revokeFile', { token });
    }

    /** מבטל את כל ההענקות של קבצים מרוחקים (סגירת התוסף, ניקוי). */
    releaseRemote() {
      for (const entry of this.remote.values()) this.releaseToken(entry.token);
      this.remote.clear();
    }

    /**
     * הדפסת קובץ דרך המארח (`ui.printFile`): `{ printed }`. זורק `UnsupportedError`
     * כשהיכולת חסרה. דורש פעולת משתמש (המארח קובע).
     */
    async printToken(token, jobName) {
      if (!this.caps) throw new A.Capabilities.UnsupportedError('printFile', 'no-caps');
      const payload = { token };
      if (jobName) payload.jobName = String(jobName).slice(0, 120);
      const result = await this.caps.call('printFile', this.runtime, payload);
      return { printed: Boolean(result && result.printed) };
    }

    // ----------------------------------------------------------- קריאה

    /**
     * מוכן לצפייה: קובץ מקומי (קבוע או זמני) → `{ url, token, name, size,
     * rel }`; אם אין — מוריד ל-`_קריאה` קודם (`onJob` מקבל את העבודה לחיווי).
     * זורק [FileError].
     */
    async openForReading(item, onJob) {
      const rel = this.hasFolder && this.isDownloaded(item) ? this.diskEntry(item).path : null;
      // יכולת חדשה: קובץ מרוחק בלי שמירה. נכשלה כיכולת — יורדים לתיקייה כמקודם.
      if (!rel && this.canReadRemote) {
        try {
          return await this.openRemote(item);
        } catch (error) {
          if (!(error && error.name === 'UnsupportedError')) throw error;
        }
      }
      if (!this.hasFolder) throw new FileError('no_folder');
      let target = rel;
      if (!target) {
        const job = this.enqueue(item, 'read');
        if (onJob) onJob(job);
        const finished = await job.done;
        if (finished.status === 'cancelled') throw new FileError('cancelled');
        if (finished.status === 'failed') throw new FileError(finished.error.code);
        target = finished.result.rel;
      }
      try {
        const file = await this.runtime.call('fs.openFolderFile', {
          folderToken: this.folder.token,
          path: target,
        });
        return {
          url: file.url,
          token: file.token,
          name: file.name,
          size: file.size,
          rel: target,
          saved: Boolean(rel) || !target.startsWith(READ_DIR + '/'),
        };
      } catch (error) {
        if (error.code === 'error.not_found') {
          this.disk.delete(this.fragmentOf(item));
          throw new FileError('missing_file');
        }
        throw new FileError('open_failed', error.code);
      }
    }

    /**
     * כתובת Blob לצפיין. שרת הקבצים של אוצריא שולח `X-Frame-Options: SAMEORIGIN`,
     * ודף התוסף הוא `file://` (ממקור אחר), ולכן `<iframe src=url>` נחסם. `fetch`
     * מותר (CORS), וכתובת `blob:` אינה נושאת את הכותרת. זורק [FileError].
     */
    /** כתובת להצגה ב-iframe. מהמארח החדש — הכתובת ישירות; אחרת Blob (ראו README: X-Frame-Options). */
    async readBlobUrl(file) {
      const urlApi = root.URL;
      if (!this.fetchImpl || !urlApi || typeof urlApi.createObjectURL !== 'function')
        throw new FileError('open_failed', 'no fetch/blob');
      let blob;
      try {
        const res = await this.fetchImpl(file.url);
        if (!res.ok) throw new Error('http ' + res.status);
        blob = await res.blob();
        const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
        if (String.fromCharCode(...head) !== '%PDF-') throw new Error('not a pdf');
      } catch (error) {
        throw new FileError('open_failed', error && error.message);
      }
      return urlApi.createObjectURL(
        blob.type === 'application/pdf' ? blob : new root.Blob([blob], { type: 'application/pdf' }),
      );
    }

    releaseBlobUrl(url) {
      if (url && root.URL && typeof root.URL.revokeObjectURL === 'function')
        root.URL.revokeObjectURL(url);
    }

    // ---------------------------------------------------------- הדפסה

    /**
     * מסלול א: הדפסה מתוך ה-iframe של הצפיין. ב-WebView האמיתי ה-iframe הוא
     * ממקור אחר (שרת הקבצים של אוצריא), ולכן הגישה נחסמת: `false`, וה-UI עובר
     * למסלול הבא. עטוף ב-try/catch כי חסימה זורקת.
     */
    printViaFrame(frame) {
      try {
        const win = frame && frame.contentWindow;
        if (!win || typeof win.print !== 'function') return false;
        win.focus();
        win.print();
        return true;
      } catch (error) {
        return false;
      }
    }

    /**
     * מסלול ב: פתיחה בקורא של אוצריא, שבו יש הדפסה. דורש שהתיקייה מוגדרת
     * באוצריא כתיקייה אישית. `{ ok, reason }`: `permission` (חסרה הרשאה),
     * `not_indexed` (אוצריא לא רואה את הקובץ — בדרך כלל התיקייה אינה תיקייה
     * אישית), `error`.
     */
    async openInReader(item) {
      const fragment = this.fragmentOf(item);
      const entry = this.disk.get(fragment);
      if (!entry) return { ok: false, reason: 'not_saved' };
      // סריקה מחדש של התיקיות האישיות, כדי שהקובץ שזה עתה ירד ייכנס לספרייה.
      // כשל בה אינו עוצר: ייתכן שהקובץ כבר מאונדקס.
      await this.runtime.callSoft('library.refreshUserBooks', {});
      const baseName = entry.name.replace(/\.pdf$/i, '');
      let books = null;
      for (const query of [baseName, '[' + fragment + ']', fragment]) {
        try {
          books = await this.runtime.call('library.findBooks', { query, limit: 10 });
        } catch (error) {
          return { ok: false, reason: error.isUnsupported ? 'permission' : 'error' };
        }
        if (
          Array.isArray(books) &&
          books.some((b) => String(b.title || b.bookId || '').includes(fragment))
        )
          break;
      }
      const book = (books || []).find((b) => String(b.title || b.bookId || '').includes(fragment));
      if (!book) return { ok: false, reason: 'not_indexed' };
      try {
        const opened = await this.runtime.call(
          'reader.openBook',
          book.bookUid
            ? { bookUid: book.bookUid }
            : { id: book.id, bookId: book.bookId, type: book.type || 'pdf' },
        );
        return { ok: opened !== false, reason: opened === false ? 'not_indexed' : null };
      } catch (error) {
        return { ok: false, reason: error.isUnsupported ? 'permission' : 'error' };
      }
    }

    // ---------------------------------------------------- האתר המקורי

    /** פותח את אתר המקור בדפדפן, אחרי אימות הכתובת. `false` אם אינה בטוחה. */
    async openOnSite(url, extraHosts) {
      if (!Core.isSiteUrl(url, extraHosts) && !Core.isDownloadUrl(url)) return false;
      const ok = await this.runtime.callSoft(
        'app.openUrl',
        { url: Core.parseUrl(url).href },
        false,
      );
      return ok !== false;
    }
  }

  const api = {
    Files,
    FileError,
    pickAsset,
    READ_DIR,
    MIN_PDF_BYTES,
    MAX_INLINE_BYTES,
    HOST_FETCH_MAX_BYTES,
  };
  A.Files = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
