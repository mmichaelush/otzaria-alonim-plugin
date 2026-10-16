// סנכרון הקטלוג: מניפסט → גיבוב → הורדת קבצים ושרדים אל ה-`fs` הפרטי. ציור
// ראשון מהיר: ממטמון בביקור שני (מיד), ובביקור ראשון מניפסט → recent → ציור,
// והשרדים בהמשך, ברקע, בלי לחסום. אין DOM כאן: התוצאה זורמת באירועים.
//
// אירועי נתונים (`onData`): `{ kind: 'series'|'weeks'|'recent'|'shard', data,
// id?, cached }`. סטטוס (`onStatus`): `{ phase, done, total, ... }`.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;

  const DIR = 'catalog';
  /** תקרת המטמון בדיסק (מתוך מכסת 100MB של ה-fs הפרטי) וכמה מהשרדים נטען אוטומטית. */
  const CACHE_CAP = 50 * 1024 * 1024;
  const WARM_BYTES = 40 * 1024 * 1024;
  const WRITE_LIMIT = 9.5 * 1024 * 1024;
  const PACE_MS = 120;
  const PARALLEL = 2;
  const RETRY_DELAYS = [60000, 300000, 900000];

  const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** SHA-256 הקס של טקסט (UTF-8), או `null` כשאין `crypto.subtle`. */
  async function sha256Hex(text) {
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle) return null;
    const bytes = new TextEncoder().encode(text);
    const digest = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return undefined;
    }
  }

  /** שמות הקבצים בקטלוג: שרד תקין הוא `5787`, `5787-2` או `timeless`. */
  const validShardId = (id) => /^(\d{4}(-\d+)?|timeless)$/.test(String(id));
  const FILE_KEYS = ['recent', 'series', 'weeks'];

  class Catalog {
    /**
     * [runtime] מ-`createRuntime`; [options]: `{ base, log, now, sleep, online() }`
     * (`online` מחזיר true/false/null לפי `app.getConnectivity`).
     */
    constructor(runtime, options) {
      const o = options || {};
      this.runtime = runtime;
      this.base = o.base || Core.CATALOG_BASE;
      this.log = o.log || { debug() {}, warn() {}, info() {}, error() {} };
      this.now = o.now || (() => Date.now());
      this.sleep = o.sleep || sleepDefault;
      this.online = o.online || (() => null);
      this.manifest = null;
      this.meta = { sha: {}, use: {}, catalogVersion: 0, lastOkAt: 0, lastCheckAt: 0 };
      /** נתיב → sha שכבר נשלח לאינדקס בהפעלה הזו. */
      this.emitted = new Map();
      this.shardPromises = new Map();
      /** נתיב מטמון ← טעינה בריצה (`_loadJob`). */
      this._jobs = new Map();
      this.dataListeners = new Set();
      this.statusListeners = new Set();
      this.status = {
        phase: 'idle',
        done: 0,
        total: 0,
        error: null,
        lastOkAt: 0,
        lastCheckAt: 0,
        schemaTooNew: false,
        pluginTooOld: false,
        fromCache: false,
        shardsLoaded: 0,
        shardsTotal: 0,
        failed: 0,
        /** משך טעינת המטמון והסנכרון האחרון (ms), לאבחון. */
        cacheMs: 0,
        lastSyncMs: 0,
      };
      this.suspended = false;
      this.retryTimer = null;
      this.retryStep = 0;
      this.syncing = null;
      this.usedBytes = 0;
      this.quotaBytes = 0;
    }

    onData(fn) {
      this.dataListeners.add(fn);
      return () => this.dataListeners.delete(fn);
    }

    onStatus(fn) {
      this.statusListeners.add(fn);
      return () => this.statusListeners.delete(fn);
    }

    _setStatus(patch) {
      Object.assign(this.status, patch);
      for (const fn of this.statusListeners) {
        try {
          fn(this.status);
        } catch (error) {
          this.log.warn('status listener failed', error);
        }
      }
    }

    _emitData(event) {
      for (const fn of this.dataListeners) {
        try {
          fn(event);
        } catch (error) {
          this.log.warn('data listener failed', error);
        }
      }
    }

    get sources() {
      return (this.manifest && Array.isArray(this.manifest.sources) && this.manifest.sources) || [];
    }

    get shards() {
      return (
        (this.manifest &&
          Array.isArray(this.manifest.shards) &&
          this.manifest.shards.filter((s) => s && validShardId(s.id))) ||
        []
      );
    }

    // ---------------------------------------------------------- מטמון

    async _read(path) {
      try {
        const data = await this.runtime.call('fs.readFile', { path: DIR + '/' + path });
        return data && typeof data.content === 'string' ? data.content : null;
      } catch (error) {
        if (error.code !== 'error.not_found') this.log.warn('cache read failed ' + path, error);
        return null;
      }
    }

    async _write(path, content) {
      if (content.length > WRITE_LIMIT) return false;
      try {
        const data = await this.runtime.call('fs.writeFile', { path: DIR + '/' + path, content });
        if (data && typeof data.usedBytes === 'number') {
          this.usedBytes = data.usedBytes;
          this.quotaBytes = data.quotaBytes || this.quotaBytes;
        }
        return true;
      } catch (error) {
        // מכסה או כשל כתיבה: הקטלוג עדיין בזיכרון, רק בלי מטמון לקובץ הזה.
        this.log.warn('cache write failed ' + path, error);
        return false;
      }
    }

    async _saveMeta() {
      await this._write('meta.json', JSON.stringify(this.meta));
    }

    /**
     * טוען מהמטמון ומודיע מיד: קודם series, weeks ו-recent (ציור), ואז השרדים
     * ברקע. מחזיר הבטחה שמסתיימת אחרי ה-recent, כשאפשר כבר לצייר.
     */
    async loadCache() {
      const startedAt = this.now();
      const metaText = await this._read('meta.json');
      const meta = metaText ? parseJson(metaText) : null;
      if (meta && typeof meta === 'object') {
        this.meta = { ...this.meta, ...meta, sha: meta.sha || {}, use: meta.use || {} };
      }
      const manifestText = await this._read('manifest.json');
      const manifest = manifestText ? parseJson(manifestText) : null;
      if (manifest && typeof manifest === 'object' && manifest.schema <= Core.SCHEMA) {
        this.manifest = manifest;
        this._emitData({ kind: 'sources', data: this.sources, cached: true });
      }
      this._setStatus({
        lastOkAt: this.meta.lastOkAt || 0,
        lastCheckAt: this.meta.lastCheckAt || 0,
      });
      const results = await Promise.all(
        FILE_KEYS.map((key) => this._loadCached(key + '.json', key)),
      );
      // לוח הארכיון (שנים ישנות): נטען מהמטמון רק אם המשתמש כבר ביקש אותו פעם.
      await this._loadCached('weeks-archive.json', 'weeksArchive');
      const hasAny = results.some(Boolean);
      if (hasAny) this._setStatus({ fromCache: true });
      this._setStatus({ shardsTotal: this.warmShards().length, cacheMs: this.now() - startedAt });
      return hasAny;
    }

    async _loadCached(path, kind, id) {
      const text = await this._read(path);
      if (text === null) return false;
      const data = parseJson(text);
      if (!Array.isArray(data)) return false;
      this.emitted.set(path, this.meta.sha[path] || 'cache');
      this._emitData({ kind, data, id: kind === 'recent' ? 'recent' : id, cached: true });
      return true;
    }

    /** שרדים שבמטמון, מהחדש לישן, בהפסקות כדי שהממשק יישאר רספונסיבי. */
    async loadCachedShards() {
      for (const entry of this.warmShards()) {
        if (this.suspended) break;
        const path = 'issues/' + entry.id + '.json';
        if (this.emitted.has(path)) continue;
        if (await this._loadCached(path, 'shard', entry.id)) {
          this.meta.use[entry.id] = this.meta.use[entry.id] || this.now();
          this._setStatus({ shardsLoaded: this._loadedShardCount() });
        }
        await this.sleep(0);
      }
    }

    _loadedShardCount() {
      return this.warmShards().filter((s) => this.emitted.has('issues/' + s.id + '.json')).length;
    }

    /** מפתח עדכניות: תאריך השבת האחרון בשרד, או סוף השנה העברית שלו; חומר בלי שנה אחרון. */
    _recencyKey(shard) {
      if (shard.to) return String(shard.to);
      const m = /^(\d{4})/.exec(shard.id);
      return m ? Number(m[1]) - 3760 + '-12-31' : '0000-00-00';
    }

    _shardsByRecency() {
      return [...this.shards].sort(
        (a, b) => this._recencyKey(b).localeCompare(this._recencyKey(a)) || (a.id < b.id ? 1 : -1),
      );
    }

    /**
     * השרדים שנטענים אוטומטית: החדשים ביותר עד תקרת הנפח (הקטלוג המלא גדול מדי
     * לדיסק ולזיכרון). השאר "קרים": נטענים לפי דרישה (מסנן שנה, דף סדרה, "שנים ישנות").
     */
    warmShards() {
      const out = [];
      let total = 0;
      for (const shard of this._shardsByRecency()) {
        if (out.length >= 2 && total + (shard.bytes || 0) > WARM_BYTES) break;
        out.push(shard);
        total += shard.bytes || 0;
      }
      return out;
    }

    coldShards() {
      const warm = new Set(this.warmShards().map((x) => x.id));
      return this._shardsByRecency().filter((x) => !warm.has(x.id));
    }

    // ----------------------------------------------------------- סנכרון

    /**
     * הפעלה: המטמון נטען וצויר מיד, והסנכרון רץ ברקע, בלי לחסום את `plugin.boot`
     * ואת הציור. מחזיר הבטחה לסיום הסנכרון (הקורא רשאי להתעלם ממנה).
     */
    async start() {
      await this.loadCache();
      // הציור הראשון (מ-series/weeks/recent שבמטמון) קודם לשרדים: אחרת טעינת השרדים הכבדים (כל אחד כמה עשרות ms
      // של פענוח ובנייה) הקדימה אותו, והכרטיס הראשון התעכב מ-60ms ל-300ms ויותר.
      await this.paintGap();
      const syncing = this.sync();
      this.loadCachedShards().catch((error) => this.log.warn('cached shards failed', error));
      return syncing;
    }

    /**
     * מחכה שהדפדפן יצייר (frame אחד), אבל לא יותר מ-120ms: דף נסתר אינו מצייר, והסנכרון אינו אמור להיתקע בגללו.
     * בלי דפדפן (בדיקות): `sleep(0)`.
     */
    paintGap() {
      const raf = root.requestAnimationFrame;
      if (typeof raf !== 'function') return this.sleep(0);
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, 120);
        raf.call(root, () => {
          clearTimeout(timer);
          setTimeout(resolve, 0);
        });
      });
    }

    /** כמו `start`, ומחכה לסיום הסנכרון (בדיקות). */
    async init() {
      return this.start();
    }

    /** מסנכרן בבת אחת, ובלי כפילות: קריאה בזמן סנכרון מחזירה את הרץ. */
    sync(options) {
      if (this.syncing) return this.syncing;
      // לעולם לא נדחה: קריאה בלי await (טיימר ניסיון חוזר, חזרה לרשת) לא תיצור דחייה שאיש אינו תופס.
      const startedAt = this.now();
      this.syncing = this._sync(options || {})
        .catch((error) => this._fail(error))
        .finally(() => {
          this.syncing = null;
          this.status.lastSyncMs = this.now() - startedAt;
        });
      return this.syncing;
    }

    async _sync(options) {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.online() === false) {
        this._setStatus({ phase: 'offline', error: null });
        return false;
      }
      this._setStatus({ phase: 'checking', error: null, done: 0, total: 0, failed: 0 });
      let manifest;
      try {
        const { text } = await this._fetchWithRetry('manifest.json', 'manifest.json');
        manifest = parseJson(text);
      } catch (error) {
        return this._fail(error);
      }
      if (!manifest || typeof manifest !== 'object' || typeof manifest.schema !== 'number') {
        return this._fail({ code: 'bad_schema' });
      }
      if (manifest.schema > Core.SCHEMA) {
        this._setStatus({ phase: 'idle', schemaTooNew: true, lastCheckAt: this.now() });
        return false;
      }
      if (
        manifest.minPluginVersion &&
        compareVersions(manifest.minPluginVersion, Core.PLUGIN_VERSION) > 0
      ) {
        this._setStatus({ pluginTooOld: true });
      }
      this.manifest = manifest;
      this._emitData({ kind: 'sources', data: this.sources, cached: false });
      this.meta.lastCheckAt = this.now();
      this._setStatus({
        lastCheckAt: this.meta.lastCheckAt,
        schemaTooNew: false,
        shardsTotal: this.warmShards().length,
      });

      const files = manifest.files || {};
      const plan = [];
      for (const key of FILE_KEYS) {
        if (files[key] && files[key].path)
          plan.push({
            kind: key,
            path: files[key].path,
            entry: files[key],
            cachePath: key + '.json',
          });
      }
      // הארכיון מתעדכן רק אם כבר נטען (לפי בקשה).
      const archive = this.weeksArchiveEntry();
      if (archive && this.emitted.has('weeks-archive.json'))
        plan.push({
          kind: 'weeksArchive',
          path: archive.path,
          entry: archive,
          cachePath: 'weeks-archive.json',
        });
      for (const shard of this.warmShards()) {
        plan.push({
          kind: 'shard',
          id: shard.id,
          path: shard.path,
          entry: shard,
          cachePath: 'issues/' + shard.id + '.json',
        });
      }
      const needed = plan
        .filter((p) => options.force || this._stale(p))
        .map((p) => ({ ...p, force: Boolean(options.force) }));
      this._setStatus({
        phase: needed.length ? 'downloading' : 'idle',
        total: needed.length,
        done: 0,
      });
      let failed = 0;
      /** @type {any} */
      let firstError = null;
      let cursor = 0;
      const worker = async () => {
        while (cursor < needed.length && !this.suspended) {
          const job = needed[cursor++];
          try {
            await this._loadJob(job);
          } catch (error) {
            failed++;
            firstError = firstError || error;
            this.log.warn('catalog file failed ' + job.path, error);
          }
          this._setStatus({ done: this.status.done + 1, failed });
          await this.sleep(PACE_MS);
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));

      // הושהה באמצע: קבצים לא הורדו ולא נכשלו. לא מתעדים הצלחה, וחזרה מההשהיה מסנכרנת מחדש.
      const interrupted = cursor < needed.length;
      this.interrupted = interrupted;
      await this._write('manifest.json', JSON.stringify(manifest));
      if (!failed && !interrupted) this.meta.catalogVersion = manifest.catalogVersion || 0;
      if (!failed && !interrupted) {
        this.meta.lastOkAt = this.now();
        this._setStatus({ lastOkAt: this.meta.lastOkAt });
      }
      await this._saveMeta();
      await this._evictIfNeeded();
      this._setStatus({ shardsLoaded: this._loadedShardCount() });
      if (failed) {
        this._setStatus({
          phase: failed === needed.length ? 'error' : 'partial',
          error: firstError && (firstError.code || 'network'),
        });
        this._scheduleRetry();
        return false;
      }
      if (interrupted) {
        this._setStatus({ phase: 'idle', error: null });
        return false;
      }
      this.retryStep = 0;
      this._setStatus({ phase: 'idle', error: null, fromCache: false });
      return true;
    }

    /** האם הקובץ השתנה (גיבוב) או חסר במטמון/בזיכרון. */
    _stale(job) {
      const sha = job.entry.sha256 || '';
      if (this.emitted.has(job.cachePath) && this.meta.sha[job.cachePath] === sha && sha)
        return false;
      return true;
    }

    /** הורדה/טעינה של קובץ אחד; קריאות מקבילות לאותו קובץ (סנכרון + שנה לפי דרישה) חולקות ריצה אחת. */
    _loadJob(job) {
      const key = job.cachePath;
      let running = this._jobs.get(key);
      if (!running) {
        running = this._loadJobNow(job).finally(() => this._jobs.delete(key));
        this._jobs.set(key, running);
      }
      return running;
    }

    async _loadJobNow(job) {
      const sha = job.entry.sha256 || '';
      // התכנון נעשה לפני ש-loadCachedShards סיים: קובץ שנטען מהמטמון בינתיים אינו יורד שוב.
      if (!job.force && !this._stale(job)) return;
      // המטמון עדכני, רק עוד לא נטען לזיכרון (ביקור שני: שרד שעוד לא עלה).
      if (sha && this.meta.sha[job.cachePath] === sha && !this.emitted.has(job.cachePath)) {
        if (await this._loadCached(job.cachePath, job.kind, job.id)) return;
      }
      const { text } = await this._fetchWithRetry(job.path, job.path, sha, job.entry);
      const data = parseJson(text);
      if (!Array.isArray(data)) throw Object.assign(new Error('bad file'), { code: 'bad_file' });
      this.emitted.set(job.cachePath, sha || 'net');
      this._emitData({
        kind: job.kind,
        data,
        id: job.kind === 'recent' ? 'recent' : job.id,
        cached: false,
      });
      this.meta.sha[job.cachePath] = sha;
      if (job.kind === 'shard') this.meta.use[job.id] = this.now();
      await this._write(job.cachePath, text);
    }

    /**
     * מוריד ומאמת: `sha256`/`bytes` מהמניפסט. אי-התאמה (מטמון CDN ישן) = ניסיון
     * נוסף עם פרמטר שמעקף את המטמון; שגיאה קבועה (חסום, גדול מדי) אינה חוזרת.
     */
    async _fetchWithRetry(path, label, sha, entry) {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        const suffix =
          attempt > 0
            ? '?v=' + (this.manifest ? this.manifest.catalogVersion : attempt) + '-' + attempt
            : '';
        try {
          const res = await this.runtime.fetchText(this.base + path + suffix, {
            timeoutMs: entry && entry.bytes > 1000000 ? 90000 : 30000,
            maxBytes: Math.max(2 * 1024 * 1024, ((entry && entry.bytes) || 0) * 2 + 65536),
          });
          if (sha) {
            const actual = await sha256Hex(res.text);
            if (actual && actual !== sha)
              throw Object.assign(new Error('sha mismatch ' + label), { code: 'hash' });
          }
          return res;
        } catch (error) {
          lastError = error;
          const code = error.code;
          if (
            code === 'forbidden' ||
            code === 'blocked' ||
            code === 'permission' ||
            code === 'too_large'
          )
            throw error;
          if (attempt < 2) await this.sleep(code === 'hash' ? 300 : 800 * (attempt + 1));
        }
      }
      throw lastError;
    }

    _fail(error) {
      const code = (error && error.code) || 'network';
      this.log.warn('catalog sync failed: ' + code, error);
      this._setStatus({ phase: 'error', error: code, lastCheckAt: this.now() });
      if (code !== 'forbidden' && code !== 'permission') this._scheduleRetry();
      return false;
    }

    _scheduleRetry() {
      if (this.retryTimer || this.suspended) return;
      const delay = RETRY_DELAYS[Math.min(this.retryStep, RETRY_DELAYS.length - 1)];
      this.retryStep++;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.sync();
      }, delay);
      // ב-Node (בדיקות) טיימר ממתין לא מחזיק את התהליך חי.
      if (this.retryTimer && typeof this.retryTimer.unref === 'function') this.retryTimer.unref();
    }

    suspend() {
      this.suspended = true;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    }

    /** חזרה מהשהיה: סנכרון אם עברו יותר מ-10 דקות. */
    resume() {
      this.suspended = false;
      if (this.interrupted || this.now() - (this.status.lastCheckAt || 0) > 10 * 60 * 1000)
        this.sync();
      else this.loadCachedShards().catch((error) => this.log.warn('cached shards failed', error));
    }

    // -------------------------------------------------- שרדים לפי דרישה

    // ------------------------------------------------ לוח שנים ישנות

    /** רשומת `files.weeksArchive` במניפסט, או `null` (אין ארכיון בקטלוג). */
    weeksArchiveEntry() {
      const entry = this.manifest && this.manifest.files && this.manifest.files.weeksArchive;
      return entry && entry.path ? entry : null;
    }

    hasWeeksArchive() {
      return Boolean(this.weeksArchiveEntry());
    }

    weeksArchiveLoaded() {
      return this.emitted.has('weeks-archive.json');
    }

    /** טוען את לוח הארכיון (מהמטמון או מהרשת). `true` כשהוא בזיכרון. */
    ensureWeeksArchive() {
      if (this.weeksArchiveLoaded()) return Promise.resolve(true);
      // קריאות כפולות (פתיחה חוזרת של הבורר) חולקות הורדה אחת.
      if (!this._archivePromise) {
        this._archivePromise = this._ensureWeeksArchive().finally(() => {
          this._archivePromise = null;
        });
      }
      return this._archivePromise;
    }

    async _ensureWeeksArchive() {
      const entry = this.weeksArchiveEntry();
      if (!entry) return false;
      const job = {
        kind: 'weeksArchive',
        path: entry.path,
        entry,
        cachePath: 'weeks-archive.json',
      };
      try {
        if (this.online() === false) return await this._loadCached(job.cachePath, 'weeksArchive');
        await this._loadJob(job);
        await this._saveMeta();
        return true;
      } catch (error) {
        this.log.warn('weeks archive failed', error);
        return this._loadCached(job.cachePath, 'weeksArchive');
      }
    }

    /** שנה עברית → השרדים שלה (`5787`, `5787-2`). */
    shardsOfYear(hy) {
      const prefix = String(hy);
      return this.shards.filter((s) => s.id === prefix || s.id.startsWith(prefix + '-'));
    }

    /** מחכה שכל שרדי השנה יהיו בזיכרון: מהמטמון, ואם אין — מהרשת. */
    async ensureYear(hy) {
      const jobs = this.shardsOfYear(hy).map((entry) => this.ensureShard(entry));
      try {
        await Promise.all(jobs);
      } catch (error) {
        // ensureShard אינו נדחה בכוונה; כאן רק נגד שינוי עתידי, כי הקוראים אינם מחכים לתוצאה.
        this.log.warn('ensureYear ' + hy + ' failed', error);
      }
    }

    ensureShard(entry) {
      const path = 'issues/' + entry.id + '.json';
      if (this.emitted.has(path)) {
        this.meta.use[entry.id] = this.now();
        return Promise.resolve(true);
      }
      if (this.shardPromises.has(entry.id)) return this.shardPromises.get(entry.id);
      const promise = (async () => {
        const job = { kind: 'shard', id: entry.id, path: entry.path, entry, cachePath: path };
        try {
          if (this.online() === false) return await this._loadCached(path, 'shard', entry.id);
          await this._loadJob(job);
          this.meta.use[entry.id] = this.now();
          this._setStatus({ shardsLoaded: this._loadedShardCount() });
          await this._evictIfNeeded();
          return true;
        } catch (error) {
          this.log.warn('shard ' + entry.id + ' download failed, trying the cache', error);
          return this._loadCached(path, 'shard', entry.id);
        } finally {
          this.shardPromises.delete(entry.id);
        }
      })();
      this.shardPromises.set(entry.id, promise);
      return promise;
    }

    /** "שנים ישנות": טוען את כל השרדים הקרים בזה אחר זה, עם התקדמות. */
    async loadCold(onProgress) {
      const cold = this.coldShards().filter((x) => !this.emitted.has('issues/' + x.id + '.json'));
      let done = 0;
      let failed = 0;
      for (const shard of cold) {
        if (this.suspended) break;
        // שרד שלא נטען (רשת נפלה, אין מטמון) אינו "נטען": ההודעה למשתמש אומרת שחלק חסר.
        if (!(await this.ensureShard(shard))) failed++;
        done++;
        if (onProgress) onProgress(done, cold.length);
        await this.sleep(PACE_MS);
      }
      return done === cold.length && !failed;
    }

    /** כמה שרדים קרים עוד לא נטענו, וכמה גיליונות בהם (לפי המניפסט). */
    coldPending() {
      const cold = this.coldShards().filter((x) => !this.emitted.has('issues/' + x.id + '.json'));
      return {
        shards: cold.length,
        issues: cold.reduce((n, x) => n + (x.count || 0), 0),
        bytes: cold.reduce((n, x) => n + (x.bytes || 0), 0),
      };
    }

    /** שנים עבריות שבמניפסט, עם מספר גיליונות (כולל קרות, שעוד לא נטענו). */
    yearCounts() {
      const out = new Map();
      for (const shard of this.shards) {
        const m = /^(\d{4})/.exec(shard.id);
        if (m) out.set(Number(m[1]), (out.get(Number(m[1])) || 0) + (shard.count || 0));
      }
      return out;
    }

    // ------------------------------------- פרטים מלאים של גיליון (כתובות)

    /**
     * הקטלוג בזיכרון רזה: בלי כתובות. רק כשצריך להוריד או לפתוח, קוראים את
     * הגיליון המלא מקובץ השרד שלו (מהמטמון, ואם אין — מהרשת) ובונים את
     * הכתובות ב-`Core.resolveAssetUrls`. מחזיר `{ ...item, assets }` או `null`.
     */
    async hydrate(item) {
      const raw = await this._rawIssue(item);
      if (!raw) return null;
      const sources = new Map(this.sources.map((x) => [x.id, x]));
      const assets = (Array.isArray(raw.assets) ? raw.assets : []).map((a) => ({
        ...a,
        ...Core.resolveAssetUrls(a, sources.get(a.src)),
      }));
      return { ...item, assets, _full: true };
    }

    async _rawIssue(item) {
      const paths = [];
      if (item._shard && item._shard !== 'recent') paths.push('issues/' + item._shard + '.json');
      if (item.hy)
        for (const shard of this.shardsOfYear(item.hy)) paths.push('issues/' + shard.id + '.json');
      paths.push('recent.json');
      for (const path of [...new Set(paths)]) {
        const map = await this._parsedMap(path);
        const raw = map && map.get(item.id);
        if (raw) {
          const m = /^issues\/(.+)\.json$/.exec(path);
          if (m) this.meta.use[m[1]] = this.now();
          return raw;
        }
      }
      return null;
    }

    /** קובץ שרד מפוענח (id → גיליון), עם מטמון של שלושה קבצים בזיכרון. */
    async _parsedMap(path) {
      this._parsed = this._parsed || new Map();
      if (this._parsed.has(path)) {
        const hit = this._parsed.get(path);
        this._parsed.delete(path);
        this._parsed.set(path, hit);
        return hit;
      }
      // בקשות מקבילות לאותו קובץ (פתיחה + הכנה מראש להדפסה) חולקות קריאה ופענוח אחד (עד כ-9MB).
      this._parsing = this._parsing || new Map();
      if (!this._parsing.has(path)) {
        this._parsing.set(
          path,
          this._loadParsedMap(path).finally(() => this._parsing.delete(path)),
        );
      }
      return this._parsing.get(path);
    }

    async _loadParsedMap(path) {
      let text = await this._read(path);
      if (text === null && this.online() !== false) {
        try {
          text = (
            await this.runtime.fetchText(this.base + path, {
              timeoutMs: 90000,
              maxBytes: 30 * 1024 * 1024,
            })
          ).text;
        } catch (error) {
          this.log.warn('hydrate fetch failed ' + path, error);
        }
      }
      const data = text === null ? undefined : parseJson(text);
      if (!Array.isArray(data)) return null;
      const map = new Map();
      for (const raw of data) if (raw && raw.id) map.set(raw.id, raw);
      this._parsed.set(path, map);
      if (this._parsed.size > 3) this._parsed.delete(this._parsed.keys().next().value);
      return map;
    }

    // -------------------------------------------------------- מכסה

    /** גודל הקבצים הקבועים: מניפסט, סדרות, שבועות, אחרונים. */
    _baseBytes() {
      const files = (this.manifest && this.manifest.files) || {};
      return Object.values(files).reduce((n, x) => n + ((x && x.bytes) || 0), 0);
    }

    /**
     * תקרת המטמון: 50MB מתוך המכסה. מוחק שרדים לפי שימוש אחרון (LRU), קרים
     * קודם; שני השרדים החדשים ביותר אינם נמחקים.
     */
    async _evictIfNeeded() {
      const cap = Math.min(CACHE_CAP, this.quotaBytes ? this.quotaBytes * 0.5 : CACHE_CAP);
      const cached = this.shards.filter((s) => this.meta.sha['issues/' + s.id + '.json']);
      let total = this._baseBytes() + cached.reduce((n, x) => n + (x.bytes || 0), 0);
      if (total <= cap) return;
      const warm = new Set(this.warmShards().map((x) => x.id));
      const keep = new Set(
        this._shardsByRecency()
          .slice(0, 2)
          .map((x) => x.id),
      );
      const victims = cached
        .filter((x) => !keep.has(x.id))
        .sort(
          (a, b) =>
            Number(warm.has(a.id)) - Number(warm.has(b.id)) ||
            (this.meta.use[a.id] || 0) - (this.meta.use[b.id] || 0),
        );
      for (const shard of victims) {
        if (total <= cap) break;
        const path = 'issues/' + shard.id + '.json';
        try {
          await this.runtime.call('fs.deleteEntry', { path: DIR + '/' + path });
          total -= shard.bytes || 0;
          this.usedBytes = Math.max(0, this.usedBytes - (shard.bytes || 0));
          delete this.meta.sha[path];
          this.log.info('evicted shard ' + shard.id);
        } catch (error) {
          this.log.warn('evict failed ' + shard.id, error);
        }
      }
      await this._saveMeta();
    }

    /** גודל המטמון (בתים), המכסה והתקרה שלנו, להגדרות. */
    async usage() {
      try {
        const data = await this.runtime.call('fs.listDir', { path: '' });
        if (data && typeof data.usedBytes === 'number') {
          this.usedBytes = data.usedBytes;
          this.quotaBytes = data.quotaBytes || this.quotaBytes;
        }
      } catch (error) {
        this.log.warn('usage failed', error);
      }
      return {
        used: this.usedBytes,
        quota: this.quotaBytes,
        cap: Math.min(CACHE_CAP, this.quotaBytes ? this.quotaBytes * 0.5 : CACHE_CAP),
      };
    }

    /** מוחק את מטמון הקטלוג (לא את מצב המשתמש) ומסנכרן מחדש. */
    async clearCache() {
      try {
        await this.runtime.call('fs.deleteEntry', { path: DIR, recursive: true });
      } catch (error) {
        this.log.warn('clear cache failed', error);
        throw error;
      }
      this.meta = { sha: {}, use: {}, catalogVersion: 0, lastOkAt: 0, lastCheckAt: 0 };
      this.emitted.clear();
      this._parsed = new Map();
      this.usedBytes = 0;
    }
  }

  /** השוואת גרסאות `1.2.3`. */
  function compareVersions(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  const api = { Catalog, sha256Hex, compareVersions, validShardId, CACHE_CAP, WARM_BYTES };
  A.Catalog = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
