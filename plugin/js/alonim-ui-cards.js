// כרטיס גיליון ושורה צפופה. לחיצה על הגיליון פותחת אותו לקריאה (צפיין פנימי);
// לצידה פעולות ברורות: הורדה (שמירה קבועה) והדפסה. הרכיב אינו מחליט דבר: הוא
// מקבל מצב מ-`app.cardState` ופעולות מ-`app`.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const { highlightSpans } = A.Normalize;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  /** "נח · תשפ"ז · גיליון 21" */
  function metaParts(item) {
    const parts = [];
    const label = Core.weekLabel(item);
    if (label) parts.push(label);
    if (item.hy) parts.push(Core.hyLetters(item.hy));
    if (item.no) parts.push(t('גיליון {no}', { no: item.no }));
    if (!parts.length && item.date) parts.push(Core.dateText(item.date, { short: true }));
    return parts;
  }

  /** כותרת הכרטיס: שם הסדרה, ואם לגיליון כותרת נפרדת — גם היא. */
  function titleOf(item) {
    const series = item.seriesTitle || item.title || '';
    return item.title && item.title !== series && !series.includes(item.title)
      ? series + ' · ' + item.title
      : series;
  }

  function sizeText(item) {
    const asset = item.assets.find((a) => a.bytes) || item.assets[0] || {};
    const pages = item.pages || asset.pages;
    return [pages ? t('{n} עמ׳', { n: pages }) : '', Core.formatBytes(asset.bytes)]
      .filter(Boolean)
      .join(' · ');
  }

  /** שבב לכל מקור (עד 3), כשהמקור במצב `link` או חסום — עם סימון. */
  function sourceChips(app, item, max) {
    const chips = [];
    const list = item.assets.slice(0, max || 3);
    for (const a of list) {
      const info = app.sourceInfo(a.src);
      const limited = a.noUrl || info.mode === 'link' || info.status === 'blocked';
      chips.push(
        Ui.chip(info.name, {
          kind: limited ? 'warn' : 'source',
          icon: limited ? 'open_24_regular' : null,
          title: limited ? t('{name}: קישור לאתר המקור בלבד', { name: info.name }) : info.name,
        }),
      );
    }
    if (item.assets.length > list.length)
      chips.push(Ui.chip('+' + (item.assets.length - list.length), { title: t('עותקים נוספים') }));
    return chips;
  }

  /** כפתור ההורדה: האייקון והפעולה לפי מצב ההורדה. */
  function downloadButton(app, item, state, className) {
    const job = state.job;
    if (state.downloaded) {
      return Ui.iconButton(
        'checkmark_circle_24_filled',
        t('הורד. לחיצה פותחת את הקובץ'),
        () => app.openIssue(item),
        { className: (className || '') + ' is-done' },
      );
    }
    if (job && job.status === 'active') {
      return Ui.iconButton(
        'arrow_download_24_regular',
        t('מוריד… לחיצה מבטלת'),
        () => app.files.cancel(item.id),
        { className: (className || '') + ' is-busy', busy: true },
      );
    }
    if (job && job.status === 'queued') {
      return Ui.iconButton(
        'clock_24_regular',
        t('בתור להורדה. לחיצה מבטלת'),
        () => app.files.cancel(item.id),
        { className: (className || '') + ' is-busy' },
      );
    }
    if (job && job.status === 'failed') {
      return Ui.iconButton(
        'warning_24_regular',
        t('ההורדה נכשלה: לחיצה לפרטים ולניסיון חוזר'),
        () => app.downloadFailed(item),
        { className: (className || '') + ' is-failed' },
      );
    }
    return Ui.iconButton(
      'arrow_download_24_regular',
      t('הורדה (שמירה בתיקייה)'),
      () => app.download(item),
      { className },
    );
  }

  function overflowMenu(app, item, state, ctx) {
    const btn = Ui.iconButton(
      'more_horizontal_24_regular',
      t('עוד פעולות'),
      () => {
        const items = [
          {
            label: t('פרטי הגיליון'),
            icon: 'info_24_regular',
            run: () => app.showDetails(item, ctx),
          },
          {
            label: state.read ? t('סמן כלא נקרא') : t('סמן כנקרא'),
            icon: 'checkmark_24_regular',
            run: () => app.toggleRead(item),
          },
          {
            label: t('הוסף לאוסף…'),
            icon: 'bookmark_multiple_24_regular',
            run: () => app.addToListDialog(item),
          },
          'sep',
          {
            label: state.followed ? t('הפסק לעקוב אחרי הסדרה') : t('עקוב אחרי הסדרה'),
            icon: 'alert_24_regular',
            run: () => app.toggleFollow(item.series),
          },
          { label: t('פתח באתר המקור'), icon: 'open_24_regular', run: () => app.openSiteFor(item) },
          {
            label: t('הסתר סדרה זו'),
            icon: 'eye_off_24_regular',
            danger: true,
            run: () => app.hideSeries(item),
          },
        ];
        Ui.menu(btn, items);
      },
      { popup: 'menu', expanded: false },
    );
    return btn;
  }

  /**
   * [o]: `{ mode: 'card'|'row', tokens, reason, ctx, index, total }`. `ctx` הוא
   * הקשר הרשימה (לצפיין: הקודם/הבא).
   */
  function render(app, item, o) {
    const opts = o || {};
    const state = app.cardState(item);
    const mode = opts.mode === 'row' ? 'row' : 'card';
    // בדף סדרה שם הסדרה חוזר בכל שורה: הכותרת היא השבוע, והמשנה — השנה והמספר.
    const title = opts.inSeries
      ? Core.weekLabel(item) ||
        (item.date ? Core.dateText(item.date, { short: true }) : '') ||
        titleOf(item)
      : titleOf(item);
    const meta = opts.inSeries
      ? [item.hy ? Core.hyLetters(item.hy) : '', item.no ? t('גיליון {no}', { no: item.no }) : '']
          .filter(Boolean)
          .join(' · ')
      : metaParts(item).join(' · ');
    const tokens = opts.tokens || [];
    const titleNode = el(
      'h3',
      { class: 'card-title', dir: 'auto' },
      Ui.marked(title, highlightSpans(title, tokens)),
    );
    const metaNode = el(
      'p',
      { class: 'card-meta', dir: 'auto' },
      Ui.marked(meta, highlightSpans(meta, tokens)),
    );

    const star = Ui.iconButton(
      state.favorite ? 'star_24_filled' : 'star_24_regular',
      state.favorite ? t('הסר ממועדפים') : t('הוסף למועדפים'),
      () => app.toggleFavorite(item),
      { pressed: state.favorite, className: 'star-button' },
    );
    const menuBtn = overflowMenu(app, item, state, opts.ctx);
    // באוסף: הסרה מהרשימה. בשאר המקומות אין.
    const removeBtn = opts.onRemove
      ? Ui.iconButton(
          'dismiss_24_regular',
          opts.removeLabel || t('הסר מהרשימה'),
          () => opts.onRemove(item),
          { className: 'remove-button' },
        )
      : null;
    const dl = downloadButton(app, item, state);
    const print = Ui.iconButton('document_pdf_24_regular', t('הדפסה'), () =>
      app.print(item, opts.ctx),
    );

    // לפי חשיבות: מה שנחתך בקצה השורה הוא המקורות, לא המצב.
    const chips = [];
    if (opts.reason) chips.push(Ui.chip(opts.reason, { kind: 'reason' }));
    if (state.isNew) chips.push(Ui.chip(t('חדש'), { kind: 'new' }));
    if (state.downloaded)
      chips.push(Ui.chip(t('הורד'), { kind: 'done', icon: 'checkmark_24_regular' }));
    if (state.hidden)
      chips.push(
        Ui.chip(t('מוסתר'), {
          kind: 'hidden',
          icon: 'eye_off_24_regular',
          title: state.hiddenReason,
        }),
      );
    if (item.lang && (item.lang !== 'he' || opts.showLang))
      chips.push(Ui.chip(Core.langName(item.lang), { kind: 'lang' }));
    chips.push(...sourceChips(app, item, 2));
    const size = sizeText(item);

    const selecting = app.selection.on && !opts.noSelect;
    const selected = selecting && app.isSelected(item.id);
    const check = selecting
      ? el(
          'button',
          {
            type: 'button',
            class: 'select-check',
            role: 'checkbox',
            'aria-checked': String(selected),
            'aria-label': t('בחירה: {name}', { name: title }),
            onclick: (event) => {
              event.stopPropagation();
              app.toggleSelected(item);
            },
          },
          icon(selected ? 'checkmark_circle_24_filled' : 'circle_24_regular'),
        )
      : null;
    const open = () => (selecting ? app.toggleSelected(item) : app.openIssue(item, opts.ctx));
    const attrs = {
      class:
        'card is-' +
        mode +
        (state.read ? ' is-read' : ' is-unread') +
        (state.hidden ? ' is-hidden' : '') +
        (selecting ? ' is-selecting' : '') +
        (selected ? ' is-selected' : ''),
      role: 'listitem',
      // מיקוד "נודד": פריט אחד ברשימה נגיש ב-Tab, והחצים מעבירים בין הפריטים.
      tabindex: opts.index === (opts.active || 0) ? '0' : '-1',
      'aria-label': title + (meta ? ', ' + meta : ''),
      'aria-setsize': opts.total || null,
      'aria-posinset': opts.index === undefined ? null : opts.index + 1,
      dataset: { item: String(opts.index === undefined ? 0 : opts.index), id: item.id },
      onclick: (event) => {
        if (event.target.closest('button, a, .menu')) return;
        open();
      },
      onkeydown: (event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || (selecting && event.key === ' ')) {
          event.preventDefault();
          open();
        } else if (Core.keyIs(event, 'd')) app.download(item);
        else if (Core.keyIs(event, 's') || Core.keyIs(event, 'f')) app.toggleFavorite(item);
        else if (Core.keyIs(event, 'p')) app.print(item, opts.ctx);
        else if (Core.keyIs(event, 'i')) app.showDetails(item, opts.ctx);
      },
    };

    if (mode === 'row') {
      return el(
        'article',
        attrs,
        check,
        el('span', { class: 'unread-dot', 'aria-hidden': 'true' }),
        el('div', { class: 'row-main' }, titleNode, metaNode),
        el('div', { class: 'card-chips' }, el('span', { class: 'chip-row' }, chips)),
        el('span', { class: 'card-size' }, size),
        el('div', { class: 'row-actions' }, star, dl, print, menuBtn, removeBtn),
      );
    }
    return el(
      'article',
      attrs,
      el(
        'div',
        { class: 'card-main' },
        el(
          'div',
          { class: 'card-top' },
          check,
          el('span', { class: 'unread-dot', 'aria-hidden': 'true' }),
          titleNode,
          el('div', { class: 'card-tools' }, star, menuBtn, removeBtn),
        ),
        metaNode,
        el(
          'div',
          { class: 'card-chips' },
          el('span', { class: 'chip-row' }, chips),
          size ? el('span', { class: 'card-size' }, size) : null,
        ),
        el(
          'div',
          { class: 'card-actions' },
          Ui.button('tonal', t('קריאה'), open, {
            icon: 'book_open_24_regular',
            className: 'button-small',
          }),
          dl,
          print,
        ),
      ),
    );
  }

  /** עמודות בגריד הכרטיסים לפי הרוחב (בפיקסלים) וגודל ה-em. */
  function columnsFor(widthPx, emPx, mode) {
    if (mode === 'row') return 1;
    const min = 19 * emPx;
    return Math.max(1, Math.min(4, Math.floor((widthPx + emPx) / (min + emPx))));
  }

  /** גובה שורה ב-em: כרטיס, או שורה צפופה. */
  const ROW_EM = Object.freeze({ card: 10.6, row: 4.4, gap: 0.75 });

  /**
   * מקשי חצים ברשימה וירטואלית: חץ אחד פריט (RTL: ימין = הקודם), מעלה/מטה
   * שורה, PageUp/Down, Home/End. אחרי כל תנועה השורה נגללת לתצוגה והפריט מקבל
   * מיקוד (שורות ממוחזרות, ולכן המיקוד נקבע אחרי הציור).
   */
  function attachListKeys(list, getLayout) {
    list.root.addEventListener('keydown', (event) => {
      const target = event.target.closest('[data-item]');
      if (!target || event.target !== target) return;
      const { count, perRow } = getLayout();
      const current = Number(target.dataset.item);
      const rtl = document.documentElement.dir !== 'ltr';
      const page =
        Math.max(1, Math.floor(list.root.clientHeight / (list._heightOf(0) || 100)) - 1) * perRow;
      let next = null;
      switch (event.key) {
        case 'ArrowRight':
          next = current + (rtl ? -1 : 1);
          break;
        case 'ArrowLeft':
          next = current + (rtl ? 1 : -1);
          break;
        case 'ArrowDown':
          next = current + perRow;
          break;
        case 'ArrowUp':
          next = current - perRow;
          break;
        case 'PageDown':
          next = current + page;
          break;
        case 'PageUp':
          next = current - page;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = count - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      focusItem(list, Math.max(0, Math.min(count - 1, next)), perRow);
    });
  }

  function focusItem(list, index, perRow) {
    // רשימה עם כותרות קבוצה מספקת מיפוי משלה מפריט לשורה.
    list.scrollToRow(list.rowForItem ? list.rowForItem(index) : Math.floor(index / perRow));
    const node = list.inner.querySelector('[data-item="' + index + '"]');
    if (node) {
      list.inner
        .querySelectorAll('[data-item][tabindex="0"]')
        .forEach((n) => n.setAttribute('tabindex', '-1'));
      node.setAttribute('tabindex', '0');
      node.focus();
    }
  }

  const api = {
    render,
    metaParts,
    titleOf,
    sizeText,
    columnsFor,
    ROW_EM,
    attachListKeys,
    focusItem,
    downloadButton,
    sourceChips,
  };
  A.Cards = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
