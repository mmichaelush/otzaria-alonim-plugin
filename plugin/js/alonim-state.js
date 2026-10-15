// מצב המשתמש: מועדפים, מעקב אחרי סדרות, קריאה, אוספים, כללי סינון והעדפות.
// נשמר ב-`storage.*` (מפתח לכל תחום), בשמירה מאוחדת (debounce) כדי לא להפר את
// מגביל הקצב. כלל ברזל: קריאה שנכשלה אינה מצב ריק. תחום שהקריאה שלו נכשלה
// נשאר בזיכרון בלבד ואינו נכתב עד שקריאה חוזרת מצליחה, וכך לעולם לא דורסים
// מצב אמיתי בברירות מחדל.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;
  const Rules = A.Rules;
  const KEYS = Core.KEYS;

  const SAVE_DELAY_MS = 700;
  const MAX_READ = 6000;
  const MAX_OPENED = 30;
  const MAX_FAVORITES = 5000;
  const MAX_LISTS = 50;
  const MAX_LIST_ENTRIES = 500;
  const MAX_IMPORT_BYTES = 3 * 1024 * 1024;
  const EXPORT_FORMAT = 'otzaria-alonim-settings';

  const DEFAULT_PREFS = Object.freeze({
    v: 1,
    scale: 1,
    lang: 'auto',
    view: 'cards',
    sort: 'relevance',
    thumbs: false,
    diaspora: false,
    autoDownload: false,
    autoDownloadCap: 5,
    /** יום ומספר ההורדות האוטומטיות שבוצעו בו (מכסה יומית). */
    autoDay: '',
    autoCount: 0,
    folder: null,
    welcomeSeen: false,
  });

  const defaults = {
    prefs: () => ({ ...DEFAULT_PREFS }),
    favorites: () => ({ v: 1, items: {} }),
    read: () => ({ v: 1, items: {} }),
    series: () => ({ v: 1, items: {} }),
    rules: () => Rules.emptyRules(),
    lists: () => ({ v: 1, items: [] }),
    opened: () => ({ v: 1, items: [] }),
  };

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 200) : '');
  const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

  /** מה שנשמר על גיליון כדי להציג אותו גם כשהשרד שלו עוד לא נטען. */
  function snapOf(item) {
    return {
      id: item.id,
      s: item.series || '',
      st: item.seriesTitle || '',
      ti: item.title || '',
      hy: item.hy || 0,
      d: item.date || '',
      p: Array.isArray(item.parasha) ? item.parasha.slice(0, 2) : [],
      ev: item.event || '',
    };
  }

  function cleanSnap(raw) {
    if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
    return {
      id: str(raw.id, 40),
      s: str(raw.s, 40),
      st: str(raw.st, 120),
      ti: str(raw.ti, 160),
      hy: num(raw.hy, 0),
      d: str(raw.d, 10),
      p: Array.isArray(raw.p) ? raw.p.slice(0, 2).map((x) => str(x, 40)) : [],
      ev: str(raw.ev, 40),
    };
  }

  // ------------------------------------------------- ניקוי לפי תחום

  const cleaners = {
    prefs(raw) {
      const out = { ...DEFAULT_PREFS };
      if (!isObject(raw)) return out;
      const p = raw;
      out.scale = p.scale >= 0.7 && p.scale <= 2 ? p.scale : 1;
      out.lang = ['auto', 'he', 'en'].includes(p.lang) ? p.lang : 'auto';
      out.view = p.view === 'list' ? 'list' : 'cards';
      out.sort = ['relevance', 'new', 'date', 'alpha', 'size'].includes(p.sort) ? p.sort : 'relevance';
      out.thumbs = p.thumbs === true;
      out.diaspora = p.diaspora === true;
      out.autoDownload = p.autoDownload === true;
      out.autoDownloadCap = Math.min(30, Math.max(1, Math.round(num(p.autoDownloadCap, 5))));
      out.autoDay = typeof p.autoDay === 'string' ? p.autoDay.slice(0, 10) : '';
      out.autoCount = Math.max(0, Math.round(num(p.autoCount, 0)));
      out.welcomeSeen = p.welcomeSeen === true;
      out.folder =
        isObject(p.folder) && typeof p.folder.token === 'string' && p.folder.token
          ? { token: str(p.folder.token, 200), name: str(p.folder.name, 200), path: str(p.folder.path, 600) }
          : null;
      return out;
    },
    favorites(raw) {
      const out = defaults.favorites();
      if (!isObject(raw) || !isObject(raw.items)) return out;
      for (const [id, v] of Object.entries(raw.items).slice(0, MAX_FAVORITES)) {
        const snap = cleanSnap({ ...(isObject(v) ? v : {}), id });
        if (snap) out.items[id] = { ...snap, t: num(v && v.t, 0) };
      }
      return out;
    },
    read(raw) {
      const out = defaults.read();
      if (!isObject(raw) || !isObject(raw.items)) return out;
      const entries = Object.entries(raw.items).filter(([, t]) => typeof t === 'number');
      entries.sort((a, b) => b[1] - a[1]);
      for (const [id, t] of entries.slice(0, MAX_READ)) out.items[id] = t;
      return out;
    },
    series(raw) {
      const out = defaults.series();
      if (!isObject(raw) || !isObject(raw.items)) return out;
      for (const [id, v] of Object.entries(raw.items).slice(0, 5000)) {
        if (!isObject(v)) continue;
        const entry = { follow: v.follow === true, mute: v.mute === true, fav: v.fav === true };
        if (typeof v.src === 'string' && v.src) entry.src = str(v.src, 40);
        if (entry.follow || entry.mute || entry.fav || entry.src) out.items[str(id, 40)] = entry;
      }
      return out;
    },
    rules(raw) {
      return Rules.sanitize(raw).rules;
    },
    lists(raw) {
      const out = defaults.lists();
      if (!isObject(raw) || !Array.isArray(raw.items)) return out;
      const seen = new Set();
      for (const l of raw.items.slice(0, MAX_LISTS)) {
        if (!isObject(l) || typeof l.id !== 'string' || seen.has(l.id)) continue;
        seen.add(l.id);
        const entries = (Array.isArray(l.entries) ? l.entries : []).slice(0, MAX_LIST_ENTRIES).map(cleanSnap).filter(Boolean);
        out.items.push({ id: str(l.id, 40), name: str(l.name, 80) || '—', kind: l.kind === 'shabbat' ? 'shabbat' : 'list', created: num(l.created, 0), entries });
      }
      return out;
    },
    opened(raw) {
      const out = defaults.opened();
      if (!isObject(raw) || !Array.isArray(raw.items)) return out;
      for (const o of raw.items.slice(0, MAX_OPENED)) {
        const snap = cleanSnap(o);
        if (snap) out.items.push({ ...snap, t: num(o.t, 0) });
      }
      return out;
    },
  };

  class State {
    /** [runtime] מ-`createRuntime`; [log] עם debug/warn. */
    constructor(runtime, options) {
      const opts = options || {};
      this.runtime = runtime;
      this.log = opts.log || { debug() {}, warn() {}, info() {}, error() {} };
      this.now = opts.now || (() => Date.now());
      this.delay = opts.saveDelay === undefined ? SAVE_DELAY_MS : opts.saveDelay;
      this.data = {};
      for (const name of Object.keys(defaults)) this.data[name] = defaults[name]();
      /** תחומים שהקריאה שלהם נכשלה: אינם נכתבים. */
      this.failed = new Set();
      this.dirty = new Set();
      this.timer = null;
      this.saving = null;
      this.listeners = new Set();
      this.loaded = false;
    }

    onChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    _emit(domains) {
      for (const fn of this.listeners) {
        try {
          fn(domains);
        } catch (error) {
          this.log.warn('state listener failed', error);
        }
      }
    }

    // ----------------------------------------------------- טעינה/שמירה

    async load() {
      await Promise.all(Object.keys(defaults).map((name) => this._loadOne(name)));
      this.loaded = true;
      this._emit(Object.keys(defaults));
    }

    async _loadOne(name) {
      try {
        const value = await this.runtime.call('storage.get', { key: KEYS[name] });
        this.data[name] = cleaners[name](value === null || value === undefined ? undefined : value);
        this.failed.delete(name);
        return true;
      } catch (error) {
        // כשל קריאה אינו מצב ריק: לא נכתוב על המצב האמיתי.
        this.failed.add(name);
        this.log.warn('state ' + name + ' read failed', error);
        return false;
      }
    }

    /** ניסיון חוזר לתחומים שנכשלו. `true` כשכולם נטענו. */
    async retryFailed() {
      const names = [...this.failed];
      for (const name of names) {
        const before = this.data[name];
        const ok = await this._loadOne(name);
        // שינויים שנעשו בזמן הכשל (בזיכרון בלבד) גוברים על המצב שנקרא? לא: המצב
        // השמור אמיתי יותר, והשינויים האלה לא נשמרו מעולם.
        if (!ok) this.data[name] = before;
      }
      if (names.length) this._emit(names);
      return this.failed.size === 0;
    }

    get readOnly() {
      return this.failed.size > 0;
    }

    _touch(...domains) {
      for (const d of domains) this.dirty.add(d);
      this._emit(domains);
      if (this.delay === 0) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.delay);
    }

    /** כותב מיד את מה שהשתנה. מחזיר הבטחה שלא נדחית. */
    async flush() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const names = [...this.dirty].filter((n) => !this.failed.has(n));
      this.dirty = new Set([...this.dirty].filter((n) => this.failed.has(n)));
      const previous = this.saving || Promise.resolve();
      this.saving = previous.then(async () => {
        for (const name of names) {
          try {
            await this.runtime.call('storage.set', { key: KEYS[name], value: this.data[name] });
          } catch (error) {
            this.log.warn('state ' + name + ' write failed', error);
            this.dirty.add(name);
          }
        }
      });
      await this.saving;
    }

    // ------------------------------------------------------- העדפות

    get prefs() {
      return this.data.prefs;
    }

    setPref(key, value) {
      const next = cleaners.prefs({ ...this.data.prefs, [key]: value });
      if (JSON.stringify(next) === JSON.stringify(this.data.prefs)) return;
      this.data.prefs = next;
      this._touch('prefs');
    }

    // ------------------------------------------------------ מועדפים

    isFavorite(id) {
      return Object.hasOwn(this.data.favorites.items, id);
    }

    /** מחזיר `true` כשהגיליון עכשיו מועדף. */
    toggleFavorite(item) {
      const items = this.data.favorites.items;
      if (Object.hasOwn(items, item.id)) delete items[item.id];
      else if (Object.keys(items).length < MAX_FAVORITES) items[item.id] = { ...snapOf(item), t: this.now() };
      this._touch('favorites');
      return this.isFavorite(item.id);
    }

    favoriteSnaps() {
      return Object.values(this.data.favorites.items).sort((a, b) => b.t - a.t);
    }

    // ------------------------------------------------------- קריאה

    isRead(id) {
      return Object.hasOwn(this.data.read.items, id);
    }

    markRead(item, value) {
      const items = this.data.read.items;
      if (value === false) delete items[item.id];
      else items[item.id] = this.now();
      const ids = Object.keys(items);
      if (ids.length > MAX_READ) {
        ids.sort((a, b) => items[a] - items[b]);
        for (const id of ids.slice(0, ids.length - MAX_READ)) delete items[id];
      }
      this._touch('read');
    }

    /** גיליון נפתח לקריאה: נכנס ל"המשך קריאה". */
    addOpened(item) {
      const list = this.data.opened.items.filter((o) => o.id !== item.id);
      list.unshift({ ...snapOf(item), t: this.now() });
      this.data.opened.items = list.slice(0, MAX_OPENED);
      this._touch('opened');
    }

    removeOpened(id) {
      this.data.opened.items = this.data.opened.items.filter((o) => o.id !== id);
      this._touch('opened');
    }

    /** נפתחו ולא סומנו כנקראו. */
    continueReading(limit) {
      return this.data.opened.items.filter((o) => !this.isRead(o.id)).slice(0, limit || 6);
    }

    // -------------------------------------------------------- סדרות

    seriesState(id) {
      return this.data.series.items[id] || { follow: false, mute: false, fav: false };
    }

    /** `patch`: `{follow, mute, fav, src}`. עקוב והשתק סותרים: האחרון גובר. */
    setSeries(id, patch) {
      const cur = { ...this.seriesState(id), ...patch };
      if (patch.follow === true) cur.mute = false;
      if (patch.mute === true) cur.follow = false;
      const cleaned = cleaners.series({ items: { [id]: cur } }).items[id];
      if (cleaned) this.data.series.items[id] = cleaned;
      else delete this.data.series.items[id];
      this._touch('series');
    }

    isFollowed(id) {
      const s = this.data.series.items[id];
      return Boolean(s && (s.follow || s.fav));
    }

    isMuted(id) {
      const s = this.data.series.items[id];
      return Boolean(s && s.mute);
    }

    followedIds() {
      return Object.entries(this.data.series.items)
        .filter(([, s]) => s.follow || s.fav)
        .map(([id]) => id);
    }

    preferredSource(seriesId) {
      return (this.data.series.items[seriesId] || {}).src || '';
    }

    /** מזהה סדרה ישן (previousIds) הופך לחדש בכל המצב השמור. */
    migrateSeriesIds(resolve) {
      let changed = false;
      const items = this.data.series.items;
      for (const id of Object.keys(items)) {
        const next = resolve(id);
        if (next && next !== id) {
          items[next] = { ...items[id], ...(items[next] || {}) };
          delete items[id];
          changed = true;
        }
      }
      const rules = this.data.rules.rules;
      for (const rule of rules) {
        if (rule.field === 'series') {
          const next = resolve(rule.value);
          if (next && next !== rule.value) {
            rule.value = next;
            changed = true;
          }
        }
      }
      if (changed) this._touch('series', 'rules');
    }

    // -------------------------------------------------------- אוספים

    get lists() {
      return this.data.lists.items;
    }

    createList(name, kind) {
      if (this.data.lists.items.length >= MAX_LISTS) return null;
      const list = {
        id: 'l' + this.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        name: str(name, 80).trim() || '—',
        kind: kind === 'shabbat' ? 'shabbat' : 'list',
        created: this.now(),
        entries: [],
      };
      this.data.lists.items.push(list);
      this._touch('lists');
      return list;
    }

    renameList(id, name) {
      const list = this.data.lists.items.find((l) => l.id === id);
      if (!list) return;
      list.name = str(name, 80).trim() || list.name;
      this._touch('lists');
    }

    deleteList(id) {
      const list = this.data.lists.items.find((l) => l.id === id);
      this.data.lists.items = this.data.lists.items.filter((l) => l.id !== id);
      this._touch('lists');
      return list || null;
    }

    restoreList(list) {
      if (!list || this.data.lists.items.some((l) => l.id === list.id)) return;
      this.data.lists.items.push(list);
      this._touch('lists');
    }

    addToList(listId, item) {
      const list = this.data.lists.items.find((l) => l.id === listId);
      if (!list || list.entries.length >= MAX_LIST_ENTRIES) return false;
      if (!list.entries.some((e) => e.id === item.id)) list.entries.push(snapOf(item));
      this._touch('lists');
      return true;
    }

    removeFromList(listId, id) {
      const list = this.data.lists.items.find((l) => l.id === listId);
      if (!list) return;
      list.entries = list.entries.filter((e) => e.id !== id);
      this._touch('lists');
    }

    listsContaining(id) {
      return this.data.lists.items.filter((l) => l.entries.some((e) => e.id === id));
    }

    /** "אוסף שבת": נוצר בפעם הראשונה שמבקשים אותו. */
    shabbatList() {
      return this.data.lists.items.find((l) => l.kind === 'shabbat') || null;
    }

    // ----------------------------------------------------------- כללים

    get rules() {
      return this.data.rules;
    }

    addRule(raw) {
      const rule = Rules.cleanRule({ ...raw, id: raw.id || Rules.newId(), at: this.now() });
      if (!rule || this.data.rules.rules.length >= Rules.MAX_RULES) return null;
      this.data.rules.rules = this.data.rules.rules.filter((r) => !(r.field === rule.field && r.value === rule.value && r.action === rule.action));
      this.data.rules.rules.push(rule);
      this._touch('rules');
      return rule;
    }

    removeRule(id) {
      const rule = this.data.rules.rules.find((r) => r.id === id) || null;
      this.data.rules.rules = this.data.rules.rules.filter((r) => r.id !== id);
      this._touch('rules');
      return rule;
    }

    setRulesMode(mode) {
      this.data.rules.mode = Rules.MODES.includes(mode) ? mode : 'blacklist';
      this._touch('rules');
    }

    // ---------------------------------------------- ייצוא וייבוא

    /** אובייקט הייצוא. תיקיית ההורדות אינה נכללת: ה-token שלה מקומי למחשב. */
    exportSettings(options) {
      const withRead = !options || options.read !== false;
      const prefs = { ...this.data.prefs, folder: null };
      return {
        format: EXPORT_FORMAT,
        v: 1,
        plugin: Core.PLUGIN_VERSION,
        exportedAt: new Date(this.now()).toISOString(),
        prefs,
        favorites: this.data.favorites,
        series: this.data.series,
        rules: this.data.rules,
        lists: this.data.lists,
        ...(withRead ? { read: this.data.read } : {}),
      };
    }

    /**
     * בודק טקסט ייבוא בלי להחיל. `{ ok, error, sections, summary }`;
     * `error`: `empty|too_big|json|format|too_new`.
     */
    previewImport(text) {
      const body = String(text || '').trim();
      if (!body) return { ok: false, error: 'empty' };
      if (body.length > MAX_IMPORT_BYTES) return { ok: false, error: 'too_big' };
      let raw;
      try {
        raw = JSON.parse(body);
      } catch (error) {
        return { ok: false, error: 'json' };
      }
      if (!isObject(raw) || raw.format !== EXPORT_FORMAT) return { ok: false, error: 'format' };
      if (typeof raw.v !== 'number' || raw.v > 1) return { ok: false, error: 'too_new' };
      const sections = {};
      for (const name of ['prefs', 'favorites', 'series', 'rules', 'lists', 'read']) {
        if (raw[name] !== undefined) sections[name] = cleaners[name](raw[name]);
      }
      if (sections.prefs) sections.prefs.folder = null;
      const summary = {
        rules: sections.rules ? sections.rules.rules.length : 0,
        series: sections.series ? Object.keys(sections.series.items).length : 0,
        favorites: sections.favorites ? Object.keys(sections.favorites.items).length : 0,
        lists: sections.lists ? sections.lists.items.length : 0,
        read: sections.read ? Object.keys(sections.read.items).length : 0,
        prefs: Boolean(sections.prefs),
      };
      return { ok: true, sections, summary };
    }

    /** מחיל תצוגה מקדימה תקינה. `mode`: `merge` (ברירת מחדל) או `replace`. */
    applyImport(preview, mode) {
      if (!preview || !preview.ok) return false;
      const s = preview.sections;
      const replace = mode === 'replace';
      const d = this.data;
      if (s.prefs) d.prefs = { ...s.prefs, folder: d.prefs.folder, welcomeSeen: d.prefs.welcomeSeen };
      if (s.favorites) d.favorites.items = replace ? s.favorites.items : { ...d.favorites.items, ...s.favorites.items };
      if (s.read) d.read.items = replace ? s.read.items : { ...d.read.items, ...s.read.items };
      if (s.series) d.series.items = replace ? s.series.items : { ...d.series.items, ...s.series.items };
      if (s.rules) {
        if (replace) d.rules = s.rules;
        else {
          const have = new Set(d.rules.rules.map((r) => r.field + '|' + r.action + '|' + r.value));
          for (const r of s.rules.rules) if (!have.has(r.field + '|' + r.action + '|' + r.value)) d.rules.rules.push({ ...r, id: Rules.newId() });
          d.rules.rules = d.rules.rules.slice(0, Rules.MAX_RULES);
          d.rules.mode = s.rules.mode;
        }
      }
      if (s.lists) {
        if (replace) d.lists = s.lists;
        else {
          const names = new Set(d.lists.items.map((l) => l.id));
          for (const l of s.lists.items) if (!names.has(l.id) && d.lists.items.length < MAX_LISTS) d.lists.items.push(l);
        }
      }
      const touched = Object.keys(s);
      this._touch(...touched);
      return true;
    }
  }

  const api = { State, snapOf, cleaners, defaults, EXPORT_FORMAT, DEFAULT_PREFS };
  A.State = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
