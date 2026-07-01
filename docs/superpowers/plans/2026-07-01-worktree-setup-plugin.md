# Worktree Setup Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a herdr plugin that runs user-configured shell setup steps inside a newly created worktree, resolving discussion #394.

**Architecture:** A Node entrypoint (`src/setup.js`) fires on the `worktree.created` event. It resolves the new worktree path (from the event JSON, with a herdr-CLI fallback), derives the main repo and branch via `git`, matches the main repo against a global TOML config, and runs the matched step list sequentially in the worktree with augmented env. Logic is split into three focused modules (`config.js`, `worktree.js`, `runner.js`), each independently testable without a running herdr.

**Tech Stack:** Node.js (ESM), `smol-toml` for config parsing, `node:test` + `node:assert` for tests, `git` CLI, herdr plugin manifest (TOML).

## Global Constraints

- `min_herdr_version = "0.7.0"`; manifest is `herdr-plugin.toml`.
- `platforms = ["linux", "macos"]` (target tools mise/direnv are unix).
- Exactly one runtime dependency: `smol-toml`. No other deps.
- ESM modules: `package.json` has `"type": "module"`.
- Config lives at `$HERDR_PLUGIN_CONFIG_DIR/config.toml`; the plugin owns its format.
- Steps run via `sh -c`, `cwd` = worktree, fail-fast (stop + exit with the failing step's code).
- Env injected into steps: `HERDR_MAIN_REPO`, `HERDR_WORKTREE`, `HERDR_BRANCH`.
- No emojis anywhere. Prefer Node built-ins.
- Build step is `npm ci`, so `package-lock.json` MUST be committed.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `herdr-plugin.toml` | Plugin manifest: metadata, build, `worktree.created` event hook |
| `package.json` | ESM, `smol-toml` dep, `test` script |
| `src/config.js` | Load/parse `config.toml`; expand `~`; realpath-match main repo → steps |
| `src/worktree.js` | Resolve worktree path (event JSON + CLI fallback); parse main repo + branch via git |
| `src/runner.js` | Run a step list sequentially in a cwd with env; fail-fast |
| `src/setup.js` | Orchestrator + process exit codes; tee log to state dir |
| `config.example.toml` | Documented sample config with recipes |
| `README.md` | Install, configure, recipes |
| `test/config.test.js` | Config tests |
| `test/worktree.test.js` | Worktree/git parse + resolve tests |
| `test/runner.test.js` | Step runner tests |
| `test/setup.test.js` | End-to-end integration (temp git repo, no herdr) |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `herdr-plugin.toml`, `.gitignore`, `config.example.toml`, `test/smoke.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable project — `npm ci` installs `smol-toml`; `npm test` runs `node --test`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "herdr-worktree-setup",
  "version": "0.1.0",
  "description": "Run per-project setup steps when a herdr worktree is created",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "smol-toml": "^1.3.1"
  }
}
```

- [ ] **Step 2: Install to generate the lockfile**

Run: `npm install`
Expected: creates `node_modules/` and `package-lock.json`; `smol-toml` resolved.

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
*.log
```

- [ ] **Step 4: Create `herdr-plugin.toml`**

```toml
id = "tdi.worktree-setup"
name = "Worktree Setup"
version = "0.1.0"
min_herdr_version = "0.7.0"
description = "Run per-project setup steps when a worktree is created"
platforms = ["linux", "macos"]

[[build]]
command = ["npm", "ci"]

[[events]]
on = "worktree.created"
command = ["node", "src/setup.js"]
```

- [ ] **Step 5: Create `config.example.toml`**

```toml
# Copy to $HERDR_PLUGIN_CONFIG_DIR/config.toml and edit.
# Steps run inside the NEW worktree with these env vars available:
#   HERDR_MAIN_REPO  - absolute path to the main repo checkout
#   HERDR_WORKTREE   - absolute path to the new worktree
#   HERDR_BRANCH     - branch checked out in the new worktree

# Optional catch-all: runs for any repo without a specific [[project]] match.
[default]
steps = ["direnv allow 2>/dev/null || true"]

# One entry per repo. `path` is the MAIN repo path (supports ~).
[[project]]
path = "~/code/myrepo"
steps = [
  'cp "$HERDR_MAIN_REPO"/.env* . 2>/dev/null || true',
  "mise trust",
  "direnv allow",
  "pnpm install",
]
```

- [ ] **Step 6: Write a smoke test `test/smoke.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'smol-toml';

test('smol-toml is importable and parses', () => {
  const doc = parse('a = 1\n');
  assert.equal(doc.a, 1);
});
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore herdr-plugin.toml config.example.toml test/smoke.test.js
git commit -m "chore: scaffold worktree-setup plugin"
```

---

## Task 2: Config module

**Files:**
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: `smol-toml` `parse`.
- Produces:
  - `expandTilde(p: string, home?: string) => string`
  - `canonicalize(p: string, home?: string) => string` (realpath, falls back to resolved path)
  - `loadConfig(configDir?: string) => object | null`
  - `selectSteps(config: object|null, mainRepoPath: string, home?: string) => string[] | null`

- [ ] **Step 1: Write the failing test `test/config.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/config.test.js`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Implement `src/config.js`**

```js
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'smol-toml';

export function expandTilde(p, home = homedir()) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}

export function canonicalize(p, home = homedir()) {
  const expanded = resolve(expandTilde(p, home));
  try {
    return realpathSync(expanded);
  } catch {
    return expanded;
  }
}

export function loadConfig(configDir) {
  if (!configDir) return null;
  let text;
  try {
    text = readFileSync(join(configDir, 'config.toml'), 'utf8');
  } catch {
    return null;
  }
  if (!text.trim()) return null;
  return parse(text);
}

export function selectSteps(config, mainRepoPath, home = homedir()) {
  if (!config) return null;
  const target = canonicalize(mainRepoPath, home);
  const projects = Array.isArray(config.project) ? config.project : [];
  for (const entry of projects) {
    if (!entry || typeof entry.path !== 'string') continue;
    if (canonicalize(entry.path, home) === target) {
      return Array.isArray(entry.steps) ? entry.steps : [];
    }
  }
  if (config.default && Array.isArray(config.default.steps)) {
    return config.default.steps;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/config.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: config loading and main-repo matching"
```

---

## Task 3: Worktree pure parsers

**Files:**
- Create: `src/worktree.js` (parsers only in this task)
- Test: `test/worktree.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseJsonEnv(value?: string) => object | null`
  - `extractWorktreePath(eventJson: object|null, contextJson: object|null) => string | null`
  - `parseMainRepo(porcelain: string) => string | null`

- [ ] **Step 1: Write the failing test `test/worktree.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/worktree.test.js`
Expected: FAIL — cannot find module `../src/worktree.js`.

- [ ] **Step 3: Implement parsers in `src/worktree.js`**

```js
export function parseJsonEnv(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function extractWorktreePath(eventJson, contextJson) {
  const sources = [eventJson, contextJson].filter(Boolean);
  const pickers = [
    (o) => o.worktree && o.worktree.path,
    (o) => o.worktree && o.worktree.dir,
    (o) => o.worktree && o.worktree.worktree_path,
    (o) => o.path,
    (o) => o.workspace && o.workspace.path,
  ];
  for (const src of sources) {
    for (const pick of pickers) {
      const v = pick(src);
      if (typeof v === 'string' && v.length) return v;
    }
  }
  return null;
}

export function parseMainRepo(porcelain) {
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      return line.slice('worktree '.length).trim();
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/worktree.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worktree.js test/worktree.test.js
git commit -m "feat: worktree path and git porcelain parsers"
```

---

## Task 4: Worktree exec wrappers

**Files:**
- Modify: `src/worktree.js` (append exec wrappers)
- Test: `test/worktree.test.js` (append cases)

**Interfaces:**
- Consumes: `parseJsonEnv`, `extractWorktreePath`, `parseMainRepo` (Task 3); `node:child_process`.
- Produces:
  - `runCmd(cmd, args, opts?) => { status: number, stdout: string, stderr: string }`
  - `resolveWorktreePath(env: object, exec = runCmd) => string | null`
  - `deriveGitInfo(worktreePath: string, exec = runCmd) => { mainRepo: string|null, branch: string|null }`

- [ ] **Step 1: Append failing tests to `test/worktree.test.js`**

```js
import { resolveWorktreePath, deriveGitInfo } from '../src/worktree.js';

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
```

- [ ] **Step 2: Run to verify new tests fail**

Run: `node --test test/worktree.test.js`
Expected: FAIL — `resolveWorktreePath`/`deriveGitInfo` not exported.

- [ ] **Step 3: Append exec wrappers to `src/worktree.js`**

```js
import { spawnSync } from 'node:child_process';

export function runCmd(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

export function resolveWorktreePath(env, exec = runCmd) {
  const fromJson = extractWorktreePath(
    parseJsonEnv(env.HERDR_PLUGIN_EVENT_JSON),
    parseJsonEnv(env.HERDR_PLUGIN_CONTEXT_JSON),
  );
  if (fromJson) return fromJson;

  const wsId = env.HERDR_WORKSPACE_ID;
  if (!wsId) return null;
  const bin = env.HERDR_BIN_PATH || 'herdr';
  const res = exec(bin, ['worktree', 'list', '--json']);
  if (res.status !== 0) return null;
  let list;
  try {
    list = JSON.parse(res.stdout);
  } catch {
    return null;
  }
  const items = Array.isArray(list) ? list : (list.worktrees ?? list.items ?? []);
  const match = items.find(
    (w) => w.workspace_id === wsId || w.workspaceId === wsId || w.id === wsId,
  );
  if (!match) return null;
  return match.path ?? match.worktree ?? null;
}

export function deriveGitInfo(worktreePath, exec = runCmd) {
  const wt = exec('git', ['-C', worktreePath, 'worktree', 'list', '--porcelain']);
  const mainRepo = wt.status === 0 ? parseMainRepo(wt.stdout) : null;
  const br = exec('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = br.status === 0 ? br.stdout.trim() : null;
  return { mainRepo, branch };
}
```

Note: keep the Task 3 parsers at the top of the file; `spawnSync` import may sit above them or here — one import per module is fine since ESM hoists imports.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/worktree.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worktree.js test/worktree.test.js
git commit -m "feat: resolve worktree path and derive git info"
```

---

## Task 5: Step runner

**Files:**
- Create: `src/runner.js`
- Test: `test/runner.test.js`

**Interfaces:**
- Consumes: `node:child_process`.
- Produces:
  - `runSteps(steps: string[], opts: { cwd, env, onOutput? }) => { ok: true } | { ok: false, failedStep: string, code: number }`
  - `onOutput` receives `{ step, stdout, stderr, status }` per executed step.

- [ ] **Step 1: Write the failing test `test/runner.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/runner.test.js`
Expected: FAIL — cannot find module `../src/runner.js`.

- [ ] **Step 3: Implement `src/runner.js`**

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/runner.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runner.js test/runner.test.js
git commit -m "feat: sequential fail-fast step runner"
```

---

## Task 6: Orchestrator + integration test

**Files:**
- Create: `src/setup.js`
- Test: `test/setup.test.js`

**Interfaces:**
- Consumes: `loadConfig`, `selectSteps` (Task 2); `resolveWorktreePath`, `deriveGitInfo` (Task 4); `runSteps` (Task 5).
- Produces: an executable entrypoint `node src/setup.js` that reads `HERDR_*` env and exits 0 on success/no-op, non-zero on failure.

- [ ] **Step 1: Write the failing integration test `test/setup.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/setup.test.js`
Expected: FAIL — cannot find module `../src/setup.js`.

- [ ] **Step 3: Implement `src/setup.js`**

```js
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createWriteStream, mkdirSync } from 'node:fs';
import { loadConfig, selectSteps } from './config.js';
import { resolveWorktreePath, deriveGitInfo } from './worktree.js';
import { runSteps } from './runner.js';

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function main() {
  const env = process.env;

  const config = loadConfig(env.HERDR_PLUGIN_CONFIG_DIR);
  if (!config) return 0;

  const worktree = resolveWorktreePath(env);
  if (!worktree) {
    process.stderr.write('worktree-setup: could not resolve new worktree path\n');
    return 1;
  }

  const { mainRepo, branch } = deriveGitInfo(worktree);
  if (!mainRepo) {
    process.stderr.write('worktree-setup: could not derive main repo path\n');
    return 1;
  }

  const steps = selectSteps(config, mainRepo, homedir());
  if (!steps || steps.length === 0) return 0;

  const stepEnv = {
    ...env,
    HERDR_MAIN_REPO: mainRepo,
    HERDR_WORKTREE: worktree,
    HERDR_BRANCH: branch ?? '',
  };

  let log = null;
  if (env.HERDR_PLUGIN_STATE_DIR) {
    try {
      mkdirSync(env.HERDR_PLUGIN_STATE_DIR, { recursive: true });
      log = createWriteStream(join(env.HERDR_PLUGIN_STATE_DIR, `setup-${stamp()}.log`));
    } catch {
      log = null;
    }
  }

  const onOutput = ({ step, stdout, stderr, status }) => {
    const block = `$ ${step}\n${stdout}${stderr}[exit ${status}]\n`;
    process.stdout.write(block);
    if (log) log.write(block);
  };

  const result = runSteps(steps, { cwd: worktree, env: stepEnv, onOutput });
  if (log) log.end();

  if (!result.ok) {
    process.stderr.write(`worktree-setup: step failed: ${result.failedStep}\n`);
    return result.code;
  }
  return 0;
}

process.exit(main());
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/setup.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (all tests across all files).

- [ ] **Step 6: Commit**

```bash
git add src/setup.js test/setup.test.js
git commit -m "feat: setup orchestrator with logging and integration test"
```

---

## Task 7: README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: user-facing install + configure docs.

- [ ] **Step 1: Write `README.md`**

````markdown
# Worktree Setup — herdr plugin

Runs user-configured shell steps inside a new worktree when herdr fires
`worktree.created`, so the checkout is immediately usable (copy `.env*`,
`mise trust`, `direnv allow`, install deps, etc.). Solves
[herdr discussion #394](https://github.com/ogulcancelik/herdr/discussions/394).

## Install

```bash
herdr plugin link /path/to/herdr-worktree-setup   # or: herdr plugin install <git-url>
```

Herdr runs the build step (`npm ci`) to install the one dependency.

## Configure

Create `config.toml` in the plugin config dir (`$HERDR_PLUGIN_CONFIG_DIR`);
copy `config.example.toml` as a starting point.

```toml
[default]
steps = ["direnv allow 2>/dev/null || true"]

[[project]]
path = "~/code/myrepo"
steps = [
  'cp "$HERDR_MAIN_REPO"/.env* . 2>/dev/null || true',
  "mise trust",
  "direnv allow",
  "pnpm install",
]
```

- `path` — the MAIN repo path (supports `~`); matched by realpath against the
  new worktree's main checkout.
- `[default]` — optional catch-all for repos without a `[[project]]` entry.
- No match and no `[default]` — the plugin does nothing.

### Env available to steps

| Var | Meaning |
|-----|---------|
| `HERDR_MAIN_REPO` | Absolute path to the main repo checkout |
| `HERDR_WORKTREE` | Absolute path to the new worktree (also the step cwd) |
| `HERDR_BRANCH` | Branch checked out in the new worktree |

## Behavior

- Steps run sequentially via `sh -c`, cwd = the new worktree.
- Fail-fast: the first step that exits non-zero stops the run; make optional
  steps tolerant with `... || true`.
- Output is streamed and also written to `$HERDR_PLUGIN_STATE_DIR/setup-<ts>.log`.

## Develop

```bash
npm ci
npm test
```
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Self-Review

**Spec coverage:**
- Global config at `$HERDR_PLUGIN_CONFIG_DIR/config.toml` → Task 2 (`loadConfig`).
- Main-repo match + `[default]` fallback → Task 2 (`selectSteps`).
- Arbitrary shell steps + rich env → Task 5 (`runSteps`) + Task 6 (env injection).
- Node + TOML + `smol-toml` build step → Task 1 (manifest, package.json).
- Worktree path resolve (event JSON + CLI fallback) → Tasks 3-4.
- Main repo + branch via git → Tasks 3-4.
- Fail-fast + logging to state dir → Tasks 5-6.
- Manifest event hook → Task 1.
- Errors (no-op exit 0 / unresolved exit 1 / step-fail exit code) → Task 6.
- Docs/recipes → Task 1 (`config.example.toml`) + Task 7 (README).

**Placeholder scan:** none — every code/test step contains full content.

**Type consistency:** `loadConfig`, `selectSteps`, `resolveWorktreePath`, `deriveGitInfo`, `runSteps`, `runCmd`, `parseMainRepo`, `extractWorktreePath`, `parseJsonEnv` used consistently across tasks; `runSteps` return shape `{ ok, failedStep, code }` matches Task 5 and Task 6 consumption; `deriveGitInfo` return `{ mainRepo, branch }` matches Task 6.
