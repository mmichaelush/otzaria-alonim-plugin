// מצב בחירה מרובה: לחצן המצב בשורת הכלים, ושורת הפעולות שנפתחת כשבוחרים
// גיליונות (הורדה, מועדפים, אוסף, נקרא, הסתרת סדרות, העתקה כטקסט, הדפסה).
// הבחירה עצמה ב-`app.selection`; הפעולות ב-`alonim-bulk.js`.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const I18n = A.I18n;
  const { el } = Ui;
  const t = (text, vars) => I18n.t(text, vars);
  const N = (text) => text;

  /** כמה תוצאות "בחר הכול" בוחר לכל היותר. */
  const SELECT_ALL_CAP = 2000;

  /** לחצן המצב: "בחירה". */
  function modeButton(app) {
    const on = app.selection.on;
    return Ui.button(
      on ? 'tonal' : 'outlined',
      t('בחירה'),
      () => app.setSelecting(!app.selection.on),
      {
        pressed: on,
        icon: on ? 'checkmark_24_regular' : 'checkmark_circle_24_regular',
        className: 'filter-chip',
        key: 'select-mode',
      },
    );
  }

  /** העתקה ללוח עם נפילה ל-execCommand משדה זמני. */
  async function copyToClipboard(text) {
    const area = el('textarea', {
      class: 'offscreen',
      'aria-hidden': 'true',
      tabindex: '-1',
      readonly: true,
    });
    area.value = text;
    document.body.appendChild(area);
    try {
      return await Ui.copyText(text, area);
    } finally {
      area.remove();
    }
  }

  /**
   * חלון הדפסה מרובה: רשימה עם סטטוס, "הדפסה ברצף" ו"הדפס הבא". כל גיליון פותח את מסך ההדפסה של
   * אוצריא, והרצף ממשיך כשהמשתמש מסיים אותו (הדפיס או ביטל).
   */
  function printDialog(app, items) {
    const status = items.map(() => 'pending');
    const LABEL = {
      pending: N('ממתין'),
      printing: N('במסך ההדפסה…'),
      printed: N('הודפס'),
      cancelled: N('בוטל'),
      failed: N('נכשל'),
    };
    const list = el('ul', { class: 'queue-list', 'aria-label': t('הגיליונות להדפסה') });
    const note = el('p', { class: 'setting-help', role: 'status' });
    let running = false;
    const draw = () => {
      Ui.fill(
        list,
        items.map((item, k) =>
          el(
            'li',
            {
              class:
                'queue-row is-' +
                (status[k] === 'printed' ? 'done' : status[k] === 'failed' ? 'failed' : 'queued'),
            },
            el(
              'span',
              { class: 'queue-title', dir: 'auto' },
              [item.seriesTitle || item.title, Core.weekLabel(item)].filter(Boolean).join(' · '),
            ),
            el('span', { class: 'queue-status' }, t(LABEL[status[k]])),
          ),
        ),
      );
    };
    // גיליון שבוטל בדיאלוג אינו חוסם את הבא אחריו: קודם הממתינים והכושלים, ובסוף המבוטלים.
    const nextIndex = () => {
      const open = status.findIndex((s) => s === 'pending' || s === 'failed');
      return open >= 0 ? open : status.findIndex((s) => s === 'cancelled');
    };
    async function run(single) {
      if (running) return;
      const from = nextIndex();
      if (from < 0) return;
      running = true;
      note.textContent = '';
      const result = await A.Bulk.printSequence(
        app,
        items,
        (k, s) => {
          status[k] = s;
          draw();
        },
        { from, single },
      );
      running = false;
      if (result.reason === 'cancelled')
        note.textContent = t('ההדפסה בוטלה. אפשר להמשיך בלחיצה על "הדפס הבא".');
      else if (result.reason === 'gesture')
        note.textContent = t('אוצריא דורשת כאן לחיצה נפרדת לכל גיליון. לחצו על "הדפס הבא" להמשך.');
      else if (result.reason)
        note.textContent = t('ההדפסה נעצרה (קוד: {code}). אפשר לנסות שוב, או להדפיס מהצפיין.', {
          code: result.reason,
        });
      else if (nextIndex() < 0) note.textContent = t('כל הגיליונות נשלחו להדפסה.');
    }
    draw();
    if (items.length) A.Bulk.prefetch(app, items[0]);
    const dlg = Ui.dialog({
      title: t('הדפסת הגיליונות שנבחרו'),
      size: 'small',
      body: el(
        'div',
        {},
        el(
          'p',
          { class: 'dialog-text' },
          t(
            'לכל גיליון נפתח מסך ההדפסה של אוצריא (טווח עמודים, תצוגה מקדימה ופריסה, ובסוף דיאלוג ההדפסה של המערכת). "הדפסה ברצף" ממשיכה לגיליון הבא כשסיימתם את הקודם; ביטלתם אחד — הרצף נעצר וממשיכים ב"הדפס הבא".',
          ),
        ),
        list,
        note,
      ),
      actions: [
        Ui.button('text', t('סגירה'), () => dlg.close()),
        Ui.button('tonal', t('הדפס הבא'), () => run(true), {
          icon: 'document_pdf_24_regular',
          key: 'next',
        }),
        Ui.button('filled', t('הדפסה ברצף'), () => run(false), {
          icon: 'document_pdf_24_regular',
          key: 'all',
        }),
      ],
      focus: '[data-key="all"]',
    });
    return dlg;
  }

  class SelectionBar {
    /** [options]: `count()` — כמה אפשר לבחור כרגע; `all()` — הגיליונות עצמם (התוצאות). */
    constructor(app, options) {
      this.app = app;
      this.all = (options && options.all) || (() => []);
      this.count = (options && options.count) || (() => this.all().length);
      this.el = el('div', {
        class: 'selection-bar',
        role: 'toolbar',
        'aria-label': t('פעולות על הגיליונות שנבחרו'),
        hidden: true,
      });
      this.off = app.on('selection', () => this.update());
      this.update();
    }

    destroy() {
      if (this.off) this.off();
    }

    update() {
      const { app } = this;
      const n = app.selection.ids.size;
      this.el.hidden = !app.selection.on;
      if (!app.selection.on) return;
      const total = this.count();
      const items = () => app.selectedItems();
      const none = n === 0;
      const run = (fn) => () => fn(items());
      const more = Ui.iconButton(
        'more_horizontal_24_regular',
        t('עוד פעולות על הנבחרים'),
        () => {
          Ui.menu(more, [
            {
              label: t('העתקה כטקסט'),
              icon: 'copy_24_regular',
              run: async () => {
                const { text, linked } = await A.Bulk.exportText(app, items());
                const ok = await copyToClipboard(text);
                if (!ok) app.reportFailure('copy_failed');
                else
                  app.toast(
                    linked
                      ? t('הרשימה הועתקה')
                      : t('הרשימה הועתקה, בלי כתובות (יותר מדי גיליונות)'),
                  );
              },
            },
            {
              label: t('סמן כנקראו'),
              icon: 'checkmark_24_regular',
              run: run((list) => A.Bulk.read(app, list, true)),
            },
            {
              label: t('סמן כלא נקראו'),
              icon: 'circle_24_regular',
              run: run((list) => A.Bulk.read(app, list, false)),
            },
            {
              label: t('הסר ממועדפים'),
              icon: 'star_24_regular',
              run: run((list) => A.Bulk.favorite(app, list, false)),
            },
            'sep',
            {
              label: t('הסתר את הסדרות'),
              icon: 'eye_off_24_regular',
              danger: true,
              run: run((list) => A.Bulk.hideSeries(app, list)),
            },
          ]);
        },
        { popup: 'menu', expanded: false, disabled: none },
      );
      Ui.fill(
        this.el,
        Ui.iconButton('dismiss_24_regular', t('יציאה ממצב בחירה'), () => app.setSelecting(false), {
          className: 'selection-close',
        }),
        el(
          'span',
          { class: 'selection-count', 'aria-live': 'polite' },
          t('נבחרו {n}', { n: Core.formatCount(n) }),
        ),
        total && n < total
          ? Ui.button(
              'text',
              t('בחירת כל התוצאות ({n})', { n: Core.formatCount(Math.min(total, SELECT_ALL_CAP)) }),
              () => app.selectMany(this.all().slice(0, SELECT_ALL_CAP), true),
              { className: 'button-small' },
            )
          : null,
        n
          ? Ui.button('text', t('ניקוי הבחירה'), () => app.selectMany(app.selectedItems(), false), {
              className: 'button-small',
            })
          : null,
        el('span', { class: 'filter-spacer' }),
        Ui.button(
          'tonal',
          t('הורדה'),
          run((list) => A.Bulk.download(app, list)),
          { icon: 'arrow_download_24_regular', className: 'button-small', disabled: none },
        ),
        Ui.button(
          'tonal',
          t('למועדפים'),
          run((list) => A.Bulk.favorite(app, list, true)),
          { icon: 'star_24_regular', className: 'button-small', disabled: none },
        ),
        Ui.button(
          'tonal',
          t('לאוסף…'),
          run((list) => app.addToListDialog(list)),
          { icon: 'bookmark_multiple_24_regular', className: 'button-small', disabled: none },
        ),
        A.Bulk.canPrint(app)
          ? Ui.button('tonal', t('הדפסה'), () => printDialog(app, items()), {
              icon: 'document_pdf_24_regular',
              className: 'button-small',
              disabled: none,
            })
          : null,
        more,
      );
    }
  }

  A.Selection = { modeButton, SelectionBar, copyToClipboard, printDialog, SELECT_ALL_CAP };
  if (typeof module === 'object' && module.exports) module.exports = A.Selection;
})(typeof self !== 'undefined' ? self : globalThis);
