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
  const QUOTA_SOFT = 0.85;
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
      return (this.manifest && Array.isArray(this.manifest.shards) && this.manifest.shards.filter((s) => s && validShardId(s.id))) || [];
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
      const metaText = await this._read('meta.json');
      const meta = metaText ? parseJson(metaText) : null;
      if (meta && typeof meta === 'object') {
        this.meta = { ...this.meta, ...meta, sha: meta.sha || {}, use: meta.use || {} };
      }
      const manifestText = await this._read('manifest.json');
      const manifest = manifestText ? parseJson(manifestText) : null;
      if (manifest && typeof manifest === 'object' && manifest.schema <= Core.SCHEMA) this.manifest = manifest;
      this._setStatus({ lastOkAt: this.meta.lastOkAt || 0, lastCheckAt: this.meta.lastCheckAt || 0 });
      const results = await Promise.all(FILE_KEYS.map((key) => this._loadCached(key + '.json', key)));
      const hasAny = results.some(Boolean);
      if (hasAny) this._setStatus({ fromCache: true });
      this._setStatus({ shardsTotal: this.shards.length });
      return hasAny;
    }

    async _loadCached(path, kind, id) {
      const text = await this._read(path);
      if (text === null) return false;
      const data = parseJson(text);
      if (!Array.isArray(data)) return false;
      this.emitted.set(path, this.meta.sha[path] || 'cache');
      this._emitData({ kind, data, id, cached: true });
      return true;
    }

    /** שרדים שבמטמון, מהחדש לישן, בהפסקות כדי שהממשק יישאר רספונסיבי. */
    async loadCachedShards() {
      for (const entry of this._shardsByRecency()) {
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
      return this.shards.filter((s) => this.emitted.has('issues/' + s.id + '.json')).length;
    }

    _shardsByRecency() {
      return [...this.shards].sort((a, b) => String(b.to || b.id).localeCompare(String(a.to || a.id)) || (a.id < b.id ? 1 : -1));
    }

    // ----------------------------------------------------------- סנכרון

    /** שלוש הקריאות מהאפליקציה: `init` אחרי האתחול, `sync` ידני, `resume`. */
    async init() {
      await this.loadCache();
      const first = this.sync();
      this.loadCachedShards();
      return first;
    }

    /** מסנכרן בבת אחת, ובלי כפילות: קריאה בזמן סנכרון מחזירה את הרץ. */
    sync(options) {
      if (this.syncing) return this.syncing;
      this.syncing = this._sync(options || {}).finally(() => {
        this.syncing = null;
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
      if (manifest.minPluginVersion && compareVersions(manifest.minPluginVersion, Core.PLUGIN_VERSION) > 0) {
        this._setStatus({ pluginTooOld: true });
      }
      this.manifest = manifest;
      this.meta.lastCheckAt = this.now();
      this._setStatus({ lastCheckAt: this.meta.lastCheckAt, schemaTooNew: false, shardsTotal: this.shards.length });

      const files = manifest.files || {};
      const plan = [];
      for (const key of FILE_KEYS) {
        if (files[key] && files[key].path) plan.push({ kind: key, path: files[key].path, entry: files[key], cachePath: key + '.json' });
      }
      for (const shard of this._shardsByRecency()) {
        plan.push({ kind: 'shard', id: shard.id, path: shard.path, entry: shard, cachePath: 'issues/' + shard.id + '.json' });
      }
      const needed = plan.filter((p) => options.force || this._stale(p));
      this._setStatus({ phase: needed.length ? 'downloading' : 'idle', total: needed.length, done: 0 });
      let failed = 0;
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

      await this._write('manifest.json', JSON.stringify(manifest));
      if (!failed && !this.suspended) this.meta.catalogVersion = manifest.catalogVersion || 0;
      if (!failed) {
        this.meta.lastOkAt = this.now();
        this._setStatus({ lastOkAt: this.meta.lastOkAt });
      }
      await this._saveMeta();
      await this._evictIfNeeded();
      this._setStatus({ shardsLoaded: this._loadedShardCount() });
      if (failed) {
        this._setStatus({ phase: failed === needed.length ? 'error' : 'partial', error: firstError && (firstError.code || 'network') });
        this._scheduleRetry();
        return false;
      }
      this.retryStep = 0;
      this._setStatus({ phase: 'idle', error: null, fromCache: false });
      return true;
    }

    /** האם הקובץ השתנה (גיבוב) או חסר במטמון/בזיכרון. */
    _stale(job) {
      const sha = job.entry.sha256 || '';
      if (this.emitted.has(job.cachePath) && this.meta.sha[job.cachePath] === sha && sha) return false;
      return true;
    }

    async _loadJob(job) {
      const sha = job.entry.sha256 || '';
      // המטמון עדכני, רק עוד לא נטען לזיכרון (ביקור שני: שרד שעוד לא עלה).
      if (sha && this.meta.sha[job.cachePath] === sha && !this.emitted.has(job.cachePath)) {
        if (await this._loadCached(job.cachePath, job.kind, job.id)) return;
      }
      const { text } = await this._fetchWithRetry(job.path, job.path, sha, job.entry);
      const data = parseJson(text);
      if (!Array.isArray(data)) throw Object.assign(new Error('bad file'), { code: 'bad_file' });
      this.emitted.set(job.cachePath, sha || 'net');
      this._emitData({ kind: job.kind, data, id: job.id, cached: false });
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
        const suffix = attempt > 0 ? '?v=' + (this.manifest ? this.manifest.catalogVersion : attempt) + '-' + attempt : '';
        try {
          const res = await this.runtime.fetchText(this.base + path + suffix, {
            timeoutMs: entry && entry.bytes > 1000000 ? 90000 : 30000,
            maxBytes: Math.max(2 * 1024 * 1024, ((entry && entry.bytes) || 0) * 2 + 65536),
          });
          if (sha) {
            const actual = await sha256Hex(res.text);
            if (actual && actual !== sha) throw Object.assign(new Error('sha mismatch ' + label), { code: 'hash' });
          }
          return res;
        } catch (error) {
          lastError = error;
          const code = error.code;
          if (code === 'forbidden' || code === 'blocked' || code === 'permission' || code === 'too_large') throw error;
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
      if (this.now() - (this.status.lastCheckAt || 0) > 10 * 60 * 1000) this.sync();
      else this.loadCachedShards();
    }

    // -------------------------------------------------- שרדים לפי דרישה

    /** שנה עברית → השרדים שלה (`5787`, `5787-2`). */
    shardsOfYear(hy) {
      const prefix = String(hy);
      return this.shards.filter((s) => s.id === prefix || s.id.startsWith(prefix + '-'));
    }

    /** מחכה שכל שרדי השנה יהיו בזיכרון: מהמטמון, ואם אין — מהרשת. */
    async ensureYear(hy) {
      const jobs = this.shardsOfYear(hy).map((entry) => this.ensureShard(entry));
      await Promise.all(jobs);
    }

    ensureShard(entry) {
      const path = 'issues/' + entry.id + '.json';
      if (this.emitted.has(path)) return Promise.resolve(true);
      if (this.shardPromises.has(entry.id)) return this.shardPromises.get(entry.id);
      const promise = (async () => {
        const job = { kind: 'shard', id: entry.id, path: entry.path, entry, cachePath: path };
        try {
          if (this.online() === false) return await this._loadCached(path, 'shard', entry.id);
          await this._loadJob(job);
          return true;
        } catch (error) {
          return this._loadCached(path, 'shard', entry.id);
        } finally {
          this.shardPromises.delete(entry.id);
        }
      })();
      this.shardPromises.set(entry.id, promise);
      return promise;
    }

    // -------------------------------------------------------- מכסה

    /** מתחת למכסה: מוחק שרדים שלא נעשה בהם שימוש, חוץ מהשלושה האחרונים. */
    async _evictIfNeeded() {
      if (!this.quotaBytes || this.usedBytes < this.quotaBytes * QUOTA_SOFT) return;
      const keep = new Set(this._shardsByRecency().slice(0, 3).map((s) => s.id));
      const victims = this.shards
        .filter((s) => !keep.has(s.id) && this.meta.sha['issues/' + s.id + '.json'])
        .sort((a, b) => (this.meta.use[a.id] || 0) - (this.meta.use[b.id] || 0));
      for (const shard of victims) {
        if (this.usedBytes < this.quotaBytes * 0.7) break;
        const path = 'issues/' + shard.id + '.json';
        try {
          await this.runtime.call('fs.deleteEntry', { path: DIR + '/' + path });
          this.usedBytes -= shard.bytes || 0;
          delete this.meta.sha[path];
          this.log.info('evicted shard ' + shard.id);
        } catch (error) {
          this.log.warn('evict failed ' + shard.id, error);
        }
      }
      await this._saveMeta();
    }

    /** גודל המטמון (בתים) והמכסה, להגדרות. */
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
      return { used: this.usedBytes, quota: this.quotaBytes };
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

  const api = { Catalog, sha256Hex, compareVersions, validShardId };
  A.Catalog = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
