'use strict';

// עותק ה-QA (tools/qa/make-variant.mjs) מחליף כתובות בקוד לפי תבניות. כשהקוד משתנה
// התבניות עלולות להפסיק להתאים; הבדיקה הזו נכשלת מיד, ושומרת גם על ההפרדה: כתובת
// השרת המקומי מופיעה רק בעותק, לא במוצר.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.join(__dirname, '..', '..');

test('make-variant: נבנה על הקוד הנוכחי, עם שער ה-QA רק בעותק', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'alonim-qa-'));
  try {
    const run = spawnSync(process.execPath, [path.join(repo, 'tools', 'qa', 'make-variant.mjs'), out, '--port', '39811'], { cwd: repo, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const core = fs.readFileSync(path.join(out, 'js', 'alonim-core.js'), 'utf8');
    assert.ok(core.includes('http://127.0.0.1:39811/data/'), 'בסיס הקטלוג של ה-QA');
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.id, 'com.otzaria-alonim.qa');
    // המוצר עצמו נקי
    const product = fs.readFileSync(path.join(repo, 'plugin', 'js', 'alonim-core.js'), 'utf8');
    assert.ok(!product.includes('39811'));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
