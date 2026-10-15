'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load');

const { Theme } = loadPlugin();

function fakeDocument() {
  const props = new Map();
  return {
    props,
    documentElement: {
      dataset: {},
      style: {
        setProperty: (name, value) => props.set(name, value),
        removeProperty: (name) => props.delete(name),
      },
    },
  };
}

test('applyTheme: כל תפקיד צבע הופך למשתנה CSS, והמצב נרשם', () => {
  const doc = fakeDocument();
  const ok = Theme.applyTheme(
    { mode: 'dark', colorScheme: { primary: '#112233', onSurfaceVariant: '#445566', surfaceContainerHighest: '#778899', ignored: '' }, typography: { uiFontFamily: "Ru'bik" } },
    doc,
  );
  assert.equal(ok, true);
  assert.equal(doc.props.get('--color-primary'), '#112233');
  assert.equal(doc.props.get('--color-on-surface-variant'), '#445566');
  assert.equal(doc.props.get('--color-surface-container-highest'), '#778899');
  assert.equal(doc.props.has('--color-ignored'), false);
  assert.equal(doc.documentElement.dataset.mode, 'dark');
  assert.equal(doc.props.get('--font-ui'), "'Rubik', system-ui, sans-serif", 'מרכאה בשם גופן מוסרת');
});

test('applyTheme: ערכה חסרה אינה משנה דבר', () => {
  const doc = fakeDocument();
  assert.equal(Theme.applyTheme(null, doc), false);
  assert.equal(Theme.applyTheme({ mode: 'light' }, doc), false);
  assert.equal(doc.props.size, 0);
});

test('applyScale: גודל תצוגה בטווח, וערך מחוץ לו חוזר ל-1', () => {
  const doc = fakeDocument();
  Theme.applyScale(1.3, doc);
  assert.equal(doc.props.get('--ui-scale'), '1.3');
  Theme.applyScale(9, doc);
  assert.equal(doc.props.get('--ui-scale'), '1');
  Theme.applyScale('x', doc);
  assert.equal(doc.props.get('--ui-scale'), '1');
});
