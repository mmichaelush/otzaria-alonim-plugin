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
  const {
    DEFAULT_PREFS,
    EXPORT_FORMAT,
    HISTORY_KINDS,
    MAX_FAVORITES,
    MAX_HISTORY,
    MAX_IMPORT_BYTES,
    MAX_LISTS,
    MAX_LIST_ENTRIES,
    MAX_OPENED,
    MAX_PRESETS,
    MAX_READ,
    MAX_SEARCHES,
    MAX_SERIES_VIEWS,
    SAVE_DELAY_MS,
    VISIT_GAP_MS,
    cleaners,
    defaults,
    isObject,
    snapOf,
    str,
  } = A.StateSchema;

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

    /**
     * קורא מחדש מהמארח את התחומים שלא השתנו מקומית. חלון אחר של אוצריא (או הפעלה אחרת של התוסף)
     * שומר לאותו מפתח, והכתיבה היא של התחום כולו: בלי רענון, העותק הישן שלנו היה דורס את השינוי
     * שלהם (אובדן מועדף/סימון קריאה — נמצא בבדיקה חיה בשני חלונות). נקרא כשהחלון מקבל מיקוד,
     * ואילו `flush()` נקרא כשהוא מאבד אותו. `views` (מצב מסך לחלון) אינו מתרענן.
     * מחזיר את התחומים שהשתנו.
     */
    async refresh() {
      if (!this.loaded) return [];
      await this.saving;
      const changed = [];
      for (const name of Object.keys(defaults)) {
        if (name === 'views' || this.dirty.has(name) || this.failed.has(name)) continue;
        try {
          const value = await this.runtime.call('storage.get', { key: KEYS[name] });
          if (this.dirty.has(name)) continue; // השתנה אצלנו בזמן הקריאה
          const next = cleaners[name](value === null || value === undefined ? undefined : value);
          if (JSON.stringify(next) !== JSON.stringify(this.data[name])) {
            this.data[name] = next;
            changed.push(name);
          }
        } catch (error) {
          this.log.debug('state ' + name + ' refresh failed', error);
        }
      }
      if (changed.length) this._emit(changed);
      return changed;
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
      else if (Object.keys(items).length < MAX_FAVORITES)
        items[item.id] = { ...snapOf(item), t: this.now() };
      this._touch('favorites');
      return this.isFavorite(item.id);
    }

    /** קובע מועדף במפורש (לפעולות על כמה גיליונות). */
    setFavorite(item, on) {
      const items = this.data.favorites.items;
      const has = Object.hasOwn(items, item.id);
      if (on === has) return;
      if (on) {
        if (Object.keys(items).length >= MAX_FAVORITES) return;
        items[item.id] = { ...snapOf(item), t: this.now() };
      } else delete items[item.id];
      this._touch('favorites');
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
      if (!this.historyOn) return;
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

    // ------------------------------------------- העברת מזהי גיליונות

    /**
     * גיליון שמזההו השתנה בקטלוג (`previousIds`): מעביר את כל מצב המשתמש מהמזהה
     * הישן לחדש. [resolve] ממיר מזהה למזהה הנוכחי. אידמפוטנטי (מזהה שכבר נוכחי
     * אינו משתנה), ואינו מאבד דבר: כשיש מצב גם למזהה הישן וגם לחדש הם ממוזגים.
     * מחזיר את מספר הרשומות שהועברו.
     */
    migrateIssueIds(resolve) {
      const d = this.data;
      let moved = 0;
      const touched = new Set();
      const next = (id) => {
        const target = resolve(id);
        return target && target !== id ? target : null;
      };
      for (const id of Object.keys(d.favorites.items)) {
        const to = next(id);
        if (!to) continue;
        const entry = d.favorites.items[id];
        delete d.favorites.items[id];
        const existing = d.favorites.items[to];
        d.favorites.items[to] = existing
          ? { ...entry, ...existing, id: to, t: Math.max(entry.t || 0, existing.t || 0) }
          : { ...entry, id: to };
        moved++;
        touched.add('favorites');
      }
      for (const id of Object.keys(d.read.items)) {
        const to = next(id);
        if (!to) continue;
        d.read.items[to] = Math.max(d.read.items[id] || 0, d.read.items[to] || 0);
        delete d.read.items[id];
        moved++;
        touched.add('read');
      }
      for (const list of d.lists.items) {
        let changed = false;
        const seen = new Set();
        const entries = [];
        for (const entry of list.entries) {
          const to = next(entry.id);
          const id = to || entry.id;
          if (to) changed = true;
          if (seen.has(id)) {
            changed = true;
            continue;
          }
          seen.add(id);
          entries.push(to ? { ...entry, id } : entry);
          if (to) moved++;
        }
        if (changed) {
          list.entries = entries;
          touched.add('lists');
        }
      }
      const rekey = (events, domain) => {
        let changed = false;
        for (const e of events) {
          const to = next(e.id);
          if (to) {
            e.id = to;
            moved++;
            changed = true;
          }
        }
        if (changed) touched.add(domain);
        return changed;
      };
      if (rekey(d.opened.items, 'opened')) {
        const seen = new Set();
        d.opened.items = d.opened.items.filter((o) => !seen.has(o.id) && seen.add(o.id));
      }
      rekey(d.history.events, 'history');
      for (const rule of d.rules.rules) {
        if (rule.field !== 'issue') continue;
        const to = next(rule.value);
        if (to) {
          rule.value = to;
          moved++;
          touched.add('rules');
        }
      }
      if (touched.size) this._touch(...touched);
      return moved;
    }

    // ----------------------------------------------------- היסטוריה

    get historyOn() {
      return this.data.prefs.history !== false;
    }

    /** רושם אירוע (`opened|read|downloaded|printed`); פעולה כפולה באותה דקה נספרת פעם אחת. */
    logEvent(kind, item) {
      if (!this.historyOn || !HISTORY_KINDS.includes(kind) || !item || !item.id) return;
      const now = this.now();
      const events = this.data.history.events;
      const last = events[0];
      if (last && last.id === item.id && last.k === kind && now - last.t < 60000) return;
      events.unshift({ ...snapOf(item), k: kind, t: now });
      if (events.length > MAX_HISTORY) events.length = MAX_HISTORY;
      this._touch('history');
    }

    /** האירועים, מהחדש לישן; [kind] מסנן לפי סוג. */
    historyEvents(kind) {
      const all = this.data.history.events;
      return kind ? all.filter((e) => e.k === kind) : all;
    }

    removeEvent(event) {
      const events = this.data.history.events;
      const at = events.indexOf(event);
      if (at < 0) return;
      events.splice(at, 1);
      this._touch('history');
    }

    /** מוחק את כל האירועים. מחזיר את הרשימה הקודמת (לביטול). */
    clearEvents() {
      const old = this.data.history.events;
      this.data.history.events = [];
      this._touch('history');
      return old;
    }

    restoreEvents(events) {
      this.data.history.events = (Array.isArray(events) ? events : [])
        .concat(this.data.history.events)
        .sort((a, b) => b.t - a.t)
        .slice(0, MAX_HISTORY);
      this._touch('history');
    }

    /** חיפוש שהושלם: ייחודי, האחרון ראשון. */
    addSearch(query) {
      const q = String(query || '').trim();
      if (!this.historyOn || q.length < 2) return;
      const list = this.data.history.searches.filter((s) => s.q !== q);
      list.unshift({ q: str(q, 300), t: this.now() });
      this.data.history.searches = list.slice(0, MAX_SEARCHES);
      this._touch('history');
    }

    get searches() {
      return this.data.history.searches;
    }

    removeSearch(query) {
      this.data.history.searches = this.data.history.searches.filter((s) => s.q !== query);
      this._touch('history');
    }

    clearSearches() {
      this.data.history.searches = [];
      this._touch('history');
    }

    /** סדרה שנצפתה (דף הסדרה): "נצפו לאחרונה". */
    viewSeries(id) {
      if (!this.historyOn || !id) return;
      const list = this.data.history.series.filter((s) => s.id !== id);
      list.unshift({ id, t: this.now() });
      this.data.history.series = list.slice(0, MAX_SERIES_VIEWS);
      this._touch('history');
    }

    recentSeries() {
      return this.data.history.series;
    }

    /** מוחק הכול: אירועים, חיפושים, סדרות שנצפו והמשך קריאה. */
    clearHistory() {
      this.data.history = defaults.history();
      this.data.opened = defaults.opened();
      this._touch('history', 'opened');
    }

    // ------------------------------------------ מצב מסכים, הגדרות וביקורים

    /** המצב השמור של לשונית (`all`, `seriesList`), או `null`. */
    viewState(tab) {
      return this.data.views.tabs[tab] || null;
    }

    /** שומר את מצב הלשונית (שאילתה, מסננים, מיון) לפתיחה הבאה. */
    setViewState(tab, value) {
      const next = cleaners.views({ tabs: { ...this.data.views.tabs, [tab]: value } }).tabs[tab];
      if (!next || JSON.stringify(next) === JSON.stringify(this.data.views.tabs[tab])) return;
      this.data.views.tabs[tab] = next;
      this._touch('views');
    }

    get presets() {
      return this.data.views.presets;
    }

    /** שומר הגדרת חיפוש בשם; שם קיים מתעדכן. מחזיר את ההגדרה, או `null` אם מלא. */
    savePreset(name, snapshot) {
      const clean = cleaners.views({ presets: [{ id: 'x', name, ...snapshot }] }).presets[0];
      if (!clean) return null;
      const list = this.data.views.presets;
      const existing = list.find((p) => p.name === clean.name);
      if (existing) {
        Object.assign(existing, {
          query: clean.query,
          filters: clean.filters,
          sort: clean.sort,
          t: this.now(),
        });
        this._touch('views');
        return existing;
      }
      if (list.length >= MAX_PRESETS) return null;
      const preset = {
        ...clean,
        id: 'p' + this.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        t: this.now(),
      };
      list.push(preset);
      this._touch('views');
      return preset;
    }

    deletePreset(id) {
      const preset = this.data.views.presets.find((p) => p.id === id) || null;
      this.data.views.presets = this.data.views.presets.filter((p) => p.id !== id);
      this._touch('views');
      return preset;
    }

    restorePreset(preset) {
      if (
        !preset ||
        this.data.views.presets.some((p) => p.id === preset.id) ||
        this.data.views.presets.length >= MAX_PRESETS
      )
        return;
      this.data.views.presets.push(preset);
      this._touch('views');
    }

    /**
     * "ביקור": נקודת הייחוס ל"חדשים מאז הביקור האחרון". כניסה אחרי פער של שעות
     * פותחת ביקור חדש (הבסיס = הפעם האחרונה שנראה); בתוך אותו ביקור הבסיס קבוע.
     */
    beginVisit() {
      const v = this.data.views;
      const now = this.now();
      if (!v.visitBase || (v.lastSeen && now - v.lastSeen > VISIT_GAP_MS))
        v.visitBase = v.lastSeen || now;
      v.lastSeen = now;
      this._touch('views');
    }

    /** מתי התחיל הביקור הקודם (או 0): "חדשים" = נוספו אחרי זה. */
    get visitBase() {
      return this.data.views.visitBase;
    }

    /** "סמן הכול כנקרא": הבסיס עובר לעכשיו. */
    markVisited() {
      this.data.views.visitBase = this.now();
      this._touch('views');
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

    /** מחליף את תוכן האוסף (ניקוי וביטול הניקוי). */
    setListEntries(listId, entries) {
      const list = this.data.lists.items.find((l) => l.id === listId);
      if (!list) return;
      list.entries = entries.slice(0, MAX_LIST_ENTRIES);
      this._touch('lists');
    }

    removeFromList(listId, id) {
      const list = this.data.lists.items.find((l) => l.id === listId);
      if (!list) return;
      list.entries = list.entries.filter((e) => e.id !== id);
      this._touch('lists');
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
      this.data.rules.rules = this.data.rules.rules.filter(
        (r) => !(r.field === rule.field && r.value === rule.value && r.action === rule.action),
      );
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
      const views = { v: 1, presets: this.data.views.presets };
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
        views,
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
      for (const name of ['prefs', 'favorites', 'series', 'rules', 'lists', 'read', 'views']) {
        if (raw[name] !== undefined) sections[name] = cleaners[name](raw[name]);
      }
      if (sections.prefs) sections.prefs.folder = null;
      const summary = {
        rules: sections.rules ? sections.rules.rules.length : 0,
        series: sections.series ? Object.keys(sections.series.items).length : 0,
        favorites: sections.favorites ? Object.keys(sections.favorites.items).length : 0,
        lists: sections.lists ? sections.lists.items.length : 0,
        read: sections.read ? Object.keys(sections.read.items).length : 0,
        presets: sections.views ? sections.views.presets.length : 0,
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
      if (s.prefs)
        d.prefs = { ...s.prefs, folder: d.prefs.folder, welcomeSeen: d.prefs.welcomeSeen };
      if (s.favorites)
        d.favorites.items = replace
          ? s.favorites.items
          : { ...d.favorites.items, ...s.favorites.items };
      if (s.read) d.read.items = replace ? s.read.items : { ...d.read.items, ...s.read.items };
      if (s.series)
        d.series.items = replace ? s.series.items : { ...d.series.items, ...s.series.items };
      if (s.rules) {
        if (replace) d.rules = s.rules;
        else {
          const have = new Set(d.rules.rules.map((r) => r.field + '|' + r.action + '|' + r.value));
          for (const r of s.rules.rules)
            if (!have.has(r.field + '|' + r.action + '|' + r.value))
              d.rules.rules.push({ ...r, id: Rules.newId() });
          d.rules.rules = d.rules.rules.slice(0, Rules.MAX_RULES);
          d.rules.mode = s.rules.mode;
        }
      }
      if (s.lists) {
        if (replace) d.lists = s.lists;
        else {
          const names = new Set(d.lists.items.map((l) => l.id));
          for (const l of s.lists.items)
            if (!names.has(l.id) && d.lists.items.length < MAX_LISTS) d.lists.items.push(l);
        }
      }
      if (s.views) {
        const have = new Set(d.views.presets.map((p) => p.name));
        const incoming = replace
          ? s.views.presets
          : s.views.presets.filter((p) => !have.has(p.name));
        d.views.presets = (replace ? [] : d.views.presets)
          .concat(
            incoming.map((p) => ({
              ...p,
              id: 'p' + this.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
            })),
          )
          .slice(0, MAX_PRESETS);
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
