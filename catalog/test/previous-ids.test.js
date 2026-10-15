import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrich, buildAliasIndex } from '../lib/enrich.mjs';
import { mergeAll } from '../lib/merge.mjs';
import { itemsFromPrev, applyPreviousIds, PREVIOUS_ID_TTL_DAYS, MAX_PREVIOUS_IDS } from '../lib/prev.mjs';

const idx = buildAliasIndex({});
const T0 = '2026-10-15T09:00:00Z';
const raw = (o) => ({ src: 'tashma', ext: '1', rawTitle: 'גליון מיוחד', contextTitles: ['תשפ"ז'], seriesHint: { title: 'סדרה' }, addedAt: null, url: 'https://x.test/a.pdf', page: 'https://x.test/', ...o });

/** One build step like build.mjs does it: previous issues in, new issues out. */
function run(raws, prev, now, { sticky = true } = {}) {
  const prevState = prev ? itemsFromPrev({ series: prev.series, issues: prev.issues }, { aliasIndex: idx }) : { items: [], prevAdded: new Map(), cidByKey: new Map() };
  const fresh = raws.map((r) => { const it = enrich(r, { now, aliasIndex: idx }); if (sticky) it.cid = prevState.cidByKey.get(`${r.src}:${r.ext}`); return it; });
  const seen = new Set(fresh.map((i) => `${i.src}:${i.ext}`));
  const items = [...prevState.items.filter((i) => !seen.has(`${i.src}:${i.ext}`)), ...fresh];
  const out = mergeAll(items, { now, prevAdded: prevState.prevAdded, aliasIndex: idx });
  if (prev) applyPreviousIds(out.issues, prev.issues, now);
  return out;
}

test('an id that changes because the week became known: the old id moves to previousIds', () => {
  const r1 = run([raw({})], null, T0);
  const first = r1.issues[0];
  assert.equal(first.previousIds, undefined);
  // the next run reads the same file, but its title now names a parasha
  const r2 = run([raw({ rawTitle: 'גליון מיוחד נח' })], r1, T0);
  const second = r2.issues[0];
  assert.notEqual(second.id, first.id);
  assert.deepEqual(second.previousIds, [first.id]);
  assert.equal(second.idChangedAt, '2026-10-15');
  assert.equal(r2.issues.length, 1);
});

test('previousIds survive runs where nothing changes, accumulate newest first, and are capped', () => {
  let prev = run([raw({})], null, T0);
  const titles = ['גליון מיוחד נח', 'גליון מיוחד נח 5', 'גליון מיוחד לך לך 5', 'גליון מיוחד וירא 5'];
  const ids = [prev.issues[0].id];
  let now = T0;
  for (const [k, title] of titles.entries()) {
    now = `2026-10-${16 + k}T09:00:00Z`;
    prev = run([raw({ rawTitle: title })], prev, now);
    ids.push(prev.issues[0].id);
    // a no-change run in between keeps what is there
    const again = run([raw({ rawTitle: title })], prev, `2026-10-${16 + k}T12:00:00Z`);
    assert.deepEqual(again.issues[0].previousIds, prev.issues[0].previousIds);
    assert.equal(again.issues[0].idChangedAt, prev.issues[0].idChangedAt);
  }
  assert.equal(new Set(ids).size, ids.length, 'every step has a new id');
  const last = prev.issues[0];
  assert.equal(last.id, ids.at(-1));
  assert.equal(last.previousIds.length, MAX_PREVIOUS_IDS);
  assert.deepEqual(last.previousIds, [ids[3], ids[2], ids[1]], 'newest first; the oldest id fell off');
  assert.equal(last.idChangedAt, '2026-10-19');
});

test('previousIds expire after the TTL, together with idChangedAt', () => {
  const r1 = run([raw({})], null, T0);
  const r2 = run([raw({ rawTitle: 'גליון מיוחד נח' })], r1, T0);
  const day = (n) => new Date(Date.parse(T0) + n * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const edge = run([raw({ rawTitle: 'גליון מיוחד נח' })], r2, day(PREVIOUS_ID_TTL_DAYS));
  assert.equal(edge.issues[0].previousIds.length, 1, 'still valid on the last day');
  const gone = run([raw({ rawTitle: 'גליון מיוחד נח' })], r2, day(PREVIOUS_ID_TTL_DAYS + 2));
  assert.equal(gone.issues[0].previousIds, undefined);
  assert.equal(gone.issues[0].idChangedAt, undefined);
});

test('deterministic and idempotent: same input and prev give the same issues; a second pass changes nothing', () => {
  const other = { ext: '2', rawTitle: 'אחר', seriesHint: { title: 'סדרה אחרת' } };
  const r1 = run([raw({}), raw(other)], null, T0);
  const raws = [raw({ rawTitle: 'גליון מיוחד נח' }), raw(other)];
  const a = run(raws, r1, T0), b = run(raws, r1, T0);
  assert.deepEqual(a.issues, b.issues);
  const c = run(raws, a, T0);
  assert.deepEqual(c.issues, a.issues);
  // the untouched issue never gets previousIds
  assert.equal(a.issues.find((i) => i.assets[0].ext === '2').previousIds, undefined);
});

test('two issues merging into one: the new issue lists both old ids', () => {
  const tashma = (title) => raw({ ext: '1', rawTitle: title, contextTitles: ['תשפ"ז'], seriesHint: { title: 'סדרה' } });
  const ladaat = (title) => raw({ src: 'ladaat', ext: '9', rawTitle: title, contextTitles: [], seriesHint: { title: 'סדרה' }, dateHint: '2026-10-17' });
  const r1 = run([tashma('שבועי נח 2'), ladaat('שבועי 3')], null, T0);
  assert.equal(r1.issues.length, 2, 'different numbers keep them apart');
  // a full crawl (or an alias change) lets earlier decisions be reconsidered: no sticky membership
  const r2 = run([tashma('שבועי נח'), ladaat('שבועי')], r1, T0, { sticky: false });
  assert.equal(r2.issues.length, 1);
  assert.deepEqual([...r2.issues[0].previousIds].sort(), r1.issues.map((i) => i.id).sort());
});
