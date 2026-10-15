// "מעבר לשבוע…": חלון בחירה של שבוע לפי שנה עברית (פרשות, שבתות מיוחדות וחגים,
// כולל חגים באמצע השבוע), לפי תאריך לועזי, או לפי תאריך עברי (יום, חודש, שנה).
// שנים ישנות: לוח הארכיון (`weeks-archive.json`) נטען בלחיצה, ושרדי השנה — כשבוחרים בה;
// עד שהם מגיעים הספירה מוצגת כנקודה ולא כאפס.
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
    { id: 'holiday', label: N('חגים ומועדים') },
  ]);

  const yearLabel = (hy) => A.UiDates.yearLabel(hy);

  /**
   * [options]: `getViews()` (תצוגות `Weeks.build`, מתעדכן כשהארכיון נטען),
   * `currentDate` ו-`selectedDate` (`YYYY-MM-DD`), `onPick(date)`, `onCurrent()`.
   */
  function open(app, options) {
    const { getViews, currentDate, selectedDate, onPick, onCurrent } = options;
    let views = getViews();
    let years = Weeks.years(views);
    const selected =
      views.find((v) => v.date === selectedDate) ||
      views.find((v) => v.date === currentDate) ||
      views[0];
    const state = { hy: selected ? selected.hy : (years[0] || {}).hy || 0, filter: 'all' };
    const index = app.index;
    const catalog = app.catalog;

    const list = el('div', { class: 'week-list', role: 'list', 'aria-label': t('שבועות בשנה') });
    const note = el('p', { class: 'picker-note', role: 'status' });
    const yearSelect = el('select', { class: 'select picker-year', 'aria-label': t('שנה עברית') });
    yearSelect.addEventListener('change', () => setYear(Number(yearSelect.value)));
    const rtl = document.documentElement.dir !== 'ltr';
    const prevYear = Ui.iconButton(
      rtl ? 'chevron_right_24_regular' : 'chevron_left_24_regular',
      t('השנה הקודמת'),
      () => stepYear(-1),
      { className: 'picker-step', key: 'prev-year' },
    );
    const nextYear = Ui.iconButton(
      rtl ? 'chevron_left_24_regular' : 'chevron_right_24_regular',
      t('השנה הבאה'),
      () => stepYear(1),
      { className: 'picker-step', key: 'next-year' },
    );
    const archiveButton = Ui.button('text', t('טעינת שנים ישנות'), () => loadArchive(), {
      icon: 'history_24_regular',
      className: 'button-small',
      key: 'archive',
    });
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
              filterBar
                .querySelectorAll('button')
                .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f.id)));
              drawList();
            },
          },
          t(f.label),
        ),
      ),
    );

    // ------------------------------------------------------ שנים וטעינה

    /** שרדי השנה בזיכרון? (שנה בלי שרדים בכלל — כן: אין מה לטעון). */
    const yearLoaded = (hy) =>
      catalog.shardsOfYear(hy).every((s) => catalog.emitted.has('issues/' + s.id + '.json'));

    function drawYears() {
      Ui.fill(
        yearSelect,
        years.map((y) =>
          el('option', { value: y.hy, selected: y.hy === state.hy }, yearLabel(y.hy)),
        ),
      );
      archiveButton.hidden = !(catalog.hasWeeksArchive() && !catalog.weeksArchiveLoaded());
    }

    function stepYear(delta) {
      const at = years.findIndex((y) => y.hy === state.hy);
      // `years` מהחדשה לישנה: "השנה הבאה" היא האינדקס הקודם.
      const next = years[at - delta];
      if (next) setYear(next.hy);
    }

    function setYear(hy) {
      state.hy = hy;
      yearSelect.value = String(hy);
      if (!yearLoaded(hy)) catalog.ensureYear(hy);
      drawList();
    }

    async function loadArchive() {
      archiveButton.disabled = true;
      const ok = await app.loadWeeksArchive();
      archiveButton.disabled = false;
      if (!ok) say(t('לא הצלחנו לטעון את לוח השנים הישנות. אפשר לנסות שוב.'));
    }

    /** נתונים חדשים (ארכיון, שרד): מחשבים מחדש את השנים והרשימה. */
    function onData() {
      views = getViews();
      years = Weeks.years(views);
      if (!years.some((y) => y.hy === state.hy) && years.length) state.hy = years[0].hy;
      drawYears();
      drawList();
    }
    let timer = null;
    const offData = app.on('data', () => {
      clearTimeout(timer);
      timer = setTimeout(onData, 150);
    });

    // ------------------------------------------------------------ רשימה

    function pick(date) {
      dlg.close('pick');
      onPick(date);
    }

    function row(v) {
      const loaded = yearLoaded(v.hy);
      const count = loaded ? index.forWeek(v.row).length : 0;
      const day = Weeks.displayDay(v);
      const isCurrent = v.date === currentDate;
      const isSelected = v.date === selectedDate;
      return el(
        'button',
        {
          type: 'button',
          class:
            'week-row' +
            (isSelected ? ' is-selected' : '') +
            (v.kind === 'holiday' ? ' is-holiday' : ''),
          role: 'listitem',
          'aria-current': isSelected ? 'true' : null,
          dataset: { date: v.date },
          onclick: () => pick(v.date),
        },
        el(
          'span',
          { class: 'week-row-main' },
          el('span', { class: 'week-row-title', dir: 'auto' }, v.title),
          v.kind === 'special' && v.parashaLabel && v.eventLabel
            ? el('span', { class: 'week-row-event', dir: 'auto' }, v.eventLabel)
            : null,
          v.secondary.length
            ? el(
                'span',
                { class: 'week-row-event', dir: 'auto' },
                v.secondary.map(Core.eventName).join(' · '),
              )
            : null,
          el(
            'span',
            { class: 'week-row-date', dir: 'auto' },
            day
              ? Core.dateLine(day, {
                  short: true,
                  weekday: v.kind === 'holiday',
                  hebrewText: v.hebrew,
                })
              : v.date,
          ),
        ),
        isCurrent ? Ui.chip(t('השבוע'), { kind: 'now' }) : null,
        el(
          'span',
          {
            class: 'week-row-count' + (loaded && !count ? ' is-zero' : ''),
            title: loaded ? t('{n} גיליונות', { n: count }) : t('השנה עוד לא נטענה'),
          },
          loaded ? Core.formatCount(count) : '·',
        ),
      );
    }

    function drawList() {
      const inYear = Weeks.ofYear(views, state.hy);
      const shown = inYear.filter((v) => state.filter === 'all' || v.kind === state.filter);
      Ui.fill(
        list,
        shown.length
          ? shown.map(row)
          : el('p', { class: 'picker-empty' }, t('אין שבועות מהסוג הזה בשנה הזו.')),
      );
      const at = years.findIndex((y) => y.hy === state.hy);
      prevYear.disabled = at >= years.length - 1;
      nextYear.disabled = at <= 0;
      const derived = inYear.length && inYear.every((v) => v.derived);
      let text = '';
      if (derived) text = t('השנה הזו אינה בלוח הקטלוג. הרשימה נבנתה מהעלונים שנטענו.');
      else if (!yearLoaded(state.hy)) text = t('העלונים של השנה הזו נטענים; הספירות יתעדכנו.');
      note.textContent = text;
      note.hidden = !text;
      const selectedRow = list.querySelector('.is-selected');
      if (selectedRow && selectedRow.scrollIntoView)
        selectedRow.scrollIntoView({ block: 'center' });
    }

    // ---------------------------------------------------- מעבר לתאריך

    const message = el('p', { class: 'picker-message', role: 'status', hidden: true });
    function say(text) {
      message.textContent = text;
      message.hidden = !text;
    }

    /** עובר לשבוע של תאריך; אם הוא מחוץ ללוח, אומר זאת ועובר לקרוב ביותר. */
    function goToDate(date) {
      if (!date) return say(t('הזינו תאריך תקין.'));
      views = getViews();
      const ymd = Core.ymd(date);
      const i = Weeks.indexForDate(views, ymd);
      if (i < 0) return say(t('אין נתוני לוח.'));
      if (ymd < views[0].date || ymd > views[views.length - 1].date) {
        say(t('התאריך מחוץ ללוח השבועות. הפרשה אינה ידועה לו; נבחר השבוע הקרוב ביותר.'));
      }
      pick(views[i].date);
    }

    const dateInput = el('input', {
      type: 'date',
      class: 'input picker-date',
      'aria-label': t('תאריך לועזי'),
    });
    const base = (selected && selected.day) || app.today();
    dateInput.value = Core.ymd(base);
    const gregorian = el(
      'div',
      { class: 'picker-field' },
      el('span', { class: 'picker-label' }, t('תאריך לועזי')),
      el(
        'div',
        { class: 'picker-inline' },
        dateInput,
        Ui.button('tonal', t('מעבר'), () => goToDate(Core.parseYmd(dateInput.value)), {
          className: 'button-small',
          key: 'go-gregorian',
        }),
      ),
    );

    const oldest = years.length ? years[years.length - 1].hy : 5770;
    const newest = years.length ? years[0].hy : 5800;
    const hebrewDate = A.UiDates.hebrewSelects(base, null, {
      years: { from: Math.min(5750, oldest), to: Math.max(5800, newest + 2) },
    });
    const hebrew = el(
      'div',
      { class: 'picker-field' },
      el('span', { class: 'picker-label' }, t('תאריך עברי')),
      el(
        'div',
        { class: 'picker-inline' },
        hebrewDate.el,
        Ui.button('tonal', t('מעבר'), () => goToDate(hebrewDate.date()), {
          className: 'button-small',
          key: 'go-hebrew',
        }),
      ),
    );

    const body = el(
      'div',
      { class: 'week-picker' },
      el(
        'div',
        { class: 'picker-top' },
        Ui.button(
          'filled',
          t('השבוע הנוכחי'),
          () => {
            dlg.close('current');
            onCurrent();
          },
          { icon: 'calendar_star_24_regular', className: 'button-small', key: 'now' },
        ),
        el('div', { class: 'picker-years' }, prevYear, yearSelect, nextYear, archiveButton),
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
      onClose: () => {
        offData();
        clearTimeout(timer);
      },
    });
    drawYears();
    drawList();
    if (!yearLoaded(state.hy)) catalog.ensureYear(state.hy);
    return dlg;
  }

  A.WeekPicker = { open };
  if (typeof module === 'object' && module.exports) module.exports = A.WeekPicker;
})(typeof self !== 'undefined' ? self : globalThis);
