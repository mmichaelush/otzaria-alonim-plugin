// הגדרות: כללי סינון (עם סימולציה לפני הוספה) ובריאות המקורות. נטען אחרי alonim-ui-settings.js.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const I18n = A.I18n;
  const Rules = A.Rules;
  const { el, icon } = Ui;
  const { field } = A.SettingsHelpers;
  const t = (text, vars) => I18n.t(text, vars);

  /** שיטות של `SettingsScreen` (מצורפות לאב-טיפוס שלו). */
  Object.assign(
    A.SettingsScreen.prototype,
    /** @type {any} */ ({
      rulesBody() {
        const { app } = this;
        const st = app.state;
        const names = app.ruleNames();
        const out = [];
        out.push(
          el(
            'p',
            { class: 'setting-text' },
            t(
              'כללים קובעים אילו גיליונות מוצגים. סדר ההכרעה: חסימה מפורשת, הרשאה מפורשת, כלל סדרה, כלל מקור/שפה/חוג/תבנית, ברירת מחדל.',
            ),
          ),
        );
        out.push(
          field(
            t('מצב'),
            A.BrowseHelpers.selectField(
              t('מצב כללי הסינון'),
              [
                { value: 'blacklist', label: t('להסתיר רק מה שנחסם') },
                { value: 'whitelist', label: t('להציג רק מה שהותר') },
              ],
              st.rules.mode,
              (v) => st.setRulesMode(v),
            ),
          ),
        );
        const list = st.rules.rules;
        if (!list.length)
          out.push(
            el(
              'p',
              { class: 'setting-help' },
              t('אין כללים. אפשר להוסיף כלל כאן, או לבחור "הסתר סדרה זו" בכרטיס.'),
            ),
          );
        else {
          out.push(
            el(
              'ul',
              { class: 'rule-list' },
              list.map((rule) =>
                el(
                  'li',
                  { class: 'rule-row' },
                  el('span', { class: 'rule-text', dir: 'auto' }, Rules.describe(rule, names)),
                  Ui.iconButton('delete_24_regular', t('מחיקת הכלל'), () => {
                    const removed = st.removeRule(rule.id);
                    app.toast(t('הכלל נמחק'), {
                      action: { label: t('ביטול הפעולה'), run: () => st.addRule(removed) },
                    });
                  }),
                ),
              ),
            ),
          );
        }
        out.push(this.ruleForm());
        return out;
      },

      ruleForm() {
        const { app } = this;
        const d = this.draft;
        const sel = A.BrowseHelpers.selectField;
        const FIELD_OPTIONS = ['source', 'lang', 'circle', 'seriesText', 'pattern'];
        const facets = app.index.facets();
        const sourceOpts = app.allSources().map((s) => ({ value: s.id, label: s.name }));
        const langOpts = Core.LANG_CODES.map((l) => ({ value: l, label: Core.langName(l) }));
        const circleOpts = [...facets.circles.keys()].sort().map((c) => ({ value: c, label: c }));
        let valueControl;
        const choice = { source: sourceOpts, lang: langOpts, circle: circleOpts }[d.field];
        const simBox = el('div', { class: 'simulation', 'aria-live': 'polite' });
        const refreshSim = () => this.simulate(simBox);
        if (choice) {
          if (!choice.some((o) => o.value === d.value)) d.value = choice[0] ? choice[0].value : '';
          valueControl = sel(
            t('ערך'),
            choice,
            d.value,
            (v) => {
              d.value = v;
              refreshSim();
            },
            'select-value',
          );
        } else {
          valueControl = el('input', {
            class: 'input',
            type: 'text',
            name: 'rule-value',
            value: d.value,
            placeholder: d.field === 'seriesText' ? t('חלק משם הסדרה') : t('טקסט שמופיע בשם'),
            maxlength: '120',
            dir: 'auto',
            'aria-label': t('ערך'),
            oninput: (e) => {
              d.value = e.target.value;
              refreshSim();
            },
          });
        }
        const form = el(
          'form',
          {
            class: 'rule-form',
            onsubmit: (e) => {
              e.preventDefault();
              const rule = app.state.addRule({ action: d.action, field: d.field, value: d.value });
              if (!rule) return;
              d.value = choice ? d.value : '';
              app.toast(t('הכלל נוסף'));
            },
          },
          el('h3', { class: 'details-section' }, t('כלל חדש')),
          el(
            'div',
            { class: 'rule-grid' },
            sel(
              t('פעולה'),
              Rules.ACTIONS.map((a) => ({ value: a, label: t(Rules.ACTION_LABELS[a]) })),
              d.action,
              (v) => {
                d.action = v;
                refreshSim();
              },
            ),
            sel(
              t('לפי'),
              FIELD_OPTIONS.map((f) => ({ value: f, label: t(Rules.FIELD_LABELS[f]) })),
              d.field,
              (v) => {
                d.field = v;
                d.value = '';
                this.render();
              },
            ),
            valueControl,
          ),
          simBox,
          Ui.button('filled', t('הוספת כלל'), () => form.requestSubmit(), {
            icon: 'add_24_regular',
            className: 'button-small',
            disabled: !d.value,
          }),
        );
        setTimeout(refreshSim, 0);
        return form;
      },

      /** "כלל זה יסתיר N גיליונות" + דוגמאות, לפני ההוספה. */
      simulate(box) {
        const { app } = this;
        const d = this.draft;
        if (!d.value) {
          Ui.fill(
            box,
            el('p', { class: 'setting-help' }, t('בחרו ערך כדי לראות כמה גיליונות הכלל ישנה.')),
          );
          return;
        }
        const sim = app.index.simulate({ action: d.action, field: d.field, value: d.value }, 4);
        let text;
        if (d.action === 'hide' || d.action === 'show') {
          text =
            d.action === 'hide'
              ? t('כלל זה יסתיר {n} גיליונות', { n: Core.formatCount(sim.hides) })
              : t('כלל זה יציג {n} גיליונות שמוסתרים עכשיו', { n: Core.formatCount(sim.shows) });
          if (sim.total === 0) text = t('הכלל לא ישנה דבר בגיליונות שנטענו');
        } else text = t('כלל זה יחול על {n} גיליונות', { n: Core.formatCount(sim.total) });
        Ui.fill(
          box,
          el('p', { class: 'setting-text' }, icon('info_24_regular'), text),
          sim.examples.length
            ? el(
                'ul',
                { class: 'example-list' },
                sim.examples.map((it) =>
                  el(
                    'li',
                    { dir: 'auto' },
                    (it.seriesTitle || it.title) +
                      ' · ' +
                      (Core.weekLabel(it) || Core.dateText(it.date, { short: true })),
                  ),
                ),
              )
            : null,
          !app.catalog.syncing && app.catalog.shards.length > app.catalog.status.shardsLoaded
            ? el('p', { class: 'setting-help' }, t('חלק מהנתונים עוד נטענים, והמספר עשוי לגדול.'))
            : null,
        );
      },

      sourcesBody() {
        const { app } = this;
        const rows = app.allSources().map((s) =>
          el(
            'li',
            { class: 'source-row' },
            el(
              'div',
              { class: 'source-main' },
              el('strong', { dir: 'auto' }, s.name),
              Ui.chip(A.Dialogs.statusText(s.status), {
                kind: s.status === 'ok' ? 'done' : 'warn',
              }),
              s.mode === 'link'
                ? Ui.chip(t('קישור בלבד'), { kind: 'warn', icon: 'open_24_regular' })
                : null,
            ),
            el(
              'p',
              { class: 'setting-help' },
              [
                s.issueCount ? t('{n} גיליונות', { n: Core.formatCount(s.issueCount) }) : '',
                s.checkedAt ? t('נבדק: {when}', { when: Core.formatStamp(s.checkedAt) }) : '',
              ]
                .filter(Boolean)
                .join(' · '),
            ),
            s.note ? el('p', { class: 'setting-help', dir: 'auto' }, s.note) : null,
            s.url
              ? Ui.button('text', t('לאתר המקור'), () => app.openSite({ src: s.id }), {
                  icon: 'open_24_regular',
                  className: 'button-small',
                })
              : null,
          ),
        );
        return [
          el('ul', { class: 'source-list' }, rows),
          el(
            'p',
            { class: 'setting-help' },
            t('מקור במצב "קישור בלבד" אינו מאפשר הורדה אוטומטית: הגיליונות שלו נפתחים באתר המקור.'),
          ),
        ];
      },
    }),
  );
})(typeof self !== 'undefined' ? self : globalThis);
