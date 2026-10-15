// הגדרות: ייצוא וייבוא (גיבוי הגדרות, מועדפים, אוספים וכללים). נטען אחרי alonim-ui-settings.js.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const { copyText } = A.SettingsHelpers;
  const t = (text, vars) => I18n.t(text, vars);

  /** שיטות של `SettingsScreen` (מצורפות לאב-טיפוס שלו). */
  Object.assign(
    A.SettingsScreen.prototype,
    /** @type {any} */ ({
      backupBody() {
        const { app } = this;
        const exportArea = el('textarea', {
          class: 'input code-area',
          readonly: true,
          rows: '4',
          'aria-label': t('הגדרות מיוצאות'),
          dir: 'ltr',
          value: this.exportText,
        });
        exportArea.value = this.exportText;
        const importArea = el('textarea', {
          class: 'input code-area',
          rows: '4',
          'aria-label': t('הדבקת הגדרות לייבוא'),
          dir: 'ltr',
          placeholder: '{ "format": "otzaria-alonim-settings", … }',
        });
        importArea.value = this.importText;
        importArea.addEventListener('input', () => {
          this.importText = importArea.value;
        });
        const status = el('div', { class: 'import-status', role: 'status', 'aria-live': 'polite' });
        const drawPreview = () => {
          const p = this.importPreview;
          if (!p) return Ui.fill(status);
          if (!p.ok) {
            const reason = {
              empty: t('לא הודבק דבר.'),
              too_big: t('הקובץ גדול מדי.'),
              json: t('הטקסט אינו JSON תקין.'),
              format: t('זה אינו קובץ הגדרות של "עלוני שבת".'),
              too_new: t('הקובץ נוצר בגרסה חדשה יותר של התוסף. עדכנו את התוסף.'),
            }[p.error];
            Ui.fill(status, el('p', { class: 'setting-warn' }, icon('warning_24_regular'), reason));
            return;
          }
          const s = p.summary;
          Ui.fill(
            status,
            el(
              'p',
              { class: 'setting-text' },
              t(
                'נמצאו: {rules} כללים, {series} סדרות מסומנות, {favorites} מועדפים, {lists} רשימות.',
                s,
              ),
            ),
            el(
              'div',
              { class: 'setting-actions' },
              Ui.button(
                'filled',
                t('מיזוג עם הקיים'),
                () => {
                  app.state.applyImport(p, 'merge');
                  this.importPreview = null;
                  this.importText = '';
                  app.toast(t('ההגדרות יובאו'));
                  this.render();
                },
                { className: 'button-small' },
              ),
              Ui.button(
                'outlined',
                t('החלפת הקיים'),
                () =>
                  Ui.confirmDialog({
                    title: t('החלפת ההגדרות'),
                    text: t('המועדפים, הכללים והרשימות הקיימים יוחלפו בייבוא.'),
                    confirmLabel: t('החלפה'),
                    danger: true,
                    onConfirm: () => {
                      app.state.applyImport(p, 'replace');
                      this.importPreview = null;
                      this.importText = '';
                      app.toast(t('ההגדרות הוחלפו'));
                      this.render();
                    },
                  }),
                { className: 'button-small' },
              ),
            ),
          );
        };
        drawPreview();
        return [
          el(
            'p',
            { class: 'setting-text' },
            t(
              'ההגדרות, המועדפים, הכללים והרשימות נשמרים כטקסט JSON, להעברה למחשב אחר. תיקיית ההורדות אינה נכללת.',
            ),
          ),
          el(
            'div',
            { class: 'setting-actions' },
            Ui.button(
              'tonal',
              t('יצירת ייצוא'),
              () => {
                this.exportText = JSON.stringify(app.state.exportSettings(), null, 2);
                exportArea.value = this.exportText;
              },
              { icon: 'arrow_export_24_regular', className: 'button-small' },
            ),
            Ui.button(
              'text',
              t('העתקה'),
              async () => {
                if (!this.exportText)
                  this.exportText = exportArea.value = JSON.stringify(
                    app.state.exportSettings(),
                    null,
                    2,
                  );
                app.toast(
                  (await copyText(this.exportText, exportArea))
                    ? t('הועתק ללוח')
                    : t('ההעתקה נכשלה: סמנו את הטקסט והעתיקו ידנית'),
                  { error: false },
                );
              },
              { icon: 'copy_24_regular', className: 'button-small' },
            ),
          ),
          exportArea,
          el('h3', { class: 'details-section' }, t('ייבוא')),
          importArea,
          el(
            'div',
            { class: 'setting-actions' },
            Ui.button(
              'tonal',
              t('בדיקה'),
              () => {
                this.importPreview = app.state.previewImport(importArea.value);
                drawPreview();
              },
              { icon: 'arrow_import_24_regular', className: 'button-small' },
            ),
          ),
          status,
        ];
      },
    }),
  );
})(typeof self !== 'undefined' ? self : globalThis);
