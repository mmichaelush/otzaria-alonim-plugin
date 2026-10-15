// צפיין ה-PDF הפנימי. הקובץ נפתח מהתיקייה של המשתמש (`fs.openFolderFile`) ומוצג
// ב-`<iframe>` על כתובת הקובץ המקומית (מובנה ב-Windows/macOS). לא הורד עדיין?
// מורידים לתיקייה זמנית (`_קריאה`) ואז מציגים, עם חיווי. מהצפיין אפשר להדפיס,
// לשמור, לעבור לקודם/הבא ולפתוח באתר המקור.
//
// הדפסה — שלושה מסלולים, מהחלפה קלה (`PRINT_ROUTES`):
//   1. frame: `iframe.contentWindow.print()`. ב-WebView האמיתי ה-iframe ממקור אחר,
//      ולכן ייחסם; ננסה ונתעלם.
//   2. reader: "פתח בקורא של אוצריא" (`library.refreshUserBooks` ←
//      `library.findBooks` ← `reader.openBook`); בקורא יש הדפסה.
//   3. guide: הנחיה להדפיס מסרגל הצפיין (סמל המדפסת, או Ctrl+P אחרי לחיצה על המסמך).
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Cards = A.Cards;
  const Core = A.Core;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  /** סדר המסלולים; מסלול שנכשל מוביל לבא אחריו. להחלפה בלי לגעת ב-UI. */
  const PRINT_ROUTES = ['frame', 'reader', 'guide'];

  /** הצפיין המובנה של הדפדפן עובד ב-Windows וב-macOS בלבד (API_REFERENCE). */
  const IFRAME_PDF_PLATFORMS = ['windows', 'macos'];

  class Viewer {
    constructor(app, host) {
      this.app = app;
      this.host = host;
      this.state = null;
      this.token = 0;
      app.on('viewer', (v) => (v ? this.open(v) : this.close()));
      app.on('files', () => this.refreshBar());
      app.on('disk', () => this.refreshBar());
      app.on('state', () => this.refreshBar());
    }

    get open_() {
      return Boolean(this.state);
    }

    open(viewer) {
      // המיקוד חוזר למי שפתח את הצפיין (לא לפתיחה קודמת, וגם לא בין קודם/הבא).
      if (!this.state) this.returnFocus = document.activeElement;
      this.state = { ...viewer, phase: 'loading', error: '', file: null, job: null };
      this.token = viewer.token;
      this.app.shell.dataset.mode = 'viewer';
      this.host.hidden = false;
      this.draw();
      this.load();
    }

    close() {
      this.state = null;
      this.token++;
      this.host.hidden = true;
      this.host.replaceChildren();
      this.app.shell.dataset.mode = 'tabs';
      const focus = this.app.shell.querySelector('.main-tab[aria-selected="true"]');
      if (this.returnFocus && document.contains(this.returnFocus)) this.returnFocus.focus();
      else if (focus) focus.focus();
      this.returnFocus = null;
    }

    // --------------------------------------------------------- טעינה

    async load() {
      const s = this.state;
      const token = this.token;
      const { app } = this;
      if (!app.files.hasFolder) {
        s.phase = 'nofolder';
        return this.drawBody();
      }
      s.phase = 'loading';
      s.error = '';
      this.drawBody();
      const platformOk = !app.platform || IFRAME_PDF_PLATFORMS.includes(app.platform);
      try {
        // הכתובות אינן באינדקס שבזיכרון: קוראים אותן מקובץ השרד לפני ההורדה.
        // קובץ שכבר בתיקייה נפתח בלי הכתובות (גם כשהקטלוג אינו זמין).
        const full = app.files.isDownloaded(s.item) ? s.item : await app.full(s.item);
        if (token !== this.token) return;
        if (!full) {
          s.phase = 'error';
          s.error = 'missing_data';
          this.drawBody();
          return;
        }
        const file = await app.files.openForReading(full, (job) => {
          s.job = job;
          this.drawBody();
        });
        if (token !== this.token) return;
        s.file = file;
        s.phase = platformOk ? 'ready' : 'unsupported';
        this.drawBody();
        this.refreshBar();
        if (s.options.print && platformOk) setTimeout(() => token === this.token && this.print(), 700);
        else if (s.options.print) this.print();
      } catch (error) {
        if (token !== this.token) return;
        s.phase = 'error';
        s.error = error.code || 'failed';
        this.drawBody();
      }
    }

    // -------------------------------------------------------- ציור

    draw() {
      this.bar = el('header', { class: 'viewer-bar' });
      this.body = el('div', { class: 'viewer-body' });
      this.host.replaceChildren(this.bar, this.body);
      this.refreshBar();
      this.drawBody();
      const back = this.bar.querySelector('[data-key="back"]');
      if (back) back.focus();
    }

    /** מיקום בהקשר הרשימה (הקודם/הבא). */
    neighbors() {
      const { ctx, item } = this.state;
      if (!ctx || !ctx.count) return { prev: null, next: null, label: '' };
      const i = ctx.index;
      const at = (k) => (k >= 0 && k < ctx.count ? ctx.at(k) : null);
      return { prev: at(i - 1), next: at(i + 1), label: t('{i} מתוך {n}', { i: i + 1, n: ctx.count }), index: i, item };
    }

    go(delta) {
      const { ctx } = this.state;
      if (!ctx) return;
      const target = ctx.at(ctx.index + delta);
      if (!target) return;
      if (delta > 0) this.app.state.markRead(this.state.item, true);
      this.app.openIssue(target, { ...ctx, index: ctx.index + delta });
    }

    refreshBar() {
      if (!this.state || !this.bar) return;
      const { app } = this;
      const s = this.state;
      const item = s.item;
      const st = app.cardState(item);
      const nb = this.neighbors();
      const rtl = document.documentElement.dir !== 'ltr';
      const prevIcon = rtl ? 'chevron_right_24_regular' : 'chevron_left_24_regular';
      const nextIcon = rtl ? 'chevron_left_24_regular' : 'chevron_right_24_regular';
      const title = Cards.titleOf(item);
      const meta = Cards.metaParts(item).join(' · ');
      const dl = Cards.downloadButton(app, item, st, 'viewer-tool');
      // הסרגל נבנה מחדש בכל שינוי מצב: המיקוד חוזר לכפתור שהיה בו.
      const focused = this.bar.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') || document.activeElement.getAttribute('aria-label') : null;
      this.bar.replaceChildren(
        Ui.iconButton(rtl ? 'arrow_right_24_regular' : 'arrow_left_24_regular', t('חזרה לרשימה'), () => app.closeViewer(), { key: 'back', className: 'viewer-tool' }),
        el('div', { class: 'viewer-title' }, el('h2', { class: 'viewer-name', dir: 'auto' }, title), el('p', { class: 'viewer-sub', dir: 'auto' }, [meta, nb.label].filter(Boolean).join(' · '))),
        el(
          'div',
          { class: 'viewer-tools' },
          Ui.iconButton(prevIcon, t('הגיליון הקודם'), () => this.go(-1), { disabled: !nb.prev, className: 'viewer-tool' }),
          Ui.iconButton(nextIcon, t('הגיליון הבא'), () => this.go(1), { disabled: !nb.next, className: 'viewer-tool' }),
          Ui.iconButton('document_pdf_24_regular', t('הדפסה'), () => this.print(), { className: 'viewer-tool' }),
          dl,
          Ui.iconButton(st.favorite ? 'star_24_filled' : 'star_24_regular', st.favorite ? t('הסר ממועדפים') : t('הוסף למועדפים'), () => app.toggleFavorite(item), { pressed: st.favorite, className: 'viewer-tool star-button', key: 'fav' }),
          Ui.iconButton('checkmark_circle_24_regular', st.read ? t('סמן כלא נקרא') : t('סמן כנקרא'), () => app.toggleRead(item), { pressed: st.read, className: 'viewer-tool', key: 'read' }),
          Ui.iconButton('open_24_regular', t('פתח באתר המקור'), () => app.openSiteFor(item), { className: 'viewer-tool' }),
          Ui.iconButton('info_24_regular', t('פרטי הגיליון'), () => app.showDetails(item, s.ctx), { className: 'viewer-tool' }),
        ),
      );
      if (focused) {
        for (const b of this.bar.querySelectorAll('button')) {
          if ((b.getAttribute('data-key') || b.getAttribute('aria-label')) === focused || b.getAttribute('aria-label') === focused) {
            if (!b.disabled) b.focus({ preventScroll: true });
            break;
          }
        }
      }
    }

    drawBody() {
      if (!this.state || !this.body) return;
      const { app } = this;
      const s = this.state;
      const item = s.item;
      let content;
      if (s.phase === 'ready' && s.file) {
        this.frame = el('iframe', { class: 'viewer-frame', src: s.file.url, title: Cards.titleOf(item), referrerpolicy: 'no-referrer' });
        content = this.frame;
      } else if (s.phase === 'nofolder') {
        content = Ui.stateCard({
          icon: 'folder_24_regular',
          title: t('בחרו תיקייה כדי לקרוא'),
          text: t('הגיליון נפתח מקובץ בתיקייה שלכם, כך שהוא נשאר זמין גם בלי רשת. בוחרים תיקייה פעם אחת.'),
          actions: [Ui.button('filled', t('בחירת תיקייה'), () => app.emit('need-folder', { then: () => this.load() }), { icon: 'folder_open_24_regular' }), Ui.button('text', t('פתח באתר המקור'), () => app.openSiteFor(item), { icon: 'open_24_regular' })],
        });
      } else if (s.phase === 'unsupported') {
        content = Ui.stateCard({
          icon: 'document_pdf_24_regular',
          title: t('הצפיין הפנימי אינו נתמך במערכת הזו'),
          text: t('הקובץ הורד לתיקייה. אפשר לפתוח אותו בקורא של אוצריא.'),
          actions: [Ui.button('filled', t('פתח בקורא של אוצריא'), () => this.openInReader(), { icon: 'book_open_24_regular' }), Ui.button('text', t('פתח באתר המקור'), () => app.openSiteFor(item), { icon: 'open_24_regular' })],
        });
      } else if (s.phase === 'error') {
        const code = s.error;
        const actions = [];
        if (!['blocked', 'no_direct_link'].includes(code)) actions.push(Ui.button('filled', t('ניסיון חוזר'), () => this.load(), { icon: 'arrow_clockwise_24_regular' }));
        actions.push(Ui.button(['blocked', 'no_direct_link'].includes(code) ? 'filled' : 'tonal', t('פתח באתר המקור'), () => app.openSiteFor(item), { icon: 'open_24_regular' }));
        if (code === 'no_folder' || code === 'permission') actions.unshift(Ui.button('filled', t('בחירת תיקייה'), () => app.emit('need-folder', { then: () => this.load() }), { icon: 'folder_open_24_regular' }));
        content = Ui.stateCard({ icon: 'warning_24_regular', error: true, title: t('אי אפשר לפתוח את הגיליון'), text: app.fileErrorText(code), actions, note: t('קוד: {code}', { code }) });
      } else {
        const job = s.job;
        const active = job && job.status === 'active';
        const size = job && job.asset && job.asset.bytes ? Core.formatBytes(job.asset.bytes) : '';
        content = el(
          'div',
          { class: 'viewer-loading', role: 'status', 'aria-live': 'polite' },
          el('span', { class: 'spinner is-large', 'aria-hidden': 'true' }),
          el('p', { class: 'viewer-loading-title' }, active ? t('מוריד את הגיליון…') : job ? t('ממתין בתור…') : t('פותח…')),
          size ? el('p', { class: 'viewer-loading-note' }, t('גודל משוער: {size}', { size })) : null,
          job ? Ui.button('text', t('ביטול'), () => { app.files.cancel(job.id); app.closeViewer(); }, { className: 'button-small' }) : null,
        );
      }
      this.body.replaceChildren(content);
    }

    // --------------------------------------------------------- הדפסה

    /**
     * מסלול א (frame) ואז הדיאלוג עם המסלולים האחרים. מסלול שהצליח אינו
     * מציג דבר נוסף.
     */
    print() {
      const { app } = this;
      const s = this.state;
      if (!s) return;
      for (const route of PRINT_ROUTES) {
        if (route === 'frame') {
          if (s.phase === 'ready' && this.frame && app.files.printViaFrame(this.frame)) {
            app.toast(t('נפתח חלון ההדפסה'));
            return;
          }
        } else {
          this.printDialog();
          return;
        }
      }
    }

    printDialog() {
      const { app } = this;
      const s = this.state;
      const result = el('p', { class: 'dialog-text print-result', role: 'status', hidden: true });
      const guide = el(
        'div',
        { class: 'print-guide' },
        el('h3', { class: 'details-section' }, t('או להדפיס מהצפיין')),
        el('ol', { class: 'state-steps' }, el('li', {}, t('לחצו על המסמך כדי שיקבל מיקוד.')), el('li', {}, t('בסרגל הכלים של הצפיין לחצו על סמל המדפסת, או הקישו Ctrl+P.'))),
      );
      const dlg = Ui.dialog({
        title: t('הדפסה'),
        size: 'small',
        body: el(
          'div',
          { class: 'print-dialog' },
          el('p', { class: 'dialog-text' }, t('אוצריא אינה מאפשרת לתוסף להפעיל הדפסה ישירות מהצפיין. יש שתי דרכים נוחות:')),
          el('h3', { class: 'details-section' }, t('בקורא של אוצריא (מומלץ)')),
          el('p', { class: 'dialog-text' }, t('בקורא של אוצריא יש הדפסה מלאה. זה עובד כשהתיקייה שבחרתם מוגדרת באוצריא כתיקייה אישית (הגדרות ← ספרייה).')),
          Ui.button('filled', t('פתח בקורא של אוצריא'), async () => {
            result.hidden = true;
            const outcome = await this.openInReader();
            if (outcome.ok) dlg.close();
            else {
              result.hidden = false;
              result.textContent = this.readerProblem(outcome.reason);
            }
          }, { icon: 'book_open_24_regular', key: 'reader' }),
          result,
          guide,
        ),
        actions: [Ui.button('text', t('סגירה'), () => dlg.close()), Ui.button('tonal', t('ממקד את המסמך'), () => { dlg.close(); if (this.frame) this.frame.focus(); }, { disabled: !(s && s.phase === 'ready') })],
        focus: '[data-key="reader"]',
      });
      void app;
    }

    readerProblem(reason) {
      const folder = this.app.files.folder;
      switch (reason) {
        case 'permission':
          return t('הרשאות הקורא של אוצריא כבויות לתוסף. אפשר להפעיל אותן בהרשאות התוסף, או להדפיס מהצפיין.');
        case 'not_indexed':
          return t('אוצריא עדיין לא רואה את הקובץ. הוסיפו את התיקייה {path} בהגדרות אוצריא ← ספרייה ← תיקיות אישיות, ונסו שוב.', { path: folder ? folder.path : '' });
        case 'not_saved':
          return t('כדי לפתוח בקורא של אוצריא יש לשמור את הגיליון קודם (כפתור ההורדה).');
        default:
          return t('הפתיחה בקורא של אוצריא נכשלה.');
      }
    }

    /** שומר קבוע (אם צריך) ופותח בקורא של אוצריא. */
    async openInReader() {
      const { app } = this;
      const item = this.state.item;
      if (!app.files.isDownloaded(item)) {
        const job = await app.queueSave(item);
        const done = job && (await job.done);
        if (!done || done.status !== 'done') return { ok: false, reason: 'not_saved' };
      }
      const outcome = await app.files.openInReader(item);
      if (outcome.ok) app.toast(t('נפתח בקורא של אוצריא'));
      return outcome;
    }
  }

  A.Viewer = Viewer;
  A.PRINT_ROUTES = PRINT_ROUTES;
  if (typeof module === 'object' && module.exports) module.exports = { Viewer, PRINT_ROUTES };
})(typeof self !== 'undefined' ? self : globalThis);
