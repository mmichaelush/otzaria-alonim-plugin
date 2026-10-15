// "כל העלונים": חיפוש מיידי, מסננים (חלון מסננים ותגיות פעילות), מיון, גלילה
// וירטואלית. לעולם לא יותר מ-60 כרטיסים ב-DOM. מצב המסך (שאילתה, מסננים, מיון)
// נשמר בין הפעלות (`state.setViewState('all')`).
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Cards = A.Cards;
  const Core = A.Core;
  const Filters = A.Filters;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const { selectField, keepFocus, SORT_LABELS } = A.BrowseHelpers;
  const t = (text, vars) => I18n.t(text, vars);

  const N = (text) => text;

  /** דגלים שמופיעים גם כלחצני מסנן מהיר בשורת הכלים. */
  const QUICK_FLAGS = [
    ['favorite', N('מועדפים'), 'star_24_regular'],
    ['downloaded', N('הורדו'), 'arrow_download_24_regular'],
    ['unread', N('לא נקראו'), 'circle_24_regular'],
    ['isNew', N('חדשים'), 'alert_24_regular'],
  ];

  class AllScreen {
    constructor(app) {
      this.app = app;
      this.fill = true;
      this.result = { idx: [], total: 0, hidden: 0, ms: 0, query: { tokens: [] } };
      this.pending = false;
      this.unsub = [];
    }

    get v() {
      return this.app.view.all;
    }

    mount(host) {
      const app = this.app;
      const v = this.v;
      this.host = host;
      this.input = el('input', {
        class: 'search-input',
        type: 'search',
        value: v.query,
        placeholder: t('חיפוש עלונים: שם סדרה, פרשה, שנה…'),
        'aria-label': t('חיפוש עלונים'),
        title: t('חיפוש (Ctrl+/)'),
        autocomplete: 'off',
        spellcheck: 'false',
        enterkeyhint: 'search',
        dir: 'auto',
      });
      this.input.addEventListener('input', () => {
        v.query = this.input.value;
        this.clearBtn.hidden = !v.query;
        this.renderSuggest();
        this.schedule();
      });
      // חיפוש שהושלם (Enter או יציאה מהשדה) נכנס להיסטוריית החיפושים.
      this.input.addEventListener('change', () => app.state.addSearch(this.input.value));
      this.input.addEventListener('focus', () => this.renderSuggest(true));
      this.input.addEventListener('blur', () => setTimeout(() => !this.suggestHost.contains(document.activeElement) && this.hideSuggest(), 120));
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' && !this.suggestHost.hidden) {
          event.preventDefault();
          const first = this.suggestHost.querySelector('button');
          if (first) first.focus();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          Cards.focusItem(this.list, 0, this.perRow);
        } else if (event.key === 'Escape' && !this.suggestHost.hidden) {
          event.preventDefault();
          event.stopPropagation();
          this.hideSuggest();
        } else if (event.key === 'Escape' && v.query) {
          event.preventDefault();
          event.stopPropagation();
          this.setQuery('');
        }
      });
      this.clearBtn = Ui.iconButton('dismiss_24_regular', t('ניקוי החיפוש'), () => {
        this.setQuery('');
        this.input.focus();
      }, { className: 'search-clear' });
      this.clearBtn.hidden = !v.query;
      this.builderBtn = Ui.iconButton('filter_24_regular', t('בונה שאילתות'), () => {
        v.builder = !v.builder;
        this.renderBuilder();
      }, { className: 'search-tool', expanded: v.builder, pressed: v.builder });
      this.filtersBtn = Ui.button('tonal', '', () => this.openPanel(), { icon: 'filter_24_regular', className: 'filters-toggle button-small', key: 'filters' });

      this.suggestHost = el('div', { class: 'search-suggest', hidden: true, role: 'group', 'aria-label': t('חיפושים אחרונים ושמורים') });
      this.suggestHost.addEventListener('keydown', (event) => this.onSuggestKey(event));
      this.suggestHost.addEventListener('focusout', () => setTimeout(() => !this.suggestHost.contains(document.activeElement) && document.activeElement !== this.input && this.hideSuggest(), 120));
      const searchBar = el('div', { class: 'search-bar' }, icon('search_24_regular'), this.input, this.clearBtn, this.builderBtn, this.filtersBtn);
      this.builderHost = el('div', { class: 'builder-host' });
      this.filterRow = el('div', { class: 'filter-row is-always' });
      this.chipsHost = el('div', { class: 'chips-host' });
      this.countLine = el('div', { class: 'results-line', 'aria-live': 'polite' });
      this.listHost = el('div', { class: 'list-host' });

      this.list = new Ui.VList({ className: 'results-list', label: t('תוצאות החיפוש') });
      this.list.onResize = () => this.layout();
      this.listHost.appendChild(this.list.root);
      Cards.attachListKeys(this.list, () => ({ count: this.result.idx.length, perRow: this.perRow }));
      this.perRow = 1;

      this.selectionBar = new A.Selection.SelectionBar(app, { count: () => this.result.idx.length, all: () => this.result.idx.map((i) => app.index.item(i)) });
      host.replaceChildren(
        el('div', { class: 'page fill-page all-page' }, el('div', { class: 'toolbar' }, el('div', { class: 'search-wrap' }, searchBar, this.suggestHost), this.builderHost, this.filterRow, this.chipsHost, this.countLine), this.listHost, this.selectionBar.el),
      );
      this.renderQuickRow();
      this.renderChips();
      this.renderBuilder();
      this.ensureYears();
      this.run();

      this.unsub.push(
        // שרד שהגיע ברקע מרענן את התוצאות, אבל לא מקפיץ את הגלילה של המשתמש.
        app.on('data', () => this.schedule(true)),
        app.on('state', (domains) => this.onState(domains)),
        app.on('files', () => this.refresh()),
        app.on('selection', () => {
          this.renderQuickRow();
          this.refresh();
        }),
        app.on('disk', () => this.onDisk()),
        app.on('prefs', () => {
          this.list.measure();
          this.layout();
        }),
        app.on('focus-search', () => {
          this.input.focus();
          this.input.select();
        }),
        app.on('escape', () => {
          if (app.selection.on) app.setSelecting(false);
          else if (v.query) this.setQuery('');
        }),
      );
      if (v.scroll) this.list.root.scrollTop = v.scroll;
      this.list.root.addEventListener('scroll', () => {
        v.scroll = this.list.root.scrollTop;
      }, { passive: true });
    }

    destroy() {
      for (const off of this.unsub) off();
      this.selectionBar.destroy();
      this.list.destroy();
    }

    // --------------------------------- חיפושים אחרונים ושמורים

    hideSuggest() {
      this.suggestHost.hidden = true;
    }

    /** מציג חיפושים שמורים ואחרונים כשהשדה ריק; נעלם עם הקלדה. */
    renderSuggest(focusing) {
      const { app } = this;
      const presets = app.state.presets;
      const searches = app.state.searches;
      if (this.v.query || (!presets.length && !searches.length)) {
        this.hideSuggest();
        return;
      }
      if (!focusing && this.suggestHost.hidden) return;
      const row = (label, iconName, onPick, onRemove, removeLabel) =>
        el(
          'div',
          { class: 'suggest-row' },
          el('button', { type: 'button', class: 'suggest-pick', onclick: onPick }, icon(iconName), el('span', { class: 'suggest-text', dir: 'auto' }, label)),
          onRemove ? Ui.iconButton('dismiss_24_regular', removeLabel, onRemove, { className: 'suggest-remove' }) : null,
        );
      const nodes = [];
      if (presets.length) {
        nodes.push(el('h3', { class: 'suggest-title' }, t('הגדרות שמורות')));
        for (const p of presets) nodes.push(row(p.name, 'bookmark_multiple_24_regular', () => { this.applyPreset(p); this.hideSuggest(); }));
      }
      if (searches.length) {
        nodes.push(
          el(
            'h3',
            { class: 'suggest-title' },
            t('חיפושים אחרונים'),
            el('button', { type: 'button', class: 'link-button', onclick: () => { app.state.clearSearches(); this.renderSuggest(true); } }, t('ניקוי')),
          ),
        );
        for (const s of searches.slice(0, 8)) {
          nodes.push(row(s.q, 'history_24_regular', () => { this.setQuery(s.q); this.hideSuggest(); this.input.focus(); }, () => { app.state.removeSearch(s.q); this.renderSuggest(true); }, t('הסרת החיפוש מההיסטוריה')));
        }
      }
      Ui.fill(this.suggestHost, nodes);
      this.suggestHost.hidden = false;
    }

    onSuggestKey(event) {
      const buttons = [...this.suggestHost.querySelectorAll('button')];
      const at = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = at + (event.key === 'ArrowDown' ? 1 : -1);
        if (next < 0) this.input.focus();
        else if (buttons[next]) buttons[next].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.hideSuggest();
        this.input.focus();
      }
    }

    // -------------------------------------------------- מצב ושמירה

    setQuery(text) {
      this.v.query = text;
      this.input.value = text;
      this.clearBtn.hidden = !text;
      this.schedule();
      if (text) this.hideSuggest();
    }

    /** מחליף את המסננים: מציג תגיות, טוען שנים שחסרות, ומריץ מחדש. */
    setFilters(filters) {
      this.v.filters = Filters.clean(filters);
      this.ensureYears();
      this.renderQuickRow();
      this.renderChips();
      this.schedule();
      this.updateCount();
    }

    applyPreset(preset) {
      const v = this.v;
      v.query = preset.query;
      this.input.value = preset.query;
      this.clearBtn.hidden = !preset.query;
      v.sort = preset.sort;
      this.setFilters(preset.filters);
    }

    /** שומר את המצב לפתיחה הבאה (השמירה עצמה מאוחדת ב-State). */
    persist() {
      const v = this.v;
      this.app.state.setViewState('all', { query: v.query, filters: v.filters, sort: v.sort, includeHidden: v.includeHidden });
    }

    /**
     * מסנן שנה או טווח שנים/תאריכים מבקש שנים שאולי עוד לא נטענו: טוענים אותן
     * (השרדים הקרים אינם נטענים אוטומטית). הציור מתעדכן עם כל שרד שמגיע.
     */
    ensureYears() {
      const f = this.v.filters;
      const years = new Set(f.hy || []);
      const manifest = [...this.app.catalog.yearCounts().keys()];
      let from = f.hyFrom || 0;
      let to = f.hyTo || 0;
      if (f.dateFrom && !from) from = A.HebCal.fromDate(Core.parseYmd(f.dateFrom)).year;
      if (f.dateTo && !to) to = A.HebCal.fromDate(Core.parseYmd(f.dateTo)).year;
      if (from || to) for (const y of manifest) if ((!from || y >= from) && (!to || y <= to)) years.add(y);
      for (const y of years) this.app.catalog.ensureYear(Number(y));
    }

    /** שנים שהמסננים מבקשים ועדיין נטענות. */
    loadingYears() {
      const f = this.v.filters;
      const catalog = this.app.catalog;
      const wanted = new Set(f.hy || []);
      if (f.hyFrom || f.hyTo) for (const y of catalog.yearCounts().keys()) if ((!f.hyFrom || y >= f.hyFrom) && (!f.hyTo || y <= f.hyTo)) wanted.add(y);
      return [...wanted].filter((y) => catalog.shardsOfYear(y).some((x) => !catalog.emitted.has('issues/' + x.id + '.json'))).sort((a, b) => b - a);
    }

    refresh() {
      keepFocus(this.list, () => this.list.refreshVisible());
    }

    onState(domains) {
      const f = this.v.filters;
      const dependsOnState = ['favorite', 'followed', 'downloaded', 'inList', 'unread', 'isNew', 'sinceVisit'].some((k) => f[k]);
      if (domains.includes('rules') || (dependsOnState && domains.some((d) => ['favorites', 'read', 'series', 'lists'].includes(d)))) {
        this.schedule();
      } else if (domains.includes('prefs')) {
        this.renderQuickRow();
        this.layout();
      } else if (!domains.every((d) => d === 'views')) {
        this.refresh();
      }
    }

    onDisk() {
      if (this.v.filters.downloaded) this.schedule();
      else this.refresh();
    }

    /** חיפוש בכל הקשה, מאוחד ל-frame אחד. [keepScroll]: רענון נתונים, לא חיפוש חדש. */
    schedule(keepScroll) {
      this.wantReset = this.wantReset || !keepScroll;
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => {
        this.pending = false;
        const reset = this.wantReset;
        this.wantReset = false;
        this.run(!reset);
      });
    }

    run(keepScroll) {
      const { app } = this;
      const v = this.v;
      if (!app.index.size) {
        this.result = { idx: [], total: 0, hidden: 0, ms: 0, query: { tokens: [] } };
        this.layout();
        this.updateCount();
        return;
      }
      this.result = app.index.search(v.query, v.filters, app.searchContext(), { sort: v.sort, includeHidden: v.includeHidden });
      app.lastQueryMs = this.result.ms;
      if (!keepScroll) this.list.resetScroll();
      this.persist();
      this.layout();
      this.updateCount();
    }

    /** מספר עמודות וגובה שורה, ואז ציור מחדש של השורות הנראות. */
    layout() {
      const { app } = this;
      const mode = app.state.prefs.view === 'list' ? 'row' : 'card';
      const emPx = this.list.emPx;
      this.perRow = Cards.columnsFor(this.list.root.clientWidth, emPx, mode);
      const count = this.result.idx.length;
      const rows = Math.ceil(count / this.perRow);
      const tokens = (this.result.query && this.result.query.tokens) || [];
      const rowEm = (mode === 'row' ? Cards.ROW_EM.row : Cards.ROW_EM.card) + Cards.ROW_EM.gap;
      const items = this.result.idx;
      const index = app.index;
      const showLang = (this.v.filters.lang || []).length > 0;
      this.list.configure({
        count: rows,
        heightEm: rowEm,
        itemsPerRow: this.perRow,
        render: (r, node) => {
          node.classList.add('is-grid');
          node.style.setProperty('--cols', String(this.perRow));
          for (let c = 0; c < this.perRow; c++) {
            const i = r * this.perRow + c;
            if (i >= count) break;
            const item = index.item(items[i]);
            node.appendChild(
              Cards.render(app, item, {
                mode,
                tokens,
                index: i,
                total: count,
                ctx: { count, at: (k) => index.item(items[k]), index: i },
                showLang,
              }),
            );
          }
        },
      });
    }

    activeFilterCount() {
      return Filters.count(this.v.filters);
    }

    // ---------------------------------------------------------- ספירה

    updateCount() {
      const { app } = this;
      const v = this.v;
      const r = this.result;
      if (!app.index.size) {
        this.countLine.replaceChildren();
        this.renderEmpty();
        return;
      }
      const parts = [el('span', { class: 'results-count' }, t('{n} גיליונות', { n: Core.formatCount(r.total) }))];
      if (r.hidden > 0 && !v.includeHidden) {
        parts.push(el('button', { type: 'button', class: 'link-button', onclick: () => { v.includeHidden = true; this.schedule(); } }, t('{n} מוסתרים לפי הכללים: הצג', { n: Core.formatCount(r.hidden) })));
      }
      if (v.includeHidden) {
        parts.push(el('button', { type: 'button', class: 'link-button', onclick: () => { v.includeHidden = false; this.schedule(); } }, t('הסתר שוב את המוסתרים')));
      }
      // סטטוס טעינה: התוצאות מדויקות לנתונים שנטענו; ממה שחסר אומרים במפורש.
      const loading = this.loadingYears();
      const cold = app.catalog.coldPending();
      const limitedByYear = Boolean((v.filters.hy || []).length || v.filters.hyFrom || v.filters.hyTo || v.filters.dateFrom || v.filters.dateTo);
      if (loading.length) {
        parts.push(el('span', { class: 'loading-note' }, t('טוען שנים נוספות: {years}. התוצאות יתעדכנו.', { years: loading.map((y) => Core.hyLetters(y)).join(', ') })));
      } else if (cold.shards && !limitedByYear && !app.coldLoading) {
        parts.push(el('button', { type: 'button', class: 'link-button', onclick: () => app.loadCold() }, t('כולל את השנים האחרונות בלבד. לטעינת {n} גיליונות ישנים נוספים', { n: Core.formatCount(cold.issues) })));
      }
      if (app.coldLoading) parts.push(el('span', { class: 'loading-note' }, t('טוען שנים ישנות: {done} מתוך {total}', app.coldLoading)));
      if (this.activeFilterCount() || v.query) {
        parts.push(el('button', { type: 'button', class: 'link-button', onclick: () => this.reset() }, t('איפוס')));
      }
      this.countLine.replaceChildren(...parts);
      const active = this.activeFilterCount();
      this.filtersBtn.replaceChildren(icon('filter_24_regular'), active ? t('מסננים ({n})', { n: active }) : t('מסננים'));
      app.announce(t('{n} גיליונות', { n: Core.formatCount(r.total) }));
      this.renderEmpty();
    }

    renderEmpty() {
      const { app } = this;
      this.listHost.querySelector('.state-card, .skeleton-list')?.remove();
      this.list.root.hidden = false;
      if (!app.index.size) {
        this.list.root.hidden = true;
        const status = app.catalog.status;
        const busy = status.phase === 'checking' || status.phase === 'downloading';
        this.listHost.appendChild(busy || (!status.error && !status.lastOkAt) ? Ui.skeleton(7) : new A.WeekScreen(app).emptyCatalog());
        return;
      }
      if (this.result.total === 0) {
        this.list.root.hidden = true;
        const v = this.v;
        const actions = [];
        const loading = this.loadingYears().length > 0;
        if (this.activeFilterCount() || v.query) actions.push(Ui.button('filled', t('איפוס החיפוש והמסננים'), () => this.reset()));
        if (this.activeFilterCount()) actions.push(Ui.button('tonal', t('עריכת המסננים'), () => this.openPanel()));
        if (this.result.hidden && !v.includeHidden) actions.push(Ui.button('tonal', t('הצג גם מוסתרים'), () => { v.includeHidden = true; this.schedule(); }));
        this.listHost.appendChild(
          Ui.stateCard({
            icon: 'search_24_regular',
            title: loading ? t('טוען את הנתונים…') : t('לא נמצאו עלונים'),
            text: [
              loading ? t('השנים שביקשתם עדיין נטענות, והתוצאות יופיעו כשיגיעו.') : t('אפשר לקצר את החיפוש, לבדוק את האיות או להסיר מסנן.'),
              !loading && app.catalog.shards.length > app.catalog.status.shardsLoaded ? t('חלק מהנתונים עדיין נטענים ברקע.') : '',
            ],
            actions,
            compact: true,
          }),
        );
      }
    }

    reset() {
      const v = this.v;
      v.query = '';
      v.filters = {};
      v.includeHidden = false;
      this.input.value = '';
      this.clearBtn.hidden = true;
      this.renderQuickRow();
      this.renderChips();
      this.schedule();
    }

    // ------------------------------------------- שורת כלים ותגיות

    openPanel() {
      A.FilterUi.openPanel(this.app, {
        get: () => ({ query: this.v.query, filters: this.v.filters, sort: this.v.sort, includeHidden: this.v.includeHidden }),
        set: (filters) => this.setFilters(filters),
        applyPreset: (preset) => this.applyPreset(preset),
      });
    }

    renderQuickRow() {
      const { app } = this;
      const v = this.v;
      const toggle = (key, label, iconName) => {
        const on = Boolean(v.filters[key]);
        return Ui.button(on ? 'tonal' : 'outlined', label, () => this.setFilters(Filters.toggle(v.filters, key)), {
          pressed: on,
          icon: on ? 'checkmark_24_regular' : iconName,
          className: 'filter-chip',
        });
      };
      const sortSelect = selectField(
        t('מיון'),
        Object.keys(SORT_LABELS).map((k) => ({ value: k, label: t(SORT_LABELS[k]) })),
        v.sort,
        (value) => {
          v.sort = value;
          app.state.setPref('sort', value);
          this.schedule();
        },
        'select-sort',
      );
      const viewToggle = el(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': t('תצוגה') },
        Ui.iconButton('grid_24_regular', t('תצוגת כרטיסים'), () => app.state.setPref('view', 'cards'), { pressed: app.state.prefs.view !== 'list', className: 'segment' }),
        Ui.iconButton('text_bullet_list_24_regular', t('תצוגת רשימה צפופה'), () => app.state.setPref('view', 'list'), { pressed: app.state.prefs.view === 'list', className: 'segment' }),
      );
      Ui.fill(
        this.filterRow,
        ...QUICK_FLAGS.map(([key, label, iconName]) => toggle(key, t(label), iconName)),
        A.Selection.modeButton(app),
        el('span', { class: 'filter-spacer' }),
        sortSelect,
        viewToggle,
      );
    }

    renderChips() {
      Ui.fill(this.chipsHost, A.FilterUi.chipsRow(this.app, this.v.filters, (next) => this.setFilters(next)));
    }

    // --------------------------------------------------- בונה שאילתות

    renderBuilder() {
      const v = this.v;
      this.builderBtn.setAttribute('aria-expanded', String(v.builder));
      this.builderBtn.setAttribute('aria-pressed', String(v.builder));
      if (!v.builder) {
        this.builderHost.replaceChildren();
        return;
      }
      const field = (label, name, placeholder) => el('label', { class: 'builder-field' }, el('span', {}, label), el('input', { class: 'input', name, placeholder, dir: 'auto', autocomplete: 'off' }));
      const form = el(
        'form',
        {
          class: 'builder',
          onsubmit: (event) => {
            event.preventDefault();
            const data = new FormData(form);
            const parts = [];
            const quote = (s) => (/\s/.test(s) ? '"' + s + '"' : s);
            for (const key of ['series', 'year', 'parasha', 'event', 'lang', 'source']) {
              const value = String(data.get(key) || '').trim();
              if (value) parts.push(key + ':' + quote(value));
            }
            const without = String(data.get('without') || '').trim();
            for (const word of without.split(/\s+/).filter(Boolean)) parts.push('-' + word);
            if (!parts.length) return;
            this.setQuery((v.query ? v.query + ' ' : '') + parts.join(' '));
            this.input.focus();
          },
        },
        el('p', { class: 'builder-help' }, t('מלאו שדות, והחיפוש יורכב לבד. אפשר גם להקליד ישירות: series:שם year:תשפ״ז או year:תשפ״ה-תשפ״ז parasha:נח event:חנוכה lang:en source:לדעת, ביטוי במרכאות, מינוס להחרגה ו-OR בין חלופות. ללא שם שדה: חיפוש בכל הפרטים.')),
        el(
          'div',
          { class: 'builder-grid' },
          field(t('שם סדרה'), 'series', t('אסיפה')),
          field(t('שנה'), 'year', t('תשפ״ז או 5787')),
          field(t('פרשה'), 'parasha', t('נח')),
          field(t('שבת מיוחדת או חג'), 'event', t('חנוכה')),
          field(t('שפה'), 'lang', t('אידיש')),
          field(t('מקור'), 'source', t('לדעת')),
          field(t('בלי המילים'), 'without', t('מילים להחרגה')),
        ),
        el('div', { class: 'builder-actions' }, Ui.button('filled', t('הוסף לחיפוש'), () => form.requestSubmit(), { className: 'button-small' }), Ui.button('text', t('סגירה'), () => { v.builder = false; this.renderBuilder(); }, { className: 'button-small' })),
      );
      this.builderHost.replaceChildren(form);
    }
  }

  A.AllScreen = AllScreen;
  if (typeof module === 'object' && module.exports) module.exports = { AllScreen };
})(typeof self !== 'undefined' ? self : globalThis);
