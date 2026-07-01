import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonEnv, extractWorktreePath, parseMainRepo, resolveWorktreePath, deriveGitInfo } from '../src/worktree.js';

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

test('resolveWorktreePath prefers the event JSON path (no exec call)', () => {
  const env = { HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ worktree: { path: '/from/event' } }) };
  let called = false;
  const exec = () => { called = true; return { status: 0, stdout: '', stderr: '' }; };
  assert.equal(resolveWorktreePath(env, exec), '/from/event');
  assert.equal(called, false);
});

test('resolveWorktreePath falls back to herdr CLI matched by workspace id', () => {
  const env = { HERDR_WORKSPACE_ID: 'ws-2', HERDR_BIN_PATH: 'herdr' };
  const list = [
    { id: 'ws-1', path: '/wt/one' },
    { id: 'ws-2', path: '/wt/two' },
  ];
  const exec = (cmd, args) => {
    assert.equal(cmd, 'herdr');
    assert.deepEqual(args, ['worktree', 'list', '--json']);
    return { status: 0, stdout: JSON.stringify(list), stderr: '' };
  };
  assert.equal(resolveWorktreePath(env, exec), '/wt/two');
});

test('resolveWorktreePath returns null when nothing resolves', () => {
  assert.equal(resolveWorktreePath({}, () => ({ status: 1, stdout: '', stderr: '' })), null);
});

test('deriveGitInfo returns mainRepo and branch from injected git calls', () => {
  const exec = (cmd, args) => {
    if (args.includes('--porcelain')) {
      return { status: 0, stdout: 'worktree /main/repo\nHEAD abc\n\n', stderr: '' };
    }
    if (args.includes('--abbrev-ref')) {
      return { status: 0, stdout: 'feat\n', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: '' };
  };
  assert.deepEqual(deriveGitInfo('/main/repo/wt', exec), { mainRepo: '/main/repo', branch: 'feat' });
});
