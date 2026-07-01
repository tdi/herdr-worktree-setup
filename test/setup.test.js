import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETUP = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'setup.js');

function git(cwd, ...args) {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
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
