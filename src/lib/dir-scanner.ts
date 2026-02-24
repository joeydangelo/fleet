import { readdirSync, existsSync, type Dirent } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

export interface DirEntry {
  name: string;
  fullPath: string;
  isGitRepo: boolean;
}

const MAX_ENTRIES = 50;

function expandTilde(inputPath: string): string {
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith('~/')) return join(homedir(), inputPath.slice(2));
  return inputPath;
}

/**
 * Split user input into parentDir + prefix for filtering.
 *
 *   "~/pro"        -> { parentDir: "/home/x", prefix: "pro" }
 *   "~/projects/"  -> { parentDir: "/home/x/projects", prefix: "" }
 *   "/tmp"         -> { parentDir: "/", prefix: "tmp" }
 *   ""             -> { parentDir: homedir, prefix: "" }
 */
export function parsePathInput(raw: string): { parentDir: string; prefix: string } {
  if (!raw) return { parentDir: homedir(), prefix: '' };

  const expanded = expandTilde(raw);

  if (expanded.endsWith('/')) {
    return { parentDir: expanded.slice(0, -1) || '/', prefix: '' };
  }

  return { parentDir: dirname(expanded), prefix: basename(expanded) };
}

export function isGitRepo(dirPath: string): boolean {
  try {
    return existsSync(join(dirPath, '.git'));
  } catch {
    return false;
  }
}

/**
 * Walk up from cwd looking for .git (directory or file). Returns the containing
 * directory or null if no git root is found.
 */
export function resolveGitRoot(cwd: string): string | null {
  let current = cwd;
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null; // reached filesystem root
    current = parent;
  }
}

/**
 * Scan a directory for subdirectories, filtering by prefix.
 * Returns max 50 entries, sorted: git repos first, then alphabetical.
 */
export function scanDirectories(parentDir: string, prefix: string): DirEntry[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const showHidden = prefix.startsWith('.');
  const lowerPrefix = prefix.toLowerCase();
  const dirs: DirEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') && !showHidden) continue;
    if (lowerPrefix && !entry.name.toLowerCase().startsWith(lowerPrefix)) continue;

    const fullPath = join(parentDir, entry.name);
    dirs.push({ name: entry.name, fullPath, isGitRepo: isGitRepo(fullPath) });
  }

  dirs.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return dirs.slice(0, MAX_ENTRIES);
}
