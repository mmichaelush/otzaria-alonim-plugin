// שכבות על הדף: הודעות (toast), הכרזות לקורא מסך, דיאלוג מודאלי, אישור ותפריט. נטען אחרי alonim-ui.js.
(function (root) {
  'use strict';

  /** @type {any} */
  const A = root.Alonim;
  const Ui = A.Ui;
  const I18n = A.I18n;
  const { el, button, iconButton, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

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

  Object.assign(Ui, {
    Toasts,
    Announcer,
    dialog,
    topDialog,
    confirmDialog,
    menu,
    closeMenu,
    FOCUSABLE,
  });
  if (typeof module === 'object' && module.exports) module.exports = Ui;
})(typeof self !== 'undefined' ? self : globalThis);
