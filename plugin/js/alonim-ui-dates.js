// בוחר תאריך עברי (יום, חודש, שנה) כשלושה `<select>`: אין תאריך לא תקין, כי החודשים
// והימים נבנים לפי השנה (אדר א׳ וב׳ בשנה מעוברת, 29 או 30 ימים). משמש את "מעבר
// לשבוע" ואת מסנן טווח התאריכים.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Heb = A.HebCal;
  const I18n = A.I18n;
  const { el } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  const yearLabel = (hy) => Heb.yearLetters(hy) + ' (' + hy + ')';

  /**
   * [initial]: `Date` התחלתי. [onChange]: נקרא עם `Date` תקין אחרי כל שינוי.
   * מחזיר `{ el, date(), set(date) }`. [options.years]: `{ from, to }` טווח השנים.
   */
  function hebrewSelects(initial, onChange, options) {
    const range = (options && options.years) || { from: 5700, to: 5800 };
    const state = { ...Heb.fromDate(initial || new Date()) };
    const lang = () => I18n.language;
    const daySelect = el('select', { class: 'select', 'aria-label': t('יום בחודש') });
    const monthSelect = el('select', { class: 'select', 'aria-label': t('חודש עברי') });
    const years = [];
    for (let y = range.to; y >= range.from; y--) years.push({ value: y, label: yearLabel(y) });
    if (!years.some((o) => o.value === state.year))
      years.unshift({ value: state.year, label: yearLabel(state.year) });
    const yearSelect = Ui.selectField(t('שנה עברית'), years, state.year, (value) => {
      state.year = Number(value);
      draw();
      emit();
    });

    function emit() {
      const date = Heb.toDate(state.year, state.month, state.day);
      if (date && onChange) onChange(date);
    }

    function draw() {
      const months = Heb.monthsOf(state.year);
      if (!months.includes(state.month))
        state.month =
          state.month === 'adar' ? 'adar2' : months.includes('adar') ? 'adar' : months[0];
      Ui.fill(
        monthSelect,
        months.map((m) =>
          el('option', { value: m, selected: m === state.month }, Heb.monthName(m, lang())),
        ),
      );
      const days = Heb.daysInMonth(state.year, state.month);
      state.day = Math.min(state.day, days);
      Ui.fill(
        daySelect,
        Array.from({ length: days }, (_, k) =>
          el(
            'option',
            { value: k + 1, selected: k + 1 === state.day },
            lang() === 'he' ? Heb.numeral(k + 1) : String(k + 1),
          ),
        ),
      );
    }

    monthSelect.addEventListener('change', () => {
      state.month = monthSelect.value;
      draw();
      emit();
    });
    daySelect.addEventListener('change', () => {
      state.day = Number(daySelect.value);
      emit();
    });
    draw();
    return {
      el: el('div', { class: 'picker-inline hebrew-date' }, daySelect, monthSelect, yearSelect),
      date: () => Heb.toDate(state.year, state.month, state.day),
      set(date) {
        Object.assign(state, Heb.fromDate(date));
        yearSelect.value = String(state.year);
        draw();
      },
    };
  }

  A.UiDates = { hebrewSelects, yearLabel };
  if (typeof module === 'object' && module.exports) module.exports = A.UiDates;
})(typeof self !== 'undefined' ? self : globalThis);
