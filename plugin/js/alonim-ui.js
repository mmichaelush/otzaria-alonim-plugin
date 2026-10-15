// רכיבי ממשק משותפים: בניית DOM (טקסט נכנס רק דרך textContent — אין innerHTML
// בכלל, כך שכותרות מהקטלוג לא יכולות להזריק דבר), כפתורים, שבבים, הודעות
// (toast), דיאלוג, תפריט, מצבי ריק/טעינה, וגלילה וירטואלית.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const I18n = A.I18n;
  const { icon } = A.Icons;
  const t = (text, vars) => I18n.t(text, vars);

  /** `el('p', {class: 'x', onclick}, 'טקסט', child)`. ערך שקר מדלג על התכונה. */
  function el(tag, attributes, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (name === 'class') node.className = value;
      else if (name === 'dataset') Object.assign(node.dataset, value);
      else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? '' : String(value));
    }
    append(node, children);
    return node;
  }

  /** רשימות מקוננות נפרשות: כך פונקציה יכולה להחזיר כמה צמתים. */
  function append(node, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(
        typeof child === 'string' || typeof child === 'number'
          ? document.createTextNode(String(child))
          : child,
      );
    }
    return node;
  }

  /**
   * `replaceChildren` שמדלג על null/false (ה-DOM היה כותב "null" כטקסט) ופורס
   * רשימות מקוננות.
   */
  function fill(node, ...children) {
    const nodes = [];
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      nodes.push(
        typeof child === 'string' || typeof child === 'number'
          ? document.createTextNode(String(child))
          : child,
      );
    }
    node.replaceChildren(...nodes);
    return node;
  }

  function button(kind, label, onClick, options) {
    const o = options || {};
    return el(
      'button',
      {
        type: 'button',
        class: 'button button-' + kind + (o.className ? ' ' + o.className : ''),
        onclick: onClick,
        disabled: o.disabled || o.busy,
        title: o.title,
        'aria-busy': o.busy ? 'true' : null,
        'aria-label': o.ariaLabel,
        'aria-pressed': o.pressed === undefined ? null : String(Boolean(o.pressed)),
        dataset: o.key ? { key: o.key } : undefined,
      },
      o.busy
        ? el('span', { class: 'spinner', 'aria-hidden': 'true' })
        : o.icon
          ? icon(o.icon)
          : null,
      o.busy && o.busyLabel ? o.busyLabel : label,
    );
  }

  /** כפתור אייקון: תווית נגישה וחובה (נבדק ב-ui-contract.test.js). */
  function iconButton(iconName, label, onClick, options) {
    const o = options || {};
    return el(
      'button',
      {
        type: 'button',
        class: 'icon-button' + (o.className ? ' ' + o.className : ''),
        'aria-label': label,
        title: o.title || label,
        'aria-pressed': o.pressed === undefined ? null : String(Boolean(o.pressed)),
        'aria-expanded': o.expanded === undefined ? null : String(Boolean(o.expanded)),
        'aria-haspopup': o.popup || null,
        disabled: o.disabled,
        onclick: onClick,
        dataset: o.key ? { key: o.key } : undefined,
      },
      o.busy ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon(iconName),
    );
  }

  function chip(text, options) {
    const o = options || {};
    return el(
      'span',
      { class: 'chip' + (o.kind ? ' chip-' + o.kind : ''), title: o.title, dir: o.dir },
      o.icon ? icon(o.icon) : null,
      el('span', { class: 'chip-text' }, text),
    );
  }

  /**
   * מעתיק טקסט ללוח. אם `navigator.clipboard` חסום (ב-WebView של אוצריא לפעמים),
   * נופל ל-`execCommand('copy')` מתוך [fallbackEl] (שדה טקסט גלוי). `true` בהצלחה.
   */
  async function copyText(text, fallbackEl) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      try {
        fallbackEl.focus();
        fallbackEl.select();
        return document.execCommand('copy');
      } catch (inner) {
        return false;
      }
    }
  }

  /** `<select>` קטן עם תווית נגישה. [options]: `{ value, label }`. */
  function selectField(label, options, value, onChange, className) {
    return el(
      'select',
      {
        class: 'select ' + (className || ''),
        'aria-label': label,
        onchange: (e) => onChange(e.target.value),
      },
      options.map((o) =>
        el('option', { value: o.value, selected: String(o.value) === String(value) }, o.label),
      ),
    );
  }

  /** טקסט עם הדגשת התאמות (`mark`), לפי מיקומים מ-`highlightSpans`. */
  function marked(text, spans) {
    const frag = document.createDocumentFragment();
    if (!spans || !spans.length) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    let at = 0;
    for (const [start, end] of spans) {
      if (start > at) frag.appendChild(document.createTextNode(text.slice(at, start)));
      frag.appendChild(el('mark', { class: 'hit' }, text.slice(start, end)));
      at = end;
    }
    if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
    return frag;
  }

  function stateCard(o) {
    return el(
      'section',
      { class: 'state-card' + (o.error ? ' is-error' : '') + (o.compact ? ' is-compact' : '') },
      el('div', { class: 'state-icon' }, icon(o.icon || 'info_24_regular', 'icon-lg')),
      el('h2', { class: 'state-title' }, o.title),
      ...(Array.isArray(o.text) ? o.text : [o.text])
        .filter(Boolean)
        .map((line) => el('p', { class: 'state-text' }, line)),
      o.steps && o.steps.length
        ? el(
            'ol',
            { class: 'state-steps' },
            o.steps.map((s) => el('li', {}, s)),
          )
        : null,
      o.actions && o.actions.length ? el('div', { class: 'state-actions' }, o.actions) : null,
      o.note ? el('p', { class: 'state-note' }, o.note) : null,
    );
  }

  /** מחלקות יציבות של כפתור (בלי מצב), כדי למצוא אותו אחרי בנייה מחדש. */
  const stableClass = (node) =>
    String(node.className)
      .split(/\s+/)
      .filter((c) => c && !c.startsWith('is-'))
      .join(' ');

  /**
   * מריץ [fn] שבונה מחדש את תוכן [container], ומחזיר את המיקוד לאלמנט המקביל
   * (אותו כרטיס, אותו כפתור) — בלי זה כל רענון מפיל את המיקוד ל-body.
   */
  function preserveFocus(container, fn) {
    const active = document.activeElement;
    let key = null;
    if (active && active !== document.body && container.contains(active)) {
      const card = /** @type {HTMLElement|null} */ (active.closest('[data-id]'));
      key = {
        id: card ? card.dataset.id : null,
        label: active.getAttribute('aria-label') || '',
        cls: stableClass(active),
        tag: active.tagName,
        isCard: active === card,
      };
    }
    fn();
    if (!key) return;
    const scopes = key.id
      ? [...container.querySelectorAll('[data-id]')].filter((n) => n.dataset.id === key.id)
      : [container];
    for (const scope of scopes) {
      if (key.isCard) {
        scope.focus({ preventScroll: true });
        return;
      }
      const match =
        [...scope.querySelectorAll(key.tag.toLowerCase())].find(
          (n) => n.getAttribute('aria-label') === key.label,
        ) ||
        [...scope.querySelectorAll(key.tag.toLowerCase())].find((n) => stableClass(n) === key.cls);
      if (match && !match.disabled) {
        match.focus({ preventScroll: true });
        return;
      }
    }
  }

  /** סרגל התקדמות. הרוחב נקבע דרך CSSOM (תכונת style בתגית עלולה להיחסם ב-CSP). */
  function progress(percent, label, max, now) {
    const bar = el('div', { class: 'progress-bar' });
    bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
    return el(
      'div',
      {
        class: 'progress',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': String(max === undefined ? 100 : max),
        'aria-valuenow': String(now === undefined ? Math.round(percent) : now),
        'aria-label': label,
      },
      bar,
    );
  }

  /** שלד טעינה: כרטיסים אפורים מהבהבים בזמן סנכרון ראשון. */
  function skeleton(count, mode) {
    const wrap = el('div', {
      class: 'skeleton-list' + (mode === 'row' ? ' is-rows' : ''),
      'aria-hidden': 'true',
    });
    for (let i = 0; i < count; i++) {
      wrap.appendChild(
        el(
          'div',
          { class: 'skeleton-card' },
          el('span', { class: 'skeleton-line is-title' }),
          el('span', { class: 'skeleton-line is-meta' }),
          el('span', { class: 'skeleton-line is-chips' }),
        ),
      );
    }
    return wrap;
  }

  // ----------------------------------------------------------- הודעות

  /** הודעות קצרות בתחתית, בלי חלון קופץ. כפתור פעולה (Undo) אופציונלי. */
  class Toasts {
    constructor(host, live) {
      this.host = host;
      this.live = live;
      this.timer = null;
      this.current = null;
    }

    show(message, options) {
      const o = options || {};
      this.dismiss();
      const node = el(
        'div',
        { class: 'toast' + (o.error ? ' is-error' : ''), role: o.error ? 'alert' : 'status' },
        icon(o.error ? 'warning_24_regular' : 'checkmark_circle_24_regular'),
        el('span', { class: 'toast-text' }, message),
        o.action
          ? el(
              'button',
              {
                type: 'button',
                class: 'toast-action',
                onclick: () => {
                  this.dismiss();
                  o.action.run();
                },
              },
              o.action.label,
            )
          : null,
        iconButton('dismiss_24_regular', t('סגירה'), () => this.dismiss(), {
          className: 'toast-close',
        }),
      );
      this.host.appendChild(node);
      this.current = node;
      if (this.live) this.live.announce(message);
      const ms = o.duration || (o.action ? 8000 : 5000);
      const arm = () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.dismiss(node), ms);
      };
      arm();
      node.addEventListener('pointerenter', () => clearTimeout(this.timer));
      node.addEventListener('pointerleave', arm);
      node.addEventListener('focusin', () => clearTimeout(this.timer));
    }

    dismiss(node) {
      const target = node || this.current;
      if (!target) return;
      clearTimeout(this.timer);
      target.classList.add('is-leaving');
      const remove = () => target.remove();
      setTimeout(remove, 180);
      if (this.current === target) this.current = null;
    }
  }

  /** אזור הכרזה לקורא מסך: אזור שנוצר זה עתה אינו מוכרז, ולכן הוא קבוע. */
  class Announcer {
    constructor(node) {
      this.node = node;
    }

    announce(text) {
      if (!this.node) return;
      this.node.textContent = '';
      setTimeout(() => {
        this.node.textContent = text;
      }, 50);
    }
  }

  // ---------------------------------------------------------- דיאלוג

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** מחסנית הדיאלוגים הפתוחים: Esc סוגר את העליון. */
  const openDialogs = [];

  /**
   * דיאלוג מודאלי (`role=dialog`): מלכודת מיקוד, Esc וחזרת מיקוד. על מסך צר
   * הוא נפתח כגיליון מלמטה. [shell] מושבת (`inert`) כל עוד הוא פתוח.
   */
  function dialog(options) {
    const o = options || {};
    const opener = /** @type {HTMLElement|null} */ (document.activeElement);
    const shell = /** @type {HTMLElement|null} */ (document.querySelector('.app-shell'));
    const titleId = 'dlg-' + Math.random().toString(36).slice(2, 8);
    const closeButton = iconButton('dismiss_24_regular', t('סגירה'), () => api.close(), {
      className: 'dialog-close',
    });
    const body = el('div', { class: 'dialog-body' }, o.body);
    const panel = el(
      'section',
      {
        class: 'dialog' + (o.size ? ' is-' + o.size : ''),
        role: o.alert ? 'alertdialog' : 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      el(
        'header',
        { class: 'dialog-head' },
        el('h2', { class: 'dialog-title', id: titleId, dir: 'auto' }, o.title),
        closeButton,
      ),
      body,
      o.actions && o.actions.length ? el('footer', { class: 'dialog-actions' }, o.actions) : null,
    );
    const scrim = el('div', { class: 'dialog-scrim' });
    const layer = el('div', { class: 'dialog-layer' }, scrim, panel);
    const api = {
      el: panel,
      body,
      layer,
      closed: false,
      close(reason) {
        if (api.closed) return;
        api.closed = true;
        const index = openDialogs.indexOf(api);
        if (index >= 0) openDialogs.splice(index, 1);
        layer.classList.add('is-leaving');
        setTimeout(() => layer.remove(), 160);
        if (!openDialogs.length && shell) shell.inert = false;
        if (opener && typeof opener.focus === 'function' && document.contains(opener))
          opener.focus();
        if (o.onClose) o.onClose(reason);
      },
    };
    scrim.addEventListener('click', () => api.close('scrim'));
    layer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        api.close('escape');
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    document.body.appendChild(layer);
    if (shell) shell.inert = true;
    openDialogs.push(api);
    requestAnimationFrame(() => {
      const target =
        (o.focus && panel.querySelector(o.focus)) ||
        panel.querySelector('[data-autofocus]') ||
        panel.querySelector(FOCUSABLE);
      if (target) target.focus();
    });
    return api;
  }

  const topDialog = () => openDialogs[openDialogs.length - 1] || null;

  /** אישור בתוך הדף (ל-`confirm` אין חלון בפריסה של אוצריא). */
  function confirmDialog({ title, text, confirmLabel, danger, onConfirm }) {
    const dlg = dialog({
      title,
      size: 'small',
      alert: true,
      body: el('p', { class: 'dialog-text' }, text),
      actions: [
        button('text', t('ביטול'), () => dlg.close('cancel')),
        button(
          danger ? 'danger' : 'filled',
          confirmLabel || t('אישור'),
          () => {
            dlg.close('confirm');
            onConfirm();
          },
          { className: '', key: 'confirm' },
        ),
      ],
    });
    return dlg;
  }

  // ----------------------------------------------------------- תפריט

  let openMenu = null;

  /**
   * תפריט צף ליד כפתור: חצים, Enter, Esc, וסגירה בלחיצה בחוץ. [items]:
   * `{ label, icon, run, danger, checked, disabled }` או `'sep'`.
   */
  function menu(anchor, items) {
    closeMenu();
    const list = el('div', { class: 'menu', role: 'menu' });
    const buttons = [];
    for (const item of items) {
      if (item === 'sep') {
        list.appendChild(el('div', { class: 'menu-sep', role: 'separator' }));
        continue;
      }
      const b = el(
        'button',
        {
          type: 'button',
          class: 'menu-item' + (item.danger ? ' is-danger' : ''),
          role: item.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
          'aria-checked': item.checked === undefined ? null : String(Boolean(item.checked)),
          disabled: item.disabled,
          tabindex: '-1',
          onclick: () => {
            closeMenu(true);
            item.run();
          },
        },
        item.icon ? icon(item.icon) : el('span', { class: 'menu-gap' }),
        el('span', { class: 'menu-label' }, item.label),
        item.checked ? icon('checkmark_24_regular', 'menu-check') : null,
      );
      buttons.push(b);
      list.appendChild(b);
    }
    document.body.appendChild(list);
    const rect = anchor.getBoundingClientRect();
    const width = list.offsetWidth;
    const rtl = document.documentElement.dir !== 'ltr';
    let left = rtl ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 4;
    if (top + list.offsetHeight > window.innerHeight - 8)
      top = Math.max(8, rect.top - list.offsetHeight - 4);
    list.style.left = left + 'px';
    list.style.top = top + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    const enabled = () => buttons.filter((b) => !b.disabled);
    const focusAt = (i) => {
      const e = enabled();
      if (e.length) e[(i + e.length) % e.length].focus();
    };
    list.addEventListener('keydown', (event) => {
      const e = enabled();
      const index = e.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') (event.preventDefault(), focusAt(index + 1));
      else if (event.key === 'ArrowUp') (event.preventDefault(), focusAt(index - 1));
      else if (event.key === 'Home') (event.preventDefault(), focusAt(0));
      else if (event.key === 'End') (event.preventDefault(), focusAt(-1));
      else if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      }
    });
    const outside = (event) => {
      if (!list.contains(event.target) && event.target !== anchor) closeMenu(false);
    };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    openMenu = { list, anchor, outside };
    focusAt(0);
    return list;
  }

  function closeMenu(restoreFocus) {
    if (!openMenu) return;
    const { list, anchor, outside } = openMenu;
    openMenu = null;
    document.removeEventListener('pointerdown', outside, true);
    list.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus && document.contains(anchor)) anchor.focus();
  }

  // -------------------------------------------------- גלילה וירטואלית

  /**
   * רשימה וירטואלית: רק השורות הנראות (ועוד מעט) ב-DOM, כך שגם 30,000 תוצאות
   * אינן מחזיקות יותר מ-`maxItems` צמתי פריט. כל שורה בגובה קבוע (ב-em, כדי
   * ש"גודל תצוגה" ישנה אותו): הבעלים קובע מה בשורה ([render]) ואת מספר העמודות.
   *
   *   list.configure({ count, heightEm: n | (row) => n, render(row, rowEl), itemsPerRow })
   */
  class VList {
    constructor(options) {
      const o = options || {};
      this.maxItems = o.maxItems || 60;
      this.root = el('div', {
        class: 'vlist ' + (o.className || ''),
        role: 'list',
        'aria-label': o.label || null,
        tabindex: '-1',
      });
      this.inner = el('div', { class: 'vlist-inner' });
      this.root.appendChild(this.inner);
      this.rows = new Map();
      this.count = 0;
      /** @type {number | ((row: number) => number)} */
      this.heightEm = 4;
      /** @type {(row: number, node: HTMLElement) => void} */
      this.render = () => {};
      this.itemsPerRow = 1;
      this.offsets = null;
      this.rowPx = 0;
      this.emPx = 16;
      this.scheduled = false;
      this.onResize = null;
      this.root.addEventListener('scroll', () => this._schedule(), { passive: true });
      if (typeof ResizeObserver === 'function') {
        this.observer = new ResizeObserver(() => {
          this.measure();
          if (this.onResize) this.onResize(this.root.clientWidth, this.emPx);
          this._schedule();
        });
        this.observer.observe(this.root);
      }
    }

    destroy() {
      if (this.observer) this.observer.disconnect();
    }

    /** גודל ה-em בפיקסלים: משתנה עם "גודל תצוגה". */
    measure() {
      const size = parseFloat(getComputedStyle(this.root).fontSize);
      if (size > 0) this.emPx = size;
      this._layout();
    }

    configure(o) {
      this.count = o.count;
      this.heightEm = o.heightEm;
      this.render = o.render;
      this.itemsPerRow = o.itemsPerRow || 1;
      this.rows.forEach((node) => node.remove());
      this.rows.clear();
      this._layout();
      this._schedule();
    }

    /** גובה שורה בפיקסלים, וסכומים מצטברים כשהגבהים שונים. */
    _layout() {
      if (typeof this.heightEm === 'function') {
        this.offsets = new Float64Array(this.count + 1);
        for (let r = 0; r < this.count; r++)
          this.offsets[r + 1] = this.offsets[r] + this.heightEm(r) * this.emPx;
        this.inner.style.height = this.offsets[this.count] + 'px';
      } else {
        this.offsets = null;
        this.rowPx = this.heightEm * this.emPx;
        this.inner.style.height = this.count * this.rowPx + 'px';
      }
    }

    _top(r) {
      return this.offsets ? this.offsets[r] : r * this.rowPx;
    }

    _heightOf(r) {
      return this.offsets ? this.offsets[r + 1] - this.offsets[r] : this.rowPx;
    }

    _rowAt(y) {
      if (!this.offsets)
        return Math.min(this.count - 1, Math.max(0, Math.floor(y / (this.rowPx || 1))));
      let lo = 0;
      let hi = this.count - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (this.offsets[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }

    _schedule() {
      if (this.scheduled) return;
      this.scheduled = true;
      requestAnimationFrame(() => {
        this.scheduled = false;
        this.update();
      });
    }

    /** מצייר את השורות הנראות. */
    update() {
      if (!this.count) {
        this.rows.forEach((node) => node.remove());
        this.rows.clear();
        return;
      }
      const viewTop = this.root.scrollTop;
      const viewHeight = this.root.clientHeight || 600;
      const first = this._rowAt(viewTop);
      const last = this._rowAt(viewTop + viewHeight);
      const visibleItems = (last - first + 1) * this.itemsPerRow;
      // רזרבה מעל ומתחת לגלילה חלקה, בלי לחרוג מתקרת הפריטים.
      const spareRows = Math.max(
        0,
        Math.min(2, Math.floor((this.maxItems - visibleItems) / (2 * this.itemsPerRow))),
      );
      const from = Math.max(0, first - spareRows);
      const to = Math.min(this.count - 1, last + spareRows);
      for (const [r, node] of this.rows) {
        if (r < from || r > to) {
          node.remove();
          this.rows.delete(r);
        }
      }
      for (let r = from; r <= to; r++) {
        if (this.rows.has(r)) continue;
        const node = el('div', { class: 'vrow', role: 'presentation' });
        node.style.top = this._top(r) + 'px';
        node.style.height = this._heightOf(r) + 'px';
        this.render(r, node);
        this.inner.appendChild(node);
        this.rows.set(r, node);
      }
    }

    /** מצייר מחדש את השורות הנראות (מצב פריט השתנה). */
    refreshVisible() {
      for (const [r, node] of this.rows) {
        node.replaceChildren();
        this.render(r, node);
      }
    }

    scrollToRow(r) {
      if (!this.count) return;
      const row = Math.max(0, Math.min(this.count - 1, r));
      const top = this._top(row);
      const bottom = top + this._heightOf(row);
      if (top < this.root.scrollTop) this.root.scrollTop = top;
      else if (bottom > this.root.scrollTop + this.root.clientHeight)
        this.root.scrollTop = bottom - this.root.clientHeight;
      this.update();
    }

    /** כמה צמתי פריט (`[data-item]`) מצויים עכשיו ב-DOM: לבדיקת הגלילה. */
    get domItems() {
      return this.inner.querySelectorAll('[data-item]').length;
    }

    resetScroll() {
      this.root.scrollTop = 0;
    }
  }

  const api = {
    el,
    append,
    fill,
    button,
    iconButton,
    chip,
    selectField,
    copyText,
    marked,
    stateCard,
    progress,
    preserveFocus,
    skeleton,
    Toasts,
    Announcer,
    dialog,
    topDialog,
    confirmDialog,
    menu,
    closeMenu,
    VList,
    icon,
    FOCUSABLE,
  };
  A.Ui = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
