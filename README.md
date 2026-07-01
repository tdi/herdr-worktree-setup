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
