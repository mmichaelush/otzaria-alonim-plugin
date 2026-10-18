// דף נושא ("בראשית בכל השנים", "פורים בכל השנים"): כל הגיליונות של פרשה או מועד מכל השנים,
// מקובצים לסדרות (או לשנים), מהחדש לישן. כותרת: שם, חומש, כמה גיליונות, סדרות ושנים, ומתי
// הנושא נקרא השנה. סרגל: חיפוש, שפה, מקור, שנה, קיבוץ, ובפרשה שנקראת לפעמים בשבת משולבת — סוג
// השבת. הרשימה וירטואלית אחת (כותרות קבוצה ושורות גיליון), עם אותם כרטיסים, בחירה מרובה,
// הדפסה והורדה כמו ב"כל העלונים". המודל: `alonim-cycle.js`.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Cards = A.Cards;
  const Core = A.Core;
  const Cycle = A.Cycle;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const { selectField, keepFocus } = A.BrowseHelpers;
  const t = (text, vars) => I18n.t(text, vars);

  /** גובה כותרת קבוצה (ב-em): שורת שם ושורת קרדיט. */
  const HEADER_EM = 3.6;

  class TopicScreen {
    constructor(app) {
      this.app = app;
      this.fill = true;
      this.unsub = [];
      this.topic = Cycle.topic(app.view.route.topic);
      /** כל גיליוני הנושא, ואלה שעברו את הסרגל (אינדקסים), לפי סדר ההצגה. */
      this.base = [];
      this.shown = [];
      this.flat = [];
      this.perRow = 1;
      this.pending = false;
    }

    get v() {
      return this.app.view.topicPage;
    }

    title() {
      return Cycle.topicName(this.topic);
    }

    mount(host) {
      const { app } = this;
      const v = this.v;
      this.host = host;
      if (this.topic.kind === 'event') v.mode = 'all';
      this.input = el('input', {
        class: 'search-input',
        type: 'search',
        value: v.query,
        placeholder: t('חיפוש בתוך {name}', { name: this.title() }),
        'aria-label': t('חיפוש בתוך {name}', { name: this.title() }),
        autocomplete: 'off',
        spellcheck: 'false',
        dir: 'auto',
      });
      this.input.addEventListener('input', () => {
        v.query = this.input.value;
        this.schedule();
      });
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          Cards.focusItem(this.list, 0, this.perRow);
        } else if (event.key === 'Escape' && v.query) {
          event.preventDefault();
          event.stopPropagation();
          this.setQuery('');
        }
      });
      this.head = el('div', { class: 'topic-head' });
      this.filterRow = el('div', { class: 'filter-row is-always topic-filters' });
      this.countLine = el('div', { class: 'results-line', 'aria-live': 'polite' });
      this.listHost = el('div', { class: 'list-host' });
      this.list = new Ui.VList({ className: 'topic-list', label: t('גיליונות הנושא') });
      this.list.onResize = () => this.layout();
      // כותרת הקבוצה הנוכחית צמודה לראש הרשימה בזמן שגוללים בתוך הקבוצה (לקורא מסך: מוסתרת, הכותרת
      // האמיתית נמצאת ברשימה)
      this.sticky = el('div', { class: 'topic-sticky', 'aria-hidden': 'true', hidden: true });
      this.listHost.append(this.sticky, this.list.root);
      this.list.root.addEventListener('scroll', () => this.updateSticky(), { passive: true });
      Cards.attachListKeys(this.list, () => ({ count: this.shown.length, perRow: this.perRow }));
      this.selectionBar = new A.Selection.SelectionBar(app, {
        count: () => this.shown.length,
        all: () => this.shown.map((i) => app.index.item(i)),
      });
      host.replaceChildren(
        el(
          'div',
          { class: 'page fill-page topic-page' },
          el(
            'div',
            { class: 'toolbar' },
            this.head,
            el('div', { class: 'search-bar' }, icon('search_24_regular'), this.input),
            this.filterRow,
            this.countLine,
          ),
          this.listHost,
          this.selectionBar.el,
        ),
      );
      this.run();
      this.unsub.push(
        app.on('data', () => this.schedule(true)),
        app.on('state', (domains) => this.onState(domains)),
        app.on('files', () => this.refresh()),
        app.on('disk', () => this.refresh()),
        app.on('selection', () => {
          this.renderControls();
          this.refresh();
        }),
        app.on('prefs', () => {
          this.list.measure();
          this.layout();
        }),
        app.on('focus-search', () => {
          this.input.focus();
          this.input.select();
        }),
        app.on('escape', () => this.onEscape()),
      );
      app.announce(this.title());
    }

    destroy() {
      this.destroyed = true;
      for (const off of this.unsub) off();
      this.selectionBar.destroy();
      this.list.destroy();
    }

    onEscape() {
      const { app } = this;
      const v = this.v;
      if (app.selection.on) app.setSelecting(false);
      else if (v.query) this.setQuery('');
      else this.back();
    }

    back() {
      const { app } = this;
      if (app.route.from === 'week') app.go('week');
      else app.go('cycle');
    }

    setQuery(text) {
      this.v.query = text;
      this.input.value = text;
      this.schedule();
    }

    onState(domains) {
      // כלל חדש או שינוי במעקב משנים את הקבוצות והסדר; שאר המצב (קריאה, מועדפים) רק את הכרטיסים.
      if (domains.includes('rules') || domains.includes('series')) this.schedule(true);
      else if (domains.includes('prefs')) {
        this.list.measure();
        this.layout();
      } else if (!domains.every((d) => d === 'views')) this.refresh();
    }

    refresh() {
      keepFocus(this.list, () => this.list.refreshVisible());
    }

    /** חישוב מאוחד ל-frame אחד. [keepScroll]: רענון נתונים, לא שינוי תצוגה. */
    schedule(keepScroll) {
      this.wantReset = this.wantReset || !keepScroll;
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => {
        this.pending = false;
        if (this.destroyed) return;
        const reset = this.wantReset;
        this.wantReset = false;
        this.run(!reset);
      });
    }

    // ------------------------------------------------------------- חישוב

    run(keepScroll) {
      const { app } = this;
      const index = app.index;
      this.base = index.size ? Cycle.issuesOf(index, this.topic, {}) : [];
      this.summary = Cycle.summarize(index, this.base, this.topic);
      this.facets = Cycle.facetsOf(index, this.base);
      const v = this.v;
      // ערך שנבחר ואינו קיים יותר (שפה שהוסתרה, שנה שהוסרה): מתאפס, ולא "אין תוצאות" מסתורי
      if (v.lang && !this.facets.langs.has(v.lang)) v.lang = '';
      if (v.source && !this.facets.sources.has(v.source)) v.source = '';
      if (v.hy && !this.facets.years.has(Number(v.hy))) v.hy = 0;
      if (v.mode !== 'all' && !this.summary.combined) v.mode = 'all';
      this.shown = Cycle.select(index, this.base, v);
      if (!keepScroll) this.list.resetScroll();
      this.syncSelection();
      this.renderHead();
      this.renderControls();
      this.layout();
      this.updateCount();
    }

    syncSelection() {
      const { app } = this;
      if (app.selection.ids.size) {
        const inResult = new Set(this.shown);
        app.pruneSelection((item) => inResult.has(item._i));
      }
      this.selectionBar.update();
    }

    // ------------------------------------------------------------- כותרת

    renderHead() {
      const { app } = this;
      const tp = this.topic;
      const sum = this.summary;
      const name = this.title();
      const back = app.route.from === 'week';
      const subtitle = [];
      if (tp.kind === 'parasha') {
        subtitle.push(
          t('פרשה {n} מתוך {total}', {
            n: Cycle.PARASHA_ORDER.indexOf(tp.slug) + 1,
            total: Cycle.PARASHA_ORDER.length,
          }),
          t(Cycle.chumashOf(tp.slug).name),
        );
      } else {
        subtitle.push(t(Cycle.KIND_LABELS[Cycle.EVENT_KIND[tp.slug]] || 'מועד'));
      }
      const years =
        sum.hyMin && sum.hyMax && sum.hyMin !== sum.hyMax
          ? t('שנים {from}–{to}', {
              from: Core.hyLetters(sum.hyMin),
              to: Core.hyLetters(sum.hyMax),
            })
          : sum.hyMin
            ? t('שנת {y}', { y: Core.hyLetters(sum.hyMin) })
            : '';
      const chips = [
        Ui.chip(t('{n} גיליונות', { n: Core.formatCount(sum.count) }), { kind: 'source' }),
        sum.seriesCount
          ? Ui.chip(t('{n} סדרות', { n: Core.formatCount(sum.seriesCount) }), { kind: 'source' })
          : null,
        years ? Ui.chip(years, { kind: 'source' }) : null,
        tp.kind === 'parasha' && Cycle.ALIAS_BY_PARASHA[tp.slug]
          ? Ui.chip(
              t('כולל את {name}', { name: Core.eventName(Cycle.ALIAS_BY_PARASHA[tp.slug]) }),
              {
                kind: 'reason',
                icon: 'calendar_star_24_regular',
              },
            )
          : null,
      ];
      const related = (Cycle.RELATED[tp.key] || [])
        .map((key) => Cycle.topic(key))
        .filter(Boolean)
        .map((rel) => {
          const n = (
            app.index.size ? app.index.topicCounts() : { parasha: new Map(), event: new Map() }
          )[rel.kind].get(rel.slug);
          return el(
            'button',
            {
              type: 'button',
              class: 'filter-tag',
              onclick: () => app.openTopic(rel.key, { from: app.route.from }),
            },
            el(
              'span',
              { class: 'filter-tag-text', dir: 'auto' },
              [t('ראו גם: {name}', { name: Cycle.topicName(rel) }), n ? Core.formatCount(n) : '']
                .filter(Boolean)
                .join(' · '),
            ),
          );
        });
      Ui.fill(
        this.head,
        el(
          'div',
          { class: 'series-title-row' },
          Ui.iconButton(
            document.documentElement.dir === 'ltr'
              ? 'arrow_left_24_regular'
              : 'arrow_right_24_regular',
            back ? t('חזרה לשבוע') : t('חזרה למעגל השנה'),
            () => this.back(),
            { className: 'back-button', key: 'back' },
          ),
          el(
            'div',
            { class: 'series-title-text' },
            el(
              'h2',
              { class: 'series-title topic-title', dir: 'auto' },
              t('{name} בכל השנים', { name }),
            ),
            el('p', { class: 'card-meta', dir: 'auto' }, subtitle.join(' · ')),
          ),
        ),
        el('div', { class: 'topic-facts' }, chips, related),
        this.occurrence(),
        this.combinedNote(),
      );
    }

    /** "הקרוב: שבת, כ״ד בתשרי…": מתי הנושא נקרא, עם מעבר לשבוע. */
    occurrence() {
      const { app } = this;
      const found = Cycle.nextOccurrence(app.weekViews(), this.topic, Core.ymd(app.today()));
      if (!found) return null;
      const { view, upcoming } = found;
      const day = Cycle.displayDay(this.topic.key, view);
      const text = Core.dateLine(day, {
        weekday: true,
        hebrewText: day === view.day ? view.hebrew : undefined,
      });
      const current = app.currentWeekView();
      const now = Boolean(current && current.date === view.date);
      return el(
        'p',
        { class: 'topic-when', dir: 'auto' },
        icon('calendar_star_24_regular'),
        el(
          'span',
          { class: 'topic-when-text' },
          upcoming ? t('הקרוב: {date}', { date: text }) : t('בפעם האחרונה: {date}', { date: text }),
        ),
        now ? Ui.chip(t('השבוע'), { kind: 'now' }) : null,
        Ui.button(
          'text',
          t('פתיחה בשבוע'),
          () => {
            app.view.weekDate = view.date;
            app.go('week');
          },
          { className: 'button-small', key: 'to-week' },
        ),
      );
    }

    /** שבת משולבת: כמה מהגיליונות משולבים, ושהם מופיעים פעם אחת בדף של כל אחת מהפרשות. */
    combinedText() {
      const sum = this.summary;
      if (this.topic.kind !== 'parasha' || !sum.combined) return '';
      const partners = [...sum.partners.keys()].map((slug) => Core.parashaName(slug)).join(', ');
      return t(
        '{n} מהגיליונות הם של שבת משולבת עם {partner}. גיליון כזה מופיע בדף של כל אחת משתי הפרשות, פעם אחת בכל דף.',
        { n: Core.formatCount(sum.combined), partner: partners },
      );
    }

    combinedNote() {
      const text = this.combinedText();
      return text ? el('p', { class: 'topic-note', dir: 'auto' }, text) : null;
    }

    // ------------------------------------------------------------- סרגל

    renderControls() {
      const { app } = this;
      const v = this.v;
      const sum = this.summary;
      const facets = this.facets;
      const apply = (key, value) => {
        v[key] = value;
        this.schedule();
      };
      const opts = (first, entries) => [{ value: '', label: first }, ...entries];
      const langs = Core.LANG_CODES.filter((l) => facets.langs.has(l)).map((l) => ({
        value: l,
        label: Core.langName(l) + ' (' + Core.formatCount(facets.langs.get(l)) + ')',
      }));
      const sources = [...facets.sources.keys()].sort().map((id) => ({
        value: id,
        label: app.sourceInfo(id).name + ' (' + Core.formatCount(facets.sources.get(id)) + ')',
      }));
      const years = [...facets.years.keys()]
        .sort((a, b) => b - a)
        .map((y) => ({
          value: String(y),
          label: Core.hyLetters(y) + ' (' + Core.formatCount(facets.years.get(y)) + ')',
        }));
      const modes =
        this.topic.kind === 'parasha' && sum.combined
          ? el(
              'div',
              {
                class: 'segmented is-text topic-modes',
                role: 'group',
                'aria-label': t('סוג השבת'),
                title: this.combinedText(),
              },
              [
                ['all', t('הכול')],
                ['combined', t('שבת משולבת ({n})', { n: Core.formatCount(sum.combined) })],
                ['alone', t('הפרשה לבדה ({n})', { n: Core.formatCount(sum.count - sum.combined) })],
              ].map(([id, label]) =>
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'segment-text',
                    'aria-pressed': String(v.mode === id),
                    dataset: { mode: id },
                    onclick: () => apply('mode', id),
                  },
                  label,
                ),
              ),
            )
          : null;
      const group = selectField(
        t('קיבוץ'),
        [
          { value: 'series', label: t('לפי סדרה') },
          { value: 'year', label: t('לפי שנה') },
        ],
        v.group,
        (value) => {
          v.group = value;
          app.state.setViewState('cycle', { group: value });
          this.schedule();
        },
        'select-group',
      );
      Ui.fill(
        this.filterRow,
        el(
          'div',
          { class: 'filter-flags' },
          selectField(
            t('שפה'),
            opts(t('כל השפות'), langs),
            v.lang,
            (value) => apply('lang', value),
            'select-group',
          ),
          selectField(
            t('מקור'),
            opts(t('כל המקורות'), sources),
            v.source,
            (value) => apply('source', value),
            'select-group',
          ),
          selectField(
            t('שנה'),
            [{ value: '0', label: t('כל השנים') }, ...years],
            String(v.hy || 0),
            (value) => apply('hy', Number(value)),
            'select-group',
          ),
        ),
        modes,
        el('div', { class: 'filter-view' }, group, A.Selection.modeButton(app)),
      );
    }

    updateCount() {
      const { app } = this;
      const v = this.v;
      const total = this.base.length;
      const parts = [
        el(
          'span',
          { class: 'results-count' },
          t('{n} גיליונות', { n: Core.formatCount(this.shown.length) }),
        ),
      ];
      if (this.shown.length !== total)
        parts.push(el('span', {}, t('מתוך {n}', { n: Core.formatCount(total) })));
      if (v.query || v.lang || v.source || v.hy || v.mode !== 'all')
        parts.push(
          el(
            'button',
            { type: 'button', class: 'link-button', onclick: () => this.reset() },
            t('איפוס'),
          ),
        );
      const cold = app.catalog.coldPending();
      if (app.coldLoading)
        parts.push(
          el(
            'span',
            { class: 'loading-note' },
            t('טוען שנים ישנות: {done} מתוך {total}', app.coldLoading),
          ),
        );
      else if (cold.shards)
        parts.push(
          el(
            'button',
            { type: 'button', class: 'link-button', onclick: () => app.loadCold() },
            t('כולל את השנים האחרונות בלבד. לטעינת {n} גיליונות ישנים נוספים', {
              n: Core.formatCount(cold.issues),
            }),
          ),
        );
      this.countLine.replaceChildren(...parts);
      app.announce(t('{n} גיליונות', { n: Core.formatCount(this.shown.length) }));
      this.renderEmpty();
    }

    reset() {
      Object.assign(this.v, { query: '', lang: '', source: '', hy: 0, mode: 'all' });
      this.input.value = '';
      this.schedule();
    }

    renderEmpty() {
      const { app } = this;
      this.listHost.querySelector('.state-card, .skeleton-list')?.remove();
      this.list.root.hidden = this.shown.length === 0;
      if (this.shown.length) return;
      const status = app.catalog.status;
      const loading =
        !app.index.size ||
        app.catalog.shards.length > status.shardsLoaded ||
        status.phase === 'checking' ||
        status.phase === 'downloading';
      const name = this.title();
      if (!app.index.size) {
        this.listHost.appendChild(
          loading || (!status.error && !status.lastOkAt)
            ? Ui.skeleton(7)
            : new A.WeekScreen(app).emptyCatalog(),
        );
        return;
      }
      if (!this.base.length) {
        this.listHost.appendChild(
          loading
            ? Ui.skeleton(5, 'row')
            : Ui.stateCard({
                icon: 'news_24_regular',
                title: t('אין עדיין עלונים ל"{name}"', { name }),
                text: t('ייתכן שהעלונים עוד נטענים, או שהוסתרו לפי הכללים.'),
                compact: true,
                actions: [Ui.button('tonal', t('חזרה למעגל השנה'), () => app.go('cycle'))],
              }),
        );
        return;
      }
      this.listHost.appendChild(
        Ui.stateCard({
          icon: 'search_24_regular',
          title: t('לא נמצאו עלונים'),
          text: [
            t('אפשר לקצר את החיפוש או להסיר מסנן.'),
            Core.isLatinOnlyQuery(this.v.query)
              ? t('החיפוש הוא בעברית — נסו לכתוב את השם באותיות עבריות')
              : '',
          ],
          compact: true,
          actions: [Ui.button('filled', t('איפוס החיפוש והמסננים'), () => this.reset())],
        }),
      );
    }

    // ------------------------------------------------------------- רשימה

    groups() {
      const { app } = this;
      return this.v.group === 'year'
        ? Cycle.groupByYear(app.index, this.shown)
        : Cycle.groupBySeries(app.index, this.shown, new Set(app.state.followedIds()));
    }

    layout() {
      const { app } = this;
      const index = app.index;
      const v = this.v;
      if (!this.shown.length) {
        this.flat = [];
        this.rowGroup = [];
        this.list.configure({ count: 0, heightEm: 4, render() {} });
        this.updateSticky();
        return;
      }
      // שורות צפופות תמיד (כמו בדף סדרה): דף של מאות סדרות עם גיליון או שניים לכל אחת אינו נקרא ככרטיסים.
      const mode = 'row';
      this.perRow = Cards.columnsFor(this.list.root.clientWidth, this.list.emPx, mode);
      const { rows, flat } = Cycle.buildRows(this.groups(), this.perRow);
      this.flat = flat;
      // לכל שורה: הקבוצה שלה ואם היא הכותרת (לכותרת הצמודה)
      let owner = null;
      this.rowGroup = rows.map((d) => {
        if (d.header !== undefined) owner = d.header;
        return owner;
      });
      this.rowIsHeader = rows.map((d) => d.header !== undefined);
      const count = flat.length;
      const tokens = A.Index.parseQuery(v.query).tokens;
      const rowEm = Cards.ROW_EM.row + Cards.ROW_EM.gap;
      const inTopic = v.group === 'series' ? { label: this.title() } : null;
      // מיפוי פריט ← שורה לגלילת המיקוד (כותרות קבוצה תופסות שורות)
      const rowOfStart = new Map();
      rows.forEach((d, r) => d.header === undefined && rowOfStart.set(d.start, r));
      this.list.rowForItem = (k) => {
        let start = k - (k % this.perRow);
        while (start >= 0 && !rowOfStart.has(start)) start--;
        return rowOfStart.get(Math.max(0, start)) || 0;
      };
      this.stickyOf = null;
      this.list.configure({
        count: rows.length,
        heightEm: (r) => (rows[r].header !== undefined ? HEADER_EM : rowEm),
        itemsPerRow: this.perRow,
        render: (r, node) => {
          const d = rows[r];
          if (d.header !== undefined) {
            node.appendChild(this.groupHeader(d.header));
            return;
          }
          node.classList.add('is-grid');
          node.style.setProperty('--cols', String(this.perRow));
          for (let c = 0; c < d.n; c++) {
            const i = d.start + c;
            node.appendChild(
              Cards.render(app, index.item(flat[i]), {
                mode,
                tokens,
                index: i,
                total: count,
                ctx: { count, at: (k) => index.item(flat[k]), index: i },
                inTopic,
              }),
            );
          }
        },
      });
      this.updateSticky();
    }

    /**
     * הכותרת הצמודה: כשהשורה בראש הרשימה היא שורת גיליון (או כותרת שכבר התחילה להיגלל), מוצג שם הקבוצה
     * והספירה שלה מעל הרשימה; כשהכותרת עצמה בראש הרשימה — הצמודה נעלמת.
     */
    updateSticky() {
      const list = this.list;
      if (!this.rowGroup || !this.rowGroup.length || list.root.hidden) {
        this.sticky.hidden = true;
        return;
      }
      const row = list._rowAt(list.root.scrollTop);
      const group = this.rowGroup[row];
      const show =
        Boolean(group) && (!this.rowIsHeader[row] || list.root.scrollTop - list._top(row) > 1);
      this.sticky.hidden = !show;
      list.topInset = show ? this.sticky.offsetHeight : 0;
      if (!show || this.stickyOf === group) return;
      this.stickyOf = group;
      const label = this.groupLabel(group);
      this.sticky.replaceChildren(
        el('span', { class: 'sticky-name', dir: 'auto' }, label),
        el('span', { class: 'section-count' }, Core.formatCount(group.idx.length)),
      );
    }

    /** שם הקבוצה לתצוגה: הסדרה או השנה. */
    groupLabel(group) {
      const { app } = this;
      if (this.v.group === 'year')
        return group.key ? t('שנת {y}', { y: Core.hyLetters(group.key) }) : t('ללא שנה');
      const series = app.index.seriesArr[group.key];
      const first = app.index.item(group.idx[0]);
      return (series && series.title) || first.seriesTitle || first.title;
    }

    /** כותרת קבוצה: סדרה (שם, קרדיט, קישור לדף הסדרה) או שנה. */
    groupHeader(group) {
      const { app } = this;
      const count = el('span', { class: 'section-count' }, Core.formatCount(group.idx.length));
      if (this.v.group === 'year')
        return Cards.groupHeader(
          group.key ? t('שנת {y}', { y: Core.hyLetters(group.key) }) : t('ללא שנה'),
          group.idx.length,
        );
      const series = app.index.seriesArr[group.key];
      const first = app.index.item(group.idx[0]);
      const title = (series && series.title) || first.seriesTitle || first.title;
      const credit = app.index
        ._srcsOfMask(group.mask)
        .map((id) => app.sourceInfo(id).name)
        .join(' · ');
      const creditText = credit ? t('באדיבות {names}', { names: credit }) : '';
      const lang = series && series.lang && series.lang !== 'he' ? Core.langName(series.lang) : '';
      // כותרת בתוך פריט רשימה: הרשימה הוירטואלית (`role=list`) מכילה רק פריטי רשימה
      return el(
        'div',
        { role: 'listitem', class: 'group-item' },
        el('h3', { class: 'topic-group' }, this.seriesLink(group, title, creditText, lang), count),
      );
    }

    /** כפתור הכותרת של סדרה: שם, קרדיט ושפה; השם הנגיש מכיל אותם ואת היעד. */
    seriesLink(group, title, creditText, lang) {
      const { app } = this;
      return el(
        'button',
        {
          type: 'button',
          class: 'group-link',
          'aria-label': [title, creditText, lang, t('לדף הסדרה')].filter(Boolean).join(' '),
          title: t('לדף הסדרה'),
          onclick: () => app.openSeries(group.id),
        },
        el(
          'span',
          { class: 'group-text' },
          el('span', { class: 'group-name', dir: 'auto' }, title),
          ' ',
          creditText ? el('span', { class: 'group-credit', dir: 'auto' }, creditText) : null,
        ),
        lang ? Ui.chip(lang, { kind: 'lang' }) : null,
        icon(
          document.documentElement.dir === 'ltr'
            ? 'chevron_right_24_regular'
            : 'chevron_left_24_regular',
          'row-chevron',
        ),
      );
    }
  }

  A.TopicScreen = TopicScreen;
  if (typeof module === 'object' && module.exports) module.exports = { TopicScreen };
})(typeof self !== 'undefined' ? self : globalThis);
