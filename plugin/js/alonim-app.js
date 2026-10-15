// הבקר: מחבר את השכבות (state, catalog, index, files) למסכים. מחזיק את מצב
// הניווט, את הפעולות שהמסכים קוראים להן, ואת אירועי אוצריא. אינו בונה DOM של
// מסכים: כל מסך הוא מחלקה ב-`alonim-ui-*.js` עם `mount/refresh/destroy`.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;
  const I18n = A.I18n;
  const Ui = A.Ui;
  const t = (text, vars) => I18n.t(text, vars);
  const N = (text) => text;

  /** שמות ברירת מחדל למקורות, עד שהמניפסט של הקטלוג מגיע. */
  const DEFAULT_SOURCES = Object.freeze({
    ladaat: { name: N('לדעת'), mode: 'catalog', status: 'ok' },
    tashma: { name: N('תשמע'), mode: 'catalog', status: 'ok' },
    gilyoines: { name: N('גיליונס'), mode: 'catalog', status: 'ok' },
    alonolam: { name: N('עלון עולם'), mode: 'catalog', status: 'ok' },
  });

  const TABS = Object.freeze([
    { id: 'week', label: N('השבוע'), icon: 'calendar_star_24_regular' },
    { id: 'all', label: N('כל העלונים'), short: N('הכול'), icon: 'library_24_regular' },
    { id: 'series', label: N('סדרות'), icon: 'text_bullet_list_24_regular' },
    { id: 'mine', label: N('האוספים שלי'), short: N('שלי'), icon: 'star_24_regular' },
    { id: 'settings', label: N('הגדרות'), icon: 'settings_24_regular' },
  ]);

  const NEW_DAYS = 7;
  const DAY_MS = 86400000;

  /** הודעות כשל קבועות (קוד → טקסט). ההחלטות בקוד נשענות על הקוד, לא על הטקסט. */
  const FILE_ERRORS = Object.freeze({
    no_folder: N('עוד לא נבחרה תיקייה לשמירת העלונים.'),
    blocked: N('הכתובת של הקובץ טרם אושרה באוצריא, ולכן אי אפשר להוריד אותו דרך התוסף. אפשר לפתוח את הגיליון באתר המקור.'),
    no_direct_link: N('המקור הזה מספק קישור לאתר בלבד, בלי הורדה ישירה.'),
    permission: N('לתוסף אין הרשאה לשמור קבצים בתיקייה.'),
    not_pdf: N('הקובץ שירד אינו PDF תקין, ולכן נמחק. אפשר לנסות שוב או לפתוח באתר המקור.'),
    truncated: N('ההורדה נקטעה באמצע. אפשר לנסות שוב.'),
    timeout: N('ההורדה לקחה יותר מדי זמן. אפשר לנסות שוב.'),
    failed: N('ההורדה נכשלה. אפשר לנסות שוב.'),
    missing_file: N('הקובץ נמחק מהתיקייה. אפשר להוריד אותו שוב.'),
    open_failed: N('אוצריא לא הצליחה לפתוח את הקובץ.'),
    cancelled: N('ההורדה בוטלה.'),
    missing_data: N('פרטי הגיליון אינם זמינים כרגע (הקטלוג עדיין נטען, או שאין חיבור). אפשר לנסות שוב או לפתוח באתר המקור.'),
    forbidden_folder: N('אוצריא אינה מאפשרת לבחור את התיקייה הזו (תיקיית מערכת או שורש כונן). בחרו תיקייה ייעודית, למשל תחת "מסמכים".'),
    pick_failed: N('בחירת התיקייה נכשלה.'),
  });

  class App {
    constructor(bridge, doc) {
      this.doc = doc;
      this.bridge = bridge;
      this.log = new A.Log.Log();
      this.runtime = A.Runtime.createRuntime(bridge, { logger: this.log });
      this.online = null;
      this.platform = '';
      this.hostVersion = '';
      this.hostLanguage = 'he';
      this.permissions = [];
      this.listeners = new Map();
      this.ready = false;
      this.suspended = false;
      this.dataVersion = 0;
      this.dataTimer = null;
      this.newCutoff = Date.now() - NEW_DAYS * DAY_MS;

      /** יכולות המארח (fetchFile, printFile): המקור היחיד לשאלה "האם יש". */
      this.caps = new A.Capabilities.Capabilities({ log: this.log });
      this.state = new A.State.State(this.runtime, { log: this.log });
      this.index = new A.Index.CatalogIndex({ source: (id) => this.sourceInfo(id).name });
      this.catalog = new A.Catalog.Catalog(this.runtime, { log: this.log, online: () => this.online });
      this.files = new A.Files.Files(this.runtime, {
        log: this.log,
        getFolder: () => this.state.prefs.folder,
        setFolder: (folder) => this.state.setPref('folder', folder),
        hiddenSources: (item) => (this.index.decision(this.index.get(item.id) || item).hiddenSources || []),
        preferredSource: (item) => this.state.preferredSource(item.series),
        previousIds: (id) => this.index.previousIdsOf(id),
        caps: this.caps,
      });

      /** מצב התצוגה של המסכים: שורד מעבר בין לשוניות. */
      this.view = {
        route: { tab: 'week', series: null },
        /** 'blob' אחרי שהמשתמש ביקש הצגה חלופית: הצפיין לא משתמש ב-iframe ישיר עד הסגירה. */
        viewerMode: '',
        weekDate: '',
        weekMore: 12,
        all: { query: '', filters: {}, sort: 'relevance', group: '', includeHidden: false, builder: false, scroll: 0 },
        seriesList: { query: '', circle: '', lang: '', mode: 'all', scroll: 0 },
        seriesPage: { query: '', scroll: 0 },
        mine: { tab: 'favorites', list: '' },
        settings: { section: '' },
      };
      /** מצב בחירה מרובה ("כל העלונים", דף סדרה): מזהי הגיליונות שנבחרו. */
      this.selection = { on: false, ids: new Set() };
      this.viewer = null;
      this.screen = null;
      this.lastQueryMs = 0;
    }

    // ------------------------------------------------------ אירועים

    on(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
      return () => this.listeners.get(name).delete(fn);
    }

    emit(name, payload) {
      for (const fn of this.listeners.get(name) || []) {
        try {
          fn(payload);
        } catch (error) {
          this.log.error('listener ' + name + ' failed', error);
        }
      }
    }

    // ------------------------------------------------------- הפעלה

    /** `plugin.boot`: ערכה, שפה, קישוריות; ואז מצב, ממשק, וקטלוג. בטוח לקריאה חוזרת. */
    async boot(payload) {
      const p = payload || {};
      const host = p.app || {};
      this.platform = host.platform || '';
      this.hostVersion = host.version || '';
      this.caps.setHost(this.hostVersion);
      this.hostLanguage = host.language || 'he';
      this.permissions = Array.isArray(p.permissions) ? p.permissions : [];
      const connectivity = p.connectivity || {};
      this.online = typeof connectivity.isOnline === 'boolean' ? connectivity.isOnline : null;
      if (p.theme) A.Theme.applyTheme(p.theme);
      if (this.ready) return;
      this.ready = true;

      await this.state.load();
      this.applyPrefs();
      this.caps.setOverride(this.state.prefs.legacyHost);
      this.state.beginVisit();
      this.restoreViews();
      this.state.onChange((domains) => this.onStateChange(domains));
      this.index.setRules(this.state.rules);

      this.catalog.onData((event) => this.onCatalogData(event));
      this.catalog.onStatus(() => this.emit('sync'));
      this.files.onChange(() => this.emit('files'));
      this.files.onDisk(() => this.emit('disk'));
      this.mountShell();
      this.emit('route');

      if (this.online === null) {
        const c = await this.runtime.callSoft('app.getConnectivity', {});
        this.online = c && typeof c.isOnline === 'boolean' ? c.isOnline : true;
      }
      // הציור הראשון לא מחכה לרשת: המטמון קודם, והסנכרון ברקע.
      this.catalog.start().catch((error) => this.log.warn('catalog start failed', error));
      setTimeout(() => this.files.hasFolder && this.files.scan(), 400);
      if (typeof root.addEventListener === 'function') {
        root.addEventListener('online', () => this.setOnline(true));
        root.addEventListener('offline', () => this.setOnline(false));
        // שמירה מאוחדת (debounce) אינה אמורה לאבד שינוי שהמשתמש עשה לפני שהלשונית נסגרה.
        root.addEventListener('pagehide', () => {
          this.state.flush();
          this.files.releaseRemote();
        });
        this.doc.addEventListener('visibilitychange', () => {
          if (this.doc.visibilityState === 'hidden') this.state.flush();
        });
      }
    }

    setOnline(value) {
      const was = this.online;
      this.online = value;
      this.emit('sync');
      if (value && was === false) this.catalog.sync();
    }

    /** מצב המסכים מההפעלה הקודמת: שאילתה, מסננים ומיון ב"כל העלונים", ורשימת הסדרות. */
    restoreViews() {
      const all = this.state.viewState('all');
      this.view.all.sort = this.state.prefs.sort;
      this.view.route.tab = this.state.prefs.startTab;
      if (all) Object.assign(this.view.all, { query: all.query, filters: all.filters, sort: all.sort, group: all.group, includeHidden: all.includeHidden });
      const series = this.state.viewState('seriesList');
      if (series) Object.assign(this.view.seriesList, series);
    }

    /** "שנים ישנות": טוען את השרדים הקרים (לא נטענים אוטומטית, בגלל הנפח). */
    async loadCold() {
      if (this.coldLoading) return;
      const pending = this.catalog.coldPending();
      if (!pending.shards) return;
      this.coldLoading = { done: 0, total: pending.shards };
      this.emit('sync');
      const ok = await this.catalog.loadCold((done, total) => {
        this.coldLoading = { done, total };
        this.emit('sync');
      });
      this.coldLoading = null;
      this.emit('sync');
      this.toast(ok ? t('שנים ישנות נטענו') : t('חלק מהשנים הישנות לא נטענו. אפשר לנסות שוב.'), { error: !ok });
    }

    suspend() {
      this.suspended = true;
      this.catalog.suspend();
      this.state.flush();
    }

    resume() {
      this.suspended = false;
      this.catalog.resume();
      if (this.files.hasFolder) this.files.scan();
    }

    applyPrefs() {
      const prefs = this.state.prefs;
      A.Theme.applyScale(prefs.scale);
      const language = I18n.resolveLanguage(prefs.lang, this.hostLanguage);
      I18n.configure(language);
      I18n.applyDocumentLanguage(this.doc);
      this.doc.title = t('עלוני שבת');
    }

    onStateChange(domains) {
      if (domains.includes('rules')) this.index.setRules(this.state.rules);
      if (domains.includes('prefs')) {
        this.caps.setOverride(this.state.prefs.legacyHost);
        const before = I18n.language;
        this.applyPrefs();
        this.emit('prefs', { languageChanged: before !== I18n.language });
      }
      this.emit('state', domains);
    }

    onCatalogData(event) {
      if (event.kind === 'series') {
        this.index.setSeries(event.data);
        this.state.migrateSeriesIds((id) => this.index.resolveSeriesId(id));
      } else if (event.kind === 'weeks') {
        this.index.setWeeks(event.data);
      } else if (event.kind === 'weeksArchive') {
        this.index.setWeeksArchive(event.data);
      } else if (event.kind === 'sources') {
        this.index.setSources(event.data);
      } else {
        // האינדקס זוכר מאיזה קובץ הגיליון הגיע, לקריאת הכתובות לפי דרישה.
        this.index.addIssues(event.data, event.id);
      }
      this.dataVersion++;
      // גיליון שמזההו השתנה: מצב המשתמש עובר למזהה החדש (אידמפוטנטי, לא מאבד דבר).
      if (this.index.aliasVersion !== this.aliasMigrated) {
        this.aliasMigrated = this.index.aliasVersion;
        const moved = this.state.migrateIssueIds((id) => this.index.resolveIssueId(id));
        if (moved) this.log.info('migrated ' + moved + ' state entries to new issue ids');
      }
      // כמה שרדים ברצף = ציור אחד, לא אחד לכל שרד.
      clearTimeout(this.dataTimer);
      this.dataTimer = setTimeout(() => {
        this.emit('data', event.kind);
        this.maybeAutoDownload();
      }, event.cached === false && event.kind !== 'recent' ? 400 : 60);
    }

    // ------------------------------------------------------- מקורות

    sourceInfo(id) {
      const manifestSource = this.catalog.sources.find((s) => s.id === id);
      const fallback = DEFAULT_SOURCES[id];
      if (manifestSource) {
        return { id, name: manifestSource.name || id, mode: manifestSource.mode || 'catalog', status: manifestSource.status || 'ok', note: manifestSource.note || '', url: manifestSource.url || '', checkedAt: manifestSource.checkedAt, lastOkAt: manifestSource.lastOkAt, issueCount: manifestSource.issueCount };
      }
      return { id, name: fallback ? t(fallback.name) : id, mode: fallback ? fallback.mode : 'catalog', status: fallback ? fallback.status : 'ok', note: '', url: '', issueCount: 0 };
    }

    /** כל המקורות המוכרים: מהמניפסט, ואם עוד אין — ברירות המחדל. */
    allSources() {
      const list = this.catalog.sources.length ? this.catalog.sources.map((s) => s.id) : Object.keys(DEFAULT_SOURCES);
      return list.map((id) => this.sourceInfo(id));
    }

    /** שמות המקורות שממנו הגיליון, לקרדיט. */
    creditNames(item) {
      const ids = [...new Set((item.assets || []).map((a) => a.src))];
      return ids.map((id) => this.sourceInfo(id).name).join(' · ');
    }

    sourceHosts() {
      return this.catalog.sources.map((s) => (Core.parseUrl(s.url) || {}).hostname).filter(Boolean);
    }

    // -------------------------------------------------- מצב כרטיס

    /**
     * "חדש": נוסף בשבוע האחרון ולא נקרא. ייבוא המוני של ארכיון (tashma) נותן
     * לגיליונות ישנים `added` חדש, ולכן גיליון עם תאריך שבת ישן אינו חדש.
     */
    isNew(item) {
      if (!(item._added > this.newCutoff) || this.state.isRead(item.id)) return false;
      return !item._date || item._date > Date.now() - 70 * DAY_MS;
    }

    /**
     * הגיליון המלא (עם כתובות): הקטלוג בזיכרון רזה, והכתובות נקראות מקובץ
     * השרד רק כשצריך להוריד או לפתוח. `null` כשלא נמצא.
     */
    async full(item) {
      if (item._full) return item;
      this.fullCache = this.fullCache || new Map();
      if (this.fullCache.has(item.id)) return this.fullCache.get(item.id);
      const full = await this.catalog.hydrate(item);
      if (full) {
        this.fullCache.set(item.id, full);
        if (this.fullCache.size > 40) this.fullCache.delete(this.fullCache.keys().next().value);
      }
      return full;
    }

    /** היום, לפי שעון המכשיר. נקודה אחת, כדי שבדיקות יוכלו להחליף תאריך. */
    today() {
      return new Date();
    }

    /**
     * לוח השבועות להצגה (תצוגות `Weeks.view`): `weeks.json` ושורות נגזרות לשנים
     * שאינן בלוח, לפי ארץ ישראל / חוץ לארץ. נשמר עד שהאינדקס או ההעדפה משתנים.
     */
    weekViews() {
      const diaspora = Boolean(this.state.prefs.diaspora);
      const key = this.index.version + '|' + diaspora;
      if (!this._weekViews || this._weekViews.key !== key) {
        this._weekViews = { key, views: A.Weeks.build(this.index.allWeeks(), { diaspora }) };
      }
      return this._weekViews.views;
    }

    /** טוען את לוח השנים הישנות (לפי בקשה בבורר השבועות). `true` בהצלחה. */
    async loadWeeksArchive() {
      return this.catalog.ensureWeeksArchive();
    }

    /** תצוגת "השבוע" הנוכחי (לפי היום), או `null` כשאין לוח. */
    currentWeekView() {
      const views = this.weekViews();
      const cur = A.Weeks.current(views, Core.ymd(this.today()));
      return views[cur.index] || null;
    }

    cardState(item) {
      const decision = this.index.decision(item);
      const hidden = decision.action === 'hide';
      return {
        favorite: this.state.isFavorite(item.id),
        read: this.state.isRead(item.id),
        downloaded: this.files.isDownloaded(item),
        job: this.files.jobFor(item),
        isNew: this.isNew(item),
        followed: this.state.isFollowed(item.series),
        hidden,
        hiddenReason: hidden ? A.Rules.reasonText(decision, this.ruleNames(), this.state.rules.mode) : '',
        pinned: decision.pin,
        noDownload: decision.noDownload,
      };
    }

    ruleNames() {
      return {
        source: (id) => this.sourceInfo(id).name,
        lang: (code) => Core.langName(code),
        series: (id) => this.index.seriesTitleOf(id) || id,
      };
    }

    /** המסנן והפרדיקטים של האינדקס: מצב המשתמש. */
    searchContext() {
      const inLists = new Set();
      for (const list of this.state.lists) for (const entry of list.entries) inLists.add(entry.id);
      return {
        isFavorite: (it) => this.state.isFavorite(it.id),
        isFollowed: (it) => this.state.isFollowed(it.series),
        isRead: (it) => this.state.isRead(it.id),
        isDownloaded: (it) => this.files.isDownloaded(it),
        inList: (it) => inLists.has(it.id),
        isNew: (it) => this.isNew(it),
        lastVisit: this.state.visitBase,
      };
    }

    // --------------------------------------------------------- ניווט

    get route() {
      return this.view.route;
    }

    go(tab, options) {
      const o = options || {};
      if (this.selection.on) this.setSelecting(false);
      this.closeViewer(true);
      this.view.route = { tab, series: o.series || null };
      if (o.mineTab) this.view.mine.tab = o.mineTab;
      if (o.section) this.view.settings.section = o.section;
      if (o.query !== undefined) this.view.all.query = o.query;
      if (o.filters) this.view.all.filters = A.Filters.clean(o.filters);
      this.emit('route', o);
      this.state.flush();
    }

    openSeries(seriesId) {
      this.go('series', { series: this.index.resolveSeriesId(seriesId) });
    }

    /** Ctrl+/ או /: חיפוש. עובר ל"כל העלונים" וממקד את השדה. */
    focusSearch() {
      if (this.view.route.tab !== 'all' || this.viewer) this.go('all');
      this.emit('focus-search');
    }

    // --------------------------------------------------- בחירה מרובה

    setSelecting(on) {
      this.selection.on = Boolean(on);
      if (!on) this.selection.ids.clear();
      this.emit('selection');
    }

    isSelected(id) {
      return this.selection.ids.has(id);
    }

    toggleSelected(item) {
      const ids = this.selection.ids;
      if (ids.has(item.id)) ids.delete(item.id);
      else ids.add(item.id);
      this.emit('selection');
    }

    /** מוסיף ל-(או מסיר מ-) הבחירה את כל [items]. */
    selectMany(items, on) {
      for (const item of items) {
        if (on) this.selection.ids.add(item.id);
        else this.selection.ids.delete(item.id);
      }
      this.emit('selection');
    }

    /** הגיליונות שנבחרו (אלה שנמצאים באינדקס), בסדר הבחירה. */
    selectedItems() {
      return [...this.selection.ids].map((id) => this.index.get(id)).filter(Boolean);
    }

    // ------------------------------------------------------- פעולות

    toast(message, options) {
      if (this.toasts) this.toasts.show(message, options);
    }

    announce(text) {
      if (this.announcer) this.announcer.announce(text);
    }

    toggleFavorite(item) {
      const on = this.state.toggleFavorite(item);
      this.announce(on ? t('נוסף למועדפים') : t('הוסר מהמועדפים'));
    }

    toggleRead(item) {
      const read = !this.state.isRead(item.id);
      this.state.markRead(item, read);
      if (read) this.state.logEvent('read', item);
    }

    toggleFollow(seriesId) {
      const on = !this.state.isFollowed(seriesId);
      this.state.setSeries(seriesId, { follow: on });
      const name = this.index.seriesTitleOf(seriesId);
      this.toast(on ? t('עוקבים אחרי "{name}"', { name }) : t('הפסקת מעקב אחרי "{name}"', { name }));
    }

    /** "הסתר סדרה זו": כלל חסימה מפורש, עם ביטול. */
    hideSeries(item) {
      const seriesId = item.series;
      const name = item.seriesTitle || item.title;
      const rule = this.state.addRule({ action: 'hide', field: 'series', value: seriesId, label: name });
      if (!rule) return;
      this.toast(t('הסדרה "{name}" הוסתרה', { name }), {
        action: {
          label: t('ביטול הפעולה'),
          run: () => this.state.removeRule(rule.id),
        },
      });
    }

    /** פתיחת גיליון: ברירת המחדל של לחיצה — צפיין פנימי. */
    openIssue(item, ctx, options) {
      this.state.addOpened(item);
      this.state.logEvent('opened', item);
      this.viewer = { item, ctx: ctx || null, options: options || {}, token: (this.viewerToken = (this.viewerToken || 0) + 1) };
      Ui.closeMenu();
      this.emit('viewer', this.viewer);
    }

    print(item, ctx) {
      this.state.logEvent('printed', item);
      this.openIssue(item, ctx, { print: true });
    }

    closeViewer(silent) {
      this.view.viewerMode = '';
      if (!this.viewer) return;
      this.viewer = null;
      this.viewerToken++;
      if (!silent) this.emit('viewer', null);
      else this.emit('viewer', null);
    }

    showDetails(item, ctx) {
      this.emit('details', { item, ctx });
    }

    addToListDialog(item) {
      this.emit('add-to-list', item);
    }

    /** "הורדה": שמירה קבועה בתיקייה. בלי תיקייה — קודם בוחרים אחת. */
    async download(item, src) {
      if (!this.files.hasFolder) {
        this.emit('need-folder', { then: () => this.download(item) });
        return;
      }
      const decision = this.index.decision(item);
      if (decision.noDownload) {
        this.toast(t('לפי כלל סינון, גיליון זה אינו מורד אוטומטית. אפשר לפתוח אותו לקריאה.'), { error: false });
      }
      const job = await this.queueSave(item, src);
      if (!job) return;
      this.toast(t('מוסיף להורדה: {title}', { title: Core.sanitizeFileName(item.seriesTitle || item.title, 40) }));
      const done = await job.done;
      if (done.status === 'done') {
        this.toast(t('ההורדה הסתיימה: {title}', { title: item.seriesTitle || item.title }));
      } else if (done.status === 'failed') {
        this.downloadFailed(item);
      }
    }

    /**
     * מוסיף לתור ההורדות (שמירה קבועה) אחרי שהפרטים המלאים (הכתובות) נקראו.
     * `null` כשהם אינם זמינים: מודיעים, ואפשר לנסות שוב או לפתוח באתר.
     */
    async queueSave(item, src) {
      const full = await this.full(item);
      if (!full) {
        this.toast(this.fileErrorText('missing_data'), { error: true });
        return null;
      }
      const job = this.files.enqueue(full, 'save', src);
      if (job && job.done) job.done.then((done) => done && done.status === 'done' && this.state.logEvent('downloaded', item));
      return job;
    }

    /** תיבת בירור אחרי כשל: מה קרה, ומה אפשר לעשות. */
    downloadFailed(item) {
      const job = this.files.jobFor(item);
      this.emit('download-failed', { item, code: job && job.error ? job.error.code : 'failed' });
    }

    fileErrorText(code) {
      return t(FILE_ERRORS[code] || FILE_ERRORS.failed);
    }

    /** פתיחת דף הגיליון/האתר של המקור המועדף. */
    async openSiteFor(item) {
      const full = (await this.full(item)) || item;
      return this.openSite(this.pickSiteAsset(full));
    }

    pickSiteAsset(item) {
      const preferred = this.state.preferredSource(item.series);
      return item.assets.find((a) => a.src === preferred && (a.page || a.url)) || item.assets.find((a) => a.page) || item.assets.find((a) => a.url) || item.assets[0];
    }

    async openSite(asset) {
      if (!asset) return false;
      const url = asset.page || (this.sourceInfo(asset.src).url) || asset.url;
      const ok = await this.files.openOnSite(url, this.sourceHosts());
      if (!ok) this.toast(t('אי אפשר לפתוח את הכתובת הזו: היא אינה מאתר מקור מוכר.'), { error: true });
      return ok;
    }

    // ------------------------------------------- הורדה אוטומטית

    /** גיליונות חדשים בסדרות שעוקבים אחריהן, עד מכסה יומית. כבוי כברירת מחדל. */
    maybeAutoDownload() {
      const prefs = this.state.prefs;
      if (!prefs.autoDownload || !this.files.hasFolder || this.suspended || this.catalog.syncing) return;
      if (this.files.diskState.status !== 'ok') return;
      const today = Core.ymd(new Date());
      let count = prefs.autoDay === today ? prefs.autoCount : 0;
      const followed = new Set(this.state.followedIds());
      if (!followed.size) return;
      const candidates = [];
      for (const sid of followed) {
        for (const i of this.index.issuesOfSeries(sid)) {
          const item = this.index.item(i);
          if (!this.isNew(item) || this.files.isDownloaded(item) || this.files.jobFor(item)) continue;
          if (this.index.decision(item).noDownload) continue;
          candidates.push(item);
        }
      }
      candidates.sort((a, b) => b._added - a._added);
      const start = count;
      const picked = [];
      for (const item of candidates) {
        if (count >= prefs.autoDownloadCap) break;
        picked.push(item);
        count++;
      }
      if (count !== start) {
        this.state.setPref('autoDay', today);
        this.state.setPref('autoCount', count);
      }
      for (const item of picked) this.queueSave(item);
    }

    // ----------------------------------------------------- אוספים

    quickAddToList(listId, item, quiet) {
      const ok = this.state.addToList(listId, item);
      const list = this.state.lists.find((l) => l.id === listId);
      if (!quiet || !ok) this.toast(ok ? t('נוסף ל"{name}"', { name: list ? list.name : '' }) : t('האוסף מלא'), { error: !ok });
    }

    // ---------------------------------------------------- קיצורים

    /** מקשי המקלדת של התוסף כולו. מחזיר true כשטיפל. */
    onKey(event) {
      const key = event.key;
      const target = event.target;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      // לא Ctrl+K: באוצריא זה "החלף שולחן עבודה" (ברירת המחדל שלה), והחלון שלה גונב את המיקוד.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === '/' || event.code === 'Slash')) {
        event.preventDefault();
        if (!Ui.topDialog()) this.focusSearch();
        return true;
      }
      if (key === 'Escape') {
        if (document.querySelector('.menu')) {
          Ui.closeMenu(true);
          return true;
        }
        if (Ui.topDialog()) return false;
        if (this.viewer) {
          this.closeViewer();
          return true;
        }
        this.emit('escape', event);
        return true;
      }
      if (key === '?' && !typing && !Ui.topDialog()) {
        this.emit('shortcuts');
        return true;
      }
      if (key === '/' && !typing && !Ui.topDialog() && !this.viewer) {
        event.preventDefault();
        this.focusSearch();
        return true;
      }
      return false;
    }
  }

  const api = { App, TABS, DEFAULT_SOURCES, FILE_ERRORS, NEW_DAYS };
  A.AppModule = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
