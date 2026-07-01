import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSteps } from '../src/runner.js';

test('runSteps runs in cwd with injected env', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtrun-'));
  const res = await runSteps(['printf "%s" "$MARKER" > out.txt'], {
    cwd: dir,
    env: { ...process.env, MARKER: 'hello' },
  });
  assert.deepEqual(res, { ok: true });
  assert.equal(readFileSync(join(dir, 'out.txt'), 'utf8'), 'hello');
  rmSync(dir, { recursive: true, force: true });
});

test('runSteps is fail-fast: stops at first non-zero step', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtrun-'));
  const res = await runSteps(['true', 'false', 'echo late > late.txt'], { cwd: dir, env: process.env });
  assert.equal(res.ok, false);
  assert.equal(res.failedStep, 'false');
  assert.equal(res.code, 1);
  assert.equal(existsSync(join(dir, 'late.txt')), false);
  rmSync(dir, { recursive: true, force: true });
});

test('runSteps reports each executed step via onStepStart/onStepEnd', async () => {
  const started = [];
  const ended = [];
  await runSteps(['echo one', 'echo two'], {
    cwd: process.cwd(),
    env: process.env,
    onStepStart: (s) => started.push(s),
    onStepEnd: (s, code) => ended.push([s, code]),
  });
  assert.deepEqual(started, ['echo one', 'echo two']);
  assert.deepEqual(ended, [['echo one', 0], ['echo two', 0]]);
});

test('runSteps forwards step output via onData', async () => {
  let out = '';
  await runSteps(['printf hello'], {
    cwd: process.cwd(),
    env: process.env,
    onData: (chunk) => { out += chunk.toString(); },
  });
  assert.match(out, /hello/);
});

test('runSteps handles output larger than the old 1MB spawnSync cap without failing', async () => {
  // `yes | head -c 2000000` emits ~2MB then exits 0. The previous spawnSync
  // implementation exceeded its 1MB maxBuffer and killed the child (false failure).
  const res = await runSteps(['yes | head -c 2000000'], { cwd: process.cwd(), env: process.env });
  assert.deepEqual(res, { ok: true });
});

test('runSteps does not hang on a step that reads stdin', { timeout: 10000 }, async () => {
  // `cat` reads until EOF; with stdin closed it gets immediate EOF and exits 0.
  // Without the stdin fix this hangs forever.
  const res = await runSteps(['cat'], { cwd: process.cwd(), env: process.env });
  assert.deepEqual(res, { ok: true });
});
