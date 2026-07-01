import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandTilde, canonicalize, loadConfig, selectSteps } from '../src/config.js';

test('expandTilde expands ~ and ~/ using home', () => {
  assert.equal(expandTilde('~', '/home/u'), '/home/u');
  assert.equal(expandTilde('~/x/y', '/home/u'), '/home/u/x/y');
  assert.equal(expandTilde('/abs/path', '/home/u'), '/abs/path');
});

test('loadConfig returns null for missing dir, missing file, or empty file', () => {
  assert.equal(loadConfig(undefined), null);
  const dir = mkdtempSync(join(tmpdir(), 'wtcfg-'));
  assert.equal(loadConfig(dir), null); // no config.toml
  writeFileSync(join(dir, 'config.toml'), '   \n');
  assert.equal(loadConfig(dir), null); // empty
  rmSync(dir, { recursive: true, force: true });
});

test('loadConfig parses a valid config.toml', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtcfg-'));
  writeFileSync(join(dir, 'config.toml'), '[[project]]\npath = "/x"\nsteps = ["echo hi"]\n');
  const cfg = loadConfig(dir);
  assert.equal(cfg.project[0].path, '/x');
  assert.deepEqual(cfg.project[0].steps, ['echo hi']);
  rmSync(dir, { recursive: true, force: true });
});

test('selectSteps matches main repo by realpath and returns its steps', () => {
  const repo = mkdtempSync(join(tmpdir(), 'wtrepo-'));
  const cfg = { project: [{ path: repo, steps: ['echo match'] }] };
  assert.deepEqual(selectSteps(cfg, repo), ['echo match']);
  rmSync(repo, { recursive: true, force: true });
});

test('selectSteps falls back to [default] when no project matches', () => {
  const repo = mkdtempSync(join(tmpdir(), 'wtrepo-'));
  const cfg = { project: [{ path: '/nope', steps: ['x'] }], default: { steps: ['echo def'] } };
  assert.deepEqual(selectSteps(cfg, repo), ['echo def']);
  rmSync(repo, { recursive: true, force: true });
});

test('selectSteps returns null when no match and no default', () => {
  assert.equal(selectSteps({ project: [{ path: '/nope', steps: ['x'] }] }, '/other'), null);
  assert.equal(selectSteps(null, '/other'), null);
});
