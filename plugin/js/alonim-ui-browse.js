// "סדרות" (רשימה ודף סדרה) ועזרים משותפים לרשימות הגלישה. הרשימות וירטואליות:
// לעולם לא יותר מ-60 כרטיסים ב-DOM.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Cards = A.Cards;
  const Core = A.Core;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);
  const N = (text) => text;

  const SORT_LABELS = Object.freeze({
    relevance: N('רלוונטיות'),
    new: N('חדש ביותר'),
    date: N('תאריך השבת'),
    alpha: N('א-ב'),
    size: N('גודל'),
  });

  const selectField = Ui.selectField;

  /** משמר את המיקוד ברשימה וירטואלית שמצוירת מחדש. */
  function keepFocus(list, fn) {
    const active = document.activeElement;
    const node = active && active.closest ? active.closest('[data-item]') : null;
    const inside = node && list.root.contains(node);
    const index = inside ? node.dataset.item : null;
    const subKey = inside && active !== node ? active.getAttribute('aria-label') : null;
    fn();
    if (index === null) return;
    const again = list.inner.querySelector('[data-item="' + index + '"]');
    if (!again) return;
    let target = again;
    if (subKey) {
      for (const b of again.querySelectorAll('button')) if (b.getAttribute('aria-label') === subKey) target = b;
    }
    target.focus({ preventScroll: true });
  }

  // ======================================================== סדרות

  class SeriesScreen {
    constructor(app) {
      this.app = app;
      this.fill = true;
      this.unsub = [];
    }

    mount(host) {
      this.host = host;
      if (this.app.route.series) this.mountPage(this.app.route.series);
      else this.mountList();
    }

    destroy() {
      for (const off of this.unsub) off();
      this.unsub = [];
      if (this.list) this.list.destroy();
    }

    // ------------------------------------------------------- רשימה

    mountList() {
      const { app } = this;
      const v = app.view.seriesList;
      const input = el('input', { class: 'search-input', type: 'search', value: v.query, placeholder: t('חיפוש סדרה'), 'aria-label': t('חיפוש סדרה'), dir: 'auto', autocomplete: 'off', spellcheck: 'false' });
      input.addEventListener('input', () => {
        v.query = input.value;
        this.runList();
      });
      const modes = [['all', t('כל הסדרות')], ['follow', t('עוקבים')], ['fav', t('מועדפות')], ['mute', t('מושתקות')]];
      const modeButtons = el('div', { class: 'segmented is-text', role: 'group', 'aria-label': t('הצג') }, modes.map(([id, label]) => el('button', { type: 'button', class: 'segment-text', 'aria-pressed': String(v.mode === id), onclick: () => { v.mode = id; modeButtons.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(modes[k][0] === id))); this.runList(); } }, label)));
      const facets = () => {
        const circles = new Set();
        const langs = new Set();
        for (const s of app.index.seriesById.values()) {
          if (s.circle) circles.add(s.circle);
          if (s.lang) langs.add(s.lang);
        }
        return { circles: [...circles].sort(), langs: Core.LANG_CODES.filter((l) => langs.has(l)) };
      };
      const f = facets();
      const filters = el(
        'div',
        { class: 'filter-row is-open is-always' },
        selectField(t('חוג'), [{ value: '', label: t('כל החוגים') }, ...f.circles.map((c) => ({ value: c, label: c }))], v.circle, (x) => { v.circle = x; this.runList(); }),
        selectField(t('שפה'), [{ value: '', label: t('כל השפות') }, ...f.langs.map((l) => ({ value: l, label: Core.langName(l) }))], v.lang, (x) => { v.lang = x; this.runList(); }),
        modeButtons,
      );
      this.countLine = el('div', { class: 'results-line', 'aria-live': 'polite' });
      this.listHost = el('div', { class: 'list-host' });
      this.list = new Ui.VList({ className: 'series-list', label: t('רשימת הסדרות') });
      this.list.onResize = () => this.runList();
      this.listHost.appendChild(this.list.root);
      this.recentHost = el('div', { class: 'recent-series' });
      this.host.replaceChildren(el('div', { class: 'page fill-page' }, el('div', { class: 'toolbar' }, el('div', { class: 'search-bar' }, icon('search_24_regular'), input), filters, this.recentHost, this.countLine), this.listHost));
      this.listInput = input;
      this.runList();
      this.unsub.push(
        app.on('data', () => this.runList()),
        app.on('state', () => this.runList(true)),
        app.on('focus-search', () => input.focus()),
      );
      this.list.root.addEventListener('keydown', (event) => {
        const target = event.target.closest('[data-item]');
        if (!target || event.target !== target) return;
        const count = this.rows.length;
        const current = Number(target.dataset.item);
        const next = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: count - 1, PageDown: current + 8, PageUp: current - 8 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        Cards.focusItem(this.list, Math.max(0, Math.min(count - 1, next)), 1);
      });
      if (v.scroll) this.list.root.scrollTop = v.scroll;
      this.list.root.addEventListener('scroll', () => { v.scroll = this.list.root.scrollTop; }, { passive: true });
    }

    /** "נצפו לאחרונה": סדרות שנפתחו לאחרונה, לגישה מהירה (כשלא מחפשים). */
    renderRecent() {
      const { app } = this;
      const v = app.view.seriesList;
      const recent = v.query ? [] : app.state.recentSeries().map((r) => app.index.seriesById.get(app.index.resolveSeriesId(r.id))).filter(Boolean).slice(0, 6);
      Ui.fill(
        this.recentHost,
        recent.length
          ? [el('span', { class: 'recent-label' }, t('נצפו לאחרונה')), ...recent.map((s) => el('button', { type: 'button', class: 'filter-tag', onclick: () => app.openSeries(s.id) }, el('span', { class: 'filter-tag-text', dir: 'auto' }, s.title)))]
          : null,
      );
    }

    runList(keep) {
      const { app } = this;
      const v = app.view.seriesList;
      const st = app.state;
      this.rows = app.index.searchSeries(v.query, { circle: v.circle, lang: v.lang }, (s) => {
        const sid = s.id;
        if (v.mode === 'follow') return st.seriesState(sid).follow;
        if (v.mode === 'fav') return st.seriesState(sid).fav;
        if (v.mode === 'mute') return st.isMuted(sid);
        return true;
      });
      app.state.setViewState('seriesList', { query: v.query, circle: v.circle, lang: v.lang, mode: v.mode });
      this.renderRecent();
      this.listHost.querySelector('.state-card, .skeleton-list')?.remove();
      this.list.root.hidden = this.rows.length === 0;
      this.countLine.replaceChildren(el('span', { class: 'results-count' }, t('{n} סדרות', { n: Core.formatCount(this.rows.length) })));
      if (!this.rows.length) {
        const status = app.catalog.status;
        const busy = !app.index.seriesById.size && (status.phase === 'checking' || status.phase === 'downloading');
        this.listHost.appendChild(busy ? Ui.skeleton(7, 'row') : app.index.seriesById.size ? Ui.stateCard({ icon: 'search_24_regular', title: t('לא נמצאו סדרות'), text: v.mode === 'all' ? t('אפשר לקצר את החיפוש או להסיר מסנן.') : t('עוד לא סימנתם סדרות כאן. פתחו סדרה כדי לעקוב אחריה, להשתיק או לסמן כמועדפת.'), compact: true, actions: [Ui.button('tonal', t('כל הסדרות'), () => { v.mode = 'all'; v.query = ''; this.host.replaceChildren(); this.mountList(); })] }) : new A.WeekScreen(app).emptyCatalog());
        this.list.configure({ count: 0, heightEm: 4, render() {} });
        return;
      }
      const render = (r, node) => {
        node.classList.add('is-grid');
        node.style.setProperty('--cols', '1');
        node.appendChild(this.seriesRow(this.rows[r], r));
      };
      if (keep) keepFocus(this.list, () => { this.list.render = render; this.list.count = this.rows.length; this.list.refreshVisible(); });
      else this.list.configure({ count: this.rows.length, heightEm: 4.6 + Cards.ROW_EM.gap * 0.4, render, itemsPerRow: 1 });
    }

    seriesRow(s, r) {
      const { app } = this;
      const st = app.state.seriesState(s.id);
      const years = [s.first, s.last].filter(Boolean).map((d) => String(d).slice(0, 4));
      const range = years.length === 2 && years[0] !== years[1] ? years[0] + '–' + years[1] : years[0] || '';
      const meta = [t('{n} גיליונות', { n: Core.formatCount(s.issueCount || (app.index.bySeries.get(s.id) || []).length) }), s.circle, range].filter(Boolean).join(' · ');
      return el(
        'article',
        {
          class: 'series-row' + (st.mute ? ' is-muted' : ''),
          role: 'listitem',
          tabindex: r === 0 ? '0' : '-1',
          dataset: { item: String(r), id: s.id },
          'aria-label': s.title + ', ' + meta,
          onclick: (e) => { if (!e.target.closest('button')) app.openSeries(s.id); },
          onkeydown: (e) => { if (e.target === e.currentTarget && e.key === 'Enter') app.openSeries(s.id); },
        },
        Ui.iconButton(st.fav ? 'star_24_filled' : 'star_24_regular', st.fav ? t('הסר מהמועדפות') : t('סמן סדרה כמועדפת'), () => app.state.setSeries(s.id, { fav: !st.fav }), { pressed: st.fav, className: 'star-button' }),
        el('div', { class: 'row-main' }, el('div', { class: 'series-name-line' }, el('h3', { class: 'card-title', dir: 'auto' }, s.title), s.lang && s.lang !== 'he' ? Ui.chip(Core.langName(s.lang), { kind: 'lang' }) : null), el('p', { class: 'card-meta', dir: 'auto' }, meta)),
        st.follow ? Ui.chip(t('עוקב'), { kind: 'new', icon: 'alert_24_filled' }) : st.mute ? Ui.chip(t('מושתקת'), { kind: 'hidden', icon: 'alert_off_24_regular' }) : null,
        Ui.iconButton(st.follow ? 'alert_24_filled' : 'alert_24_regular', st.follow ? t('הפסק לעקוב') : t('עקוב אחרי הסדרה'), () => app.toggleFollow(s.id), { pressed: st.follow }),
        icon(document.documentElement.dir === 'ltr' ? 'chevron_right_24_regular' : 'chevron_left_24_regular', 'row-chevron'),
      );
    }

    // ------------------------------------------------------- דף סדרה

    mountPage(seriesId) {
      const { app } = this;
      const series = app.index.seriesById.get(seriesId);
      const v = app.view.seriesPage;
      this.seriesId = seriesId;
      app.state.viewSeries(seriesId);
      const render = () => this.renderPage();
      this.pageQuery = el('input', { class: 'search-input', type: 'search', value: v.query, placeholder: t('חיפוש בתוך הסדרה'), 'aria-label': t('חיפוש בתוך הסדרה'), dir: 'auto', autocomplete: 'off' });
      this.pageQuery.addEventListener('input', () => {
        v.query = this.pageQuery.value;
        this.layoutPage();
      });
      this.head = el('div', { class: 'series-head' });
      this.listHost = el('div', { class: 'list-host' });
      this.list = new Ui.VList({ className: 'series-issues', label: t('גיליונות הסדרה') });
      this.list.onResize = () => this.layoutPage();
      this.listHost.appendChild(this.list.root);
      this.host.replaceChildren(el('div', { class: 'page fill-page' }, el('div', { class: 'toolbar' }, this.head, el('div', { class: 'search-bar' }, icon('search_24_regular'), this.pageQuery)), this.listHost));
      render();
      Cards.attachListKeys(this.list, () => ({ count: this.pageItems.length, perRow: 1 }));
      this.unsub.push(
        app.on('data', () => render()),
        app.on('state', () => { this.head && this.renderHead(); this.refreshRows(); }),
        app.on('files', () => this.refreshRows()),
        app.on('disk', () => this.refreshRows()),
        app.on('focus-search', () => this.pageQuery.focus()),
        app.on('escape', () => { if (v.query) { v.query = ''; this.pageQuery.value = ''; this.layoutPage(); } else app.go('series'); }),
      );
      // טעינת שנים שעוד לא נטענו (השרדים בדרך כלל כבר ברקע).
      if (series && series.first && series.last) {
        const from = Number(String(series.first).slice(0, 4)) + 3760;
        const to = Number(String(series.last).slice(0, 4)) + 3761;
        for (let hy = to; hy >= from && hy > to - 12; hy--) app.catalog.ensureYear(hy);
      }
    }

    renderPage() {
      this.renderHead();
      this.layoutPage();
    }

    refreshRows() {
      if (this.list) keepFocus(this.list, () => this.list.refreshVisible());
    }

    renderHead() {
      const { app } = this;
      const id = this.seriesId;
      const series = app.index.seriesById.get(id);
      const st = app.state.seriesState(id);
      const title = series ? series.title : app.index.seriesTitleOf(id) || t('סדרה');
      const sources = new Map();
      for (const i of app.index.bySeries.get(id) || []) for (const a of app.index.item(i).assets) sources.set(a.src, (sources.get(a.src) || 0) + 1);
      const srcOptions = [{ value: '', label: t('אוטומטי') }, ...[...sources.keys()].map((s) => ({ value: s, label: app.sourceInfo(s).name }))];
      const meta = [series && series.lang ? Core.langName(series.lang) : '', series && series.circle, series && series.kind === 'timeless' ? t('חומר ללא שנה') : ''].filter(Boolean).join(' · ');
      const hidden = app.state.rules.rules.find((r) => r.field === 'series' && r.action === 'hide' && r.value === id);
      Ui.fill(this.head, 
        el(
          'div',
          { class: 'series-title-row' },
          Ui.iconButton(document.documentElement.dir === 'ltr' ? 'arrow_left_24_regular' : 'arrow_right_24_regular', t('חזרה לרשימת הסדרות'), () => app.go('series'), { className: 'back-button' }),
          el('div', { class: 'series-title-text' }, el('h2', { class: 'series-title', dir: 'auto' }, title), el('p', { class: 'card-meta', dir: 'auto' }, [meta, t('{n} גיליונות', { n: Core.formatCount(this.pageItemsCount()) })].filter(Boolean).join(' · '))),
        ),
        el(
          'div',
          { class: 'series-actions' },
          Ui.button(st.follow ? 'tonal' : 'outlined', st.follow ? t('עוקב') : t('עקוב'), () => app.toggleFollow(id), { icon: st.follow ? 'alert_24_filled' : 'alert_24_regular', pressed: st.follow, className: 'button-small' }),
          Ui.button(st.mute ? 'tonal' : 'outlined', st.mute ? t('מושתקת') : t('השתק'), () => app.state.setSeries(id, { mute: !st.mute }), { icon: 'alert_off_24_regular', pressed: st.mute, className: 'button-small' }),
          Ui.button(st.fav ? 'tonal' : 'outlined', t('מועדפת'), () => app.state.setSeries(id, { fav: !st.fav }), { icon: st.fav ? 'star_24_filled' : 'star_24_regular', pressed: st.fav, className: 'button-small' }),
          sources.size > 1
            ? el('label', { class: 'inline-field' }, el('span', {}, t('מקור מועדף')), selectField(t('מקור מועדף'), srcOptions, st.src || '', (value) => app.state.setSeries(id, { src: value })))
            : null,
          hidden
            ? Ui.button('tonal', t('בטל הסתרה'), () => app.state.removeRule(hidden.id), { icon: 'eye_24_regular', className: 'button-small' })
            : Ui.button('text', t('הסתר סדרה'), () => { app.state.addRule({ action: 'hide', field: 'series', value: id, label: title }); app.toast(t('הסדרה "{name}" הוסתרה', { name: title }), { action: { label: t('ביטול הפעולה'), run: () => { const r = app.state.rules.rules.find((x) => x.field === 'series' && x.value === id); if (r) app.state.removeRule(r.id); } } }); }, { icon: 'eye_off_24_regular', className: 'button-small' }),
        ),
      );
    }

    pageItemsCount() {
      return (this.app.index.bySeries.get(this.seriesId) || []).length;
    }

    /** שורות הדף: כותרת לכל שנה עברית ואחריה גיליונותיה. */
    layoutPage() {
      const { app } = this;
      const q = A.Index.parseQuery(app.view.seriesPage.query);
      const all = app.index.issuesOfSeries(this.seriesId, true);
      const matched = all.filter((i) => {
        if (!q.clauses.length) return true;
        return q.clauses.every((cl) => cl.alts.some((term) => (term.neg ? !app.index._termHit(i, term) : app.index._termHit(i, term))));
      });
      this.pageItems = matched.map((i) => app.index.item(i));
      this.rowsDesc = [];
      let lastYear = null;
      this.pageItems.forEach((item, k) => {
        const year = item.hy || 0;
        if (year !== lastYear) {
          lastYear = year;
          this.rowsDesc.push({ header: year ? t('שנת {y}', { y: Core.hyLetters(year) }) : t('ללא שנה'), count: 0, year });
        }
        this.rowsDesc[this.rowsDesc.length - 1].count++;
        this.rowsDesc.push({ item, k });
      });
      this.listHost.querySelector('.state-card, .skeleton-list')?.remove();
      const loading = app.catalog.shards.length > app.catalog.status.shardsLoaded && !this.pageItems.length;
      this.list.root.hidden = !this.rowsDesc.length;
      if (!this.rowsDesc.length) {
        this.listHost.appendChild(loading ? Ui.skeleton(4, 'row') : Ui.stateCard({ icon: 'news_24_regular', title: q.clauses.length ? t('לא נמצאו גיליונות') : t('אין גיליונות בסדרה'), text: q.clauses.length ? t('אפשר לקצר את החיפוש.') : t('ייתכן שהגיליונות של הסדרה עוד נטענים, או שהוסתרו.'), compact: true }));
        this.list.configure({ count: 0, heightEm: 4, render() {} });
        return;
      }
      const mode = 'row';
      const ctxCount = this.pageItems.length;
      this.list.configure({
        count: this.rowsDesc.length,
        heightEm: (r) => (this.rowsDesc[r].header ? 2.8 : Cards.ROW_EM.row + Cards.ROW_EM.gap),
        itemsPerRow: 1,
        render: (r, node) => {
          const d = this.rowsDesc[r];
          if (d.header) {
            node.appendChild(el('h3', { class: 'year-header', dir: 'auto' }, d.header, el('span', { class: 'section-count' }, Core.formatCount(d.count))));
            return;
          }
          node.classList.add('is-grid');
          node.style.setProperty('--cols', '1');
          node.appendChild(Cards.render(app, d.item, { mode, tokens: q.tokens, index: d.k, total: ctxCount, ctx: { count: ctxCount, at: (k) => this.pageItems[k], index: d.k }, showLang: false, inSeries: true }));
        },
      });
      this.renderHead();
    }
  }

  A.SeriesScreen = SeriesScreen;
  A.BrowseHelpers = { selectField, keepFocus, SORT_LABELS };
  if (typeof module === 'object' && module.exports) module.exports = { SeriesScreen };
})(typeof self !== 'undefined' ? self : globalThis);
