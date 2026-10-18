// השלד: הפס העליון, לשוניות הכדור, אזור התוכן, הצפיין וההודעות. מחבר את
// אירועי ה-App למסכים ולדיאלוגים. מוסיף את `mountShell` ל-App.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const I18n = A.I18n;
  const { App, TABS } = A.AppModule;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  const SCREENS = () => ({
    week: A.WeekScreen,
    cycle: A.CycleScreen,
    /** דף נושא: חלק מלשונית "מעגל השנה" (`route.topic`), עם מסך משלו. */
    topic: A.TopicScreen,
    all: A.AllScreen,
    series: A.SeriesScreen,
    mine: A.MineScreen,
    settings: A.SettingsScreen,
  });

  /** שם הלשונית לקורא מסך: השם המלא, ואם הצורה הקצרה אינה חלק ממנו — היא קודמת לו. */
  function accessibleTabName(tab) {
    const label = t(tab.label);
    const short = t(tab.short || tab.label);
    return label.includes(short) ? label : short + ', ' + label;
  }

  /** "לפני 5 דקות". */
  function ago(ms, now) {
    const minutes = Math.floor((now - ms) / 60000);
    if (minutes < 1) return t('הרגע');
    if (minutes < 60) return t('לפני {n} דק׳', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return t('לפני {n} שעות', { n: hours });
    return t('לפני {n} ימים', { n: Math.floor(hours / 24) });
  }

  App.prototype.mountShell = function mountShell() {
    const doc = this.doc;
    this.shell = doc.querySelector('.app-shell');
    this.titleNode = doc.querySelector('.topbar-title');
    this.subtitleNode = doc.querySelector('.topbar-subtitle');
    this.actionsNode = doc.querySelector('.topbar-actions');
    this.tabBar = doc.querySelector('.main-tabs');
    this.scroller = doc.querySelector('.app-content');
    this.column = doc.querySelector('.content-column');
    this.syncBar = doc.querySelector('.sync-bar');
    this.announcer = new Ui.Announcer(doc.querySelector('.live-region'));
    this.toasts = new Ui.Toasts(doc.querySelector('.toasts'), this.announcer);
    this.viewerUi = new A.Viewer(this, doc.querySelector('.viewer'));
    this.screen = null;
    this.tabButtons = null;

    this.applyLanguage();
    this.shell.dataset.mode = 'tabs';

    // מקלדת: קיצורים כלליים, וחצים בין הלשוניות (ARIA tabs).
    doc.addEventListener('keydown', (event) => {
      if (this.onKey(event)) return;
      const tab = event.target.closest && event.target.closest('.main-tab');
      if (!tab) return;
      const tabs = [...this.tabBar.querySelectorAll('.main-tab')];
      const index = tabs.indexOf(tab);
      const rtl = doc.documentElement.dir !== 'ltr';
      const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }[event.key];
      let next = null;
      if (step) next = tabs[(index + step + tabs.length) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      this.go(next.dataset.tab);
      this.tabBar.querySelector('.main-tab[aria-selected="true"]').focus();
    });

    this.on('route', () => this.renderRoute());
    this.on('sync', () => this.updateStatus());
    this.on('data', () => this.updateStatus());
    this.on('disk', () => this.updateStatus());
    this.on('prefs', (info) => {
      if (info && info.languageChanged) {
        this.applyLanguage();
        this.renderRoute();
      }
    });
    // חלונות אסינכרוניים: כשל בהבטחה אינו נבלע ("לא נפתח" בלי הסבר).
    const guardAsync = (fn) => (payload) =>
      Promise.resolve()
        .then(() => fn(payload))
        .catch((error) => this.reportFailure('dialog_failed', error));
    this.on(
      'details',
      guardAsync(({ item, ctx }) => A.Dialogs.showDetails(this, item, ctx)),
    );
    this.on('add-to-list', (item) => A.Dialogs.addToList(this, item));
    this.on('download-failed', ({ item, code }) => A.Dialogs.downloadFailed(this, item, code));
    this.on('need-folder', ({ then }) => A.Dialogs.needFolder(this, then));
    this.on('shortcuts', () => A.Dialogs.shortcuts());
    this.on('viewer', () => this.updateStatus());

    for (const Screen of Object.values(SCREENS()))
      A.Boundary.protect(Screen, (screen, method, error) =>
        this.screenFailed(screen, method, error),
      );
    this.renderRoute();
    this.updateStatus();
    // הפעלה ראשונה: אחרי שהמסך הראשון צויר.
    if (!this.state.prefs.welcomeSeen)
      setTimeout(() => !this.state.prefs.welcomeSeen && A.HelpUi.firstRun(this), 700);
  };

  /**
   * מסך שנכשל בציור: מציגים במקומו כרטיס שגיאה (הודעה, ניסיון חוזר, העתקת פרטים),
   * במקום דף ריק. הלשוניות והפס העליון ממשיכים לעבוד.
   */
  App.prototype.screenFailed = function screenFailed(screen, method, error) {
    this.log
      .scoped('ui')
      .error(
        'screen ' + method + ' failed',
        Object.assign(new Error(error && error.message), { code: 'screen_failed' }),
      );
    if (error && error.stack)
      this.log.scoped('ui').debug(String(error.stack).split('\n').slice(0, 4).join(' | '));
    const host = (screen && screen.host) || this.column;
    if (!host) return;
    try {
      host.replaceChildren(
        el(
          'div',
          { class: 'page' },
          Ui.stateCard({
            icon: 'warning_24_regular',
            error: true,
            title: t('משהו השתבש במסך הזה'),
            text: [
              A.Errors.text('screen_failed'),
              t('שאר התוסף ממשיך לעבוד. אפשר לנסות שוב, או להעתיק את הפרטים לדיווח.'),
            ],
            note: t('קוד: {code}', { code: 'screen_failed' }) + ' · ' + method,
            actions: [
              Ui.button('filled', t('נסה שוב'), () => this.renderRoute(), {
                icon: 'arrow_clockwise_24_regular',
                key: 'retry',
              }),
              Ui.button(
                'tonal',
                t('העתקת פרטים לדיווח'),
                async () => {
                  const ok = await A.Selection.copyToClipboard(
                    A.Diagnostics.report(this, { filter: { level: 'warn' } }),
                  );
                  if (ok) this.toast(t('הדיווח הועתק (בלי נתיבים)'));
                  else this.reportFailure('copy_failed');
                },
                { icon: 'copy_24_regular' },
              ),
              Ui.button('text', t('לשבוע'), () => this.go('week')),
            ],
          }),
        ),
      );
    } catch (inner) {
      this.log.scoped('ui').error('boundary render failed', inner);
    }
  };

  App.prototype.applyLanguage = function applyLanguage() {
    const title = t('עלוני שבת');
    this.doc.title = title;
    this.titleNode.textContent = title;
    this.tabBar.setAttribute('aria-label', t('לשוניות התוסף'));
    this.tabBar.parentElement.setAttribute('aria-label', t('לשוניות התוסף'));
    this.tabButtons = null;
    this.buildTopActions();
  };

  App.prototype.buildTopActions = function buildTopActions() {
    this.syncButton = Ui.iconButton(
      'arrow_sync_24_regular',
      t('סנכרון'),
      () => this.catalog.sync(),
      { className: 'topbar-button' },
    );
    const search = Ui.iconButton(
      'search_24_regular',
      t('חיפוש (Ctrl+/)'),
      () => this.focusSearch(),
      { className: 'topbar-button' },
    );
    this.actionsNode.replaceChildren(search, this.syncButton);
  };

  /** כפתורי הלשוניות נבנים פעם אחת ומתעדכנים במקום: בנייה מחדש מפילה את המיקוד. */
  App.prototype.renderTabs = function renderTabs() {
    if (!this.tabButtons) {
      this.tabButtons = TABS.map((tab) =>
        el(
          'button',
          {
            type: 'button',
            class: 'main-tab',
            role: 'tab',
            id: 'main-tab-' + tab.id,
            'aria-controls': 'main-panel',
            // השם הנגיש מכיל את הטקסט הנראה (גם בצר, שבו מוצגת הצורה הקצרה): WCAG 2.5.3
            'aria-label': accessibleTabName(tab),
            title: t(tab.label),
            onclick: () => this.go(tab.id),
            dataset: { tab: tab.id },
          },
          icon(tab.icon),
          el('span', { class: 'main-tab-label', 'aria-hidden': 'true' }, t(tab.label)),
          el('span', { class: 'main-tab-short', 'aria-hidden': 'true' }, t(tab.short || tab.label)),
        ),
      );
      this.tabBar.replaceChildren(...this.tabButtons);
    }
    TABS.forEach((tab, i) => {
      const selected = tab.id === this.view.route.tab;
      this.tabButtons[i].setAttribute('aria-selected', String(selected));
      this.tabButtons[i].setAttribute('tabindex', selected ? '0' : '-1');
    });
    this.column.setAttribute('aria-labelledby', 'main-tab-' + this.view.route.tab);
  };

  App.prototype.renderRoute = function renderRoute() {
    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }
    this.renderTabs();
    const route = this.view.route;
    // נושא שאינו מוכר (מצב ישן): חוזרים לגלגל, ולא לדף ריק
    if (route.topic && !A.Cycle.topic(route.topic)) route.topic = null;
    const Screen =
      SCREENS()[route.tab === 'cycle' && route.topic ? 'topic' : route.tab] || A.WeekScreen;
    const screen = new Screen(this);
    this.screen = screen;
    this.scroller.classList.toggle('is-fill', Boolean(screen.fill));
    this.column.classList.toggle('is-fill', Boolean(screen.fill));
    this.column.replaceChildren();
    this.scroller.scrollTop = 0;
    screen.mount(this.column);
    const tab = TABS.find((x) => x.id === this.view.route.tab);
    this.announce(screen.title ? screen.title() : t(tab.label));
  };

  /** כותרת המשנה בפס העליון ופס הסנכרון, בלי חלון קופץ. */
  App.prototype.updateStatus = function updateStatus() {
    if (!this.subtitleNode) return;
    const s = this.catalog.status;
    const now = Date.now();
    let text = '';
    let busy = false;
    if (s.phase === 'checking') {
      text = t('בודק עדכונים…');
      busy = true;
    } else if (s.phase === 'downloading') {
      text = t('מעדכן: {done} מתוך {total}', { done: s.done, total: s.total });
      busy = true;
    } else if (this.coldLoading) {
      text = t('טוען שנים ישנות: {done} מתוך {total}', this.coldLoading);
      busy = true;
    } else if (this.online === false || s.phase === 'offline') {
      text = t('ללא חיבור · הנתונים השמורים');
    } else if (s.phase === 'error' || s.phase === 'partial') {
      text =
        s.error === 'forbidden'
          ? t('הקטלוג חסום · הנתונים השמורים')
          : t('הסנכרון נכשל · הנתונים השמורים');
    } else if (this.index.size) {
      text =
        t('{n} גיליונות', { n: Core.formatCount(this.index.size) }) +
        (s.lastOkAt ? ' · ' + t('עודכן {when}', { when: ago(s.lastOkAt, now) }) : '');
    }
    this.subtitleNode.textContent = text;
    this.syncButton.classList.toggle('is-spinning', busy);
    this.syncButton.disabled = busy;
    this.syncButton.setAttribute('aria-busy', String(busy));
    this.shell.classList.toggle('is-syncing', busy);
    this.shell.classList.toggle('has-problem', s.phase === 'error' || s.phase === 'partial');
    if (this.syncBar) {
      this.syncBar.hidden = !busy;
      this.syncBar.classList.toggle('is-indeterminate', s.phase !== 'downloading' || !s.total);
      const bar = this.syncBar.firstElementChild;
      if (bar)
        bar.style.width =
          s.phase === 'downloading' && s.total ? Math.round((s.done / s.total) * 100) + '%' : '';
    }
  };
})(typeof self !== 'undefined' ? self : globalThis);
