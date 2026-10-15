// ממשק המסננים של "כל העלונים": תגיות של מסננים פעילים (עם הסרה), וחלון מסננים
// עם בחירה מרובה (פרשה, אירוע, שנה, שפה, מקור, חוג, סדרה), טווחים (תאריך עברי או
// לועזי, שנים, עמודים, גודל), דגלי מצב והגדרות שמורות. הסינון עצמו באינדקס
// (`alonim-index-search.js`); כאן רק בחירה ותצוגה. הספירה ליד כל ערך היא
// `facetCounts`: כמה גיליונות יתאימו אם בוחרים רק בו, ביחד עם שאר המסננים.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const Filters = A.Filters;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);
  const N = (text) => text;

  /** שמות הדגלים (תגית ותיבת סימון). */
  const FLAG_LABELS = Object.freeze({
    multi: N('עותקים ממקורות נוספים'),
    favorite: N('מועדפים'),
    followed: N('סדרות במעקב או מועדפות'),
    downloaded: N('הורדו'),
    inList: N('נמצאים באוסף'),
    unread: N('לא נקראו'),
    isNew: N('חדשים'),
    sinceVisit: N('חדשים מאז הביקור האחרון'),
    hiddenOnly: N('מוסתרים לפי הכללים בלבד'),
  });

  const FLAG_ORDER = [
    'multi',
    'favorite',
    'followed',
    'downloaded',
    'inList',
    'unread',
    'isNew',
    'sinceVisit',
    'hiddenOnly',
  ];

  const rangeText = (from, to, fmt, unit) => {
    const f = (v) => fmt(v) + (unit ? ' ' + unit : '');
    if (from && to) return fmt(from) + '–' + fmt(to) + (unit ? ' ' + unit : '');
    return from ? t('מ-{x}', { x: f(from) }) : t('עד {x}', { x: f(to) });
  };

  /** טקסט קריא לתגית של מסנן. */
  function chipLabel(app, key, value) {
    switch (key) {
      case 'parasha':
        return Core.parashaName(value);
      case 'event':
        return Core.eventName(value);
      case 'hy':
        return Core.hyLetters(value);
      case 'lang':
        return Core.langName(value);
      case 'source':
        return app.sourceInfo(value).name;
      case 'circle':
        return value;
      case 'series':
        return app.index.seriesTitleOf(value) || t('סדרה');
      case 'date': {
        const day = (v) => Core.dateText(v, { short: true });
        return t('תאריך: {range}', { range: rangeText(value.from, value.to, day) });
      }
      case 'year':
        return t('שנים: {range}', { range: rangeText(value.from, value.to, Core.hyLetters) });
      case 'pages':
        return t('עמודים: {range}', { range: rangeText(value.from, value.to, String) });
      case 'size':
        return t('גודל: {range}', { range: rangeText(value.from, value.to, String, 'MB') });
      default:
        return FLAG_LABELS[key] ? t(FLAG_LABELS[key]) : String(key);
    }
  }

  /** שורת תגיות של המסננים הפעילים; כל תגית מסירה את המסנן שלה. */
  function chipsRow(app, filters, onChange) {
    const chips = Filters.chips(filters, (key, value) => chipLabel(app, key, value));
    if (!chips.length) return null;
    return el(
      'div',
      { class: 'active-filters', role: 'group', 'aria-label': t('מסננים פעילים') },
      chips.map((chip) =>
        el(
          'button',
          {
            type: 'button',
            class: 'filter-tag',
            title: t('הסרת המסנן'),
            'aria-label': t('הסרת מסנן: {name}', { name: chip.label }),
            onclick: () =>
              onChange(
                Filters.remove(
                  filters,
                  chip.key,
                  Filters.LIST_KEYS.includes(chip.key) ? chip.value : undefined,
                ),
              ),
          },
          el('span', { class: 'filter-tag-text', dir: 'auto' }, chip.label),
          icon('dismiss_24_regular'),
        ),
      ),
    );
  }

  // ------------------------------------------------------ חלון המסננים

  /**
   * [host]: `{ get() → { query, filters, sort, includeHidden }, set(filters),
   * applyPreset(preset) }`. מחזיר את הדיאלוג.
   */
  function openPanel(app, host) {
    const facets = app.index.facets();
    const manifestYears = app.catalog.yearCounts();
    const groupDefs = [];
    const order = (names, present) => Object.keys(names).filter((k) => present.has(k));
    groupDefs.push({
      key: 'parasha',
      title: t('פרשה'),
      searchable: true,
      options: order(Core.PARASHOT, facets.parashot).map((v) => ({
        value: v,
        label: Core.parashaName(v),
      })),
    });
    groupDefs.push({
      key: 'event',
      title: t('שבת מיוחדת או חג'),
      options: Object.keys(Core.EVENTS).map((v) => ({ value: v, label: Core.eventName(v) })),
    });
    const yearSet = new Set([...facets.years.keys(), ...manifestYears.keys()]);
    const yearList = [...yearSet].sort((a, b) => b - a);
    groupDefs.push({
      key: 'hy',
      title: t('שנה עברית'),
      searchable: true,
      options: yearList.map((y) => ({
        value: y,
        label: A.UiDates.yearLabel(y),
        unloaded: !facets.years.has(y),
        total: manifestYears.get(y) || 0,
      })),
    });
    groupDefs.push({
      key: 'lang',
      title: t('שפה'),
      options: Core.LANG_CODES.filter((l) => facets.langs.has(l)).map((v) => ({
        value: v,
        label: Core.langName(v),
      })),
    });
    groupDefs.push({
      key: 'source',
      title: t('מקור'),
      options: app
        .allSources()
        .filter((s) => facets.sources.has(s.id))
        .map((s) => ({ value: s.id, label: s.name })),
    });
    groupDefs.push({
      key: 'circle',
      title: t('חוג'),
      searchable: true,
      options: [...facets.circles.keys()].sort().map((v) => ({ value: v, label: v })),
    });

    const current = () => host.get().filters;
    let counts = null;
    let timer = null;
    const refs = { groups: new Map(), flags: new Map(), ranges: {}, total: null };

    function commit(next) {
      host.set(Filters.clean(next));
      sync();
      scheduleCounts();
    }

    function scheduleCounts() {
      clearTimeout(timer);
      timer = setTimeout(computeCounts, 80);
    }

    function computeCounts() {
      const s = host.get();
      counts = app.index.facetCounts(s.query, s.filters, app.searchContext(), {
        includeHidden: s.includeHidden,
      });
      for (const def of groupDefs) {
        const map = counts[def.key];
        const group = refs.groups.get(def.key);
        for (const row of group.rows) {
          const n = map.get(row.value) || 0;
          if (row.unloaded) {
            row.count.textContent = n ? Core.formatCount(n) : '·';
            row.count.title = t('השנה עוד לא נטענה; הספירה תתעדכן כשתיטען.');
            row.label.classList.add('is-unloaded');
          } else {
            row.count.textContent = Core.formatCount(n);
            row.count.title = '';
            row.label.classList.remove('is-unloaded');
          }
          row.label.classList.toggle('is-zero', n === 0 && !row.input.checked);
        }
      }
      refs.total.textContent = t('הצג {n} גיליונות', { n: Core.formatCount(counts.total) });
    }

    // ---- בחירה מרובה

    function multiGroup(def) {
      const rows = [];
      const list = el('div', { class: 'filter-options', role: 'group', 'aria-label': def.title });
      for (const option of def.options) {
        const input = el('input', {
          type: 'checkbox',
          value: String(option.value),
          onchange: () => commit(Filters.toggle(current(), def.key, option.value)),
        });
        const count = el('span', { class: 'opt-count' }, '');
        const label = el(
          'label',
          { class: 'filter-option' },
          input,
          el('span', { class: 'opt-label', dir: 'auto' }, option.label),
          count,
        );
        list.appendChild(label);
        rows.push({
          value: option.value,
          label,
          input,
          count,
          text: A.Normalize.searchKey(option.label),
          unloaded: option.unloaded,
        });
      }
      const badge = el('span', { class: 'filter-group-badge', hidden: true });
      const body = el('div', { class: 'filter-group-body' });
      if (def.searchable && def.options.length > 8) {
        body.appendChild(
          el('input', {
            class: 'input filter-search',
            type: 'search',
            placeholder: t('חיפוש ברשימה'),
            'aria-label': t('חיפוש ברשימה: {name}', { name: def.title }),
            autocomplete: 'off',
            oninput: (event) => {
              const q = A.Normalize.searchKey(event.target.value);
              for (const row of rows)
                row.label.hidden = Boolean(q) && !(' ' + row.text).includes(' ' + q);
            },
          }),
        );
      }
      body.appendChild(list);
      const details = el(
        'details',
        { class: 'filter-group', dataset: { group: def.key } },
        el('summary', {}, el('span', { class: 'filter-group-title' }, def.title), badge),
        body,
      );
      refs.groups.set(def.key, { rows, badge, details });
      return details;
    }

    // ---- סדרות (בורר עם חיפוש)

    function seriesGroup() {
      const list = el('div', {
        class: 'filter-options series-options',
        role: 'group',
        'aria-label': t('סדרות'),
      });
      const selectedHost = el('div', { class: 'active-filters' });
      const badge = el('span', { class: 'filter-group-badge', hidden: true });
      const input = el('input', {
        class: 'input filter-search',
        type: 'search',
        placeholder: t('חיפוש סדרה לפי שם'),
        'aria-label': t('חיפוש סדרה לפי שם'),
        autocomplete: 'off',
      });
      const draw = () => {
        const selected = new Set(current().series || []);
        const text = input.value.trim();
        const found = text ? app.index.searchSeries(text, {}, null).slice(0, 40) : [];
        Ui.fill(
          selectedHost,
          [...selected].map((id) =>
            el(
              'button',
              {
                type: 'button',
                class: 'filter-tag',
                'aria-label': t('הסרת מסנן: {name}', { name: chipLabel(app, 'series', id) }),
                onclick: () => commit(Filters.remove(current(), 'series', id)),
              },
              el('span', { class: 'filter-tag-text', dir: 'auto' }, chipLabel(app, 'series', id)),
              icon('dismiss_24_regular'),
            ),
          ),
        );
        Ui.fill(
          list,
          found.map((s) =>
            el(
              'label',
              { class: 'filter-option' },
              el('input', {
                type: 'checkbox',
                checked: selected.has(s.id),
                onchange: () => commit(Filters.toggle(current(), 'series', s.id)),
              }),
              el('span', { class: 'opt-label', dir: 'auto' }, s.title),
              el('span', { class: 'opt-count' }, s.circle || ''),
            ),
          ),
        );
        if (text && !found.length)
          list.appendChild(el('p', { class: 'picker-empty' }, t('לא נמצאה סדרה בשם הזה.')));
        const n = selected.size;
        badge.hidden = !n;
        badge.textContent = String(n);
      };
      input.addEventListener('input', draw);
      refs.series = { draw, badge };
      const body = el('div', { class: 'filter-group-body' }, selectedHost, input, list);
      return el(
        'details',
        { class: 'filter-group', dataset: { group: 'series' } },
        el('summary', {}, el('span', { class: 'filter-group-title' }, t('סדרה')), badge),
        body,
      );
    }

    // ---- טווחים

    function dateField(label, kind) {
      const key = kind === 'from' ? 'dateFrom' : 'dateTo';
      const input = el('input', { type: 'date', class: 'input range-input', 'aria-label': label });
      const caption = el('span', { class: 'range-caption', dir: 'auto' });
      const hebrew = A.UiDates.hebrewSelects(new Date(), (date) => {
        input.value = Core.ymd(date);
        apply();
      });
      const toggle = Ui.iconButton(
        'calendar_star_24_regular',
        t('בחירה לפי תאריך עברי'),
        () => {
          hebrew.el.hidden = !hebrew.el.hidden;
          toggle.setAttribute('aria-expanded', String(!hebrew.el.hidden));
        },
        { expanded: false, className: 'range-toggle' },
      );
      hebrew.el.hidden = true;
      function apply() {
        const f = current();
        const other = kind === 'from' ? f.dateTo || '' : f.dateFrom || '';
        commit(
          Filters.setRange(
            f,
            'date',
            kind === 'from' ? input.value : other,
            kind === 'from' ? other : input.value,
          ),
        );
      }
      input.addEventListener('change', () => {
        const d = Core.parseYmd(input.value);
        if (d) hebrew.set(d);
        apply();
      });
      const sync1 = () => {
        const value = current()[key] || '';
        input.value = value;
        const d = Core.parseYmd(value);
        caption.textContent = d ? Core.hebrewDate(d) : '';
        if (d) hebrew.set(d);
      };
      refs.ranges[key] = sync1;
      return el(
        'div',
        { class: 'range-field' },
        el('span', { class: 'picker-label' }, label),
        el('div', { class: 'picker-inline' }, input, toggle),
        caption,
        hebrew.el,
      );
    }

    function yearField(label, kind) {
      const key = kind === 'from' ? 'hyFrom' : 'hyTo';
      const select = Ui.selectField(
        label,
        [
          { value: '', label: '—' },
          ...yearList.slice().map((y) => ({ value: y, label: A.UiDates.yearLabel(y) })),
        ],
        '',
        (value) => {
          const f = current();
          const other = kind === 'from' ? f.hyTo || 0 : f.hyFrom || 0;
          commit(
            Filters.setRange(
              f,
              'year',
              kind === 'from' ? value : other,
              kind === 'from' ? other : value,
            ),
          );
        },
      );
      refs.ranges[key] = () => {
        select.value = String(current()[key] || '');
      };
      return el(
        'div',
        { class: 'range-field' },
        el('span', { class: 'picker-label' }, label),
        select,
      );
    }

    function numberField(label, name, bound, step) {
      const key = name + bound;
      const input = el('input', {
        type: 'number',
        class: 'input range-input',
        min: '1',
        step: String(step || 1),
        inputmode: 'numeric',
        'aria-label': label,
      });
      input.addEventListener('change', () => {
        const f = current();
        const lo = name === 'pages' ? 'pagesMin' : 'sizeMin';
        const hi = name === 'pages' ? 'pagesMax' : 'sizeMax';
        const next = { ...f };
        next[bound === 'Min' ? lo : hi] = Number(input.value) > 0 ? Number(input.value) : 0;
        commit(Filters.setRange(next, name, next[lo], next[hi]));
      });
      refs.ranges[key] = () => {
        const f = current();
        input.value = f[name === 'pages' ? 'pages' + bound : 'size' + bound] || '';
      };
      return el(
        'div',
        { class: 'range-field' },
        el('span', { class: 'picker-label' }, label),
        input,
      );
    }

    const rangeGroup = (title, key, ...fields) =>
      el(
        'details',
        { class: 'filter-group', dataset: { group: key } },
        el(
          'summary',
          {},
          el('span', { class: 'filter-group-title' }, title),
          (refs.ranges[key + 'Badge'] = el('span', { class: 'filter-group-badge', hidden: true })),
        ),
        el('div', { class: 'filter-group-body range-grid' }, ...fields),
      );

    // ---- דגלים

    function flagsGroup() {
      const list = el('div', { class: 'filter-options', role: 'group', 'aria-label': t('מצב') });
      const hasVisit = app.state.visitBase > 0;
      for (const key of FLAG_ORDER) {
        if (key === 'sinceVisit' && !hasVisit) continue;
        const input = el('input', {
          type: 'checkbox',
          onchange: () => commit(Filters.toggle(current(), key)),
        });
        refs.flags.set(key, input);
        list.appendChild(
          el(
            'label',
            { class: 'filter-option' },
            input,
            el('span', { class: 'opt-label' }, t(FLAG_LABELS[key])),
          ),
        );
      }
      return el(
        'details',
        { class: 'filter-group', open: true, dataset: { group: 'flags' } },
        el(
          'summary',
          {},
          el('span', { class: 'filter-group-title' }, t('מצב')),
          (refs.flagBadge = el('span', { class: 'filter-group-badge', hidden: true })),
        ),
        el('div', { class: 'filter-group-body' }, list),
      );
    }

    // ---- הגדרות שמורות

    const presetSelect = el('select', {
      class: 'select preset-select',
      'aria-label': t('הגדרות חיפוש שמורות'),
    });
    const presetName = el('input', {
      class: 'input',
      type: 'text',
      maxlength: '80',
      placeholder: t('שם להגדרה'),
      'aria-label': t('שם להגדרה'),
      autocomplete: 'off',
    });
    const presetForm = el(
      'form',
      {
        class: 'preset-form',
        hidden: true,
        onsubmit: (event) => {
          event.preventDefault();
          const name = presetName.value.trim();
          if (!name) return;
          const s = host.get();
          const saved = app.state.savePreset(name, {
            query: s.query,
            filters: s.filters,
            sort: s.sort,
          });
          presetForm.hidden = true;
          presetName.value = '';
          drawPresets(saved && saved.id);
          app.toast(saved ? t('ההגדרה "{name}" נשמרה', { name }) : t('אי אפשר לשמור עוד הגדרות.'), {
            error: !saved,
          });
        },
      },
      presetName,
      Ui.button('filled', t('שמירה'), () => presetForm.requestSubmit(), {
        className: 'button-small',
      }),
    );
    const deletePreset = Ui.iconButton(
      'delete_24_regular',
      t('מחיקת ההגדרה השמורה'),
      () => {
        const removed = app.state.deletePreset(presetSelect.value);
        drawPresets();
        if (removed)
          app.toast(t('ההגדרה "{name}" נמחקה', { name: removed.name }), {
            action: {
              label: t('ביטול הפעולה'),
              run: () => {
                app.state.restorePreset(removed);
              },
            },
          });
      },
      { disabled: true },
    );

    function drawPresets(selectId) {
      const presets = app.state.presets;
      Ui.fill(presetSelect, [
        el(
          'option',
          { value: '' },
          presets.length ? t('הגדרות שמורות…') : t('אין עדיין הגדרות שמורות'),
        ),
        ...presets.map((p) => el('option', { value: p.id, selected: p.id === selectId }, p.name)),
      ]);
      presetSelect.disabled = !presets.length;
      deletePreset.disabled = !presetSelect.value;
    }
    presetSelect.addEventListener('change', () => {
      deletePreset.disabled = !presetSelect.value;
      const preset = app.state.presets.find((p) => p.id === presetSelect.value);
      if (!preset) return;
      host.applyPreset(preset);
      sync();
      scheduleCounts();
    });

    // ---- סנכרון בקרות מול המסנן הנוכחי

    function sync() {
      const f = current();
      for (const def of groupDefs) {
        const group = refs.groups.get(def.key);
        const selected = new Set((f[def.key] || []).map(String));
        for (const row of group.rows) row.input.checked = selected.has(String(row.value));
        group.badge.hidden = !selected.size;
        group.badge.textContent = String(selected.size);
      }
      refs.series.draw();
      for (const [key, input] of refs.flags) input.checked = Boolean(f[key]);
      const flagCount = [...refs.flags.keys()].filter((k) => f[k]).length;
      refs.flagBadge.hidden = !flagCount;
      refs.flagBadge.textContent = String(flagCount);
      for (const fn of Object.values(refs.ranges)) if (typeof fn === 'function') fn();
      const badges = {
        date: f.dateFrom || f.dateTo,
        year: f.hyFrom || f.hyTo,
        pages: f.pagesMin || f.pagesMax,
        size: f.sizeMin || f.sizeMax,
      };
      for (const [key, on] of Object.entries(badges)) {
        const badge = refs.ranges[key + 'Badge'];
        if (badge) {
          badge.hidden = !on;
          badge.textContent = on ? '1' : '';
        }
      }
    }

    // ---- הרכבה

    const groupEls = groupDefs.map(multiGroup);
    const body = el(
      'div',
      { class: 'filter-panel' },
      el(
        'p',
        { class: 'filter-help' },
        t(
          'בתוך מסנן מספיק שאחד מהערכים מתאים (או). בין מסננים כולם חייבים להתאים (וגם). הספירה ליד כל ערך היא מה שיתקבל אם תבחרו בו, יחד עם שאר המסננים.',
        ),
      ),
      el(
        'div',
        { class: 'preset-row' },
        presetSelect,
        deletePreset,
        Ui.button(
          'text',
          t('שמירת ההגדרה הנוכחית…'),
          () => {
            presetForm.hidden = !presetForm.hidden;
            if (!presetForm.hidden) presetName.focus();
          },
          { icon: 'bookmark_multiple_24_regular', className: 'button-small' },
        ),
      ),
      presetForm,
      flagsGroup(),
      ...groupEls,
      seriesGroup(),
      rangeGroup(
        t('תאריך'),
        'date',
        dateField(t('מתאריך'), 'from'),
        dateField(t('עד תאריך'), 'to'),
      ),
      rangeGroup(
        t('טווח שנים'),
        'year',
        yearField(t('משנה'), 'from'),
        yearField(t('עד שנה'), 'to'),
      ),
      rangeGroup(
        t('עמודים'),
        'pages',
        numberField(t('לפחות עמודים'), 'pages', 'Min'),
        numberField(t('לכל היותר עמודים'), 'pages', 'Max'),
      ),
      rangeGroup(
        t('גודל קובץ (MB)'),
        'size',
        numberField(t('לפחות MB'), 'size', 'Min'),
        numberField(t('לכל היותר MB'), 'size', 'Max'),
      ),
    );
    refs.total = el('span', {}, '');
    const dlg = Ui.dialog({
      title: t('מסננים'),
      size: 'large',
      body,
      actions: [
        Ui.button('text', t('איפוס המסננים'), () => commit({}), { key: 'reset' }),
        Ui.button('filled', '', () => dlg.close('done'), { key: 'done' }),
      ],
      focus: '[data-key="done"]',
      onClose: () => clearTimeout(timer),
    });
    dlg.el.querySelector('[data-key="done"]').appendChild(refs.total);
    drawPresets();
    sync();
    for (const group of refs.groups.values())
      if (group.badge.textContent !== '0' && !group.badge.hidden) group.details.open = true;
    computeCounts();
    return dlg;
  }

  A.FilterUi = { chipLabel, chipsRow, openPanel, FLAG_LABELS };
  if (typeof module === 'object' && module.exports) module.exports = A.FilterUi;
})(typeof self !== 'undefined' ? self : globalThis);
