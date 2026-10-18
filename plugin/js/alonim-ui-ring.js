// הגלגל: טבעת SVG של כל תחנות השנה (פרשות ומועדים) לפי סדר השנה, כגרף עמודות רדיאלי:
// אורך העמודה הוא מספר הגיליונות (כל השנים). כל תחנה היא כפתור אמיתי (`role="button"`, שם
// נגיש עם הספירה); מקלדת: חצים (לפי כיוון הדף), Home/End, Enter/רווח. הצבעים מגיעים מ-CSS
// (מחלקות `ring-*`), ולכן הגלגל עוקב אחרי ערכת הנושא. כיוון: בעברית מתקדם נגד כיוון השעון,
// כך שהשנה נפתחת למעלה ונעה שמאלה (כמו קריאה ימין-שמאל), ובשפות שמאל-לימין עם כיוון השעון.
// ה-SVG נבנה ב-createElementNS, בלי innerHTML. מסך ה"מעגל" מציג אותו רק ברוחב נוח (מ-50em) (ב-CSS);
// ברשימה האריחים שלידו כל הפעולות זמינות, והגלגל הוא תצוגה כוללת וניווט משלים.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const { el } = A.Ui;

  const SVG = 'http://www.w3.org/2000/svg';
  const SIZE = 400;
  const C = SIZE / 2;
  const R_BASE = 98;
  const R_MIN = 16;
  const R_SPAN = 76;
  const R_HIT = 196;
  /** רווח נוסף (ביחידות של תחנה) בין חלקי השנה. */
  const SECTION_GAP = 0.6;
  /** רווח זוויתי בין עמודות (מעלות). */
  const GAP_DEG = 0.7;

  function svg(tag, attributes) {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes || {}))
      if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    return node;
  }

  const fixed = (n) => (Math.round(n * 100) / 100).toString();

  /**
   * גזרת טבעת בין רדיוסים [r0, r1] וזוויות [a0, a1] (מעלות מלמעלה; הכיוון הוא כיוון הזוויות:
   * עולה = עם כיוון השעון).
   */
  function sector(r0, r1, a0, a1) {
    const point = (r, a) => {
      const rad = (a * Math.PI) / 180;
      return fixed(C + r * Math.sin(rad)) + ' ' + fixed(C - r * Math.cos(rad));
    };
    const sweep = a1 > a0 ? 1 : 0;
    return [
      'M',
      point(r1, a0),
      'A',
      r1,
      r1,
      0,
      0,
      sweep,
      point(r1, a1),
      'L',
      point(r0, a1),
      'A',
      r0,
      r0,
      0,
      0,
      1 - sweep,
      point(r0, a0),
      'Z',
    ].join(' ');
  }

  /**
   * [o]: `stations` (מ-`Cycle.order`), `info(station)` → `{ name, count, detail, label }`,
   * `onOpen(key)`, `onActive(key|null)`, `current` (Set של מפתחות השבוע), `max` (הספירה הגדולה).
   * מחזיר `{ el, setActive(key), focusKey(key), destroy() }`.
   */
  function build(o) {
    const rtl = document.documentElement.dir !== 'ltr';
    const dir = rtl ? -1 : 1;
    const stations = o.stations;
    let gaps = 0;
    const gapBefore = stations.map((s, k) => {
      if (k && s.section !== stations[k - 1].section) gaps++;
      return gaps;
    });
    const slot = 360 / (stations.length + gaps * SECTION_GAP);
    const max = Math.max(1, o.max || 1);

    const root = svg('svg', {
      class: 'ring-svg',
      viewBox: '0 0 ' + SIZE + ' ' + SIZE,
      role: 'group',
      'aria-label': o.label,
      focusable: 'false',
    });
    root.appendChild(svg('circle', { class: 'ring-track', cx: C, cy: C, r: R_BASE - 5 }));
    const segments = new Map();
    const order = [];
    stations.forEach((station, k) => {
      const info = o.info(station);
      const a0 = (k + gapBefore[k] * SECTION_GAP) * slot;
      const a1 = a0 + slot;
      const from = dir * (a0 + GAP_DEG / 2);
      const to = dir * (a1 - GAP_DEG / 2);
      const height =
        info.count === null ? R_MIN : R_MIN + Math.sqrt((info.count || 0) / max) * R_SPAN;
      const classes =
        'ring-seg is-' +
        station.kind +
        ' is-c-' +
        station.section +
        (info.current ? ' is-current' : '');
      const group = svg('g', {
        class: classes,
        role: 'button',
        tabindex: '-1',
        'aria-label': info.label,
        'data-key': station.key,
      });
      group.appendChild(svg('path', { class: 'ring-hit', d: sector(R_BASE - 6, R_HIT, from, to) }));
      group.appendChild(
        svg('path', { class: 'ring-bar', d: sector(R_BASE, R_BASE + height, from, to) }),
      );
      group.appendChild(svg('title')).textContent = info.name;
      root.appendChild(group);
      segments.set(station.key, group);
      order.push(station.key);
    });

    // מרכז: שם, פרט וספירה של התחנה הפעילה (מעבר עכבר, מיקוד, או השבוע)
    const eyebrow = el('span', { class: 'ring-eyebrow' });
    const name = el('span', { class: 'ring-name', dir: 'auto' });
    const figure = el('span', { class: 'ring-figure' });
    const center = el(
      'div',
      { class: 'ring-center', 'aria-hidden': 'true' },
      eyebrow,
      name,
      figure,
    );
    const wrap = el('div', { class: 'ring' }, root, center);

    let active = null;
    let fallback = o.fallback || null;
    const show = (key) => {
      const station = stations.find((s) => s.key === key);
      const info = station ? o.info(station) : o.idle();
      eyebrow.textContent = info.detail || '';
      name.textContent = info.name || '';
      figure.textContent = info.figure || '';
    };
    const setActive = (key) => {
      active = key;
      for (const [k, node] of segments) node.classList.toggle('is-active', k === key);
      show(key || fallback);
      if (o.onActive) o.onActive(key);
    };
    let tab = fallback && segments.has(fallback) ? fallback : order[0];
    const setTab = (key) => {
      tab = key;
      for (const [k, node] of segments) node.setAttribute('tabindex', k === key ? '0' : '-1');
    };
    setTab(tab);
    show(fallback);

    const focusKey = (key) => {
      const node = segments.get(key);
      if (!node) return;
      setTab(key);
      node.focus();
    };

    root.addEventListener('pointerover', (event) => {
      const seg = event.target.closest && event.target.closest('.ring-seg');
      if (seg) setActive(seg.dataset.key);
    });
    root.addEventListener('pointerleave', () => {
      if (!root.contains(document.activeElement)) setActive(null);
    });
    root.addEventListener('focusin', (event) => {
      const seg = event.target.closest && event.target.closest('.ring-seg');
      if (!seg) return;
      setTab(seg.dataset.key);
      setActive(seg.dataset.key);
    });
    root.addEventListener('focusout', (event) => {
      if (!root.contains(event.relatedTarget)) setActive(null);
    });
    root.addEventListener('click', (event) => {
      const seg = event.target.closest && event.target.closest('.ring-seg');
      if (seg) o.onOpen(seg.dataset.key);
    });
    root.addEventListener('keydown', (event) => {
      const seg = event.target.closest && event.target.closest('.ring-seg');
      if (!seg) return;
      const at = order.indexOf(seg.dataset.key);
      const next = rtl ? 'ArrowLeft' : 'ArrowRight';
      const prev = rtl ? 'ArrowRight' : 'ArrowLeft';
      let to = null;
      if (event.key === next || event.key === 'ArrowDown') to = (at + 1) % order.length;
      else if (event.key === prev || event.key === 'ArrowUp')
        to = (at - 1 + order.length) % order.length;
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = order.length - 1;
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        o.onOpen(seg.dataset.key);
        return;
      }
      if (to === null) return;
      event.preventDefault();
      focusKey(order[to]);
    });

    return {
      el: wrap,
      setActive,
      focusKey,
      /** מה שמוצג במרכז כשאין תחנה פעילה (השבוע). */
      setFallback(key) {
        fallback = key;
        if (!active) show(key);
      },
      has: (key) => segments.has(key),
      destroy() {},
    };
  }

  A.Ring = { build, sector };
  if (typeof module === 'object' && module.exports) module.exports = A.Ring;
})(typeof self !== 'undefined' ? self : globalThis);
