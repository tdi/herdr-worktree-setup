import { spawn } from 'node:child_process';

// Run shell steps sequentially, streaming their output live, fail-fast.
// Callbacks (all optional):
//   onStepStart(step)        - before a step runs
//   onData(chunk)            - a stdout/stderr chunk (Buffer) as it arrives
//   onStepEnd(step, status)  - after a step exits, with its exit status
// Resolves { ok: true } when every step exits 0, otherwise
// { ok: false, failedStep, code } at the first non-zero step.
export function runSteps(steps, { cwd, env, onStepStart, onData, onStepEnd } = {}) {
  return new Promise((resolve) => {
    let index = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const runNext = () => {
      if (index >= steps.length) {
        finish({ ok: true });
        return;
      }
      const step = steps[index];
      if (onStepStart) onStepStart(step);

      const child = spawn(step, { shell: '/bin/sh', cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let ended = false;
      const endStep = (status) => {
        if (ended) return;
        ended = true;
        if (onStepEnd) onStepEnd(step, status);
        if (status === 0) {
          index += 1;
          runNext();
        } else {
          finish({ ok: false, failedStep: step, code: status });
        }
      };

      // Always drain both streams so the child never blocks on a full pipe.
      child.stdout.on('data', (chunk) => { if (onData) onData(chunk); });
      child.stderr.on('data', (chunk) => { if (onData) onData(chunk); });
      child.on('error', () => endStep(1));
      child.on('close', (code) => endStep(code ?? 1));
    };

    runNext();
  });
}
