// רכיבי ממשק משותפים: בניית DOM (טקסט נכנס רק דרך textContent — אין innerHTML
// בכלל, כך שכותרות מהקטלוג לא יכולות להזריק דבר), כפתורים, שבבים, הודעות
// מצבי ריק/טעינה. שכבות על הדף (toast, דיאלוג, תפריט) ב-alonim-ui-overlays.js, וגלילה
// וירטואלית ב-alonim-ui-vlist.js.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const { icon } = A.Icons;

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

  const SVG = 'http://www.w3.org/2000/svg';

  /**
   * איור קבוע למצבי ריק: שני דפי עלון מוטים וצל. הצבעים מגיעים מ-CSS (מחלקות
   * `ill-*`), כך שהוא עוקב אחרי ערכת הנושא; הצורה אינה מתהפכת עם הכיוון.
   */
  function illustration() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 160 110');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'illustration');
    const add = (tag, attributes) => {
      const node = document.createElementNS(SVG, tag);
      for (const [name, value] of Object.entries(attributes))
        node.setAttribute(name, String(value));
      svg.appendChild(node);
    };
    add('ellipse', { cx: 80, cy: 100, rx: 54, ry: 7, class: 'ill-shadow' });
    add('rect', {
      x: 36,
      y: 14,
      width: 62,
      height: 80,
      rx: 6,
      class: 'ill-back',
      transform: 'rotate(-9 67 54)',
    });
    add('rect', { x: 60, y: 10, width: 66, height: 84, rx: 6, class: 'ill-front' });
    add('rect', { x: 70, y: 22, width: 36, height: 7, rx: 3.5, class: 'ill-accent' });
    add('rect', { x: 70, y: 38, width: 46, height: 5, rx: 2.5, class: 'ill-line' });
    add('rect', { x: 70, y: 49, width: 46, height: 5, rx: 2.5, class: 'ill-line' });
    add('rect', { x: 70, y: 60, width: 30, height: 5, rx: 2.5, class: 'ill-line' });
    return svg;
  }

  function stateCard(o) {
    return el(
      'section',
      { class: 'state-card' + (o.error ? ' is-error' : '') + (o.compact ? ' is-compact' : '') },
      el(
        'div',
        { class: 'state-art' },
        illustration(),
        el('div', { class: 'state-icon' }, icon(o.icon || 'info_24_regular', 'icon-lg')),
      ),
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
    illustration,
    progress,
    preserveFocus,
    skeleton,
    icon,
  };
  A.Ui = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
