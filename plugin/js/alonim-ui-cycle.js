// "מעגל השנה": כל הפרשות והמועדים של השנה, לפי סדר השנה (חגי תשרי, ואחריהם חמשת החומשים
// עם המועדים במקומם). רחב: טבעת עמודות (הספירה לכל תחנה) לצד רשימת האריחים; צר: האריחים בלבד.
// כל אריח הוא כפתור שפותח את "הנושא בכל השנים" (`alonim-ui-topic.js`). השבוע הנוכחי מסומן, וכל
// אריח מציג את התאריך שלו השנה. המודל: `alonim-cycle.js`. החלטות עיצוב: docs/ARCHITECTURE.md.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const Cycle = A.Cycle;
  const Weeks = A.Weeks;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  /** תאריך עברי קצר (בלי שנה) של התחנה השנה, או ''. */
  function dateText(key, view) {
    if (!view) return '';
    return Core.hebrewDate(Cycle.displayDay(key, view), { year: false });
  }

  class CycleScreen {
    constructor(app) {
      this.app = app;
      this.unsub = [];
    }

    mount(host) {
      this.host = host;
      this.scroller = host.closest('.app-content');
      this.unsub = ['data', 'state', 'sync', 'prefs'].map((name) =>
        this.app.on(name, () => this.schedule()),
      );
      this.onScroll = () => {
        this.app.view.cycle.scroll = this.scroller.scrollTop;
      };
      if (this.scroller) this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
      this.render(true);
    }

    destroy() {
      this.destroyed = true;
      for (const off of this.unsub) off();
      if (this.scroller) this.scroller.removeEventListener('scroll', this.onScroll);
      if (this.ring) this.ring.destroy();
    }

    refresh() {
      this.render();
    }

    /** ציור מאוחד: שרדים והעדפות מגיעים בהמוניהם. */
    schedule() {
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => {
        this.pending = false;
        if (!this.destroyed && this.host && this.host.isConnected) this.render();
      });
    }

    title() {
      return t('מעגל השנה');
    }

    // ------------------------------------------------------------ מודל התצוגה

    /** מה שהמסך צריך מהאפליקציה: סדר השנה, ספירות, תאריכים והשבוע הנוכחי. */
    model() {
      const { app } = this;
      const views = app.weekViews();
      const today = app.today();
      const current = Weeks.current(views, Core.ymd(today));
      const { hy, leap } = Cycle.cycleYear(views, current, today);
      const ready = app.index.size > 0;
      const currentView = current.status === 'empty' ? null : views[current.index];
      const nowKeys = new Set();
      if (currentView) {
        for (const slug of currentView.parasha) nowKeys.add(Cycle.pKey(slug));
        const tp = Cycle.topicOfView(currentView);
        if (tp) nowKeys.add(tp);
        if (currentView.event) nowKeys.add(Cycle.canonicalKey(Cycle.eKey(currentView.event)));
      }
      const counts = ready ? app.index.topicCounts() : null;
      // קטלוג בלי שום תיוג של מועדים (ישן): אריחי המועדים נעלמים במקום להראות אפסים שקריים
      const tagged = Boolean(counts && counts.event.size);
      const dates = Cycle.stationDates(views, hy);
      return {
        hy,
        leap,
        ready,
        // מועדי השנה במקומם המדויק לפי הלוח; בלי לוח — הטבלה הקבועה לשנה פשוטה או מעוברת
        order: Cycle.order(leap, dates),
        counts,
        tagged,
        dates,
        nowKeys,
        currentView,
        today,
      };
    }

    /** תיאור תחנה לאריח ולטבעת. */
    describe(m, station) {
      const parasha = station.kind === 'parasha';
      const name = parasha ? Core.parashaName(station.slug) : Core.eventName(station.slug);
      const count = m.counts
        ? m.counts[parasha ? 'parasha' : 'event'].get(station.slug) || 0
        : null;
      const view = m.dates.get(station.key);
      const date = dateText(station.key, view);
      const current = m.nowKeys.has(station.key);
      let note = '';
      if (station.alias) note = Core.eventName(station.alias);
      else if (station.key === 'p:vezot-haberakhah') note = t('נקראת בשמחת תורה');
      // סדר הרכיבים כמו בטקסט הנראה באריח (שם, השבוע, כיתוב, תאריך, ספירה): WCAG 2.5.3
      const parts = [name];
      if (current) parts.push(t('השבוע'));
      if (note) parts.push(note);
      if (date) parts.push(date);
      if (count !== null) parts.push(t('{n} גיליונות', { n: Core.formatCount(count) }));
      let detail;
      if (parasha) {
        const chumash = Cycle.chumashOf(station.slug);
        detail = t(chumash.name);
      } else {
        detail = t(Cycle.KIND_LABELS[Cycle.EVENT_KIND[station.slug]] || 'מועד');
      }
      return {
        name,
        count,
        date,
        note,
        current,
        detail,
        label: parts.join(', '),
        figure: count === null ? '' : t('{n} גיליונות', { n: Core.formatCount(count) }),
      };
    }

    // ------------------------------------------------------------------- ציור

    render(first) {
      const { app } = this;
      const m = this.model();
      // מיקוד שנשמר בציור מחדש (שרד שהגיע ברקע): אריח או קטע בגלגל
      const active = /** @type {HTMLElement|null} */ (document.activeElement);
      const inHost = Boolean(active && this.host.contains(active));
      const tileKey = inHost && active.closest('.cycle-tile') ? active.dataset.key : '';
      const ringKey = inHost && active.closest('.ring-seg') ? active.dataset.key : '';
      const wantFocus = tileKey || (first && app.view.cycle.focus) || '';
      const page = el('div', { class: 'page cycle-page' });
      page.appendChild(this.hero(m));
      if (!m.ready) {
        const status = app.catalog.status;
        const busy =
          status.phase === 'checking' ||
          status.phase === 'downloading' ||
          (status.phase === 'idle' && !status.lastOkAt && !status.error);
        page.appendChild(busy ? Ui.skeleton(6) : new A.WeekScreen(app).emptyCatalog());
      } else {
        page.appendChild(this.cold());
        page.appendChild(this.body(m));
      }
      this.host.replaceChildren(page);
      if (m.ready) {
        this.afterRender(m, wantFocus, first);
        if (ringKey && this.ring) this.ring.focusKey(ringKey);
      }
    }

    afterRender(m, wantFocus, first) {
      const { app } = this;
      if (first && this.scroller) this.scroller.scrollTop = app.view.cycle.scroll || 0;
      const target =
        wantFocus && this.host.querySelector('.cycle-tile[data-key="' + wantFocus + '"]');
      if (target) {
        this.setTab(target);
        target.focus({ preventScroll: !first });
        if (first && this.scroller && !this.inView(target))
          target.scrollIntoView({ block: 'center' });
        app.view.cycle.focus = '';
      }
    }

    inView(node) {
      const box = node.getBoundingClientRect();
      const outer = this.scroller.getBoundingClientRect();
      return box.top >= outer.top && box.bottom <= outer.bottom;
    }

    hero(m) {
      const { app } = this;
      const now = m.currentView && Cycle.topicOfView(m.currentView);
      const nowTopic = now ? Cycle.topic(now) : null;
      const year = Core.hyLetters(m.hy);
      return el(
        'section',
        { class: 'week-hero cycle-hero', 'aria-labelledby': 'cycle-title' },
        el(
          'div',
          { class: 'hero-text' },
          el('h1', { class: 'hero-title', id: 'cycle-title' }, t('מעגל השנה')),
          el(
            'p',
            { class: 'hero-sub' },
            t('כל הפרשות והמועדים של השנה, בסדרם. בחרו אחד לראות את כל העלונים שלו, מכל השנים.'),
          ),
          el(
            'div',
            { class: 'hero-chips' },
            Ui.chip(m.leap ? t('שנת {y} · מעוברת', { y: year }) : t('שנת {y}', { y: year }), {
              kind: 'source',
              icon: 'calendar_ltr_24_regular',
            }),
            m.ready
              ? Ui.chip(t('{n} גיליונות', { n: Core.formatCount(app.index.size) }), {
                  kind: 'source',
                })
              : null,
          ),
          nowTopic
            ? el(
                'div',
                { class: 'hero-actions' },
                Ui.button(
                  'tonal',
                  t('השבוע: {name}', { name: Cycle.topicName(nowTopic) }),
                  () => app.openTopic(nowTopic.key, { from: 'cycle' }),
                  { icon: 'calendar_star_24_regular', className: 'button-small', key: 'now' },
                ),
              )
            : null,
        ),
      );
    }

    /** שנים ישנות שעוד לא נטענו: הספירות חלקיות, ואומרים זאת. */
    cold() {
      const { app } = this;
      const cold = app.catalog.coldPending();
      if (!cold.shards && !app.coldLoading) return el('span', { class: 'cycle-cold' });
      return el(
        'div',
        { class: 'results-line cycle-cold', 'aria-live': 'polite' },
        app.coldLoading
          ? el(
              'span',
              { class: 'loading-note' },
              t('טוען שנים ישנות: {done} מתוך {total}', app.coldLoading),
            )
          : el(
              'button',
              { type: 'button', class: 'link-button', onclick: () => app.loadCold() },
              t('כולל את השנים האחרונות בלבד. לטעינת {n} גיליונות ישנים נוספים', {
                n: Core.formatCount(cold.issues),
              }),
            ),
      );
    }

    body(m) {
      const { app } = this;
      const stations = m.order.stations.filter((s) => s.kind === 'parasha' || m.tagged);
      const visibleSections = m.order.sections
        .map((section) => ({
          section,
          stations: section.stations.filter((s) => stations.includes(s)),
        }))
        .filter((x) => x.stations.length);
      const infos = new Map(stations.map((s) => [s.key, this.describe(m, s)]));
      const max = Math.max(1, ...[...infos.values()].map((i) => i.count || 0));

      this.ring = A.Ring.build({
        label: t('גלגל השנה: אורך העמודה הוא מספר הגיליונות'),
        stations,
        max,
        info: (s) => infos.get(s.key),
        idle: () => ({
          detail: t('השנה היהודית'),
          name: Core.hyLetters(m.hy),
          figure: t('{n} גיליונות', { n: Core.formatCount(app.index.size) }),
        }),
        fallback: [...m.nowKeys].find((k) => infos.has(k)) || null,
        onOpen: (key) => app.openTopic(key, { from: 'cycle' }),
        onActive: (key) => this.highlightTile(key),
      });

      const lists = el('div', { class: 'cycle-lists' });
      for (const { section, stations: list } of visibleSections) {
        lists.appendChild(this.section(m, section, list, infos));
      }
      lists.addEventListener('keydown', (event) => this.onTileKey(event));
      const legend = el(
        'ul',
        { class: 'ring-legend', 'aria-hidden': 'true' },
        ...visibleSections.map(({ section }) =>
          el(
            'li',
            { class: 'ring-legend-item is-c-' + section.id },
            el('span', { class: 'ring-dot' }),
            el('span', {}, t(section.name)),
          ),
        ),
        el('li', { class: 'ring-legend-note' }, t('עמודה מלאה: פרשה · עמודה בקו מתאר: מועד')),
      );
      this.tileTab = null;
      const aside = el(
        'aside',
        { class: 'cycle-ring', 'aria-label': t('גלגל השנה') },
        this.ring.el,
        legend,
      );
      return el('div', { class: 'cycle-body' }, aside, lists);
    }

    section(m, section, stations, infos) {
      const parashot = stations.filter((s) => s.kind === 'parasha');
      const events = stations.length - parashot.length;
      const range = parashot.length
        ? Core.parashaName(parashot[0].slug) + ' – ' + Core.parashaName(parashot.at(-1).slug)
        : '';
      const count = parashot.length
        ? t('{n} פרשות', { n: parashot.length }) +
          (events ? ' · ' + t('{n} מועדים', { n: events }) : '')
        : t('{n} מועדים', { n: events });
      const tiles = el('ul', { class: 'cycle-tiles', 'aria-label': t(section.name) });
      for (const station of stations)
        tiles.appendChild(el('li', {}, this.tile(station, infos.get(station.key))));
      return el(
        'section',
        { class: 'week-section cycle-section is-c-' + section.id },
        el(
          'h2',
          { class: 'section-title' },
          t(section.name),
          el('span', { class: 'section-count', dir: 'auto' }, range || count),
          range ? el('span', { class: 'section-count' }, count) : null,
        ),
        tiles,
      );
    }

    tile(station, info) {
      const { app } = this;
      const button = el(
        'button',
        {
          type: 'button',
          class:
            'cycle-tile is-' +
            station.kind +
            (info.current ? ' is-current' : '') +
            (info.count === 0 ? ' is-empty' : ''),
          'aria-label': info.label,
          'aria-current': info.current ? 'true' : null,
          tabindex: '-1',
          dataset: { key: station.key },
          onclick: () => app.openTopic(station.key, { from: 'cycle' }),
          onmouseenter: () => this.ring && this.ring.setActive(station.key),
          onmouseleave: () => this.ring && this.ring.setActive(null),
          onfocus: () => {
            this.setTab(button);
            if (this.ring) this.ring.setActive(station.key);
          },
          onblur: () => this.ring && this.ring.setActive(null),
        },
        // רווחים בין הפריטים: גם בלי עיצוב (קורא מסך, בדיקות נגישות) הטקסט הנראה הוא מילים נפרדות
        el(
          'span',
          { class: 'tile-top' },
          station.kind === 'event' ? icon('calendar_star_24_regular', 'tile-icon') : null,
          el('span', { class: 'tile-name', dir: 'auto' }, info.name),
          ' ',
          info.current ? el('span', { class: 'tile-now' }, t('השבוע')) : null,
        ),
        ' ',
        info.note ? el('span', { class: 'tile-note', dir: 'auto' }, info.note) : null,
        ' ',
        el(
          'span',
          { class: 'tile-meta' },
          el('span', { class: 'tile-date', dir: 'auto' }, info.date),
          ' ',
          info.count === null
            ? null
            : el('span', { class: 'tile-count' }, Core.formatCount(info.count)),
        ),
      );
      if (!this.tileTab || info.current) this.setTab(button);
      return button;
    }

    // ------------------------------------------------------------- מקלדת

    /** אריח אחד נגיש ב-Tab (מיקוד נודד); חצים עוברים בין האריחים. */
    setTab(button) {
      if (this.tileTab && this.tileTab !== button) this.tileTab.setAttribute('tabindex', '-1');
      button.setAttribute('tabindex', '0');
      this.tileTab = button;
    }

    highlightTile(key) {
      for (const node of this.host.querySelectorAll('.cycle-tile.is-active'))
        node.classList.remove('is-active');
      if (!key) return;
      const node = this.host.querySelector('.cycle-tile[data-key="' + key + '"]');
      if (node) node.classList.add('is-active');
    }

    onTileKey(event) {
      const tile = event.target.closest && event.target.closest('.cycle-tile');
      if (!tile) return;
      const tiles = [...this.host.querySelectorAll('.cycle-tile')];
      const at = tiles.indexOf(tile);
      const rtl = document.documentElement.dir !== 'ltr';
      let next = -1;
      switch (event.key) {
        case 'ArrowRight':
          next = at + (rtl ? -1 : 1);
          break;
        case 'ArrowLeft':
          next = at + (rtl ? 1 : -1);
          break;
        case 'ArrowDown':
        case 'ArrowUp':
          next = this.verticalNeighbor(tiles, at, event.key === 'ArrowDown' ? 1 : -1);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = tiles.length - 1;
          break;
        case 'PageDown':
          next = this.verticalNeighbor(tiles, at, 1, 4);
          break;
        case 'PageUp':
          next = this.verticalNeighbor(tiles, at, -1, 4);
          break;
        default:
          return;
      }
      if (next < 0 || next >= tiles.length) return;
      event.preventDefault();
      tiles[next].focus();
    }

    /** האריח הקרוב ביותר אופקית בשורה (או ב-[rows] שורות) מעל או מתחת. */
    verticalNeighbor(tiles, at, step, rows) {
      const from = tiles[at].getBoundingClientRect();
      const rowTops = [];
      for (const tile of tiles) {
        const top = Math.round(tile.getBoundingClientRect().top);
        if (!rowTops.includes(top)) rowTops.push(top);
      }
      rowTops.sort((a, b) => a - b);
      const row = rowTops.indexOf(Math.round(from.top));
      const targetRow = Math.max(0, Math.min(rowTops.length - 1, row + step * (rows || 1)));
      if (targetRow === row) return -1;
      const centerX = from.left + from.width / 2;
      let best = -1;
      let bestDistance = Infinity;
      tiles.forEach((tile, k) => {
        const box = tile.getBoundingClientRect();
        if (Math.round(box.top) !== rowTops[targetRow]) return;
        const distance = Math.abs(box.left + box.width / 2 - centerX);
        if (distance < bestDistance) {
          best = k;
          bestDistance = distance;
        }
      });
      return best;
    }
  }

  A.CycleScreen = CycleScreen;
  if (typeof module === 'object' && module.exports) module.exports = { CycleScreen };
})(typeof self !== 'undefined' ? self : globalThis);
