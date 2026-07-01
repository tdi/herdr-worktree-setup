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
  const file = join(configDir, 'config.toml');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (!text.trim()) return null;
  try {
    return parse(text);
  } catch (err) {
    throw new Error(`worktree-setup: invalid config.toml at ${file}: ${err.message}`);
  }
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
