import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSteps } from '../src/runner.js';

test('runSteps runs in cwd with injected env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtrun-'));
  const res = runSteps(['printf "%s" "$MARKER" > out.txt'], {
    cwd: dir,
    env: { ...process.env, MARKER: 'hello' },
  });
  assert.deepEqual(res, { ok: true });
  assert.equal(readFileSync(join(dir, 'out.txt'), 'utf8'), 'hello');
  rmSync(dir, { recursive: true, force: true });
});

test('runSteps is fail-fast: stops at first non-zero step', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtrun-'));
  const res = runSteps(['true', 'false', 'echo late > late.txt'], { cwd: dir, env: process.env });
  assert.equal(res.ok, false);
  assert.equal(res.failedStep, 'false');
  assert.equal(res.code, 1);
  assert.equal(existsSync(join(dir, 'late.txt')), false);
  rmSync(dir, { recursive: true, force: true });
});

test('runSteps calls onOutput per executed step', () => {
  const seen = [];
  runSteps(['echo one', 'echo two'], {
    cwd: process.cwd(),
    env: process.env,
    onOutput: (o) => seen.push(o.step),
  });
  assert.deepEqual(seen, ['echo one', 'echo two']);
});
