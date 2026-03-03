import { existsSync, readFileSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';

const PAW_GITIGNORE_CONTENT = `# Transient runtime state (dies with session)
run/
# Installed documentation (regenerated on sync)
docs/
# Session runtime data
paw.yaml
tasks/
sync/
sessions/
*.tmp
`;

/**
 * Create or update .paw/.gitignore so that docs/, state.yml, and runtime
 * data are ignored while config.yml and hooks/ stay tracked.
 */
export function ensurePawGitignore(repoRoot: string): boolean {
  const gitignorePath = resolve(repoRoot, '.paw', '.gitignore');
  if (existsSync(gitignorePath)) {
    const current = readFileSync(gitignorePath, 'utf-8');
    if (current === PAW_GITIGNORE_CONTENT) return false;
  }
  writeFileSync(gitignorePath, PAW_GITIGNORE_CONTENT, 'utf-8');
  return true;
}

/**
 * Remove the `.paw/` entry (and its comment) from the root .gitignore.
 * This is the migration path from the old "ignore everything" model.
 * Returns true if the file was modified.
 */
export function removePawFromRootGitignore(repoRoot: string): boolean {
  const gitignorePath = resolve(repoRoot, '.gitignore');
  if (!existsSync(gitignorePath)) return false;

  const content = readFileSync(gitignorePath, 'utf-8');
  if (!content.includes('.paw/')) return false;

  const lines = content.split('\n');
  const filtered: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '.paw/' || line.trim() === '.paw') continue;
    if (
      line.trim() === '# paw working state' &&
      i + 1 < lines.length &&
      (lines[i + 1]!.trim() === '.paw/' || lines[i + 1]!.trim() === '.paw')
    ) {
      continue;
    }
    filtered.push(line);
  }

  const cleaned = filtered
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/, '\n');

  if (cleaned === content) return false;
  writeFileSync(gitignorePath, cleaned, 'utf-8');
  return true;
}
