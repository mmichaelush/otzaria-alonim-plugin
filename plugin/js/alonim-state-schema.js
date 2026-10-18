// סכמת המצב: ברירות מחדל, ניקוי קלט לכל תחום (`cleaners`), תקרות, ו"תצלום" של גיליון
// (`snapOf`). טהור: אין כאן זיכרון, רשת או DOM. ה-`State` (alonim-state.js) נשען עליו.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Rules = A.Rules;

  const SAVE_DELAY_MS = 700;
  const MAX_READ = 6000;
  const MAX_OPENED = 30;
  const MAX_FAVORITES = 5000;
  const MAX_LISTS = 50;
  const MAX_PRESETS = 30;
  const MAX_HISTORY = 300;
  const MAX_SEARCHES = 25;
  const MAX_SERIES_VIEWS = 12;
  const HISTORY_KINDS = ['opened', 'read', 'downloaded', 'printed'];
  /** פער שאחריו כניסה נחשבת ביקור חדש (עבור חדשים מאז הביקור האחרון). */
  const VISIT_GAP_MS = 6 * 3600 * 1000;
  const MAX_LIST_ENTRIES = 500;
  const MAX_IMPORT_BYTES = 3 * 1024 * 1024;
  const EXPORT_FORMAT = 'otzaria-alonim-settings';

  /** @type {Record<string, any>} */
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
    /** שמירת היסטוריה מקומית (נפתחו, נקראו, הורדו, הודפסו, חיפושים). */
    history: true,
    /** תאימות לאחור: להתעלם מהיכולות החדשות של המארח (אבחון ובדיקות). */
    legacyHost: false,
    /** לשונית פתיחה: week | all | series | mine. */
    startTab: 'week',
  });

  const defaults = {
    prefs: () => ({ ...DEFAULT_PREFS }),
    favorites: () => ({ v: 1, items: {} }),
    read: () => ({ v: 1, items: {} }),
    series: () => ({ v: 1, items: {} }),
    rules: () => Rules.emptyRules(),
    lists: () => ({ v: 1, items: [] }),
    opened: () => ({ v: 1, items: [] }),
    views: () => ({ v: 1, tabs: {}, presets: [], lastSeen: 0, visitBase: 0 }),
    history: () => ({ v: 1, events: [], searches: [], series: [] }),
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
      out.sort = ['relevance', 'new', 'date', 'alpha', 'size'].includes(p.sort)
        ? p.sort
        : 'relevance';
      out.thumbs = p.thumbs === true;
      out.diaspora = p.diaspora === true;
      out.autoDownload = p.autoDownload === true;
      out.autoDownloadCap = Math.min(30, Math.max(1, Math.round(num(p.autoDownloadCap, 5))));
      out.autoDay = typeof p.autoDay === 'string' ? p.autoDay.slice(0, 10) : '';
      out.autoCount = Math.max(0, Math.round(num(p.autoCount, 0)));
      out.welcomeSeen = p.welcomeSeen === true;
      out.history = p.history !== false;
      out.legacyHost = p.legacyHost === true;
      out.startTab = ['week', 'cycle', 'all', 'series', 'mine'].includes(p.startTab)
        ? p.startTab
        : 'week';
      out.folder =
        isObject(p.folder) && typeof p.folder.token === 'string' && p.folder.token
          ? {
              token: str(p.folder.token, 200),
              name: str(p.folder.name, 200),
              path: str(p.folder.path, 600),
            }
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
        const entries = (Array.isArray(l.entries) ? l.entries : [])
          .slice(0, MAX_LIST_ENTRIES)
          .map(cleanSnap)
          .filter(Boolean);
        out.items.push({
          id: str(l.id, 40),
          name: str(l.name, 80) || '—',
          kind: l.kind === 'shabbat' ? 'shabbat' : 'list',
          created: num(l.created, 0),
          entries,
        });
      }
      return out;
    },
    views(raw) {
      const out = defaults.views();
      if (!isObject(raw)) return out;
      const sorts = ['relevance', 'new', 'date', 'alpha', 'size'];
      const tabs = isObject(raw.tabs) ? raw.tabs : {};
      if (isObject(tabs.all)) {
        out.tabs.all = {
          query: str(tabs.all.query, 300),
          filters: A.Filters.clean(tabs.all.filters),
          sort: sorts.includes(tabs.all.sort) ? tabs.all.sort : 'relevance',
          group: ['week', 'series', 'year', 'circle', 'lang'].includes(tabs.all.group)
            ? tabs.all.group
            : '',
          includeHidden: tabs.all.includeHidden === true,
        };
      }
      if (isObject(tabs.seriesList)) {
        const t = tabs.seriesList;
        out.tabs.seriesList = {
          query: str(t.query, 200),
          circle: str(t.circle, 80),
          lang: str(t.lang, 10),
          mode: ['all', 'follow', 'fav', 'mute'].includes(t.mode) ? t.mode : 'all',
        };
      }
      if (isObject(tabs.cycle))
        out.tabs.cycle = { group: tabs.cycle.group === 'year' ? 'year' : 'series' };
      const seen = new Set();
      for (const p of (Array.isArray(raw.presets) ? raw.presets : []).slice(0, MAX_PRESETS)) {
        if (!isObject(p) || typeof p.id !== 'string' || seen.has(p.id)) continue;
        seen.add(p.id);
        out.presets.push({
          id: str(p.id, 40),
          name: str(p.name, 80).trim() || '—',
          query: str(p.query, 300),
          filters: A.Filters.clean(p.filters),
          sort: sorts.includes(p.sort) ? p.sort : 'relevance',
          t: num(p.t, 0),
        });
      }
      out.lastSeen = num(raw.lastSeen, 0);
      out.visitBase = num(raw.visitBase, 0);
      return out;
    },
    history(raw) {
      const out = defaults.history();
      if (!isObject(raw)) return out;
      for (const e of (Array.isArray(raw.events) ? raw.events : []).slice(0, MAX_HISTORY)) {
        const snap = cleanSnap(e);
        if (snap && HISTORY_KINDS.includes(e.k))
          out.events.push({ ...snap, k: e.k, t: num(e.t, 0) });
      }
      const seen = new Set();
      for (const s of (Array.isArray(raw.searches) ? raw.searches : []).slice(0, MAX_SEARCHES)) {
        if (!isObject(s) || typeof s.q !== 'string' || !s.q.trim() || seen.has(s.q)) continue;
        seen.add(s.q);
        out.searches.push({ q: str(s.q, 300), t: num(s.t, 0) });
      }
      for (const s of (Array.isArray(raw.series) ? raw.series : []).slice(0, MAX_SERIES_VIEWS)) {
        if (isObject(s) && typeof s.id === 'string' && s.id)
          out.series.push({ id: str(s.id, 40), t: num(s.t, 0) });
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

  const api = {
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
    cleanSnap,
    cleaners,
    defaults,
    isObject,
    num,
    snapOf,
    str,
  };
  A.StateSchema = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
