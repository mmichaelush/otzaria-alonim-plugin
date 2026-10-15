// "הגדרות": תיקיית ההורדות, תור הורדות, הורדה אוטומטית, מקום בדיסק, כללי סינון
// (עם סימולציה), בריאות מקורות, מראה, ייצוא/ייבוא, ואודות ודיווח.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Core = A.Core;
  const I18n = A.I18n;
  const Rules = A.Rules;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  const SCALES = [0.85, 1, 1.15, 1.3, 1.5, 1.75];

  function field(label, control, help) {
    return el('div', { class: 'setting-row' }, el('div', { class: 'setting-label' }, el('span', { class: 'setting-name' }, label), help ? el('span', { class: 'setting-help' }, help) : null), control);
  }

  /** מתג (`role=switch`). */
  function toggle(label, on, onChange, help) {
    const b = el('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: () => onChange(!on) }, el('span', { class: 'switch-thumb' }));
    return field(label, b, help);
  }

  async function copyText(text, fallbackEl) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      try {
        fallbackEl.focus();
        fallbackEl.select();
        return document.execCommand('copy');
      } catch (inner) {
        return false;
      }
    }
  }

  const SECTION_IDS = ['folder', 'sync', 'queue', 'auto', 'disk', 'rules', 'sources', 'look', 'backup', 'about'];

  class SettingsScreen {
    constructor(app) {
      this.app = app;
      this.fill = false;
      this.unsub = [];
      this.open = new Set(app.view.settings.open || ['folder', 'sync', 'queue']);
      app.view.settings.open = this.open;
      this.draft = { action: 'hide', field: 'source', value: '' };
      this.exportText = '';
      this.importText = '';
      this.importPreview = null;
    }

    mount(host) {
      this.host = host;
      const { app } = this;
      this.unsub.push(
        app.on('files', () => this.refreshLive()),
        app.on('disk', () => this.render()),
        app.on('sync', () => this.refreshLive()),
        app.on('state', (d) => { if (!d.includes('read')) this.render(); }),
        // נתונים שמגיעים ברקע מרעננים רק את מה שתלוי בהם, לא את הטפסים.
        app.on('data', () => { this.refreshLive(); this.refreshSimulation(); }),
      );
      this.render();
      if (app.view.settings.section) {
        const id = app.view.settings.section;
        app.view.settings.section = '';
        this.open.add(id);
        this.render();
        const target = this.host.querySelector('[data-section="' + id + '"]');
        if (target) target.scrollIntoView({ block: 'start' });
      }
    }

    destroy() {
      for (const off of this.unsub) off();
    }

    refreshSimulation() {
      const box = this.host.querySelector('.simulation');
      if (box) this.simulate(box);
    }

    /** תור וסנכרון מתעדכנים בלי לבנות את הטפסים מחדש (לא לאבד מיקוד). */
    refreshLive() {
      const q = this.host.querySelector('[data-live="queue"]');
      if (q) q.replaceChildren(...this.queueRows());
      const s = this.host.querySelector('[data-live="sync"]');
      if (s) s.replaceChildren(...this.syncRows());
    }

    section(id, title, iconName, ...children) {
      const open = this.open.has(id);
      const bodyId = 'sec-' + id;
      const head = el(
        'button',
        { type: 'button', class: 'section-head', 'aria-expanded': String(open), 'aria-controls': bodyId, onclick: () => {
          if (this.open.has(id)) this.open.delete(id);
          else this.open.add(id);
          this.render();
          const again = this.host.querySelector('[data-section="' + id + '"] .section-head');
          if (again) again.focus();
        } },
        icon(iconName),
        el('span', { class: 'section-head-title' }, title),
        icon('chevron_down_24_regular', 'section-chevron'),
      );
      return el('section', { class: 'settings-card' + (open ? ' is-open' : ''), dataset: { section: id } }, head, open ? el('div', { class: 'section-body', id: bodyId }, children) : null);
    }

    render() {
      const { app } = this;
      const scroller = this.host.closest('.app-content');
      const keep = scroller ? scroller.scrollTop : 0;
      const focused = document.activeElement && this.host.contains(document.activeElement) ? document.activeElement : null;
      const key = focused && focused.getAttribute ? (focused.getAttribute('name') || focused.getAttribute('aria-label')) : null;
      const page = el(
        'div',
        { class: 'page settings-page' },
        this.section('folder', t('תיקיית ההורדות'), 'folder_24_regular', ...this.folderBody()),
        this.section('sync', t('סנכרון הקטלוג'), 'arrow_sync_24_regular', el('div', { 'data-live': 'sync' }, this.syncRows())),
        this.section('queue', t('תור הורדות'), 'arrow_download_24_regular', el('div', { 'data-live': 'queue' }, this.queueRows())),
        this.section('auto', t('הורדה אוטומטית'), 'alert_24_regular', ...this.autoBody()),
        this.section('disk', t('מקום בדיסק'), 'cloud_arrow_down_24_regular', ...this.diskBody()),
        this.section('rules', t('כללי סינון'), 'filter_24_regular', ...this.rulesBody()),
        this.section('sources', t('מקורות'), 'globe_24_regular', ...this.sourcesBody()),
        this.section('look', t('מראה ושפה'), 'eye_24_regular', ...this.lookBody()),
        this.section('backup', t('ייצוא וייבוא הגדרות'), 'arrow_export_24_regular', ...this.backupBody()),
        this.section('about', t('אודות ודיווח'), 'info_24_regular', ...this.aboutBody()),
      );
      this.host.replaceChildren(page);
      if (scroller) scroller.scrollTop = keep;
      if (key) {
        const again = [...this.host.querySelectorAll('[name], [aria-label]')].find((n) => (n.getAttribute('name') || n.getAttribute('aria-label')) === key);
        if (again) again.focus({ preventScroll: true });
      }
    }

    // ------------------------------------------------------- תיקייה

    folderBody() {
      const { app } = this;
      const folder = app.files.folder;
      const disk = app.files.diskState;
      const rows = [];
      if (!folder) {
        rows.push(el('p', { class: 'setting-text' }, t('עוד לא נבחרה תיקייה. הגיליונות שמורידים נשמרים בה לפי שנה וסדרה, וקריאה בגיליון משתמשת בה כדי להציג אותו.')));
        rows.push(Ui.button('filled', t('בחירת תיקייה'), () => app.emit('need-folder', {}), { icon: 'folder_open_24_regular' }));
        return rows;
      }
      const problem = { revoked: t('הגישה לתיקייה בוטלה. בחרו אותה מחדש.'), missing: t('התיקייה אינה זמינה כרגע (כונן מנותק?). הגישה נשמרת וחוזרת לעבוד כשהיא חוזרת.'), error: t('לא הצלחנו לקרוא את התיקייה.') }[disk.status];
      rows.push(el('p', { class: 'setting-text', dir: 'auto' }, el('strong', {}, folder.name), el('br'), el('span', { class: 'path', dir: 'ltr' }, folder.path)));
      rows.push(problem ? el('p', { class: 'setting-warn' }, icon('warning_24_regular'), problem) : el('p', { class: 'setting-help' }, disk.status === 'ok' ? t('{n} קבצים · {size}', { n: Core.formatCount(disk.count), size: Core.formatBytes(disk.bytes) || '0' }) : t('בודק את התיקייה…')));
      rows.push(el('p', { class: 'setting-help' }, t('אפשר להגדיר את אותה תיקייה גם כתיקייה אישית באוצריא (הגדרות ← ספרייה), ואז הגיליונות נכנסים לחיפוש של אוצריא ואפשר להדפיס אותם מהקורא שלה.')));
      rows.push(
        el(
          'div',
          { class: 'setting-actions' },
          Ui.button('tonal', t('החלפת תיקייה'), () => app.emit('need-folder', {}), { icon: 'folder_open_24_regular', className: 'button-small' }),
          Ui.button('text', t('רענון'), () => app.files.scan(), { icon: 'arrow_sync_24_regular', className: 'button-small' }),
          Ui.button('text', t('ניתוק התיקייה'), () => Ui.confirmDialog({ title: t('ניתוק התיקייה'), text: t('התוסף ישכח את התיקייה ויפסיק לגשת אליה. הקבצים עצמם לא יימחקו.'), confirmLabel: t('ניתוק'), danger: true, onConfirm: () => app.files.forgetFolder() }), { icon: 'dismiss_circle_24_regular', className: 'button-small' }),
        ),
      );
      return rows;
    }

    // -------------------------------------------------------- סנכרון

    syncRows() {
      const { app } = this;
      const s = app.catalog.status;
      const phase = s.phase;
      const lines = [];
      const when = (ms) => (ms ? Core.formatStamp(ms) : t('עוד לא'));
      let text = t('הכול מעודכן');
      if (phase === 'checking') text = t('בודק עדכונים…');
      else if (phase === 'downloading') text = t('מוריד נתונים: {done} מתוך {total}', { done: s.done, total: s.total });
      else if (phase === 'offline') text = t('אין חיבור: מציג את הנתונים השמורים');
      else if (phase === 'error') text = s.error === 'forbidden' ? t('הכתובת של הקטלוג חסומה באוצריא (טרם אושרה). מציג את הנתונים השמורים.') : t('הסנכרון נכשל ({code}). מציג את הנתונים השמורים, ינסה שוב לבד.', { code: s.error || 'network' });
      else if (phase === 'partial') text = t('חלק מהנתונים לא ירדו ({code}). ינסה שוב לבד.', { code: s.error || 'network' });
      lines.push(el('p', { class: 'setting-text' + (phase === 'error' || phase === 'partial' ? ' is-warn' : ''), role: 'status' }, text));
      if (phase === 'downloading') lines.push(Ui.progress(s.total ? (s.done / s.total) * 100 : 0, t('התקדמות הסנכרון'), s.total, s.done));
      if (s.schemaTooNew || s.pluginTooOld) lines.push(el('p', { class: 'setting-warn' }, icon('warning_24_regular'), t('יש גרסה חדשה של התוסף. עדכנו אותו מהחנות של אוצריא.')));
      lines.push(el('p', { class: 'setting-help' }, t('סנכרון אחרון תקין: {when} · נטענו {n} גיליונות ({loaded}/{total} קבצי שנים)', { when: when(s.lastOkAt), n: Core.formatCount(app.index.size), loaded: s.shardsLoaded, total: s.shardsTotal })));
      const cold = app.catalog.coldPending();
      if (cold.shards) {
        lines.push(el('p', { class: 'setting-help' }, t('הקטלוג המלא גדול מכדי לשמור ולהחזיק כולו: נטענות השנים האחרונות. {n} גיליונות ישנים נוספים ({size}) נטענים לפי דרישה.', { n: Core.formatCount(cold.issues), size: Core.formatBytes(cold.bytes) })));
        lines.push(Ui.button('outlined', t('טעינת השנים הישנות'), () => app.loadCold(), { icon: 'cloud_arrow_down_24_regular', className: 'button-small', busy: Boolean(app.coldLoading), busyLabel: t('טוען…') }));
      }
      lines.push(Ui.button('tonal', t('סנכרון עכשיו'), () => app.catalog.sync({ force: false }), { icon: 'arrow_sync_24_regular', className: 'button-small', busy: phase === 'checking' || phase === 'downloading', busyLabel: t('מסנכרן…') }));
      return lines;
    }

    // ------------------------------------------------------------ תור

    queueRows() {
      const { app } = this;
      const jobs = app.files.list().slice().reverse();
      if (!jobs.length) return [el('p', { class: 'setting-help' }, t('אין הורדות כרגע.'))];
      const rows = jobs.map((job) => {
        const item = job.item;
        const status = { queued: t('בתור'), active: t('מוריד…'), done: t('הושלם'), failed: t('נכשל'), cancelled: t('בוטל') }[job.status];
        const actions = [];
        if (job.status === 'queued' || job.status === 'active') actions.push(Ui.iconButton('dismiss_24_regular', t('ביטול'), () => app.files.cancel(job.id)));
        if (job.status === 'failed' || job.status === 'cancelled') actions.push(Ui.iconButton('arrow_clockwise_24_regular', t('ניסיון חוזר'), () => app.files.retry(job.id)));
        if (job.status === 'failed') actions.push(Ui.iconButton('info_24_regular', t('פרטי הכשל'), () => app.emit('download-failed', { item, code: job.error ? job.error.code : 'failed' })));
        return el(
          'li',
          { class: 'queue-row is-' + job.status },
          job.status === 'active' ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon(job.status === 'done' ? 'checkmark_circle_24_filled' : job.status === 'failed' ? 'warning_24_regular' : job.status === 'queued' ? 'clock_24_regular' : 'dismiss_circle_24_regular'),
          el('span', { class: 'queue-title', dir: 'auto' }, item.seriesTitle || item.title, ' · ', Core.weekLabel(item) || ''),
          el('span', { class: 'queue-status' }, status + (job.mode === 'read' ? ' · ' + t('לקריאה') : '')),
          ...actions,
        );
      });
      rows.push(Ui.button('text', t('נקה את מה שהסתיים'), () => app.files.clearFinished(), { className: 'button-small' }));
      return [el('ul', { class: 'queue-list' }, rows.slice(0, -1)), rows[rows.length - 1]];
    }

    // --------------------------------------------------- הורדה אוטומטית

    autoBody() {
      const { app } = this;
      const prefs = app.state.prefs;
      return [
        toggle(t('הורד אוטומטית גיליונות חדשים בסדרות שאני עוקב אחריהן'), prefs.autoDownload, (on) => {
          if (on && !app.files.hasFolder) {
            app.emit('need-folder', { then: () => app.state.setPref('autoDownload', true) });
            return;
          }
          app.state.setPref('autoDownload', on);
        }, t('כבוי כברירת מחדל. ההורדה מתבצעת רק כשהתוסף פתוח.')),
        field(t('מכסה יומית'), A.BrowseHelpers.selectField(t('מכסה יומית'), [1, 3, 5, 10, 20, 30].map((n) => ({ value: n, label: t('עד {n} גיליונות ביום', { n }) })), prefs.autoDownloadCap, (v) => app.state.setPref('autoDownloadCap', Number(v)))),
      ];
    }

    // ------------------------------------------------------------ דיסק

    diskBody() {
      const { app } = this;
      const holder = el('div', { class: 'disk-usage' });
      app.catalog.usage().then((u) => {
        const p = u.quota ? Math.min(100, Math.round((u.used / u.quota) * 100)) : 0;
        Ui.fill(holder, 
          el('p', { class: 'setting-text' }, t('מטמון הקטלוג: {used} מתוך {quota}', { used: Core.formatBytes(u.used) || '0', quota: Core.formatBytes(u.quota) || '—' })),
          Ui.progress(p, t('מטמון הקטלוג')),
        );
      });
      return [
        holder,
        el('p', { class: 'setting-help' }, t('המטמון מאפשר עבודה בלי רשת, וכשהוא מתמלא התוסף מסיר לבד שנים ישנות שלא נעשה בהן שימוש. קבצים שהורדתם אינם נוגעים בו.')),
        Ui.button('tonal', t('ניקוי מטמון הקטלוג'), () => Ui.confirmDialog({ title: t('ניקוי המטמון'), text: t('הקטלוג יורד מחדש בסנכרון הבא. ההגדרות, המועדפים והקבצים שהורדתם לא ייפגעו.'), confirmLabel: t('ניקוי'), danger: true, onConfirm: async () => { try { await app.catalog.clearCache(); app.toast(t('המטמון נוקה')); app.catalog.sync(); } catch (error) { app.toast(t('הניקוי נכשל'), { error: true }); } } }), { icon: 'delete_24_regular', className: 'button-small' }),
      ];
    }

    // ---------------------------------------------------------- כללים

    rulesBody() {
      const { app } = this;
      const st = app.state;
      const names = app.ruleNames();
      const out = [];
      out.push(el('p', { class: 'setting-text' }, t('כללים קובעים אילו גיליונות מוצגים. סדר ההכרעה: חסימה מפורשת, הרשאה מפורשת, כלל סדרה, כלל מקור/שפה/חוג/תבנית, ברירת מחדל.')));
      out.push(field(t('מצב'), A.BrowseHelpers.selectField(t('מצב כללי הסינון'), [{ value: 'blacklist', label: t('להסתיר רק מה שנחסם') }, { value: 'whitelist', label: t('להציג רק מה שהותר') }], st.rules.mode, (v) => st.setRulesMode(v))));
      const list = st.rules.rules;
      if (!list.length) out.push(el('p', { class: 'setting-help' }, t('אין כללים. אפשר להוסיף כלל כאן, או לבחור "הסתר סדרה זו" בכרטיס.')));
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
                  app.toast(t('הכלל נמחק'), { action: { label: t('ביטול הפעולה'), run: () => st.addRule(removed) } });
                }),
              ),
            ),
          ),
        );
      }
      out.push(this.ruleForm());
      return out;
    }

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
        valueControl = sel(t('ערך'), choice, d.value, (v) => { d.value = v; refreshSim(); }, 'select-value');
      } else {
        valueControl = el('input', { class: 'input', type: 'text', name: 'rule-value', value: d.value, placeholder: d.field === 'seriesText' ? t('חלק משם הסדרה') : t('טקסט שמופיע בשם'), maxlength: '120', dir: 'auto', 'aria-label': t('ערך'), oninput: (e) => { d.value = e.target.value; refreshSim(); } });
      }
      const form = el(
        'form',
        { class: 'rule-form', onsubmit: (e) => {
          e.preventDefault();
          const rule = app.state.addRule({ action: d.action, field: d.field, value: d.value });
          if (!rule) return;
          d.value = choice ? d.value : '';
          app.toast(t('הכלל נוסף'));
        } },
        el('h3', { class: 'details-section' }, t('כלל חדש')),
        el('div', { class: 'rule-grid' },
          sel(t('פעולה'), Rules.ACTIONS.map((a) => ({ value: a, label: t(Rules.ACTION_LABELS[a]) })), d.action, (v) => { d.action = v; refreshSim(); }),
          sel(t('לפי'), FIELD_OPTIONS.map((f) => ({ value: f, label: t(Rules.FIELD_LABELS[f]) })), d.field, (v) => { d.field = v; d.value = ''; this.render(); }),
          valueControl,
        ),
        simBox,
        Ui.button('filled', t('הוספת כלל'), () => form.requestSubmit(), { icon: 'add_24_regular', className: 'button-small', disabled: !d.value }),
      );
      setTimeout(refreshSim, 0);
      return form;
    }

    /** "כלל זה יסתיר N גיליונות" + דוגמאות, לפני ההוספה. */
    simulate(box) {
      const { app } = this;
      const d = this.draft;
      if (!d.value) {
        Ui.fill(box, el('p', { class: 'setting-help' }, t('בחרו ערך כדי לראות כמה גיליונות הכלל ישנה.')));
        return;
      }
      const sim = app.index.simulate({ action: d.action, field: d.field, value: d.value }, 4);
      let text;
      if (d.action === 'hide' || d.action === 'show') {
        text = d.action === 'hide' ? t('כלל זה יסתיר {n} גיליונות', { n: Core.formatCount(sim.hides) }) : t('כלל זה יציג {n} גיליונות שמוסתרים עכשיו', { n: Core.formatCount(sim.shows) });
        if (sim.total === 0) text = t('הכלל לא ישנה דבר בגיליונות שנטענו');
      } else text = t('כלל זה יחול על {n} גיליונות', { n: Core.formatCount(sim.total) });
      Ui.fill(box, 
        el('p', { class: 'setting-text' }, icon('info_24_regular'), text),
        sim.examples.length ? el('ul', { class: 'example-list' }, sim.examples.map((it) => el('li', { dir: 'auto' }, (it.seriesTitle || it.title) + ' · ' + (Core.weekLabel(it) || Core.dateText(it.date, { short: true }))))) : null,
        !app.catalog.syncing && app.catalog.shards.length > app.catalog.status.shardsLoaded ? el('p', { class: 'setting-help' }, t('חלק מהנתונים עוד נטענים, והמספר עשוי לגדול.')) : null,
      );
    }

    // --------------------------------------------------------- מקורות

    sourcesBody() {
      const { app } = this;
      const rows = app.allSources().map((s) =>
        el(
          'li',
          { class: 'source-row' },
          el('div', { class: 'source-main' }, el('strong', { dir: 'auto' }, s.name), Ui.chip(A.Dialogs.statusText(s.status), { kind: s.status === 'ok' ? 'done' : 'warn' }), s.mode === 'link' ? Ui.chip(t('קישור בלבד'), { kind: 'warn', icon: 'open_24_regular' }) : null),
          el('p', { class: 'setting-help' }, [s.issueCount ? t('{n} גיליונות', { n: Core.formatCount(s.issueCount) }) : '', s.checkedAt ? t('נבדק: {when}', { when: Core.formatStamp(s.checkedAt) }) : ''].filter(Boolean).join(' · ')),
          s.note ? el('p', { class: 'setting-help', dir: 'auto' }, s.note) : null,
          s.url ? Ui.button('text', t('לאתר המקור'), () => app.openSite({ src: s.id }), { icon: 'open_24_regular', className: 'button-small' }) : null,
        ),
      );
      return [el('ul', { class: 'source-list' }, rows), el('p', { class: 'setting-help' }, t('מקור במצב "קישור בלבד" אינו מאפשר הורדה אוטומטית: הגיליונות שלו נפתחים באתר המקור.'))];
    }

    // ----------------------------------------------------------- מראה

    lookBody() {
      const { app } = this;
      const p = app.state.prefs;
      const sel = A.BrowseHelpers.selectField;
      return [
        field(t('גודל תצוגה'), sel(t('גודל תצוגה'), SCALES.map((s) => ({ value: s, label: Math.round(s * 100) + '%' })), p.scale, (v) => app.state.setPref('scale', Number(v)))),
        field(t('שפה'), sel(t('שפה'), [{ value: 'auto', label: t('כמו באוצריא') }, { value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }], p.lang, (v) => app.state.setPref('lang', v))),
        field(t('פרשות'), sel(t('פרשות'), [{ value: 'il', label: t('לפי ארץ ישראל') }, { value: 'diaspora', label: t('לפי חוץ לארץ') }], p.diaspora ? 'diaspora' : 'il', (v) => app.state.setPref('diaspora', v === 'diaspora')), t('בשבתות שבהן הקריאה שונה.')),
        field(t('תצוגת רשימות'), sel(t('תצוגת רשימות'), [{ value: 'cards', label: t('כרטיסים') }, { value: 'list', label: t('רשימה צפופה') }], p.view, (v) => app.state.setPref('view', v))),
        toggle(t('הצג תמונות ממוזערות'), p.thumbs, (on) => app.state.setPref('thumbs', on), t('כבוי כברירת מחדל: טעינת תמונות פונה לאתרי המקורות.')),
        el('p', { class: 'setting-help' }, t('הצבעים והגופנים נלקחים מאוצריא ומתעדכנים איתה.')),
      ];
    }

    // --------------------------------------------------------- גיבוי

    backupBody() {
      const { app } = this;
      const exportArea = el('textarea', { class: 'input code-area', readonly: true, rows: '4', 'aria-label': t('הגדרות מיוצאות'), dir: 'ltr', value: this.exportText });
      exportArea.value = this.exportText;
      const importArea = el('textarea', { class: 'input code-area', rows: '4', 'aria-label': t('הדבקת הגדרות לייבוא'), dir: 'ltr', placeholder: '{ "format": "otzaria-alonim-settings", … }' });
      importArea.value = this.importText;
      importArea.addEventListener('input', () => { this.importText = importArea.value; });
      const status = el('div', { class: 'import-status', role: 'status', 'aria-live': 'polite' });
      const drawPreview = () => {
        const p = this.importPreview;
        if (!p) return Ui.fill(status, );
        if (!p.ok) {
          const reason = { empty: t('לא הודבק דבר.'), too_big: t('הקובץ גדול מדי.'), json: t('הטקסט אינו JSON תקין.'), format: t('זה אינו קובץ הגדרות של "עלוני שבת".'), too_new: t('הקובץ נוצר בגרסה חדשה יותר של התוסף. עדכנו את התוסף.') }[p.error];
          Ui.fill(status, el('p', { class: 'setting-warn' }, icon('warning_24_regular'), reason));
          return;
        }
        const s = p.summary;
        Ui.fill(status, 
          el('p', { class: 'setting-text' }, t('נמצאו: {rules} כללים, {series} סדרות מסומנות, {favorites} מועדפים, {lists} רשימות.', s)),
          el('div', { class: 'setting-actions' }, Ui.button('filled', t('מיזוג עם הקיים'), () => { app.state.applyImport(p, 'merge'); this.importPreview = null; this.importText = ''; app.toast(t('ההגדרות יובאו')); this.render(); }, { className: 'button-small' }), Ui.button('outlined', t('החלפת הקיים'), () => Ui.confirmDialog({ title: t('החלפת ההגדרות'), text: t('המועדפים, הכללים והרשימות הקיימים יוחלפו בייבוא.'), confirmLabel: t('החלפה'), danger: true, onConfirm: () => { app.state.applyImport(p, 'replace'); this.importPreview = null; this.importText = ''; app.toast(t('ההגדרות הוחלפו')); this.render(); } }), { className: 'button-small' })),
        );
      };
      drawPreview();
      return [
        el('p', { class: 'setting-text' }, t('ההגדרות, המועדפים, הכללים והרשימות נשמרים כטקסט JSON, להעברה למחשב אחר. תיקיית ההורדות אינה נכללת.')),
        el('div', { class: 'setting-actions' },
          Ui.button('tonal', t('יצירת ייצוא'), () => { this.exportText = JSON.stringify(app.state.exportSettings(), null, 2); exportArea.value = this.exportText; }, { icon: 'arrow_export_24_regular', className: 'button-small' }),
          Ui.button('text', t('העתקה'), async () => { if (!this.exportText) this.exportText = exportArea.value = JSON.stringify(app.state.exportSettings(), null, 2); app.toast((await copyText(this.exportText, exportArea)) ? t('הועתק ללוח') : t('ההעתקה נכשלה: סמנו את הטקסט והעתיקו ידנית'), { error: false }); }, { icon: 'copy_24_regular', className: 'button-small' })),
        exportArea,
        el('h3', { class: 'details-section' }, t('ייבוא')),
        importArea,
        el('div', { class: 'setting-actions' }, Ui.button('tonal', t('בדיקה'), () => { this.importPreview = app.state.previewImport(importArea.value); drawPreview(); }, { icon: 'arrow_import_24_regular', className: 'button-small' })),
        status,
      ];
    }

    // --------------------------------------------------------- אודות

    reportText() {
      const { app } = this;
      const s = app.catalog.status;
      return [
        'Alonim plugin ' + Core.PLUGIN_VERSION,
        'Otzaria ' + (app.hostVersion || '?') + ' / ' + (app.platform || '?') + ' / ' + I18n.language,
        'catalog v' + (app.catalog.meta.catalogVersion || 0) + ', issues ' + app.index.size + ', phase ' + s.phase + (s.error ? ' (' + s.error + ')' : ''),
        'folder: ' + (app.files.hasFolder ? app.files.diskState.status : 'none') + ', files ' + app.files.diskState.count,
        'state read-only: ' + app.state.readOnly,
        '',
        A.Log.shared.tail(40),
        app.log.tail(40),
      ].join('\n');
    }

    aboutBody() {
      const { app } = this;
      const area = el('textarea', { class: 'input code-area', readonly: true, rows: '5', 'aria-label': t('פרטים לדיווח'), dir: 'ltr' });
      return [
        el('p', { class: 'setting-text' }, t('עלוני שבת {v}: עלוני שבת מכמה אתרים, במקום אחד. התוסף אינו שולח היסטוריית קריאה, חיפושים או רשימות לשום מקום, ואין בו טלמטריה.', { v: Core.PLUGIN_VERSION })),
        el('p', { class: 'setting-help' }, t('הקבצים יורדים ישירות מאתרי המקורות. התוסף אינו מפיץ עותקים, והזכויות שייכות למחברים ולמפרסמים.')),
        el('h3', { class: 'details-section' }, t('קרדיטים')),
        el('p', { class: 'setting-text' }, t('העלונים מוצגים באדיבות האתרים שלהלן ושייכים למחבריהם ולמפרסמים. התוסף רק מקשר אליהם.')),
        el('ul', { class: 'source-list' }, app.allSources().filter((s) => s.url).map((s) => el('li', { class: 'source-row' }, el('div', { class: 'source-main' }, el('strong', { dir: 'auto' }, s.name), Ui.button('text', t('לאתר המקור'), () => app.openSite({ src: s.id }), { icon: 'open_24_regular', className: 'button-small' }))))),
        el('div', { class: 'setting-actions' },
          Ui.button('tonal', t('דיווח על בעיה'), () => app.files.openOnSite(Core.REPO_URL + '/issues', ['github.com']).then((ok) => ok || app.toast(t('אי אפשר לפתוח את הכתובת'), { error: true })), { icon: 'bug_24_regular', className: 'button-small' }),
          Ui.button('text', t('קיצורי מקלדת'), () => app.emit('shortcuts'), { icon: 'keyboard_24_regular', className: 'button-small' })),
        el('h3', { class: 'details-section' }, t('פרטים לדיווח')),
        area,
        Ui.button('text', t('יצירה והעתקה'), async () => { area.value = this.reportText(); app.toast((await copyText(area.value, area)) ? t('הועתק ללוח') : t('ההעתקה נכשלה: סמנו את הטקסט והעתיקו ידנית')); }, { icon: 'copy_24_regular', className: 'button-small' }),
        el('p', { class: 'setting-help' }, t('הדיווח אינו כולל נתיבי תיקיות. מצרפים אותו ידנית לפנייה.')),
      ];
    }
  }

  A.SettingsScreen = SettingsScreen;
  A.SettingsSections = SECTION_IDS;
  if (typeof module === 'object' && module.exports) module.exports = { SettingsScreen };
})(typeof self !== 'undefined' ? self : globalThis);
