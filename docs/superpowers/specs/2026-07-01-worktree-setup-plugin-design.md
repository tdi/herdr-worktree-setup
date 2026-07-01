# Worktree Setup — Herdr Plugin Design

**Date:** 2026-07-01
**Status:** Approved (design)
**Source problem:** [herdr discussion #394](https://github.com/ogulcancelik/herdr/discussions/394) — "Add setup script per space." Maintainer closed it in favor of the 0.7.0 plugin system and asked the community to build it as a plugin.

## Problem

When herdr creates a new worktree (a "space"), the checkout is not immediately usable. Users repeatedly run the same per-project bootstrap steps: `mise trust`, `direnv allow`, copy `.env*` from the main checkout, install dependencies, etc. The request is a user-configurable setup script that runs automatically per worktree, similar to Conductor.

## Goal

A herdr plugin that, on `worktree.created`, runs user-defined setup steps inside the new worktree so it is usable without manual intervention.

Non-goals (YAGNI):
- Teardown scripts (`worktree.removed`) — out of scope for v0.1.0; can be added later.
- Built-in declarative toggles (`mise_trust = true`, `copy_env = [...]`) — arbitrary shell steps already cover these; ship documented recipes instead.
- Windows support in v0.1.0 — the target tools (mise, direnv) are unix; declare `platforms = ["linux", "macos"]`.

## Decisions (from brainstorming)

| Fork | Decision |
|------|----------|
| Config location | Global plugin config in `$HERDR_PLUGIN_CONFIG_DIR/config.toml` (private, not committed to repos) |
| Matching | New worktree's **main repo path** matched against each entry's `path`; optional `[default]` catch-all for unmatched repos; no match and no default → no-op |
| Step model | Arbitrary shell `steps` only, run with rich env (`HERDR_MAIN_REPO`, `HERDR_WORKTREE`, `HERDR_BRANCH`); ship documented recipes |
| Language / format | Node.js + TOML config (matches herdr convention: `herdr-plugin.toml`). TOML parsed via `smol-toml`, pulled by an `npm ci` build step |
| Error policy | Fail-fast: stop and exit non-zero on the first failing step (optional steps use `\|\| true`) |

## Plugin manifest (`herdr-plugin.toml`)

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

Notes:
- `id` namespace (`dariusz.`) is cosmetic and easily renamed before publishing.
- `[[build]]` installs the single runtime dep (`smol-toml`). Herdr runs build commands on install/link.

## User config (`$HERDR_PLUGIN_CONFIG_DIR/config.toml`)

```toml
# Optional catch-all: runs for any repo with no specific [[project]] match.
[default]
steps = ["direnv allow 2>/dev/null || true"]

# One entry per repo. `path` is the MAIN repo (not the worktree).
[[project]]
path = "~/code/myrepo"
steps = [
  'cp "$HERDR_MAIN_REPO"/.env* . 2>/dev/null || true',
  "mise trust",
  "direnv allow",
  "pnpm install",
]
```

- `path` supports `~` expansion; compared by `realpath` to tolerate symlinks and trailing slashes.
- `steps` is an ordered list of shell command strings.
- A shipped `config.example.toml` documents the shape and common recipes.

## Runtime flow

Entrypoint `src/setup.js` is a thin orchestrator over three focused, independently testable modules.

1. **Resolve the new worktree path** — `worktree.js`
   - Parse `HERDR_PLUGIN_EVENT_JSON`, then `HERDR_PLUGIN_CONTEXT_JSON`, for a worktree-path field. The docs do not pin the exact JSON shape, so probe a small set of candidate field paths (`worktree.path`, `worktree.dir`, `path`) defensively.
   - Fallback: run `herdr worktree list --json` (via `HERDR_BIN_PATH`) and select the entry whose id matches `HERDR_WORKSPACE_ID`.
   - If still unresolved → log and exit non-zero.

2. **Derive main repo + branch** — `worktree.js`
   - `git -C <worktree> worktree list --porcelain`; the first `worktree` record is the main working tree → `HERDR_MAIN_REPO`.
   - `git -C <worktree> rev-parse --abbrev-ref HEAD` → `HERDR_BRANCH`.
   - Git-based, independent of herdr internals.

3. **Load + match config** — `config.js`
   - Read and TOML-parse `$HERDR_PLUGIN_CONFIG_DIR/config.toml`. Missing/empty → no-op exit 0.
   - Expand `~` and `realpath` each `[[project]].path`; match against `realpath(HERDR_MAIN_REPO)`.
   - On match → that entry's `steps`. Else `[default].steps` if present. Else no-op exit 0.

4. **Run steps** — `runner.js`
   - Run each step sequentially via `sh -c "<step>"`, `cwd` = worktree.
   - Env = `{ ...process.env, HERDR_MAIN_REPO, HERDR_WORKTREE, HERDR_BRANCH }`.
   - Stream child stdout/stderr through, and tee a run log into `$HERDR_PLUGIN_STATE_DIR/setup-<timestamp>.log`.
   - Fail-fast: on the first non-zero step, log the failing step and exit with its code.

## Module boundaries

| File | Responsibility | Depends on |
|------|----------------|-----------|
| `src/setup.js` | Orchestrate the four phases; own process exit codes | the three modules below |
| `src/worktree.js` | Resolve worktree path (event JSON + CLI fallback), main repo, branch | `child_process`, `HERDR_*` env |
| `src/config.js` | Read/parse config, expand + realpath match, pick steps | `smol-toml`, `fs`, `path`, `os` |
| `src/runner.js` | Run a step list in a cwd with env; tee log; fail-fast | `child_process`, `fs` |

Each module is a pure-ish unit with a small interface, testable without a running herdr.

## Repository structure

```
herdr-plugin.toml
package.json
config.example.toml
README.md
src/
  setup.js
  worktree.js
  config.js
  runner.js
test/
  worktree.test.js
  config.test.js
  runner.test.js
```

## Testing (TDD, `node:test` + `node:assert`)

- **config.test.js** — `~` expansion; `realpath` match against main repo; `[default]` fallback; missing config → null/no-op; malformed TOML → clear error.
- **worktree.test.js** — extract worktree path from sample `HERDR_PLUGIN_EVENT_JSON` shapes; parse main repo from sample `git worktree list --porcelain` output; branch parse.
- **runner.test.js** — steps run in correct cwd with injected env (assert via a step that writes env to a temp file); fail-fast stops after a failing step (`false`) and returns its code; log file written to state dir.
- Git and herdr CLI interactions are exercised against captured sample outputs / temp git repos, not a live herdr.

## Error handling summary

| Condition | Behavior |
|-----------|----------|
| No config file / empty | Exit 0, no-op |
| No matching project and no `[default]` | Exit 0, no-op |
| Worktree path unresolvable | Log, exit non-zero |
| A step exits non-zero | Log failing step, exit with its code (fail-fast) |

## Open runtime unknowns (handled defensively, not blockers)

- Exact `worktree.created` event JSON shape — probed at runtime + CLI fallback; first real run logs the raw JSON to refine field probing.
- Precise `herdr worktree list --json` field names — verified against a live herdr during implementation; fallback path adjusted if needed.
