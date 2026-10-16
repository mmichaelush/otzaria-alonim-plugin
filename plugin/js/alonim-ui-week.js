// "השבוע": מסך הבית. כותרת (פרשה או אירוע, תאריך עברי ולועזי), ניווט בין שבועות
// (חצים ו"מעבר ל…"), ושלושה אזורים: מהסדרות שלי, חדש השבוע (עם סיבת הצגה), והמשך קריאה.
// "השבוע" הוא לפי היום ולא לפי העלונים שכבר הועלו: השבת הקרובה, או החג שקודם לה.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Cards = A.Cards;
  const Core = A.Core;
  const Weeks = A.Weeks;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  const STEP = 12;
  const CAP = 120;

  /** חץ "קודם" פונה לכיוון הקריאה: בעברית ימינה. */
  const prevIcon = () =>
    document.documentElement.dir === 'ltr' ? 'chevron_left_24_regular' : 'chevron_right_24_regular';
  const nextIcon = () =>
    document.documentElement.dir === 'ltr' ? 'chevron_right_24_regular' : 'chevron_left_24_regular';

  class WeekScreen {
    constructor(app) {
      this.app = app;
    }

    mount(host) {
      this.host = host;
      this.unsub = ['data', 'state', 'files', 'disk', 'sync'].map((name) =>
        this.app.on(name, () => this.schedule()),
      );
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
        if (!this.destroyed && this.host && this.host.isConnected) this.render();
      });
    }

    destroy() {
      // `host` הוא העמודה המשותפת: ציור אחרי destroy היה דורס את המסך שהחליף אותנו.
      this.destroyed = true;
      for (const off of this.unsub || []) off();
    }

    // ------------------------------------------------------- בחירת שבוע

    /**
     * השבוע המוצג: הנבחר במפורש (`view.weekDate`), ואחרת "השבוע" לפי היום.
     * מחזיר גם את השבוע הנוכחי ואת היחס ביניהם, כדי שהכותרת תאמר בבירור מתי
     * מוצג שבוע שאינו הנוכחי.
     */
    selection() {
      const { app } = this;
      const views = app.weekViews();
      const today = app.today();
      const cur = Weeks.current(views, Core.ymd(today));
      if (!views.length) {
        // אין לוח: שבת קרובה מחושבת, כדי שהמסך לא יהיה ריק.
        const date = Core.upcomingShabbat(today);
        const row = {
          date: Core.ymd(date),
          hy: A.HebCal.fromDate(date).year,
          parasha: [],
          parashaIL: [],
          shabbat: true,
          derived: true,
        };
        const only = Weeks.build([row], { diaspora: app.state.prefs.diaspora });
        return {
          views: only,
          i: 0,
          view: only[0],
          cur: { index: 0, status: 'empty' },
          rel: { kind: 'current', weeks: 0 },
        };
      }
      let i = Weeks.indexOfDate(views, app.view.weekDate);
      if (i < 0) i = cur.index;
      return { views, i, view: views[i], cur, rel: Weeks.relation(views, i, cur.index) };
    }

    goto(index) {
      const views = this.app.weekViews();
      if (views[index]) this.gotoDate(views[index].date);
    }

    gotoDate(date) {
      this.app.view.weekDate = date;
      this.app.view.weekMore = STEP;
      this.render();
    }

    /** "השבוע" הנוכחי: מבטל בחירה מפורשת. */
    goCurrent() {
      this.app.view.weekDate = '';
      this.app.view.weekMore = STEP;
      this.render();
    }

    shift(delta) {
      const sel = this.selection();
      this.goto(sel.i + delta);
    }

    /** השבוע האחרון (עד הנוכחי) שיש בו עלונים גלויים; -1 אם אין. */
    latestWithIssues(sel) {
      const { index } = this.app;
      for (let k = Math.min(sel.cur.index, sel.views.length - 1); k >= 0; k--) {
        if (index.forWeek(sel.views[k].row).length) return k;
      }
      return -1;
    }

    openPicker(sel) {
      A.WeekPicker.open(this.app, {
        getViews: () => this.app.weekViews(),
        currentDate: (sel.views[sel.cur.index] || {}).date || '',
        selectedDate: sel.view.date,
        onPick: (date) => this.gotoDate(date),
        onCurrent: () => this.goCurrent(),
      });
    }

    // ------------------------------------------------------------ ציור

    render() {
      const app = this.app;
      const { index, state } = app;
      const sel = this.selection();
      const scroller = this.host.closest('.app-content');
      const keep = scroller ? scroller.scrollTop : 0;
      const items = index.forWeek(sel.view.row).map((i) => index.item(i));
      const followed = new Set(state.followedIds());
      const muted = (it) => state.isMuted(it.series);
      const mine = items
        .filter((it) => followed.has(it.series) && !muted(it))
        .sort((a, b) => b._added - a._added);
      const rest = items
        .filter((it) => !followed.has(it.series) && !muted(it))
        .sort(
          (a, b) =>
            Number(app.isNew(b)) - Number(app.isNew(a)) || b._dl - a._dl || b._added - a._added,
        );
      const shown = mine.concat(rest);
      const ctx = (list) => (i) => ({ count: list.length, at: (k) => list[k], index: i });

      const page = el('div', { class: 'page week-page' });
      const status = app.catalog.status;
      const loading =
        !index.size &&
        (status.phase === 'checking' ||
          status.phase === 'downloading' ||
          (status.phase === 'idle' && !status.lastOkAt && !status.error));
      // בלי לוח עדיין (הטעינה הראשונה) הכותרת היא "שבת" גנרית שמתחלפת בשם הפרשה; שלד במקומה, בלי קפיצה.
      page.appendChild(this.hero(sel, items.length, loading && sel.cur.status === 'empty'));

      if (loading) {
        page.appendChild(el('h2', { class: 'section-title' }, t('מתעדכן…')));
        page.appendChild(Ui.skeleton(6));
      } else if (!index.size) {
        page.appendChild(this.emptyCatalog());
      } else {
        const limit = Math.min(CAP, app.view.weekMore);
        if (state.followedIds().length === 0) page.appendChild(this.followHint());
        if (mine.length)
          page.appendChild(
            this.section(
              t('מהסדרות שלי'),
              mine,
              Math.max(STEP, limit),
              ctx(shown),
              t('אתה עוקב'),
              shown,
            ),
          );
        if (rest.length) {
          page.appendChild(
            this.section(t('חדש השבוע'), rest, limit, ctx(shown), null, shown, mine.length),
          );
        }
        if (!shown.length) page.appendChild(this.emptyWeek(sel));
      }
      const reading = state.continueReading(6);
      if (reading.length) page.appendChild(this.continueReading(reading));
      Ui.preserveFocus(this.host, () => this.host.replaceChildren(page));
      if (scroller) scroller.scrollTop = keep;
    }

    /** "בעוד 3 שבועות" / "לפני שבוע": המרחק של השבוע המוצג מהשבוע הנוכחי. */
    relationText(rel) {
      if (rel.kind === 'future')
        return rel.weeks === 1 ? t('שבוע הבא') : t('בעוד {n} שבועות', { n: rel.weeks });
      return rel.weeks === 1 ? t('שבוע שעבר') : t('לפני {n} שבועות', { n: rel.weeks });
    }

    hero(sel, count, pending) {
      const { view, views, i, rel } = sel;
      const away = rel.kind !== 'current';
      const day = Weeks.displayDay(view);
      const sub = day ? Core.dateLine(day, { weekday: true, hebrewText: view.hebrew }) : view.date;
      const prev = views[i - 1];
      const next = views[i + 1];
      const status = sel.cur.status;
      return el(
        'section',
        { class: 'week-hero' + (away ? ' is-away' : ''), 'aria-labelledby': 'week-title' },
        Ui.iconButton(
          prevIcon(),
          prev ? t('הקודם: {name}', { name: prev.title }) : t('השבוע הקודם'),
          () => this.shift(-1),
          { disabled: !prev, className: 'hero-nav' },
        ),
        el(
          'div',
          { class: 'hero-text', 'aria-live': 'polite' },
          pending
            ? el(
                'h1',
                { class: 'hero-title is-pending', id: 'week-title' },
                el('span', { class: 'visually-hidden' }, t('מתעדכן…')),
                el('span', { class: 'skeleton-line is-hero-title', 'aria-hidden': 'true' }),
              )
            : el('h1', { class: 'hero-title', id: 'week-title', dir: 'auto' }, view.title),
          // החלקים (עברי · לועזי) אינם נשברים באמצע: השורה נשברת רק בין הלוחות.
          el(
            'p',
            { class: 'hero-sub', dir: 'auto' },
            sub
              .split(' • ')
              .flatMap((part, k) => [k ? ' • ' : null, el('span', { class: 'nowrap' }, part)]),
          ),
          el(
            'div',
            { class: 'hero-chips' },
            view.kind === 'special' && view.parashaLabel && view.eventLabel
              ? Ui.chip(view.eventLabel, { kind: 'reason', icon: 'calendar_star_24_regular' })
              : null,
            view.kind === 'holiday'
              ? Ui.chip(t('חג באמצע השבוע'), { kind: 'reason', icon: 'calendar_star_24_regular' })
              : null,
            away
              ? Ui.chip(this.relationText(rel), { kind: 'away', icon: 'clock_24_regular' })
              : Ui.chip(t('השבוע'), { kind: 'now' }),
            ...view.secondary.map((slug) => Ui.chip(Core.eventName(slug), { kind: 'source' })),
            view.derived && !pending
              ? Ui.chip(t('לפי העלונים'), {
                  kind: 'source',
                  title: t('השנה הזו אינה בלוח הקטלוג; התאריך נלקח מהעלונים עצמם.'),
                })
              : null,
            count
              ? Ui.chip(t('{n} גיליונות', { n: Core.formatCount(count) }), { kind: 'source' })
              : null,
          ),
          el(
            'div',
            { class: 'hero-actions' },
            Ui.button('tonal', t('מעבר לשבוע…'), () => this.openPicker(sel), {
              icon: 'calendar_ltr_24_regular',
              className: 'button-small',
              key: 'jump',
            }),
            away
              ? Ui.button('text', t('חזרה להשבוע'), () => this.goCurrent(), {
                  className: 'button-small',
                  key: 'current',
                })
              : null,
          ),
          status === 'after' || status === 'before'
            ? el(
                'p',
                { class: 'hero-note', role: 'status' },
                t(
                  'לוח השבועות בקטלוג אינו כולל את התאריך של היום, ולכן מוצג השבוע הקרוב ביותר שבו.',
                ),
              )
            : null,
        ),
        Ui.iconButton(
          nextIcon(),
          next ? t('הבא: {name}', { name: next.title }) : t('השבוע הבא'),
          () => this.shift(1),
          { disabled: !next, className: 'hero-nav' },
        ),
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
        grid.appendChild(
          Cards.render(app, item, {
            mode: 'card',
            reason,
            ctx: ctxFor(at),
            index: base + k,
            total: shown.length,
            active: -1,
          }),
        );
      });
      const more = list.length > part.length && part.length < CAP;
      const capped = list.length > part.length && part.length >= CAP;
      return el(
        'section',
        { class: 'week-section' },
        el(
          'h2',
          { class: 'section-title' },
          title,
          el('span', { class: 'section-count' }, Core.formatCount(list.length)),
        ),
        grid,
        more
          ? el(
              'div',
              { class: 'load-more' },
              Ui.button('outlined', t('הצג עוד'), () => {
                app.view.weekMore = limit + STEP;
                this.render();
              }),
            )
          : null,
        capped
          ? el(
              'div',
              { class: 'load-more' },
              Ui.button('outlined', t('הכול בכל העלונים'), () => app.go('all', { query: '' })),
            )
          : null,
      );
    }

    continueReading(snaps) {
      const app = this.app;
      const list = el('div', {
        class: 'compact-list',
        role: 'list',
        'aria-label': t('המשך קריאה'),
      });
      for (const snap of snaps) {
        const item = app.index.get(snap.id);
        const title = (item && item.seriesTitle) || snap.st || snap.ti;
        const meta = [Core.parashaLabel(snap.p), snap.hy ? Core.hyLetters(snap.hy) : '']
          .filter(Boolean)
          .join(' · ');
        list.appendChild(
          el(
            'button',
            {
              type: 'button',
              class: 'compact-row',
              role: 'listitem',
              onclick: () =>
                item ? app.openIssue(item) : app.go('all', { query: snap.st || snap.ti }),
            },
            icon('book_open_24_regular'),
            el('span', { class: 'compact-title', dir: 'auto' }, title),
            el('span', { class: 'compact-meta', dir: 'auto' }, meta),
          ),
        );
      }
      return el(
        'section',
        { class: 'week-section' },
        el('h2', { class: 'section-title' }, t('המשך קריאה')),
        list,
      );
    }

    followHint() {
      return el(
        'div',
        { class: 'hint-card' },
        icon('alert_24_regular'),
        el(
          'div',
          { class: 'hint-text' },
          el('strong', {}, t('עקבו אחרי סדרות')),
          el('span', {}, t('הסדרות שתבחרו יופיעו כאן ראשונות, בכל שבוע.')),
        ),
        Ui.button('tonal', t('לרשימת הסדרות'), () => this.app.go('series')),
      );
    }

    emptyWeek(sel) {
      const { app } = this;
      const status = app.catalog.status;
      const loadingMore = app.catalog.shards.length > status.shardsLoaded;
      const future = sel.rel.kind === 'future';
      const actions = [];
      const latest = this.latestWithIssues(sel);
      if (latest >= 0 && latest !== sel.i) {
        actions.push(
          Ui.button('filled', t('לשבוע האחרון שיש בו עלונים'), () => this.goto(latest), {
            icon: 'history_24_regular',
          }),
        );
      }
      actions.push(Ui.button('tonal', t('כל העלונים'), () => app.go('all')));
      let text = t(
        'עלונים לשבת מתפרסמים בדרך כלל במהלך השבוע. אפשר לעבור לשבוע קודם או לעיין בכל העלונים.',
      );
      if (loadingMore || status.phase === 'downloading') text = t('הנתונים עדיין נטענים ברקע.');
      else if (future) text = t('זה שבוע עתידי, ועדיין לא פורסמו בו עלונים.');
      return Ui.stateCard({
        icon: 'news_24_regular',
        title: future ? t('עוד אין עלונים לשבוע הזה') : t('עדיין אין עלונים לשבת הזו'),
        text,
        actions,
        compact: true,
      });
    }

    /** אין קטלוג בכלל: לא נטען ואין מטמון. */
    emptyCatalog() {
      const app = this.app;
      const status = app.catalog.status;
      const offline = app.online === false || status.phase === 'offline';
      let title = t('אין עדיין עלונים');
      let text = t(
        'הקטלוג עוד לא ירד. כשיהיה חיבור לאינטרנט הוא יורד אוטומטית, ואחר כך הכול עובד גם בלי רשת.',
      );
      let iconName = 'cloud_arrow_down_24_regular';
      let error = false;
      if (status.schemaTooNew || status.pluginTooOld) {
        title = t('יש גרסה חדשה של התוסף');
        text = t('הקטלוג עודכן בפורמט חדש. עדכנו את התוסף מהחנות של אוצריא כדי להמשיך.');
        iconName = 'arrow_sync_24_regular';
      } else if (status.error === 'forbidden' || status.error === 'permission') {
        title = t('הקטלוג חסום');
        text = t(
          'אוצריא חוסמת את הגישה לכתובת הקטלוג. הכתובת צריכה אישור ברשימת ההיתר של אוצריא (קבצים אחרים עובדים בלי קשר לכך).',
        );
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
        actions: [
          Ui.button('filled', t('בדיקה חוזרת'), () => app.catalog.sync(), {
            icon: 'arrow_sync_24_regular',
          }),
        ],
      });
    }
  }

  A.WeekScreen = WeekScreen;
  if (typeof module === 'object' && module.exports) module.exports = { WeekScreen };
})(typeof self !== 'undefined' ? self : globalThis);
