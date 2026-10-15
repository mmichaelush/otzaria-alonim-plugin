// "השבוע": מסך הבית. הפרשה והתאריך העברי, חיצים לשבוע קודם והבא, ושלושה
// אזורים: מהסדרות שלי, חדש השבוע (עם סיבת הצגה), והמשך קריאה.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Cards = A.Cards;
  const Core = A.Core;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  const STEP = 12;
  const CAP = 120;

  /** חץ "קודם" פונה לכיוון הקריאה: בעברית ימינה. */
  const prevIcon = () => (document.documentElement.dir === 'ltr' ? 'chevron_left_24_regular' : 'chevron_right_24_regular');
  const nextIcon = () => (document.documentElement.dir === 'ltr' ? 'chevron_right_24_regular' : 'chevron_left_24_regular');

  class WeekScreen {
    constructor(app) {
      this.app = app;
      this.fill = false;
    }

    mount(host) {
      this.host = host;
      this.unsub = ['data', 'state', 'files', 'disk', 'sync'].map((name) => this.app.on(name, () => this.schedule()));
      this.render();
    }

    refresh() {
      this.render();
    }

    /** ציור מאוחד: שרדים וסטטוס מגיעים בהמוניהם. */
    schedule() {
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => {
        this.pending = false;
        if (this.host && this.host.isConnected) this.render();
      });
    }

    destroy() {
      for (const off of this.unsub || []) off();
    }

    // ------------------------------------------------------- בחירת שבוע

    /** השבוע המוצג: הנבחר, או השבת הקרובה (ואם אין לה עדיין עלונים — הקודמת). */
    currentWeek() {
      const { index } = this.app;
      const weeks = index.weeks;
      const today = new Date();
      if (!weeks.length) {
        const date = Core.ymd(Core.upcomingShabbat(today));
        return { synthetic: true, date, hy: 0, parasha: [], parashaIL: [], event: null, i: -1 };
      }
      let i = weeks.findIndex((w) => w.date === this.app.view.weekDate);
      if (i < 0) {
        i = index.weekFor(Core.ymd(today));
        if (i > 0 && !index.forWeek(weeks[i]).length && index.forWeek(weeks[i - 1]).length) i--;
      }
      return { ...weeks[i], i };
    }

    weekLabel(week) {
      const diaspora = this.app.state.prefs.diaspora;
      const slugs = diaspora ? week.parasha : week.parashaIL && week.parashaIL.length ? week.parashaIL : week.parasha;
      return Core.parashaLabel(slugs || []);
    }

    shiftWeek(delta) {
      const { index } = this.app;
      const week = this.currentWeek();
      const next = index.weeks[week.i + delta];
      if (!next) return;
      this.app.view.weekDate = next.date;
      this.app.view.weekMore = STEP;
      this.render();
    }

    // ------------------------------------------------------------ ציור

    render() {
      const app = this.app;
      const { index, state } = app;
      const week = this.currentWeek();
      const scroller = this.host.closest('.app-content');
      const keep = scroller ? scroller.scrollTop : 0;
      const items = index.forWeek(week).map((i) => index.item(i));
      const followed = new Set(state.followedIds());
      const muted = (it) => state.isMuted(it.series);
      const mine = items.filter((it) => followed.has(it.series) && !muted(it)).sort((a, b) => b._added - a._added);
      const rest = items
        .filter((it) => !followed.has(it.series) && !muted(it))
        .sort((a, b) => Number(app.isNew(b)) - Number(app.isNew(a)) || b._dl - a._dl || b._added - a._added);
      const shown = mine.concat(rest);
      const ctx = (list) => (i) => ({ count: list.length, at: (k) => list[k], index: i });

      const page = el('div', { class: 'page week-page' });
      page.appendChild(this.hero(week, items.length));
      const status = app.catalog.status;
      const loading = !index.size && (status.phase === 'checking' || status.phase === 'downloading' || (status.phase === 'idle' && !status.lastOkAt && !status.error));

      if (loading) {
        page.appendChild(el('h2', { class: 'section-title' }, t('מתעדכן…')));
        page.appendChild(Ui.skeleton(6));
      } else if (!index.size) {
        page.appendChild(this.emptyCatalog());
      } else {
        const limit = Math.min(CAP, app.view.weekMore);
        if (state.followedIds().length === 0) page.appendChild(this.followHint());
        if (mine.length) page.appendChild(this.section(t('מהסדרות שלי'), mine, Math.max(STEP, limit), ctx(shown), t('אתה עוקב'), shown));
        if (rest.length) {
          page.appendChild(this.section(t('חדש השבוע'), rest, limit, ctx(shown), null, shown, mine.length));
        }
        if (!shown.length) page.appendChild(this.emptyWeek(week));
      }
      const reading = state.continueReading(6);
      if (reading.length) page.appendChild(this.continueReading(reading));
      Ui.preserveFocus(this.host, () => this.host.replaceChildren(page));
      if (scroller) scroller.scrollTop = keep;
    }

    hero(week, count) {
      const app = this.app;
      const label = this.weekLabel(week);
      const event = week.event ? Core.eventName(week.event) : '';
      const title = label ? t('פרשת {name}', { name: label }) : event || t('שבת');
      const date = Core.parseYmd(week.date);
      const hebrew = date ? Core.hebrewDate(date, I18n.language) : '';
      const sub = [hebrew, date ? Core.formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' }) : ''].filter(Boolean).join(' · ');
      const hasPrev = week.i > 0;
      const hasNext = week.i >= 0 && week.i < app.index.weeks.length - 1;
      const today = app.index.weeks.length ? app.index.weeks[app.index.weekFor(Core.ymd(new Date()))] : null;
      const away = today && today.date !== week.date;
      return el(
        'section',
        { class: 'week-hero' },
        Ui.iconButton(prevIcon(), t('השבוע הקודם'), () => this.shiftWeek(-1), { disabled: !hasPrev, className: 'hero-nav' }),
        el(
          'div',
          { class: 'hero-text', 'aria-live': 'polite' },
          el('h1', { class: 'hero-title', dir: 'auto' }, title),
          el('p', { class: 'hero-sub', dir: 'auto' }, sub),
          el(
            'div',
            { class: 'hero-chips' },
            event && label ? Ui.chip(event, { kind: 'reason', icon: 'calendar_star_24_regular' }) : null,
            count ? Ui.chip(t('{n} גיליונות', { n: Core.formatCount(count) }), { kind: 'source' }) : null,
            away ? Ui.button('text', t('חזרה להשבוע'), () => { app.view.weekDate = ''; this.render(); }, { className: 'button-small' }) : null,
          ),
        ),
        Ui.iconButton(nextIcon(), t('השבוע הבא'), () => this.shiftWeek(1), { disabled: !hasNext, className: 'hero-nav' }),
      );
    }

    section(title, list, limit, ctxFor, forcedReason, shown, offset) {
      const app = this.app;
      const base = offset || 0;
      const part = list.slice(0, limit);
      const grid = el('div', { class: 'card-grid', role: 'list', 'aria-label': title });
      part.forEach((item, k) => {
        const at = shown.indexOf(item);
        let reason = forcedReason;
        if (!reason) reason = app.isNew(item) ? '' : item._dl >= 300 ? t('פופולרי') : '';
        grid.appendChild(Cards.render(app, item, { mode: 'card', reason, ctx: ctxFor(at), index: base + k, total: shown.length, active: -1 }));
      });
      const more = list.length > part.length && part.length < CAP;
      const capped = list.length > part.length && part.length >= CAP;
      return el(
        'section',
        { class: 'week-section' },
        el('h2', { class: 'section-title' }, title, el('span', { class: 'section-count' }, Core.formatCount(list.length))),
        grid,
        more
          ? el('div', { class: 'load-more' }, Ui.button('outlined', t('הצג עוד'), () => { app.view.weekMore = limit + STEP; this.render(); }))
          : null,
        capped
          ? el('div', { class: 'load-more' }, Ui.button('outlined', t('הכול בכל העלונים'), () => app.go('all', { query: '' })))
          : null,
      );
    }

    continueReading(snaps) {
      const app = this.app;
      const list = el('div', { class: 'compact-list', role: 'list', 'aria-label': t('המשך קריאה') });
      for (const snap of snaps) {
        const item = app.index.get(snap.id);
        const title = (item && item.seriesTitle) || snap.st || snap.ti;
        const meta = [Core.parashaLabel(snap.p), snap.hy ? Core.hyLetters(snap.hy) : ''].filter(Boolean).join(' · ');
        list.appendChild(
          el(
            'button',
            {
              type: 'button',
              class: 'compact-row',
              role: 'listitem',
              onclick: () => (item ? app.openIssue(item) : app.go('all', { query: snap.st || snap.ti })),
            },
            icon('book_open_24_regular'),
            el('span', { class: 'compact-title', dir: 'auto' }, title),
            el('span', { class: 'compact-meta', dir: 'auto' }, meta),
          ),
        );
      }
      return el('section', { class: 'week-section' }, el('h2', { class: 'section-title' }, t('המשך קריאה')), list);
    }

    followHint() {
      return el(
        'div',
        { class: 'hint-card' },
        icon('alert_24_regular'),
        el('div', { class: 'hint-text' }, el('strong', {}, t('עקבו אחרי סדרות')), el('span', {}, t('הסדרות שתבחרו יופיעו כאן ראשונות, בכל שבוע.'))),
        Ui.button('tonal', t('לרשימת הסדרות'), () => this.app.go('series')),
      );
    }

    emptyWeek(week) {
      const { app } = this;
      const status = app.catalog.status;
      const loadingMore = app.catalog.shards.length > app.catalog.status.shardsLoaded;
      return Ui.stateCard({
        icon: 'news_24_regular',
        title: t('עדיין אין עלונים לשבת הזו'),
        text: loadingMore || status.phase === 'downloading' ? t('הנתונים עדיין נטענים ברקע.') : t('עלונים לשבת מתפרסמים בדרך כלל במהלך השבוע. אפשר לעבור לשבוע קודם או לעיין בכל העלונים.'),
        actions: [Ui.button('tonal', t('כל העלונים'), () => app.go('all'))],
        compact: true,
      });
    }

    /** אין קטלוג בכלל: לא נטען ואין מטמון. */
    emptyCatalog() {
      const app = this.app;
      const status = app.catalog.status;
      const offline = app.online === false || status.phase === 'offline';
      let title = t('אין עדיין עלונים');
      let text = t('הקטלוג עוד לא ירד. כשיהיה חיבור לאינטרנט הוא יורד אוטומטית, ואחר כך הכול עובד גם בלי רשת.');
      let iconName = 'cloud_arrow_down_24_regular';
      let error = false;
      if (status.schemaTooNew || status.pluginTooOld) {
        title = t('יש גרסה חדשה של התוסף');
        text = t('הקטלוג עודכן בפורמט חדש. עדכנו את התוסף מהחנות של אוצריא כדי להמשיך.');
        iconName = 'arrow_sync_24_regular';
      } else if (status.error === 'forbidden' || status.error === 'permission') {
        title = t('הקטלוג חסום');
        text = t('אוצריא חוסמת את הגישה לכתובת הקטלוג. הכתובת צריכה אישור ברשימת ההיתר של אוצריא (קבצים אחרים עובדים בלי קשר לכך).');
        iconName = 'shield_checkmark_24_regular';
        error = true;
      } else if (offline) {
        title = t('אין חיבור לאינטרנט');
        iconName = 'wifi_off_24_regular';
      } else if (status.error) {
        title = t('הקטלוג לא ירד');
        text = t('אפשר לנסות שוב. התוסף ינסה שוב גם לבד.');
        error = true;
      }
      return Ui.stateCard({
        icon: iconName,
        title,
        text,
        error,
        actions: [Ui.button('filled', t('בדיקה חוזרת'), () => app.catalog.sync(), { icon: 'arrow_sync_24_regular' })],
      });
    }
  }

  A.WeekScreen = WeekScreen;
  if (typeof module === 'object' && module.exports) module.exports = { WeekScreen };
})(typeof self !== 'undefined' ? self : globalThis);
