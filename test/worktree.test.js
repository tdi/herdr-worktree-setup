import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonEnv, extractWorktreePath, parseMainRepo } from '../src/worktree.js';

test('parseJsonEnv parses valid JSON, returns null otherwise', () => {
  assert.deepEqual(parseJsonEnv('{"a":1}'), { a: 1 });
  assert.equal(parseJsonEnv(''), null);
  assert.equal(parseJsonEnv(undefined), null);
  assert.equal(parseJsonEnv('{bad'), null);
});

test('extractWorktreePath probes event then context for a path field', () => {
  assert.equal(extractWorktreePath({ worktree: { path: '/a' } }, null), '/a');
  assert.equal(extractWorktreePath(null, { worktree: { path: '/b' } }), '/b');
  assert.equal(extractWorktreePath({ path: '/c' }, null), '/c');
  assert.equal(extractWorktreePath(null, null), null);
  assert.equal(extractWorktreePath({}, {}), null);
});

test('parseMainRepo returns the first worktree path from porcelain output', () => {
  const out = [
    'worktree /home/u/code/repo',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /home/u/code/repo-wt/feat',
    'HEAD def456',
    'branch refs/heads/feat',
    '',
  ].join('\n');
  assert.equal(parseMainRepo(out), '/home/u/code/repo');
  assert.equal(parseMainRepo(''), null);
});
