import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeKey } from '../lib/normalize.mjs';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/normalize-vectors.json', import.meta.url), 'utf8'));

test('normalizeKey matches the shared vectors (the plugin copy must pass the same file)', () => {
  for (const [input, expected] of vectors) assert.equal(normalizeKey(input), expected, JSON.stringify(input));
});

test('normalizeKey is idempotent and tolerates null', () => {
  for (const [input] of vectors) assert.equal(normalizeKey(normalizeKey(input)), normalizeKey(input));
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey(undefined), '');
});

test('maqaf is a word break even though it sits in the niqqud range', () => {
  assert.equal(normalizeKey('מטות־מסעי'), 'מטות מסעי');
});
