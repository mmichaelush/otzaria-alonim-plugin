// אבחון: תמונת מצב של התוסף (מארח ויכולותיו, קטלוג, קבצים, מצב משתמש, ביצועים)
// וטקסט דיווח מנוקה. טהור ביחס ל-DOM: מקבל את `app` ומחזיר נתונים וטקסט, כך שאפשר
// לבדוק אותו בלי דפדפן. ה-UI ב-`alonim-ui-diagnostics.js`.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const Core = A.Core;
  const I18n = A.I18n;

  /** שורה ריקה-בטוחה: ערך חסר מוצג כ-"?". */
  const show = (value) => (value === undefined || value === null || value === '' ? '?' : String(value));

  /** מצב הזיכרון של הדף (Chromium בלבד); `null` כשאינו זמין. */
  function memory() {
    const m = root.performance && root.performance.memory;
    return m ? { usedMb: Math.round(m.usedJSHeapSize / 1048576), limitMb: Math.round(m.jsHeapSizeLimit / 1048576) } : null;
  }

  /** תמונת מצב מובנית. */
  function snapshot(app) {
    const s = app.catalog.status;
    const manifest = app.catalog.manifest || {};
    const disk = app.files.diskState || {};
    return {
      plugin: { version: Core.PLUGIN_VERSION, language: I18n.language },
      host: {
        version: app.hostVersion,
        platform: app.platform,
        language: app.hostLanguage,
        permissions: (app.permissions || []).slice().sort(),
        online: app.online,
        legacyOverride: Boolean(app.caps.override),
      },
      caps: app.caps.report(),
      catalog: {
        phase: s.phase,
        error: s.error || '',
        catalogVersion: app.catalog.meta.catalogVersion || 0,
        generatedAt: manifest.generatedAt || '',
        lastOkAt: s.lastOkAt || 0,
        issues: app.index.size,
        shardsLoaded: s.shardsLoaded,
        shardsTotal: s.shardsTotal,
        weeksRows: app.index.weeks.length,
        weeksArchive: app.catalog.hasWeeksArchive() ? (app.catalog.weeksArchiveLoaded() ? 'loaded' : 'available') : 'none',
        aliases: app.index.issueAlias.size,
      },
      files: {
        folder: app.files.hasFolder ? disk.status : 'none',
        files: disk.count || 0,
        queued: app.files.list().filter((j) => j.status === 'queued' || j.status === 'active').length,
        remoteGrants: app.files.remote.size,
      },
      state: { readOnly: app.state.readOnly, failedDomains: [...app.state.failed], history: app.state.historyOn },
      perf: { lastQueryMs: Math.round(app.lastQueryMs * 10) / 10, indexBuildMs: Math.round(app.index.lastBuildMs), memory: memory() },
      log: app.log.counts(),
    };
  }

  /** טקסט לדיווח (ללא נתיבים), עם זנב היומן. */
  function report(app, options) {
    const o = options || {};
    const d = snapshot(app);
    const lines = [
      'Alonim plugin ' + d.plugin.version + ' (' + d.plugin.language + ')',
      'Otzaria ' + show(d.host.version) + ' / ' + show(d.host.platform) + ' / ' + show(d.host.language) + (d.host.online === false ? ' / offline' : ''),
      'permissions: ' + (d.host.permissions.join(', ') || 'none'),
      'capabilities' + (d.host.legacyOverride ? ' (legacy override ON)' : '') + ':',
      ...d.caps.map((c) => '  ' + c.feature + ' (' + c.method + '): ' + (c.available ? 'yes' : 'no') + ' [' + c.source + (c.detail ? ': ' + c.detail : '') + ']'),
      'catalog v' + d.catalog.catalogVersion + (d.catalog.generatedAt ? ' (' + d.catalog.generatedAt + ')' : '') + ', issues ' + d.catalog.issues + ', phase ' + d.catalog.phase + (d.catalog.error ? ' (' + d.catalog.error + ')' : ''),
      'shards ' + show(d.catalog.shardsLoaded) + '/' + show(d.catalog.shardsTotal) + ', weeks ' + d.catalog.weeksRows + ', archive ' + d.catalog.weeksArchive + ', id aliases ' + d.catalog.aliases,
      'folder: ' + d.files.folder + ', files ' + d.files.files + ', queue ' + d.files.queued + ', remote grants ' + d.files.remoteGrants,
      'state read-only: ' + d.state.readOnly + (d.state.failedDomains.length ? ' (failed: ' + d.state.failedDomains.join(',') + ')' : '') + ', history ' + (d.state.history ? 'on' : 'off'),
      'perf: last query ' + d.perf.lastQueryMs + 'ms, index build ' + d.perf.indexBuildMs + 'ms' + (d.perf.memory ? ', heap ' + d.perf.memory.usedMb + 'MB' : ''),
      'log: ' + Object.entries(d.log).map(([k, v]) => k + ' ' + v).join(', '),
      '',
      app.log.tail(o.tail || 60, o.filter),
    ];
    return lines.join('\n');
  }

  A.Diagnostics = { snapshot, report };
  if (typeof module === 'object' && module.exports) module.exports = A.Diagnostics;
})(typeof self !== 'undefined' ? self : globalThis);
