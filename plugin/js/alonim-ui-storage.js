// "אחסון ומטמון": מטמון הקטלוג, הקבצים שהורדו (לפי תאריך), ניקוי קבצים ישנים בלי
// לגעת במועדפים ובאוספים, וקבצי הקריאה הזמניים. החישובים ב-`alonim-storage.js`.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const Storage = A.Storage;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  const AGES = [30, 60, 90, 180, 365];
  const PAGE = 25;

  /** שם קריא לקובץ שהורד: מהגיליון בקטלוג, ואם לא נטען — משם הקובץ. */
  function titleOf(app, row) {
    const item = app.index.byFragment(row.fragment);
    if (item)
      return [
        item.seriesTitle || item.title,
        Core.weekLabel(item),
        item.hy ? Core.hyLetters(item.hy) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    return row.entry.name.replace(/ \[[0-9a-f]{8}\]\.pdf$/i, '');
  }

  function monthLabel(key) {
    if (!key) return t('ללא תאריך');
    const [y, m] = key.split('-').map(Number);
    return Core.formatDate(new Date(y, m - 1, 1, 12), { month: 'long', year: 'numeric' });
  }

  /** המזהים הקצרים של כל מה שהמשתמש שמר במפורש: מועדפים וגיליונות באוספים. */
  function protectedSet(app) {
    const ids = app.state.favoriteSnaps().map((s) => s.id);
    for (const list of app.state.lists) for (const entry of list.entries) ids.push(entry.id);
    return Storage.protectedFragments(ids, (id) => app.index.previousIdsOf(id));
  }

  function catalogBlock(app) {
    const holder = el('div', { class: 'disk-usage' });
    app.catalog.usage().then((u) => {
      const p = u.quota ? Math.min(100, Math.round((u.used / u.quota) * 100)) : 0;
      Ui.fill(
        holder,
        el(
          'p',
          { class: 'setting-text' },
          t('מטמון הקטלוג: {used} מתוך {quota}', {
            used: Core.formatBytes(u.used) || '0',
            quota: Core.formatBytes(u.quota) || '—',
          }),
        ),
        Ui.progress(p, t('מטמון הקטלוג')),
      );
    });
    const s = app.catalog.status;
    return [
      el('h3', { class: 'details-section' }, t('מטמון הקטלוג')),
      holder,
      el(
        'p',
        { class: 'setting-help' },
        t(
          '{n} גיליונות בזיכרון ({loaded}/{total} קבצי שנים). המטמון מאפשר עבודה בלי רשת, וכשהוא מתמלא התוסף מסיר לבד שנים ישנות שלא נעשה בהן שימוש. קבצים שהורדתם אינם נוגעים בו.',
          { n: Core.formatCount(app.index.size), loaded: s.shardsLoaded, total: s.shardsTotal },
        ),
      ),
      Ui.button(
        'tonal',
        t('ניקוי מטמון הקטלוג'),
        () =>
          Ui.confirmDialog({
            title: t('ניקוי המטמון'),
            text: t('הקטלוג יורד מחדש בסנכרון הבא. ההגדרות, המועדפים והקבצים שהורדתם לא ייפגעו.'),
            confirmLabel: t('ניקוי'),
            danger: true,
            onConfirm: async () => {
              try {
                await app.catalog.clearCache();
                app.toast(t('המטמון נוקה'));
                app.catalog.sync();
              } catch (error) {
                app.toast(t('הניקוי נכשל'), { error: true });
              }
            },
          }),
        { icon: 'delete_24_regular', className: 'button-small' },
      ),
    ];
  }

  function downloadsBlock(app, rerender) {
    const files = app.files;
    const out = [el('h3', { class: 'details-section' }, t('קבצים שהורדו'))];
    if (!files.hasFolder) {
      out.push(el('p', { class: 'setting-help' }, t('עוד לא נבחרה תיקייה, ולכן אין קבצים להצגה.')));
      return out;
    }
    const list = Storage.rows(files.disk);
    const total = list.reduce((n, r) => n + r.size, 0);
    out.push(
      el(
        'p',
        { class: 'setting-text' },
        t('{n} קבצים · {size}', {
          n: Core.formatCount(list.length),
          size: Core.formatBytes(total) || '0',
        }),
      ),
    );
    if (!list.length) return out;

    // ניקוי לפי גיל
    const v = app.view.settings;
    v.cleanDays = v.cleanDays || 90;
    const guard = protectedSet(app);
    const plan = Storage.cleanupPlan(list, { days: v.cleanDays, protectedFragments: guard });
    const preview = el('p', { class: 'setting-help', 'aria-live': 'polite' });
    const drawPreview = () => {
      const p = Storage.cleanupPlan(list, { days: v.cleanDays, protectedFragments: guard });
      preview.textContent = p.remove.length
        ? t('יימחקו {n} קבצים ({size}). {k} קבצים ישנים נשארים כי הם במועדפים או באוספים.', {
            n: Core.formatCount(p.remove.length),
            size: Core.formatBytes(p.bytes) || '0',
            k: p.protectedRows.length,
          })
        : t('אין קבצים ישנים מ-{n} ימים למחיקה.', { n: v.cleanDays });
    };
    const agePicker = Ui.selectField(
      t('גיל הקבצים למחיקה'),
      AGES.map((n) => ({ value: n, label: t('ישנים מ-{n} ימים', { n }) })),
      v.cleanDays,
      (value) => {
        v.cleanDays = Number(value);
        rerender();
      },
    );
    const cleanButton = Ui.button(
      'tonal',
      t('מחיקת קבצים ישנים'),
      () => {
        const now = Storage.cleanupPlan(Storage.rows(files.disk), {
          days: v.cleanDays,
          protectedFragments: protectedSet(app),
        });
        if (!now.remove.length) return;
        Ui.confirmDialog({
          title: t('מחיקת קבצים ישנים'),
          text: t(
            'למחוק {n} קבצים ({size}) שהורדו לפני יותר מ-{days} ימים? מועדפים וגיליונות באוספים לא יימחקו, ואפשר להוריד כל קובץ שוב.',
            {
              n: Core.formatCount(now.remove.length),
              size: Core.formatBytes(now.bytes) || '0',
              days: v.cleanDays,
            },
          ),
          confirmLabel: t('מחיקה'),
          danger: true,
          onConfirm: async () => {
            let removed = 0;
            let failed = 0;
            for (const row of now.remove) {
              try {
                if (await files.deleteDownloaded(row.fragment)) removed++;
              } catch (error) {
                failed++;
              }
            }
            app.toast(
              failed
                ? t('נמחקו {n} קבצים, {k} נכשלו', { n: removed, k: failed })
                : t('נמחקו {n} קבצים', { n: removed }),
              { error: Boolean(failed) },
            );
          },
        });
      },
      { icon: 'delete_24_regular', className: 'button-small', disabled: !plan.remove.length },
    );
    drawPreview();
    out.push(el('div', { class: 'setting-actions' }, agePicker, cleanButton), preview);

    // הרשימה לפי תאריך (חודשים), בעמודים
    const limit = v.storageMore || PAGE;
    const shown = list.slice(0, limit);
    const groups = Storage.groupByMonth(shown);
    const body = el('div', {
      class: 'compact-list',
      role: 'list',
      'aria-label': t('הקבצים שהורדו'),
    });
    for (const group of groups) {
      body.appendChild(
        el(
          'h4',
          { class: 'history-day', role: 'presentation' },
          monthLabel(group.key),
          ' · ',
          Core.formatBytes(group.bytes),
        ),
      );
      for (const row of group.rows) {
        body.appendChild(
          el(
            'div',
            { class: 'history-row', role: 'listitem' },
            el(
              'span',
              { class: 'history-open is-static' },
              icon('document_pdf_24_regular'),
              el(
                'span',
                { class: 'compact-title', dir: 'auto' },
                titleOf(app, row),
                guard.has(row.fragment) ? el('span', { class: 'history-kind' }, t('מוגן')) : null,
              ),
              el('span', { class: 'compact-meta' }, row.ts ? Core.formatStamp(row.ts) : ''),
              el('span', { class: 'history-time' }, Core.formatBytes(row.size)),
            ),
            Ui.iconButton(
              'delete_24_regular',
              t('מחיקת קובץ'),
              () =>
                Ui.confirmDialog({
                  title: t('מחיקת קובץ'),
                  text: t('למחוק את "{name}" מהתיקייה? אפשר להוריד אותו שוב בכל עת.', {
                    name: titleOf(app, row),
                  }),
                  confirmLabel: t('מחיקה'),
                  danger: true,
                  onConfirm: async () => {
                    try {
                      await files.deleteDownloaded(row.fragment);
                      app.toast(t('הקובץ נמחק'));
                    } catch (error) {
                      app.toast(t('המחיקה נכשלה'), { error: true });
                    }
                  },
                }),
              { className: 'history-remove' },
            ),
          ),
        );
      }
    }
    out.push(body);
    if (list.length > limit)
      out.push(
        Ui.button(
          'outlined',
          t('הצג עוד'),
          () => {
            v.storageMore = limit + PAGE;
            rerender();
          },
          { className: 'button-small' },
        ),
      );
    return out;
  }

  function readCacheBlock(app) {
    const holder = el('p', { class: 'setting-help' }, t('בודק…'));
    const button = Ui.button(
      'text',
      t('ניקוי קבצי הקריאה הזמניים'),
      async () => {
        const n = await app.files.clearReadCache();
        app.toast(t('נמחקו {n} קבצים זמניים', { n }));
        draw();
      },
      { icon: 'delete_24_regular', className: 'button-small', disabled: true },
    );
    function draw() {
      app.files.readCacheInfo().then((info) => {
        holder.textContent = info.count
          ? t(
              '{n} קבצים זמניים ({size}). קריאה בגיליון שלא הורד שומרת אותו כאן, והתוסף משאיר רק את האחרונים.',
              { n: info.count, size: Core.formatBytes(info.bytes) || '0' },
            )
          : t('אין קבצי קריאה זמניים.');
        button.disabled = !info.count;
      });
    }
    if (app.files.hasFolder) draw();
    else holder.textContent = t('עוד לא נבחרה תיקייה.');
    return [el('h3', { class: 'details-section' }, t('קבצי קריאה זמניים')), holder, button];
  }

  /** גוף הסעיף. [rerender]: ציור מחדש של הסעיף אחרי שינוי. */
  function body(app, rerender) {
    return [...catalogBlock(app), ...downloadsBlock(app, rerender), ...readCacheBlock(app)];
  }

  A.StorageUi = { body, titleOf, monthLabel, protectedSet };
  if (typeof module === 'object' && module.exports) module.exports = A.StorageUi;
})(typeof self !== 'undefined' ? self : globalThis);
