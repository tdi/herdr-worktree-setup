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
