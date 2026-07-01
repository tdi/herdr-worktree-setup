import { spawnSync } from 'node:child_process';

export function runSteps(steps, { cwd, env, onOutput } = {}) {
  for (const step of steps) {
    const res = spawnSync(step, { shell: '/bin/sh', cwd, env, encoding: 'utf8' });
    const status = res.status ?? 1;
    if (onOutput) {
      onOutput({ step, stdout: res.stdout ?? '', stderr: res.stderr ?? '', status });
    }
    if (status !== 0) {
      return { ok: false, failedStep: step, code: status };
    }
  }
  return { ok: true };
}
