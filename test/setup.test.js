import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETUP = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'setup.js');

function git(cwd, ...args) {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
}

function makeRepoWorktree(root) {
  const repo = join(root, 'main');
  const wt = join(root, 'wt');
  execFileSync('git', ['init', repo], { stdio: 'ignore' });
  git(repo, 'config', 'user.email', 't@t.t');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'file.txt'), 'x');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'worktree', 'add', '-b', 'feat', wt);
  return { repo, wt };
}

test('setup.js runs matched steps in the new worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtint-'));
  const repo = join(root, 'main');
  const wt = join(root, 'wt');
  execFileSync('git', ['init', repo], { stdio: 'ignore' });
  git(repo, 'config', 'user.email', 't@t.t');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'file.txt'), 'x');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'worktree', 'add', '-b', 'feat', wt);

  const configDir = join(root, 'cfg');
  const stateDir = join(root, 'state');
  execFileSync('mkdir', ['-p', configDir, stateDir]);
  writeFileSync(
    join(configDir, 'config.toml'),
    `[[project]]\npath = ${JSON.stringify(realpathSync(repo))}\nsteps = ["printf ok > SETUP_OK"]\n`,
  );

  const res = spawnSync('node', [SETUP], {
    env: {
      ...process.env,
      HERDR_PLUGIN_CONFIG_DIR: configDir,
      HERDR_PLUGIN_STATE_DIR: stateDir,
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ worktree: { path: wt } }),
    },
    encoding: 'utf8',
  });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readFileSync(join(wt, 'SETUP_OK'), 'utf8'), 'ok');
  rmSync(root, { recursive: true, force: true });
});

test('setup.js is a no-op (exit 0) when no config exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtint-'));
  const res = spawnSync('node', [SETUP], {
    env: { ...process.env, HERDR_PLUGIN_CONFIG_DIR: join(root, 'nope') },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  rmSync(root, { recursive: true, force: true });
});

test('setup.js exits non-zero with a clear message on malformed config', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtint-'));
  const configDir = join(root, 'cfg');
  execFileSync('mkdir', ['-p', configDir]);
  writeFileSync(join(configDir, 'config.toml'), 'not = = valid [[[');
  const res = spawnSync('node', [SETUP], {
    env: { ...process.env, HERDR_PLUGIN_CONFIG_DIR: configDir },
    encoding: 'utf8',
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /invalid config\.toml/);
  rmSync(root, { recursive: true, force: true });
});

test('setup.js writes a log to the state dir and passes HERDR_ env to the step', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtint-'));
  const { repo, wt } = makeRepoWorktree(root);
  const configDir = join(root, 'cfg');
  const stateDir = join(root, 'state');
  execFileSync('mkdir', ['-p', configDir, stateDir]);
  writeFileSync(
    join(configDir, 'config.toml'),
    `[[project]]\npath = ${JSON.stringify(realpathSync(repo))}\nsteps = ['printf "%s|%s|%s" "$HERDR_MAIN_REPO" "$HERDR_WORKTREE" "$HERDR_BRANCH" > ENVOUT']\n`,
  );
  const res = spawnSync('node', [SETUP], {
    env: {
      ...process.env,
      HERDR_PLUGIN_CONFIG_DIR: configDir,
      HERDR_PLUGIN_STATE_DIR: stateDir,
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ worktree: { path: wt } }),
    },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  const envOut = readFileSync(join(wt, 'ENVOUT'), 'utf8').split('|');
  assert.ok(envOut[0].length > 0);      // HERDR_MAIN_REPO non-empty
  assert.equal(envOut[1], wt);          // HERDR_WORKTREE is the event path verbatim
  assert.equal(envOut[2], 'feat');      // HERDR_BRANCH
  const logs = readdirSync(stateDir).filter((f) => f.startsWith('setup-') && f.endsWith('.log'));
  assert.equal(logs.length, 1);
  assert.match(readFileSync(join(stateDir, logs[0]), 'utf8'), /\[exit 0\]/);
  rmSync(root, { recursive: true, force: true });
});

test('setup.js exits with the failing step exit code', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtint-'));
  const { repo, wt } = makeRepoWorktree(root);
  const configDir = join(root, 'cfg');
  execFileSync('mkdir', ['-p', configDir]);
  writeFileSync(
    join(configDir, 'config.toml'),
    `[[project]]\npath = ${JSON.stringify(realpathSync(repo))}\nsteps = ["exit 7"]\n`,
  );
  const res = spawnSync('node', [SETUP], {
    env: {
      ...process.env,
      HERDR_PLUGIN_CONFIG_DIR: configDir,
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ worktree: { path: wt } }),
    },
    encoding: 'utf8',
  });
  assert.equal(res.status, 7, res.stderr);
  rmSync(root, { recursive: true, force: true });
});

test('setup.js exits 1 when the worktree path cannot be resolved', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtint-'));
  const configDir = join(root, 'cfg');
  execFileSync('mkdir', ['-p', configDir]);
  writeFileSync(join(configDir, 'config.toml'), '[[project]]\npath = "/x"\nsteps = ["true"]\n');
  const env = { ...process.env, HERDR_PLUGIN_CONFIG_DIR: configDir };
  delete env.HERDR_PLUGIN_EVENT_JSON;
  delete env.HERDR_PLUGIN_CONTEXT_JSON;
  delete env.HERDR_WORKSPACE_ID;
  const res = spawnSync('node', [SETUP], { env, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /could not resolve/);
  rmSync(root, { recursive: true, force: true });
});

test('setup.js exits 1 when the worktree is not a git repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtint-'));
  const notGit = join(root, 'plain');
  const configDir = join(root, 'cfg');
  execFileSync('mkdir', ['-p', notGit, configDir]);
  writeFileSync(join(configDir, 'config.toml'), '[[project]]\npath = "/x"\nsteps = ["true"]\n');
  const res = spawnSync('node', [SETUP], {
    env: {
      ...process.env,
      HERDR_PLUGIN_CONFIG_DIR: configDir,
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ worktree: { path: notGit } }),
    },
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /could not derive main repo/);
  rmSync(root, { recursive: true, force: true });
});
