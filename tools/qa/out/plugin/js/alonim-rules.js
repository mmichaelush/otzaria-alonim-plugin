// כללי סינון: החלטת הצגה אחת לכל גיליון, עם סיבה. טהור: בלי DOM ובלי SDK.
//
// סדר הכרעה (docs/ARCHITECTURE.md): חסימה מפורשת > הרשאה מפורשת > כלל סדרה
// (לפי שם) > כלל מקור/שפה/חוג/תבנית > ברירת המחדל של המצב. "מפורש" הוא כלל על
// גיליון או סדרה לפי מזהה: זה מה שנוצר מ"הסתר סדרה זו". באותה רמה חסימה גוברת
// על הרשאה. `nodownload` ו-`pin` אינם מכריעים בהצגה: הם דגלים שנצברים.
(function (root) {
  'use strict';

  const A = root.Alonim;
  const I18n = A.I18n;
  const t = (text, vars) => I18n.t(text, vars);
  const N = (text) => text;
  const { normalizeKey, searchKey } = A.Normalize;

  const SCHEMA = 1;
  const ACTIONS = Object.freeze(['hide', 'show', 'nodownload', 'pin']);
  const FIELDS = Object.freeze(['issue', 'series', 'seriesText', 'source', 'lang', 'circle', 'pattern']);
  const MODES = Object.freeze(['blacklist', 'whitelist']);
  const MAX_RULES = 500;
  const MAX_VALUE = 200;

  const FIELD_LABELS = Object.freeze({
    issue: N('גיליון'),
    series: N('סדרה'),
    seriesText: N('שם סדרה'),
    source: N('מקור'),
    lang: N('שפה'),
    circle: N('חוג'),
    pattern: N('תבנית בשם'),
  });

  const ACTION_LABELS = Object.freeze({
    hide: N('הסתר'),
    show: N('הצג'),
    nodownload: N('בלי הורדה'),
    pin: N('הצמד'),
  });

  const emptyRules = () => ({ v: SCHEMA, mode: 'blacklist', rules: [] });

  let counter = 0;
  const newId = () => 'r' + Date.now().toString(36) + (counter++).toString(36);

  /** כלל תקין או `null`. מנקה שדות לא מוכרים: מייבאים רק מה שמכירים. */
  function cleanRule(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!ACTIONS.includes(raw.action) || !FIELDS.includes(raw.field)) return null;
    const value = String(raw.value === undefined || raw.value === null ? '' : raw.value).slice(0, MAX_VALUE);
    if (!value.trim()) return null;
    const rule = {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : newId(),
      action: raw.action,
      field: raw.field,
      value: value.trim(),
    };
    if (typeof raw.label === 'string' && raw.label) rule.label = raw.label.slice(0, MAX_VALUE);
    if (typeof raw.at === 'number') rule.at = raw.at;
    return rule;
  }

  /** `{ ok, rules, dropped }`: מקבל גם קלט פגום, ולא זורק. */
  function sanitize(raw) {
    const out = emptyRules();
    let dropped = 0;
    if (!raw || typeof raw !== 'object') return { ok: false, rules: out, dropped };
    if (typeof raw.v === 'number' && raw.v > SCHEMA) return { ok: false, rules: out, dropped, tooNew: true };
    if (MODES.includes(raw.mode)) out.mode = raw.mode;
    const seen = new Set();
    for (const item of Array.isArray(raw.rules) ? raw.rules.slice(0, MAX_RULES) : []) {
      const rule = cleanRule(item);
      if (!rule || seen.has(rule.id)) {
        dropped++;
        continue;
      }
      seen.add(rule.id);
      out.rules.push(rule);
    }
    return { ok: true, rules: out, dropped };
  }

  const SOURCES_OF = (item) => item.srcs || (item.assets || []).map((a) => a.src);

  /**
   * מהדר את הכללים לפונקציית החלטה. [ctx]: `{ seriesTitle(item) }` — שם הסדרה
   * לכללי שם. ההשוואות לפי `normalizeKey`, ושמות סדרה מנורמלים פעם אחת.
   */
  function compile(ruleset, ctx) {
    const set = ruleset && Array.isArray(ruleset.rules) ? ruleset : emptyRules();
    const mode = set.mode === 'whitelist' ? 'whitelist' : 'blacklist';
    const byId = { issue: { hide: new Map(), show: new Map() }, series: { hide: new Map(), show: new Map() } };
    const lists = { seriesText: [], source: [], lang: [], circle: [], pattern: [] };
    const flags = { nodownload: [], pin: [] };
    for (const rule of set.rules) {
      const key = rule.field === 'issue' || rule.field === 'series' ? byId[rule.field] : null;
      if (key && (rule.action === 'hide' || rule.action === 'show')) {
        key[rule.action].set(rule.value, rule);
      } else if (rule.action === 'nodownload' || rule.action === 'pin') {
        flags[rule.action].push(prepare(rule));
      } else if (lists[rule.field]) {
        lists[rule.field].push(prepare(rule));
      }
    }
    // האינדקס מחשב את הנרמול פעם אחת לגיליון (`_ns`, `_nall`, `_nc`): החלטה
    // על 50,000 גיליונות אינה מנרמלת מחדש בכל שינוי כלל.
    const textOf = (item) => {
      if (item._ns !== undefined) return { series: item._ns, all: item._nall !== undefined ? item._nall : normalizeKey((item.seriesTitle || '') + ' ' + (item.title || '')) };
      const series = ctx && ctx.seriesTitle ? ctx.seriesTitle(item) : item.seriesTitle || '';
      return { series: normalizeKey(series), all: normalizeKey(series + ' ' + (item.title || '')) };
    };
    const empty = set.rules.length === 0;

    function matches(prepared, item, text) {
      const { rule, norm } = prepared;
      switch (rule.field) {
        case 'issue':
          return item.id === rule.value;
        case 'series':
          return item.series === rule.value;
        case 'seriesText':
          return text.series.includes(norm);
        case 'pattern':
          return text.all.includes(norm);
        case 'lang':
          return item.lang === rule.value;
        case 'circle':
          return (item._nc !== undefined ? item._nc : normalizeKey(item.circleName || '')) === norm;
        case 'source':
          return SOURCES_OF(item).includes(rule.value);
        default:
          return false;
      }
    }

    /** מי מבין הכללים שבאותה רמה פוגע בגיליון: `{hide, show}`. */
    function levelHit(fields, item, text) {
      let hide = null;
      let show = null;
      for (const field of fields) {
        for (const prepared of lists[field]) {
          if (!matches(prepared, item, text)) continue;
          if (prepared.rule.action === 'hide' && !hide) hide = prepared.rule;
          if (prepared.rule.action === 'show' && !show) show = prepared.rule;
        }
      }
      return { hide, show };
    }

    /** גיליון עם כמה עותקים: כלל מקור מסתיר אותו רק אם כל המקורות מוסתרים. */
    function sourceDecision(item, text) {
      const sources = SOURCES_OF(item);
      const hiddenBy = new Map();
      const shownBy = new Map();
      for (const prepared of lists.source) {
        if (!sources.includes(prepared.rule.value)) continue;
        (prepared.rule.action === 'hide' ? hiddenBy : prepared.rule.action === 'show' ? shownBy : new Map()).set(
          prepared.rule.value,
          prepared.rule,
        );
      }
      return { hiddenBy, shownBy, sources };
    }

    function decide(item) {
      if (empty && mode === 'blacklist') return { action: 'show', rule: null, level: 4, noDownload: false, pin: false, hiddenSources: [] };
      const text = textOf(item);
      const decision = { action: 'show', rule: null, level: 4, noDownload: false, pin: false, hiddenSources: [] };
      const issueHide = byId.issue.hide.get(item.id);
      const seriesHide = byId.series.hide.get(item.series);
      const issueShow = byId.issue.show.get(item.id);
      const seriesShow = byId.series.show.get(item.series);
      const seriesLevel = levelHit(['seriesText'], item, text);
      const itemLevel = levelHit(['lang', 'circle', 'pattern'], item, text);
      const src = sourceDecision(item, text);
      // כל המקורות של הגיליון מוסתרים בכלל מקור.
      const allSourcesHidden = src.sources.length > 0 && src.sources.every((s) => src.hiddenBy.has(s));
      decision.hiddenSources = [...src.hiddenBy.keys()];

      if (issueHide || seriesHide) {
        decision.action = 'hide';
        decision.rule = issueHide || seriesHide;
        decision.level = 0;
      } else if (issueShow || seriesShow) {
        decision.rule = issueShow || seriesShow;
        decision.level = 1;
      } else if (seriesLevel.hide || seriesLevel.show) {
        decision.level = 2;
        if (seriesLevel.hide) [decision.action, decision.rule] = ['hide', seriesLevel.hide];
        else decision.rule = seriesLevel.show;
      } else if (itemLevel.hide || itemLevel.show || allSourcesHidden || src.shownBy.size) {
        decision.level = 3;
        if (itemLevel.hide) [decision.action, decision.rule] = ['hide', itemLevel.hide];
        else if (allSourcesHidden) [decision.action, decision.rule] = ['hide', src.hiddenBy.values().next().value];
        else decision.rule = itemLevel.show || src.shownBy.values().next().value;
      } else if (mode === 'whitelist') {
        decision.action = 'hide';
      }
      for (const prepared of flags.nodownload) if (matches(prepared, item, text)) decision.noDownload = true;
      for (const prepared of flags.pin) if (matches(prepared, item, text)) decision.pin = true;
      return decision;
    }

    return { decide, mode };
  }

  function prepare(rule) {
    return { rule, norm: normalizeKey(rule.value) };
  }

  /**
   * "כלל זה יסתיר N גיליונות": מה משתנה אם [candidate] מצטרף ל-[ruleset].
   * [items] רשימת הגיליונות (אחרי הטעינה). `hides`/`shows` — כמה עוברים
   * מהצגה להסתרה ולהפך; [examples] — כותרות לדוגמה.
   */
  function simulate(ruleset, candidate, items, ctx, limit) {
    const rule = cleanRule(candidate);
    if (!rule) return { hides: 0, shows: 0, total: 0, examples: [] };
    const before = compile(ruleset, ctx);
    const next = { ...ruleset, rules: [...ruleset.rules.filter((r) => r.id !== rule.id), rule] };
    const after = compile(next, ctx);
    let hides = 0;
    let shows = 0;
    let affected = 0;
    const examples = [];
    for (const item of items) {
      const a = before.decide(item);
      const b = after.decide(item);
      const changed = a.action !== b.action || a.noDownload !== b.noDownload || a.pin !== b.pin;
      if (!changed) continue;
      affected++;
      if (a.action === 'show' && b.action === 'hide') hides++;
      if (a.action === 'hide' && b.action === 'show') shows++;
      if (examples.length < (limit || 5)) examples.push(item);
    }
    return { hides, shows, total: affected, examples };
  }

  /** משפט בעברית על כלל, לרשימה ולסיבת הצגה: "הסתר · מקור: לדעת". */
  function describe(rule, names) {
    const n = names || {};
    let value = rule.label || rule.value;
    if (rule.field === 'source' && n.source) value = n.source(rule.value) || value;
    if (rule.field === 'lang' && n.lang) value = n.lang(rule.value) || value;
    if (rule.field === 'series' && n.series) value = n.series(rule.value) || value;
    return t(ACTION_LABELS[rule.action]) + ' · ' + t(FIELD_LABELS[rule.field]) + ': ' + value;
  }

  /** הסיבה שבגללה הגיליון מוצג או מוסתר, כטקסט. */
  function reasonText(decision, names, mode) {
    if (!decision.rule) {
      return mode === 'whitelist' && decision.action === 'hide'
        ? t('לא ברשימת המותרים (מצב "רק מה שהותר")')
        : t('ברירת מחדל: מוצג');
    }
    return (decision.action === 'hide' ? t('מוסתר לפי הכלל') : t('מוצג לפי הכלל')) + ': ' + describe(decision.rule, names);
  }

  const api = {
    SCHEMA,
    ACTIONS,
    FIELDS,
    MODES,
    FIELD_LABELS,
    ACTION_LABELS,
    MAX_RULES,
    emptyRules,
    newId,
    cleanRule,
    sanitize,
    compile,
    simulate,
    describe,
    reasonText,
  };
  A.Rules = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
