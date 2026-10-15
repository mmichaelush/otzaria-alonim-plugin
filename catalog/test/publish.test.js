import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fwd = (p) => p.replace(/\\/g, '/');
const SCRIPT = fwd(fileURLToPath(new URL('../tools/publish-data-branch.sh', import.meta.url)));

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: (r.stdout || '').trim() };
}
const git = (dir, ...args) => sh('git', ['-C', dir, ...args]);

async function makeCatalog(dir, version, extra = 'a') {
  await mkdir(join(dir, 'issues'), { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ schema: 1, catalogVersion: version }) + '\n');
  await writeFile(join(dir, 'issues', '5787.json'), `[{"id":"${extra}"}]\n`);
}

test('publish script: single orphan commit, empty on identical content, never touches main', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alonim-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bare = fwd(join(root, 'remote.git'));
  assert.equal(sh('git', ['init', '--bare', '-b', 'main', bare]).status, 0);

  // main has history of its own that must survive untouched
  const seed = fwd(join(root, 'seed'));
  sh('git', ['init', '-b', 'main', seed]);
  git(seed, 'config', 'user.name', 't'); git(seed, 'config', 'user.email', 't@t');
  await writeFile(join(root, 'seed', 'README.md'), 'code\n');
  git(seed, 'add', '-A'); git(seed, 'commit', '-m', 'code');
  git(seed, 'push', bare, 'main');
  const mainSha = git(bare, 'rev-parse', 'main').stdout;

  const run = (out) => sh('bash', [SCRIPT, fwd(out), bare], { env: { ...process.env, GIT_AUTHOR_NAME: 'bot', GIT_AUTHOR_EMAIL: 'bot@example.com', GIT_COMMITTER_NAME: 'bot', GIT_COMMITTER_EMAIL: 'bot@example.com' } });

  // 1. first publish creates branch data with exactly one parentless commit
  const v1 = join(root, 'v1');
  await makeCatalog(v1, 100);
  const r1 = run(v1);
  assert.equal(r1.status, 0, r1.out);
  assert.match(r1.out, /published catalog 100/);
  assert.equal(git(bare, 'rev-list', '--count', 'data').stdout, '1');
  assert.equal(git(bare, 'rev-list', '--max-parents=0', 'data').stdout, git(bare, 'rev-parse', 'data').stdout, 'orphan: no parent');
  assert.equal(git(bare, 'show', 'data:manifest.json').stdout, '{"schema":1,"catalogVersion":100}');
  const sha1 = git(bare, 'rev-parse', 'data').stdout;

  // 2. same content again: nothing happens (same commit id)
  const v1b = join(root, 'v1b');
  await makeCatalog(v1b, 100);
  const r2 = run(v1b);
  assert.equal(r2.status, 0, r2.out);
  assert.match(r2.out, /unchanged/);
  assert.equal(git(bare, 'rev-parse', 'data').stdout, sha1);

  // 3. changed content: a new single orphan commit replaces the old one (history does not grow)
  const v2 = join(root, 'v2');
  await makeCatalog(v2, 101, 'b');
  const r3 = run(v2);
  assert.equal(r3.status, 0, r3.out);
  assert.equal(git(bare, 'rev-list', '--count', 'data').stdout, '1');
  assert.notEqual(git(bare, 'rev-parse', 'data').stdout, sha1);
  assert.equal(git(bare, 'show', 'data:issues/5787.json').stdout, '[{"id":"b"}]');
  // a file that disappeared from the catalog disappears from the branch
  const v3 = join(root, 'v3');
  await makeCatalog(v3, 102, 'b');
  await rm(join(v3, 'issues'), { recursive: true });
  assert.equal(run(v3).status, 0);
  assert.equal(git(bare, 'ls-tree', '-r', '--name-only', 'data').stdout, 'manifest.json');

  // 4. main was never touched
  assert.equal(git(bare, 'rev-parse', 'main').stdout, mainSha);
  assert.equal(git(bare, 'rev-list', '--count', 'main').stdout, '1');

  // 5. safety: not a catalog, and never main
  const empty = join(root, 'empty');
  await mkdir(empty);
  const bad = run(empty);
  assert.equal(bad.status, 1);
  assert.match(bad.out, /not a catalog/);
  const onMain = sh('bash', [SCRIPT, fwd(v1), bare, 'main']);
  assert.equal(onMain.status, 1);
  assert.equal(git(bare, 'rev-parse', 'main').stdout, mainSha);
});
