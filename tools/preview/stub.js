// גשר מדומה לתצוגה מקדימה בדפדפן: `window.Otzaria` מ-fake-sdk.js, קטלוג מקומי
// מ-`window.__FIXTURE__`, וערכות הצבעים של אוצריא. פרמטרים בכתובת:
//   scenario=ready|offline|blocked|slow|bad-schema|rate-limit|download-blocked|
//            download-html|no-folder-permission|reader-permission|folder-gone|
//            legacy-host|fetchfile-blocked|fetchfile-html|print-cancel|print-gesture|print-gesture-first|print-slow|reader-hang|reader-nolibrary
//   host=legacy  (אוצריא 0.9.98: בלי fetchFile ו-printFile)   welcome=1   minetab=<לשונית>
//   mode=dark   lang=en   scale=1.3   today=2026-10-15   seed=0|1
//   page=week|all|series|mine|settings   query=…   series=<מספר>   open=<מספר>
//   details=<מספר>   section=<מזהה סעיף בהגדרות>   nofolder=1   print=1
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const scenario = params.get('scenario') || (params.get('offline') ? 'offline' : 'ready');
  const dark = params.get('mode') === 'dark';

  // שעון קבוע לצילומים: מוסט בקבוע, וממשיך לרוץ (מגביל הקצב נשען עליו).
  if (params.get('today')) {
    const RealDate = Date;
    const offset = new RealDate(params.get('today') + 'T12:00:00').getTime() - RealDate.now();
    class ShiftedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(RealDate.now() + offset);
        else super(...args);
      }
      static now() {
        return RealDate.now() + offset;
      }
    }
    window.Date = ShiftedDate;
  }

  const schemes = {
    light: {
      primary: '#805610',
      onPrimary: '#ffffff',
      primaryContainer: '#ffddb3',
      onPrimaryContainer: '#633f00',
      secondary: '#6f5b40',
      onSecondary: '#ffffff',
      secondaryContainer: '#fbdebc',
      onSecondaryContainer: '#56442a',
      tertiary: '#51643f',
      onTertiary: '#ffffff',
      tertiaryContainer: '#d4eabb',
      onTertiaryContainer: '#3a4c2a',
      surface: '#fff8f4',
      onSurface: '#201b13',
      onSurfaceVariant: '#4f4539',
      surfaceContainerLowest: '#ffffff',
      surfaceContainerLow: '#fff1e5',
      surfaceContainer: '#f9ecdf',
      surfaceContainerHigh: '#f3e6da',
      surfaceContainerHighest: '#ede0d4',
      error: '#ba1a1a',
      onError: '#ffffff',
      errorContainer: '#ffdad6',
      onErrorContainer: '#93000a',
      outline: '#817567',
      outlineVariant: '#d3c4b4',
      inverseSurface: '#362f27',
      onInverseSurface: '#fcefe2',
      inversePrimary: '#f4bd6f',
      shadow: '#000000',
      scrim: '#000000',
      surfaceTint: '#805610',
    },
    dark: {
      primary: '#f4bd6f',
      onPrimary: '#472a00',
      primaryContainer: '#633f00',
      onPrimaryContainer: '#ffddb3',
      secondary: '#ddc2a1',
      onSecondary: '#3e2d16',
      secondaryContainer: '#56442a',
      onSecondaryContainer: '#fbdebc',
      tertiary: '#b8cea0',
      onTertiary: '#243515',
      tertiaryContainer: '#3a4c2a',
      onTertiaryContainer: '#d4eabb',
      surface: '#17130b',
      onSurface: '#ebe1d5',
      onSurfaceVariant: '#d3c4b4',
      surfaceContainerLowest: '#110e07',
      surfaceContainerLow: '#201b13',
      surfaceContainer: '#241f17',
      surfaceContainerHigh: '#2f2921',
      surfaceContainerHighest: '#3a342b',
      error: '#ffb4ab',
      onError: '#690005',
      errorContainer: '#93000a',
      onErrorContainer: '#ffdad6',
      outline: '#9c8f80',
      outlineVariant: '#4f4539',
      inverseSurface: '#ebe1d5',
      onInverseSurface: '#362f27',
      inversePrimary: '#805610',
      shadow: '#000000',
      scrim: '#000000',
      surfaceTint: '#f4bd6f',
    },
  };

  const fixture = window.__FIXTURE__ || { files: {} };
  const sizes = new Map();
  // רק בקטלוג הקטן: פענוח של קטלוג ענק בכל טעינה היה מעוות את מדידות הביצועים.
  const small = Object.values(fixture.files).reduce((n, text) => n + text.length, 0) < 8e6;
  for (const path of small ? Object.keys(fixture.files) : []) {
    if (path === 'recent.json' || path.startsWith('issues/')) {
      for (const it of JSON.parse(fixture.files[path]))
        for (const a of it.assets || [])
          if (a.url) sizes.set(a.url, Math.min(a.bytes || 0, 1500000));
    }
  }
  const sdk = window.FakeSdk.createFakeSdk({
    scenario,
    legacyHost: params.get('host') === 'legacy',
    catalog: fixture.files,
    sizeFor: (url) => sizes.get(url) || 0,
    netDelay: Number(params.get('netdelay') || 40),
    callLatency: Number(params.get('latency') || 0),
    downloadDelay: Number(params.get('dldelay') || 350),
    slowMs: 2500,
    fileUrl: (abs, file) =>
      URL.createObjectURL(new Blob([file.content], { type: 'application/pdf' })),
  });

  // xorigin=1: מדמה את WebView האמיתי, שבו ה-iframe של ה-Blob הוא ממקור אחר (דף file://),
  // ולכן הגישה ל-contentWindow.print נחסמת.
  if (params.get('xorigin')) {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get() {
        const w = desc.get.call(this);
        return (
          w &&
          new Proxy(w, {
            get(target, key) {
              if (key === 'print')
                throw new DOMException(
                  'Blocked a frame with origin "null" from accessing a cross-origin frame.',
                  'SecurityError',
                );
              const v = target[key];
              return typeof v === 'function' ? v.bind(target) : v;
            },
          })
        );
      },
    });
  }

  // ---- מצב משתמש לדוגמה (seed=1 כברירת מחדל): מעקב, מועדפים, קריאה, תיקייה והורדות
  const files = fixture.files;
  const parse = (path) => (files[path] ? JSON.parse(files[path]) : []);
  const recent = parse('recent.json');
  const series = parse('series.json');
  if (params.get('seed') !== '0') {
    const storage = sdk.storage;
    const snap = (it) => ({
      id: it.id,
      s: it.series,
      st: (series.find((s) => s.id === it.series) || {}).title || it.title,
      ti: it.title,
      hy: it.hy || 0,
      d: it.date || '',
      p: it.parasha || [],
      ev: it.event || '',
    });
    const seriesState = {};
    series
      .slice(0, 3)
      .forEach((s) => (seriesState[s.id] = { follow: true, mute: false, fav: false }));
    if (series[3])
      seriesState[series[3].id] = { follow: false, mute: false, fav: true, src: 'tashma' };
    storage.set('state_series', { v: 1, items: seriesState });
    const fav = {};
    recent.slice(2, 5).forEach((it) => (fav[it.id] = { ...snap(it), t: Date.now() }));
    storage.set('state_favorites', { v: 1, items: fav });
    const read = {};
    recent.slice(8, 12).forEach((it) => (read[it.id] = Date.now() - 86400000));
    storage.set('state_read', { v: 1, items: read });
    storage.set('state_lists', {
      v: 1,
      items: [
        {
          id: 'l1',
          name: 'לקרוא אחר כך',
          kind: 'list',
          created: Date.now(),
          entries: [snap(recent[10]), snap(recent[11])],
        },
        {
          id: 'l2',
          name: 'אוסף שבת',
          kind: 'shabbat',
          created: Date.now(),
          entries: [snap(recent[0]), snap(recent[1]), snap(recent[20])],
        },
      ],
    });
    storage.set('state_opened', {
      v: 1,
      items: recent.slice(6, 8).map((it) => ({ ...snap(it), t: Date.now() - 3600000 })),
    });
    const prefs = {
      v: 1,
      scale: Number(params.get('scale') || 1),
      lang: params.get('lang') || 'auto',
      view: params.get('view') === 'list' ? 'list' : 'cards',
      sort: 'relevance',
      thumbs: false,
      diaspora: false,
      autoDownload: false,
      autoDownloadCap: 5,
      autoDay: '',
      autoCount: 0,
      welcomeSeen: !params.get('welcome'),
      folder: params.get('nofolder')
        ? null
        : { token: 'folder-1', name: 'עלונים', path: sdk.folderRoot },
    };
    storage.set('prefs', prefs);
    if (!params.get('nofolder')) {
      sdk.folders.set('folder-1', { token: 'folder-1', name: 'עלונים', path: sdk.folderRoot });
      window.__seedDownloads = () => {
        const Core = window.Alonim.Core;
        recent.slice(0, 5).forEach((it) => {
          const p = Core.downloadPath(
            { ...it, seriesTitle: (series.find((s) => s.id === it.series) || {}).title },
            (series.find((s) => s.id === it.series) || {}).title,
          );
          sdk.putFile(p.dir + '/' + p.file);
        });
      };
    }
  } else if (params.get('scale')) {
    sdk.storage.set('prefs', { v: 1, scale: Number(params.get('scale')) });
  }

  // warm=1: ביקור שני. המטמון הפרטי כבר מלא, כמו אחרי סנכרון מוצלח.
  if (params.get('warm') && files['manifest.json']) {
    const manifest = JSON.parse(files['manifest.json']);
    const meta = {
      sha: {},
      use: {},
      catalogVersion: manifest.catalogVersion,
      lastOkAt: Date.now() - 3600000,
      lastCheckAt: Date.now() - 3600000,
    };
    const put = (path, text) =>
      sdk.privateFs.set('catalog/' + path, { content: text, size: text.length });
    put('manifest.json', files['manifest.json']);
    for (const key of ['series', 'weeks', 'recent']) {
      put(key + '.json', files[key + '.json']);
      meta.sha[key + '.json'] = manifest.files[key].sha256;
    }
    for (const s of manifest.shards) {
      put('issues/' + s.id + '.json', files['issues/' + s.id + '.json']);
      meta.sha['issues/' + s.id + '.json'] = s.sha256;
    }
    put('meta.json', JSON.stringify(meta));
  }

  window.Otzaria = sdk;
  window.__sdk = sdk;

  window.addEventListener('load', async () => {
    if (window.__seedDownloads) window.__seedDownloads();
    const payload = {
      plugin: { id: 'com.otzaria-alonim', version: '0.2.0' },
      app: {
        version:
          scenario === 'legacy-host' || params.get('host') === 'legacy' ? '0.9.98' : '0.9.99',
        platform: params.get('platform') || 'windows',
        language: params.get('lang') || 'he',
        locale: 'he-IL',
        textDirection: 'rtl',
      },
      connectivity: { isOnline: scenario === 'offline' ? false : true },
      permissions: ['network.access', 'fs.user_files.read', 'app.open_url'],
      theme: {
        mode: dark ? 'dark' : 'light',
        colorScheme: dark ? schemes.dark : schemes.light,
        typography: { uiFontFamily: 'Rubik', fontFamily: 'FrankRuhlCLM', fontSize: 25 },
      },
    };
    await sdk.emit('plugin.boot', payload);
    const app = window.__alonimApp;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(Number(params.get('settle') || 700));
    if (!app) return;
    if (params.get('minetab')) app.view.mine.tab = params.get('minetab');
    if (params.get('page')) app.go(params.get('page'), { section: params.get('section') || '' });
    if (params.get('query')) {
      app.go('all', { query: params.get('query') });
    }
    if (params.get('series'))
      app.openSeries(app.index.seriesList()[Number(params.get('series'))].id);
    await wait(150);
    const nth = (n) =>
      app.index.item(app.index.search('', {}, {}, { sort: 'date' }).idx[Number(n)]);
    if (params.get('details')) app.showDetails(nth(params.get('details')));
    if (params.get('open') !== null && params.get('open') !== '') {
      const item = nth(params.get('open'));
      if (params.get('print')) app.print(item);
      else app.openIssue(item);
    }
    await wait(250);
    document.documentElement.dataset.previewReady = '1';
  });
})();
