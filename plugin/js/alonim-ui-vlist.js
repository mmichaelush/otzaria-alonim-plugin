// גלילה וירטואלית: רשימה שמחזיקה ב-DOM רק את השורות הנראות (לעולם לא יותר מ-60 כרטיסים). נטען אחרי alonim-ui.js.
(function (root) {
  'use strict';

  /** @type {any} */
  const A = root.Alonim;
  const Ui = A.Ui;
  const { el } = Ui;

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
        // מחוץ לקריאה החוזרת של ה-observer: מדידה ופריסה בתוכה גורמות ל"ResizeObserver loop completed
        // with undelivered notifications" (נראה כשגיאת חלון ב-WebView של אוצריא).
        this.observer = new ResizeObserver(() => {
          if (this._resizeFrame) return;
          const run = () => {
            this._resizeFrame = 0;
            this.measure();
            if (this.onResize) this.onResize(this.root.clientWidth, this.emPx);
            this._schedule();
          };
          this._resizeFrame =
            typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (run(), 0);
        });
        this.observer.observe(this.root);
      }
    }

    destroy() {
      if (this.observer) this.observer.disconnect();
      if (this._resizeFrame && typeof cancelAnimationFrame === 'function')
        cancelAnimationFrame(this._resizeFrame);
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

    resetScroll() {
      this.root.scrollTop = 0;
    }
  }

  Object.assign(Ui, { VList });
  if (typeof module === 'object' && module.exports) module.exports = Ui;
})(typeof self !== 'undefined' ? self : globalThis);
