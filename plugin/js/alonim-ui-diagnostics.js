// מסך "אבחון" (בהגדרות): יכולות המארח, מצב הקטלוג והקבצים, ויומן עם סינון והעתקה.
// מיועד למי שבודק או מדווח על תקלה; כל מה שמועתק עובר ניקוי נתיבים.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const I18n = A.I18n;
  const { el } = Ui;
  const t = (text, vars) => I18n.t(text, vars);
  const N = (text) => text;

  /** למה היכולת זמינה או לא, בעברית. */
  const SOURCE_TEXT = Object.freeze({
    version: N('לפי גרסת המארח'),
    'old-version': N('גרסת המארח ישנה'),
    'unknown-version': N('גרסת המארח לא ידועה'),
    learned: N('נלמד מכשל בקריאה'),
    override: N('כבוי ידנית (תאימות לאחור)'),
  });

  const LEVEL_LABEL = Object.freeze({
    debug: N('הכול'),
    info: N('מידע ומעלה'),
    warn: N('אזהרות ושגיאות'),
    error: N('שגיאות בלבד'),
  });

  function kv(rows) {
    return el(
      'dl',
      { class: 'facts diag-facts' },
      rows.filter(Boolean).map(([k, v]) => [el('dt', {}, k), el('dd', { dir: 'auto' }, String(v))]),
    );
  }

  function hostBlock(app, rerender) {
    const snap = A.Diagnostics.snapshot(app);
    const table = el(
      'table',
      { class: 'diag-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, t('יכולת')),
          el('th', {}, t('שיטה')),
          el('th', {}, t('מצב')),
          el('th', {}, t('סיבה')),
        ),
      ),
      el(
        'tbody',
        {},
        snap.caps.map((c) =>
          el(
            'tr',
            {},
            el('td', {}, t(c.label)),
            el('td', { dir: 'ltr' }, c.method),
            el(
              'td',
              { class: c.available ? 'is-yes' : 'is-no' },
              c.available ? t('זמינה') : t('לא זמינה'),
            ),
            el(
              'td',
              {},
              (SOURCE_TEXT[c.source] ? t(SOURCE_TEXT[c.source]) : c.source) +
                (c.detail ? ' (' + c.detail + ')' : ''),
            ),
          ),
        ),
      ),
    );
    return [
      el('h3', { class: 'details-section' }, t('מארח ויכולות')),
      kv([
        [t('גרסת אוצריא'), snap.host.version || '?'],
        [t('מערכת הפעלה'), snap.host.platform || '?'],
        [t('הרשאות'), snap.host.permissions.join(', ') || '—'],
      ]),
      el('div', { class: 'table-scroll' }, table),
      el(
        'p',
        { class: 'setting-help' },
        t(
          'היכולות החדשות (קריאה בלי הורדה, מסך ההדפסה של אוצריא) זמינות מאוצריא 0.9.99. כשחסרות, התוסף עובד כמו קודם: Blob לקריאה, הורדה לתיקייה, והדפסה דרך הצפיין או הקורא.',
        ),
      ),
      el(
        'div',
        { class: 'setting-actions' },
        Ui.button(
          'text',
          t('בדיקת יכולות מחדש'),
          () => {
            app.caps.reset();
            rerender();
          },
          { icon: 'arrow_sync_24_regular', className: 'button-small' },
        ),
      ),
    ];
  }

  function catalogBlock(app) {
    const d = A.Diagnostics.snapshot(app);
    const when = (ms) => (ms ? Core.formatStamp(ms) : t('עוד לא'));
    return [
      el('h3', { class: 'details-section' }, t('קטלוג וקבצים')),
      kv([
        [t('מצב'), d.catalog.phase + (d.catalog.error ? ' (' + d.catalog.error + ')' : '')],
        [
          t('גרסת קטלוג'),
          d.catalog.catalogVersion + (d.catalog.generatedAt ? ' · ' + d.catalog.generatedAt : ''),
        ],
        [t('סנכרון אחרון תקין'), when(d.catalog.lastOkAt)],
        [
          t('גיליונות בזיכרון'),
          Core.formatCount(d.catalog.issues) +
            ' · ' +
            t('קבצי שנים {a}/{b}', { a: d.catalog.shardsLoaded, b: d.catalog.shardsTotal }),
        ],
        [
          t('לוח שבועות'),
          d.catalog.weeksRows + ' · ' + t('ארכיון: {s}', { s: d.catalog.weeksArchive }),
        ],
        [t('תיקייה'), d.files.folder + ' · ' + t('{n} קבצים', { n: d.files.files })],
        [t('תור הורדות'), d.files.queued],
        [t('קבצים מרוחקים פתוחים'), d.files.remoteGrants],
        [t('החלפות מזהים'), d.catalog.aliases],
        [t('חיפוש אחרון'), d.perf.lastQueryMs + ' ms'],
        d.perf.memory ? [t('זיכרון'), d.perf.memory.usedMb + ' MB'] : null,
      ]),
    ];
  }

  function logBlock(app) {
    const log = app.log;
    const state = { level: 'info', cat: '' };
    const area = el('pre', {
      class: 'log-area',
      dir: 'ltr',
      tabindex: '0',
      'aria-label': t('יומן התוסף'),
    });
    const counts = el('p', { class: 'setting-help' });
    const draw = () => {
      const entries = log.filter({ level: state.level, cat: state.cat });
      const shown = entries.slice(-200);
      area.classList.toggle('is-empty', !shown.length);
      area.dir = shown.length ? 'ltr' : '';
      area.textContent = shown.length
        ? shown.map(A.Log.Log.format).join('\n')
        : t('אין אירועים להצגה.');
      const c = log.counts();
      counts.textContent = t('{n} אירועים ביומן · שגיאות {e} · אזהרות {w}', {
        n: log.entries.length,
        e: c.error,
        w: c.warn,
      });
      area.scrollTop = area.scrollHeight;
    };
    const levelSelect = Ui.selectField(
      t('רמת יומן'),
      A.Log.LEVELS.map((value) => ({ value, label: t(LEVEL_LABEL[value]) })),
      state.level,
      (value) => {
        state.level = value;
        draw();
      },
    );
    const catSelect = Ui.selectField(
      t('קטגוריית יומן'),
      [
        { value: '', label: t('כל הקטגוריות') },
        ...A.Log.CATEGORIES.map((value) => ({ value, label: value })),
      ],
      state.cat,
      (value) => {
        state.cat = value;
        draw();
      },
    );
    draw();
    return [
      el('h3', { class: 'details-section' }, t('יומן')),
      el('div', { class: 'setting-actions' }, levelSelect, catSelect),
      counts,
      area,
      el(
        'div',
        { class: 'setting-actions' },
        Ui.button(
          'tonal',
          t('העתקת הדיווח'),
          async () => {
            const text = A.Diagnostics.report(app, {
              filter: { level: state.level, cat: state.cat },
            });
            const ok = await A.Selection.copyToClipboard(text);
            app.toast(ok ? t('הדיווח הועתק (בלי נתיבים)') : t('ההעתקה נכשלה'), { error: !ok });
          },
          { icon: 'copy_24_regular', className: 'button-small' },
        ),
        Ui.button(
          'text',
          t('ניקוי היומן'),
          () => {
            log.clear();
            draw();
          },
          { icon: 'delete_24_regular', className: 'button-small' },
        ),
      ),
    ];
  }

  /** גוף הסעיף. [rerender]: ציור מחדש של הסעיף. */
  function body(app, rerender) {
    const legacy = app.state.prefs.legacyHost;
    return [
      ...hostBlock(app, rerender),
      el(
        'div',
        { class: 'setting-row' },
        el(
          'div',
          { class: 'setting-label' },
          el('span', { class: 'setting-name' }, t('תאימות לאחור')),
          el(
            'span',
            { class: 'setting-help' },
            t('מתעלם מהיכולות החדשות של אוצריא. לבדיקת מסלול המארח הישן; כבוי כברירת מחדל.'),
          ),
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'switch',
            role: 'switch',
            'aria-checked': String(legacy),
            'aria-label': t('תאימות לאחור'),
            onclick: () => app.state.setPref('legacyHost', !legacy),
          },
          el('span', { class: 'switch-thumb' }),
        ),
      ),
      ...catalogBlock(app),
      ...logBlock(app),
    ];
  }

  A.DiagnosticsUi = { body };
  if (typeof module === 'object' && module.exports) module.exports = A.DiagnosticsUi;
})(typeof self !== 'undefined' ? self : globalThis);
