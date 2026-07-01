import { spawnSync } from 'node:child_process';

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
  // Ordered most-specific first. Field names verified against herdr 0.7.1:
  //   event   -> data.worktree.path / data.worktree.checkout_path
  //   context -> worktree.checkout_path / workspace_cwd
  // repo_root/repo_key are the MAIN repo, never the new worktree, so they are
  // deliberately excluded. Looser fallbacks are kept for other/older shapes.
  const pickers = [
    (o) => o.data?.worktree?.path,
    (o) => o.data?.worktree?.checkout_path,
    (o) => o.data?.workspace?.worktree?.checkout_path,
    (o) => o.worktree?.path,
    (o) => o.worktree?.checkout_path,
    (o) => o.worktree?.dir,
    (o) => o.worktree?.worktree_path,
    (o) => o.workspace?.worktree?.checkout_path,
    (o) => o.workspace_cwd,
    (o) => o.workspace?.path,
    (o) => o.path,
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
  const items = Array.isArray(list)
    ? list
    : list && typeof list === 'object'
      ? (list.worktrees ?? list.items ?? [])
      : [];
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
