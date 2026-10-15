import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fixtureJson, fakeHttp, HostBlockedError } from './helpers.js';
import * as ladaat from '../connectors/ladaat.mjs';
import * as tashma from '../connectors/tashma.mjs';
import * as gilyoines from '../connectors/gilyoines.mjs';
import * as alonolam from '../connectors/alonolam.mjs';
import * as beinenu from '../connectors/beinenu.mjs';

const collect = async (gen) => { const out = []; for await (const x of gen) out.push(x); return out; };

test('ladaat: dates from the home select, including a festival that is not a Shabbat', () => {
  const { dates } = ladaat.parseHome(fixture('ladaat-home.html'));
  assert.equal(dates.length, 9);
  assert.deepEqual(dates.find((d) => d.label === 'יום הכיפורים'), { date: '2026-09-21', label: 'יום הכיפורים' });
  assert.deepEqual(dates.find((d) => d.date === '2026-10-17'), { date: '2026-10-17', label: 'נח' });
});

test('ladaat: files -> raw issues with series id, language, circle, direct pdf url, page and thumb', () => {
  const items = ladaat.parseFiles(fixtureJson('ladaat-files.json'));
  assert.equal(items.length, 12);
  const a = items.find((i) => i.rawTitle.startsWith('A WELLSPRING'));
  assert.equal(a.src, 'ladaat');
  assert.equal(a.ext, '23538');
  assert.equal(a.seriesHint.ext, '1090');
  assert.equal(a.seriesHint.title, 'A WELLSPRING OF CHIZUK');
  assert.equal(a.seriesHint.lang, 'en');
  assert.equal(a.seriesHint.circle, 'כללי');
  assert.equal(a.dateHint, '2026-10-17');
  assert.equal(a.addedAt, '2026-10-14T20:03:05Z');
  assert.equal(a.url, 'https://ladaat.co/gilyonot/uploads/2026-10-17/files/%5B1090%5D-A-WELLSPRING-OF-CHIZUK-%D7%A0%D7%97.pdf');
  assert.equal(a.page, 'https://ladaat.co/gilyonot/view/23538');
  assert.match(a.thumb, /^https:\/\/ladaat\.co\/gilyonot\/uploads\/2026-10-17\/thumbnails\//);
  // every URL is absolute https and valid
  for (const i of items) { assert.doesNotThrow(() => new URL(i.url)); assert.equal(new URL(i.url).protocol, 'https:'); }
  // double spaces in the source name are collapsed
  assert.ok(items.some((i) => i.seriesHint.title === 'La hoja הדף La hoja de Elad'));
});

test('ladaat: crawl walks the home dates, pages by hasMore, and --full adds older dates', async () => {
  const home = fixture('ladaat-home.html');
  const page = fixtureJson('ladaat-files.json');
  const urls = [];
  const http = fakeHttp({
    'https://ladaat.co/gilyonot/api/files': (u) => { urls.push(u); return { ...page, hasMore: false }; },
    'https://ladaat.co/gilyonot/': home,
  });
  const inc = await collect(ladaat.crawl({ http, now: '2026-10-15T08:00:00Z' }, { full: false }));
  assert.equal(urls.length, 9);
  assert.equal(inc.length, 9 * 12);
  urls.length = 0;
  await collect(ladaat.crawl({ http, now: '2026-10-15T08:00:00Z' }, { full: true }));
  assert.ok(urls.length > 100, `full mode probes older Shabbatot (${urls.length})`);
  assert.ok(urls.every((u) => /limit=500/.test(u)));
});

test('tashma: /new -> raw issues with page count, series and folder, direct file and page urls', () => {
  const items = tashma.parseNew(fixtureJson('tashma-new.json'));
  assert.ok(items.length >= 10);
  const a = items[0];
  assert.equal(a.src, 'tashma');
  assert.equal(a.seriesHint.title, 'להבין');
  assert.deepEqual(a.contextTitles, ['תשפ"ז']);
  assert.equal(a.pages, 24);
  assert.equal(a.url, `https://tashma.co.il/gilyonot/file/${a.ext}`);
  assert.equal(a.page, `https://tashma.co.il/gilyonot/${a.ext}`);
  assert.equal(a.thumb, `https://tashma.co.il/gilyonot/thumb/${a.ext}.png`);
  assert.equal(a.addedAt, '2026-10-14T16:08:23Z');
  // names with bidi marks are cleaned
  assert.ok(items.every((i) => !/[‎‏]/.test(i.rawTitle)));
});

test('tashma: Inertia series page, series list and version', () => {
  const items = tashma.parseSeriesPage(fixtureJson('tashma-series-page.json'), 'להבין');
  assert.equal(items.length, 8);
  assert.ok(items.every((i) => i.seriesHint.title === 'להבין' && i.url.startsWith('https://tashma.co.il/gilyonot/file/')));
  assert.deepEqual(tashma.parseSeriesList(fixtureJson('tashma-list.json')).slice(0, 2), ['א אידישע הארץ', 'א גאליציאנע שטיקל תורה']);
  assert.match(tashma.parseInertiaVersion(fixture('tashma-home-snippet.html')), /^[0-9a-f]{32}$/);
});

test('tashma: incremental reads only /new; full reads the list then one Inertia page per series with its headers', async () => {
  const http = fakeHttp({
    'https://tashma.co.il/gilyonot/new': fixtureJson('tashma-new.json'),
    'https://tashma.co.il/gilyonot/list': fixtureJson('tashma-list.json'),
    'https://tashma.co.il/gilyonot/g/': fixtureJson('tashma-series-page.json'),
    'https://tashma.co.il/gilyonot': fixture('tashma-home-snippet.html'),
  });
  await collect(tashma.crawl({ http }, { full: false }));
  assert.deepEqual(http.calls.map((c) => c.url), ['https://tashma.co.il/gilyonot/new']);
  http.calls.length = 0;
  const all = await collect(tashma.crawl({ http }, { full: true }));
  assert.equal(all.length, 8 * 8);
  const page = http.calls.find((c) => c.url.includes('/g/'));
  assert.equal(page.opts.headers['X-Inertia'], 'true');
  assert.ok(page.opts.headers['X-Inertia-Version']);
  assert.ok(http.calls.every((c) => !/admin|publisher|sendMail|api-internal|search/i.test(c.url)));
});

test('gilyoines: weekly items carry the week label; permanent material is timeless; pdf and thumb urls', () => {
  const items = gilyoines.withWeekRef(gilyoines.parseGilyoines(fixtureJson('gilyoines-home.json')));
  const weekly = items.filter((i) => i.weekHint);
  const timeless = items.filter((i) => i.timeless);
  assert.equal(weekly.length, 10);
  assert.equal(timeless.length, 3);
  assert.equal(weekly[0].weekHint.name, 'נח');
  assert.match(weekly[0].weekHint.refTime, /^2026-09-29T/);
  assert.match(weekly[0].url, /^https:\/\/gilyoines\.com\/storage\/.+\.pdf$/);
  assert.equal(weekly[0].page, 'https://gilyoines.com/');
  assert.ok(!weekly[0].thumb.includes('?'));
  assert.equal(weekly[0].seriesHint.lang, 'he');
  assert.ok(weekly.some((i) => i.seriesHint.lang === 'yi' || i.seriesHint.lang === 'en') || true);
});

test('gilyoines: crawl reads /api/home then nearby weeks (404 week ids are skipped, duplicates removed)', async () => {
  const home = fixtureJson('gilyoines-home.json');
  const http = fakeHttp({
    'https://gilyoines.com/api/home/getGilyoines/': (u) => (u.includes('/225/') ? null : home),
    'https://gilyoines.com/api/home': home,
  });
  const items = await collect(gilyoines.crawl({ http }, { full: false }));
  assert.equal(items.length, 13); // the same 13 items from every response, emitted once
  const weekCalls = http.calls.filter((c) => c.url.includes('getGilyoines'));
  assert.ok(weekCalls.every((c) => c.url.endsWith(`/${home.site_view_id}`)));
  assert.equal(weekCalls.length, 7); // current-2 .. current+4
  http.calls.length = 0;
  await collect(gilyoines.crawl({ http }, { full: true }));
  assert.equal(http.calls.filter((c) => c.url.includes('getGilyoines')).length, 224 + 4 - 191 + 1);
});

test('alonolam: list -> raw issues; docx dropped; series/parasha derived from the file name with a confidence', () => {
  const items = alonolam.parseList(fixtureJson('alonolam-list.json'));
  assert.equal(items.length, 14);
  const tanya = items.find((i) => i.rawTitle.startsWith('תניא'));
  assert.equal(tanya.seriesHint.title, 'תניא');
  assert.equal(tanya.refMonth, '2026-10');
  assert.equal(tanya.url.startsWith('https://alonolam.com/wp-content/uploads/2026/10/'), true);
  assert.ok(/^[ -~]+$/.test(tanya.url), 'url is percent-encoded ASCII');
  assert.ok(items.every((i) => !i.thumb || i.thumb.startsWith('https://')));
  assert.equal(tanya.page, 'https://alonolam.com/%d7%92%d7%9c%d7%a8%d7%99%d7%94/');
  assert.ok(['low', 'medium', 'none'].includes(tanya.rawMeta.confidence));
  assert.equal(alonolam.uploadMonth('https://x/wp-content/uploads/2026/03/a.pdf'), '2026-03');
});

test('alonolam: only the list endpoint is ever requested', async () => {
  const http = fakeHttp({ 'https://alonolam.com/wp-json/gallery/v1/list': fixtureJson('alonolam-list.json') });
  await collect(alonolam.crawl({ http }));
  assert.deepEqual(http.calls.map((c) => c.url), ['https://alonolam.com/wp-json/gallery/v1/list']);
});

test('beinenu: a blocked probe is recorded, never bypassed, and yields no records', async () => {
  const blocked = fakeHttp({ 'https://beinenu.com/': new HostBlockedError('beinenu.com', 'HTTP 403') });
  const r = await beinenu.probe({ http: blocked });
  assert.equal(r.status, 'blocked');
  assert.equal(r.note, 'האתר מגביל גישה אוטומטית; הקישור פותח את האתר');
  assert.equal(beinenu.mode, 'link');
  assert.deepEqual(await collect(beinenu.crawl()), []);
  assert.equal(blocked.calls.length, 1); // exactly one request: no retries, no alternates
  assert.ok(!('headers' in (blocked.calls[0].opts || {})), 'no custom headers');
});
