// "מעבר לשבוע…": חלון בחירה של שבוע לפי שנה עברית (פרשות, שבתות מיוחדות וחגים,
// כולל חגים באמצע השבוע), לפי תאריך לועזי, או לפי תאריך עברי (יום, חודש, שנה).
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const Weeks = A.Weeks;
  const I18n = A.I18n;
  const { el } = Ui;
  const t = (text, vars) => I18n.t(text, vars);
  const N = (text) => text;

  const FILTERS = Object.freeze([
    { id: 'all', label: N('הכול') },
    { id: 'shabbat', label: N('פרשות') },
    { id: 'special', label: N('שבתות מיוחדות') },
    { id: 'holiday', label: N('חגים') },
  ]);

  const yearLabel = (hy) => A.UiDates.yearLabel(hy);

  /**
   * [options]: `views` (מ-`Weeks.build`), `currentIndex`, `selectedIndex`,
   * `onPick(index)`, `onCurrent()`.
   */
  function open(app, options) {
    const { views, currentIndex, selectedIndex, onPick, onCurrent } = options;
    const years = Weeks.years(views);
    const selected = views[selectedIndex] || views[currentIndex] || views[0];
    const state = { hy: selected ? selected.hy : (years[0] || {}).hy || 0, filter: 'all' };
    const index = app.index;

    const list = el('div', { class: 'week-list', role: 'list', 'aria-label': t('שבועות בשנה') });
    const note = el('p', { class: 'picker-note', role: 'status' });
    const yearSelect = Ui.selectField(
      t('שנה עברית'),
      years.map((y) => ({ value: y.hy, label: yearLabel(y.hy) })),
      state.hy,
      (value) => setYear(Number(value)),
      'picker-year',
    );
    const rtl = document.documentElement.dir !== 'ltr';
    const prevYear = Ui.iconButton(rtl ? 'chevron_right_24_regular' : 'chevron_left_24_regular', t('השנה הקודמת'), () => stepYear(-1), { className: 'picker-step', key: 'prev-year' });
    const nextYear = Ui.iconButton(rtl ? 'chevron_left_24_regular' : 'chevron_right_24_regular', t('השנה הבאה'), () => stepYear(1), { className: 'picker-step', key: 'next-year' });
    const filterBar = el(
      'div',
      { class: 'segmented is-text', role: 'group', 'aria-label': t('סוג שבוע') },
      FILTERS.map((f) =>
        el(
          'button',
          {
            type: 'button',
            class: 'segment-text',
            'aria-pressed': String(f.id === state.filter),
            dataset: { filter: f.id },
            onclick: () => {
              state.filter = f.id;
              filterBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f.id)));
              drawList();
            },
          },
          t(f.label),
        ),
      ),
    );

    function stepYear(delta) {
      const at = years.findIndex((y) => y.hy === state.hy);
      // `years` מהחדשה לישנה: "השנה הבאה" היא האינדקס הקודם.
      const next = years[at - delta];
      if (next) setYear(next.hy);
    }

    function setYear(hy) {
      state.hy = hy;
      yearSelect.value = String(hy);
      drawList();
    }

    function pick(i) {
      dlg.close('pick');
      onPick(i);
    }

    function row(v) {
      const count = index.forWeek(v.row).length;
      const day = Weeks.displayDay(v);
      const isCurrent = v.i === currentIndex;
      const isSelected = v.i === selectedIndex;
      return el(
        'button',
        {
          type: 'button',
          class: 'week-row' + (isSelected ? ' is-selected' : '') + (v.kind === 'holiday' ? ' is-holiday' : ''),
          role: 'listitem',
          'aria-current': isSelected ? 'true' : null,
          dataset: { date: v.date },
          onclick: () => pick(v.i),
        },
        el(
          'span',
          { class: 'week-row-main' },
          el('span', { class: 'week-row-title', dir: 'auto' }, v.title),
          v.kind === 'special' && v.parashaLabel && v.eventLabel ? el('span', { class: 'week-row-event', dir: 'auto' }, v.eventLabel) : null,
          el('span', { class: 'week-row-date', dir: 'auto' }, day ? Core.dateLine(day, { short: true, weekday: v.kind === 'holiday' }) : v.date),
        ),
        isCurrent ? Ui.chip(t('השבוע'), { kind: 'now' }) : null,
        el('span', { class: 'week-row-count' + (count ? '' : ' is-zero'), title: t('{n} גיליונות', { n: count }) }, Core.formatCount(count)),
      );
    }

    function drawList() {
      const inYear = Weeks.ofYear(views, state.hy);
      const shown = inYear.filter((v) => state.filter === 'all' || v.kind === state.filter);
      Ui.fill(list, shown.length ? shown.map(row) : el('p', { class: 'picker-empty' }, t('אין שבועות מהסוג הזה בשנה הזו.')));
      const at = years.findIndex((y) => y.hy === state.hy);
      prevYear.disabled = at >= years.length - 1;
      nextYear.disabled = at <= 0;
      const derived = inYear.length && inYear.every((v) => v.derived);
      let text = '';
      if (derived) text = t('השנה הזו אינה בלוח הקטלוג. הרשימה נבנתה מהעלונים שנטענו.');
      note.textContent = text;
      note.hidden = !text;
      const selectedRow = list.querySelector('.is-selected');
      if (selectedRow && selectedRow.scrollIntoView) selectedRow.scrollIntoView({ block: 'center' });
    }

    // ---------------------------------------------------- מעבר לתאריך

    const message = el('p', { class: 'picker-message', role: 'status', hidden: true });
    const say = (text) => {
      message.textContent = text;
      message.hidden = !text;
    };
    const first = views[0];
    const last = views[views.length - 1];

    /** עובר לשבוע של תאריך; אם הוא מחוץ ללוח, אומר זאת ועובר לקרוב ביותר. */
    function goToDate(date) {
      if (!date) return say(t('הזינו תאריך תקין.'));
      const ymd = Core.ymd(date);
      const i = Weeks.indexForDate(views, ymd);
      if (i < 0) return say(t('אין נתוני לוח.'));
      if (ymd < first.date || ymd > last.date) {
        say(t('התאריך מחוץ ללוח השבועות. הפרשה אינה ידועה לו; נבחר השבוע הקרוב ביותר.'));
      }
      pick(i);
    }

    const dateInput = el('input', { type: 'date', class: 'input picker-date', 'aria-label': t('תאריך לועזי') });
    const base = (selected && selected.day) || app.today();
    dateInput.value = Core.ymd(base);
    const gregorian = el(
      'div',
      { class: 'picker-field' },
      el('span', { class: 'picker-label' }, t('תאריך לועזי')),
      el('div', { class: 'picker-inline' }, dateInput, Ui.button('tonal', t('מעבר'), () => goToDate(Core.parseYmd(dateInput.value)), { className: 'button-small', key: 'go-gregorian' })),
    );

    const minYear = Math.min(5770, years.length ? years[years.length - 1].hy : 5770);
    const maxYear = Math.max(5800, years.length ? years[0].hy + 2 : 5800);
    const hebrewDate = A.UiDates.hebrewSelects(base, null, { years: { from: minYear, to: maxYear } });
    const hebrew = el(
      'div',
      { class: 'picker-field' },
      el('span', { class: 'picker-label' }, t('תאריך עברי')),
      el(
        'div',
        { class: 'picker-inline' },
        hebrewDate.el,
        Ui.button('tonal', t('מעבר'), () => goToDate(hebrewDate.date()), { className: 'button-small', key: 'go-hebrew' }),
      ),
    );

    const body = el(
      'div',
      { class: 'week-picker' },
      el(
        'div',
        { class: 'picker-top' },
        Ui.button('filled', t('השבוע הנוכחי'), () => {
          dlg.close('current');
          onCurrent();
        }, { icon: 'calendar_star_24_regular', className: 'button-small', key: 'now' }),
        el('div', { class: 'picker-years' }, prevYear, yearSelect, nextYear),
      ),
      filterBar,
      note,
      list,
      el('div', { class: 'picker-dates' }, gregorian, hebrew, message),
    );
    const dlg = Ui.dialog({
      title: t('מעבר לשבוע'),
      body,
      actions: [Ui.button('text', t('סגירה'), () => dlg.close('close'))],
      focus: '[data-key="now"]',
    });
    drawList();
    return dlg;
  }

  A.WeekPicker = { open };
  if (typeof module === 'object' && module.exports) module.exports = A.WeekPicker;
})(typeof self !== 'undefined' ? self : globalThis);
