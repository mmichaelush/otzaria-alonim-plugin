// פרטי גיליון (כל העותקים, בחירת מקור) ושאר הדיאלוגים של התוסף: הוספה לאוסף,
// כשל הורדה, בחירת תיקייה וקיצורי מקלדת. הכול בתוך הדף, בלי חלונות מערכת.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Cards = A.Cards;
  const Core = A.Core;
  const I18n = A.I18n;
  const Rules = A.Rules;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  const STATUS_LABELS = { ok: 'תקין', degraded: 'חלקי', blocked: 'חסום', down: 'לא זמין', disabled: 'כבוי' };
  const N = (s) => s;
  const STATUS_TEXT = Object.freeze({ ok: N('תקין'), degraded: N('חלקי'), blocked: N('חסום'), down: N('לא זמין'), disabled: N('כבוי') });
  void STATUS_LABELS;

  const statusText = (status) => (STATUS_TEXT[status] ? t(STATUS_TEXT[status]) : status);

  function fact(label, value) {
    if (!value) return null;
    return [el('dt', {}, label), el('dd', { dir: 'auto' }, value)];
  }

  // ------------------------------------------------------------- פרטים

  function showDetails(app, item, ctx) {
    const state = app.cardState(item);
    const decision = app.index.decision(item);
    const series = app.index.seriesById.get(item.series);
    const title = Cards.titleOf(item);
    const meta = Cards.metaParts(item).join(' · ');
    const preferred = app.state.preferredSource(item.series);

    const assetRows = item.assets.map((asset) => {
      const info = app.sourceInfo(asset.src);
      const downloadable = asset.url && Core.isDownloadUrl(asset.url);
      const limited = !asset.url || info.mode === 'link' || info.status === 'blocked';
      const facts = [asset.pages ? t('{n} עמ׳', { n: asset.pages }) : '', Core.formatBytes(asset.bytes), asset.downloads ? t('{n} הורדות', { n: Core.formatCount(asset.downloads) }) : ''].filter(Boolean).join(' · ');
      return el(
        'li',
        { class: 'asset-row' + (preferred === asset.src ? ' is-preferred' : '') },
        el(
          'div',
          { class: 'asset-main' },
          el('strong', { class: 'asset-name', dir: 'auto' }, info.name),
          preferred === asset.src ? Ui.chip(t('המקור המועדף'), { kind: 'done' }) : null,
          info.status !== 'ok' ? Ui.chip(statusText(info.status), { kind: 'warn' }) : null,
          limited ? Ui.chip(t('קישור לאתר בלבד'), { kind: 'warn', icon: 'open_24_regular' }) : null,
          el('span', { class: 'asset-facts' }, facts),
          limited && info.note ? el('p', { class: 'asset-note', dir: 'auto' }, info.note) : null,
          !downloadable && asset.url && !limited ? el('p', { class: 'asset-note' }, t('כתובת הקובץ טרם אושרה באוצריא: אפשר לפתוח באתר המקור.')) : null,
        ),
        el(
          'div',
          { class: 'asset-actions' },
          downloadable ? Ui.button('tonal', t('הורדה מהמקור הזה'), () => { dlg.close(); app.download(item, asset.src); }, { icon: 'arrow_download_24_regular', className: 'button-small' }) : null,
          item.assets.length > 1 && preferred !== asset.src ? Ui.button('text', t('הפוך למועדף'), () => { app.state.setSeries(item.series, { src: asset.src }); dlg.close(); showDetails(app, item, ctx); }, { className: 'button-small' }) : null,
          Ui.button('text', t('באתר המקור'), () => app.openSite(asset), { icon: 'open_24_regular', className: 'button-small' }),
        ),
      );
    });

    const facts = el(
      'dl',
      { class: 'facts' },
      fact(t('פרשה'), Core.parashaLabel(item.parasha)),
      fact(t('אירוע'), item.event ? Core.eventName(item.event) : ''),
      fact(t('שנה'), item.hy ? Core.hyLetters(item.hy) + ' (' + item.hy + ')' : ''),
      fact(t('תאריך השבת'), item.date ? (Core.parseYmd(item.date) ? Core.hebrewDate(Core.parseYmd(item.date), I18n.language) + ' · ' + Core.formatDate(Core.parseYmd(item.date)) : item.date) : ''),
      fact(t('גיליון'), item.no ? String(item.no) : ''),
      fact(t('שפה'), Core.langName(item.lang)),
      fact(t('חוג'), series && series.circle),
      fact(t('נוסף לקטלוג'), item.added ? Core.formatDate(new Date(item.added)) : ''),
      fact(t('עמודים'), item.pages ? String(item.pages) : ''),
    );

    const reasonLine = decision.rule || (state.hidden ? true : false)
      ? el('p', { class: 'reason-line' }, icon(state.hidden ? 'eye_off_24_regular' : 'info_24_regular'), Rules.reasonText(decision, app.ruleNames(), app.state.rules.mode))
      : null;

    const dlg = Ui.dialog({
      title,
      size: 'large',
      body: el(
        'div',
        { class: 'details' },
        el('p', { class: 'details-meta', dir: 'auto' }, meta),
        el('div', { class: 'details-chips' }, [state.isNew ? Ui.chip(t('חדש'), { kind: 'new' }) : null, state.downloaded ? Ui.chip(t('הורד'), { kind: 'done', icon: 'checkmark_24_regular' }) : null, state.hidden ? Ui.chip(t('מוסתר'), { kind: 'hidden', icon: 'eye_off_24_regular' }) : null]),
        reasonLine,
        el('div', { class: 'details-primary' },
          Ui.button('filled', t('קריאה'), () => { dlg.close(); app.openIssue(item, ctx); }, { icon: 'book_open_24_regular', key: 'read' }),
          Ui.button('tonal', state.downloaded ? t('הורד') : t('הורדה'), () => { dlg.close(); app.download(item); }, { icon: state.downloaded ? 'checkmark_circle_24_filled' : 'arrow_download_24_regular', disabled: state.downloaded }),
          Ui.button('tonal', t('הדפסה'), () => { dlg.close(); app.print(item, ctx); }, { icon: 'document_pdf_24_regular' }),
        ),
        el('h3', { class: 'details-section' }, t('העותקים הזמינים'), el('span', { class: 'section-count' }, String(item.assets.length))),
        item.assets.length ? el('ul', { class: 'asset-list' }, assetRows) : el('p', { class: 'asset-note' }, t('אין עותקים בקטלוג לגיליון הזה.')),
        item.assets.length > 1 ? el('p', { class: 'asset-note' }, t('יש עותקים נוספים. ההורדה והקריאה משתמשות במקור המועדף של הסדרה, ואם אין — בעותק הראשון.')) : null,
        facts,
        el(
          'div',
          { class: 'details-more' },
          Ui.button('text', state.favorite ? t('הסר ממועדפים') : t('הוסף למועדפים'), () => { app.toggleFavorite(item); dlg.close(); }, { icon: state.favorite ? 'star_24_filled' : 'star_24_regular', className: 'button-small' }),
          Ui.button('text', state.read ? t('סמן כלא נקרא') : t('סמן כנקרא'), () => { app.toggleRead(item); dlg.close(); }, { icon: 'checkmark_24_regular', className: 'button-small' }),
          Ui.button('text', t('הוסף לאוסף…'), () => { dlg.close(); app.addToListDialog(item); }, { icon: 'bookmark_multiple_24_regular', className: 'button-small' }),
          Ui.button('text', state.followed ? t('הפסק לעקוב אחרי הסדרה') : t('עקוב אחרי הסדרה'), () => { app.toggleFollow(item.series); dlg.close(); }, { icon: 'alert_24_regular', className: 'button-small' }),
          Ui.button('text', t('לדף הסדרה'), () => { dlg.close(); app.openSeries(item.series); }, { icon: 'text_bullet_list_24_regular', className: 'button-small' }),
          Ui.button('text', t('הסתר סדרה זו'), () => { dlg.close(); app.hideSeries(item); }, { icon: 'eye_off_24_regular', className: 'button-small' }),
        ),
      ),
      focus: '[data-key="read"]',
    });
    return dlg;
  }

  // -------------------------------------------------------- הוספה לאוסף

  function addToList(app, item) {
    const lists = app.state.lists;
    const body = el('div', { class: 'choose-list' });
    const dlg = Ui.dialog({ title: t('הוספה לאוסף'), size: 'small', body });
    const draw = () => {
      const rows = lists.map((l) => {
        const has = l.entries.some((e) => e.id === item.id);
        return el('button', { type: 'button', class: 'choice-row', onclick: () => { if (has) app.state.removeFromList(l.id, item.id); else app.quickAddToList(l.id, item); dlg.close(); } }, icon(has ? 'checkmark_circle_24_filled' : 'circle_24_regular'), el('span', { class: 'choice-text', dir: 'auto' }, l.kind === 'shabbat' ? t('אוסף שבת') : l.name), el('span', { class: 'section-count' }, String(l.entries.length)));
      });
      const input = el('input', { class: 'input', type: 'text', placeholder: t('שם לרשימה חדשה'), maxlength: '80', 'aria-label': t('שם לרשימה חדשה'), dir: 'auto' });
      const form = el('form', { class: 'new-list', onsubmit: (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        const list = app.state.createList(name);
        if (list) app.quickAddToList(list.id, item);
        dlg.close();
      } }, input, Ui.button('filled', t('יצירה והוספה'), () => form.requestSubmit(), { className: 'button-small' }));
      body.replaceChildren(...rows, form);
    };
    if (!lists.some((l) => l.kind === 'shabbat')) app.state.createList(t('אוסף שבת'), 'shabbat');
    draw();
  }

  // ------------------------------------------------------- כשל הורדה

  function downloadFailed(app, item, code) {
    const actions = [];
    const title = Cards.titleOf(item);
    const dlg = Ui.dialog({
      title: t('ההורדה לא הושלמה'),
      size: 'small',
      body: el('div', { class: 'failure' }, el('p', { class: 'dialog-text', dir: 'auto' }, title), el('p', { class: 'dialog-text' }, app.fileErrorText(code)), el('p', { class: 'failure-code' }, t('קוד: {code}', { code }))),
      actions,
    });
    const siteable = ['blocked', 'no_direct_link', 'failed', 'timeout', 'not_pdf', 'truncated'].includes(code);
    actions.push(Ui.button('text', t('סגירה'), () => dlg.close()));
    if (siteable) actions.push(Ui.button('tonal', t('פתח באתר המקור'), () => { dlg.close(); app.openSiteFor(item); }, { icon: 'open_24_regular' }));
    if (code === 'no_folder' || code === 'permission') actions.push(Ui.button('filled', t('בחירת תיקייה'), () => { dlg.close(); app.emit('need-folder', {}); }, { icon: 'folder_open_24_regular' }));
    if (!['blocked', 'no_direct_link', 'no_folder', 'permission'].includes(code)) {
      actions.push(Ui.button('filled', t('ניסיון חוזר'), () => { dlg.close(); const job = app.files.jobFor(item); if (job) app.files.retry(job.id); else app.download(item); }, { icon: 'arrow_clockwise_24_regular' }));
    }
    const host = dlg.el.querySelector('.dialog-actions');
    if (!host) dlg.el.appendChild(el('footer', { class: 'dialog-actions' }, actions));
    else host.replaceChildren(...actions);
    return dlg;
  }

  // ---------------------------------------------------- בחירת תיקייה

  /**
   * בחירת תיקייה בלחיצה (אוצריא דורשת מחוות משתמש). `then` רץ אחרי בחירה
   * מוצלחת, כך ש"הורדה" שהתחילה בלי תיקייה ממשיכה לבד.
   */
  function needFolder(app, then) {
    const msg = el('p', { class: 'dialog-text' }, t('הגיליונות נשמרים בתיקייה אחת שתבחרו, לפי שנה וסדרה. אוצריא תבקש אישור לגישה קבועה אליה. מומלץ ליצור תיקייה ייעודית, למשל "עלוני שבת" תחת "מסמכים".'));
    const err = el('p', { class: 'dialog-error', role: 'alert', hidden: true });
    const dlg = Ui.dialog({
      title: t('בחירת תיקיית עלונים'),
      size: 'small',
      body: el('div', {}, msg, err),
      actions: [
        Ui.button('text', t('ביטול'), () => dlg.close('cancel')),
        Ui.button('filled', t('בחירת תיקייה'), async () => {
          try {
            const result = await app.files.pickFolder();
            if (result.cancelled) return;
            dlg.close('ok');
            app.toast(t('התיקייה נבחרה: {name}', { name: result.folder.name }));
            app.files.scan();
            if (then) then();
          } catch (error) {
            err.hidden = false;
            err.textContent = app.fileErrorText(error.code === 'permission' ? 'permission' : error.code === 'forbidden_folder' ? 'forbidden_folder' : 'pick_failed');
          }
        }, { icon: 'folder_open_24_regular', key: 'pick' }),
      ],
      focus: '[data-key="pick"]',
    });
    return dlg;
  }

  // ------------------------------------------------------- קיצורי מקלדת

  const SHORTCUTS = [
    ['Ctrl+K', N('חיפוש')],
    ['/', N('חיפוש (כשאין שדה פעיל)')],
    ['Esc', N('סגירה, חזרה, ניקוי חיפוש')],
    ['↑ ↓ ← →', N('מעבר בין כרטיסים ברשימה')],
    ['Enter', N('קריאה בגיליון שנבחר')],
    ['D', N('הורדה')],
    ['P', N('הדפסה')],
    ['S', N('מועדף')],
    ['I', N('פרטי הגיליון')],
    ['?', N('חלון זה')],
  ];

  function shortcuts() {
    const dlg = Ui.dialog({
      title: t('קיצורי מקלדת'),
      size: 'small',
      body: el('dl', { class: 'facts shortcuts' }, SHORTCUTS.map(([key, label]) => [el('dt', {}, el('kbd', {}, key)), el('dd', {}, t(label))])),
      actions: [Ui.button('filled', t('סגירה'), () => dlg.close(), { key: 'close' })],
      focus: '[data-key="close"]',
    });
    return dlg;
  }

  A.Dialogs = { showDetails, addToList, downloadFailed, needFolder, shortcuts, statusText };
  if (typeof module === 'object' && module.exports) module.exports = A.Dialogs;
})(typeof self !== 'undefined' ? self : globalThis);
