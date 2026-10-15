// "האוספים שלי": מועדפים, רשימות קריאה, "אוסף שבת" (בוחרים, מורידים הכול
// ופותחים), ומה שהורד (נגזר מהדיסק).
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Ui = A.Ui;
  const Cards = A.Cards;
  const Core = A.Core;
  const I18n = A.I18n;
  const { el, icon } = Ui;
  const t = (text, vars) => I18n.t(text, vars);

  /** גיליון "מדומה" מתצלום שמור, לפני שהשרד שלו נטען: מספיק להצגה ולפתיחה. */
  function pseudoItem(snap) {
    return {
      id: snap.id,
      series: snap.s,
      seriesTitle: snap.st || snap.ti,
      title: snap.ti,
      hy: snap.hy || 0,
      date: snap.d || null,
      parasha: snap.p || [],
      event: snap.ev || null,
      lang: 'he',
      assets: [],
      _added: 0,
      _dl: 0,
      _bytes: 0,
      _i: -1,
      _pseudo: true,
    };
  }

  /** רשימת גיליונות וירטואלית (כרטיסים או שורות לפי ההעדפה). */
  class ItemList {
    constructor(app, label) {
      this.app = app;
      this.items = [];
      this.onRemove = null;
      this.vlist = new Ui.VList({ className: 'results-list', label });
      this.vlist.onResize = () => this.layout();
      this.perRow = 1;
      Cards.attachListKeys(this.vlist, () => ({ count: this.items.length, perRow: this.perRow }));
      this.root = this.vlist.root;
    }

    set(items) {
      this.items = items;
      this.layout();
    }

    layout() {
      const app = this.app;
      const mode = app.state.prefs.view === 'list' ? 'row' : 'card';
      this.perRow = Cards.columnsFor(this.vlist.root.clientWidth, this.vlist.emPx, mode);
      const count = this.items.length;
      const rows = Math.ceil(count / this.perRow);
      this.vlist.configure({
        count: rows,
        heightEm: (mode === 'row' ? Cards.ROW_EM.row : Cards.ROW_EM.card) + Cards.ROW_EM.gap,
        itemsPerRow: this.perRow,
        render: (r, node) => {
          node.classList.add('is-grid');
          node.style.setProperty('--cols', String(this.perRow));
          for (let c = 0; c < this.perRow; c++) {
            const i = r * this.perRow + c;
            if (i >= count) break;
            node.appendChild(
              Cards.render(app, this.items[i], {
                mode,
                index: i,
                total: count,
                ctx: { count, at: (k) => this.items[k], index: i },
                onRemove: this.onRemove,
              }),
            );
          }
        },
      });
    }

    refresh() {
      A.BrowseHelpers.keepFocus(this.vlist, () => this.vlist.refreshVisible());
    }

    destroy() {
      this.vlist.destroy();
    }
  }

  const TABS = [
    ['favorites', 'מועדפים'],
    ['lists', 'רשימות'],
    ['shabbat', 'אוסף שבת'],
    ['downloads', 'הורדות'],
  ];

  class MineScreen {
    constructor(app) {
      this.app = app;
      this.fill = true;
      this.unsub = [];
      this.itemList = null;
    }

    mount(host) {
      this.host = host;
      const { app } = this;
      this.unsub.push(
        app.on('data', () => this.render()),
        app.on('state', (d) => (d.includes('prefs') ? this.layoutOnly() : this.render())),
        app.on('files', () => this.refreshOnly()),
        app.on('disk', () => this.render()),
      );
      this.render();
    }

    destroy() {
      for (const off of this.unsub) off();
      if (this.itemList) this.itemList.destroy();
    }

    layoutOnly() {
      if (this.itemList) this.itemList.layout();
    }

    refreshOnly() {
      if (this.itemList) this.itemList.refresh();
    }

    /** הגיליון המלא אם נטען, ואחרת מתצלום השמירה. */
    resolve(snap) {
      return this.app.index.get(snap.id) || pseudoItem(snap);
    }

    render() {
      const { app } = this;
      const v = app.view.mine;
      if (this.itemList) {
        this.itemList.destroy();
        this.itemList = null;
      }
      const tabs = el(
        'div',
        { class: 'segmented is-text is-wide', role: 'tablist', 'aria-label': t('האוספים שלי') },
        TABS.map(([id, label]) =>
          el('button', { type: 'button', role: 'tab', class: 'segment-text', 'aria-selected': String(v.tab === id), tabindex: v.tab === id ? '0' : '-1', onclick: () => { v.tab = id; this.render(); },
            onkeydown: (e) => {
              const ids = TABS.map((x) => x[0]);
              const i = ids.indexOf(v.tab);
              const dir = document.documentElement.dir === 'ltr' ? 1 : -1;
              const step = e.key === 'ArrowRight' ? dir : e.key === 'ArrowLeft' ? -dir : 0;
              if (!step) return;
              e.preventDefault();
              v.tab = ids[(i + step + ids.length) % ids.length];
              this.render();
              this.host.querySelector('[role="tab"][aria-selected="true"]').focus();
            } }, t(label)),
        ),
      );
      this.body = el('div', { class: 'mine-body' });
      this.host.replaceChildren(el('div', { class: 'page fill-page mine-page' }, el('div', { class: 'toolbar' }, tabs), this.body));
      if (v.tab === 'favorites') this.renderFavorites();
      else if (v.tab === 'lists') this.renderLists();
      else if (v.tab === 'shabbat') this.renderShabbat();
      else this.renderDownloads();
    }

    list(items, label, onRemove, header) {
      this.itemList = new ItemList(this.app, label);
      this.itemList.onRemove = onRemove || null;
      const wrap = el('div', { class: 'list-host' }, this.itemList.root);
      this.body.replaceChildren(...[header, wrap].filter(Boolean));
      this.itemList.set(items);
      return this.itemList;
    }

    // ----------------------------------------------------- מועדפים

    renderFavorites() {
      const { app } = this;
      const snaps = app.state.favoriteSnaps();
      if (!snaps.length) {
        this.body.replaceChildren(Ui.stateCard({ icon: 'star_24_regular', title: t('עוד אין מועדפים'), text: t('סמנו גיליון בכוכב והוא יופיע כאן, גם בלי חיבור לאינטרנט.'), actions: [Ui.button('tonal', t('לכל העלונים'), () => app.go('all'))], compact: true }));
        return;
      }
      this.list(snaps.map((s) => this.resolve(s)), t('המועדפים שלי'), null, el('p', { class: 'results-line' }, t('{n} מועדפים', { n: Core.formatCount(snaps.length) })));
    }

    // ------------------------------------------------------ רשימות

    renderLists() {
      const { app } = this;
      const v = app.view.mine;
      const lists = app.state.lists.filter((l) => l.kind === 'list');
      const create = Ui.button('filled', t('רשימה חדשה'), () => this.nameDialog(t('רשימה חדשה'), '', (name) => {
        const list = app.state.createList(name);
        if (list) v.list = list.id;
      }), { icon: 'add_24_regular', className: 'button-small' });
      if (!lists.length) {
        this.body.replaceChildren(Ui.stateCard({ icon: 'bookmark_multiple_24_regular', title: t('עוד אין רשימות'), text: t('רשימת קריאה מקבצת גיליונות שרוצים לקרוא אחר כך. מוסיפים גיליון מהתפריט "עוד פעולות" בכרטיס.'), actions: [create], compact: true }));
        return;
      }
      if (!lists.some((l) => l.id === v.list)) v.list = lists[0].id;
      const current = lists.find((l) => l.id === v.list);
      const picker = el(
        'div',
        { class: 'list-picker', role: 'group', 'aria-label': t('הרשימות שלי') },
        lists.map((l) => el('button', { type: 'button', class: 'segment-text', 'aria-pressed': String(l.id === v.list), onclick: () => { v.list = l.id; this.render(); } }, l.name, el('span', { class: 'section-count' }, String(l.entries.length)))),
        create,
      );
      const tools = el(
        'div',
        { class: 'list-tools' },
        Ui.button('text', t('שינוי שם'), () => this.nameDialog(t('שינוי שם הרשימה'), current.name, (name) => app.state.renameList(current.id, name)), { icon: 'tag_24_regular', className: 'button-small' }),
        Ui.button('text', t('מחיקת הרשימה'), () => {
          const removed = app.state.deleteList(current.id);
          app.toast(t('הרשימה "{name}" נמחקה', { name: current.name }), { action: { label: t('ביטול'), run: () => app.state.restoreList(removed) } });
        }, { icon: 'delete_24_regular', className: 'button-small' }),
      );
      const header = el('div', { class: 'list-header' }, picker, tools);
      if (!current.entries.length) {
        this.body.replaceChildren(header, Ui.stateCard({ icon: 'document_24_regular', title: t('הרשימה ריקה'), text: t('מוסיפים גיליונות מהתפריט "עוד פעולות" בכל כרטיס.'), compact: true }));
        return;
      }
      this.list(current.entries.map((e) => this.resolve(e)), current.name, (item) => app.state.removeFromList(current.id, item.id), header);
    }

    // ---------------------------------------------------- אוסף שבת

    renderShabbat() {
      const { app } = this;
      let list = app.state.shabbatList();
      if (!list) list = app.state.createList(t('אוסף שבת'), 'shabbat');
      const items = list ? list.entries.map((e) => this.resolve(e)) : [];
      const downloaded = items.filter((it) => app.files.isDownloaded(it)).length;
      const busy = items.some((it) => { const j = app.files.jobFor(it); return j && (j.status === 'queued' || j.status === 'active'); });
      const week = new A.WeekScreen(app).currentWeek();
      const addMine = Ui.button('tonal', t('הוסף את גיליונות השבוע שלי'), () => {
        const index = app.index;
        const followed = new Set(app.state.followedIds());
        let n = 0;
        for (const i of index.forWeek(week)) {
          const it = index.item(i);
          if (followed.has(it.series) && !app.state.isMuted(it.series) && !list.entries.some((e) => e.id === it.id)) {
            app.state.addToList(list.id, it);
            n++;
          }
        }
        app.toast(n ? t('נוספו {n} גיליונות', { n }) : t('אין גיליונות חדשים להוספה מהסדרות שאתם עוקבים אחריהן'));
      }, { icon: 'add_24_regular', className: 'button-small' });
      const header = el(
        'div',
        { class: 'list-header shabbat-header' },
        el('div', { class: 'shabbat-summary' }, el('h2', { class: 'series-title' }, t('אוסף שבת')), el('p', { class: 'card-meta' }, items.length ? t('{n} גיליונות · {d} הורדו', { n: items.length, d: downloaded }) : t('בוחרים גיליונות לשבת, מורידים את כולם יחד ופותחים.'))),
        el(
          'div',
          { class: 'list-tools' },
          addMine,
          Ui.button('filled', t('הורד הכול'), () => this.downloadAll(items), { icon: 'arrow_download_24_regular', className: 'button-small', disabled: !items.length || downloaded === items.length, busy, busyLabel: t('מוריד…') }),
          Ui.button('tonal', t('פתח את האוסף'), () => app.openIssue(items[0], { count: items.length, at: (k) => items[k], index: 0 }), { icon: 'book_open_24_regular', className: 'button-small', disabled: !items.length }),
          Ui.button('text', t('ניקוי'), () => {
            const old = list.entries.slice();
            app.state.setListEntries(list.id, []);
            app.toast(t('האוסף נוקה'), { action: { label: t('ביטול'), run: () => app.state.setListEntries(list.id, old) } });
          }, { icon: 'delete_24_regular', className: 'button-small', disabled: !items.length }),
        ),
      );
      if (!items.length) {
        this.body.replaceChildren(header, Ui.stateCard({ icon: 'calendar_star_24_regular', title: t('האוסף ריק'), text: t('מוסיפים גיליונות מהתפריט "עוד פעולות" בכל כרטיס, או בלחיצה על "הוסף את גיליונות השבוע שלי".'), compact: true }));
        return;
      }
      this.list(items, t('אוסף שבת'), (item) => app.state.removeFromList(list.id, item.id), header);
    }

    async downloadAll(items) {
      const { app } = this;
      if (!app.files.hasFolder) {
        app.emit('need-folder', { then: () => this.downloadAll(items) });
        return;
      }
      let n = 0;
      for (const item of items) {
        if (app.files.isDownloaded(item)) continue;
        app.queueSave(item);
        n++;
      }
      app.toast(t('{n} גיליונות נוספו להורדה', { n }));
    }

    // -------------------------------------------------------- הורדות

    renderDownloads() {
      const { app } = this;
      const files = app.files;
      const state = files.diskState;
      if (!files.hasFolder) {
        this.body.replaceChildren(Ui.stateCard({ icon: 'folder_24_regular', title: t('עוד לא נבחרה תיקייה'), text: t('בוחרים תיקייה פעם אחת, והגיליונות שמורידים נשמרים בה לפי שנה וסדרה.'), actions: [Ui.button('filled', t('בחירת תיקייה'), () => app.emit('need-folder', {}), { icon: 'folder_open_24_regular' })], compact: true }));
        return;
      }
      if (state.status === 'unknown') files.scan();
      const problem = state.status === 'revoked' ? t('הגישה לתיקייה בוטלה. בחרו אותה מחדש בהגדרות.') : state.status === 'missing' ? t('התיקייה אינה זמינה כרגע (כונן מנותק?). אפשר לנסות שוב אחרי שתחזור.') : state.status === 'error' ? t('לא הצלחנו לקרוא את התיקייה. אפשר לנסות שוב.') : '';
      const entries = [...files.disk.entries()].sort((a, b) => String(b[1].modified).localeCompare(String(a[1].modified)));
      const items = entries.map(([fragment, e]) => app.index.byFragment(fragment) || pseudoItem({ id: 'i_' + fragment, ti: e.name.replace(/ \[[0-9a-f]{8}\]\.pdf$/i, ''), st: '', s: '', hy: 0, d: '', p: [], ev: '' }));
      const header = el(
        'div',
        { class: 'list-header' },
        el('div', { class: 'shabbat-summary' }, el('h2', { class: 'series-title' }, t('הורדות')), el('p', { class: 'card-meta' }, [t('{n} קבצים', { n: Core.formatCount(entries.length) }), Core.formatBytes(state.bytes), state.partial ? t('(רשימה חלקית)') : '', files.folder ? files.folder.name : ''].filter(Boolean).join(' · '))),
        el('div', { class: 'list-tools' }, Ui.button('text', t('רענון'), () => files.scan(), { icon: 'arrow_sync_24_regular', className: 'button-small' })),
      );
      if (problem) {
        this.body.replaceChildren(header, Ui.stateCard({ icon: 'warning_24_regular', error: true, title: t('התיקייה לא זמינה'), text: problem, actions: [Ui.button('filled', t('בחירת תיקייה'), () => app.emit('need-folder', {}), { icon: 'folder_open_24_regular' }), Ui.button('text', t('בדיקה חוזרת'), () => files.scan())], compact: true }));
        return;
      }
      if (!items.length) {
        this.body.replaceChildren(header, Ui.stateCard({ icon: 'arrow_download_24_regular', title: t('עוד לא הורדתם גיליונות'), text: t('כפתור ההורדה בכרטיס שומר את הגיליון בתיקייה, לקריאה גם בלי רשת.'), actions: [Ui.button('tonal', t('לכל העלונים'), () => app.go('all'))], compact: true }));
        return;
      }
      this.list(items, t('הקבצים שהורדו'), (item) => this.confirmDelete(item), header).onRemove = (item) => this.confirmDelete(item);
      this.itemList.layout();
    }

    confirmDelete(item) {
      const { app } = this;
      Ui.confirmDialog({
        title: t('מחיקת קובץ'),
        text: t('למחוק את "{name}" מהתיקייה? אפשר להוריד אותו שוב בכל עת.', { name: item.seriesTitle || item.title }),
        confirmLabel: t('מחיקה'),
        danger: true,
        onConfirm: async () => {
          try {
            await app.files.deleteDownloaded(Core.idFragment(item.id));
            app.toast(t('הקובץ נמחק'));
          } catch (error) {
            app.toast(t('המחיקה נכשלה'), { error: true });
          }
        },
      });
    }

    nameDialog(title, initial, onDone) {
      const input = el('input', { class: 'input', type: 'text', value: initial, maxlength: '80', 'aria-label': t('שם'), dir: 'auto', 'data-autofocus': '' });
      const dlg = Ui.dialog({
        title,
        size: 'small',
        body: el('form', { onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { onDone(v); dlg.close('ok'); } } }, input),
        actions: [Ui.button('text', t('ביטול'), () => dlg.close('cancel')), Ui.button('filled', t('שמירה'), () => { const v = input.value.trim(); if (v) { onDone(v); dlg.close('ok'); } })],
      });
    }
  }

  A.MineScreen = MineScreen;
  A.pseudoItem = pseudoItem;
  if (typeof module === 'object' && module.exports) module.exports = { MineScreen, pseudoItem };
})(typeof self !== 'undefined' ? self : globalThis);
